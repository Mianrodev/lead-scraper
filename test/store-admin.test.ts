import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  changeStoreCredits,
  handleRemovalRequest,
  listRemovalRequests,
  listStoreAccounts,
  resetStorePassword,
  saveStoreSettings,
  setStoreAccountStatus,
  storeSettings,
  storeStats,
  temporaryPassword,
  validateStoreSettings,
} from "../src/store/admin";
import { verifyPassword } from "../src/auth";

const fs = (await import("node:" + "fs")) as { readdirSync(p: string): string[]; readFileSync(p: string, enc: "utf8"): string };

/** The real schema in Node's SQLite, behind the part of D1's API the console uses (batch = one transaction). */
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of fs.readdirSync("migrations").filter((x) => x.endsWith(".sql")).sort()) db.exec(fs.readFileSync(`migrations/${f}`, "utf8"));
  const stmt = (sql: string, binds: unknown[] = []) => ({
    bind: (...b: unknown[]) => stmt(sql, b),
    all: async () => ({ results: db.prepare(sql).all(...(binds as never[])) }),
    first: async (col?: string) => { const r = db.prepare(sql).get(...(binds as never[])) as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
    run: async () => { const r = db.prepare(sql).run(...(binds as never[])) as { changes: number }; return { meta: { changes: r.changes } }; },
    rows: () => {
      if (/^\s*(SELECT|WITH)\b|\bRETURNING\b/i.test(sql)) { const results = db.prepare(sql).all(...(binds as never[])); return { results, meta: { changes: results.length } }; }
      const r = db.prepare(sql).run(...(binds as never[])) as { changes: number };
      return { results: [], meta: { changes: Number(r.changes) } };
    },
  });
  const DB = {
    prepare: (sql: string) => stmt(sql),
    batch: async (list: ReturnType<typeof stmt>[]) => {
      db.exec("BEGIN");
      try { const out = list.map((s) => s.rows()); db.exec("COMMIT"); return out; } catch (e) { db.exec("ROLLBACK"); throw e; }
    },
  };
  return { db, env: { DB } as unknown as Env };
}

function account(db: DatabaseSync, id: string, credits = 0, status = "pending") {
  db.prepare(`INSERT INTO store_accounts (id, company, status, credits) VALUES (?, ?, ?, ?)`).run(id, `Co ${id}`, status, credits);
}
const ledger = (db: DatabaseSync, id: string) =>
  db.prepare(`SELECT delta, balance, kind, note, created_by FROM store_ledger WHERE account_id = ? ORDER BY id`).all(id) as { delta: number; balance: number; kind: string; note: string | null; created_by: string | null }[];

