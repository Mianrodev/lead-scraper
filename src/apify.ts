import sampleDataset from "./fixtures/sample-dataset.json";

const API_BASE = "https://api.apify.com/v2";

export type ApifyRunStatus =
  | "READY"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "ABORTING"
  | "ABORTED"
  | "TIMING-OUT"
  | "TIMED-OUT";

export const TERMINAL_FAILURE_STATUSES: ApifyRunStatus[] = ["FAILED", "ABORTED", "TIMED-OUT"];

export interface ApifyRun {
  id: string;
  status: ApifyRunStatus;
  defaultDatasetId: string;
  statusMessage?: string;
  usageTotalUsd?: number;
}

export interface ScrapeRequest {
  category: string;
  /** e.g. "Orlando, FL, USA" */
  location: string;
  /** 0 = no limit: collect everything Google has for this search and area. */
  maxResults: number;
}

// Each supported actor takes a differently shaped input. Output fields are
// reconciled in normalize.ts.
const INPUT_BUILDERS: Record<string, (req: ScrapeRequest) => Record<string, unknown>> = {
  "scraperlink~google-maps-scraper": (req) => ({
    query: [req.category],
    location: req.location,
    ...(req.maxResults > 0 ? { num: req.maxResults } : {}),
    gl: "us",
    hl: "en",
  }),
  // compass splits a large locationQuery (a state or a whole country) into smaller map
  // areas itself; leaving maxCrawledPlacesPerSearch out means "everything".
  "compass~crawler-google-places": (req) => ({
    searchStringsArray: [req.category],
    locationQuery: req.location,
    ...(req.maxResults > 0 ? { maxCrawledPlacesPerSearch: req.maxResults } : {}),
    language: "en",
  }),
};

export function buildActorInput(actorId: string, req: ScrapeRequest): Record<string, unknown> {
  const build = INPUT_BUILDERS[actorId];
  if (!build) {
    throw new Error(
      `No input builder for actor "${actorId}". Supported: ${Object.keys(INPUT_BUILDERS).join(", ")}`,
    );
  }
  return build(req);
}

function isMock(env: Env): boolean {
  return env.APIFY_MOCK === "1";
}

async function apifyFetch<T>(env: Env, path: string, init?: RequestInit): Promise<T> {
  if (!env.APIFY_API_TOKEN) throw new Error("APIFY_API_TOKEN is not set");
  const res = await fetch(`${API_BASE}${path}`, {
    // A hung request would otherwise hold the sync step until Cloudflare kills it.
    signal: AbortSignal.timeout(30_000),
    ...init,
    headers: {
      Authorization: `Bearer ${env.APIFY_API_TOKEN}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Apify ${init?.method ?? "GET"} ${path} failed: ${res.status} ${body.slice(0, 500)}`);
  }
  return res.json<T>();
}

export async function startRun(env: Env, actorId: string, req: ScrapeRequest): Promise<ApifyRun> {
  if (isMock(env)) {
    return { id: `mock-run-${crypto.randomUUID()}`, status: "RUNNING", defaultDatasetId: "mock-dataset" };
  }
  const input = buildActorInput(actorId, req);
  // maxItems caps billable results on pay-per-result actors, so a mistyped broad
  // search can't run past the requested cap. No cap when the user chose "no limit".
  const params = new URLSearchParams(req.maxResults > 0 ? { maxItems: String(req.maxResults) } : {});
  const { data } = await apifyFetch<{ data: ApifyRun }>(
    env,
    `/acts/${encodeURIComponent(actorId)}/runs?${params}`,
    { method: "POST", body: JSON.stringify(input) },
  );
  return data;
}

export async function getRun(env: Env, runId: string): Promise<ApifyRun> {
  if (isMock(env)) {
    return { id: runId, status: "SUCCEEDED", defaultDatasetId: "mock-dataset", usageTotalUsd: 0 };
  }
  const { data } = await apifyFetch<{ data: ApifyRun }>(env, `/actor-runs/${encodeURIComponent(runId)}`);
  return data;
}

export async function getDatasetItems(
  env: Env,
  datasetId: string,
  offset: number,
  limit: number,
): Promise<Record<string, unknown>[]> {
  if (isMock(env)) {
    return (sampleDataset as Record<string, unknown>[]).slice(offset, offset + limit);
  }
  const params = new URLSearchParams({
    clean: "true",
    format: "json",
    offset: String(offset),
    limit: String(limit),
  });
  return apifyFetch<Record<string, unknown>[]>(env, `/datasets/${encodeURIComponent(datasetId)}/items?${params}`);
}
