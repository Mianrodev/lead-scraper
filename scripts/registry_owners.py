"""
Lead Finder: owner names from state business registries (free public data).

Runs on GitHub Actions next to the free collector. Lead Finder hands out businesses in the
states below that haven't been looked up yet; this script finds each one's registered company
and its officers / managers, and sends back the most likely owner.

  Florida (FL)      Sunbiz corporate data: the state's full file (quarterly) plus the daily
                    files since, from the Division of Corporations' public download server.
  New York (NY)     data.ny.gov  "Active Corporations"   (chairman / filing contact)
  Pennsylvania (PA) data.pa.gov  "Registered Businesses" (officers)
  Oregon (OR)       data.oregon.gov "Active Businesses"  (members, managers, officers)
  Connecticut (CT)  data.ct.gov  "Business Registry"     (principals)
  Colorado (CO)     data.colorado.gov "Business Entities" (registered agent only)

Matching is by legal name (ignoring LLC / Inc / punctuation) and the business's city or ZIP,
so "Joe's Plumbing" matches "JOE'S PLUMBING LLC" in the same town. Standard library only,
except paramiko for Florida's download server.

    python scripts/registry_owners.py --state FL
    python scripts/registry_owners.py --state NY
    python scripts/registry_owners.py --try "SELMA'S CLEANING SERVICES" --state FL --city "Palm Bay"
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import io
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from overture_collect import Api  # noqa: E402  (same sign-in as the free collector)

SOCRATA_STATES = ("NY", "PA", "OR", "CT", "CO")
SUFFIXES = {"LLC", "L L C", "INC", "INCORPORATED", "CORP", "CORPORATION", "CO", "COMPANY", "LTD", "LIMITED", "LLP", "PLLC",
            "PA", "LC", "LP", "PLC", "THE", "DBA"}
CLAIM_PAGE = 2000


def norm(name: str) -> str:
    """'Joe's Plumbing & Drain, L.L.C.' -> 'JOES PLUMBING AND DRAIN'."""
    s = (name or "").upper().replace("&", " AND ").replace("'", "").replace("’", "")
    s = re.sub(r"\bL\.?\s?L\.?\s?C\.?", " LLC ", s)
    s = re.sub(r"[^A-Z0-9]+", " ", s)
    words = [w for w in s.split() if w not in SUFFIXES]
    return " ".join(words)


def zip5(z: str | None) -> str:
    m = re.match(r"\d{5}", (z or "").strip())
    return m.group(0) if m else ""


def city_key(c: str | None) -> str:
    return re.sub(r"[^A-Z]", "", (c or "").upper().replace("SAINT", "ST"))


def title_case(name: str) -> str:
    def fix(w: str) -> str:
        if w.upper() in ("II", "III", "IV", "JR", "SR"):
            return w.upper() if w.upper() != "JR" and w.upper() != "SR" else w.capitalize() + "."
        return "-".join(p.capitalize() for p in w.split("-"))
    return " ".join(fix(w) for w in name.split())


def looks_like_person(name: str) -> bool:
    n = name.upper()
    return 2 <= len(n.split()) <= 5 and not re.search(r"\b(LLC|INC|CORP|CORPORATION|COMPANY|SERVICES?|AGENTS?|REGISTERED|GROUP|LAW|PA|PLLC|LLP|TRUST|BANK)\b", n)


# ------------------------------------------------------------------------------------------
# Choosing the owner among officers

TITLE_WORDS = {
    "OWNR": "Owner", "OWN": "Owner", "OWNER": "Owner", "CEO": "CEO", "P": "President", "PRES": "President", "PRESIDENT": "President",
    "PSTD": "President", "MGRM": "Managing Member", "MGR": "Manager", "MANAGER": "Manager", "AMBR": "Member", "AMB": "Member",
    "MBR": "Member", "MEMBER": "Member", "C": "Chairman", "CHRM": "Chairman", "CHAIRMAN": "Chairman", "AP": "Authorized Person",
    "VP": "Vice President", "V": "Vice President", "D": "Director", "DIR": "Director", "T": "Treasurer", "S": "Secretary",
    "PARTNER": "Partner", "GP": "General Partner", "PRINCIPAL": "Principal", "SOLE PROPRIETOR": "Owner", "PROPRIETOR": "Owner",
}
RANK = ["Owner", "CEO", "President", "Managing Member", "Manager", "Member", "Partner", "General Partner", "Principal",
        "Chairman", "Authorized Person", "Vice President", "Director", "Treasurer", "Secretary"]


