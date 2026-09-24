// Recomputes derived lead columns for existing rows, using the same functions ingest
// uses. Run after a migration adds a derived column (POST /api/admin/backfill).

import { businessStatus, hasStreetAddress, websiteDomain } from "./normalize";

const PAGE = 200;

interface Row {
  id: string;
  website: string | null;
  address: string | null;
  raw: string | null;
  permanently_closed: number;
  temporarily_closed: number;
}

export async function backfillDerivedColumns(env: Env): Promise<{ updated: number }> {
  let updated = 0;
  for (let offset = 0; ; offset += PAGE) {
    const { results } = await env.DB.prepare(
      `SELECT id, website, address, raw, permanently_closed, temporarily_closed FROM leads ORDER BY id LIMIT ? OFFSET ?`,
    )
      .bind(PAGE, offset)
      .all<Row>();
    if (!results.length) break;

    const statements = results.map((r) => {
      let item: Record<string, unknown> = {};
      try {
        item = r.raw ? (JSON.parse(r.raw) as Record<string, unknown>) : {};
      } catch {
        // unreadable raw: fall back to the address column
      }
      return env.DB.prepare(
        `UPDATE leads SET website_domain = ?, has_street_address = ?, business_status = ? WHERE id = ?`,
      ).bind(
        websiteDomain(r.website),
        hasStreetAddress(item, r.address),
        businessStatus(r.permanently_closed === 1, r.temporarily_closed === 1),
        r.id,
      );
    });
    for (let i = 0; i < statements.length; i += 50) await env.DB.batch(statements.slice(i, i + 50));
    updated += results.length;
    if (results.length < PAGE) break;
  }
  return { updated };
}
