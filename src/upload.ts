// "Upload a list": businesses the team already has (a CSV or pasted rows) become leads like any
// other: saved as one list (a search with source 'upload'), matched to businesses we already
// have, then website-checked, scored and looked up in the state registries automatically.

import { stateCode } from "./format";
import { formatLeadDate, formatLeadDateTime } from "./format";
import { cleanEmail, safeWebsite, toE164, websiteDomain } from "./normalize";
import { isTollFree } from "./phone";
import { ValidationError } from "./pipeline";
import { industryOf } from "./taxonomy";

export const MAX_UPLOAD_ROWS = 2000;

export interface UploadRow {
  name: string;
  website: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  category: string | null;
}

/** Splits CSV text into rows of cells (quotes, commas and new lines inside quotes handled). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === "," || ch === "\t" || ch === ";") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

// Column names people use, per field (lower case, spaces / punctuation removed).
const HEADERS: Record<keyof UploadRow, string[]> = {
  name: ["businessname", "business", "company", "companyname", "name", "leadname", "organization", "account"],
  website: ["website", "url", "site", "web", "domain", "websiteurl"],
  phone: ["phone", "phonenumber", "telephone", "tel", "mobile", "gbpphone", "phone1", "mainphone"],
  email: ["email", "emailaddress", "email1", "mail"],
  address: ["address", "streetaddress", "street", "address1"],
  city: ["city", "town"],
  state: ["state", "province", "region", "st"],
  zip: ["zip", "zipcode", "postalcode", "postcode", "postal"],
  category: ["category", "type", "industry", "gbpcategory", "subcategory", "businesstype"],
};

/** Rows with a business name, using the header row to find each column. */
export function rowsFromCsv(text: string): { rows: UploadRow[]; columns: Partial<Record<keyof UploadRow, string>>; skipped: number } {
  const table = parseCsv(text);
  if (table.length < 2) throw new ValidationError("The list needs a header row and at least one business.");
  const head = table[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const idx: Partial<Record<keyof UploadRow, number>> = {};
  const columns: Partial<Record<keyof UploadRow, string>> = {};
  for (const key of Object.keys(HEADERS) as (keyof UploadRow)[]) {
    const i = head.findIndex((h) => HEADERS[key].includes(h));
    if (i >= 0) { idx[key] = i; columns[key] = table[0][i].trim(); }
  }
  if (idx.name == null) throw new ValidationError('Couldn\'t find a business name column. Name one of the columns "Business Name" or "Company".');
  const cell = (r: string[], k: keyof UploadRow) => (idx[k] == null ? null : (r[idx[k]!] ?? "").trim() || null);
  let skipped = 0;
  const rows: UploadRow[] = [];
  for (const r of table.slice(1)) {
    const name = cell(r, "name");
    if (!name) { skipped++; continue; }
    rows.push({
      name: name.slice(0, 200), website: cell(r, "website"), phone: cell(r, "phone"), email: cleanEmail(cell(r, "email")),
      address: cell(r, "address"), city: cell(r, "city"), state: cell(r, "state"), zip: cell(r, "zip"), category: cell(r, "category"),
    });
  }
  if (rows.length > MAX_UPLOAD_ROWS) throw new ValidationError(`Up to ${MAX_UPLOAD_ROWS.toLocaleString("en-US")} businesses per upload (this list has ${rows.length.toLocaleString("en-US")}). Split it into smaller files.`);
  return { rows, columns, skipped };
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Saves an uploaded list; returns the new list (search) id and what happened. */
export async function saveUpload(env: Env, name: string, csv: string, createdBy: string | null) {
  const listName = (name ?? "").trim().slice(0, 100) || `Uploaded list ${new Date().toISOString().slice(0, 10)}`;
  if (!csv || csv.length > 3_000_000) throw new ValidationError("Choose a CSV file (up to about 3 MB).");
  const { rows, columns, skipped } = rowsFromCsv(csv);
  const searchId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO searches (id, category, city, state, country, country_code, source_code, max_results, apify_actor_id, created_by, estimated_cost,
       status, source, results_count, finished_at)
     VALUES (?, ?, '', NULL, 'USA', 'US', ?, ?, 'upload', ?, 0, 'ingesting', 'upload', ?, NULL)`,
  ).bind(searchId, listName, env.SOURCE_CODE_DEFAULT, rows.length, createdBy, rows.length).run();

  const now = new Date();
  const leadDate = formatLeadDate(now, env.LEAD_TIMEZONE), leadDateTime = formatLeadDateTime(now, env.LEAD_TIMEZONE);
  let added = 0, matched = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50).map((r) => {
      const website = safeWebsite(r.website);
      const st = r.state ? (stateCode(r.state) || r.state.toUpperCase().slice(0, 20)) : null;
      return { ...r, website, domain: websiteDomain(website), phone: toE164(r.phone, "US"), phoneRaw: r.phone, state: st };
    });
    const phones = batch.map((b) => b.phone).filter((x): x is string => !!x).map(q);
    const domains = batch.map((b) => b.domain).filter((x): x is string => !!x).map(q);
    // Phone and website are indexed, so matching stays cheap however big the database is.
    const where = [phones.length ? `gbp_phone_formatted IN (${phones.join(", ")})` : "", domains.length ? `website_domain IN (${domains.join(", ")})` : ""].filter(Boolean);
    const known = where.length
      ? (await env.DB.prepare(
        `SELECT id, gbp_phone_formatted AS phone, website_domain AS domain, lower(business_name) AS name, lower(COALESCE(city, '')) AS city FROM leads
         WHERE ${where.join(" OR ")}`,
      ).all<{ id: string; phone: string | null; domain: string | null; name: string; city: string }>()).results
      : [];
    const st: D1PreparedStatement[] = [];
    for (const b of batch) {
      const city = (b.city ?? "").toLowerCase();
      // Same phone, or same website (in the same city when we know it) = a business we already have;
      // same name + city also catches repeats inside this upload.
      const hit = (b.phone ? known.find((k) => k.phone === b.phone) : undefined)
        ?? (b.domain ? known.find((k) => k.domain === b.domain && (!city || !k.city || k.city === city)) : undefined)
        ?? known.find((k) => k.name === b.name.toLowerCase() && !!city && k.city === city);
      let id: string;
      if (hit) {
        id = hit.id;
        matched++;
        st.push(env.DB.prepare(
          `UPDATE leads SET website = COALESCE(website, ?), website_domain = COALESCE(website_domain, ?), gbp_phone_raw = COALESCE(gbp_phone_raw, ?),
             gbp_phone_formatted = COALESCE(gbp_phone_formatted, ?), city = COALESCE(city, ?), state = COALESCE(state, ?), postal_code = COALESCE(postal_code, ?)
           WHERE id = ?`,
        ).bind(b.website, b.domain, b.phoneRaw, b.phone, b.city, b.state, b.zip, id));
      } else {
        id = crypto.randomUUID();
        added++;
        known.push({ id, phone: b.phone, domain: b.domain, name: b.name.toLowerCase(), city });
        st.push(env.DB.prepare(
          `INSERT INTO leads (id, search_id, google_place_id, business_name, gbp_category, lead_category, sub_category, gbp_phone_raw, gbp_phone_formatted,
             phone_type, website, website_domain, address, city, state, postal_code, country, business_status, has_street_address, industry,
             source_code, lead_date, lead_datetime, data_source, lead_source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USA', 'operational', ?, ?, ?, ?, ?, 'upload', 'Uploaded list')`,
        ).bind(id, searchId, `upl:${id}`, b.name, b.category, b.category, b.category, b.phoneRaw, b.phone, isTollFree(b.phone) ? "toll_free" : null,
          b.website, b.domain, [b.address, b.city, [b.state, b.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null,
          b.city, b.state, b.zip, b.address ? 1 : null, industryOf(b.category), env.SOURCE_CODE_DEFAULT, leadDate, leadDateTime));
      }
      if (b.email && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(b.email)) {
        st.push(env.DB.prepare(
          `INSERT OR IGNORE INTO lead_emails (lead_id, email, position)
           SELECT ?, ?, COALESCE((SELECT MAX(position) + 1 FROM lead_emails WHERE lead_id = ?), 0)
           WHERE NOT EXISTS (SELECT 1 FROM lead_emails WHERE lead_id = ? AND email = ?)`,
        ).bind(id, b.email, id, id, b.email));
      }
      st.push(env.DB.prepare(`INSERT OR IGNORE INTO search_leads (search_id, lead_id, rank) VALUES (?, ?, NULL)`).bind(searchId, id));
    }
    for (let j = 0; j < st.length; j += 90) await env.DB.batch(st.slice(j, j + 90));
  }
  await env.DB.prepare(
    `UPDATE searches SET status = 'done', finished_at = datetime('now'), new_leads_count = ?, leads_saved = (SELECT COUNT(*) FROM search_leads WHERE search_id = ?) WHERE id = ?`,
  ).bind(added, searchId, searchId).run();
  return { searchId, name: listName, rows: rows.length, added, matched, skipped, columns };
}
