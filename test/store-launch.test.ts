import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { creditPaidSession, handleStripeWebhook, verifyStripeSignature } from "../src/store/payments";
import { confirmEmail, needsEmailConfirmation, requestPasswordReset, resetPassword, sendVerification } from "../src/store/mail";
import { launchChecklist, parsePacks, saveLaunchSettings, validatePacks } from "../src/store/launch";
import { checkTurnstile } from "../src/store/turnstile";

const fs = (await import("node:" + "fs")) as { readdirSync(p: string): string[]; readFileSync(p: string, enc: "utf8"): string };

function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of fs.readdirSync("migrations").filter((x) => x.endsWith(".sql")).sort()) db.exec(fs.readFileSync(`migrations/${f}`, "utf8"));
  const stmt = (sql: string, binds: unknown[] = []) => ({
    sql,
    bind: (...b: unknown[]) => stmt(sql, b),
    all: async () => ({ results: db.prepare(sql).all(...(binds as never[])) }),
    first: async (col?: string) => { const r = db.prepare(sql).get(...(binds as never[])) as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
    run: async () => { const r = db.prepare(sql).run(...(binds as never[])) as { changes: number }; return { meta: { changes: r.changes } }; },
  });
  const DB = { prepare: (sql: string) => stmt(sql), batch: async (list: ReturnType<typeof stmt>[]) => { const out = []; for (const s of list) out.push(/^\s*(SELECT|WITH)/i.test(s.sql) ? await s.all() : await s.run()); return out; } };
  db.exec(`INSERT INTO store_accounts (id, company, status, credits) VALUES ('acc1', 'Acme Agency', 'active', 10)`);
  db.exec(`INSERT INTO store_users (id, account_id, email, name, password_hash, password_salt, password_iterations) VALUES ('u1', 'acc1', 'sam@acme.test', 'Sam', 'x', 'y', 1)`);
  return { db, DB: DB as unknown as D1Database };
}

async function sign(secret: string, t: number, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`)))].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `t=${t},v1=${sig}`;
}

afterEach(() => vi.unstubAllGlobals());

describe("card payments", () => {
  it("checks Stripe's signature and its age", async () => {
    const now = 1_800_000_000, body = '{"a":1}';
    expect(await verifyStripeSignature("whsec_x", await sign("whsec_x", now, body), body, now)).toBe(true);
    expect(await verifyStripeSignature("whsec_x", await sign("whsec_other", now, body), body, now)).toBe(false);
    expect(await verifyStripeSignature("whsec_x", await sign("whsec_x", now, body), '{"a":2}', now)).toBe(false);
    expect(await verifyStripeSignature("whsec_x", await sign("whsec_x", now - 1000, body), body, now)).toBe(false);
    expect(await verifyStripeSignature("whsec_x", undefined, body, now)).toBe(false);
  });

  it("adds the credits exactly once, with a history line and an owner note", async () => {
    const { db, DB } = d1();
    db.exec(`INSERT INTO store_payments (id, account_id, user_id, credits, amount_cents) VALUES ('cs_test_1', 'acc1', 'u1', 100, 5000)`);
    const env = { DB } as never;
    const s = { id: "cs_test_1", payment_status: "paid", amount_total: 5000, currency: "usd", client_reference_id: "acc1" };
    expect(await creditPaidSession(env, s)).toBe("credited");
    expect(await creditPaidSession(env, s)).toBe("already");
    expect((db.prepare(`SELECT credits FROM store_accounts WHERE id = 'acc1'`).get() as { credits: number }).credits).toBe(110);
    const ledger = db.prepare(`SELECT delta, balance, kind, created_by FROM store_ledger`).all();
    expect(ledger).toEqual([{ delta: 100, balance: 110, kind: "payment", created_by: "u1" }]);
    expect((db.prepare(`SELECT status FROM store_payments`).get() as { status: string }).status).toBe("paid");
    expect((db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE kind = 'store'`).get() as { n: number }).n).toBe(1);
  });

  it("never credits a payment that doesn't match the order, an unpaid one, or an unknown one", async () => {
    const { db, DB } = d1();
    db.exec(`INSERT INTO store_payments (id, account_id, credits, amount_cents) VALUES ('cs_test_2', 'acc1', 100, 5000)`);
    const env = { DB } as never;
    expect(await creditPaidSession(env, { id: "cs_test_2", payment_status: "paid", amount_total: 100, currency: "usd", client_reference_id: "acc1" })).toBe("mismatch");
    expect(await creditPaidSession(env, { id: "cs_test_2", payment_status: "unpaid", amount_total: 5000, currency: "usd", client_reference_id: "acc1" })).toBe("unpaid");
    expect(await creditPaidSession(env, { id: "cs_nope", payment_status: "paid", amount_total: 5000, currency: "usd", client_reference_id: "acc1" })).toBe("unknown");
    expect((db.prepare(`SELECT credits FROM store_accounts WHERE id = 'acc1'`).get() as { credits: number }).credits).toBe(10);
  });

  it("the webhook refuses unsigned calls and credits signed ones", async () => {
    const { db, DB } = d1();
    db.exec(`INSERT INTO store_payments (id, account_id, credits, amount_cents) VALUES ('cs_test_3', 'acc1', 50, 2500)`);
    const env = { DB, STRIPE_SECRET_KEY: "sk_test", STRIPE_WEBHOOK_SECRET: "whsec_y" } as never;
    const body = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_test_3", payment_status: "paid", amount_total: 2500, currency: "usd", client_reference_id: "acc1" } } });
    expect((await handleStripeWebhook(env, body, "t=1,v1=bad")).status).toBe(400);
    expect(await handleStripeWebhook(env, body, await sign("whsec_y", Math.floor(Date.now() / 1000), body))).toEqual({ status: 200, body: "credited" });
    expect((await handleStripeWebhook({ DB } as never, body, undefined)).status).toBe(404); // payments off
  });
});

