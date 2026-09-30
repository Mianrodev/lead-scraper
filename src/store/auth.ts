// Store customers: companies (accounts) and their people (users), separate from the internal
// team's users. Passwords use the same hashing as the internal app; sessions are random tokens
// of which only a SHA-256 is stored. Sign-in tries are counted before the password is checked,
// per network and per account+network, like the internal app.

import { checkPasswordRules, hashPassword, verifyPassword } from "../auth";
import type { StoreEnv } from "./types";
import { StoreError } from "./types";

export const STORE_COOKIE = "ls_session";
export const SESSION_DAYS = 14;
const IP_TRIES = 20, IP_WINDOW = 10; // per network: 20 tries per 10 minutes
const ACCOUNT_TRIES = 10, ACCOUNT_WINDOW = 15; // per account + network: 10 wrong tries pause 15 minutes

export interface StoreUser { id: string; name: string | null; email: string; must_change_password: number; role: "owner" | "member" }
export interface StoreAccount { id: string; company: string; status: "pending" | "active" | "suspended"; credits: number }

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;

async function bump(env: StoreEnv, key: string, windowMinutes: number): Promise<number> {
  return (await env.DB.prepare(
    `INSERT INTO login_attempts (ip, window_start, attempts) VALUES (?, datetime('now'), 1)
     ON CONFLICT(ip) DO UPDATE SET
       attempts = CASE WHEN window_start < datetime('now', ?) THEN 1 ELSE attempts + 1 END,
       window_start = CASE WHEN window_start < datetime('now', ?) THEN datetime('now') ELSE window_start END
     RETURNING attempts`,
  ).bind(key, `-${windowMinutes} minutes`, `-${windowMinutes} minutes`).first<number>("attempts")) ?? 0;
}

async function setting(env: StoreEnv, key: string): Promise<string> {
  return (await env.DB.prepare(`SELECT value FROM app_settings WHERE key = ?`).bind(key).first<string>("value")) ?? "";
}

export async function signup(env: StoreEnv, input: { company?: string; name?: string; email?: string; password?: string }, ip: string) {
  if ((await setting(env, "store_signup_open")) !== "1") throw new StoreError("New accounts aren't open right now.", 403);
  if ((await bump(env, `store-signup:${ip}`, 60)) > 5) throw new StoreError("Too many new accounts from this network. Try again in an hour.", 429);
  // Self-serve accounts start with free leads, so keep it to a few new accounts per network a day.
  const open = (await setting(env, "store_signup_mode")) !== "approval";
  if (open && (await bump(env, `store-signup-day:${ip}`, 1440)) > 3) throw new StoreError("Too many new accounts from this network today. Try again tomorrow.", 429);
  const company = (input.company ?? "").trim().slice(0, 120);
  const name = (input.name ?? "").trim().slice(0, 80);
  const email = (input.email ?? "").trim().toLowerCase().slice(0, 160);
  if (!company) throw new StoreError("Enter your company name.");
  if (!EMAIL_RE.test(email)) throw new StoreError("Enter a valid email address.");
  try { checkPasswordRules(input.password ?? ""); } catch (err) { throw new StoreError(err instanceof Error ? err.message : "Choose a longer password."); }
  if (await env.DB.prepare(`SELECT 1 AS x FROM store_users WHERE email = ?`).bind(email).first()) {
    throw new StoreError("There's already an account with this email. Sign in instead.", 409);
  }
  const h = await hashPassword(input.password!);
  const accountId = crypto.randomUUID(), userId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO store_accounts (id, company, status, approved_at) VALUES (?, ?, ?, CASE WHEN ? = 'active' THEN datetime('now') END)`)
      .bind(accountId, company, open ? "active" : "pending", open ? "active" : "pending"),
    env.DB.prepare(`INSERT INTO store_users (id, account_id, email, name, password_hash, password_salt, password_iterations) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(userId, accountId, email, name || null, h.hash, h.salt, h.iterations),
  ]);
  return { ok: true, status: open ? ("active" as const) : ("pending" as const) };
}