def title_of(raw: str) -> str | None:
    """Plain title from registry codes (same rules as tidyOwnerTitle in src/registry.ts)."""
    r = (raw or "").strip().upper()
    if r in TITLE_WORDS:
        return TITLE_WORDS[r]
    c = re.sub(r"[^A-Z]", "", r)
    if not c:
        return None
    if c in TITLE_WORDS:
        return TITLE_WORDS[c]
    if "CEO" in c:
        return "CEO"
    if c.startswith("OWN") or c == "O":
        return "Owner"
    if re.match(r"^(MGRM|MMGR|MM|MANAGINGMEMBER)", c):
        return "Managing Member"
    if re.match(r"^(MANA|MGR|MGM|MRG|MG|MR|OPMG)", c):
        return "Manager"
    if re.match(r"^(AMBR|AMB|MBR|MEMB|AM$)", c):
        return "Member"
    if re.match(r"^(AUTH|AP$|AR$)", c):
        return "Authorized Person"
    if c.startswith("PRIN"):
        return "Principal"
    if c.startswith("PART") or c == "GP":
        return "Partner"
    if c.startswith("CHA") or c == "C":
        return "Chairman"
    if c.startswith("SEC") or (c.startswith("S") and len(c) <= 3):
        return "Secretary"
    if c.startswith("TRE") or (c.startswith("T") and len(c) <= 3):
        return "Treasurer"
    if c.startswith("DIR") or re.fullmatch(r"D+", c):
        return "Director"
    if re.fullmatch(r"[PDSTVC]{1,6}", c) and "P" in c and not c.startswith("V"):
        return "President"
    if c.startswith("V"):
        return "Vice President"
    for k, v in TITLE_WORDS.items():
        if len(k) > 3 and k in r:
            return v
    return None


def best_officer(officers: list[tuple[str, str]]) -> tuple[str, str] | None:
    """(name, title) with the most owner-like title."""
    ranked = [(RANK.index(t) if t in RANK else 99, n, t) for n, t in officers if n and looks_like_person(n)]
    if not ranked:
        return None
    ranked.sort(key=lambda x: x[0])
    return ranked[0][1], ranked[0][2]


MAX_CONTACTS = 5


def contacts_for(officers: list[tuple[str, str]], first: tuple[str, str] | None) -> list[dict]:
    """Every person among the officers (the owner first, then in registry order), once each, at most 5.

    >>> contacts_for([("Ann Lee", "Secretary"), ("ACME HOLDINGS LLC", "Manager"), ("Bob Ray", "President"), ("ann lee", "Director")], ("Bob Ray", "President"))
    [{'name': 'Bob Ray', 'title': 'President'}, {'name': 'Ann Lee', 'title': 'Secretary'}]
    >>> contacts_for([], None)
    []
    """
    out: list[dict] = []
    seen: set[str] = set()
    for n, t in ([first] if first else []) + list(officers):
        n = (n or "").strip()
        key = re.sub(r"[^A-Z]", "", n.upper())
        if not n or not key or key in seen or not looks_like_person(n):
            continue
        seen.add(key)
        out.append({"name": n[:60], "title": (t or "")[:40] or None})
        if len(out) >= MAX_CONTACTS:
            break
    return out


def iso_date(raw: str | None) -> str | None:
    """A registry date as YYYY-MM-DD: Florida's MMDDYYYY, or the portals' '2015-03-04T00:00:00.000'.

    >>> iso_date("03042015"), iso_date("2015-03-04T00:00:00.000"), iso_date("00000000"), iso_date("        "), iso_date(None)
    ('2015-03-04', '2015-03-04', None, None, None)
    >>> iso_date("02302015"), iso_date("01011700")
    (None, None)
    """
    s = (raw or "").strip()
    m = re.fullmatch(r"(\d{2})(\d{2})(\d{4})", s)
    if m:
        mo, d, y = m.group(1), m.group(2), m.group(3)
    else:
        m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
        if not m:
            return None
        y, mo, d = m.group(1), m.group(2), m.group(3)
    try:
        import datetime as _dt
        day = _dt.date(int(y), int(mo), int(d))
    except ValueError:
        return None
    if day.year < 1800 or day > _dt.date.today():
        return None
    return day.isoformat()


