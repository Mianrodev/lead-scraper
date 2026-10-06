// Emails to store customers through Resend: a "reset your password" link and an "confirm your
// email" link (one-time, only a SHA-256 of each token is stored). Off until RESEND_API_KEY is set
// and the owner fills in "Send emails from" (Admin page): docs/launch-setup.md.

import { checkPasswordRules, hashPassword } from "../auth";
import { launchSettings, validEmailFrom } from "./launch";
import { StoreError, type StoreEnv } from "./types";
import { storeBrand } from "./brand";

const RESET_MINUTES = 60, VERIFY_HOURS = 48;

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The sender address when emails are switched on, else "". */
export async function emailFrom(env: StoreEnv): Promise<string> {
  if (!env.RESEND_API_KEY) return "";
  const from = (await launchSettings(env.DB)).emailFrom;
  return validEmailFrom(from) ? from : "";
}

async function send(env: StoreEnv, to: string, subject: string, lines: string[], link: { text: string; url: string }) {
  const from = await emailFrom(env);
  if (!from) throw new StoreError("Emails aren't switched on yet.", 409);
  const brand = await storeBrand(env);
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1B2A3A;max-width:520px">
<p style="font-size:18px;font-weight:bold;margin:0 0 16px">${esc(brand.name)}</p>
${lines.map((l) => `<p>${esc(l)}</p>`).join("")}
<p style="margin:24px 0"><a href="${esc(link.url)}" style="background:${esc(brand.color)};color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">${esc(link.text)}</a></p>
<p style="color:#4A5D72;font-size:13px">Or copy this address into your browser: ${esc(link.url)}</p>
<p style="color:#4A5D72;font-size:13px">If you didn't ask for this, you can ignore this email.</p></div>`;
  const text = [...lines, "", `${link.text}: ${link.url}`, "", "If you didn't ask for this, you can ignore this email."].join("\n");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html, text }),
  }).catch(() => null);
  if (!res || !res.ok) {
    console.error("resend error", res?.status, res ? await res.text().catch(() => "") : "unreachable");
    throw new StoreError("The email couldn't be sent. Please try again in a few minutes.", 409);
  }
}

async function newToken(env: StoreEnv, userId: string, purpose: "reset" | "verify", ttl: string): Promise<string> {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
  await env.DB.batch([
    // Only the newest link of each kind works.
    env.DB.prepare(`DELETE FROM store_tokens WHERE user_id = ? AND purpose = ?`).bind(userId, purpose),
    env.DB.prepare(`INSERT INTO store_tokens (token_hash, user_id, purpose, expires_at) VALUES (?, ?, ?, datetime('now', ?))`).bind(await sha256(token), userId, purpose, ttl),
  ]);
  return token;
}

/** At most one email of each kind per person every 2 minutes. */
async function tooSoon(env: StoreEnv, userId: string, purpose: string) {
  return !!(await env.DB.prepare(`SELECT 1 AS x FROM store_tokens WHERE user_id = ? AND purpose = ? AND created_at > datetime('now', '-2 minutes')`).bind(userId, purpose).first());
}

/** "Forgot password": always answers the same way, so it never reveals which emails have accounts. */
export async function requestPasswordReset(env: StoreEnv, emailInput: unknown, origin: string) {
  if (!(await emailFrom(env))) throw new StoreError("We can't email reset links yet. Contact us and we'll help you back in.", 409);
  const email = String(emailInput ?? "").trim().toLowerCase().slice(0, 160);
  const u = await env.DB.prepare(`SELECT id FROM store_users WHERE email = ?`).bind(email).first<{ id: string }>();
  if (u && !(await tooSoon(env, u.id, "reset"))) {
    const token = await newToken(env, u.id, "reset", `+${RESET_MINUTES} minutes`);
    await send(env, email, "Reset your password", [
      "Someone (hopefully you) asked to reset the password for this email address.",
      `The link works once, for ${RESET_MINUTES} minutes.`,
    ], { text: "Choose a new password", url: `${origin}/app#reset?t=${token}` });
  }
  return { ok: true };
}

async function useToken(env: StoreEnv, token: unknown, purpose: "reset" | "verify"): Promise<string> {
  const t = String(token ?? "");
  if (!/^[0-9a-f]{64}$/.test(t)) throw new StoreError("That link isn't valid. Ask for a new one.", 400);
  const row = await env.DB.prepare(
    `UPDATE store_tokens SET used_at = datetime('now') WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > datetime('now') RETURNING user_id`,
  ).bind(await sha256(t), purpose).first<{ user_id: string }>();
  if (!row) throw new StoreError(purpose === "reset" ? "That reset link has expired or was already used. Ask for a new one." : "That link has expired or was already used. Sign in and ask for a new one.", 400);
  return row.user_id;
}

/** Sets the new password from a reset link and signs out every session (the link proves the inbox too). */
export async function resetPassword(env: StoreEnv, token: unknown, password: unknown) {
  try { checkPasswordRules(String(password ?? "")); } catch (err) { throw new StoreError(err instanceof Error ? err.message : "Choose a longer password."); }
  const userId = await useToken(env, token, "reset");
  const h = await hashPassword(String(password));
  await env.DB.batch([
    env.DB.prepare(`UPDATE store_users SET password_hash = ?, password_salt = ?, password_iterations = ?, must_change_password = 0, email_verified_at = COALESCE(email_verified_at, datetime('now')) WHERE id = ?`)
      .bind(h.hash, h.salt, h.iterations, userId),
    env.DB.prepare(`DELETE FROM store_sessions WHERE user_id = ?`).bind(userId),
  ]);
  return { ok: true };
}

/** Sends the "confirm your email" link (after sign-up, or "send it again"). */
export async function sendVerification(env: StoreEnv, userId: string, email: string, origin: string, force = false) {
  if (!(await emailFrom(env))) return { sent: false };
  if (!force && (await tooSoon(env, userId, "verify"))) throw new StoreError("We just sent one. Check your inbox (and spam), or try again in 2 minutes.", 429);
  const token = await newToken(env, userId, "verify", `+${VERIFY_HOURS} hours`);
  await send(env, email, "Confirm your email", [
    "Thanks for signing up. Please confirm this is your email address.",
    "Once it's confirmed you can unlock leads.",
  ], { text: "Confirm my email", url: `${origin}/app#verify?t=${token}` });
  return { sent: true };
}

export async function confirmEmail(env: StoreEnv, token: unknown) {
  const userId = await useToken(env, token, "verify");
  await env.DB.prepare(`UPDATE store_users SET email_verified_at = COALESCE(email_verified_at, datetime('now')) WHERE id = ?`).bind(userId).run();
  return { ok: true };
}

/**
 * Unlocking needs a confirmed email, but only once emails are switched on, and only for people
 * who signed up themselves (team members were added by their account owner).
 */
export async function needsEmailConfirmation(env: StoreEnv, user: { id: string; role: string }): Promise<boolean> {
  if (user.role === "member" || !(await emailFrom(env))) return false;
  return !(await env.DB.prepare(`SELECT 1 AS x FROM store_users WHERE id = ? AND email_verified_at IS NOT NULL`).bind(user.id).first());
}
