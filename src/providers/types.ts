// Provider adapter contracts. Each external service sits behind one of these so it
// can be swapped without touching callers. Adapters use only fetch(), so they run
// both in the Worker and in Node scripts.

import type { NormalizedPlace } from "../normalize";

/** What a line-type classifier may conclude. Never inferred from number format alone. */
export type LineType = "mobile" | "landline" | "voip" | "unknown";

export interface PhoneClassification {
  /** E.164 number that was sent. */
  phone: string;
  line_type: LineType;
  carrier: string | null;
  /** Provider's untouched response body, kept for audit. */
  raw: unknown;
  error?: string;
}

export interface PhoneClassifier {
  name: string;
  classify(e164: string): Promise<PhoneClassification>;
}

export interface BusinessSearchRequest {
  category: string;
  city: string;
  state: string;
  /** Center of the search area, used by providers that search by coordinates. */
  latitude: number;
  longitude: number;
  radiusKm: number;
  limit: number;
  claimedOnly: boolean;
}

export interface BusinessSearchResult {
  /** Records in the same shape the Apify pipeline produces. */
  places: NormalizedPlace[];
  /** Provider-reported cost in USD, when it reports one. */
  costUsd: number | null;
  raw: unknown;
}

export interface BusinessSource {
  name: string;
  search(req: BusinessSearchRequest): Promise<BusinessSearchResult>;
}

/** Account-level refusal (bad key, quota used up, billing required): stop, don't retry. */
export class ProviderBlockedError extends Error {}
