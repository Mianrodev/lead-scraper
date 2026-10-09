// Getting the store ready to sell: credit packs, the email sender address, what the store Worker
// has switched on (payments, emails, spam protection), and the owner's launch checklist on the
// Admin page. Shared by both Workers (it only needs the database). Setup: docs/launch-setup.md.

import { ValidationError } from "../pipeline";

export interface CreditPack { credits: number; price: number }
export interface StoreFeatures { payments: boolean; email: boolean; turnstile: boolean; checkedAt?: string }

export const MAX_PACKS = 6;

async function settings(db: D1Database, keys: string[]): Promise<Record<string, string>> {
  const { results } = await db.prepare(`SELECT key, value FROM app_settings WHERE key IN (${keys.map(() => "?").join(", ")})`)
    .bind(...keys).all<{ key: string; value: string | null }>();
  return Object.fromEntries(results.map((r) => [r.key, r.value ?? ""]));
}
async function put(db: D1Database, values: Record<string, string>) {
  await db.batch(Object.entries(values).map(([k, v]) => db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).bind(k, v)));
}

/** The stored packs, cleaned (bad entries dropped), smallest first. */
export function parsePacks(json: string | null | undefined): CreditPack[] {
  let raw: unknown;
  try { raw = JSON.parse(json || "[]"); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => ({ credits: Number((p as CreditPack)?.credits), price: Number((p as CreditPack)?.price) }))
    .filter((p) => Number.isInteger(p.credits) && p.credits >= 1 && p.credits <= 1_000_000 && Number.isFinite(p.price) && p.price >= 0.5 && p.price <= 100_000)
    .map((p) => ({ credits: p.credits, price: Math.round(p.price * 100) / 100 }))
    .sort((a, b) => a.credits - b.credits)
    .slice(0, MAX_PACKS);
}

/** Checks the owner's packs: whole credits, a price of at least $0.50 (Stripe's minimum), up to 6. */
export function validatePacks(input: unknown): CreditPack[] {
  if (!Array.isArray(input)) throw new ValidationError("Credit packs must be a list.");
  if (input.length > MAX_PACKS) throw new ValidationError(`Up to ${MAX_PACKS} credit packs.`);
  const out: CreditPack[] = [];
  for (const p of input) {
    const credits = Number((p as CreditPack)?.credits), price = Number(String((p as CreditPack)?.price ?? "").replace(/^\$/, ""));
    if (!Number.isInteger(credits) || credits < 1 || credits > 1_000_000) throw new ValidationError("Each pack needs a whole number of credits (1 or more).");
    if (!Number.isFinite(price) || price < 0.5 || price > 100_000 || Math.abs(Math.round(price * 100) - price * 100) > 1e-6) {
      throw new ValidationError("Each pack needs a price in dollars of at least $0.50, with at most 2 decimals.");
    }
    out.push({ credits, price: Math.round(price * 100) / 100 });
  }
  if (new Set(out.map((p) => p.credits)).size !== out.length) throw new ValidationError("Two packs have the same number of credits.");
  return out.sort((a, b) => a.credits - b.credits);
}

export async function creditPacks(db: D1Database): Promise<CreditPack[]> {
  return parsePacks((await settings(db, ["store_credit_packs"])).store_credit_packs);
}

/** "Name <hello@example.com>" or "hello@example.com": the address emails are sent from. */
export function validEmailFrom(v: string): boolean {
  const s = v.trim();
  return /^[^<>@\s]+@[^<>@\s]+\.[a-z]{2,}$/i.test(s) || /^[^<>]{1,80} <[^<>@\s]+@[^<>@\s]+\.[a-z]{2,}>$/i.test(s);
}

export function parseFeatures(json: string | null | undefined): StoreFeatures {
  try {
    const f = JSON.parse(json || "{}") as Partial<StoreFeatures>;
    return { payments: f.payments === true, email: f.email === true, turnstile: f.turnstile === true, checkedAt: typeof f.checkedAt === "string" ? f.checkedAt : undefined };
  } catch { return { payments: false, email: false, turnstile: false }; }
}

// The store Worker notes what it has switched on, so the internal Admin page can show it. It only
// writes when something changed (checked at most every 10 minutes per Worker instance).
let lastNoted = { key: "", at: 0 };
export async function noteFeatures(db: D1Database, f: StoreFeatures, now = Date.now()) {
  const key = `${f.payments}|${f.email}|${f.turnstile}`;
  if (lastNoted.key === key && now - lastNoted.at < 600_000) return;
  lastNoted = { key, at: now };
  const cur = parseFeatures((await settings(db, ["store_features"])).store_features);
  if (cur.payments === f.payments && cur.email === f.email && cur.turnstile === f.turnstile && cur.checkedAt) return;
  await put(db, { store_features: JSON.stringify({ payments: f.payments, email: f.email, turnstile: f.turnstile, checkedAt: new Date(now).toISOString() }) });
}

export interface LaunchSettings { packs: CreditPack[]; emailFrom: string; legalReviewed: boolean; paidPlan: boolean }

export async function launchSettings(db: D1Database): Promise<LaunchSettings> {
  const v = await settings(db, ["store_credit_packs", "store_email_from", "store_legal_reviewed", "store_paid_plan"]);
  return { packs: parsePacks(v.store_credit_packs), emailFrom: v.store_email_from ?? "", legalReviewed: v.store_legal_reviewed === "1", paidPlan: v.store_paid_plan === "1" };
}

