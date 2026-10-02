"""
Lead Finder: company size (employee and revenue ranges) from the public SBA PPP loan records.

Runs on GitHub Actions next to the free collector. The first run streams the 13 national CSVs
(~5 GB, the final 2024 release, never changes) and keeps a compact copy of the loans in the
states below; GitHub's Actions cache keeps that copy, so the download happens once ever. Each
run then takes pages of businesses not checked yet from Lead Finder, matches them locally and
sends back the loan facts (jobs reported, loan amount, year, industry); Lead Finder turns those
into ranges (src/ppp.ts). Every business sent is marked checked, matched or not.

Matching is by name (ignoring LLC / Inc / punctuation, same as registry_owners.py) and ZIP,
then name and city; the business's registry name (and, for a trade name, the company that owns
it) is tried too. Standard library only.

    python scripts/ppp_match.py --states FL --workdir /tmp/ppp
    python scripts/ppp_match.py --self-test
    python scripts/ppp_match.py --try "Joe's Plumbing LLC" --zip 32901 --workdir /tmp/ppp
"""

from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import os
import re
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

STATES = ("FL",)  # add more here (and in PPP_STATES in src/ppp.ts); each state gets its own cached file
BASE = "https://data.sba.gov/sites/default/files/distribution/SBA-OCA-2022-07-001/"
FILES = ["public_150k_plus_240930.csv"] + [f"public_up_to_150k_{i}_240930.csv" for i in range(1, 13)]
REDACTED = {"", "EXEMPTION 6", "NOT AVAILABLE", "N/A", "NA", "NONE", "UNKNOWN"}
SUFFIXES = {"LLC", "L L C", "INC", "INCORPORATED", "CORP", "CORPORATION", "CO", "COMPANY", "LTD", "LIMITED", "LLP", "PLLC",
            "PA", "LC", "LP", "PLC", "THE", "DBA", "AND"}
CLAIM_PAGE = 2000
SEND_PAGE = 250
COLS = ("key", "zip", "city", "jobs", "loan", "year", "naics", "draw", "age", "address", "name")


def norm(name: str) -> str:
    """'The Joe's Plumbing & Drain, L.L.C.' -> 'JOES PLUMBING DRAIN' (registry_owners.norm, also dropping AND/&)."""
    s = (name or "").upper().replace("&", " AND ").replace("'", "").replace("’", "")
    s = re.sub(r"\bL\.?\s?L\.?\s?C\.?", " LLC ", s)
    s = re.sub(r"[^A-Z0-9]+", " ", s)
    return " ".join(w for w in s.split() if w not in SUFFIXES)


def zip5(z: str | None) -> str:
    m = re.match(r"\d{5}", (z or "").strip())
    return m.group(0) if m else ""


def city_key(c: str | None) -> str:
    return re.sub(r"[^A-Z]", "", (c or "").upper().replace("SAINT", "ST"))


def num(v: str) -> float:
    try:
        return float(v or 0)
    except ValueError:
        return 0.0


# ------------------------------------------------------------------------------------------
# The state subset (downloaded once, then cached)

def subset_path(workdir: str, state: str) -> str:
    return os.path.join(workdir, f"ppp_{state}.tsv.gz")


def stream_rows(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "lead-finder-ppp/1"})
    with urllib.request.urlopen(req, timeout=120) as res:
        yield from csv.DictReader(io.TextIOWrapper(res, encoding="utf-8", errors="replace", newline=""))


def row_out(r: dict) -> tuple | None:
    name = (r.get("BorrowerName") or "").strip()
    key = norm(name)
    if name.upper() in REDACTED or len(key) < 3:
        return None
    loan = num(r.get("CurrentApprovalAmount")) or num(r.get("InitialApprovalAmount"))
    year = (r.get("DateApproved") or "")[-4:]
    if loan <= 0 or year not in ("2020", "2021"):
        return None
    clean = lambda v: re.sub(r"[\t\r\n]+", " ", (v or "").strip())  # noqa: E731
    return (key, zip5(r.get("BorrowerZip")), city_key(r.get("BorrowerCity")), str(int(num(r.get("JobsReported")))),
            str(int(round(loan))), year, clean(r.get("NAICSCode")), clean(r.get("ProcessingMethod")),
            clean(r.get("BusinessAgeDescription")), clean(r.get("BorrowerAddress")), clean(name))