# ------------------------------------------------------------------------------------------
# Matching a business to registry records

def pick(lead: dict, records: list[dict]) -> dict | None:
    """The registry record for this business: same legal name, and the same ZIP or city when we
    can tell; a unique, distinctive name statewide is also accepted."""
    key = norm(lead["name"])
    same = [r for r in records if norm(r["name"]) == key]
    if not same:
        return None
    # Dissolved / inactive companies don't tell us who runs the business today.
    active = [r for r in same if r.get("active", True)]
    if not active:
        return None
    z, c = zip5(lead.get("zip")), city_key(lead.get("city"))
    local = [r for r in active if (z and z in r.get("zips", ())) or (c and c in r.get("cities", ()))]
    if local:
        return local[0]
    if len(active) == 1 and len(key.split()) >= 2 and len(key) >= 8:
        return active[0]
    return None


# ------------------------------------------------------------------------------------------
# Florida: the Sunbiz corporate data files

FL_HOST = "sftp.floridados.gov"
# The Division of Corporations publishes this read-only public login for its data downloads.
FL_USER = os.environ.get("SUNBIZ_SFTP_USER", "Public")
FL_PASS = os.environ.get("SUNBIZ_SFTP_PASSWORD", "PubAccess1845!")


def fl_name(raw: str) -> str:
    """Sunbiz person names are fixed columns: last (20), first (14), middle."""
    last, first = raw[:20].strip(), raw[20:34].strip()
    return title_case(f"{first} {last}".strip())


def fl_record(rec: str) -> dict | None:
    """One company from the corporate data file (layout: dos.sunbiz.org/data-definitions/cor.html).

    >>> rec = ("L21000012345" + "JOES PLUMBING LLC".ljust(192) + "A").ljust(472) + "03042015"
    >>> rec = rec.ljust(668) + "MGR P" + "SMITH".ljust(20) + "JOE".ljust(22)
    >>> r = fl_record(rec.ljust(1440))
    >>> r["founded"], r["officers"]
    ('2015-03-04', [('Joe Smith', 'Manager')])
    """
    if len(rec) < 700:
        return None
    officers = []
    for i in range(6):
        b = 668 + i * 128
        title, typ, name = rec[b:b + 4].strip(), rec[b + 4:b + 5], rec[b + 5:b + 47]
        if name.strip() and typ == "P":
            officers.append((fl_name(name), title_of(title) or title.title()))
    ra, ra_type = rec[544:586], rec[586:587]
    return {
        "id": rec[0:12].strip(), "name": rec[12:204].strip(), "active": rec[204:205] == "A",
        "zips": {zip5(rec[334:344]), zip5(rec[460:470])} - {""},
        "cities": {city_key(rec[304:332]), city_key(rec[430:458])} - {""},
        "officers": officers, "agent": fl_name(ra) if ra_type == "P" and ra.strip() else None,
        # Field 17 "File Date" (position 473, 8 characters, MMDDYYYY): the formation filing.
        "founded": iso_date(rec[472:480]),
    }


FL_FILES = {
    # kind: (quarterly zip, daily folder, daily file suffix)
    "cor": ("/Public/doc/Quarterly/Cor/cordata.zip", "/Public/doc/cor", "c"),
    "fic": ("/Public/doc/Quarterly/Fic/ficdata.zip", "/Public/doc/fic", "f"),
}


