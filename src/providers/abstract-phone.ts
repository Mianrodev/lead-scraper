// Abstract Phone Intelligence adapter.
// Docs: https://docs.abstractapi.com/api/phone-intelligence

import { ProviderBlockedError, type LineType, type PhoneClassification, type PhoneClassifier } from "./types";

export const ABSTRACT_PHONE_ENDPOINT = "https://phoneintelligence.abstractapi.com/v1/";

export interface AbstractPhoneResponse {
  phone_carrier?: { name?: string | null; line_type?: string | null } | null;
  phone_validation?: { is_valid?: boolean | null; is_voip?: boolean | null } | null;
}

/**
 * Only the provider's reported carrier line type counts. Anything missing,
 * invalid, or outside our categories (toll_free, personal, pager) is "unknown".
 */
export function abstractLineType(body: AbstractPhoneResponse): LineType {
  if (body.phone_validation?.is_valid === false) return "unknown";
  const reported = body.phone_carrier?.line_type?.toLowerCase();
  if (reported === "mobile" || reported === "landline" || reported === "voip") return reported;
  if (body.phone_validation?.is_voip === true) return "voip";
  return "unknown";
}

export function abstractPhoneRequest(e164: string, apiKey: string): { url: string; init: RequestInit } {
  const url = `${ABSTRACT_PHONE_ENDPOINT}?${new URLSearchParams({ phone: e164, country: "US" })}`;
  // Key goes in a header so it never ends up in URLs or logs.
  return { url, init: { method: "GET", headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } } };
}

export function abstractPhoneClassifier(apiKey: string): PhoneClassifier {
  return {
    name: "Abstract Phone Intelligence",
    async classify(e164) {
      const { url, init } = abstractPhoneRequest(e164, apiKey);
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
      const text = await res.text();
      const raw = safeJson(text);
      if (!res.ok) {
        const message = `Abstract ${res.status}: ${text.slice(0, 300)}`;
        // 401 bad key, 402/403 plan/billing, 422 out of credits, 429 rate limited.
        if ([401, 402, 403, 422, 429].includes(res.status)) throw new ProviderBlockedError(message);
        return { phone: e164, line_type: "unknown", carrier: null, raw, error: message };
      }
      const body = raw as AbstractPhoneResponse;
      return {
        phone: e164,
        line_type: abstractLineType(body),
        carrier: body.phone_carrier?.name?.trim() || null,
        raw,
      };
    },
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
