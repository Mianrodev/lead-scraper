"""Free tier collector: reads businesses from Overture Maps (open data, free) and sends them
to Lead Finder.

Runs on GitHub Actions (.github/workflows/free-collect.yml, started by Lead Finder) or on any
computer with Python:

    pip install duckdb
    set LEAD_FINDER_URL=https://lead-scraper.dev1-024.workers.dev
    set LEAD_FINDER_COLLECTOR_SECRET=<the collector secret>
    python scripts/overture_collect.py --import <import id>

Protocol (all requests carry "Authorization: Bearer <secret>"):
    GET  /api/free/collector/<id>/spec   -> {searches: [{id, categories[], place{...}}], minConfidence}
    POST /api/free/collector/<id>/chunk?search_id=..&n=..&rows=..   body: gzip NDJSON, one business per line
    POST /api/free/collector/<id>/done   {release, perSearch: {search_id: rows}}
    POST /api/free/collector/<id>/failed {error}

Also: `python scripts/overture_collect.py --list-categories` writes data/overture-categories-us.json.
"""

import argparse
import gzip
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request

# 250 = what Lead Finder saves per step, so each step reads only what it saves.
CHUNK_ROWS = 250
S3 = "s3://overturemaps-us-west-2/release/{release}/theme=places/type=place/*"


def latest_release() -> str:
    cat = json.load(urllib.request.urlopen("https://stac.overturemaps.org/catalog.json", timeout=30))
    rel = cat.get("latest")
    if rel:
        return rel
    kids = sorted(l["href"] for l in cat.get("links", []) if l.get("rel") == "child")
    return kids[-1].strip("./").split("/")[0]


def connect():
    import duckdb

    con = duckdb.connect()
    for s in ["INSTALL httpfs", "LOAD httpfs", "SET s3_region='us-west-2'"]:
        con.execute(s)
    return con


def github_oidc_token() -> str | None:
    """GitHub's signed pass for this workflow run (needs "permissions: id-token: write")."""
    url, bearer = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL"), os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN")
    if not url or not bearer:
        return None
    req = urllib.request.Request(url + "&audience=lead-finder", headers={"Authorization": f"bearer {bearer}"})
    return json.load(urllib.request.urlopen(req, timeout=30))["value"]


class Api:
    def __init__(self, base: str, secret: str | None, import_id: str | None = None):
        self.root = base.rstrip("/") + "/api/free/collector"
        self.base = self.root + (f"/{import_id}" if import_id else "")
        self._secret = secret
        self._oidc_at = 0.0
        self._oidc = None

    @property
    def secret(self) -> str:
        if self._secret:
            return self._secret
        # GitHub's passes are short-lived: fetch a fresh one every 4 minutes.
        if not self._oidc or time.time() - self._oidc_at > 240:
            self._oidc = github_oidc_token()
            self._oidc_at = time.time()
        if not self._oidc:
            sys.exit("No LEAD_FINDER_COLLECTOR_SECRET and not running on GitHub Actions.")
        return self._oidc

    def for_import(self, import_id: str) -> "Api":
        self.base = f"{self.root}/{import_id}"
        return self

    def call(self, method: str, path: str, body: bytes | None = None, ctype: str = "application/json", tries: int = 5):
        for attempt in range(tries):
            req = urllib.request.Request(self.base + path, data=body, method=method)
            req.add_header("Authorization", f"Bearer {self.secret}")
            req.add_header("Content-Type", ctype)
            req.add_header("User-Agent", "lead-finder-collector/1")
            try:
                with urllib.request.urlopen(req, timeout=120) as res:
                    text = res.read().decode("utf-8") or "{}"
                    return json.loads(text)
            except urllib.error.HTTPError as e:
                msg = e.read().decode("utf-8", "replace")[:300]
                if e.code < 500 and e.code != 429:
                    raise RuntimeError(f"Lead Finder said {e.code}: {msg}")
                wait = 5 * (attempt + 1)
                print(f"  Lead Finder busy ({e.code}); retrying in {wait}s", flush=True)
                time.sleep(wait)
            except urllib.error.URLError as e:
                wait = 5 * (attempt + 1)
                print(f"  network problem ({e}); retrying in {wait}s", flush=True)
                time.sleep(wait)
        raise RuntimeError(f"Lead Finder didn't answer after {tries} tries ({path})")

    def post_json(self, path: str, data: dict):
        return self.call("POST", path, json.dumps(data).encode("utf-8"))


def sql_list(values):
    return ", ".join("'" + str(v).replace("'", "''") + "'" for v in values)


