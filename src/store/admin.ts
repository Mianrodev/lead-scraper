// Lead Store owner console (internal app, super admin only): store settings, customer
// accounts, credits, password resets and sales numbers. Routes live in src/index.ts under
// /api/store/*. See docs/store-api.md ("Owner console").

import { hashPassword } from "../auth";
import { ValidationError } from "../pipeline";

export interface StoreSettings {
  priceFree: number;
  priceGoogle: number;
  brandName: string;
  brandColor: string;
  supportEmail: string;
  signupOpen: boolean;
  welcomeCredits: number;
  storeUrl: string;
  /** https address of the logo image shown in the store's header (optional). */
  logoUrl: string;
}

const SETTING_KEYS = {
  priceFree: "store_price_free",
  priceGoogle: "store_price_google",
  brandName: "store_brand_name",
  brandColor: "store_brand_color",
  supportEmail: "store_support_email",
  signupOpen: "store_signup_open",
  welcomeCredits: "store_welcome_credits",
  storeUrl: "store_url",
  logoUrl: "store_logo_url",
} as const;

const DEFAULTS: StoreSettings = {
  priceFree: 1, priceGoogle: 3, brandName: "Lead Store", brandColor: "#e4572e",
  supportEmail: "", signupOpen: false, welcomeCredits: 0, storeUrl: "", logoUrl: "",
};

const MAX_WELCOME = 100_000;
/** Biggest single credit change the owner can make at once. */
const MAX_DELTA = 1_000_000;

export async function storeSettings(env: Env): Promise<StoreSettings> {
  const keys = Object.values(SETTING_KEYS);
  const { results } = await env.DB.prepare(`SELECT key, value FROM app_settings WHERE key IN (${keys.map(() => "?").join(", ")})`)
    .bind(...keys).all<{ key: string; value: string | null }>();
  const v = Object.fromEntries(results.map((r) => [r.key, r.value ?? ""])) as Record<string, string | undefined>;
  const num = (s: string | undefined, d: number) => (s != null && s !== "" && Number.isFinite(Number(s)) ? Math.trunc(Number(s)) : d);
  return {
    priceFree: num(v.store_price_free, DEFAULTS.priceFree),
    priceGoogle: num(v.store_price_google, DEFAULTS.priceGoogle),
    brandName: v.store_brand_name || DEFAULTS.brandName,
    brandColor: v.store_brand_color || DEFAULTS.brandColor,
    supportEmail: v.store_support_email ?? "",
    signupOpen: v.store_signup_open == null ? DEFAULTS.signupOpen : v.store_signup_open === "1",
    welcomeCredits: num(v.store_welcome_credits, DEFAULTS.welcomeCredits),
    storeUrl: v.store_url ?? "",
    logoUrl: v.store_logo_url ?? "",
  };
}

function wholeNumber(value: unknown, label: string, min: number, max: number): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    throw new ValidationError(`${label} must be a whole number from ${min} to ${max.toLocaleString("en-US")}.`);
  }
  return n;
}

