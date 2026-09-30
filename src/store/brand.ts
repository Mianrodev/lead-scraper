// The store's brand and public switches, from the owner's settings (Admin page, "Online store").
import type { StoreEnv } from "./types";

export interface Brand {
  name: string;
  color: string;
  logoUrl: string;
  supportEmail: string;
  /** New companies can sign up at all. */
  signupOpen: boolean;
  /** open = start straight away; approval = the owner approves each new company. */
  signupMode: "open" | "approval";
  /** Search engines may list the public pages. */
  publicPages: boolean;
}

export async function storeBrand(env: StoreEnv): Promise<Brand> {
  const { results } = await env.DB.prepare(
    `SELECT key, value FROM app_settings WHERE key IN ('store_brand_name', 'store_brand_color', 'store_support_email', 'store_signup_open',
       'store_logo_url', 'store_signup_mode', 'store_public_pages')`,
  ).all<{ key: string; value: string }>();
  const v = Object.fromEntries(results.map((r) => [r.key, r.value ?? ""]));
  return {
    name: v.store_brand_name || "Lead Store",
    color: /^#[0-9a-f]{6}$/i.test(v.store_brand_color ?? "") ? v.store_brand_color : "#e4572e",
    logoUrl: v.store_logo_url ?? "",
    supportEmail: v.store_support_email ?? "",
    signupOpen: v.store_signup_open === "1",
    signupMode: v.store_signup_mode === "approval" ? "approval" : "open",
    publicPages: v.store_public_pages === "1",
  };
}