describe("store settings", () => {
  it("reads the defaults and saves validated values", async () => {
    const { env } = d1();
    expect(await storeSettings(env)).toEqual({ priceFree: 1, priceGoogle: 3, brandName: "Lead Store", brandColor: "#4f46e5", supportEmail: "", signupOpen: false, welcomeCredits: 0, storeUrl: "", logoUrl: "", signupMode: "open", freePerMonth: 50, publicPages: false, creditPrice: null }); // sign-ups start closed
    await saveStoreSettings(env, { priceFree: "2", priceGoogle: 5, brandName: " Acme Leads ", brandColor: "FF0000", supportEmail: "help@acme.com", signupOpen: true, welcomeCredits: 25, storeUrl: "leads.acme.com", logoUrl: "https://cdn.acme.com/logo.png" });
    expect(await storeSettings(env)).toEqual({ priceFree: 2, priceGoogle: 5, brandName: "Acme Leads", brandColor: "#ff0000", supportEmail: "help@acme.com", signupOpen: true, welcomeCredits: 25, storeUrl: "https://leads.acme.com", logoUrl: "https://cdn.acme.com/logo.png", signupMode: "open", freePerMonth: 50, publicPages: false, creditPrice: null });
  });

  it("keeps the dollars-per-credit price (only changed when sent)", async () => {
    const { env } = d1();
    const base = { priceFree: 1, priceGoogle: 3 };
    expect((await saveStoreSettings(env, { ...base, creditPrice: "0.5" })).creditPrice).toBe(0.5);
    expect((await storeSettings(env)).creditPrice).toBe(0.5);
    // An Admin page that doesn't send it leaves it alone.
    expect((await saveStoreSettings(env, { ...base, brandName: "X" })).creditPrice).toBe(0.5);
    expect((await storeSettings(env)).creditPrice).toBe(0.5);
    expect((await saveStoreSettings(env, { ...base, creditPrice: 2 })).creditPrice).toBe(2);
    expect((await saveStoreSettings(env, { ...base, creditPrice: "" })).creditPrice).toBeNull();
    expect((await storeSettings(env)).creditPrice).toBeNull();
    expect(validateStoreSettings({ ...base, creditPrice: null }).creditPrice).toBeNull();
    expect(validateStoreSettings({ ...base, creditPrice: 0 }).creditPrice).toBe(0);
    expect(() => validateStoreSettings({ ...base, creditPrice: 1.234 })).toThrow(/2 decimals/);
    expect(() => validateStoreSettings({ ...base, creditPrice: -1 })).toThrow(/credit/);
    expect(() => validateStoreSettings({ ...base, creditPrice: "abc" })).toThrow(/credit/);
  });

  it("refuses bad values", () => {
    const ok = { priceFree: 1, priceGoogle: 3, brandColor: "#123456" };
    expect(() => validateStoreSettings({ ...ok, priceFree: 1.5 })).toThrow(/whole number/);
    expect(() => validateStoreSettings({ ...ok, priceGoogle: 1001 })).toThrow(/whole number/);
    expect(() => validateStoreSettings({ ...ok, priceFree: -1 })).toThrow();
    expect(() => validateStoreSettings({ ...ok, brandColor: "red" })).toThrow(/color/);
    expect(() => validateStoreSettings({ ...ok, supportEmail: "nope" })).toThrow(/email/);
    expect(() => validateStoreSettings({ ...ok, welcomeCredits: -5 })).toThrow();
  });
});

describe("account status", () => {
  it("gives the welcome credits once, on the first approval", async () => {
    const { db, env } = d1();
    await saveStoreSettings(env, { priceFree: 1, priceGoogle: 3, welcomeCredits: 20 });
    account(db, "a", 5);
    const first = await setStoreAccountStatus(env, "a", "active", "owner");
    expect(first).toMatchObject({ status: "active", previous: "pending", credits: 25, welcomeGiven: 20 });
    await setStoreAccountStatus(env, "a", "suspended", "owner");
    const again = await setStoreAccountStatus(env, "a", "active", "owner");
    expect(again).toMatchObject({ credits: 25, welcomeGiven: 0 });
    expect(ledger(db, "a")).toEqual([{ delta: 20, balance: 25, kind: "grant", note: "Welcome credits", created_by: "owner" }]);
    const row = db.prepare(`SELECT status, welcome_given, approved_at FROM store_accounts WHERE id = 'a'`).get() as { status: string; welcome_given: number; approved_at: string | null };
    expect(row.status).toBe("active");
    expect(row.welcome_given).toBe(1);
    expect(row.approved_at).toBeTruthy();
  });

  it("no welcome credits configured: no ledger row, but the flag is set", async () => {
    const { db, env } = d1();
    account(db, "b");
    expect(await setStoreAccountStatus(env, "b", "active", "owner")).toMatchObject({ credits: 0, welcomeGiven: 0 });
    expect(ledger(db, "b")).toEqual([]);
    await saveStoreSettings(env, { priceFree: 1, priceGoogle: 3, welcomeCredits: 50 });
    await setStoreAccountStatus(env, "b", "active", "owner");
    expect(ledger(db, "b")).toEqual([]);
  });

  it("unknown accounts and bad statuses", async () => {
    const { env } = d1();
    expect(await setStoreAccountStatus(env, "nope", "active", "owner")).toBeNull();
    await expect(setStoreAccountStatus(env, "nope", "pending", "owner")).rejects.toThrow(/active or suspended/);
  });
});

