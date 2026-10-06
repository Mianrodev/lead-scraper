// Card payments for credit packs with Stripe Checkout (Stripe's own payment page; no card
// details ever touch this app). Flow: the customer picks a pack -> we create a Checkout Session
// and send them to Stripe -> Stripe calls our webhook when the payment is confirmed -> the
// credits are added once (the session id is the key, so a repeated webhook can't add twice).
// Off until STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are set: docs/launch-setup.md.

import type { StoreAccount, StoreUser } from "./auth";
import { creditPacks } from "./launch";
import { StoreError, type StoreEnv } from "./types";

const STRIPE = "https://api.stripe.com/v1";
/** Stripe signs each webhook with a timestamp; older than this is refused (replays). */
const TOLERANCE_SECONDS = 300;

export function paymentsReady(env: StoreEnv): boolean {
  return !!env.STRIPE_SECRET_KEY && !!env.STRIPE_WEBHOOK_SECRET;
}

/** Form encoding with Stripe's bracket names (line_items[0][price_data][currency]=usd). */
function form(fields: Record<string, string | number>): string {
  return Object.entries(fields).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
}

async function stripe(env: StoreEnv, path: string, body?: Record<string, string | number>) {
  let res: Response;
  try {
    res = await fetch(`${STRIPE}${path}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      body: body ? form(body) : undefined,
    });
  } catch {
    throw new StoreError("Card payments aren't reachable right now. Please try again in a minute.", 409);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    console.error("stripe error", res.status, (data.error as { message?: string } | undefined)?.message);
    throw new StoreError("Card payments couldn't start. Please try again, or contact us.", 409);
  }
  return data;
}

/** Starts paying for a pack: returns Stripe's payment page address. */
export async function startCheckout(env: StoreEnv, account: StoreAccount, user: StoreUser, packCredits: unknown, origin: string) {
  if (!paymentsReady(env)) throw new StoreError("Card payments aren't switched on yet. Contact us to buy credits.", 409);
  if (account.status === "suspended") throw new StoreError("Your account is paused. Contact us.", 403);
  const packs = await creditPacks(env.DB);
  const pack = packs.find((p) => p.credits === Number(packCredits));
  if (!pack) throw new StoreError("Pick one of the credit packs.");
  const cents = Math.round(pack.price * 100);
  const session = await stripe(env, "/checkout/sessions", {
    mode: "payment",
    success_url: `${origin}/app#credits?paid={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/app#credits`,
    client_reference_id: account.id,
    customer_email: user.email,
    "line_items[0][quantity]": 1,
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": cents,
    "line_items[0][price_data][product_data][name]": `${pack.credits.toLocaleString("en-US")} credits`,
    "metadata[account_id]": account.id,
    "metadata[credits]": pack.credits,
    "payment_intent_data[metadata][account_id]": account.id,
  });
  const id = String(session.id ?? ""), url = String(session.url ?? "");
  if (!/^cs_[A-Za-z0-9_]+$/.test(id) || !url.startsWith("https://")) throw new StoreError("Card payments couldn't start. Please try again.", 409);
  await env.DB.prepare(`INSERT INTO store_payments (id, account_id, user_id, credits, amount_cents, currency) VALUES (?, ?, ?, ?, ?, 'usd')`)
    .bind(id, account.id, user.id, pack.credits, cents).run();
  return { url };
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
async function hmac(secret: string, text: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
}
function sameText(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Checks the Stripe-Signature header (t=...,v1=...) against the raw body. */
export async function verifyStripeSignature(secret: string, header: string | undefined, rawBody: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!secret || !header) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
  if (!t || !/^\d+$/.test(t) || !sigs.length || Math.abs(nowSeconds - Number(t)) > TOLERANCE_SECONDS) return false;
  const want = await hmac(secret, `${t}.${rawBody}`);
  return sigs.some((s) => sameText(s, want));
}

interface CheckoutSession { id?: string; payment_status?: string; amount_total?: number; currency?: string; client_reference_id?: string }

/**
 * Adds the credits for a paid session, exactly once. One transaction: the credits, the history
 * line and "paid" only happen while the payment is still open, so a repeated call does nothing.
 */
export async function creditPaidSession(env: StoreEnv, s: CheckoutSession): Promise<"credited" | "already" | "unknown" | "mismatch" | "unpaid"> {
  if (!s.id || s.payment_status !== "paid") return "unpaid";
  const p = await env.DB.prepare(`SELECT p.account_id, p.credits, p.amount_cents, p.currency, p.status, a.company FROM store_payments p JOIN store_accounts a ON a.id = p.account_id WHERE p.id = ?`)
    .bind(s.id).first<{ account_id: string; credits: number; amount_cents: number; currency: string; status: string; company: string }>();
  if (!p) return "unknown";
  if (p.status === "paid") return "already";
  if (s.amount_total !== p.amount_cents || (s.currency ?? "").toLowerCase() !== p.currency || s.client_reference_id !== p.account_id) {
    await notifyOwner(env, "error", `A store payment didn't match what was ordered (${s.id}). No credits were added: check it in Stripe.`, `store-pay-mismatch:${s.id}`);
    return "mismatch";
  }
  const note = `Bought ${p.credits.toLocaleString("en-US")} credits ($${(p.amount_cents / 100).toFixed(2)}, card)`;
  const res = await env.DB.batch([
    env.DB.prepare(`UPDATE store_accounts SET credits = credits + ? WHERE id = ? AND EXISTS (SELECT 1 FROM store_payments WHERE id = ? AND status = 'open')`)
      .bind(p.credits, p.account_id, s.id),
    env.DB.prepare(`INSERT INTO store_ledger (account_id, delta, balance, kind, note, created_by)
      SELECT ?, ?, (SELECT credits FROM store_accounts WHERE id = ?), 'payment', ?, (SELECT user_id FROM store_payments WHERE id = ?)
      WHERE EXISTS (SELECT 1 FROM store_payments WHERE id = ? AND status = 'open')`)
      .bind(p.account_id, p.credits, p.account_id, note, s.id, s.id),
    env.DB.prepare(`UPDATE store_payments SET status = 'paid', paid_at = datetime('now') WHERE id = ? AND status = 'open'`).bind(s.id),
  ]);
  if (!(res[2].meta.changes ?? 0)) return "already";
  await notifyOwner(env, "info", `Store payment: ${p.company} bought ${p.credits.toLocaleString("en-US")} credits for $${(p.amount_cents / 100).toFixed(2)}.`, null);
  return "credited";
}

/** A note on the owner's bell in the internal app (same database). */
export async function notifyOwner(env: StoreEnv, level: "info" | "warn" | "error", message: string, dedupeKey: string | null) {
  if (dedupeKey && await env.DB.prepare(`SELECT 1 AS x FROM notifications WHERE dedupe_key = ? AND dismissed_at IS NULL`).bind(dedupeKey).first()) return;
  await env.DB.prepare(`INSERT INTO notifications (level, kind, message, dedupe_key) VALUES (?, 'store', ?, ?)`).bind(level, message.slice(0, 500), dedupeKey).run();
}

/** Stripe's webhook: checks the signature, then credits paid sessions and closes expired ones. */
export async function handleStripeWebhook(env: StoreEnv, rawBody: string, signature: string | undefined): Promise<{ status: number; body: string }> {
  if (!paymentsReady(env)) return { status: 404, body: "not configured" };
  if (!(await verifyStripeSignature(env.STRIPE_WEBHOOK_SECRET!, signature, rawBody))) return { status: 400, body: "bad signature" };
  let event: { type?: string; data?: { object?: CheckoutSession } };
  try { event = JSON.parse(rawBody); } catch { return { status: 400, body: "bad json" }; }
  const s = event.data?.object ?? {};
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const r = await creditPaidSession(env, s);
    return { status: 200, body: r };
  }
  if (event.type === "checkout.session.expired" && s.id) {
    await env.DB.prepare(`UPDATE store_payments SET status = 'expired' WHERE id = ? AND status = 'open'`).bind(s.id).run();
  }
  return { status: 200, body: "ok" };
}

