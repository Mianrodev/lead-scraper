// Maps one Google Maps actor dataset item onto lead columns. Field names differ
// slightly between actors, so each value falls back through the known aliases.

import { cityStateFromAddress, stateCode } from "./format";
import { isTollFree } from "./phone";

export interface NormalizedPlace {
  google_place_id: string;
  cid: string | null;
  business_name: string | null;
  gbp_category: string | null;
  sub_category: string | null;
  gbp_phone_raw: string | null;
  gbp_phone_formatted: string | null;
  /** Only toll-free can be known without a lookup; everything else starts null (unchecked). */
  phone_type: "toll_free" | null;
  website: string | null;
  gbp_url: string | null;
  gbp_rank: number | null;
  rating: number | null;
  review_count: number | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  is_claimed: 0 | 1 | null;
  permanently_closed: 0 | 1;
  temporarily_closed: 0 | 1;
  logo_url: string | null;
}

type Item = Record<string, unknown>;

function str(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

function num(...values: unknown[]): number | null {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

function bool(...values: unknown[]): boolean | null {
  for (const v of values) {
    if (typeof v === "boolean") return v;
  }
  return null;
}

/** Normalises a US-style phone number to E.164. Returns null when it can't. */
export function toE164(phone: string | null): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/**
 * Claimed/verified status. Apify's compass actor reports `claimThisBusiness: true`
 * when Google shows the "Claim this business" link, i.e. the profile is unclaimed.
 * Other actors may report a positive flag instead. Unknown stays null.
 */
export function claimedFlag(item: Item): 0 | 1 | null {
  const unclaimed = bool(item.claimThisBusiness, item.claim_this_business);
  if (unclaimed !== null) return unclaimed ? 0 : 1;
  const claimed = bool(item.isClaimed, item.claimed, item.is_claimed, item.verified, item.isVerified);
  if (claimed !== null) return claimed ? 1 : 0;
  return null;
}

function countryName(code: string | null): string | null {
  if (!code) return null;
  return code.toUpperCase() === "US" ? "USA" : code;
}

export function normalizePlace(item: Item): NormalizedPlace | null {
  const placeId = str(item.placeId, item.place_id, item.googlePlaceId);
  if (!placeId) return null;

  const location = (item.location ?? {}) as Item;
  const categories = Array.isArray(item.categories) ? item.categories.filter((c) => typeof c === "string") : [];
  const primaryCategory = str(item.categoryName, item.category, categories[0]);
  const subCategory = categories.find((c) => c !== primaryCategory) ?? null;
  const phoneRaw = str(item.phoneUnformatted, item.phone, item.phoneNumber);
  const phoneE164 = toE164(phoneRaw);
  const address = str(item.address);
  const fromAddress = cityStateFromAddress(address);

  return {
    google_place_id: placeId,
    cid: str(item.cid),
    business_name: str(item.title, item.name),
    gbp_category: primaryCategory,
    sub_category: subCategory,
    gbp_phone_raw: phoneRaw,
    gbp_phone_formatted: phoneE164,
    phone_type: isTollFree(phoneE164) ? "toll_free" : null,
    website: str(item.website),
    gbp_url: str(item.url, item.googleMapsUrl),
    gbp_rank: num(item.rank, item.position),
    rating: num(item.totalScore, item.rating),
    review_count: num(item.reviewsCount, item.ratingCount),
    address,
    city: str(item.city) ?? fromAddress.city,
    state: stateCode(str(item.state)) ?? fromAddress.state,
    postal_code: str(item.postalCode),
    country: countryName(str(item.countryCode, item.country)),
    latitude: num(location.lat, item.latitude),
    longitude: num(location.lng, item.longitude),
    is_claimed: claimedFlag(item),
    permanently_closed: bool(item.permanentlyClosed) ? 1 : 0,
    temporarily_closed: bool(item.temporarilyClosed) ? 1 : 0,
    logo_url: str(item.logoUrl, item.thumbnailUrl, item.imageUrl),
  };
}
