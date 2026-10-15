// Extra columns for the "For GoHighLevel" download, to fill the agency's own GHL custom fields
// (report link, grades, quick wins, opener, competitor...). The admin names each column the way
// their GHL custom field is called and picks what fills it; the list is kept in app_settings
// (key ghl_custom_columns). Values come from the same gradeReport as the public report, so the
// file and the report always say the same thing. Download only: nothing is sent to GHL.

import { gradeReport, parseSocials, type GradeInput, type LocalFacts, type ReportGrade } from "./grade";
import { buildOpener } from "./openers";
import { firstNameFrom } from "./emails";
import { builderName } from "./scoring";
import { sqlString } from "./leads";
import { ValidationError } from "./pipeline";
import { token, type AgencySettings } from "./report";

export const GHL_SOURCES = [
  { id: "report_link", label: "Report link" },
  { id: "overall_grade", label: "Overall grade" },
  { id: "overall_score", label: "Overall score" },
  { id: "google_grade", label: "Google profile grade" },
  { id: "reviews_grade", label: "Reviews grade" },
  { id: "website_grade", label: "Website grade" },
  { id: "ads_grade", label: "Ads & tracking grade" },
  { id: "social_grade", label: "Social grade" },
  { id: "top_quick_win", label: "Top quick win" },
  { id: "quick_wins", label: "Quick wins (all)" },
  { id: "opener", label: "AI opener (first line)" },
  { id: "summary", label: "What they do" },
  { id: "services", label: "Services" },
  { id: "owner_name", label: "Owner name" },
  { id: "owner_title", label: "Owner title" },
  { id: "top_competitor", label: "Top competitor" },
  { id: "review_gap", label: "Review gap" },
  { id: "rating", label: "Google rating" },
  { id: "review_count", label: "Review count" },
  { id: "social_pages", label: "Social pages" },
  { id: "builder", label: "Website platform" },
  { id: "stage", label: "Stage" },
  { id: "assigned", label: "Assigned to" },
] as const;
export type GhlSource = (typeof GHL_SOURCES)[number]["id"];
export interface GhlColumn { name: string; source: GhlSource }

export const DEFAULT_GHL_COLUMNS: GhlColumn[] = [
  { name: "Report Link", source: "report_link" },
  { name: "Overall Grade", source: "overall_grade" },
  { name: "Top Quick Win", source: "top_quick_win" },
  { name: "AI Opener", source: "opener" },
  { name: "Services", source: "services" },
  { name: "Top Competitor", source: "top_competitor" },
  { name: "Review Gap", source: "review_gap" },
];

export const MAX_GHL_COLUMNS = 30;
export const MAX_GHL_NAME = 60;
const SOURCE_IDS = new Set<string>(GHL_SOURCES.map((s) => s.id));

/** Checks a list from the Admin page; throws ValidationError with a plain-words reason. `taken` = the download's own column names. */
export function cleanGhlColumns(v: unknown, taken: readonly string[] = []): GhlColumn[] {
  const list = (v && typeof v === "object" && !Array.isArray(v) ? (v as { columns?: unknown }).columns : v);
  if (!Array.isArray(list)) throw new ValidationError("Send the columns as a list.");
  if (list.length > MAX_GHL_COLUMNS) throw new ValidationError(`Up to ${MAX_GHL_COLUMNS} columns.`);
  const seen = new Set(taken.map((t) => t.toLowerCase()));
  const own = new Set<string>();
  return list.map((row, i) => {
    const r = (row && typeof row === "object" ? row : {}) as { name?: unknown; source?: unknown };
    const name = typeof r.name === "string" ? r.name.replace(/\s+/g, " ").trim() : "";
    if (!name) throw new ValidationError(`Row ${i + 1}: type the GoHighLevel column name.`);
    if (name.length > MAX_GHL_NAME) throw new ValidationError(`Row ${i + 1}: the name is too long (up to ${MAX_GHL_NAME} characters).`);
    const key = name.toLowerCase();
    if (own.has(key)) throw new ValidationError(`“${name}” is in the list twice. Each column needs its own name.`);
    if (seen.has(key)) throw new ValidationError(`“${name}” is already a column in the download. Pick another name.`);
    own.add(key);
    if (typeof r.source !== "string" || !SOURCE_IDS.has(r.source)) throw new ValidationError(`Row ${i + 1}: pick what fills “${name}”.`);
    return { name, source: r.source as GhlSource };
  });
}

