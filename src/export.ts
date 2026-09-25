// CSV export matching the team's sales-ready sheet (Miami_10k_Online_Presence_Audited_Sales_Ready.xlsx):
// 49 columns, including 7 online-presence audit columns filled by AI in Phase 2.
// Uses the same filters as the dashboard (buildLeadQuery), streams page by page, no row cap.

import { stateName } from "./format";
import { buildLeadQuery, resolveFilters, sqlString } from "./leads";

/** The AI audit columns (Phase 2). Only the no-website case is filled today. */
export const AUDIT_COLUMNS = [
  "Website Ranking", "Website Comment", "Website Score", "GBP Score", "GBP Comment", "Overall Online Presence Score", "Suggestions",
] as const;

export const CSV_COLUMNS = [
  "Business Name", "Business Name (Lead Name)", "GBP Category", "Lead Category", "Sub-Category",
  "GBP Phone", "GBP Phone (Phone)", "Phone Type", "Website",
  ...AUDIT_COLUMNS,
  "Owner", "Email", "Mobile 1",
  "GBP URL", "GBP Rank", "Rating on GBP", "Reviews on GBP", "Address", "City", "State", "Country",
  "Socials", "Logo URL", "Email 1", "Email 2", "Email 3", "Email 4", "Email 5",
  "Phone 1", "Phone 1 Type", "Phone 2", "Phone 2 Type", "Phone 3", "Phone 3 Type",
  "Phone 4", "Phone 4 Type", "Phone 5", "Phone 5 Type",
  "Lead Source", "Source Code", "Lead Status", "Lead Date", "Lead Date & Time",
] as const;

const PAGE = 500;

// Phone type words as the sheet uses them. Numbers not checked yet are left blank.
const TYPE_WORDS: Record<string, string> = {
  mobile: "mobile", landline: "landline", toll_free: "toll_free", voip: "voip", unknown: "unknown",
};

/** "+14076053803" -> "1407-605-3803" (the sheet's GBP Phone style). Non-US numbers: digits with country code. */
export function sheetPhone(e164: string | null, raw: string | null): string {
  const digits = (e164 ?? raw ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `1${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  return digits;
}

/** "+13058562923" -> "(305) 856-2923" (the sheet's Phone 1-5 / Mobile 1 style). Non-US: "+<digits>". */
export function nationalPhone(e164: string | null, raw: string | null): string {
  const digits = (e164 ?? raw ?? "").replace(/\D/g, "");
  const us = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits.length === 10 && !e164 ? digits : null;
  if (us) return `(${us.slice(0, 3)}) ${us.slice(3, 6)}-${us.slice(6)}`;
  return digits ? `+${digits}` : "";
}

/** US state codes become full names ("FL" -> "Florida"), as in the sheet. */
function sheetState(state: string | null, country: string | null): string {
  if (!state) return "";
  return country === "USA" || country === "US" || !country ? (stateName(state) ?? state) : state;
}

export function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  // Excel / Sheets run cells starting with = + - @ (or tab / CR) as formulas. Scraped text
  // like a business called "=HYPERLINK(...)" is made plain text; phone numbers are left alone.
  if (/^[=+\-@\t\r]/.test(s) && !/^\+?[\d\s().-]+$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

interface LeadRow {
  id: string;
  business_name: string | null;
  /** Sector, e.g. "Home Services" (the sheet's GBP Category / Lead Category). */
  industry: string | null;
  cid: string | null;
  /** Google's own category, e.g. "Plumber" (the sheet's Sub-Category). */
  gbp_category: string | null;
  lead_category: string | null;
  sub_category: string | null;
  gbp_phone_raw: string | null;
  gbp_phone_formatted: string | null;
  phone_type: string | null;
  website: string | null;
  owner_name: string | null;
  gbp_url: string | null;
  gbp_rank: number | null;
  rating: number | null;
  review_count: number | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  socials: string | null;
  logo_url: string | null;
  lead_source: string | null;
  source_code: string | null;
  lead_status: string | null;
  lead_date: string | null;
  lead_datetime: string | null;
}

export function leadToCsvRow(
  l: LeadRow,
  emails: string[],
  phones: { phone: string; phone_type: string | null }[],
): string[] {
  const gbpPhone = sheetPhone(l.gbp_phone_formatted, l.gbp_phone_raw);
  const gbpType = l.phone_type ? (TYPE_WORDS[l.phone_type] ?? "") : "";
  // Phone 1-5: numbers found on the website (Phase 2); until then Phone 1 is the Google number.
  const allPhones = phones.length || !gbpPhone ? phones : [{ phone: l.gbp_phone_formatted ?? l.gbp_phone_raw ?? "", phone_type: l.phone_type }];
  const firstMobile = l.phone_type === "mobile" ? l.gbp_phone_formatted ?? l.gbp_phone_raw : allPhones.find((p) => p.phone_type === "mobile")?.phone ?? null;
  const email = (i: number) => emails[i] ?? "";
  const phone = (i: number) => (allPhones[i] ? nationalPhone(allPhones[i].phone, null) : "");
  const phoneType = (i: number) => (allPhones[i]?.phone_type ? (TYPE_WORDS[allPhones[i].phone_type!] ?? allPhones[i].phone_type!) : "");
  const sector = l.industry ?? l.gbp_category ?? "";
  // Only the audit fact that needs no AI: no website means "No Website", score 0.
  const audit = l.website ? ["", "", "", "", "", "", ""] : ["No Website", "", "0", "", "", "", ""];
  return [
    l.business_name ?? "", l.business_name ?? "", sector, sector, l.gbp_category ?? "",
    gbpPhone, gbpPhone, gbpType, l.website ?? "",
    ...audit,
    l.owner_name ?? "", email(0), firstMobile ? nationalPhone(firstMobile, null) : "",
    l.cid ? `https://www.google.com/maps?cid=${l.cid}` : (l.gbp_url ?? ""), l.gbp_rank ?? "", l.rating ?? "", l.review_count ?? "",
    l.address ?? "", l.city ?? "", sheetState(l.state, l.country), l.country ?? "",
    l.socials ?? "", l.logo_url ?? "", email(0), email(1), email(2), email(3), email(4),
    phone(0), phoneType(0), phone(1), phoneType(1), phone(2), phoneType(2), phone(3), phoneType(3), phone(4), phoneType(4),
    l.lead_source ?? "Google", l.source_code ?? "", l.lead_status ?? "Untouched", l.lead_date ?? "", l.lead_datetime ?? "",
  ].map((v) => String(v));
}