/**
 * After coming back from Stripe: has this payment arrived? If the webhook is late, ask Stripe
 * directly (same once-only crediting), so the customer sees their credits straight away.
 */
export async function paymentStatus(env: StoreEnv, account: StoreAccount, id: string) {
  if (!/^cs_[A-Za-z0-9_]+$/.test(id)) throw new StoreError("Payment not found.", 404);
  const p = await env.DB.prepare(`SELECT status, credits FROM store_payments WHERE id = ? AND account_id = ?`).bind(id, account.id).first<{ status: string; credits: number }>();
  if (!p) throw new StoreError("Payment not found.", 404);
  if (p.status === "open" && paymentsReady(env)) {
    const s = (await stripe(env, `/checkout/sessions/${encodeURIComponent(id)}`).catch(() => null)) as CheckoutSession | null;
    if (s && s.payment_status === "paid") await creditPaidSession(env, s);
  }
  const now = await env.DB.prepare(`SELECT p.status, p.credits, a.credits AS balance FROM store_payments p JOIN store_accounts a ON a.id = p.account_id WHERE p.id = ?`)
    .bind(id).first<{ status: string; credits: number; balance: number }>();
  return { status: now?.status ?? "open", credits: now?.credits ?? 0, balance: now?.balance ?? account.credits };
}

/** The account's card payments (Credits tab). */
export async function listPayments(env: StoreEnv, account: StoreAccount) {
  const { results } = await env.DB.prepare(
    `SELECT id, credits, amount_cents, status, created_at, paid_at FROM store_payments WHERE account_id = ? AND status = 'paid' ORDER BY paid_at DESC LIMIT 50`,
  ).bind(account.id).all<{ id: string; credits: number; amount_cents: number; status: string; created_at: string; paid_at: string }>();
  return results.map((r) => ({ credits: r.credits, amount: r.amount_cents / 100, at: r.paid_at }));
}