/** The saved columns, or the starter set when nothing was saved yet. */
export async function loadGhlColumns(env: Env): Promise<{ columns: GhlColumn[]; saved: boolean }> {
  const raw = await env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'ghl_custom_columns'`).first<string>("value");
  if (raw == null || raw === "") return { columns: DEFAULT_GHL_COLUMNS, saved: false };
  try {
    const list = JSON.parse(raw) as unknown;
    // Anything odd in the stored list (an old source name) is skipped, not fatal for downloads.
    const ok = Array.isArray(list) ? list.filter((c) => c && typeof c.name === "string" && c.name.trim() && SOURCE_IDS.has(c.source)) as GhlColumn[] : null;
    return ok ? { columns: ok.slice(0, MAX_GHL_COLUMNS), saved: true } : { columns: DEFAULT_GHL_COLUMNS, saved: false };
  } catch {
    return { columns: DEFAULT_GHL_COLUMNS, saved: false };
  }
}

export async function saveGhlColumns(env: Env, v: unknown, taken: readonly string[]): Promise<GhlColumn[]> {
  const columns = cleanGhlColumns(v, taken);
  await env.DB.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('ghl_custom_columns', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(JSON.stringify(columns)).run();
  return columns;
}

// ---------------------------------------------------------------------------------------
// Values

/** What one row needs (GradeInput plus the people and opener fields). */
export interface GhlLead extends GradeInput {
  id: string; report_token?: string | null; owner_name: string | null; owner_title?: string | null; ai_opener?: string | null;
  score_notes?: string | null; lead_status: string | null; assigned_to?: string | null;
}
export interface GhlRowContext {
  /** Public report link (empty when none could be made). */
  reportUrl: string;
  facts: LocalFacts | null;
  agency: AgencySettings | null;
  /** users.id -> name to show for "Assigned to". */
  people: Map<string, string>;
  /** First email, for the opener's "Hi {first name}". */
  email?: string;
  today?: Date;
}

/** Sources that need the grades (and so the local facts). */
const GRADE_SOURCES = new Set<GhlSource>(["opener", "overall_grade", "overall_score", "google_grade", "reviews_grade", "website_grade", "ads_grade", "social_grade",
  "top_quick_win", "quick_wins", "top_competitor", "review_gap"]);
export const needsGrades = (cols: GhlColumn[]) => cols.some((c) => GRADE_SOURCES.has(c.source));

function sectionGrade(g: ReportGrade, key: string): string {
  return g.sections.find((s) => s.key === key)?.grade ?? "";
}

/** "You: 12 reviews · area average: 48" (the business's own count is "not checked" for data without Google details). */
export function reviewGap(g: ReportGrade): string {
  const you = g.reviews ? `You: ${g.reviews.count.toLocaleString("en-US")} review${g.reviews.count === 1 ? "" : "s"}` : "You: not checked";
  const other = g.average?.avg_reviews != null ? `area average: ${Math.round(g.average.avg_reviews).toLocaleString("en-US")}`
    : g.competitors[0] ? `${g.competitors[0].name}: ${g.competitors[0].reviews.toLocaleString("en-US")}` : "";
  if (!other && !g.reviews) return "";
  return [you, other].filter(Boolean).join(" · ");
}

/** The cells for one business, in the order of `cols`. */
export function ghlValues(cols: GhlColumn[], l: GhlLead, ctx: GhlRowContext): string[] {
  const g = needsGrades(cols) ? gradeReport(l, ctx.facts, ctx.today) : null;
  let suggestions: string[] = [];
  try { suggestions = (l.score_notes ? JSON.parse(l.score_notes).suggestions : []) ?? []; } catch { suggestions = []; }
  const value = (s: GhlSource): string => {
    switch (s) {
      case "report_link": return ctx.reportUrl;
      case "overall_grade": return g?.overall?.grade ?? "";
      case "overall_score": return g?.overall ? String(g.overall.score) : "";
      case "google_grade": return g ? sectionGrade(g, "google") : "";
      case "reviews_grade": return g ? sectionGrade(g, "reviews") : "";
      case "website_grade": return g ? sectionGrade(g, "website") : "";
      case "ads_grade": return g ? sectionGrade(g, "ads") : "";
      case "social_grade": return g ? sectionGrade(g, "social") : "";
      case "top_quick_win": return g?.quickWins[0] ?? "";
      case "quick_wins": return g ? g.quickWins.join(" | ") : "";
      case "opener": {
        if (!ctx.agency) return (l.ai_opener ?? "").replace(/\s+/g, " ").trim();
        // Without an AI line, the opener names the same weakness the report leads with (same competitor, same numbers).
        const fromReport = !l.ai_opener && g?.topProblem ? `I was looking at ${l.business_name ?? "your business"} online and noticed ${/^(Only|No|Not|Your|Hard|Slow|Looks|Rated)\b/.test(g.topProblem) ? g.topProblem.charAt(0).toLowerCase() + g.topProblem.slice(1) : g.topProblem}.` : "";
        if (fromReport) return fromReport.replace(/\.\.$/, ".");
        return buildOpener({ business: l.business_name, ownerName: l.owner_name, firstNameFromEmail: ctx.email ? firstNameFrom(ctx.email) : "", city: l.city,
          category: l.gbp_category, suggestions, agency: ctx.agency, aiOpener: l.ai_opener }).firstLine;
      }
      case "summary": return (l.ai_summary ?? "").trim();
      case "services": return (l.ai_services ?? "").split(",").map((x) => x.trim()).filter(Boolean).join(", ");
      case "owner_name": return l.owner_name ?? "";
      case "owner_title": return l.owner_title ?? "";
      case "top_competitor": return g?.competitors[0]?.name ?? "";
      case "review_gap": return g ? reviewGap(g) : "";
      case "rating": return l.rating == null ? "" : String(l.rating);
      case "review_count": return l.review_count == null ? "" : String(l.review_count);
      case "social_pages": return parseSocials(l.socials).map((p) => p.name).join(", ");
      case "builder": return !l.builder ? "" : l.builder === "other" ? "Other" : builderName(l.builder);
      case "stage": return l.lead_status ?? "Untouched";
      case "assigned": return l.assigned_to ? (ctx.people.get(l.assigned_to) ?? "") : "";
    }
  };
  return cols.map((c) => value(c.source));
}

// ---------------------------------------------------------------------------------------
// Report links for a download

/** New report links made in one download, at most (each is a database write; later downloads reuse them). */
export const MAX_NEW_REPORT_LINKS = 5000;

/**
 * Report tokens for these businesses: existing ones are kept; the rest get a new random token
 * (same kind as "Share report"), 90 businesses per UPDATE, all in one batch, read back so a link
 * made at the same moment elsewhere wins. Returns id -> token (missing = none could be made).
 */
export async function ensureReportTokens(env: Env, rows: { id: string; report_token?: string | null }[], limit = MAX_NEW_REPORT_LINKS): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const need: string[] = [];
  for (const r of rows) {
    if (r.report_token) out.set(r.id, r.report_token);
    else if (!need.includes(r.id)) need.push(r.id);
  }
  const todo = need.slice(0, Math.max(0, limit));
  if (!todo.length) return out;
  const st: D1PreparedStatement[] = [];
  for (let i = 0; i < todo.length; i += 90) {
    const part = todo.slice(i, i + 90);
    const ids = part.map(sqlString).join(", ");
    st.push(env.DB.prepare(`UPDATE leads SET report_token = CASE id ${part.map((id) => `WHEN ${sqlString(id)} THEN '${token()}'`).join(" ")} END
      WHERE id IN (${ids}) AND report_token IS NULL`));
    st.push(env.DB.prepare(`SELECT id, report_token FROM leads WHERE id IN (${ids}) AND report_token IS NOT NULL`));
  }
  const res = await env.DB.batch<{ id: string; report_token: string }>(st);
  for (let i = 1; i < res.length; i += 2) for (const r of res[i].results) out.set(r.id, r.report_token);
  return out;
}
