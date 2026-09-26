// Maps one Google Maps actor dataset item onto lead columns. Field names differ
// slightly between actors, so each value falls back through the known aliases.

import { cityStateFromAddress, stateCode } from "./format";
import { isTollFree } from "./phone";
import { industryOf } from "./taxonomy";

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
  neighborhood: string | null;
  postal_code: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  is_claimed: 0 | 1 | null;
  permanently_closed: 0 | 1;
  temporarily_closed: 0 | 1;
  business_status: BusinessStatus;
  /** Host used for "one business per website"; null for no site or a shared platform. */
  website_domain: string | null;
  /** 1 storefront/office with a street address, 0 service-area business (no address shown). */
  has_street_address: 0 | 1;
  /** Industry from the category list; null if the category isn't in it. */
  industry: string | null;
  /** "$" to "$$$$", or null. */
  price_level: string | null;
  photos_count: number | null;
  /** Google profile attributes that are switched on. Stored in lead_attributes. */
  attributes: { section: string; name: string }[];
  logo_url: string | null;
}

/** "$$" stays "$$"; anything else ("$10–20", "Inexpensive") becomes null. */
export function priceLevel(value: unknown): string | null {
  return typeof value === "string" && /^\${1,4}$/.test(value.trim()) ? value.trim() : null;
}

/**
 * Apify's additionalInfo looks like {"Service options": [{"Onsite services": true}], ...}.
 * Returns the attributes that are true, de-duplicated by name.
 */
export function profileAttributes(additionalInfo: unknown): { section: string; name: string }[] {
  if (!additionalInfo || typeof additionalInfo !== "object") return [];
  const out = new Map<string, { section: string; name: string }>();
  for (const [section, entries] of Object.entries(additionalInfo as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      for (const [name, on] of Object.entries(entry as Record<string, unknown>)) {
        const clean = name.trim();
        if (on === true && clean && !out.has(clean.toLowerCase())) out.set(clean.toLowerCase(), { section: section.trim(), name: clean });
      }
    }
  }
  return [...out.values()];
}

export type BusinessStatus = "operational" | "temporarily_closed" | "permanently_closed";

type Item = Record<string, unknown>;

// Sites many unrelated businesses share; deduping on these would merge different businesses.
const SHARED_HOSTS = new Set([
  "facebook.com", "m.facebook.com", "instagram.com", "linktr.ee", "sites.google.com", "google.com", "g.page",
  "business.google.com", "yelp.com", "nextdoor.com", "x.com", "twitter.com", "tiktok.com", "youtube.com",
  "linkedin.com", "angi.com", "homeadvisor.com", "thumbtack.com", "bbb.org", "yellowpages.com", "houzz.com",
]);

/** "https://www.Example.com/about?x=1" -> "example.com". Null for shared platforms or junk. */
export function websiteDomain(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`).hostname;
  } catch {
    return null;
  }
  host = host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  if (!host.includes(".") || SHARED_HOSTS.has(host)) return null;
  return host;
}

/**
 * Only normal web addresses are kept: "example.com" becomes "https://example.com", and
 * anything else (e.g. "javascript:…") is dropped, since it's shown as a clickable link.
 */
export function safeWebsite(url: string | null | undefined): string | null {
  const v = url?.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return null; // some other scheme
  return /^[\w-]+(\.[\w-]+)+([/?#].*)?$/i.test(v) ? `https://${v}` : null;
}

// The scraped fields the app reads (normalizePlace, the backfill and enrichment later).
// Everything else Google returns (reviews, photo lists, "people also search", popular
// times…) is most of the size and is dropped before saving.
export const KEPT_RAW_FIELDS = [
  "placeId", "place_id", "googlePlaceId", "cid", "title", "name", "subTitle", "description",
  "categoryName", "category", "categories", "phone", "phoneUnformatted", "phoneNumber", "website", "url", "googleMapsUrl",
  "rank", "position", "totalScore", "rating", "reviewsCount", "ratingCount", "address", "street", "city", "state",
  "neighborhood", "borough", "postalCode", "countryCode", "country", "location", "latitude", "longitude", "plusCode",
  "claimThisBusiness", "claim_this_business", "isClaimed", "claimed", "is_claimed", "verified", "isVerified",
  "permanentlyClosed", "temporarilyClosed", "price", "imagesCount", "photosCount", "additionalInfo", "openingHours",
  "logoUrl", "thumbnailUrl", "imageUrl", "domain", "scrapedAt",
];

