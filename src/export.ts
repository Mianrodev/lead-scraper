// CSV export in the exact column order the team uploads to GoHighLevel (spec section 5).
// Uses the same filters as the dashboard (buildLeadQuery), streams page by page, no row cap.

import { buildLeadQuery, resolveFilters, sqlString } from "./leads";

export const CSV_COLUMNS = [
  "Business Name", "Business Name (Lead Name)", "GBP Category", "Lead Category", "Sub-Category",
  "GBP Phone", "GBP Phone (Phone)", "Phone Type", "Website", "Owner", "Email", "Mobile 1",
  "GBP URL", "GBP Rank", "Rating on GBP", "Reviews on GBP", "Address", "City", "State", "Country",
  "Socials", "Logo URL", "Email 1", "Email 2", "Email 3", "Email 4", "Email 5",
  "Phone 1", "Phone 1 Type", "Phone 2", "Phone 2 Type", "Phone 3", "Phone 3 Type",
  "Phone 4", "Phone 4 Type", "Phone 5", "Phone 5 Type",
  "Lead Source", "Source Code", "Lead Status", "Lead Date", "Lead Date & Time",
] as const;

const PAGE = 500;

// Phone type words as the sheet uses them.
const TYPE_WORDS: Record<string, string> = { mobile: "mobile", landline: "landline", toll_free: "toll_free", voip: "voip" };

/** "+14076053803" -> "1407-605-3803" (the sheet's style). Non-US numbers: digits with country code. */
export function sheetPhone(e164: string | null, raw: string | null): string {
  const digits = (e164 ?? raw ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `1${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  return digits;
}

export function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

interface LeadRow {
  id: string;
  business_name: string | null;
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
  const mobile =
    l.phone_type === "mobile" ? gbpPhone : sheetPhone(phones.find((p) => p.phone_type === "mobile")?.phone ?? null, null);
  const email = (i: number) => emails[i] ?? "";
  const phone = (i: number) => (phones[i] ? sheetPhone(phones[i].phone, null) : "");
  const phoneType = (i: number) => (phones[i]?.phone_type ? (TYPE_WORDS[phones[i].phone_type!] ?? phones[i].phone_type!) : "");
  return [
    l.business_name ?? "", l.business_name ?? "", l.gbp_category ?? "", l.lead_category ?? l.gbp_category ?? "", l.sub_category ?? "",
    gbpPhone, gbpPhone, gbpType, l.website ?? "", l.owner_name ?? "", email(0), mobile,
    l.gbp_url ?? "", l.gbp_rank ?? "", l.rating ?? "", l.review_count ?? "", l.address ?? "", l.city ?? "", l.state ?? "", l.country ?? "",
    l.socials ?? "", l.logo_url ?? "", email(0), email(1), email(2), email(3), email(4),
    phone(0), phoneType(0), phone(1), phoneType(1), phone(2), phoneType(2), phone(3), phoneType(3), phone(4), phoneType(4),
    l.lead_source ?? "Google", l.source_code ?? "", l.lead_status ?? "Untouched", l.lead_date ?? "", l.lead_datetime ?? "",
  ].map((v) => String(v));
}

const EXPORT_COLUMNS = `id, business_name, gbp_category, lead_category, sub_category, gbp_phone_raw, gbp_phone_formatted, phone_type,
  website, owner_name, gbp_url, gbp_rank, rating, review_count, address, city, state, country, socials, logo_url,
  lead_source, source_code, lead_status, lead_date, lead_datetime`;

/** Streams a CSV of every lead matching the filters in `params` (plus optional `id` list for hand-picked rows). */
export async function exportCsv(env: Env, params: URLSearchParams): Promise<ReadableStream<Uint8Array>> {
  const filters = await resolveFilters(env, params);
  const q = buildLeadQuery(filters);
  const ids = params.getAll("id").flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
  const idClause = ids.length ? `WHERE id IN (${ids.map(sqlString).join(", ")})` : "";
  const encoder = new TextEncoder();
  let offset = 0;
  let headerSent = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!headerSent) {
        headerSent = true;
        // BOM so Excel opens accented names and dashes correctly.
        controller.enqueue(encoder.encode("﻿" + CSV_COLUMNS.map(csvCell).join(",") + "\r\n"));
        return;
      }
      const { results } = await env.DB.prepare(
        `${q.with} SELECT ${EXPORT_COLUMNS} FROM ${q.source} ${idClause} ORDER BY business_name COLLATE NOCASE, id LIMIT ? OFFSET ?`,
      )
        .bind(...q.binds, PAGE, offset)
        .all<LeadRow>();
      if (!results.length) {
        controller.close();
        return;
      }
      offset += results.length;
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
      controller.enqueue(encoder.encode(text + "\r\n"));
    },
  });
}