/** Checks the settings and returns them cleaned up (throws ValidationError with a plain message). */
export function validateStoreSettings(input: Partial<Record<keyof StoreSettings, unknown>>): StoreSettings {
  const text = (s: unknown, n: number) => (typeof s === "string" ? s.trim().slice(0, n) : "");
  const priceFree = wholeNumber(input.priceFree, "The price of a standard lead", 0, 1000);
  const priceGoogle = wholeNumber(input.priceGoogle, "The price of a premium Google lead", 0, 1000);
  const welcomeCredits = wholeNumber(input.welcomeCredits ?? 0, "Welcome credits", 0, MAX_WELCOME);
  const brandName = text(input.brandName, 60) || DEFAULTS.brandName;
  let brandColor = text(input.brandColor, 7) || DEFAULTS.brandColor;
  if (!brandColor.startsWith("#")) brandColor = `#${brandColor}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(brandColor)) throw new ValidationError("The brand color must look like #4f46e5.");
  const supportEmail = text(input.supportEmail, 200);
  if (supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)) throw new ValidationError("The support email doesn't look like an email address.");
  let storeUrl = text(input.storeUrl, 200);
  if (storeUrl && !/^https?:\/\//i.test(storeUrl)) storeUrl = `https://${storeUrl}`;
  if (storeUrl) {
    try {
      const u = new URL(storeUrl);
      if (!u.hostname.includes(".") && u.hostname !== "localhost") throw new Error();
    } catch {
      throw new ValidationError("The store web address doesn't look right (example: https://leads.example.com).");
    }
  }
  const logoUrl = text(input.logoUrl, 500);
  if (logoUrl) {
    let ok = false;
    try { ok = new URL(logoUrl).protocol === "https:"; } catch { ok = false; }
    if (!ok) throw new ValidationError("The logo must be an image web address starting with https://");
  }
  const signupOpen = input.signupOpen === true || input.signupOpen === "1" || input.signupOpen === 1;
  return { priceFree, priceGoogle, brandName, brandColor: brandColor.toLowerCase(), supportEmail, signupOpen, welcomeCredits, storeUrl, logoUrl };
}

export async function saveStoreSettings(env: Env, input: Partial<Record<keyof StoreSettings, unknown>>): Promise<StoreSettings> {
  const s = validateStoreSettings(input);
  const values: Record<string, string> = {
    [SETTING_KEYS.priceFree]: String(s.priceFree),
    [SETTING_KEYS.priceGoogle]: String(s.priceGoogle),
    [SETTING_KEYS.brandName]: s.brandName,
    [SETTING_KEYS.brandColor]: s.brandColor,
    [SETTING_KEYS.supportEmail]: s.supportEmail,
    [SETTING_KEYS.signupOpen]: s.signupOpen ? "1" : "0",
    [SETTING_KEYS.welcomeCredits]: String(s.welcomeCredits),
    [SETTING_KEYS.storeUrl]: s.storeUrl,
    [SETTING_KEYS.logoUrl]: s.logoUrl,
  };
  await env.DB.batch(Object.entries(values).map(([k, v]) => env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).bind(k, v)));
  return s;
}

export interface StoreAccountRow {
  id: string;
  company: string;
  status: string;
  credits: number;
  createdAt: string;
  approvedAt: string | null;
  users: { name: string | null; email: string }[];
  leadsBought: number;
  creditsSpent: number;
  lastPurchaseAt: string | null;
}

/** Every customer company, pending ones first, then newest. */
export async function listStoreAccounts(env: Env): Promise<StoreAccountRow[]> {
  const [accounts, users] = await env.DB.batch([
    env.DB.prepare(
      `SELECT a.id, a.company, a.status, a.credits, a.created_at, a.approved_at,
              p.n AS leads_bought, p.spent AS credits_spent, p.last_at AS last_purchase_at
         FROM store_accounts a
         LEFT JOIN (SELECT account_id, COUNT(*) AS n, SUM(credits) AS spent, MAX(purchased_at) AS last_at
                      FROM store_purchases GROUP BY account_id) p ON p.account_id = a.id
        ORDER BY CASE a.status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, a.created_at DESC
        LIMIT 1000`,
    ),
    env.DB.prepare(`SELECT account_id, name, email FROM store_users ORDER BY created_at, rowid`),
  ]);
  const byAccount = new Map<string, { name: string | null; email: string }[]>();
  for (const u of (users.results ?? []) as { account_id: string; name: string | null; email: string }[]) {
    const list = byAccount.get(u.account_id) ?? [];
    list.push({ name: u.name, email: u.email });
    byAccount.set(u.account_id, list);
  }
  type Row = { id: string; company: string; status: string; credits: number; created_at: string; approved_at: string | null; leads_bought: number | null; credits_spent: number | null; last_purchase_at: string | null };
  return ((accounts.results ?? []) as Row[]).map((a) => ({
    id: a.id,
    company: a.company,
    status: a.status,
    credits: Number(a.credits) || 0,
    createdAt: a.created_at,
    approvedAt: a.approved_at,
    users: byAccount.get(a.id) ?? [],
    leadsBought: Number(a.leads_bought) || 0,
    creditsSpent: Number(a.credits_spent) || 0,
    lastPurchaseAt: a.last_purchase_at,
  }));
}

