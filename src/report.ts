// Audit report page: a one-page "online presence check" for a business, with the agency's
// contact details, to send as a link in an email or text. Public (no sign-in) at /r/<token>;
// the token is random and unguessable, and the page asks search engines not to index it.
// The grades (sections A-F, overall, quick wins) come from gradeReport in src/grade.ts.

import { GRADE_COLUMNS, gradeReport, localFactsFor, placeKey, type Grade, type GradeInput, type LocalFacts, type ReportGrade, type Section } from "./grade";
export { gradeReport } from "./grade";

export interface AgencySettings { name: string; phone: string; email: string; website: string; blurb: string }
export const AGENCY_KEYS = ["agency_name", "agency_phone", "agency_email", "agency_website", "agency_blurb"] as const;

/** What the report reads about a business (see GradeInput); the old stored scores are no longer shown. */
export interface LeadForReport extends GradeInput {
  presence_score?: number | null; gbp_score?: number | null; website_score?: number | null; score_notes?: string | null;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const GRADE_COLORS: Record<Grade, string> = { A: "#15803d", B: "#4d7c0f", C: "#b45309", D: "#c2410c", F: "#b91c1c" };
const GRADE_WORDS: Record<Grade, string> = { A: "Strong", B: "Good, with room to grow", C: "Average", D: "Needs work", F: "Needs attention" };

function badge(grade: Grade | null, big = false): string {
  const color = grade ? GRADE_COLORS[grade] : "#9aa3b2";
  return `<span class="badge${big ? " big" : ""}" style="background:${color}">${grade ?? "–"}</span>`;
}

const site = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");

function competitorTable(l: LeadForReport, g: ReportGrade): string {
  if (!g.competitors.length) return "";
  const you = g.reviews
    ? `<td>${g.reviews.rating != null && g.reviews.count ? `${esc(g.reviews.rating.toFixed(1))}★` : "–"}</td><td>${esc(g.reviews.count.toLocaleString("en-US"))}</td>`
    : `<td colspan="2" class="muted">Your Google rating: not checked</td>`;
  const rows = g.competitors.map((c) => `<tr><td>${esc(c.name)}</td><td>${c.rating != null ? `${esc(c.rating.toFixed(1))}★` : "–"}</td><td>${esc(c.reviews.toLocaleString("en-US"))}</td></tr>`).join("");
  return `<h3>You vs. top businesses near you</h3>
  <div class="tw"><table><thead><tr><th>Business</th><th>Rating</th><th>Reviews</th></tr></thead><tbody>
  <tr class="you"><td><b>${esc(l.business_name || "You")}</b> <span class="muted">(you)</span></td>${you}</tr>${rows}</tbody></table></div>
  ${g.average ? `<div class="muted small">Area average for ${esc(l.gbp_category ?? "businesses like yours")} in ${esc(l.city)}: ${g.average.avg_rating != null ? `${esc(g.average.avg_rating.toFixed(1))}★, ` : ""}${esc(Math.round(g.average.avg_reviews ?? 0).toLocaleString("en-US"))} reviews.</div>` : ""}`;
}

function sectionCard(l: LeadForReport, s: Section, g: ReportGrade): string {
  const head = `<div class="sh"><h2>${esc(s.title)}</h2><div class="sg">${s.status === "graded" ? `<span class="score">${s.score}/100</span>` : ""}${badge(s.grade)}</div></div>`;
  let body: string;
  if (s.status !== "graded") body = `<p class="muted">${esc(s.note || "Not checked yet.")}</p>`;
  else {
    const main = s.checks.filter((c) => c.ok || !c.minor);
    const notFound = s.checks.filter((c) => !c.ok && c.minor);
    body = `${s.note ? `<p class="muted small">${esc(s.note)}</p>` : ""}<ul class="checks">${main.map((c) => `<li class="${c.ok ? "ok" : "no"}">${esc(c.text)}</li>`).join("")}</ul>` +
      (notFound.length ? `<div class="muted small nf">Not found: ${esc(notFound.map((c) => c.text.replace(/^No (.*) (page|pixel) found$|^No (.*)$/, "$1$3")).join(", "))}</div>` : "");
  }
  if (s.key === "reviews") body += competitorTable(l, g);
  return `<section class="card" id="${s.key}">${head}${body}</section>`;
}

/** The report page (self-contained HTML, light theme, prints well). `facts` = local average and busiest nearby. */
export function renderReport(l: LeadForReport, agency: AgencySettings, today = new Date(), facts: LocalFacts | null = null): string {
  const g = gradeReport(l, facts, today);
  const where = [l.gbp_category, [l.city, l.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  const date = today.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const phone = agency.phone && `<a class="btn" href="tel:${esc(agency.phone.replace(/[^\d+]/g, ""))}">Call ${esc(agency.phone)}</a>`;
  const email = agency.email && `<a class="btn ghost" href="mailto:${esc(agency.email)}?subject=${encodeURIComponent(`Our online presence check${l.business_name ? ` (${l.business_name})` : ""}`)}">Email ${esc(agency.email)}</a>`;
  const web = agency.website && /^https?:\/\//i.test(agency.website) && `<a class="btn ghost" href="${esc(agency.website)}" rel="noopener">${esc(site(agency.website))}</a>`;
  const ctas = [phone, email, web].filter(Boolean).join("");
  const graded = g.sections.filter((s) => s.status === "graded").length;
  const summary = g.overall
    ? `${GRADE_WORDS[g.overall.grade]}. Based on ${graded} of ${g.sections.length} areas we checked.`
    : "We haven’t been able to check enough yet to give an overall grade.";
  const tiles = g.sections.map((s) => `<a class="tile" href="#${s.key}">${badge(s.grade)}<span><span class="k">${esc(s.title)}</span><span class="s">${s.status === "graded" ? `${s.score}/100` : s.status === "na" ? "Needs a website" : "Not checked yet"}</span></span></a>`).join("");
  const about = g.about.summary || g.about.services.length
    ? `<section class="card"><h2>About your business</h2>${g.about.summary ? `<p>${esc(g.about.summary)}</p>` : ""}${g.about.services.length ? `<div class="tags">${g.about.services.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}<p class="muted small">What we understood from your website. Something off? Tell us and we’ll fix it.</p></section>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Online presence check · ${esc(l.business_name)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1f2430; background: #f4f5f8; }
  main { max-width: 780px; margin: 0 auto; padding: 28px 16px 40px; }
  .card { background: #fff; border: 1px solid #e3e6ee; border-radius: 16px; padding: 20px 22px; margin-top: 16px; }
  h1 { font-size: 26px; margin: 0 0 4px; overflow-wrap: anywhere; } h2 { font-size: 18px; margin: 0; } h3 { font-size: 15px; margin: 16px 0 8px; }
  .muted { color: #6b7385; } .small { font-size: 13px; } p { margin: 8px 0; }
  .badge { display: inline-grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; color: #fff; font-weight: 800; font-size: 18px; flex: none; }
  .badge.big { width: 84px; height: 84px; border-radius: 20px; font-size: 46px; }
  .hero { display: flex; gap: 18px; align-items: center; }
  .hero .num { font-size: 22px; font-weight: 800; } .hero .num span { font-size: 14px; color: #6b7385; font-weight: 600; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-top: 16px; }
  .tile { display: flex; gap: 10px; align-items: center; border: 1px solid #e3e6ee; border-radius: 12px; padding: 10px; color: inherit; text-decoration: none; }
  .tile > span:last-child { display: flex; flex-direction: column; min-width: 0; }
  .k { font-size: 13px; font-weight: 700; } .s { font-size: 12px; color: #6b7385; }
  .sh { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 8px; }
  .sg { display: flex; align-items: center; gap: 10px; } .score { color: #6b7385; font-size: 13px; font-weight: 600; }
  ul.checks { margin: 0; padding: 0; list-style: none; }
  ul.checks li { padding: 6px 0 6px 28px; position: relative; border-top: 1px solid #f0f1f5; }
  ul.checks li:first-child { border-top: none; }
  ul.checks li.ok::before { content: "✓"; color: #15803d; position: absolute; left: 4px; font-weight: 800; }
  ul.checks li.no::before { content: "✗"; color: #b91c1c; position: absolute; left: 4px; font-weight: 800; }
  .nf { margin-top: 6px; }
  ol.wins { margin: 8px 0 0; padding-left: 22px; } ol.wins li { padding: 4px 0 4px 4px; }
  .tw { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 7px 8px; border-top: 1px solid #f0f1f5; } th { font-size: 12px; color: #6b7385; font-weight: 600; border-top: none; }
  td:nth-child(n+2), th:nth-child(n+2) { text-align: right; white-space: nowrap; }
  tr.you td { background: #f5f7ff; }
  .tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; } .tag { background: #eef1f8; border-radius: 999px; padding: 3px 10px; font-size: 13px; }
  .agency { background: #1f2a44; color: #fff; border: none; } .agency a { color: #fff; } .agency .muted { color: #c9cfdd; }
  .ctas { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .btn { display: inline-block; padding: 10px 16px; border-radius: 10px; background: #fff; color: #1f2a44 !important; font-weight: 700; text-decoration: none; }
  .btn.ghost { background: transparent; color: #fff !important; border: 1px solid #5b6787; }
  @media (max-width: 520px) { .hero { gap: 12px; } .badge.big { width: 64px; height: 64px; font-size: 34px; } h1 { font-size: 22px; } }
  @page { margin: 12mm; }
  @media print {
    body { background: #fff; font-size: 12.5px; } main { max-width: none; padding: 0; }
    .card { break-inside: avoid; border-color: #d5d9e3; margin-top: 10px; padding: 14px 16px; }
    .badge { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .agency { background: #fff; color: #1f2430; border: 1px solid #d5d9e3; } .agency a, .btn, .btn.ghost { color: #1f2430 !important; background: none; border: none; padding: 0 12px 0 0; }
    .agency .muted { color: #6b7385; } .tile { break-inside: avoid; }
  }
</style></head><body><main>
<div class="muted small">Online presence check · ${esc(date)}</div>
<h1>${esc(l.business_name)}</h1>
<div class="muted">${esc(where)}${l.website ? ` · ${esc(site(l.website))}` : ""}</div>
<section class="card"><div class="hero">${badge(g.overall?.grade ?? null, true)}<div><div class="k">Overall grade</div>
  <div class="num">${g.overall ? `${g.overall.score}<span>/100</span>` : "Not graded yet"}</div><div class="muted">${esc(summary)}</div></div></div>
  <div class="tiles">${tiles}</div></section>
${g.quickWins.length ? `<section class="card"><h2>Top ${g.quickWins.length === 1 ? "quick win" : `${g.quickWins.length} quick wins`}</h2><ol class="wins">${g.quickWins.map((w) => `<li>${esc(w)}</li>`).join("")}</ol></section>` : ""}
${g.sections.map((s) => sectionCard(l, s, g)).join("\n")}
${about}
<section class="card agency"><h2>${esc(agency.name || "We can help")}</h2>
  ${agency.blurb ? `<p>${esc(agency.blurb)}</p>` : `<p>We help local businesses get found online and turn visitors into customers.</p>`}
  <p class="muted">Want help with these quick wins? Get in touch for a free, no-pressure chat.</p>
  ${ctas ? `<div class="ctas">${ctas}</div>` : ""}</section>
<p class="muted small">Checked from public information${l.checked_at ? ` (website checked ${esc(l.checked_at.slice(0, 10))})` : ""}. “Not checked yet” means we haven’t looked, not that something is wrong. Prepared by ${esc(agency.name || "your local marketing team")}.</p>
</main></body></html>`;
}

/** A new random report token (32 hex characters). */
export function token(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** The business's report link token (created the first time). */
export async function ensureReportToken(env: Env, leadId: string): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT report_token FROM leads WHERE id = ?`).bind(leadId).first<{ report_token: string | null }>();
  if (!row) return null;
  if (row.report_token) return row.report_token;
  const t = token();
  await env.DB.prepare(`UPDATE leads SET report_token = ? WHERE id = ? AND report_token IS NULL`).bind(t, leadId).run();
  return (await env.DB.prepare(`SELECT report_token FROM leads WHERE id = ?`).bind(leadId).first<string>("report_token")) ?? t;
}

export async function agencySettings(env: Env): Promise<AgencySettings> {
  const { results } = await env.DB.prepare(`SELECT key, value FROM app_settings WHERE key IN (${AGENCY_KEYS.map((k) => `'${k}'`).join(", ")})`)
    .all<{ key: string; value: string }>();
  const v = Object.fromEntries(results.map((r) => [r.key, r.value ?? ""]));
  return { name: v.agency_name ?? "", phone: v.agency_phone ?? "", email: v.agency_email ?? "", website: v.agency_website ?? "", blurb: v.agency_blurb ?? "" };
}

export async function saveAgencySettings(env: Env, a: Partial<AgencySettings>) {
  const clip = (s: unknown, n: number) => (typeof s === "string" ? s.trim().slice(0, n) : "");
  const site = clip(a.website, 200);
  const values: Record<string, string> = {
    agency_name: clip(a.name, 100), agency_phone: clip(a.phone, 40), agency_email: clip(a.email, 120),
    agency_website: site && !/^https?:\/\//i.test(site) ? `https://${site}` : site, agency_blurb: clip(a.blurb, 600),
  };
  await env.DB.batch(Object.entries(values).map(([k, v]) => env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).bind(k, v)));
}

/** The report for a token (and the business's id, for view tracking), or null. */
export async function reportPage(env: Env, t: string): Promise<{ html: string; id: string } | null> {
  if (!/^[0-9a-f]{32}$/.test(t)) return null;
  const l = await env.DB.prepare(`SELECT ${GRADE_COLUMNS} FROM leads l LEFT JOIN website_audits a ON a.lead_id = l.id WHERE l.report_token = ?`)
    .bind(t).first<LeadForReport & { id: string }>();
  if (!l) return null;
  const place = { state: l.state, city: l.city, category: l.gbp_category };
  const key = placeKey(place);
  // Local average and busiest similar businesses: cached a day per city and type.
  const facts = key ? ((await localFactsFor(env, [place]).catch(() => null))?.get(key) ?? null) : null;
  return { html: renderReport(l, await agencySettings(env), new Date(), facts), id: l.id };
}