describe("credits", () => {
  it("adds and removes with ledger balances, never below 0", async () => {
    const { db, env } = d1();
    account(db, "a", 0, "active");
    expect(await changeStoreCredits(env, "a", 100, "Paid $100", "owner")).toEqual({ balance: 100 });
    expect(await changeStoreCredits(env, "a", "-30", "", "owner")).toEqual({ balance: 70 });
    await expect(changeStoreCredits(env, "a", -71, "too much", "owner")).rejects.toThrow(/below 0/);
    expect(await changeStoreCredits(env, "a", -70, null, "owner")).toEqual({ balance: 0 });
    expect(ledger(db, "a")).toEqual([
      { delta: 100, balance: 100, kind: "grant", note: "Paid $100", created_by: "owner" },
      { delta: -30, balance: 70, kind: "adjust", note: null, created_by: "owner" },
      { delta: -70, balance: 0, kind: "adjust", note: null, created_by: "owner" },
    ]);
    expect((db.prepare(`SELECT credits FROM store_accounts WHERE id = 'a'`).get() as { credits: number }).credits).toBe(0);
  });

  it("refuses zero, fractions and unknown accounts", async () => {
    const { db, env } = d1();
    account(db, "a");
    await expect(changeStoreCredits(env, "a", 0, "", "owner")).rejects.toThrow(/whole number/);
    await expect(changeStoreCredits(env, "a", 1.5, "", "owner")).rejects.toThrow(/whole number/);
    expect(await changeStoreCredits(env, "missing", 10, "", "owner")).toBeNull();
    expect(ledger(db, "missing")).toEqual([]);
  });
});

describe("accounts list and stats", () => {
  it("lists users and purchases, and the stats have the right shape", async () => {
    const { db, env } = d1();
    account(db, "a", 10, "active");
    account(db, "b", 0, "pending");
    account(db, "c", 0, "suspended");
    db.exec(`INSERT INTO store_users (id, account_id, email, name, password_hash, password_salt, password_iterations) VALUES
      ('u1', 'a', 'ann@a.com', 'Ann', 'x', 'x', 1), ('u2', 'a', 'bob@a.com', NULL, 'x', 'x', 1)`);
    db.exec(`INSERT INTO store_purchases (account_id, lead_id, tier, credits, purchased_at) VALUES
      ('a', 'l1', 'free', 1, datetime('now')), ('a', 'l2', 'google', 3, datetime('now')), ('c', 'l1', 'free', 1, datetime('now', '-60 days'))`);
    await changeStoreCredits(env, "a", 50, "", "owner");

    const list = await listStoreAccounts(env);
    expect(list.map((x) => x.id)).toEqual(["b", "a", "c"]); // waiting for approval first
    const a = list.find((x) => x.id === "a")!;
    expect(a).toMatchObject({ company: "Co a", status: "active", credits: 60, leadsBought: 2, creditsSpent: 4 });
    expect(a.users).toEqual([{ name: "Ann", email: "ann@a.com", role: "owner" }, { name: null, email: "bob@a.com", role: "owner" }]);
    expect(a.lastPurchaseAt).toBeTruthy();
    expect(list.find((x) => x.id === "b")).toMatchObject({ users: [], leadsBought: 0, creditsSpent: 0, lastPurchaseAt: null });

    const st = await storeStats(env);
    expect(st.accounts).toEqual({ pending: 1, active: 1, suspended: 1 });
    expect(st.leadsSold).toBe(3);
    expect(st.creditsSpent).toBe(5);
    expect(st.creditsGranted).toBe(50);
    expect(st.byDay).toHaveLength(30);
    expect(st.byDay[29]).toEqual({ day: new Date().toISOString().slice(0, 10), leads: 2, credits: 4 });
    expect(st.byDay.reduce((s, d) => s + d.leads, 0)).toBe(2); // the 60-day-old purchase is outside
  });
});

describe("password reset", () => {
  it("sets a temporary password, forces a change and signs the user out", async () => {
    const { db, env } = d1();
    account(db, "a", 0, "active");
    account(db, "z", 0, "active");
    db.exec(`INSERT INTO store_users (id, account_id, email, name, password_hash, password_salt, password_iterations) VALUES
      ('u1', 'a', 'ann@a.com', 'Ann', 'x', 'x', 1), ('u9', 'z', 'zed@z.com', 'Zed', 'x', 'x', 1)`);
    db.exec(`INSERT INTO store_sessions (token_hash, user_id, expires_at) VALUES ('t1', 'u1', '2099-01-01'), ('t9', 'u9', '2099-01-01')`);

    expect(await resetStorePassword(env, "a", "zed@z.com")).toBeNull(); // another company's user
    const r = await resetStorePassword(env, "a", "ANN@a.com");
    expect(r!.password).toHaveLength(14);
    const u = db.prepare(`SELECT password_hash, password_salt, password_iterations, must_change_password FROM store_users WHERE id = 'u1'`).get() as { password_hash: string; password_salt: string; password_iterations: number; must_change_password: number };
    expect(u.must_change_password).toBe(1);
    expect(await verifyPassword(r!.password, u.password_hash, u.password_salt, u.password_iterations)).toBe(true);
    expect((db.prepare(`SELECT token_hash FROM store_sessions ORDER BY token_hash`).all() as { token_hash: string }[]).map((x) => x.token_hash)).toEqual(["t9"]);
  });

  it("temporary passwords are random", () => {
    const a = temporaryPassword(), b = temporaryPassword();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[a-zA-Z2-9]{14}$/);
  });
});