/** The scraped item as saved: only the fields the app uses. */
export function compactRaw(item: Record<string, unknown>): string {
  const kept: Record<string, unknown> = {};
  for (const key of KEPT_RAW_FIELDS) if (item[key] !== undefined && item[key] !== null && item[key] !== "") kept[key] = item[key];
  return JSON.stringify(kept);
}

export function businessStatus(permanentlyClosed: boolean, temporarilyClosed: boolean): BusinessStatus {
  if (permanentlyClosed) return "permanently_closed";
  if (temporarilyClosed) return "temporarily_closed";
  return "operational";
}

/**
 * Service-area businesses (common for trades) hide their address on Google.
 * Apify reports `street` explicitly; otherwise a street address starts with a number.
 */
export function hasStreetAddress(item: Item, address: string | null): 0 | 1 {
  if ("street" in item) return str(item.street) ? 1 : 0;
  const firstPart = address?.split(",")[0]?.trim() ?? "";
  return /^\d/.test(firstPart) ? 1 : 0;
}

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

/**
 * Normalises a phone number to E.164 (+<country><number>). Numbers without a "+" are only
 * assumed to be North American when the business is in the US or Canada (or the country is
 * unknown); elsewhere they stay unformatted rather than being given the wrong country code.
 */
export function toE164(phone: string | null, countryCode?: string | null): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  const cc = (countryCode ?? "").toUpperCase();
  if (cc && cc !== "US" && cc !== "CA") return null;
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

export function normalizePlace(item: Item, searchCountry?: string | null): NormalizedPlace | null {
  const placeId = str(item.placeId, item.place_id, item.googlePlaceId);
  if (!placeId) return null;

  const location = (item.location ?? {}) as Item;
  const categories = Array.isArray(item.categories) ? item.categories.filter((c) => typeof c === "string") : [];
  const primaryCategory = str(item.categoryName, item.category, categories[0]);
  const subCategory = categories.find((c) => c !== primaryCategory) ?? null;
  const phoneRaw = str(item.phoneUnformatted, item.phone, item.phoneNumber);
  const phoneE164 = toE164(phoneRaw, str(item.countryCode) ?? searchCountry ?? null);
  const address = str(item.address);
  const fromAddress = cityStateFromAddress(address);
  const website = safeWebsite(str(item.website));
  const permanentlyClosed = bool(item.permanentlyClosed) === true;
  const temporarilyClosed = bool(item.temporarilyClosed) === true;

  return {
    google_place_id: placeId,
    cid: str(item.cid),
    business_name: str(item.title, item.name),
    gbp_category: primaryCategory,
    sub_category: subCategory,
    gbp_phone_raw: phoneRaw,
    gbp_phone_formatted: phoneE164,
    phone_type: isTollFree(phoneE164) ? "toll_free" : null,
    website,
    gbp_url: str(item.url, item.googleMapsUrl),
    gbp_rank: num(item.rank, item.position),
    rating: num(item.totalScore, item.rating),
    review_count: num(item.reviewsCount, item.ratingCount),
    address,
    city: str(item.city) ?? fromAddress.city,
    state: stateCode(str(item.state)) ?? fromAddress.state,
    neighborhood: str(item.neighborhood, item.borough),
    postal_code: str(item.postalCode),
    country: countryName(str(item.countryCode, item.country)),
    latitude: num(location.lat, item.latitude),
    longitude: num(location.lng, item.longitude),
    is_claimed: claimedFlag(item),
    permanently_closed: permanentlyClosed ? 1 : 0,
    temporarily_closed: temporarilyClosed ? 1 : 0,
    business_status: businessStatus(permanentlyClosed, temporarilyClosed),
    website_domain: websiteDomain(website),
    has_street_address: hasStreetAddress(item, address),
    industry: industryOf(primaryCategory),
    price_level: priceLevel(item.price),
    photos_count: num(item.imagesCount, item.photosCount),
    attributes: profileAttributes(item.additionalInfo),
    logo_url: str(item.logoUrl, item.thumbnailUrl, item.imageUrl),
  };
}
