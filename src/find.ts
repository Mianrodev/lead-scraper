// "Find leads": the user picks categories and places (any country); we reuse any recent
// pull of the same category + place and only pull (and pay for) what we don't have.
// Optionally asks DataForSEO how many such businesses exist, so big pulls are priced first.

import { countBusinesses, type CountAnswer } from "./count";
import { assertWithinBudget, monthSpend } from "./ops";
import { stateCode } from "./format";
import { countryName, regionName } from "./geo";
import { createSearch, findRecentPulls, ValidationError, type PreviousPull, type SearchRow } from "./pipeline";

/** Rough Apify cost per place returned (compass actor, free/bronze tier incl. start fees). */
export const COST_PER_PLACE_USD = 0.005;
/**
 * Phone check cost per number with Telnyx (the paid provider). Free while Abstract's free
 * checks are being used, so plans show it as an upper bound.
 */
export const PHONE_CHECK_COST_USD = 0.0025;
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
  /**
   * plan: report only; pull_missing: pull what we don't have; refresh_all: pull everything again;
   * use_existing: pull nothing, just use what we have (and start phone checks on it if asked).
   */
  mode?: "plan" | "pull_missing" | "refresh_all" | "use_existing";
  /** Ask DataForSEO how many exist (about 1 cent per combination, cached for a week). */
  withCounts?: boolean;
  /** Narrow the counts: only with / without a website, only with a phone number, only verified. */
  countWebsite?: "yes" | "no" | null;
  countWithPhone?: boolean;
  countVerifiedOnly?: boolean;
  /** Check phone types for the pulled businesses (uses phone-check credits). */
  checkPhones?: boolean;
  /** Signed-in user; set by the server, not the caller. */
  createdBy?: string | null;
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
  /**
   * Hard maximum sent to the scraper. With "no limit" it's the Google count plus a margin,
   * never unbounded; null when there's no usable count (then a no-limit pull is refused).
   */
  pullCap: number | null;
  /** Scraping cost for this combination (0 when we already have it). */
  pullCost: number | null;
  /** Phone checks this would need at most, and their cost with the paid provider. */
  phoneChecks: number | null;
  phoneCost: number | null;
  /** pullCost + phoneCost. */
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
      const where = { category, country: place.countryCode, region: place.regionName, city: place.city || null };
      const narrowed = !!req.countWebsite || req.countWithPhone === true || req.countVerifiedOnly === true;
      const count = req.withCounts
        ? await countBusinesses(env, {
            ...where,
            website: req.countWebsite ?? null,
            withPhone: req.countWithPhone === true,
            verifiedOnly: req.countVerifiedOnly === true,
          }, req.createdBy)
        : null;
      // The scraper collects everything for the search, not just the narrowed count, so the
      // pull is priced on the full number (a second, cached count when the count is narrowed).
      const full = !req.withCounts ? null : narrowed ? await countBusinesses(env, where, req.createdBy) : count;
      const known = full?.total ?? null;
      const expected = maxResults === 0 ? known : known == null ? maxResults : Math.min(maxResults, known);
      const existing = previous[0] ?? null;
      // Phone checks run on the pull's verified, open businesses with a phone: at most the
      // narrowed count (when it narrows to those) and at most what the pull returns.
      const phoneChecks = !req.checkPhones
        ? 0
        : existing && mode !== "refresh_all"
          ? existing.leads_in_database
          : expected == null
            ? null
            : Math.min(expected, narrowed && count?.total != null ? count.total : expected);
      // "No limit" still sends a hard cap: the count plus 15% (Google's numbers drift), within the ceiling.
      const ceiling = Number(env.MAX_RESULTS_CEILING) || 150_000;
      const pullCap = maxResults > 0 ? maxResults : known ? Math.min(ceiling, Math.ceil(known * 1.15) + 25) : null;
      // Priced on the cap, so the budget check covers the worst case.
      const pullCost = pullCap == null ? null : (maxResults > 0 ? (expected ?? pullCap) : pullCap) * COST_PER_PLACE_USD;
      const phoneCost = phoneChecks == null ? null : phoneChecks * PHONE_CHECK_COST_USD;
      combinations.push({
        category, place, existing, count, expected, pullCap, pullCost, phoneChecks, phoneCost,
        estimatedCost: pullCost == null || phoneCost == null ? null : pullCost + phoneCost,
        started: null, error: null,
      });
    }
  }

  const sum = (list: Combination[], key: "pullCost" | "phoneCost") =>
    list.some((c) => c[key] == null) ? null : list.reduce((s, c) => s + (c[key] ?? 0), 0);
  const plus = (a: number | null, b: number | null) => (a == null || b == null ? null : a + b);
  const missing = combinations.filter((c) => !c.existing);
  const pullMissing = sum(missing, "pullCost");
  const pullAll = sum(combinations, "pullCost");
  // Phone checks cover every combination: new pulls and the ones we reuse.
  const phoneAll = sum(combinations, "phoneCost");
  // Nothing is spent unless the whole plan fits in what's left of this month's budget.
  if (mode !== "plan") {
    const planned = mode === "pull_missing" ? plus(pullMissing, phoneAll)
      : mode === "refresh_all" ? plus(pullAll, phoneAll)
      : sum(combinations.filter((c) => c.existing), "phoneCost");
    await assertWithinBudget(env, planned, mode === "use_existing" ? "these phone checks" : "this pull");
  }
  const toPull = mode === "refresh_all" ? combinations : mode === "use_existing" ? [] : combinations.filter((c) => !c.existing);
  if (mode !== "plan" && req.checkPhones) {
    // Phone types were asked for: switch checks on for the pulls we're reusing too.
    const reused = combinations.filter((c) => c.existing && !toPull.includes(c)).map((c) => c.existing!.id);
    if (reused.length) {
      await env.DB.prepare(`UPDATE searches SET check_phones = 1 WHERE id IN (${reused.map(() => "?").join(", ")})`)
        .bind(...reused)
        .run();
    }
  }
  if (mode === "pull_missing" || mode === "refresh_all") {
    for (const c of toPull) {
      if (c.pullCap == null || c.pullCap <= 0) {
        c.error = maxResults === 0
          ? c.count?.total === 0
            ? "Google shows 0 of these here, so there's nothing to pull with No limit. Pick a number instead if you want to try anyway."
            : "No limit needs a count first. Tick \"Check how many exist\" and try again."
          : "Nothing to pull.";
        continue;
      }
      try {
        c.started = await createSearch(env, {
          category: c.category,
          city: c.place.city,
          state: c.place.state || null,
          countryCode: c.place.countryCode,
          countryName: c.place.countryName,
          maxResults: c.pullCap,
          allowLarge: true, // the user saw the plan and its cost before choosing to pull
          sourceCode: req.sourceCode,
          checkPhones: req.checkPhones === true,
          createdBy: req.createdBy ?? null,
          estimatedCost: c.pullCost,
          force: true, // the repeat decision was made here
        });
        if (c.started.status === "failed") c.error = c.started.error;
      } catch (err) {
        c.error = err instanceof Error ? err.message : String(err);
      }
    }
  }

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
    checkPhones: req.checkPhones === true,
    phoneChecks: combinations.some((c) => c.phoneChecks == null) ? null : combinations.reduce((s, c) => s + (c.phoneChecks ?? 0), 0),
    // Split so the page can show "pulling + phone checks = total" for each choice.
    estimatedPullMissing: pullMissing,
    estimatedPullAll: pullAll,
    estimatedPhoneCost: phoneAll,
    estimatedCostMissing: plus(pullMissing, phoneAll),
    estimatedCostAll: plus(pullAll, phoneAll),
    // "Use only what we have": no pulling, just phone checks on the pulls we already have.
    estimatedCostExisting: sum(combinations.filter((c) => c.existing), "phoneCost"),
    budget: await monthSpend(env),
  };
}