def download_quarterly(remote: str, local: str):
    """A quarterly zip: curl (much faster, resumes) when it can speak SFTP, else paramiko gently
    (the state's server refuses too many parallel reads: "insufficient resources")."""
    curl = shutil.which("curl")
    if curl and "sftp" in subprocess.run([curl, "-V"], capture_output=True, text=True).stdout.lower():
        for attempt in range(3):
            r = subprocess.run([curl, "--silent", "--show-error", "--insecure", "--retry", "5", "--retry-delay", "10", "-C", "-",
                                "-u", f"{FL_USER}:{FL_PASS}", f"sftp://{FL_HOST}{remote}", "-o", local], timeout=3300)
            if r.returncode == 0:
                return
            print(f"  curl stopped (code {r.returncode}); resuming", flush=True)
    t, s = sunbiz()
    try:
        s.get(remote, local, max_concurrent_prefetch_requests=16)
    finally:
        t.close()


def daily_file(s, folder: str, name: str):
    """One daily file, fetched in one go (getfo reads ahead; plain reads are very slow)."""
    buf = io.BytesIO()
    s.getfo(f"{folder}/{name}", buf)
    buf.seek(0)
    yield from io.TextIOWrapper(buf, encoding="latin-1", newline="\n")


def sunbiz():
    """A fresh connection to the state's download server (it drops idle ones during long downloads)."""
    import paramiko  # only needed for Florida

    t = paramiko.Transport((FL_HOST, 22))
    t.set_keepalive(30)
    t.connect(username=FL_USER, password=FL_PASS)
    return t, paramiko.SFTPClient.from_transport(t)


def fl_lines(workdir: str, kind: str, daily_only: int = 0):
    """Every record of one Florida file: the quarterly file, then the daily files filed since
    (newest wins). daily_only=N reads just the last N daily files (testing without the download)."""
    remote, folder, suffix = FL_FILES[kind]
    pattern = re.compile(rf"\d{{8}}{suffix}\.txt", re.I)
    t, s = sunbiz()
    try:
        names = sorted(a.filename for a in s.listdir_attr(folder) if pattern.fullmatch(a.filename))
        q = None if daily_only else s.stat(remote)
    finally:
        t.close()
    if daily_only:
        daily = names[-daily_only:]
    else:
        local = os.path.join(workdir, os.path.basename(remote))
        if not (os.path.exists(local) and os.path.getsize(local) == q.st_size):
            print(f"Downloading Florida's {kind} file ({q.st_size / 1e6:,.0f} MB)...", flush=True)
            started = time.time()
            download_quarterly(remote, local)
            print(f"  downloaded in {time.time() - started:.0f}s", flush=True)
            if os.path.getsize(local) != q.st_size:
                raise RuntimeError(f"download incomplete ({os.path.getsize(local):,} of {q.st_size:,} bytes)")
        since = time.strftime("%Y%m%d", time.gmtime(q.st_mtime - 3 * 86400))
        daily = [n for n in names if n[:8] >= since]
        print(f"  {kind}: plus {len(daily)} daily files since {since}", flush=True)
        with zipfile.ZipFile(local) as z:
            for member in z.namelist():
                with z.open(member) as fh:
                    yield from io.TextIOWrapper(fh, encoding="latin-1", newline="\n")
    # The daily files: a new connection (the first one may have been dropped during a long download).
    t, s = sunbiz()
    try:
        for name in daily:
            yield from daily_file(s, folder, name)
    finally:
        t.close()


def fic_record(rec: str) -> dict | None:
    """A trade name ("doing business as"): up to 10 owners, each a person or a company
    (layout: dos.sunbiz.org/data-definitions/fic.html).

    >>> rec = ("G21000012345" + "JOES PLUMBING".ljust(192)).ljust(338) + "11302019" + "00001" + "A"
    >>> r = fic_record((rec.ljust(388) + "".ljust(12) + ("SMITH".ljust(20) + "JOE").ljust(55) + "P").ljust(2098))
    >>> r["founded"], r["active"], r["officers"]
    ('2019-11-30', True, [('Joe Smith', 'Owner')])
    """
    if len(rec) < 560:
        return None
    people, companies = [], []
    for i in range(10):
        b = 388 + i * 171
        name, fmt, charter = rec[b + 12:b + 67], rec[b + 67:b + 68], rec[b + 159:b + 171].strip()
        if not name.strip():
            continue
        if fmt == "P":
            person = fl_name(name)
            if person not in [p for p, _ in people]:
                people.append((person, "Owner"))
        elif charter:
            companies.append(charter)
    return {
        "id": rec[0:12].strip(), "name": rec[12:204].strip(), "active": rec[351:352] == "A",
        "zips": {zip5(rec[326:336])} - {""}, "cities": {city_key(rec[296:324])} - {""},
        "officers": people, "agent": None, "companies": companies,
        # Field 10 "Filing Date" (position 339, 8 characters, MMDDYYYY).
        "founded": iso_date(rec[338:346]),
    }


