// "Find leads": the user picks categories and places (any country); we reuse any recent
// pull of the same category + place and only pull (and pay for) what we don't have.
// Optionally asks DataForSEO how many such businesses exist, so big pulls are priced first.

import { cachedCount, COUNT_COST_USD, countBusinesses, type CountAnswer, type CountQuestion } from "./count";
import { assertWithinBudget, monthSpend } from "./ops";
import { stateCode } from "./format";
import { countryName, regionName } from "./geo";
import { createSearch, findRecentPulls, ValidationError, type PreviousPull, type SearchRow } from "./pipeline";
import { queuePhonesForSearches } from "./phone";

/** Rough Apify cost per place returned (compass actor, free/bronze tier incl. start fees). */
export const COST_PER_PLACE_USD = 0.005;
/**
 * Phone check cost per number with Telnyx (the paid provider). Free while Abstract's free
 * checks are being used, so plans show it as an upper bound.
 */
export const PHONE_CHECK_COST_USD = 0.0025;
/**
 * Most category x place combinations one request may handle. Each new one starts a scraper run
 * (one outside request) and Cloudflare's free plan allows 50 outside requests per request.
 */
export const MAX_COMBINATIONS = 40;
/** Most paid counts asked for in one "Check what's available" (the rest wait for the next check). */
const MAX_NEW_COUNTS = 40;

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
  /** Businesses this pull would likely return: the count (capped by "Up to"). Null = no count. */
  expected: number | null;
  /** Why this combination can't be collected right now (e.g. no count for "No limit"), or null. */
  blocked: string | null;
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
    // The scraper can't search the whole US in one go (it splits by state), so ask for states.
    if (!rName) throw new ValidationError("For the United States, pick one or more states (or cities). The whole country at once is too big for one search.");
    return {
      countryCode, countryName: "United States", state: code ?? "", regionName: rName, city,
      label: city ? `${city}, ${code}` : `all of ${rName}`,
    };
  }
  const rName = regionInput ? await regionName(env, countryCode, regionInput) : null;
  // A city whose region code we don't recognise is still searched, at country level.
  if (regionInput && !rName && !city) return null;
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
      `That's ${categories.length} types × ${raw.length} places = ${categories.length * raw.length} searches; the limit is ${MAX_COMBINATIONS} at once. Pick fewer types or places, or a whole state instead of many cities.`,
    );
  }
  const places = new Map<string, ResolvedPlace>();
  const unknown: string[] = [];
  for (const loc of raw) {
    // Only real places: an unknown one would still cost money at the scraper.
    const place = await resolvePlace(env, loc);
    if (place) places.set(`${place.countryCode}|${place.state}|${place.city.toLowerCase()}`, place);
    else unknown.push([loc.city, loc.region ?? loc.state, loc.country].filter(Boolean).join(", "));
  }
  if (!places.size) throw new ValidationError("Pick at least one country, state or city");
  return { categories, places: [...places.values()], unknown };
}

