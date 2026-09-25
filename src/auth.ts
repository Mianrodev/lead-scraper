// Team sign-in: email + password, cookie sessions, admin-managed users.
// Passwords: PBKDF2-SHA256 (Web Crypto) with a per-user salt. Sessions: random token in an
// HttpOnly cookie; only its SHA-256 is stored, so a leaked database can't be used to sign in.

import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

export const SESSION_COOKIE = "lf_session";
const SESSION_DAYS = 14;
// Workers' Web Crypto caps PBKDF2 at 100,000 iterations.
const PBKDF2_ITERATIONS = 100_000;
const MAX_FAILED_LOGINS = 10;
const LOCK_MINUTES = 15;
export const MIN_PASSWORD_LENGTH = 10;

export interface User {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "member";
  active: number;
  must_change_password: number;
  last_login_at: string | null;
  created_at: string;
}

export class AuthError extends Error {
  constructor(message: string, public status: 400 | 401 | 403 | 423 = 400) {
    super(message);
  }
}

const b64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return b64(bits);
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string; iterations: number }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { hash: await pbkdf2(password, salt, PBKDF2_ITERATIONS), salt: b64(salt), iterations: PBKDF2_ITERATIONS };
}

/** Constant-time string comparison. */
function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPassword(password: string, hash: string, salt: string, iterations: number): Promise<boolean> {
  return sameString(await pbkdf2(password, unb64(salt), iterations), hash);
}

async function sha256(value: string): Promise<string> {
  return b64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export function checkPasswordRules(password: string) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError(`Passwords need at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
}

const USER_COLUMNS = "id, email, name, role, active, must_change_password, last_login_at, created_at";

export async function countUsers(env: Env): Promise<number> {
  return (await env.DB.prepare(`SELECT COUNT(*) AS n FROM users`).first<number>("n")) ?? 0;
}

export async function createUser(
  env: Env,
  input: { email: string; name?: string | null; password: string; role?: "admin" | "member"; mustChange?: boolean },
): Promise<User> {
  const email = input.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError("Enter a valid email address.");
  checkPasswordRules(input.password);
  const existing = await env.DB.prepare(`SELECT id FROM users WHERE email = ?`).bind(email).first();
  if (existing) throw new AuthError("Someone with that email already has an account.");
  const { hash, salt, iterations } = await hashPassword(input.password);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, name, role, password_hash, password_salt, password_iterations, must_change_password)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, email, input.name?.trim() || null, input.role === "admin" ? "admin" : "member", hash, salt, iterations, input.mustChange ? 1 : 0)
    .run();
  return (await env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).bind(id).first<User>())!;
}

/** Checks email + password, handling lockouts; returns a new session token for the cookie. */
export async function signIn(env: Env, emailInput: string, password: string): Promise<{ token: string; user: User }> {
  const email = (emailInput ?? "").trim().toLowerCase();
  const row = await env.DB.prepare(
    `SELECT ${USER_COLUMNS}, password_hash, password_salt, password_iterations, failed_logins, locked_until FROM users WHERE email = ?`,
  )
    .bind(email)
    .first<User & { password_hash: string; password_salt: string; password_iterations: number; failed_logins: number; locked_until: string | null }>();
  const wrong = new AuthError("That email and password don't match.", 401);
  if (!row) {
    // Spend the same time as a real check so response times don't reveal which emails exist.
    await pbkdf2(password ?? "", crypto.getRandomValues(new Uint8Array(16)), PBKDF2_ITERATIONS);
    throw wrong;
  }
  if (!row.active) throw new AuthError("This account has been switched off. Ask your admin.", 403);
  if (row.locked_until && Date.parse(`${row.locked_until}Z`) > Date.now()) {
    throw new AuthError(`Too many wrong passwords. Try again in ${LOCK_MINUTES} minutes.`, 423);
  }
  if (!(await verifyPassword(password ?? "", row.password_hash, row.password_salt, row.password_iterations))) {
    const failed = row.failed_logins + 1;
    await env.DB.prepare(
      `UPDATE users SET failed_logins = ?, locked_until = CASE WHEN ? >= ? THEN datetime('now', ?) ELSE locked_until END WHERE id = ?`,
    )
      .bind(failed >= MAX_FAILED_LOGINS ? 0 : failed, failed, MAX_FAILED_LOGINS, `+${LOCK_MINUTES} minutes`, row.id)
      .run();
    throw wrong;
  }
  const token = b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c]!);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', ?))`).bind(
      await sha256(token),
      row.id,
      `+${SESSION_DAYS} days`,
    ),
    env.DB.prepare(`UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = datetime('now') WHERE id = ?`).bind(row.id),
    env.DB.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`),
  ]);
  const { password_hash: _h, password_salt: _s, password_iterations: _i, failed_logins: _f, locked_until: _l, ...user } = row;
  return { token, user };
}

export async function userForToken(env: Env, token: string | undefined): Promise<User | null> {
  if (!token) return null;
  return env.DB.prepare(
    `SELECT ${USER_COLUMNS.split(", ").map((c) => `u.${c}`).join(", ")} FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND u.active = 1`,
  )
    .bind(await sha256(token))
    .first<User>();
}

export async function signOut(env: Env, token: string | undefined) {
  if (token) await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(await sha256(token)).run();
}

export function setSessionCookie(c: Context, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 3600,
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export async function listUsers(env: Env): Promise<User[]> {
  const { results } = await env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY created_at`).all<User>();
  return results;
}