def build_subsets(workdir: str, states: list[str]):
    """Streams every national file once and writes one compact file per state (written whole at
    the end, so a cut-off download never leaves a partial file to be cached)."""
    want = [s for s in states if not os.path.exists(subset_path(workdir, s))]
    if not want:
        return
    os.makedirs(workdir, exist_ok=True)
    rows: dict[str, list[tuple]] = {s: [] for s in want}
    for f in FILES:
        started = time.time()
        for attempt in range(4):
            got: dict[str, list[tuple]] = {s: [] for s in want}
            n = 0
            try:
                for r in stream_rows(BASE + f):
                    n += 1
                    st = (r.get("BorrowerState") or "").strip().upper()
                    if st in got:
                        o = row_out(r)
                        if o:
                            got[st].append(o)
                break
            except Exception as e:  # noqa: BLE001  (a dropped connection: read the file again)
                if attempt == 3:
                    raise
                print(f"  {f}: {e.__class__.__name__}: {e}; reading it again", flush=True)
                time.sleep(15 * (attempt + 1))
        for s in want:
            rows[s] += got[s]
        print(f"  {f}: {n:,} loans read, kept {sum(len(v) for v in got.values()):,} in {time.time() - started:.0f}s", flush=True)
    for s in want:
        tmp = subset_path(workdir, s) + ".part"
        with gzip.open(tmp, "wt", encoding="utf-8", newline="") as out:
            for o in rows[s]:
                out.write("\t".join(o) + "\n")
        os.replace(tmp, subset_path(workdir, s))
        print(f"Saved {len(rows[s]):,} {s} loans.", flush=True)


class Index:
    """The state's loans by (name, ZIP) and (name, city)."""

    def __init__(self, records):
        self.by_zip: dict[tuple[str, str], list[dict]] = {}
        self.by_city: dict[tuple[str, str], list[dict]] = {}
        for rec in records:
            if rec["zip"]:
                self.by_zip.setdefault((rec["key"], rec["zip"]), []).append(rec)
            if rec["city"]:
                self.by_city.setdefault((rec["key"], rec["city"]), []).append(rec)

    @classmethod
    def load(cls, path: str) -> "Index":
        def recs():
            with gzip.open(path, "rt", encoding="utf-8", newline="") as fh:
                for line in fh:
                    p = line.rstrip("\n").split("\t")
                    if len(p) == len(COLS):
                        yield dict(zip(COLS, p))
        return cls(recs())

    def find(self, names: list[str], zip_code: str | None, city: str | None) -> list[dict]:
        z, c = zip5(zip_code), city_key(city)
        keys = [k for k in dict.fromkeys(norm(n) for n in names if n) if len(k) >= 3]
        for k in keys:
            if z and (k, z) in self.by_zip:
                return self.by_zip[(k, z)]
        for k in keys:
            if c and (k, c) in self.by_city:
                return self.by_city[(k, c)]
        return []


def names_for(lead: dict) -> list[str]:
    """The business's name, its registry name, and for a trade name the company that owns it."""
    out = [lead.get("name") or ""]
    reg = lead.get("registryName") or ""
    if reg:
        out.append(reg.split(" (")[0])
        m = re.search(r"\(trade name of (.+)\)\s*$", reg)
        if m:
            out.append(m.group(1))
    return out


def summarize(loans: list[dict]) -> dict | None:
    """First + second draw: the largest jobs count and the latest year; the largest loan's amount."""
    if not loans:
        return None
    biggest = max(loans, key=lambda r: int(r["loan"]))
    return {
        "jobs": max(int(r["jobs"] or 0) for r in loans),
        "loan": int(biggest["loan"]),
        "year": max(int(r["year"]) for r in loans),
        "naics": biggest["naics"] or None,
        "draw": biggest["draw"] if biggest["draw"] in ("PPP", "PPS") else None,
    }


def result_for(index: Index, lead: dict) -> dict:
    m = summarize(index.find(names_for(lead), lead.get("zip"), lead.get("city")))
    return {"id": lead["id"], "match": m} if m else {"id": lead["id"]}


# ------------------------------------------------------------------------------------------