describe("credit packs and the launch checklist", () => {
  it("validates packs", () => {
    expect(validatePacks([{ credits: 500, price: "200" }, { credits: 100, price: 50 }])).toEqual([{ credits: 100, price: 50 }, { credits: 500, price: 200 }]);
    expect(() => validatePacks([{ credits: 0, price: 5 }])).toThrow(/whole number/);
    expect(() => validatePacks([{ credits: 10, price: 0.1 }])).toThrow(/\$0\.50/);
    expect(() => validatePacks([{ credits: 10, price: 5 }, { credits: 10, price: 6 }])).toThrow(/same number/);
    expect(parsePacks("not json")).toEqual([]);
  });

  it("lists what's left to do, and ticks things off", async () => {
    const { DB } = d1();
    let c = await launchChecklist(DB);
    expect(c.ready).toBe(false);
    expect(c.items.find((i) => i.key === "packs")!.done).toBe(false);
    await saveLaunchSettings(DB, { packs: [{ credits: 100, price: 50 }], legalReviewed: true });
    c = await launchChecklist(DB);
    expect(c.items.find((i) => i.key === "packs")!.done).toBe(true);
    expect(c.items.find((i) => i.key === "legal")!.done).toBe(true);
    await expect(saveLaunchSettings(DB, { emailFrom: "not an email" })).rejects.toThrow(/send emails from/i);
  });
});

describe("emails: password reset and email confirmation", () => {
  function mailEnv(DB: D1Database) {
    const sent: { to: string[]; text: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body))); return new Response("{}", { status: 200 }); }));
    return { env: { DB, RESEND_API_KEY: "re_test" } as never, sent };
  }

  it("does nothing until emails are switched on", async () => {
    const { DB } = d1();
    await expect(requestPasswordReset({ DB } as never, "sam@acme.test", "https://s.test")).rejects.toThrow(/can't email/);
    expect(await needsEmailConfirmation({ DB } as never, { id: "u1", role: "owner" })).toBe(false);
  });

  it("resets a password with the emailed link, once", async () => {
    const { db, DB } = d1();
    await saveLaunchSettings(DB, { emailFrom: "Acme Leads <hi@acme.test>" });
    const { env, sent } = mailEnv(DB);
    db.exec(`INSERT INTO store_sessions (token_hash, user_id, expires_at) VALUES ('h', 'u1', datetime('now', '+1 day'))`);
    expect(await requestPasswordReset(env, "nobody@acme.test", "https://s.test")).toEqual({ ok: true }); // same answer, no email
    expect(sent).toHaveLength(0);
    await requestPasswordReset(env, "SAM@acme.test", "https://s.test");
    expect(sent).toHaveLength(1);
    const token = /#reset\?t=([0-9a-f]{64})/.exec(sent[0].text)![1];
    await expect(resetPassword(env, token, "short")).rejects.toThrow();
    await resetPassword(env, token, "a-much-longer-password");
    await expect(resetPassword(env, token, "another-long-password")).rejects.toThrow(/expired or was already used/);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM store_sessions`).get() as { n: number }).n).toBe(0);
    await expect(requestPasswordReset(env, "sam@acme.test", "https://s.test")).resolves.toEqual({ ok: true }); // too soon: no second email
    expect(sent).toHaveLength(1);
  });

  it("asks new sign-ups to confirm their email before unlocking (not team members)", async () => {
    const { db, DB } = d1();
    await saveLaunchSettings(DB, { emailFrom: "hi@acme.test" });
    const { env, sent } = mailEnv(DB);
    db.exec(`UPDATE store_users SET email_verified_at = NULL`);
    expect(await needsEmailConfirmation(env, { id: "u1", role: "owner" })).toBe(true);
    expect(await needsEmailConfirmation(env, { id: "u1", role: "member" })).toBe(false);
    await sendVerification(env, "u1", "sam@acme.test", "https://s.test", true);
    const token = /#verify\?t=([0-9a-f]{64})/.exec(sent[0].text)![1];
    await confirmEmail(env, token);
    expect(await needsEmailConfirmation(env, { id: "u1", role: "owner" })).toBe(false);
  });
});

describe("spam check", () => {
  it("is skipped when off and required when on", async () => {
    await expect(checkTurnstile({} as never, "", "1.2.3.4")).resolves.toBeUndefined();
    const on = { TURNSTILE_SITE_KEY: "s", TURNSTILE_SECRET_KEY: "k" } as never;
    await expect(checkTurnstile(on, "", "1.2.3.4")).rejects.toThrow(/human/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }))));
    await expect(checkTurnstile(on, "tok", "1.2.3.4")).resolves.toBeUndefined();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false }))));
    await expect(checkTurnstile(on, "tok", "1.2.3.4")).rejects.toThrow(/didn't pass/);
  });
});