export async function updateUser(
  env: Env,
  actor: User,
  id: string,
  changes: { active?: boolean; role?: "admin" | "member"; password?: string; name?: string },
) {
  const target = await env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).bind(id).first<User>();
  if (!target) throw new AuthError("No such user.");
  if (target.id === actor.id && (changes.active === false || changes.role === "member")) {
    throw new AuthError("You can't switch off or demote your own account.");
  }
  if (changes.active === false || changes.role === "member") {
    const admins = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id <> ?`).bind(id).first<number>("n")) ?? 0;
    if (target.role === "admin" && admins === 0) throw new AuthError("There has to be at least one active admin.");
  }
  const statements: D1PreparedStatement[] = [];
  if (changes.active != null) {
    statements.push(env.DB.prepare(`UPDATE users SET active = ? WHERE id = ?`).bind(changes.active ? 1 : 0, id));
    if (!changes.active) statements.push(env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(id)); // signs them out now
  }
  if (changes.role) statements.push(env.DB.prepare(`UPDATE users SET role = ? WHERE id = ?`).bind(changes.role === "admin" ? "admin" : "member", id));
  if (changes.name != null) statements.push(env.DB.prepare(`UPDATE users SET name = ? WHERE id = ?`).bind(changes.name.trim() || null, id));
  if (changes.password != null) {
    checkPasswordRules(changes.password);
    const { hash, salt, iterations } = await hashPassword(changes.password);
    const mustChange = target.id === actor.id ? 0 : 1; // an admin-set password must be changed at next sign-in
    statements.push(
      env.DB.prepare(
        `UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, must_change_password = ?,
           failed_logins = 0, locked_until = NULL WHERE id = ?`,
      ).bind(hash, salt, iterations, mustChange, id),
    );
    if (target.id !== actor.id) statements.push(env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(id));
  }
  if (statements.length) await env.DB.batch(statements);
}

/** Changing your own password (needs the current one). */
export async function changeOwnPassword(env: Env, user: User, current: string, next: string) {
  const row = await env.DB.prepare(`SELECT password_hash, password_salt, password_iterations FROM users WHERE id = ?`)
    .bind(user.id)
    .first<{ password_hash: string; password_salt: string; password_iterations: number }>();
  if (!row || !(await verifyPassword(current ?? "", row.password_hash, row.password_salt, row.password_iterations))) {
    throw new AuthError("Your current password isn't right.", 401);
  }
  checkPasswordRules(next);
  const { hash, salt, iterations } = await hashPassword(next);
  await env.DB.prepare(
    `UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?, must_change_password = 0 WHERE id = ?`,
  )
    .bind(hash, salt, iterations, user.id)
    .run();
}

type AuthVars = { Bindings: Env; Variables: { user: User } };

/** Requires a signed-in user for everything except the given public paths. */
export function requireUser(publicPaths: string[]): MiddlewareHandler<AuthVars> {
  return async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (publicPaths.includes(path)) return next();
    // Refuse cross-site form posts: state changes must come from our own pages.
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      const origin = c.req.header("Origin");
      if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: "Cross-site request refused" }, 403);
    }
    const user = await userForToken(c.env, getCookie(c, SESSION_COOKIE));
    if (!user) {
      if (path.startsWith("/api/")) return c.json({ error: "Please sign in again.", signIn: true }, 401);
      return c.redirect("/login");
    }
    c.set("user", user);
    return next();
  };
}

export const requireAdmin: MiddlewareHandler<AuthVars> = async (c, next) => {
  if (c.get("user")?.role !== "admin") return c.json({ error: "Only admins can do that." }, 403);
  return next();
};
