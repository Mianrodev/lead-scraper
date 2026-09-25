// DataForSEO Business Listings Search adapter.
// Docs: https://docs.dataforseo.com/v3/business_data/business_listings/search/live/
// Pricing (checked 2026-09-24): $0.012 per task + $0.00036 per returned item.

import { stateCode } from "../format";
import { hasStreetAddress, toE164, websiteDomain, type NormalizedPlace } from "../normalize";
import { isTollFree } from "../phone";
import { industryOf } from "../taxonomy";
import { ProviderBlockedError, type BusinessSearchRequest, type BusinessSource } from "./types";

export const DATAFORSEO_LISTINGS_ENDPOINT = "https://api.dataforseo.com/v3/business_data/business_listings/search/live";
export const DATAFORSEO_USER_DATA_ENDPOINT = "https://api.dataforseo.com/v3/appendix/user_data";
export const DATAFORSEO_PRICE_PER_TASK = 0.012;
export const DATAFORSEO_PRICE_PER_ITEM = 0.00036;

export function dataforseoMaxCost(limit: number): number {
  return DATAFORSEO_PRICE_PER_TASK + limit * DATAFORSEO_PRICE_PER_ITEM;
}

export interface DataForSeoItem {
  title?: string | null;
  place_id?: string | null;
  cid?: string | null;
  phone?: string | null;
  url?: string | null;
  domain?: string | null;
  category?: string | null;
  additional_categories?: string[] | null;
  address?: string | null;
  address_info?: {
    city?: string | null;
    region?: string | null;
    zip?: string | null;
    country_code?: string | null;
    borough?: string | null;
  } | null;
  rating?: { value?: number | null; votes_count?: number | null } | null;
  is_claimed?: boolean | null;
  latitude?: number | null;
  longitude?: number | null;
  logo?: string | null;
  main_image?: string | null;
}

interface DataForSeoResponse {
  status_code?: number;
  status_message?: string;
  cost?: number;
  tasks?: {
    status_code?: number;
    status_message?: string;
    cost?: number;
    result?: { total_count?: number; items?: DataForSeoItem[] | null }[] | null;
  }[];
}

export function dataforseoTaskBody(req: BusinessSearchRequest) {
  return [
    {
      categories: [req.category],
      location_coordinate: `${req.latitude.toFixed(7)},${req.longitude.toFixed(7)},${req.radiusKm}`,
      ...(req.claimedOnly ? { is_claimed: true } : {}),
      order_by: ["rating.votes_count,desc"],
      limit: req.limit,
    },
  ];
}

export function basicAuth(login: string, password: string): string {
  return `Basic ${btoa(`${login}:${password}`)}`;
}

/** Maps a DataForSEO item onto the same record shape the Apify pipeline stores. */
export function dataforseoItemToPlace(item: DataForSeoItem, rank: number): NormalizedPlace | null {
  if (!item.place_id) return null;
  const phoneE164 = toE164(item.phone ?? null);
  const categories = [item.category, ...(item.additional_categories ?? [])].filter((c): c is string => !!c);
  const website = item.url ?? (item.domain ? `https://${item.domain}` : null);
  return {
    google_place_id: item.place_id,
    cid: item.cid ?? null,
    business_name: item.title ?? null,
    gbp_category: item.category ?? null,
    sub_category: categories.find((c) => c !== item.category) ?? null,
    gbp_phone_raw: item.phone ?? null,
    gbp_phone_formatted: phoneE164,
    phone_type: isTollFree(phoneE164) ? "toll_free" : null,
    website,
    gbp_url: item.cid ? `https://maps.google.com/?cid=${item.cid}` : null,
    gbp_rank: rank,
    rating: item.rating?.value ?? null,
    review_count: item.rating?.votes_count ?? null,
    address: item.address ?? null,
    city: item.address_info?.city ?? null,
    state: stateCode(item.address_info?.region ?? null),
    neighborhood: item.address_info?.borough ?? null,
    postal_code: item.address_info?.zip ?? null,
    country: item.address_info?.country_code?.toUpperCase() === "US" ? "USA" : (item.address_info?.country_code ?? null),
    latitude: item.latitude ?? null,
    longitude: item.longitude ?? null,
    is_claimed: item.is_claimed == null ? null : item.is_claimed ? 1 : 0,
    permanently_closed: 0,
    temporarily_closed: 0,
    business_status: "operational",
    website_domain: websiteDomain(website),
    has_street_address: hasStreetAddress({}, item.address ?? null),
    industry: industryOf(item.category ?? null),
    price_level: null,
    photos_count: null,
    attributes: [],
    logo_url: item.logo ?? item.main_image ?? null,
  };
}

export function dataforseoSource(login: string, password: string): BusinessSource {
  return {
    name: "DataForSEO Business Listings",
    async search(req) {
      const res = await fetch(DATAFORSEO_LISTINGS_ENDPOINT, {
        method: "POST",
        headers: { Authorization: basicAuth(login, password), "Content-Type": "application/json" },
        body: JSON.stringify(dataforseoTaskBody(req)),
        signal: AbortSignal.timeout(60_000),
      });
      const text = await res.text();
      if (res.status === 401 || res.status === 402 || res.status === 403) {
        throw new ProviderBlockedError(`DataForSEO ${res.status}: ${text.slice(0, 300)}`);
      }
      if (!res.ok) throw new Error(`DataForSEO ${res.status}: ${text.slice(0, 300)}`);
      const raw = JSON.parse(text) as DataForSeoResponse;
      const task = raw.tasks?.[0];
      // 402xx / 403xx task codes mean balance or access problems.
      if (task && task.status_code !== 20000) {
        const message = `DataForSEO task ${task.status_code}: ${task.status_message}`;
        if (String(task.status_code).startsWith("402") || String(task.status_code).startsWith("403")) {
          throw new ProviderBlockedError(message);
        }
        throw new Error(message);
      }
      const items = task?.result?.[0]?.items ?? [];
      const places = items
        .map((item, i) => dataforseoItemToPlace(item, i + 1))
        .filter((p): p is NormalizedPlace => p !== null);
      return { places, costUsd: raw.cost ?? task?.cost ?? null, raw };
    },
  };
}
