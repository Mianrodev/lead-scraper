// "Find leads": the user picks categories and places (any country); we reuse any recent
// pull of the same category + place and only pull (and pay for) what we don't have.
// Optionally asks DataForSEO how many such businesses exist, so big pulls are priced first.

import { countBusinesses, type CountAnswer } from "./count";
import { stateCode } from "./format";
import { countryName, regionName } from "./geo";
import { createSearch, findRecentPulls, ValidationError, type PreviousPull, type SearchRow } from "./pipeline";

/** Rough Apify cost per place returned (compass actor, free/bronze tier incl. start fees). */
export const COST_PER_PLACE_USD = 0.005;
/** Most category x place combinations one request may handle. */
export const MAX_COMBINATIONS = 100;

export interface FindLocation {
  /** ISO country code; default "US". */
  country?: string | null;
  /** GeoNames region code ("FL", "16"); US also accepts a state name. Missing = whole country. */
  region?: string | null;
  /** Older callers send `state` instead of `region`. */
  state?: string | null;
  /** Missing = whole region. */
  city?: string | null;
}

export interface FindRequest {
  categories: string[];
  locations: FindLocation[];
  /** 0 = no limit. */
  maxResults?: number;
  sourceCode?: string | null;
  /** plan: report only; pull_missing: pull what we don't have; refresh_all: pull everything again. */
  mode?: "plan" | "pull_missing" | "refresh_all";
  /** Ask DataForSEO how many exist (about 1 cent per combination, cached for a week). */
  withCounts?: boolean;
  /** Narrow the counts: only with / without a website, only verified. */
  countWebsite?: "yes" | "no" | null;
  countVerifiedOnly?: boolean;
  /** Check phone types for the pulled businesses (uses phone-check credits). */
  checkPhones?: boolean;
}

export interface ResolvedPlace {
  countryCode: string;
  countryName: string;
  /** What the pull stores as `state`: US state code, or the region name elsewhere; "" = whole country. */
  state: string;
  /** Readable region name ("Florida", "Maharashtra"), or null for a whole country. */
  regionName: string | null;
  city: string;
  label: string;
}

export interface Combination {
  category: string;
  place: ResolvedPlace;
  existing: PreviousPull | null;
  count: CountAnswer | null;
  /** Businesses this pull would return: the cap, or the count when smaller / no cap. Null = unknown. */
  expected: number | null;
  estimatedCost: number | null;
  started: SearchRow | null;
  error: string | null;
}

async function resolvePlace(env: Env, loc: FindLocation): Promise<ResolvedPlace | null> {
  const countryCode = (loc.country?.trim() || "US").toUpperCase();
  const cName = await countryName(env, countryCode);
  if (!cName) return null;
  const regionInput = (loc.region ?? loc.state ?? "").trim();
  const city = (loc.city ?? "").trim();
  if (countryCode === "US") {
    const code = regionInput ? stateCode(regionInput) : null;
    const rName = code ? await regionName(env, "US", code) : null;
    if (regionInput && !rName) return null;
    return {
      countryCode, countryName: "United States", state: code ?? "", regionName: rName, city,
      label: city ? `${city}, ${code}` : rName ? `all of ${rName}` : "all of the United States",
    };
  }
  const rName = regionInput ? await regionName(env, countryCode, regionInput) : null;
  if (regionInput && !rName) return null;
  return {
    countryCode, countryName: cName, state: rName ?? "", regionName: rName, city,
    label: city ? `${city}, ${rName ?? cName}` : rName ? `all of ${rName}, ${cName}` : `all of ${cName}`,
  };
}

async function clean(env: Env, req: FindRequest) {
  const categories = [...new Map((req.categories ?? []).map((c) => [c.trim().toLowerCase(), c.trim()])).values()].filter(Boolean);
  if (!categories.length) throw new ValidationError("Pick at least one type of business");
  const raw = req.locations ?? [];
  if (!raw.length) throw new ValidationError("Pick at least one country, state or city");
  if (categories.length * raw.length > MAX_COMBINATIONS) {
    throw new ValidationError(
      `That's ${categories.length * raw.length} combinations; the limit is ${MAX_COMBINATIONS} per request. Pick fewer types or places, or search a whole state instead of many cities.`,
    );
  }
  const places = new Map<string, ResolvedPlace>();
  for (const loc of raw) {
    // Only real places: an unknown one would still cost money at the scraper.
    const place = await resolvePlace(env, loc);
    if (place) places.set(`${place.countryCode}|${place.state}|${place.city.toLowerCase()}`, place);
  }
  if (!places.size) throw new ValidationError("Pick at least one country, state or city");
  return { categories, places: [...places.values()] };
}

export async function findLeads(env: Env, req: FindRequest) {
  const { categories, places } = await clean(env, req);
  const maxResults = req.maxResults ?? Number(env.MAX_RESULTS_DEFAULT);
  if (!Number.isInteger(maxResults) || maxResults < 0) throw new ValidationError("maxResults must be 0 (no limit) or a positive number");
  const mode = req.mode ?? "plan";

  const combinations: Combination[] = [];
  for (const category of categories) {
    for (const place of places) {
      const previous = await findRecentPulls(env, category, place.city, place.state, place.countryCode);
      const count = req.withCounts
        ? await countBusinesses(env, {
            category,
            country: place.countryCode,
            region: place.regionName,
            city: place.city || null,
            website: req.countWebsite ?? null,
            verifiedOnly: req.countVerifiedOnly === true,
          })
        : null;
      // The pull itself isn't narrowed by the count filters, so price it on the unfiltered size when known.
      const known = count?.total ?? null;
      const expected = maxResults === 0 ? known : known == null ? maxResults : Math.min(maxResults, known);
      combinations.push({
        category, place, existing: previous[0] ?? null, count, expected,
        estimatedCost: expected == null ? null : expected * COST_PER_PLACE_USD,
        started: null, error: null,
      });
    }
  }

  const toPull = mode === "refresh_all" ? combinations : combinations.filter((c) => !c.existing);
  if (mode !== "plan") {
    for (const c of toPull) {
      try {
        c.started = await createSearch(env, {
          category: c.category,
          city: c.place.city,
          state: c.place.state || null,
          countryCode: c.place.countryCode,
          countryName: c.place.countryName,
          maxResults,
          allowLarge: true, // the user saw the plan and its cost before choosing to pull
          sourceCode: req.sourceCode,
          checkPhones: req.checkPhones === true,
          force: true, // the repeat decision was made here
        });
        if (c.started.status === "failed") c.error = c.started.error;
      } catch (err) {
        c.error = err instanceof Error ? err.message : String(err);
      }
    }
  }

  const sum = (list: Combination[]) =>
    list.some((c) => c.estimatedCost == null) ? null : list.reduce((s, c) => s + (c.estimatedCost ?? 0), 0);
  const missing = combinations.filter((c) => !c.existing);
  return {
    mode,
    combinations,
    searchIds: combinations.map((c) => c.started?.id ?? c.existing?.id).filter((id): id is string => !!id),
    alreadyHave: combinations.length - missing.length,
    needPull: missing.length,
    maxResults,
    totalCount: req.withCounts && combinations.every((c) => c.count?.total != null)
      ? combinations.reduce((s, c) => s + (c.count!.total ?? 0), 0)
      : null,
    countCost: combinations.reduce((s, c) => s + (c.count?.costUsd ?? 0), 0),
    estimatedCostMissing: sum(missing),
    estimatedCostAll: sum(combinations),
  };
}