const EXPORT_COLUMNS = `id, business_name, industry, cid, gbp_category, lead_category, sub_category, gbp_phone_raw, gbp_phone_formatted, phone_type,
  website, owner_name, gbp_url, gbp_rank, rating, review_count, address, city, state, country, socials, logo_url,
  lead_source, source_code, lead_status, lead_date, lead_datetime`;

/** Streams a CSV of every lead matching the filters in `params` (plus optional `id` list for hand-picked rows). */
export async function exportCsv(env: Env, params: URLSearchParams): Promise<ReadableStream<Uint8Array>> {
  const filters = await resolveFilters(env, params);
  const q = buildLeadQuery(filters);
  const ids = params.getAll("id").flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
  const idClause = ids.length ? `WHERE id IN (${ids.map(sqlString).join(", ")})` : "";
  const encoder = new TextEncoder();
  // The filters run ONCE: this snapshot of matching ids (in file order) is then fetched in
  // chunks, so a big export stays fast and consistent even while a pull is adding leads.
  const { results: order } = await env.DB.prepare(
    `${q.with} SELECT id FROM ${q.source} ${idClause} ORDER BY business_name COLLATE NOCASE, id`,
  )
    .bind(...q.binds)
    .all<{ id: string }>();
  let next = 0;
  let headerSent = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        await sendNext(controller);
      } catch (err) {
        // Fail the download visibly rather than hand over a silently incomplete file.
        console.error("CSV export failed", err);
        controller.error(err);
      }
    },
  });

  async function sendNext(controller: ReadableStreamDefaultController<Uint8Array>) {
    {
      if (!headerSent) {
        headerSent = true;
        // BOM so Excel opens accented names and dashes correctly.
        controller.enqueue(encoder.encode("﻿" + CSV_COLUMNS.map(csvCell).join(",") + "\r\n"));
        return;
      }
      const chunk = order.slice(next, next + PAGE).map((r) => r.id);
      if (!chunk.length) {
        controller.close();
        return;
      }
      next += chunk.length;
      const { results: rows } = await env.DB.prepare(
        `SELECT ${EXPORT_COLUMNS} FROM leads WHERE id IN (${chunk.map(sqlString).join(", ")})`,
      ).all<LeadRow>();
      const byId = new Map(rows.map((r) => [r.id, r]));
      const results = chunk.map((id) => byId.get(id)).filter((r): r is LeadRow => !!r);
      const idList = results.map((r) => sqlString(r.id)).join(", ");
      const [emails, phones] = await env.DB.batch<{ lead_id: string; value: string; phone_type?: string | null }>([
        env.DB.prepare(`SELECT lead_id, email AS value FROM lead_emails WHERE lead_id IN (${idList}) ORDER BY lead_id, position`),
        env.DB.prepare(`SELECT lead_id, phone AS value, phone_type FROM lead_phones WHERE lead_id IN (${idList}) ORDER BY lead_id, position`),
      ]);
      const emailsBy = new Map<string, string[]>();
      for (const e of emails.results) emailsBy.set(e.lead_id, [...(emailsBy.get(e.lead_id) ?? []), e.value]);
      const phonesBy = new Map<string, { phone: string; phone_type: string | null }[]>();
      for (const p of phones.results) {
        phonesBy.set(p.lead_id, [...(phonesBy.get(p.lead_id) ?? []), { phone: p.value, phone_type: p.phone_type ?? null }]);
      }
      const text = results
        .map((r) => leadToCsvRow(r, emailsBy.get(r.id) ?? [], phonesBy.get(r.id) ?? []).map(csvCell).join(","))
        .join("\r\n");
      if (text) controller.enqueue(encoder.encode(text + "\r\n"));
    }
  }
}
