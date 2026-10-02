// Company size (employee and revenue RANGES, never exact figures) from the public SBA PPP loan
// records (2020-21), matched by the free collector on GitHub (scripts/ppp_match.py): it keeps a
// compact copy of a state's loans, takes pages of businesses not checked yet, and sends back the
// loan facts for each one it matched (or just the id when it didn't, so it's marked checked).
//
// No loan found: a labelled estimate from the Google review count when there is one, otherwise
// the size stays unknown. An estimate never replaces a PPP range.
//
// Writes are budgeted (D1 free plan): at most PPP_DAILY_CAP businesses are saved per day
// (override with app_settings 'ppp_daily_cap'); the claim hands out no more than what's left.

export const PPP_STATES = ["FL"] as const;
export const PPP_DAILY_CAP = 4000;
const MAX_PAGE = 2000;
const MAX_RESULTS = 1000;
const NUDGE_MINUTES = 15;

export interface SizeRange {
  employeesMin: number | null;
  employeesMax: number | null;
  revenueMin: number | null;
  revenueMax: number | null;
  sizeSource: "ppp" | "estimate";
  sizeYear: number | null;
}

/** Employee brackets; null max = open ("500+"). */
export const EMPLOYEE_BRACKETS: readonly [number, number | null][] = [
  [1, 4], [5, 9], [10, 19], [20, 49], [50, 99], [100, 249], [250, 499], [500, null],
];
/** Revenue bracket edges: <$250k, $250k-$500k, ..., $10M-$25M, $25M+. */
export const REVENUE_EDGES = [0, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000, 25_000_000] as const;

export function employeeBracket(n: number): { min: number; max: number | null } {
  const j = Math.max(1, Math.round(Number.isFinite(n) ? n : 1));
  for (const [min, max] of EMPLOYEE_BRACKETS) if (max === null || j <= max) return { min, max };
  return { min: 500, max: null };
}

/** The bracket range covering [low, high]: floor edge of low, ceiling edge of high (null = open top). */
export function revenueBrackets(low: number, high: number): { min: number; max: number | null } {
  const lo = Math.max(0, Math.min(low, high)), hi = Math.max(low, high, 0);
  let min = 0;
  for (const e of REVENUE_EDGES) if (e <= lo) min = e;
  const top = REVENUE_EDGES[REVENUE_EDGES.length - 1];
  if (hi > top || min === top) return { min, max: null };
  let max: number = REVENUE_EDGES.find((e) => e >= hi && e > min) ?? top;
  if (max <= min) max = REVENUE_EDGES.find((e) => e > min) ?? top;
  return { min, max };
}

export interface PppLoan {
  jobs: number;          // JobsReported (largest of the business's loans)
  loan: number;          // approved amount in dollars (largest loan)
  year: number;          // latest loan year (2020 or 2021)
  naics: string | null;  // industry code of that loan
  draw: "PPP" | "PPS" | null; // first draw (PPP) or second draw (PPS)
}

/**
 * PPP loan ≈ 2.5 × average monthly payroll (3.5 × for a second draw in food & lodging, NAICS 72),
 * so annual payroll ≈ loan × 4.8; payroll is ~25-40% of revenue for trades and services, so
 * revenue ≈ payroll × 2.5 to × 4, snapped to brackets.
 */
export function pppRanges(l: PppLoan): SizeRange {
  const e = employeeBracket(l.jobs);
  const months = l.draw === "PPS" && (l.naics ?? "").startsWith("72") ? 3.5 : 2.5;
  const payroll = l.loan * (12 / months);
  const r = revenueBrackets(payroll * 2.5, payroll * 4);
  return { employeesMin: e.min, employeesMax: e.max, revenueMin: r.min, revenueMax: r.max, sizeSource: "ppp", sizeYear: l.year };
}

/** No loan: estimate from the Google review count, or null (unknown) without one. */
export function estimateRanges(reviewCount: number | null | undefined): SizeRange | null {
  if (reviewCount === null || reviewCount === undefined || !Number.isFinite(reviewCount) || reviewCount < 0) return null;
  const emp = reviewCount < 20 ? 1 : reviewCount < 100 ? 5 : reviewCount < 400 ? 10 : 20;
  const e = employeeBracket(emp);
  const r = revenueBrackets(e.min * 100_000, (e.max ?? e.min) * 200_000);
  return { employeesMin: e.min, employeesMax: e.max, revenueMin: r.min, revenueMax: r.max, sizeSource: "estimate", sizeYear: null };
}

// ------------------------------------------------------------------------------------------
// The daily budget

const today = () => new Date().toISOString().slice(0, 10);

async function budget(env: Env): Promise<{ cap: number; used: number; left: number }> {
  const { results } = await env.DB.prepare(`SELECT key, value FROM app_settings WHERE key IN ('ppp_daily_cap', 'ppp_saved_today')`)
    .all<{ key: string; value: string }>();
  const v = Object.fromEntries(results.map((r) => [r.key, r.value]));
  const capSetting = Number(v.ppp_daily_cap);
  const cap = Number.isInteger(capSetting) && capSetting >= 0 && capSetting <= 50_000 ? capSetting : PPP_DAILY_CAP;
  const [day, n] = String(v.ppp_saved_today ?? "").split("|");
  const used = day === today() ? Math.max(0, Number(n) || 0) : 0;
  return { cap, used, left: Math.max(0, cap - used) };
}