def run_florida(api: Api, workdir: str, daily_only: int = 0):
    leads = claim_all(api, "FL")
    if not leads:
        print("No Florida businesses waiting.")
        return
    by_key: dict[str, list[dict]] = {}
    for l in leads:
        k = norm(l["name"])
        if k:
            by_key.setdefault(k, []).append(l)
    print(f"Matching {len(leads)} Florida businesses ({len(by_key)} distinct names)...", flush=True)
    # 1. Trade names ("Joe's Plumbing" filed as a fictitious name of "JMS HOLDINGS LLC").
    dba: dict[str, list[dict]] = {}
    n = 0
    for line in fl_lines(workdir, "fic", daily_only):
        n += 1
        k = norm(line[12:204])
        if k in by_key:
            r = fic_record(line)
            if r:
                dba[k] = [x for x in dba.get(k, []) if x["id"] != r["id"]] + [r]
    wanted_charters = {c for rs in dba.values() for r in rs for c in r["companies"]}
    print(f"  read {n:,} trade names; {len(dba)} names found ({len(wanted_charters)} owned by companies)", flush=True)
    # 2. Companies: by name, and the companies that own a matched trade name.
    found: dict[str, list[dict]] = {}
    by_charter: dict[str, dict] = {}
    n = 0
    for line in fl_lines(workdir, "cor", daily_only):
        n += 1
        doc = line[0:12].strip()
        k = norm(line[12:204])
        if k in by_key or doc in wanted_charters:
            r = fl_record(line)
            if not r:
                continue
            if k in by_key:
                found[k] = [x for x in found.get(k, []) if x["id"] != r["id"]] + [r]  # a newer daily record replaces the old one
            if doc in wanted_charters:
                by_charter[doc] = r
    print(f"  read {n:,} company records; {len(found)} names found", flush=True)
    results = []
    via_dba = 0
    for l in leads:
        k = norm(l["name"])
        r = pick(l, found.get(k, []))
        if not r:
            d = pick(l, dba.get(k, []))
            if d:
                # The trade name's owners: people directly, or the officers of the owning company.
                officers = list(d["officers"])
                owner_co = next((by_charter[c] for c in d["companies"] if c in by_charter), None)
                if owner_co:
                    officers += owner_co["officers"]
                r = {**d, "officers": officers, "agent": owner_co["agent"] if owner_co else None,
                     "founded": d.get("founded") or (owner_co or {}).get("founded"),
                     "name": f"{d['name']} (trade name of {owner_co['name']})" if owner_co else f"{d['name']} (trade name)"}
                via_dba += 1
        results.append(result_for(l, r, "FL"))
    print(f"  {via_dba} matched through a trade name", flush=True)
    send(api, results)


def result_for(lead: dict, r: dict | None, state: str) -> dict:
    out = {"id": lead["id"]}
    if not r:
        return out
    who = best_officer(r.get("officers", []))
    if not who and r.get("agent") and looks_like_person(r["agent"]):
        who = (r["agent"], "Registered agent")
    out.update(registryName=r["name"][:120], registryId=f"{state}:{r['id']}"[:40])
    if who:
        out.update(ownerName=who[0][:60], ownerTitle=who[1][:40])
    # Every person on the record (owner first); the agent only when they are the one named above.
    out["contacts"] = contacts_for(r.get("officers", []), who)
    out["founded"] = r.get("founded") or None
    return out


# ------------------------------------------------------------------------------------------
# Socrata states: one search per business