def query_for(search: dict, release: str, min_conf: float) -> str:
    place = search["place"]
    cats = search["categories"]
    w, s, e, n = place["bbox"]
    where = [
        f"bbox.xmin BETWEEN {w} AND {e}",
        f"bbox.ymin BETWEEN {s} AND {n}",
        f"addresses[1].country = '{place['country']}'",
        f"(taxonomy.primary IN ({sql_list(cats)}) OR list_has_any(taxonomy.alternates, [{sql_list(cats)}]))",
        f"COALESCE(confidence, 0) >= {min_conf}",
    ]
    if place.get("regionCode"):
        where.append(f"addresses[1].region = '{place['regionCode']}'")
    if place.get("lat") is not None and place.get("radiusKm"):
        # Within radiusKm of the city centre (flat-earth distance is accurate at city scale).
        lat, lng, r = place["lat"], place["lng"], place["radiusKm"]
        k = 111.32
        kx = k * math.cos(math.radians(lat))
        where.append(f"(pow(((bbox.ymin + bbox.ymax) / 2 - {lat}) * {k}, 2) + pow(((bbox.xmin + bbox.xmax) / 2 - {lng}) * {kx}, 2)) <= {r * r}")
    return f"""
      SELECT id, names.primary AS name, taxonomy.primary AS category, taxonomy.alternates AS alternates, confidence,
             websites, phones, socials, emails, brand.names.primary AS brand,
             addresses[1].freeform AS street, addresses[1].locality AS city, addresses[1].region AS region,
             addresses[1].postcode AS postcode, addresses[1].country AS country,
             (bbox.ymin + bbox.ymax) / 2 AS lat, (bbox.xmin + bbox.xmax) / 2 AS lng, operating_status
      FROM read_parquet('{S3.format(release=release)}', hive_partitioning=1)
      WHERE {' AND '.join(where)}
    """


def collect(api: Api, release_override: str | None):
    spec = api.call("GET", "/spec")
    searches = spec.get("searches", [])
    if not searches:
        print("Nothing to collect.")
        api.post_json("/done", {"release": None, "perSearch": {}})
        return
    release = release_override or spec.get("release") or latest_release()
    min_conf = float(spec.get("minConfidence", 0.5))
    print(f"Overture release {release}; {len(searches)} search(es)", flush=True)
    api.post_json("/started", {"release": release, "runner": os.environ.get("LEAD_FINDER_RUNNER", "local")})
    con = connect()
    per_search = {}
    n = 0
    for search in searches:
        t = time.time()
        cur = con.execute(query_for(search, release, min_conf))
        cols = [d[0] for d in cur.description]
        total = 0
        while True:
            rows = cur.fetchmany(CHUNK_ROWS)
            if not rows:
                break
            lines = []
            for r in rows:
                rec = dict(zip(cols, r))
                # Lists come back as Python lists; keep just what Lead Finder stores.
                rec["phones"] = [p for p in (rec.get("phones") or []) if p][:3]
                rec["websites"] = [x for x in (rec.get("websites") or []) if x][:2]
                rec["socials"] = [x for x in (rec.get("socials") or []) if x][:6]
                rec["emails"] = [x for x in (rec.get("emails") or []) if x][:5]
                rec["alternates"] = [x for x in (rec.get("alternates") or []) if x][:5]
                lines.append(json.dumps(rec, default=str))
            body = gzip.compress(("\n".join(lines) + "\n").encode("utf-8"))
            api.call("POST", f"/chunk?search_id={search['id']}&n={n}&rows={len(rows)}", body, "application/gzip")
            n += 1
            total += len(rows)
        per_search[search["id"]] = total
        print(f"  {search.get('label', search['id'])}: {total} businesses ({time.time() - t:.0f}s)", flush=True)
    api.post_json("/done", {"release": release, "perSearch": per_search})
    print("Done.", flush=True)


def list_categories(out: str):
    release = latest_release()
    con = connect()
    rows = con.execute(f"""
      SELECT taxonomy.primary AS cat, any_value(basic_category) AS basic, any_value(array_to_string(taxonomy.hierarchy, '>')) AS hier, COUNT(*) AS n
      FROM read_parquet('{S3.format(release=release)}', hive_partitioning=1)
      WHERE bbox.xmin BETWEEN -125 AND -66 AND bbox.ymin BETWEEN 24 AND 50 AND addresses[1].country = 'US'
      GROUP BY 1 ORDER BY n DESC
    """).fetchall()
    json.dump([{"cat": r[0], "basic": r[1], "hier": r[2], "n": r[3]} for r in rows if r[0]], open(out, "w"), indent=0)
    print(f"{len(rows)} categories from release {release} -> {out}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--import", dest="import_id")
    ap.add_argument("--next", action="store_true", help="ask Lead Finder for the next waiting collection (scheduled runs)")
    ap.add_argument("--release")
    ap.add_argument("--list-categories", action="store_true")
    args = ap.parse_args()
    if args.list_categories:
        return list_categories("data/overture-categories-us.json")
    base = os.environ.get("LEAD_FINDER_URL", "https://lead-scraper.dev1-024.workers.dev")
    secret = os.environ.get("LEAD_FINDER_COLLECTOR_SECRET") or None
    api = Api(base, secret)
    import_id = args.import_id
    if args.next and not import_id:
        import_id = api.call("POST", "/next", b"{}").get("importId")
        if not import_id:
            print("Nothing waiting.")
            return
    if not import_id:
        ap.error("--import or --next is required")
    api.for_import(import_id)
    try:
        collect(api, args.release)
    except Exception as e:  # tell Lead Finder so the searches don't wait forever
        print(f"Failed: {e}", flush=True)
        try:
            api.post_json("/failed", {"error": str(e)[:500]})
        finally:
            sys.exit(1)


if __name__ == "__main__":
    main()
