import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { buy, downloadRow, engineParams, myLeads, searchLeads } from "../src/store/catalog";
import type { StoreAccount } from "../src/store/auth";
import type { StoreEnv } from "../src/store/types";

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
  const DB = {
    prepare: (sql: string) => stmt(sql),
    batch: async (list: ReturnType<typeof stmt>[]) => {
      const out = [];
      for (const s of list) out.push(/^\s*(SELECT|WITH)/i.test(s.sql) ? await s.all() : await s.run().then((r) => ({ ...r, results: [] })));
      return out;
    },
  };
  return { db, env: { DB, LEAD_TIMEZONE: "America/New_York" } as unknown as StoreEnv };
}

function seed(db: DatabaseSync) {
  const add = (id: string, source: string, extra: Record<string, unknown> = {}) => {
    const row = { id, google_place_id: `p-${id}`, business_name: `Biz ${id}`, gbp_category: "Plumber", city: "Orlando", state: "FL",
      data_source: source, business_status: "operational", gbp_phone_formatted: "+14075550100", owner_name: "Ann Lee", website: "https://x.test",
      website_domain: "x.test", presence_score: 30, ...extra };
    const keys = Object.keys(row);
    db.prepare(`INSERT INTO leads (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...(Object.values(row) as never[]));
  };
  add("f1", "free"); add("f2", "free"); add("g1", "google"); add("g2", "free+google");
  add("form1", "form"); add("up1", "upload"); add("closed", "free", { business_status: "permanently_closed" }); add("dnc", "free", { suppressed: "client" });
  db.exec(`INSERT INTO lead_emails (lead_id, email, position) VALUES ('f1', 'ann@x.test', 0), ('f1', 'bad@x.test', 1)`);
  db.exec(`INSERT INTO email_checks (email, result, checked_at) VALUES ('bad@x.test', 'invalid', datetime('now'))`);
  db.exec(`INSERT INTO store_accounts (id, company, status, credits) VALUES ('acc', 'Buyer Co', 'active', 10), ('pend', 'New Co', 'pending', 100)`);
  db.exec(`UPDATE leads SET lead_status = 'Won', assigned_to = 'someone' WHERE id = 'f1'`);
}
const acct = (db: DatabaseSync, id = "acc"): StoreAccount => db.prepare("SELECT id, company, status, credits FROM store_accounts WHERE id = ?").get(id) as StoreAccount;

describe("store filters", () => {
  it("only passes customer filters to the engine, and only sellable sources", () => {
    const p = engineParams(new URLSearchParams("state=FL&lead_status=Won&assigned=me&data_source=form&tier=google&phone=yes&search_id=x&dnc=show&q=Joe"));
    expect(p.getAll("state")).toEqual(["FL"]);
    expect(p.get("lead_status")).toBeNull();
    expect(p.get("assigned")).toBeNull();
    expect(p.get("search_id")).toBeNull();
    expect(p.get("dnc")).toBeNull();
    expect(p.getAll("data_source")).toEqual(["google", "free+google"]);
    expect(p.get("status")).toBe("operational");
    expect(engineParams(new URLSearchParams("")).getAll("data_source")).toEqual(["free", "google", "free+google"]);
  });
});

describe("store search and buying", () => {
  it("shows only sellable leads, with contact details hidden until bought", async () => {
    const { db, env } = d1(); seed(db);
    const r = await searchLeads(env, acct(db), new URLSearchParams(""));
    expect(r.results.map((x) => x.id).sort()).toEqual(["f1", "f2", "g1", "g2"]);
    expect(r.counts).toEqual({ free: 2, google: 2 });
    const f1 = r.results.find((x) => x.id === "f1")!;
    expect(f1).toMatchObject({ owned: false, hasPhone: true, hasEmail: true, hasOwner: true, hasWebsite: true, tier: "free" });
    for (const k of ["phone", "email", "emails", "owner", "website", "address", "lead_status", "assigned_to"]) expect(f1).not.toHaveProperty(k);
  });

  it("charges the right credits, refuses when short, never charges twice", async () => {
    const { db, env } = d1(); seed(db);
    // prices: standard 1, premium 3 (migration defaults)
    const dry = await buy(env, acct(db), { all: true, dryRun: true }, new URLSearchParams(""), "u");
    expect(dry).toMatchObject({ count: 4, free: 2, google: 2, credits: 8, balance: 10 });
    const r = await buy(env, acct(db), { ids: ["f1", "g1", "form1", "closed", "dnc", "up1"] }, new URLSearchParams(""), "u");
    expect(r).toMatchObject({ bought: 2, credits: 4, balance: 6 }); // form, upload, closed, do-not-contact are never sold
    const again = await buy(env, acct(db), { ids: ["f1", "g1"] }, new URLSearchParams(""), "u");
    expect(again).toMatchObject({ bought: 0, credits: 0, balance: 6 });
    await expect(buy(env, acct(db), { all: true }, new URLSearchParams(""), "u")).resolves.toMatchObject({ bought: 2, credits: 4, balance: 2 });
    db.exec(`INSERT INTO leads (id, google_place_id, business_name, data_source, business_status) VALUES ('g3', 'p-g3', 'Biz g3', 'google', 'operational')`);
    await expect(buy(env, acct(db), { ids: ["g3"] }, new URLSearchParams(""), "u")).rejects.toMatchObject({ status: 402 });
    expect(acct(db).credits).toBe(2);
    const ledger = db.prepare("SELECT delta, balance, kind FROM store_ledger ORDER BY id").all();
    expect(ledger).toEqual([{ delta: -4, balance: 6, kind: "purchase" }, { delta: -4, balance: 2, kind: "purchase" }]);
    await expect(buy(env, acct(db, "pend"), { ids: ["f2"] }, new URLSearchParams(""), "u")).rejects.toMatchObject({ status: 403 });
  });

  it("reveals details for owned leads (bad emails left out) in search, my leads and downloads", async () => {
    const { db, env } = d1(); seed(db);
    await buy(env, acct(db), { ids: ["f1"] }, new URLSearchParams(""), "u");
    const s = await searchLeads(env, acct(db), new URLSearchParams("owned=yes"));
    expect(s.results).toHaveLength(1);
    expect(s.results[0]).toMatchObject({ id: "f1", owned: true, phone: "+14075550100", email: "ann@x.test", owner: "Ann Lee", website: "https://x.test" });
    expect(s.results[0].emails).toEqual(["ann@x.test"]);
    const mine = await myLeads(env, acct(db), new URLSearchParams(""));
    expect(mine.total).toBe(1);
    const notOwned = await searchLeads(env, acct(db), new URLSearchParams("owned=no"));
    expect(notOwned.results.map((x) => x.id)).not.toContain("f1");
    const row = downloadRow("simple", { id: "f1", business_name: "Biz", owner_name: "Ann Lee", owner_title: null, gbp_category: "Plumber", gbp_phone_formatted: "+14075550100",
      gbp_phone_raw: null, phone_type: "mobile", website: null, address: null, city: "Orlando", state: "FL", postal_code: null, rating: null, review_count: null,
      presence_score: 30, score_notes: null, data_source: "free", purchased_at: "2026-09-30 10:00:00" }, ["ann@x.test"])!;
    expect(row[0]).toBe("Biz"); expect(row[5]).toBe("yes"); expect(row.at(-2)).toBe("Standard"); expect(row.at(-1)).toBe("2026-09-30");
  });
});
