// Phone line type: toll-free is detected from the area code for free; mobile /
// landline / VoIP needs a lookup service. Providers are tried in order: Telnyx (live
// carrier/porting data), then Abstract (free tier), then Veriphone, skipping any that
// refuse (e.g. account not upgraded, free checks used up).

import { abstractLineType, ABSTRACT_PHONE_ENDPOINT, type AbstractPhoneResponse } from "./providers/abstract-phone";

export type PhoneType = "mobile" | "landline" | "toll_free" | "voip" | "unknown";

interface LookupResult {
  type: PhoneType;
  carrier: string | null;
}

interface PhoneProvider {
  name: string;
  /** Estimated USD per lookup, recorded against the search's phone cost. */
  costPerLookup: number;
  /** Minimum gap between calls (free plans are rate limited). */
  minIntervalMs?: number;
  lookup(e164: string): Promise<LookupResult>;
}

/** Account-level problem (bad key, no credit, feature not enabled): stop using this provider. */
class ProviderBlockedError extends Error {}

const TOLL_FREE_AREA_CODES = ["800", "833", "844", "855", "866", "877", "888"];
// Workers' free plan allows 50 outbound requests per invocation; stay under it.
const LOOKUPS_PER_RUN = 40;
const LOOKUP_TIMEOUT_MS = 8000;

export function isTollFree(e164: string | null): boolean {
  return !!e164 && e164.startsWith("+1") && TOLL_FREE_AREA_CODES.includes(e164.slice(2, 5));
}

async function fetchJson<T>(provider: string, url: string, apiKey: string, extraBlocked: number[] = []): Promise<T> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });
  if (!res.ok) {
    const message = `${provider} ${res.status}: ${(await res.text()).slice(0, 300)}`;
    if ([401, 402, 403, 429, ...extraBlocked].includes(res.status)) throw new ProviderBlockedError(message);
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

// --- Abstract Phone Intelligence (free tier; number-range data) ------------

function abstract(apiKey: string): PhoneProvider {
  return {
    name: "Abstract",
    costPerLookup: 0, // free tier
    minIntervalMs: 1600, // free plan: 1 request per second (with margin)
    async lookup(e164) {
      const body = await fetchJson<AbstractPhoneResponse>(
        "Abstract",
        `${ABSTRACT_PHONE_ENDPOINT}?${new URLSearchParams({ phone: e164 })}`,
        apiKey,
        [422], // Abstract: free checks used up
      );
      return { type: abstractLineType(body), carrier: body.phone_carrier?.name?.trim() || null };
    },
  };
}

/** Providers in order of preference. When one refuses (no credit, not enabled) the next is used. */
function providers(env: Env): PhoneProvider[] {
  const list: PhoneProvider[] = [];
  if (env.TELNYX_API_KEY) list.push(telnyx(env.TELNYX_API_KEY));
  if (env.ABSTRACT_PHONE_API_KEY) list.push(abstract(env.ABSTRACT_PHONE_API_KEY));
  if (env.VERIPHONE_API_KEY) list.push(veriphone(env.VERIPHONE_API_KEY));
  return list;
}

// Leads waiting for a check: from a pull that asked for phone types, and worth contacting (verified, open).
const PENDING_WHERE = `l.phone_type IS NULL AND l.gbp_phone_formatted IS NOT NULL
  AND COALESCE(l.is_claimed, 1) = 1 AND l.business_status = 'operational'
  AND EXISTS (SELECT 1 FROM search_leads sl JOIN searches s ON s.id = sl.search_id
              WHERE sl.lead_id = l.id AND s.check_phones = 1)`;

export interface PhoneCheckResult {
  checked: number;
  /** Still waiting after this run. */
  pending: number;
  provider: string | null;
  /** Providers that refused this run (e.g. account not upgraded, free checks used up). */
  refused: string[];
  error?: string;
}

/**
 * Checks the line type of leads that are waiting for it, a small batch at a time.
 * Runs from the minute cron online, and from the open dashboard locally.
 */
export async function checkPendingPhones(env: Env, limit = LOOKUPS_PER_RUN): Promise<PhoneCheckResult> {
  const chain = providers(env);
  const pendingCount = async () =>
    (await env.DB.prepare(`SELECT COUNT(*) AS n FROM leads l WHERE ${PENDING_WHERE}`).first<number>("n")) ?? 0;
  if (!chain.length) return { checked: 0, pending: await pendingCount(), provider: null, refused: [] };

  const { results } = await env.DB.prepare(
    `SELECT l.id, l.search_id, l.gbp_phone_formatted AS phone FROM leads l WHERE ${PENDING_WHERE}
     ORDER BY l.created_at LIMIT ?`,
  )
    .bind(Math.min(Math.max(limit, 1), LOOKUPS_PER_RUN))
    .all<{ id: string; search_id: string | null; phone: string }>();

  let checked = 0;
  let current = 0;
  let lastCall = 0;
  const refused: string[] = [];
  for (const lead of results) {
    const provider = chain[current];
    if (!provider) break;
    try {
      const wait = (provider.minIntervalMs ?? 0) - (Date.now() - lastCall);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastCall = Date.now();
      const { type, carrier } = await provider.lookup(lead.phone).catch(async (err) => {
        // "Too many per second" isn't a refusal: wait and try once more.
        if (err instanceof ProviderBlockedError && / 429:/.test(err.message)) {
          await new Promise((r) => setTimeout(r, 3000));
          lastCall = Date.now();
          return provider.lookup(lead.phone);
        }
        throw err;
      });
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
        // This provider won't serve us right now: try the next one for this and the remaining leads.
        refused.push(`${provider.name}: ${message}`);
        current++;
        const next = chain[current];
        if (!next) {
          // Nobody left: leave the lead unchecked so it's retried once an account is sorted out.
          await env.DB.prepare(`UPDATE leads SET enrichment_error = ? WHERE id = ?`).bind(message, lead.id).run();
          return { checked, pending: await pendingCount(), provider: null, refused, error: message };
        }
        results.push(lead); // retry this lead with the next provider (loop picks it up at the end)
        continue;
      }
      // Anything else (timeout, odd number): mark unknown so it isn't retried forever.
      await env.DB.prepare(`UPDATE leads SET phone_type = 'unknown', enrichment_error = ? WHERE id = ?`)
        .bind(message, lead.id)
        .run();
    }
  }
  return { checked, pending: await pendingCount(), provider: chain[current]?.name ?? null, refused };
}