/** Checks email + password; returns a new session token for the cookie. */
export async function login(env: StoreEnv, emailInput: string, password: string, ip: string): Promise<string> {
  const wrong = new StoreError(`That email and password don't match. (After ${ACCOUNT_TRIES} wrong tries, signing in from this network pauses for ${ACCOUNT_WINDOW} minutes.)`, 401);
  if ((await bump(env, `store-ip:${ip}`, IP_WINDOW)) > IP_TRIES) throw new StoreError(`Too many sign-in tries from this network. Try again in ${IP_WINDOW} minutes.`, 429);
  const email = (emailInput ?? "").trim().toLowerCase();
  const row = await env.DB.prepare(`SELECT id, password_hash, password_salt, password_iterations FROM store_users WHERE email = ?`)
    .bind(email).first<{ id: string; password_hash: string; password_salt: string; password_iterations: number }>();
  if (!row) {
    await hashPassword(password ?? ""); // same time as a real check, so it doesn't reveal which emails exist
    throw wrong;
  }
  const accountKey = `store-acct:${row.id}|${ip}`;
  if ((await bump(env, accountKey, ACCOUNT_WINDOW)) > ACCOUNT_TRIES) throw wrong;
  if (!(await verifyPassword(password ?? "", row.password_hash, row.password_salt, row.password_iterations))) throw wrong;
  const token = hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO store_sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', ?))`).bind(await sha256(token), row.id, `+${SESSION_DAYS} days`),
    env.DB.prepare(`UPDATE store_users SET last_login_at = datetime('now') WHERE id = ?`).bind(row.id),
    env.DB.prepare(`DELETE FROM login_attempts WHERE ip = ?`).bind(accountKey),
    env.DB.prepare(`DELETE FROM store_sessions WHERE expires_at < datetime('now')`),
  ]);
  return token;
}

export async function sessionFor(env: StoreEnv, token: string | undefined): Promise<{ user: StoreUser; account: StoreAccount } | null> {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const r = await env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.must_change_password, u.role, a.id AS account_id, a.company, a.status, a.credits
     FROM store_sessions s JOIN store_users u ON u.id = s.user_id JOIN store_accounts a ON a.id = u.account_id
     WHERE s.token_hash = ? AND s.expires_at > datetime('now')`,
  ).bind(await sha256(token)).first<StoreUser & { account_id: string; company: string; status: StoreAccount["status"]; credits: number }>();
  if (!r) return null;
  return {
    user: { id: r.id, name: r.name, email: r.email, must_change_password: r.must_change_password, role: r.role === "member" ? "member" : "owner" },
    account: { id: r.account_id, company: r.company, status: r.status, credits: r.credits },
  };
}

export async function logout(env: StoreEnv, token: string | undefined) {
  if (token && /^[0-9a-f]{64}$/.test(token)) await env.DB.prepare(`DELETE FROM store_sessions WHERE token_hash = ?`).bind(await sha256(token)).run();
}

/** Changes the signed-in person's password and signs out their other sessions. */
export async function changePassword(env: StoreEnv, userId: string, current: string, next: string, keepToken: string | undefined) {
  const row = await env.DB.prepare(`SELECT password_hash, password_salt, password_iterations FROM store_users WHERE id = ?`)
    .bind(userId).first<{ password_hash: string; password_salt: string; password_iterations: number }>();
  if (!row || !(await verifyPassword(current ?? "", row.password_hash, row.password_salt, row.password_iterations))) {
    throw new StoreError("Your current password isn't right.", 403);
  }
  try { checkPasswordRules(next ?? ""); } catch (err) { throw new StoreError(err instanceof Error ? err.message : "Choose a longer password."); }
  const h = await hashPassword(next);
  const keep = keepToken ? await sha256(keepToken) : "";
  await env.DB.batch([
    env.DB.prepare(`UPDATE store_users SET password_hash = ?, password_salt = ?, password_iterations = ?, must_change_password = 0 WHERE id = ?`)
      .bind(h.hash, h.salt, h.iterations, userId),
    env.DB.prepare(`DELETE FROM store_sessions WHERE user_id = ? AND token_hash <> ?`).bind(userId, keep),
  ]);
}
