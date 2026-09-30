// A customer company's people (the account owner adds colleagues) and its saved searches.
// Everyone in a company shares its credits, purchases and saved searches.

import { hashPassword } from "../auth";
import type { StoreEnv } from "./types";
import { StoreError } from "./types";
import type { StoreAccount, StoreUser } from "./auth";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
const MAX_PEOPLE = 25;
const MAX_SAVED = 50;

export async function listTeam(env: StoreEnv, account: StoreAccount, me: StoreUser) {
  const { results } = await env.DB.prepare(
    `SELECT id, name, email, role, last_login_at AS lastLoginAt FROM store_users WHERE account_id = ? ORDER BY role = 'owner' DESC, created_at`,
  ).bind(account.id).all<{ id: string; name: string | null; email: string; role: string; lastLoginAt: string | null }>();
  return results.map((u) => ({ ...u, me: u.id === me.id }));
}

function tempPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = crypto.getRandomValues(new Uint8Array(14));
  return [...b].map((x) => alphabet[x % alphabet.length]).join("");
}

/** The owner adds a colleague; returns a temporary password (shown once) they change after signing in. */
export async function addTeamMember(env: StoreEnv, account: StoreAccount, me: StoreUser, input: { name?: unknown; email?: unknown }) {
  if (me.role !== "owner") throw new StoreError("Only the account owner can add people.", 403);
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 80) : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase().slice(0, 160) : "";
  if (!EMAIL_RE.test(email)) throw new StoreError("Enter a valid email address.");
  const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM store_users WHERE account_id = ?`).bind(account.id).first<number>("n");
  if ((count ?? 0) >= MAX_PEOPLE) throw new StoreError(`An account can have up to ${MAX_PEOPLE} people.`);
  if (await env.DB.prepare(`SELECT 1 AS x FROM store_users WHERE email = ?`).bind(email).first()) {
    throw new StoreError("Someone with this email already has an account.", 409);
  }
  const password = tempPassword();
  const h = await hashPassword(password);
  await env.DB.prepare(
    `INSERT INTO store_users (id, account_id, email, name, password_hash, password_salt, password_iterations, must_change_password, role)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'member')`,
  ).bind(crypto.randomUUID(), account.id, email, name || null, h.hash, h.salt, h.iterations).run();
  return { password };
}

export async function removeTeamMember(env: StoreEnv, account: StoreAccount, me: StoreUser, userId: string) {
  if (me.role !== "owner") throw new StoreError("Only the account owner can remove people.", 403);
  if (userId === me.id) throw new StoreError("You can't remove yourself.");
  const u = await env.DB.prepare(`SELECT role FROM store_users WHERE id = ? AND account_id = ?`).bind(userId, account.id).first<{ role: string }>();
  if (!u) throw new StoreError("That person wasn't found.", 404);
  if (u.role === "owner") throw new StoreError("The account owner can't be removed.");
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM store_sessions WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM store_users WHERE id = ? AND account_id = ?`).bind(userId, account.id),
  ]);
  return { ok: true };
}

// ----------------------------------------------------------------------------------------
// Saved searches: a name and the filter query string (as the page builds it).

export async function listSaved(env: StoreEnv, account: StoreAccount) {
  const { results } = await env.DB.prepare(
    `SELECT id, name, query, created_at AS createdAt FROM store_saved_searches WHERE account_id = ? ORDER BY created_at DESC LIMIT ${MAX_SAVED}`,
  ).bind(account.id).all();
  return results;
}

export async function saveSearch(env: StoreEnv, account: StoreAccount, input: { name?: unknown; query?: unknown }) {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 80) : "";
  let query = typeof input.query === "string" ? input.query.trim().replace(/^\?/, "").slice(0, 3000) : "";
  if (!name) throw new StoreError("Give the search a name.");
  // Keep only the filters (not paging), as a clean query string.
  const p = new URLSearchParams(query);
  for (const k of ["page", "page_size"]) p.delete(k);
  query = p.toString();
  const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM store_saved_searches WHERE account_id = ?`).bind(account.id).first<number>("n");
  if ((count ?? 0) >= MAX_SAVED) throw new StoreError(`You can keep up to ${MAX_SAVED} saved searches. Delete one first.`);
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO store_saved_searches (id, account_id, name, query) VALUES (?, ?, ?, ?)`).bind(id, account.id, name, query).run();
  return { id };
}

export async function deleteSaved(env: StoreEnv, account: StoreAccount, id: string) {
  await env.DB.prepare(`DELETE FROM store_saved_searches WHERE id = ? AND account_id = ?`).bind(id, account.id).run();
  return { ok: true };
}
