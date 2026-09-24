// Phone line type: toll-free is detected from the area code for free; mobile /
// landline / VoIP needs a lookup service (Veriphone, used only when a key is set).

export type PhoneType = "mobile" | "landline" | "toll_free" | "voip" | "unknown";

const TOLL_FREE_AREA_CODES = ["800", "833", "844", "855", "866", "877", "888"];
// Workers' free plan allows 50 outbound requests per invocation; stay under it.
const LOOKUPS_PER_RUN = 40;

export function isTollFree(e164: string | null): boolean {
  return !!e164 && e164.startsWith("+1") && TOLL_FREE_AREA_CODES.includes(e164.slice(2, 5));
}

interface VeriphoneResponse {
  status: string;
  phone_valid: boolean;
  phone_type: string;
  carrier?: string;
}

const VERIPHONE_TYPES: Record<string, PhoneType> = {
  mobile: "mobile",
  fixed_line: "landline",
  toll_free: "toll_free",
  voip: "voip",
};

async function veriphoneLookup(apiKey: string, e164: string): Promise<{ type: PhoneType; carrier: string | null }> {
  const res = await fetch(`https://api.veriphone.io/v2/verify?phone=${encodeURIComponent(e164)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Veriphone ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json<VeriphoneResponse>();
  if (data.status !== "success") throw new Error(`Veriphone status ${data.status}`);
  return {
    type: data.phone_valid ? (VERIPHONE_TYPES[data.phone_type] ?? "unknown") : "unknown",
    carrier: data.carrier?.trim() || null,
  };
}

/**
 * Checks the line type of leads that haven't been checked yet. Runs from the
 * minute cron, a small batch at a time. Does nothing without VERIPHONE_API_KEY.
 */
export async function checkPendingPhones(env: Env): Promise<number> {
  const apiKey = env.VERIPHONE_API_KEY;
  if (!apiKey) return 0;

  const { results } = await env.DB.prepare(
    `SELECT l.id, l.gbp_phone_formatted AS phone FROM leads l
     LEFT JOIN searches s ON s.id = l.search_id
     WHERE l.phone_type IS NULL AND l.gbp_phone_formatted IS NOT NULL
       AND COALESCE(s.skip_phone_lookup, 0) = 0
     ORDER BY l.created_at LIMIT ?`,
  )
    .bind(LOOKUPS_PER_RUN)
    .all<{ id: string; phone: string }>();

  let checked = 0;
  for (const lead of results) {
    try {
      const { type, carrier } = await veriphoneLookup(apiKey, lead.phone);
      await env.DB.prepare(
        `UPDATE leads SET phone_type = ?, phone_carrier = ?, enrichment_error = NULL, updated_at = datetime('now')
         WHERE id = ?`,
      )
        .bind(type, carrier, lead.id)
        .run();
      checked++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`phone check failed for lead ${lead.id}:`, message);
      // Out of credits or bad key: leave the lead unchecked and stop this round.
      if (/Veriphone (401|402|403|429)/.test(message)) {
        await env.DB.prepare(`UPDATE leads SET enrichment_error = ? WHERE id = ?`).bind(message, lead.id).run();
        break;
      }
      // Anything else (timeout, odd number): mark unknown so it isn't retried forever.
      await env.DB.prepare(`UPDATE leads SET phone_type = 'unknown', enrichment_error = ? WHERE id = ?`)
        .bind(message, lead.id)
        .run();
    }
  }
  return checked;
}