const upsert = (env: Env, key: string, value: string) => env.DB.prepare(
  `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
).bind(key, value);

// ------------------------------------------------------------------------------------------
// The collector's side

/** States with businesses not checked yet (none once today's budget is spent). Uses idx_leads_ppp_todo. */
export async function pppWaiting(env: Env): Promise<string[]> {
  if ((await budget(env)).left <= 0) return [];
  const out: string[] = [];
  for (const st of PPP_STATES) {
    const any = await env.DB.prepare(`SELECT 1 AS x FROM leads WHERE state = ? AND ppp_checked_at IS NULL AND business_name IS NOT NULL LIMIT 1`).bind(st).first();
    if (any) out.push(st);
  }
  return out;
}

/** For nudgeChecker: work is waiting and the PPP job hasn't asked for any in a while. */
export async function pppNudgeNeeded(env: Env): Promise<boolean> {
  const seen = await env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'ppp_seen_at'`).first<string>("value");
  if (seen && Date.parse(seen.replace(" ", "T") + "Z") > Date.now() - NUDGE_MINUTES * 60_000) return false;
  return (await pppWaiting(env)).length > 0;
}

/** A page of businesses in `state` not checked yet (saving order, after `after`), at most what today's budget has left. */
export async function claimPpp(env: Env, state: string, after: number, limit: number) {
  if (!(PPP_STATES as readonly string[]).includes(state)) return { items: [], after, done: true, leftToday: 0 };
  await upsert(env, "ppp_seen_at", new Date().toISOString().slice(0, 19).replace("T", " ")).run();
  const { left } = await budget(env);
  if (left <= 0) return { items: [], after, done: true, leftToday: 0 };
  const take = Math.max(1, Math.min(MAX_PAGE, limit || MAX_PAGE, left));
  const { results } = await env.DB.prepare(
    `SELECT rowid AS rid, id, business_name AS name, registry_name AS registryName, city, postal_code AS zip, review_count AS reviewCount
     FROM leads WHERE state = ? AND ppp_checked_at IS NULL AND business_name IS NOT NULL AND rowid > ?
     ORDER BY rowid LIMIT ?`,
  ).bind(state, Math.max(0, Math.floor(after) || 0), take).all<{ rid: number; id: string; name: string; registryName: string | null; city: string | null; zip: string | null; reviewCount: number | null }>();
  return {
    items: results.map(({ rid: _r, ...x }) => x),
    after: results.length ? results[results.length - 1].rid : after,
    done: results.length < take || results.length >= left,
    leftToday: left,
  };
}

export interface PppResult { id: string; loan: PppLoan | null }

const int = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === "string" && v.trim() ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null;
};

/** One result from the collector, checked; bad loan facts count as "no match" (the business is still marked checked). */
export function sanitizePpp(v: unknown): PppResult | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  if (!id || id.length > 64 || !/^[\w-]+$/.test(id)) return null;
  const m = o.match && typeof o.match === "object" ? (o.match as Record<string, unknown>) : null;
  if (!m) return { id, loan: null };
  const jobs = int(m.jobs, 0, 10_000), loan = int(m.loan, 1, 10_000_000), year = int(m.year, 2020, 2021);
  if (jobs === null || loan === null || year === null) return { id, loan: null };
  const naics = typeof m.naics === "string" && /^\d{2,6}$/.test(m.naics.trim()) ? m.naics.trim() : null;
  const draw = m.draw === "PPP" || m.draw === "PPS" ? m.draw : null;
  return { id, loan: { jobs, loan, year, naics, draw } };
}

/** Saves sizes; every business sent (within today's budget) is marked as checked, matched or not. */
export async function savePppResults(env: Env, raw: unknown[]) {
  const seen = new Set<string>();
  const rows = raw.map(sanitizePpp).filter((r): r is PppResult => !!r && !seen.has(r.id) && !!seen.add(r.id)).slice(0, MAX_RESULTS);
  const b = await budget(env);
  const take = rows.slice(0, b.left);
  let saved = 0, matched = 0, estimated = 0;
  for (let i = 0; i < take.length; i += 90) {
    const chunk = take.slice(i, i + 90);
    const { results: found } = await env.DB.prepare(
      `SELECT id, review_count, size_source FROM leads WHERE id IN (${chunk.map(() => "?").join(", ")}) AND ppp_checked_at IS NULL`,
    ).bind(...chunk.map((r) => r.id)).all<{ id: string; review_count: number | null; size_source: string | null }>();
    const byId = new Map(found.map((f) => [f.id, f]));
    const st: D1PreparedStatement[] = [];
    for (const r of chunk) {
      const lead = byId.get(r.id);
      if (!lead) continue; // unknown, or already checked
      const size = r.loan ? pppRanges(r.loan) : lead.size_source === "ppp" ? null : estimateRanges(lead.review_count);
      if (size) {
        st.push(env.DB.prepare(
          `UPDATE leads SET employees_min = ?, employees_max = ?, revenue_min = ?, revenue_max = ?, size_source = ?, size_year = ?,
             ppp_checked_at = datetime('now')
           WHERE id = ? AND (? = 'ppp' OR COALESCE(size_source, '') <> 'ppp')`,
        ).bind(size.employeesMin, size.employeesMax, size.revenueMin, size.revenueMax, size.sizeSource, size.sizeYear, r.id, size.sizeSource));
        if (size.sizeSource === "ppp") matched++; else estimated++;
      } else {
        st.push(env.DB.prepare(`UPDATE leads SET ppp_checked_at = datetime('now') WHERE id = ?`).bind(r.id));
      }
      saved++;
    }
    if (st.length) await env.DB.batch(st);
  }
  if (saved) await upsert(env, "ppp_saved_today", `${today()}|${b.used + saved}`).run();
  return { saved, matched, estimated, capped: rows.length > take.length, leftToday: Math.max(0, b.left - saved) };
}