describe("platform settings", () => {
  it("saves how companies join, the monthly free leads and search-engine listing", async () => {
    const { db, env } = d1();
    await saveStoreSettings(env, { priceFree: 1, priceGoogle: 3, signupMode: "approval", freePerMonth: "120", publicPages: true });
    expect(await storeSettings(env)).toMatchObject({ signupMode: "approval", freePerMonth: 120, publicPages: true });
    const raw = Object.fromEntries((db.prepare(`SELECT key, value FROM app_settings WHERE key IN ('store_signup_mode', 'store_free_per_month', 'store_public_pages')`).all() as { key: string; value: string }[]).map((r) => [r.key, r.value]));
    expect(raw).toEqual({ store_signup_mode: "approval", store_free_per_month: "120", store_public_pages: "1" });
    await saveStoreSettings(env, { priceFree: 1, priceGoogle: 3, signupMode: "open", freePerMonth: 0, publicPages: false });
    expect(await storeSettings(env)).toMatchObject({ signupMode: "open", freePerMonth: 0, publicPages: false });
  });

  it("falls back to the defaults when a setting is missing", async () => {
    const { db, env } = d1();
    db.exec(`DELETE FROM app_settings WHERE key IN ('store_signup_mode', 'store_free_per_month', 'store_public_pages')`);
    expect(await storeSettings(env)).toMatchObject({ signupMode: "open", freePerMonth: 50, publicPages: false });
    expect(validateStoreSettings({ priceFree: 1, priceGoogle: 3 })).toMatchObject({ signupMode: "open", freePerMonth: 50, publicPages: false });
  });

  it("refuses bad values", () => {
    const ok = { priceFree: 1, priceGoogle: 3 };
    expect(() => validateStoreSettings({ ...ok, signupMode: "anyone" })).toThrow(/join/);
    expect(() => validateStoreSettings({ ...ok, freePerMonth: 10001 })).toThrow(/Free leads every month/);
    expect(() => validateStoreSettings({ ...ok, freePerMonth: -1 })).toThrow(/whole number/);
    expect(() => validateStoreSettings({ ...ok, freePerMonth: 2.5 })).toThrow(/whole number/);
    expect(validateStoreSettings({ ...ok, freePerMonth: 10000 }).freePerMonth).toBe(10000);
  });
});

describe("free leads used", () => {
  it("counts only this month's free leads", async () => {
    const { db, env } = d1();
    account(db, "a", 0, "active");
    account(db, "b", 0, "active");
    account(db, "c", 0, "active");
    db.exec(`UPDATE store_accounts SET free_period = '2026-09', free_used = 7 WHERE id = 'a'`);
    db.exec(`UPDATE store_accounts SET free_period = '2026-08', free_used = 40 WHERE id = 'b'`);
    db.exec(`INSERT INTO store_users (id, account_id, email, name, password_hash, password_salt, password_iterations, role) VALUES ('u1', 'a', 'ann@a.com', 'Ann', 'x', 'x', 1, 'member')`);
    const list = await listStoreAccounts(env, new Date("2026-09-30T23:59:00Z"));
    const by = Object.fromEntries(list.map((x) => [x.id, x.freeUsed]));
    expect(by).toEqual({ a: 7, b: 0, c: 0 }); // last month's count doesn't carry over
    expect(list.find((x) => x.id === "a")!.users).toEqual([{ name: "Ann", email: "ann@a.com", role: "member" }]);
    const october = await listStoreAccounts(env, new Date("2026-10-01T00:00:01Z"));
    expect(october.find((x) => x.id === "a")!.freeUsed).toBe(0);
  });
});