def run_state(api, index: Index, state: str):
    after, total, matched = 0, 0, 0
    while True:
        page = api.post_json("/claim", {"state": state, "after": after, "limit": CLAIM_PAGE})
        items = page.get("items") or []
        if not items:
            break
        results = [result_for(index, l) for l in items]
        matched += sum(1 for r in results if r.get("match"))
        capped = False
        for i in range(0, len(results), SEND_PAGE):
            res = api.post_json("/results", {"results": results[i:i + SEND_PAGE]})
            total += int(res.get("saved") or 0)
            if res.get("capped"):
                capped = True
                break
        if capped or page.get("done"):
            break
        after = page["after"]
    print(f"{state}: {total} businesses checked, PPP loan found for {matched} of those sent.", flush=True)


def self_test():
    assert norm("The Joe's Plumbing & Drain, L.L.C.") == "JOES PLUMBING DRAIN", norm("The Joe's Plumbing & Drain, L.L.C.")
    assert norm("JOES PLUMBING AND DRAIN INC") == "JOES PLUMBING DRAIN"
    assert norm("Smith Co.") == "SMITH" and zip5("32901-1234") == "32901" and city_key("Saint Cloud") == "STCLOUD"
    hdr = "BorrowerName,BorrowerCity,BorrowerState,BorrowerZip,DateApproved,CurrentApprovalAmount,InitialApprovalAmount,JobsReported,NAICSCode,ProcessingMethod,BusinessAgeDescription,BorrowerAddress"
    lines = [
        "JOE'S PLUMBING LLC,Palm Bay,FL,32905-1111,04/30/2020,20000,20000,3,238220,PPP,Existing or more than 2 years old,1 Main St",
        "JOES PLUMBING LLC,PALM BAY,FL,32905,02/01/2021,25000,25000,4,238220,PPS,Existing or more than 2 years old,1 Main St",
        "Exemption 6,Miami,FL,33101,04/30/2020,5000,5000,1,,PPP,,",
        "JMS HOLDINGS INC,Melbourne,FL,32901,05/05/2020,0,90000,12,238220,PPP,,",
    ]
    recs = [row_out(r) for r in csv.DictReader(io.StringIO(hdr + "\n" + "\n".join(lines)))]
    assert recs[2] is None and recs[3][4] == "90000"
    idx = Index(dict(zip(COLS, r)) for r in recs if r)
    r = result_for(idx, {"id": "a", "name": "Joe's Plumbing", "zip": "32905", "city": "Palm Bay"})
    assert r["match"] == {"jobs": 4, "loan": 25000, "year": 2021, "naics": "238220", "draw": "PPS"}, r
    r = result_for(idx, {"id": "b", "name": "Joes Plumbing Inc", "zip": "", "city": "Palm Bay"})  # city fallback
    assert r["match"]["jobs"] == 4, r
    r = result_for(idx, {"id": "c", "name": "Joe's Plumbing", "zip": "33101", "city": "Miami"})  # other town
    assert "match" not in r, r
    r = result_for(idx, {"id": "d", "name": "Plumbing Pros", "zip": "32901", "city": "Melbourne",
                         "registryName": "PLUMBING PROS (trade name of JMS HOLDINGS INC)"})
    assert r["match"]["loan"] == 90000, r
    print("self-test ok")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--states", default=" ".join(STATES), help="space-separated states (default: %(default)s)")
    p.add_argument("--workdir", default=os.environ.get("RUNNER_TEMP", "."))
    p.add_argument("--self-test", action="store_true")
    p.add_argument("--try", dest="try_name")
    p.add_argument("--zip", default="")
    p.add_argument("--city", default="")
    a = p.parse_args()
    if a.self_test:
        self_test()
        return
    states = [s.strip().upper() for s in a.states.split() if s.strip().upper() in STATES]
    if a.try_name:
        idx = Index.load(subset_path(a.workdir, states[0]))
        print(json.dumps(result_for(idx, {"id": "test", "name": a.try_name, "zip": a.zip, "city": a.city}), indent=1))
        return
    from overture_collect import Api  # noqa: E402  (same sign-in as the free collector)

    base = os.environ.get("LEAD_FINDER_URL", "https://lead-scraper.dev1-024.workers.dev")
    api = Api(base, os.environ.get("LEAD_FINDER_COLLECTOR_SECRET") or None)
    api.base = api.root + "/ppp"
    try:
        build_subsets(a.workdir, states)
        for s in states:
            run_state(api, Index.load(subset_path(a.workdir, s)), s)
    except Exception as e:  # noqa: BLE001
        print(f"::error::PPP size look-up failed: {e.__class__.__name__}: {str(e)[:300]}", flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
