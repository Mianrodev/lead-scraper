// Phone line type: toll-free is detected from the area code for free; mobile /
// landline / VoIP needs a lookup service. Telnyx (live carrier/porting data) is used
// when TELNYX_API_KEY is set, otherwise Veriphone (number-range data) if its key is set.

export type PhoneType = "mobile" | "landline" | "toll_free" | "voip" | "unknown";

interface LookupResult {
  type: PhoneType;
  carrier: string | null;
}

interface PhoneProvider {
  name: string;
  /** Estimated USD per lookup, recorded against the search's phone cost. */
  costPerLookup: number;
  lookup(e164: string): Promise<LookupResult>;
}

/** Account-level problem (bad key, no credit, feature not enabled): stop the batch. */
class ProviderBlockedError extends Error {}

const TOLL_FREE_AREA_CODES = ["800", "833", "844", "855", "866", "877", "888"];
// Workers' free plan allows 50 outbound requests per invocation; stay under it.
const LOOKUPS_PER_RUN = 40;
const LOOKUP_TIMEOUT_MS = 8000;

export function isTollFree(e164: string | null): boolean {
  return !!e164 && e164.startsWith("+1") && TOLL_FREE_AREA_CODES.includes(e164.slice(2, 5));
}

async function fetchJson<T>(provider: string, url: string, apiKey: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });
  if (!res.ok) {
    const message = `${provider} ${res.status}: ${(await res.text()).slice(0, 300)}`;
    if ([401, 402, 403, 429].includes(res.status)) throw new ProviderBlockedError(message);
    throw new Error(message);
  }
  return res.json<T>();
}

// --- Telnyx ---------------------------------------------------------------

interface TelnyxLookup {
  data?: {
    carrier?: { type?: string; name?: string; normalized_carrier?: string };
    portability?: { line_type?: string; spid_carrier_name?: string; ported_status?: string };
  };
}

/** Maps a free-text line type ("Wireless", "voip", "fixed line", …) to ours. */
function lineTypeFromText(text: string | undefined): PhoneType | null {
  const t = (text ?? "").toLowerCase();
  if (!t) return null;
  if (t.includes("toll")) return "toll_free";
  if (t.includes("voip") || t.includes("vowifi")) return "voip";
  if (t === "fixed line or mobile") return null; // ambiguous; let the other field decide
  if (t.includes("mobile") || t.includes("wireless") || t.includes("cell")) return "mobile";
  if (t.includes("fixed") || t.includes("wireline") || t.includes("landline")) return "landline";
  return null;
}

export function telnyxResultToLineType(body: TelnyxLookup): LookupResult {
  const { carrier, portability } = body.data ?? {};
  // Portability reflects where the number lives today (after any port), so it wins.
  const type = lineTypeFromText(portability?.line_type) ?? lineTypeFromText(carrier?.type) ?? "unknown";
  const name = carrier?.normalized_carrier || portability?.spid_carrier_name || carrier?.name || null;
  return { type, carrier: name?.trim() || null };
}

function telnyx(apiKey: string): PhoneProvider {
  return {
    name: "Telnyx",
    costPerLookup: 0.0025,
    async lookup(e164) {
      const body = await fetchJson<TelnyxLookup>(
        "Telnyx",
        `https://api.telnyx.com/v2/number_lookup/${encodeURIComponent(e164)}?type=carrier`,
        apiKey,
      );
      return telnyxResultToLineType(body);
    },
  };
}

// --- Veriphone ------------------------------------------------------------

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

function veriphone(apiKey: string): PhoneProvider {
  return {
    name: "Veriphone",
    costPerLookup: 0, // free tier; paid tiers are fractions of a cent
    async lookup(e164) {
      const data = await fetchJson<VeriphoneResponse>(
        "Veriphone",
        `https://api.veriphone.io/v2/verify?phone=${encodeURIComponent(e164)}`,
        apiKey,
      );
      if (data.status !== "success") throw new Error(`Veriphone status ${data.status}`);
      return {
        type: data.phone_valid ? (VERIPHONE_TYPES[data.phone_type] ?? "unknown") : "unknown",
        carrier: data.carrier?.trim() || null,
      };
    },
  };
}

function activeProvider(env: Env): PhoneProvider | null {
  if (env.TELNYX_API_KEY) return telnyx(env.TELNYX_API_KEY);
  if (env.VERIPHONE_API_KEY) return veriphone(env.VERIPHONE_API_KEY);
  return null;
}

/**
 * Checks the line type of leads that haven't been checked yet. Runs from the
 * minute cron, a small batch at a time. Does nothing without a provider key.
 */
export async function checkPendingPhones(env: Env): Promise<{ checked: number; provider: string | null; error?: string }> {
  const provider = activeProvider(env);
  if (!provider) return { checked: 0, provider: null };

  const { results } = await env.DB.prepare(
    `SELECT l.id, l.search_id, l.gbp_phone_formatted AS phone FROM leads l
     LEFT JOIN searches s ON s.id = l.search_id
     WHERE l.phone_type IS NULL AND l.gbp_phone_formatted IS NOT NULL
       AND COALESCE(s.skip_phone_lookup, 0) = 0
     ORDER BY l.created_at LIMIT ?`,
  )
    .bind(LOOKUPS_PER_RUN)
    .all<{ id: string; search_id: string | null; phone: string }>();

  let checked = 0;
  for (const lead of results) {
    try {
      const { type, carrier } = await provider.lookup(lead.phone);
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE leads SET phone_type = ?, phone_carrier = ?, enrichment_error = NULL, updated_at = datetime('now')
           WHERE id = ?`,
        ).bind(type, carrier, lead.id),
        env.DB.prepare(`UPDATE searches SET cost_twilio = cost_twilio + ? WHERE id = ?`).bind(
          provider.costPerLookup,
          lead.search_id,
        ),
      ]);
      checked++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`phone check failed for lead ${lead.id}:`, message);
      if (err instanceof ProviderBlockedError) {
        // Leave the lead unchecked so it's retried once the account is sorted out.
        await env.DB.prepare(`UPDATE leads SET enrichment_error = ? WHERE id = ?`).bind(message, lead.id).run();
        return { checked, provider: provider.name, error: message };
      }
      // Anything else (timeout, odd number): mark unknown so it isn't retried forever.
      await env.DB.prepare(`UPDATE leads SET phone_type = 'unknown', enrichment_error = ? WHERE id = ?`)
        .bind(message, lead.id)
        .run();
    }
  }
  return { checked, provider: provider.name };
}