/**
 * Approve (active) or pause (suspended) an account. The first approval gives the welcome
 * credits once (welcome_given), with a 'grant' ledger row. Returns null when there's no such
 * account, otherwise the new status, balance and the welcome credits given now.
 */
export async function setStoreAccountStatus(env: Env, id: string, status: unknown, byUserId: string | null) {
  if (status !== "active" && status !== "suspended") throw new ValidationError("Status must be active or suspended.");
  const before = await env.DB.prepare(`SELECT status, welcome_given FROM store_accounts WHERE id = ?`).bind(id).first<{ status: string; welcome_given: number }>();
  if (!before) return null;
  if (status === "suspended") {
    await env.DB.prepare(`UPDATE store_accounts SET status = 'suspended' WHERE id = ?`).bind(id).run();
    const credits = await env.DB.prepare(`SELECT credits FROM store_accounts WHERE id = ?`).bind(id).first<number>("credits");
    return { status, previous: before.status, credits: Number(credits) || 0, welcomeGiven: 0 };
  }
  const welcome = (await storeSettings(env)).welcomeCredits;
  // One transaction: the ledger row is written only while welcome_given is still 0, and the
  // update sets it, so the welcome credits can't be given twice.
  const [ledger] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO store_ledger (account_id, delta, balance, kind, note, created_by)
       SELECT id, ?, credits + ?, 'grant', 'Welcome credits', ? FROM store_accounts WHERE id = ? AND welcome_given = 0 AND ? > 0
       RETURNING delta`,
    ).bind(welcome, welcome, byUserId, id, welcome),
    env.DB.prepare(
      `UPDATE store_accounts SET status = 'active', approved_at = COALESCE(approved_at, datetime('now')),
              credits = credits + CASE WHEN welcome_given = 0 THEN ? ELSE 0 END, welcome_given = 1
        WHERE id = ?`,
    ).bind(welcome, id),
  ]);
  const given = Number((ledger.results?.[0] as { delta?: number } | undefined)?.delta ?? 0);
  const credits = await env.DB.prepare(`SELECT credits FROM store_accounts WHERE id = ?`).bind(id).first<number>("credits");
  return { status, previous: before.status, credits: Number(credits) || 0, welcomeGiven: given };
}

/**
 * Add (positive) or take away (negative) credits. Never lets the balance go below 0.
 * Returns null when there's no such account.
 */
export async function changeStoreCredits(env: Env, id: string, deltaIn: unknown, noteIn: unknown, byUserId: string | null) {
  const delta = typeof deltaIn === "string" && deltaIn.trim() !== "" ? Number(deltaIn) : deltaIn;
  if (typeof delta !== "number" || !Number.isInteger(delta) || delta === 0 || Math.abs(delta) > MAX_DELTA) {
    throw new ValidationError(`Enter a whole number of credits (not 0, at most ${MAX_DELTA.toLocaleString("en-US")}); use a minus sign to take credits away.`);
  }
  const note = typeof noteIn === "string" ? noteIn.trim().slice(0, 300) : "";
  const kind = delta > 0 ? "grant" : "adjust";
  // One transaction; the ledger row uses the same condition as the update, evaluated on the
  // same balance, so a row is written exactly when the balance changes.
  const [, upd] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO store_ledger (account_id, delta, balance, kind, note, created_by)
       SELECT id, ?, credits + ?, ?, ?, ? FROM store_accounts WHERE id = ? AND credits + ? >= 0`,
    ).bind(delta, delta, kind, note || null, byUserId, id, delta),
    env.DB.prepare(`UPDATE store_accounts SET credits = credits + ? WHERE id = ? AND credits + ? >= 0 RETURNING credits`).bind(delta, id, delta),
  ]);
  const row = upd.results?.[0] as { credits: number } | undefined;
  if (row) return { balance: Number(row.credits) };
  const current = await env.DB.prepare(`SELECT credits FROM store_accounts WHERE id = ?`).bind(id).first<number>("credits");
  if (current == null) return null;
  throw new ValidationError(`That would take the balance below 0 (they have ${Number(current).toLocaleString("en-US")} credits).`);
}