describe("removal requests", () => {
  function request(db: DatabaseSync, business: string, fields: { phone?: string; website?: string; email?: string; status?: string; created?: string } = {}) {
    const r = db.prepare(`INSERT INTO store_removal_requests (business, phone, website, email, name, contact_email, message, status, created_at) VALUES (?, ?, ?, ?, 'Joe', 'joe@home.com', 'Please remove us', ?, ?) RETURNING id`)
      .get(business, fields.phone ?? null, fields.website ?? null, fields.email ?? null, fields.status ?? "new", fields.created ?? "2026-09-01 10:00:00") as { id: number };
    return Number(r.id);
  }
  const statusOf = (db: DatabaseSync, id: number) => db.prepare(`SELECT status, handled_at, handled_by FROM store_removal_requests WHERE id = ?`).get(id) as { status: string; handled_at: string | null; handled_by: string | null };

  it("lists new ones first, then newest", async () => {
    const { db, env } = d1();
    const old = request(db, "Old done", { status: "done", created: "2026-09-10 10:00:00" });
    const newer = request(db, "New B", { created: "2026-09-05 10:00:00" });
    const newest = request(db, "New A", { created: "2026-09-06 10:00:00" });
    const list = await listRemovalRequests(env);
    expect(list.map((x) => x.id)).toEqual([newest, newer, old]);
    expect(list[0]).toMatchObject({ business: "New A", name: "Joe", contactEmail: "joe@home.com", message: "Please remove us", status: "new", createdAt: "2026-09-06 10:00:00" });
  });

  it("'suppress' puts the phone, website and email on the do-not-contact list and marks it done", async () => {
    const { db, env } = d1();
    const id = request(db, "Joe's Plumbing", { phone: "(407) 555-1234", website: "https://www.joesplumbing.com/contact", email: "info@joesplumbing.com" });
    const r = await handleRemovalRequest(env, String(id), "suppress", "owner");
    expect(r).toMatchObject({ id, status: "done", business: "Joe's Plumbing" });
    const rows = db.prepare(`SELECT kind, reason, note, added_by FROM suppressions ORDER BY kind`).all() as { kind: string; reason: string; note: string; added_by: string }[];
    expect(rows.map((x) => x.kind).sort()).toEqual(["domain", "email", "phone"]);
    for (const x of rows) expect(x).toMatchObject({ reason: "asked_to_stop", note: "Removal request from the website", added_by: "owner" });
    const s = statusOf(db, id);
    expect(s.status).toBe("done");
    expect(s.handled_at).toBeTruthy();
    expect(s.handled_by).toBe("owner");
    // Already handled: refused, nothing changes.
    await expect(handleRemovalRequest(env, id, "dismiss", "owner")).rejects.toThrow(/already/);
    await expect(handleRemovalRequest(env, id, "suppress", "owner")).rejects.toThrow(/already/);
    expect(statusOf(db, id).status).toBe("done");
  });

  it("'dismiss' marks it dismissed without touching the list", async () => {
    const { db, env } = d1();
    const id = request(db, "Acme", { phone: "(407) 555-9999" });
    expect(await handleRemovalRequest(env, id, "dismiss", "owner")).toMatchObject({ id, status: "dismissed", suppressed: null });
    expect(statusOf(db, id)).toMatchObject({ status: "dismissed", handled_by: "owner" });
    expect((db.prepare(`SELECT COUNT(*) AS n FROM suppressions`).get() as { n: number }).n).toBe(0);
    await expect(handleRemovalRequest(env, id, "dismiss", "owner")).rejects.toThrow(/already dismissed/);
  });

  it("unknown requests, bad actions and requests with nothing to add", async () => {
    const { db, env } = d1();
    expect(await handleRemovalRequest(env, "999", "dismiss", "owner")).toBeNull();
    expect(await handleRemovalRequest(env, "abc", "dismiss", "owner")).toBeNull();
    const id = request(db, "Name only");
    await expect(handleRemovalRequest(env, id, "delete", "owner")).rejects.toThrow(/Choose/);
    await expect(handleRemovalRequest(env, id, "suppress", "owner")).rejects.toThrow(/no phone number, website or email/);
    expect(statusOf(db, id).status).toBe("new");
  });
});