SOCRATA = {
    "NY": ("data.ny.gov", "n9v6-gdp6"),
    "PA": ("data.pa.gov", "xvd7-5r2c"),
    "OR": ("data.oregon.gov", "tckn-sxa6"),
    "CT": ("data.ct.gov", "n7gp-d28j"),
    "CO": ("data.colorado.gov", "4ykn-tg5h"),
}
CT_PRINCIPALS = ("data.ct.gov", "ka36-64k6")
# Each dataset's filing / formation date column (checked against the portals' column metadata).
SOCRATA_FOUNDED = {
    "NY": "initial_dos_filing_date",
    "PA": "creationdate",
    "OR": "registry_date",
    "CT": "date_registration",
    "CO": "entityformdate",
}


def soql(domain: str, dataset: str, params: dict) -> list[dict]:
    url = f"https://{domain}/resource/{dataset}.json?" + urllib.parse.urlencode(params)
    headers = {"User-Agent": "lead-finder-registry/1", "Accept": "application/json"}
    token = os.environ.get("SOCRATA_APP_TOKEN")
    if token:
        headers["X-App-Token"] = token
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as res:
                return json.load(res)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and attempt < 3:
                time.sleep(3 * (attempt + 1))
                continue
            raise
        except urllib.error.URLError:
            if attempt < 3:
                time.sleep(3 * (attempt + 1))
                continue
            raise
    return []


def words_query(name: str) -> str:
    """The distinctive words of the name, for the portal's full-text search."""
    return " ".join(norm(name).split()[:4])


def socrata_records(state: str, lead: dict) -> list[dict]:
    domain, ds = SOCRATA[state]
    q = words_query(lead["name"])
    if len(q) < 3:
        return []
    rows = soql(domain, ds, {"$q": q, "$limit": 100})
    recs: dict[str, dict] = {}
    for row in rows:
        if state == "NY":
            rid, name = row.get("dos_id"), row.get("current_entity_name")
            officers = [(title_case(row["chairman_name"]), "Chairman")] if row.get("chairman_name") else []
            agent = title_case(row["dos_process_name"]) if row.get("dos_process_name") and looks_like_person(row["dos_process_name"]) else None
            zips, cities = {zip5(row.get("location_zip")), zip5(row.get("dos_process_zip"))}, {city_key(row.get("location_city")), city_key(row.get("county"))}
        elif state == "PA":
            rid, name = row.get("filing_number"), row.get("business_name")
            person = " ".join(x for x in (row.get("first_name"), row.get("last_name")) if x)
            officers = [(title_case(person), title_of(row.get("party_type", "")) or (row.get("party_type") or "Officer").title())] if person else []
            agent, zips, cities = None, {zip5(row.get("zip"))}, {city_key(row.get("city"))}
        elif state == "OR":
            rid, name = row.get("registry_number"), row.get("business_name")
            person = " ".join(x for x in (row.get("first_name"), row.get("last_name")) if x)
            kind = (row.get("associated_name_type") or "").upper()
            officers = [(title_case(person), title_of(kind) or kind.title())] if person and "AGENT" not in kind else []
            agent = title_case(person) if person and "AGENT" in kind else None
            zips, cities = {zip5(row.get("zip"))}, {city_key(row.get("city"))}
        elif state == "CO":
            rid, name = row.get("entityid"), row.get("entityname")
            person = " ".join(x for x in (row.get("agentfirstname"), row.get("agentlastname")) if x)
            officers, agent = [], title_case(person) if person else None
            zips, cities = {zip5(row.get("principalzipcode"))}, {city_key(row.get("principalcity"))}
        else:  # CT
            rid, name = row.get("id"), row.get("name")
            officers, agent = [], None
            zips, cities = {zip5(row.get("billingpostalcode"))}, {city_key(row.get("billingcity"))}
        if not rid or not name:
            continue
        r = recs.setdefault(rid, {"id": rid, "name": name, "active": True, "zips": set(), "cities": set(), "officers": [], "agent": None, "founded": None})
        # Initial filing / formation date (the column each portal publishes; missing -> unknown).
        r["founded"] = r["founded"] or iso_date(row.get(SOCRATA_FOUNDED[state]))
        r["zips"] |= zips - {""}
        r["cities"] |= cities - {""}
        r["officers"] += officers
        r["agent"] = r["agent"] or agent
        if state == "CO" and (row.get("entitystatus") or "").lower() not in ("good standing", "exists", ""):
            r["active"] = False
        if state == "CT" and (row.get("status") or "").lower() not in ("active", ""):
            r["active"] = False
    return list(recs.values())


