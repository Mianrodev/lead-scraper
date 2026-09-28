// Website speed (Google PageSpeed Insights, mobile). Free with a Google API key
// (PAGESPEED_API_KEY, 25,000 checks a day); Google refuses requests without one, so nothing
// runs until the key is added. Sites that load are queued by the website check
// (website_audits.psi_status = 'queued'); the minute job measures a few at a time.

import { rescoreLeads } from "./scoring";

const PER_TICK = 4;

/** Only the two numbers we need, so the answer is tiny. */
const FIELDS = "lighthouseResult(categories/performance/score,audits/largest-contentful-paint/numericValue,runtimeError)";

export function parsePageSpeed(json: unknown): { score: number | null; lcpMs: number | null; error: string | null } {
  const lr = (json as { lighthouseResult?: Record<string, unknown> } | null)?.lighthouseResult as
    | { categories?: { performance?: { score?: unknown } }; audits?: Record<string, { numericValue?: unknown }>; runtimeError?: { message?: unknown } }
    | undefined;
  if (!lr) return { score: null, lcpMs: null, error: "No result from PageSpeed" };
  const raw = lr.categories?.performance?.score;
  const lcp = lr.audits?.["largest-contentful-paint"]?.numericValue;
  const score = typeof raw === "number" ? Math.round(raw * 100) : null;
  const error = score == null && typeof lr.runtimeError?.message === "string" ? lr.runtimeError.message.slice(0, 200) : null;
  return { score, lcpMs: typeof lcp === "number" ? Math.round(lcp) : null, error: score == null ? error ?? "PageSpeed couldn't measure this site" : null };
}

export function pageSpeedUrl(site: string, key: string): string {
  const q = new URLSearchParams({ url: site, strategy: "mobile", category: "performance", fields: FIELDS, key });
  return `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`;
}

/** Minute job: measures a few queued sites. Does nothing without a key. */
export async function pageSpeedStep(env: Env): Promise<{ done: number }> {
  const key = env.PAGESPEED_API_KEY;
  if (!key) return { done: 0 };
  const { results } = await env.DB.prepare(
    `SELECT a.lead_id, COALESCE(a.final_url, l.website) AS url FROM website_audits a JOIN leads l ON l.id = a.lead_id
     WHERE a.psi_status = 'queued' LIMIT ?`,
  ).bind(PER_TICK).all<{ lead_id: string; url: string }>();
  if (!results.length) return { done: 0 };
  const outcomes = await Promise.all(results.map(async (r) => {
    try {
      const res = await fetch(pageSpeedUrl(r.url, key), { signal: AbortSignal.timeout(60_000) });
      if (res.status === 429 || res.status >= 500) return { r, retry: true as const };
      const body = await res.json().catch(() => null);
      return { r, ...parsePageSpeed(res.ok ? body : null) };
    } catch {
      return { r, retry: true as const };
    }
  }));
  const done = outcomes.filter((o): o is Extract<typeof o, { score: number | null }> => !("retry" in o));
  if (done.length) {
    await env.DB.batch(done.map((o) => env.DB.prepare(
      `UPDATE website_audits SET psi_status = ?, psi_score = ?, psi_lcp_ms = ?, psi_error = ?, psi_checked_at = datetime('now') WHERE lead_id = ?`,
    ).bind(o.score == null ? "failed" : "done", o.score, o.lcpMs, o.error, o.r.lead_id)));
    await rescoreLeads(env, done.map((o) => o.r.lead_id));
  }
  return { done: done.length };
}
