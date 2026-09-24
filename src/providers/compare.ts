// Compares two sets of normalized business records: matches on Google place id
// first, then on the Google Maps listing id (CID) taken from the record or its Maps URL.

import type { NormalizedPlace } from "../normalize";

export interface SourceSummary {
  name: string;
  total: number;
  claimed: number;
  unclaimed: number;
  claimUnknown: number;
  withPhone: number;
  withWebsite: number;
}

export interface Comparison {
  a: SourceSummary;
  b: SourceSummary;
  matchedByPlaceId: number;
  matchedByMapsUrl: number;
  overlap: number;
  onlyInA: NormalizedPlace[];
  onlyInB: NormalizedPlace[];
  pairs: { a: NormalizedPlace; b: NormalizedPlace; matchedOn: "place_id" | "maps_url" }[];
}

/** Stable key for a Google Maps listing from its CID or Maps URL. */
export function mapsKey(place: NormalizedPlace): string | null {
  if (place.cid) return `cid:${place.cid}`;
  if (!place.gbp_url) return null;
  try {
    const url = new URL(place.gbp_url);
    const cid = url.searchParams.get("cid");
    if (cid) return `cid:${cid}`;
    const pid = url.searchParams.get("query_place_id") ?? url.searchParams.get("place_id");
    if (pid) return `pid:${pid}`;
  } catch {
    // not a URL
  }
  return null;
}

export function summarize(name: string, places: NormalizedPlace[]): SourceSummary {
  return {
    name,
    total: places.length,
    claimed: places.filter((p) => p.is_claimed === 1).length,
    unclaimed: places.filter((p) => p.is_claimed === 0).length,
    claimUnknown: places.filter((p) => p.is_claimed === null).length,
    withPhone: places.filter((p) => !!p.gbp_phone_formatted).length,
    withWebsite: places.filter((p) => !!p.website).length,
  };
}

/** De-duplicates by place id, keeping the first occurrence. */
export function uniqueByPlaceId(places: NormalizedPlace[]): NormalizedPlace[] {
  const seen = new Set<string>();
  return places.filter((p) => !seen.has(p.google_place_id) && !!seen.add(p.google_place_id));
}

export function compareSources(
  aName: string,
  aPlaces: NormalizedPlace[],
  bName: string,
  bPlaces: NormalizedPlace[],
): Comparison {
  const a = uniqueByPlaceId(aPlaces);
  const b = uniqueByPlaceId(bPlaces);
  const bByPlaceId = new Map(b.map((p) => [p.google_place_id, p]));
  const bByMapsKey = new Map<string, NormalizedPlace>();
  for (const p of b) {
    const key = mapsKey(p);
    if (key) bByMapsKey.set(key, p);
  }

  const pairs: Comparison["pairs"] = [];
  const matchedB = new Set<NormalizedPlace>();
  const onlyInA: NormalizedPlace[] = [];
  for (const p of a) {
    const byId = bByPlaceId.get(p.google_place_id);
    if (byId && !matchedB.has(byId)) {
      pairs.push({ a: p, b: byId, matchedOn: "place_id" });
      matchedB.add(byId);
      continue;
    }
    const key = mapsKey(p);
    const byUrl = key ? bByMapsKey.get(key) : undefined;
    if (byUrl && !matchedB.has(byUrl)) {
      pairs.push({ a: p, b: byUrl, matchedOn: "maps_url" });
      matchedB.add(byUrl);
      continue;
    }
    onlyInA.push(p);
  }

  return {
    a: summarize(aName, a),
    b: summarize(bName, b),
    matchedByPlaceId: pairs.filter((x) => x.matchedOn === "place_id").length,
    matchedByMapsUrl: pairs.filter((x) => x.matchedOn === "maps_url").length,
    overlap: pairs.length,
    onlyInA,
    onlyInB: b.filter((p) => !matchedB.has(p)),
    pairs,
  };
}