const PASSWORD_CHARS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function temporaryPassword(length = 14): string {
  const out: string[] = [];
  // Rejection sampling so every character is equally likely.
  const limit = 256 - (256 % PASSWORD_CHARS.length);
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (b < limit && out.length < length) out.push(PASSWORD_CHARS[b % PASSWORD_CHARS.length]);
    }
  }
  return out.join("");
}

/**
 * Give one of an account's users a new temporary password (they must change it at next sign-in)
 * and sign them out everywhere. Returns null when that email isn't a user of this account.
 */
export async function resetStorePassword(env: Env, accountId: string, emailIn: unknown) {
  const email = typeof emailIn === "string" ? emailIn.trim().toLowerCase() : "";
  if (!email) throw new ValidationError("Choose whose password to reset.");
  const user = await env.DB.prepare(`SELECT id, email FROM store_users WHERE account_id = ? AND lower(email) = ?`).bind(accountId, email).first<{ id: string; email: string }>();
  if (!user) return null;
  const password = temporaryPassword();
  const { hash, salt, iterations } = await hashPassword(password);
  await env.DB.batch([
    env.DB.prepare(`UPDATE store_users SET password_hash = ?, password_salt = ?, password_iterations = ?, must_change_password = 1 WHERE id = ?`)
      .bind(hash, salt, iterations, user.id),
    env.DB.prepare(`DELETE FROM store_sessions WHERE user_id = ?`).bind(user.id),
  ]);
  return { password, email: user.email };
}

export interface StoreStats {
  accounts: { pending: number; active: number; suspended: number };
  leadsSold: number;
  creditsSpent: number;
  creditsGranted: number;
  byDay: { day: string; leads: number; credits: number }[];
}

/** Sales numbers: totals, account counts, and the last 30 days day by day (UTC, every day listed). */
export async function storeStats(env: Env, now = new Date()): Promise<StoreStats> {
  const [statuses, totals, granted, days] = await env.DB.batch([
    env.DB.prepare(`SELECT status, COUNT(*) AS n FROM store_accounts GROUP BY status`),
    env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(credits), 0) AS spent FROM store_purchases`),
    env.DB.prepare(`SELECT COALESCE(SUM(delta), 0) AS granted FROM store_ledger WHERE kind = 'grant'`),
    env.DB.prepare(
      `SELECT substr(purchased_at, 1, 10) AS day, COUNT(*) AS leads, COALESCE(SUM(credits), 0) AS credits
         FROM store_purchases WHERE purchased_at >= ? GROUP BY day ORDER BY day`,
    ).bind(new Date(now.getTime() - 29 * 86_400_000).toISOString().slice(0, 10)),
  ]);
  const accounts = { pending: 0, active: 0, suspended: 0 };
  for (const r of (statuses.results ?? []) as { status: string; n: number }[]) {
    if (r.status in accounts) accounts[r.status as keyof typeof accounts] = Number(r.n) || 0;
  }
  const t = (totals.results?.[0] ?? {}) as { n?: number; spent?: number };
  const g = (granted.results?.[0] ?? {}) as { granted?: number };
  const found = new Map(((days.results ?? []) as { day: string; leads: number; credits: number }[]).map((d) => [d.day, d]));
  const byDay: StoreStats["byDay"] = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    const d = found.get(day);
    byDay.push({ day, leads: Number(d?.leads) || 0, credits: Number(d?.credits) || 0 });
  }
  return { accounts, leadsSold: Number(t.n) || 0, creditsSpent: Number(t.spent) || 0, creditsGranted: Number(g.granted) || 0, byDay };
}