/** Verified, open businesses with a phone in an earlier pull that still need a phone check. */
async function uncheckedPhones(env: Env, searchId: string): Promise<number> {
  return (
    (await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM search_leads sl JOIN leads l ON l.id = sl.lead_id
       WHERE sl.search_id = ? AND l.gbp_phone_formatted IS NOT NULL AND l.phone_type IS NULL AND l.phone_check_requested = 0
         AND COALESCE(l.is_claimed, 1) = 1 AND l.business_status = 'operational'`,
    )
      .bind(searchId)
      .first<number>("n")) ?? 0
  );
}

export async function findLeads(env: Env, req: FindRequest) {
  const { categories, places, unknown } = await clean(env, req);
  const maxResults = req.maxResults ?? Number(env.MAX_RESULTS_DEFAULT);
  if (!Number.isInteger(maxResults) || maxResults < 0) throw new ValidationError("maxResults must be 0 (no limit) or a positive number");
  const mode = req.mode ?? "plan";
  const narrowed = !!req.countWebsite || req.countWithPhone === true || req.countVerifiedOnly === true;
  const ceiling = Number(env.MAX_RESULTS_CEILING) || 150_000;

  // Counting costs money: in "Check what's available" only, only within the budget, and only
  // up to MAX_NEW_COUNTS new questions at once. Collect re-uses the counts saved this week
  // (free), so Review and Collect always price the same way.
  let countBudget = 0;
  let countsSkipped: string | null = null;
  if (mode === "plan" && req.withCounts) {
    const left = (await monthSpend(env)).left;
    countBudget = Math.min(MAX_NEW_COUNTS, Math.floor(left / COUNT_COST_USD));
    if (countBudget <= 0) countsSkipped = "Counts were skipped: this month's budget is used up.";
  }
  const ask = async (q: CountQuestion): Promise<CountAnswer | null> => {
    const hit = await cachedCount(env, q);
    if (hit || mode !== "plan" || !req.withCounts) return hit;
    if (countBudget <= 0) {
      countsSkipped ??= `Only ${MAX_NEW_COUNTS} new counts are checked at a time. Press "Check what's available" again to count the rest.`;
      return { total: null, cached: false, costUsd: 0, error: countsSkipped };
    }
    countBudget--;
    return countBusinesses(env, q, req.createdBy);
  };

  const combinations: Combination[] = [];
  for (const category of categories) {
    for (const place of places) {
      const previous = await findRecentPulls(env, category, place.city, place.state, place.countryCode);
      const where = { category, country: place.countryCode, region: place.regionName, city: place.city || null };
      const count = req.withCounts || mode !== "plan"
        ? await ask({ ...where, website: req.countWebsite ?? null, withPhone: req.countWithPhone === true, verifiedOnly: req.countVerifiedOnly === true })
        : null;
      // The scraper collects everything for the search, not just the narrowed count, so the
      // pull is priced on the full number (a second count when the count is narrowed).
      const full = count == null ? null : narrowed ? await ask(where) : count;
      const known = full?.total ?? null;
      const existing = previous[0] ?? null;
      // With a count, the scraper is capped just above it (Google's numbers drift): that cap is
      // what can be charged, so it's what the budget checks. Without a count, "Up to" is the cap.
      const margin = known == null ? null : Math.min(ceiling, Math.ceil(known * 1.15) + 25);
      const pullCap = maxResults > 0 ? (margin == null ? maxResults : Math.min(maxResults, margin)) : margin;
      const expected = known == null ? null : maxResults > 0 ? Math.min(maxResults, known) : known;
      const blocked = pullCap == null
        ? req.withCounts || count?.error
          ? `Couldn't count these on Google${count?.error ? ` (${count.error.replace(/^Count failed: /, "")})` : ""}, so "No limit" can't be priced. Pick a number under "Up to" instead.`
          : `"No limit" needs a count first: turn on "Check how many exist on Google" under More options, or pick a number under "Up to".`
        : null;
      const pullCost = pullCap == null ? null : pullCap * COST_PER_PLACE_USD;
      // Phone checks: verified, open businesses with a phone. For a pull we reuse, the real number
      // still unchecked; for a new pull, at most what it returns (the narrowed count if narrower).
      const phoneChecks = !req.checkPhones
        ? 0
        : existing && mode !== "refresh_all"
          ? await uncheckedPhones(env, existing.id)
          : pullCap == null
            ? null
            : Math.min(pullCap, narrowed && count?.total != null ? count.total : pullCap);
      const phoneCost = phoneChecks == null ? null : phoneChecks * PHONE_CHECK_COST_USD;
      combinations.push({
        category, place, existing, count, expected, blocked, pullCap, pullCost, phoneChecks, phoneCost,
        estimatedCost: pullCost == null || phoneCost == null ? null : pullCost + phoneCost,
        started: null, error: null,
      });
    }
  }

  // Blocked combinations are left out of the totals (and of Collect), so one missing count
  // never stops the rest.
  const sum = (list: Combination[], key: "pullCost" | "phoneCost") => list.reduce((s, c) => s + (c[key] ?? 0), 0);
  const missing = combinations.filter((c) => !c.existing && !c.blocked);
  const refreshable = combinations.filter((c) => !c.blocked && c.existing?.status !== "scraping" && c.existing?.status !== "pending");
  const pullMissing = sum(missing, "pullCost");
  const pullAll = sum(refreshable, "pullCost");
  const phoneMissing = sum([...missing, ...combinations.filter((c) => c.existing)], "phoneCost");
  const phoneAll = sum(refreshable, "phoneCost");
  const phoneExisting = sum(combinations.filter((c) => c.existing), "phoneCost");
  // Nothing is spent unless the whole choice fits in what's left of this month's budget.
  if (mode !== "plan") {
    const planned = mode === "pull_missing" ? pullMissing + phoneMissing : mode === "refresh_all" ? pullAll + phoneAll : phoneExisting;
    await assertWithinBudget(env, planned, mode === "use_existing" ? "these phone checks" : "this search");
  }
  const toPull = mode === "refresh_all" ? refreshable : mode === "pull_missing" ? missing : [];
  if (mode !== "plan" && req.checkPhones) {
    // Phone types were asked for: switch checks on for the pulls we're reusing too, and queue them.
    const reused = combinations.filter((c) => c.existing && !toPull.includes(c)).map((c) => c.existing!.id);
    if (reused.length) {
      await env.DB.prepare(`UPDATE searches SET check_phones = 1 WHERE id IN (${reused.map(() => "?").join(", ")})`)
        .bind(...reused)
        .run();
      await queuePhonesForSearches(env, reused);
    }
  }
  if (mode === "pull_missing" || mode === "refresh_all") {
    for (const c of toPull) {
      try {
        c.started = await createSearch(env, {
          category: c.category,
          city: c.place.city,
          state: c.place.state || null,
          countryCode: c.place.countryCode,
          countryName: c.place.countryName,
          maxResults: c.pullCap!,
          allowLarge: true, // the user saw the plan and its cost before choosing to pull
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

  const counted = combinations.filter((c) => c.count?.total != null);
  return {
    mode,
    combinations,
    searchIds: combinations.map((c) => c.started?.id ?? c.existing?.id).filter((id): id is string => !!id),
    startedIds: combinations.map((c) => c.started?.id).filter((id): id is string => !!id),
    alreadyHave: combinations.filter((c) => c.existing).length,
    needPull: missing.length,
    blocked: combinations.filter((c) => c.blocked && !c.existing).length,
    unknownPlaces: unknown,
    maxResults,
    totalCount: req.withCounts && counted.length === combinations.length ? counted.reduce((s, c) => s + (c.count!.total ?? 0), 0) : null,
    countedSome: counted.length,
    countsSkipped,
    countCost: combinations.reduce((s, c) => s + (c.count?.costUsd ?? 0), 0),
    checkPhones: req.checkPhones === true,
    phoneChecks: combinations.some((c) => c.phoneChecks == null) ? null : combinations.reduce((s, c) => s + (c.phoneChecks ?? 0), 0),
    // Split so the page can show "collecting + phone checks = total" for each choice.
    expectedNew: missing.every((c) => c.expected != null) ? missing.reduce((s, c) => s + (c.expected ?? 0), 0) : null,
    estimatedPullMissing: pullMissing,
    estimatedPullAll: pullAll,
    estimatedPhoneCost: phoneMissing,
    estimatedCostMissing: pullMissing + phoneMissing,
    estimatedCostAll: pullAll + phoneAll,
    // "Use only what we have": no collecting, just phone checks on what we already have.
    estimatedCostExisting: phoneExisting,
    existingPhoneChecks: combinations.filter((c) => c.existing).reduce((s, c) => s + (c.phoneChecks ?? 0), 0),
    budget: await monthSpend(env),
  };
}