/** Saves only what the request includes. */
export async function saveLaunchSettings(db: D1Database, input: Partial<Record<keyof LaunchSettings, unknown>>): Promise<LaunchSettings> {
  const values: Record<string, string> = {};
  if ("packs" in input) values.store_credit_packs = JSON.stringify(validatePacks(input.packs));
  if ("emailFrom" in input) {
    const from = typeof input.emailFrom === "string" ? input.emailFrom.trim().slice(0, 160) : "";
    if (from && !validEmailFrom(from)) throw new ValidationError('The "send emails from" address should look like: Miami Goes Local <hello@yourdomain.com>');
    values.store_email_from = from;
  }
  if ("legalReviewed" in input) values.store_legal_reviewed = input.legalReviewed === true ? "1" : "0";
  if ("paidPlan" in input) values.store_paid_plan = input.paidPlan === true ? "1" : "0";
  if (Object.keys(values).length) await put(db, values);
  return launchSettings(db);
}

export interface LaunchItem { key: string; label: string; done: boolean; required: boolean; how: string }

/** The owner's launch checklist (Admin page → Online store), in the order to do things. */
export async function launchChecklist(db: D1Database): Promise<{ items: LaunchItem[]; ready: boolean; features: StoreFeatures; settings: LaunchSettings }> {
  const v = await settings(db, ["store_brand_name", "store_support_email", "store_credit_price", "store_url", "store_signup_open", "store_public_pages", "store_features"]);
  const ls = await launchSettings(db);
  const f = parseFeatures(v.store_features);
  let host = "";
  try { host = v.store_url ? new URL(v.store_url).hostname : ""; } catch { host = ""; }
  const items: LaunchItem[] = [
    { key: "brand", label: "Store name, color and logo", done: !!v.store_brand_name && v.store_brand_name !== "Lead Store", required: true,
      how: "Fill them in below (Online store settings)." },
    { key: "support", label: "Support email", done: !!v.store_support_email, required: true,
      how: "Customers use it to ask for help. Fill it in below." },
    { key: "creditPrice", label: "What one credit is worth (1 credit = $…)", done: !!v.store_credit_price, required: true,
      how: "Fill it in below, so customers see prices in dollars." },
    { key: "packs", label: "Credit packs customers can buy", done: ls.packs.length > 0, required: true,
      how: "Add at least one pack in “Selling credits” below, e.g. 100 credits for $50." },
    { key: "payments", label: "Card payments (Stripe)", done: f.payments, required: true,
      how: "Make a Stripe account, then ask your developer to connect it. Until then customers are asked to contact you for credits." },
    { key: "email", label: "Emails (forgot password, confirm email)", done: f.email && validEmailFrom(ls.emailFrom), required: true,
      how: f.email ? "Fill in “Send emails from” below with an address on your own domain." : "Make a free Resend account, then ask your developer to connect it." },
    { key: "turnstile", label: "Spam protection on sign-up", done: f.turnstile, required: true,
      how: "Free from Cloudflare. Ask your developer to switch it on." },
    { key: "domain", label: "Your own web address (e.g. leads.yourdomain.com)", done: !!host && !host.endsWith(".workers.dev"), required: true,
      how: "Pick a domain, ask your developer to connect it, then put the address in “Store web address” below." },
    { key: "paidPlan", label: "Cloudflare Workers Paid plan ($5 a month)", done: ls.paidPlan, required: true,
      how: "The free plan's daily database limits are too small for public customers. Switch it on in Cloudflare, then tick this." },
    { key: "legal", label: "Terms, privacy and data pages checked by a lawyer", done: ls.legalReviewed, required: true,
      how: "The pages on the website are drafts. Have a lawyer check them (and reselling Google data, data-broker registration, texting consent), then tick this." },
    { key: "signup", label: "Sign-ups switched on", done: v.store_signup_open === "1", required: true,
      how: "Tick “New companies can sign up” below when everything above is done." },
    { key: "seo", label: "Listed on Google and other search engines", done: v.store_public_pages === "1", required: false,
      how: "Tick “Let search engines list the public website” below on launch day." },
  ];
  return { items, ready: items.filter((i) => i.required).every((i) => i.done), features: f, settings: ls };
}

/** Card sales for the owner: totals and the latest payments. */
export async function storeRevenue(db: D1Database) {
  const [tot, recent] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents,
      COALESCE(SUM(CASE WHEN paid_at > datetime('now', '-30 days') THEN amount_cents END), 0) AS cents30 FROM store_payments WHERE status = 'paid'`),
    db.prepare(`SELECT p.credits, p.amount_cents, p.paid_at, a.company FROM store_payments p JOIN store_accounts a ON a.id = p.account_id
      WHERE p.status = 'paid' ORDER BY p.paid_at DESC LIMIT 20`),
  ]);
  const t = (tot.results[0] ?? {}) as { n?: number; cents?: number; cents30?: number };
  return {
    payments: t.n ?? 0, total: (t.cents ?? 0) / 100, last30: (t.cents30 ?? 0) / 100,
    recent: (recent.results as { credits: number; amount_cents: number; paid_at: string; company: string }[]).map((r) => ({ company: r.company, credits: r.credits, amount: r.amount_cents / 100, at: r.paid_at })),
  };
}