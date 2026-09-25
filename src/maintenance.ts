// Recomputes derived lead columns for existing rows, using the same functions ingest
// uses. Run after a migration adds a derived column (POST /api/admin/backfill).

import { businessStatus, compactRaw, hasStreetAddress, priceLevel, profileAttributes, websiteDomain } from "./normalize";
import { writeAttributes } from "./pipeline";
import { industryOf } from "./taxonomy";

const PAGE = 200;

interface Row {
  id: string;
  website: string | null;
  address: string | null;
  gbp_category: string | null;
  raw: string | null;
  permanently_closed: number;
  temporarily_closed: number;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export async function backfillDerivedColumns(env: Env): Promise<{ updated: number }> {
  let updated = 0;
  for (let offset = 0; ; offset += PAGE) {
    const { results } = await env.DB.prepare(
      `SELECT id, website, address, gbp_category, raw, permanently_closed, temporarily_closed
       FROM leads ORDER BY id LIMIT ? OFFSET ?`,
    )
      .bind(PAGE, offset)
      .all<Row>();
    if (!results.length) break;

    const attributeRows: Parameters<typeof writeAttributes>[1] = [];
    const statements = results.map((r) => {
      let item: Record<string, unknown> = {};
      try {
        item = r.raw ? (JSON.parse(r.raw) as Record<string, unknown>) : {};
      } catch {
        // unreadable raw: fall back to the plain columns
      }
      // Leads without a raw item (e.g. imported test data) keep whatever attributes they have.
      if (r.raw) attributeRows.push({ leadId: r.id, attributes: profileAttributes(item.additionalInfo) });
      return env.DB.prepare(
        `UPDATE leads SET website_domain = ?, has_street_address = ?, business_status = ?, industry = ?,
           price_level = COALESCE(?, price_level), photos_count = COALESCE(?, photos_count),
           neighborhood = COALESCE(?, neighborhood)
         WHERE id = ?`,
      ).bind(
        websiteDomain(r.website),
        hasStreetAddress(item, r.address),
        businessStatus(r.permanently_closed === 1, r.temporarily_closed === 1),
        industryOf(r.gbp_category),
        priceLevel(item.price),
        num(item.imagesCount),
        typeof item.neighborhood === "string" && item.neighborhood.trim() ? item.neighborhood.trim() : null,
        r.id,
      );
    });
    for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
    // Missing country: take it from the pull that first found the lead.
    await env.DB.prepare(
      `UPDATE leads SET country = (SELECT CASE WHEN COALESCE(s.country_code, 'US') = 'US' THEN 'USA' ELSE s.country END
                                   FROM searches s WHERE s.id = leads.search_id)
       WHERE country IS NULL AND search_id IS NOT NULL`,
    ).run();
    await writeAttributes(env, attributeRows);
    updated += results.length;
    if (results.length < PAGE) break;
  }
  return { updated };
}


const TRIM_PAGE = 300;

/**
 * One-off, in small steps from the cron: shrinks the Google listing saved with older leads
 * to the fields the app uses (see compactRaw). New leads are already saved this way.
 * Progress is kept in app_settings.raw_trim_rowid; 'done' when finished.
 */
export async function trimRawStep(env: Env): Promise<{ trimmed: number; done: boolean }> {
  const marker = await env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'raw_trim_rowid'`).first<string>("value");
  if (marker == null || marker === "done") return { trimmed: 0, done: true };
  const { results } = await env.DB.prepare(
    `SELECT rowid AS rid, id, raw FROM leads WHERE rowid > ? AND raw IS NOT NULL ORDER BY rowid LIMIT ?`,
  )
    .bind(Number(marker) || 0, TRIM_PAGE)
    .all<{ rid: number; id: string; raw: string }>();
  const updates = results.flatMap((r) => {
    let item: Record<string, unknown>;
    try {
      item = JSON.parse(r.raw) as Record<string, unknown>;
    } catch {
      return [];
    }
    const lean = compactRaw(item);
    return lean.length < r.raw.length ? [env.DB.prepare(`UPDATE leads SET raw = ? WHERE id = ?`).bind(lean, r.id)] : [];
  });
  for (let i = 0; i < updates.length; i += 50) await env.DB.batch(updates.slice(i, i + 50));
  const done = results.length < TRIM_PAGE;
  await env.DB.prepare(`UPDATE app_settings SET value = ? WHERE key = 'raw_trim_rowid'`)
    .bind(done ? "done" : String(results[results.length - 1].rid))
    .run();
  return { trimmed: updates.length, done };
}