def ct_principals(business_id: str) -> list[tuple[str, str]]:
    rows = soql(*CT_PRINCIPALS, {"business_id": business_id, "$limit": 20})
    out = []
    for row in rows:
        person = " ".join(x for x in (row.get("firstname"), row.get("lastname")) if x)
        if person:
            out.append((title_case(person), title_of(row.get("designation", "")) or (row.get("designation") or "Principal").title()))
    return out


def run_socrata(api: Api, state: str):
    leads = claim_all(api, state, limit=400)
    if not leads:
        print(f"No {state} businesses waiting.")
        return

    def one(lead: dict) -> dict:
        try:
            r = pick(lead, socrata_records(state, lead))
            if r and state == "CT":
                r["officers"] = ct_principals(r["id"])
            return result_for(lead, r, state)
        except Exception as e:  # noqa: BLE001  (a failed search just leaves the owner unknown)
            print(f"  {lead['name']}: {e}", flush=True)
            return {"id": lead["id"], "retry": True}

    with cf.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(one, leads))
    send(api, [r for r in results if not r.get("retry")])


# ------------------------------------------------------------------------------------------

def claim_all(api: Api, state: str, limit: int | None = None) -> list[dict]:
    out: list[dict] = []
    after = 0
    while True:
        page = api.post_json("/claim", {"state": state, "after": after, "limit": min(CLAIM_PAGE, limit or CLAIM_PAGE)})
        items = page.get("items") or []
        out += items
        if not items or page.get("done") or (limit and len(out) >= limit):
            return out[:limit] if limit else out
        after = page["after"]


def send(api: Api, results: list[dict]):
    found = sum(1 for r in results if r.get("ownerName"))
    for i in range(0, len(results), 500):
        api.post_json("/results", {"results": results[i:i + 500]})
    dated = sum(1 for r in results if r.get("founded"))
    people = sum(len(r.get("contacts") or []) for r in results)
    print(f"Done: {len(results)} businesses looked up, owner found for {found}, founding date for {dated}, {people} people.")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--state", choices=["FL", *SOCRATA_STATES])
    p.add_argument("--try", dest="try_name", help="look one business up and print the match (Socrata states)")
    p.add_argument("--city", default="")
    p.add_argument("--workdir", default=os.environ.get("RUNNER_TEMP", "."))
    p.add_argument("--daily-only", type=int, default=0, help="Florida test: read only the last N daily files")
    p.add_argument("--self-test", action="store_true", help="run the built-in examples (no network)")
    a = p.parse_args()
    if a.self_test:
        import doctest
        failed, tried = doctest.testmod()
        print(f"{tried - failed}/{tried} examples passed")
        sys.exit(1 if failed else 0)
    if not a.state:
        p.error("--state is required")
    if a.try_name:
        lead = {"id": "test", "name": a.try_name, "city": a.city, "zip": ""}
        r = pick(lead, socrata_records(a.state, lead)) if a.state != "FL" else None
        if r and a.state == "CT":
            r["officers"] = ct_principals(r["id"])
        print(json.dumps(result_for(lead, r, a.state), indent=1, default=list))
        return
    base = os.environ.get("LEAD_FINDER_URL", "https://lead-scraper.dev1-024.workers.dev")
    api = Api(base, os.environ.get("LEAD_FINDER_COLLECTOR_SECRET") or None)
    api.base = api.root + "/registry"
    try:
        if a.state == "FL":
            run_florida(api, a.workdir, a.daily_only)
        else:
            run_socrata(api, a.state)
    except Exception as e:  # noqa: BLE001
        msg = f"{a.state} owner look-up failed: {e.__class__.__name__}: {str(e)[:300]}"
        # A GitHub annotation (visible on the run page without signing in) and a note for the app.
        print(f"::error::{msg}", flush=True)
        try:
            api.post_json("/failed", {"state": a.state, "error": msg})
        except Exception:  # noqa: BLE001
            pass
        sys.exit(1)


if __name__ == "__main__":
    main()
