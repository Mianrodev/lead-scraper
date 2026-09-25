// "Find leads": the user picks categories and places; we reuse any recent pull of the
// same category + place and only pull (and pay for) the combinations we don't have.

import { stateCode, US_STATES } from "./format";
import { createSearch, findRecentPulls, ValidationError, type PreviousPull, type SearchRow } from "./pipeline";

/** Rough Apify cost per place returned (compass actor, free/bronze tier incl. start fees). */
export const COST_PER_PLACE_USD = 0.005;
/** Most category x place combinations one request may pull. */
export const MAX_COMBINATIONS = 25;

export interface FindLocation {
  /** Empty or missing = the whole state. */
  city?: string | null;
  state: string;
}

export interface FindRequest {
  categories: string[];
  locations: FindLocation[];
  maxResults?: number;
  sourceCode?: string | null;
  /** plan: only report; pull_missing: pull what we don't have; refresh_all: pull everything again. */
  mode?: "plan" | "pull_missing" | "refresh_all";
}

export interface Combination {
  category: string;
  city: string;
  state: string;
  /** Most recent pull of this combination within the repeat window, if any. */
  existing: PreviousPull | null;
  /** Pull started by this request. */
  started: SearchRow | null;
  error: string | null;
}

function clean(req: FindRequest) {
  const categories = [...new Map((req.categories ?? []).map((c) => [c.trim().toLowerCase(), c.trim()])).values()].filter(Boolean);
  const locations = [
    ...new Map(
      (req.locations ?? [])
        .map((l) => ({ city: (l.city ?? "").trim(), state: stateCode(l.state) ?? "" }))
        // Only real US states: an unknown one would still cost money at the scraper.
        .filter((l) => US_STATES.some((s) => s.code === l.state))
        .map((l) => [`${l.city.toLowerCase()}|${l.state}`, l]),
    ).values(),
  ];
  if (!categories.length) throw new ValidationError("Pick at least one type of business");
  if (!locations.length) throw new ValidationError("Pick at least one state or city");
  if (categories.length * locations.length > MAX_COMBINATIONS) {
    throw new ValidationError(
      `That's ${categories.length * locations.length} combinations; the limit is ${MAX_COMBINATIONS} per request. Narrow the categories or places.`,
    );
  }
  return { categories, locations };
}

export async function findLeads(env: Env, req: FindRequest) {
  const { categories, locations } = clean(req);
  const maxResults = req.maxResults ?? Number(env.MAX_RESULTS_DEFAULT);
  const mode = req.mode ?? "plan";

  const combinations: Combination[] = [];
  for (const category of categories) {
    for (const loc of locations) {
      const previous = await findRecentPulls(env, category, loc.city, loc.state);
      combinations.push({ category, city: loc.city, state: loc.state, existing: previous[0] ?? null, started: null, error: null });
    }
  }

  const toPull = mode === "refresh_all" ? combinations : combinations.filter((c) => !c.existing);
  if (mode !== "plan") {
    for (const c of toPull) {
      try {
        c.started = await createSearch(env, {
          category: c.category,
          city: c.city,
          state: c.state,
          maxResults,
          sourceCode: req.sourceCode,
          force: true, // the repeat decision was made here
        });
        if (c.started.status === "failed") c.error = c.started.error;
      } catch (err) {
        c.error = err instanceof Error ? err.message : String(err);
      }
    }
  }

  const searchIds = combinations.map((c) => c.started?.id ?? c.existing?.id).filter((id): id is string => !!id);
  return {
    mode,
    combinations,
    searchIds,
    alreadyHave: combinations.filter((c) => c.existing).length,
    needPull: combinations.filter((c) => !c.existing).length,
    maxResults,
    estimatedCostMissing: combinations.filter((c) => !c.existing).length * maxResults * COST_PER_PLACE_USD,
    estimatedCostAll: combinations.length * maxResults * COST_PER_PLACE_USD,
  };
}
