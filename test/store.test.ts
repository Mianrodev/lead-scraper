import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { COLD_COLUMNS, SIMPLE_COLUMNS, affordableCount, buy, creditHistory, downloadRow, engineParams, freeAllowance, mapPoints, monthKey, myLeads, searchLeads, splitFree, topFixes } from "../src/store/catalog";
import { addTeamMember, listSaved, listTeam, removeTeamMember, saveSearch } from "../src/store/team";
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
  db.exec(`UPDATE app_settings SET value = '0' WHERE key = 'store_free_per_month'`); // these tests price every lead
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
    expect(row[0]).toBe("Biz"); expect(row[5]).toBe("yes");
    expect(row[SIMPLE_COLUMNS.indexOf("Type")]).toBe("Standard"); expect(row[SIMPLE_COLUMNS.indexOf("Unlocked On")]).toBe("2026-09-30");
    expect(row).toHaveLength(SIMPLE_COLUMNS.length);
  });
});

describe("buy safety and buyer help", () => {
  it("refuses (409) when the real price is higher than the price shown", async () => {
    const { db, env } = d1(); seed(db);
    const dry = await buy(env, acct(db), { ids: ["f1"], dryRun: true }, new URLSearchParams(""), "u");
    expect(dry).toMatchObject({ count: 1, credits: 1 });
    await expect(buy(env, acct(db), { ids: ["f1", "g1"], expectedCredits: 1 }, new URLSearchParams(""), "u")).rejects.toMatchObject({ status: 409 });
    expect(acct(db).credits).toBe(10); // nothing charged
    const r = await buy(env, acct(db), { ids: ["f1"], expectedCredits: 1 }, new URLSearchParams(""), "u");
    expect(r).toMatchObject({ bought: 1, credits: 1, balance: 9 });
    expect(typeof (r as { at?: unknown }).at).toBe("string");
  });

  it("unlocks what the balance covers, cheapest first", async () => {
    expect(affordableCount([1, 1, 3, 3], 0, 4)).toBe(2);
    expect(affordableCount([1, 1, 3, 3], 0, 5)).toBe(3);
    expect(affordableCount([1, 1, 3, 3], 1, 4)).toBe(3); // the free one covers a premium, the two standard cost 2
    expect(affordableCount([1, 1, 3, 3], 10, 0)).toBe(4);
    expect(affordableCount([3], 0, 2)).toBe(0);
    const { db, env } = d1(); seed(db);
    db.exec(`UPDATE store_accounts SET credits = 4 WHERE id = 'acc'`); // all 4 cost 8
    const dry = await buy(env, acct(db), { all: true, dryRun: true }, new URLSearchParams(""), "u");
    expect(dry).toMatchObject({ count: 4, credits: 8, coverable: 2 }); // the two standard leads (1 + 1); a premium one would make 5
    const part = await buy(env, acct(db), { all: true, affordable: true }, new URLSearchParams("sort=score&dir=desc"), "u");
    expect(part).toMatchObject({ bought: 2, free: 2, google: 0, credits: 2, balance: 2 });
  });

  it("returns what to fix only for owned leads", async () => {
    const { db, env } = d1(); seed(db);
    db.exec(`UPDATE leads SET score_notes = '{"suggestions":["Add online booking","Add a contact form","Speed up the website","Add photos"]}'`);
    await buy(env, acct(db), { ids: ["f1"] }, new URLSearchParams(""), "u");
    const r = await searchLeads(env, acct(db), new URLSearchParams(""));
    expect(r.results.find((x) => x.id === "f1")!.fixes).toEqual(["Add online booking", "Add a contact form", "Speed up the website"]);
    for (const x of r.results.filter((x) => x.id !== "f1")) { expect(x).not.toHaveProperty("fixes"); expect(x).not.toHaveProperty("notes_json"); }
    expect(topFixes("not json")).toEqual([]);
  });

  it("cold-email rows carry an opener built from the top fix", () => {
    const row = downloadRow("cold_email", { id: "f1", business_name: "Joe's Plumbing", owner_name: "Ann Lee", owner_title: null, gbp_category: "Plumber", gbp_phone_formatted: null,
      gbp_phone_raw: null, phone_type: null, website: null, address: null, city: "Orlando", state: "FL", postal_code: null, rating: null, review_count: null,
      presence_score: 30, score_notes: '{"suggestions":["Add online booking"]}', data_source: "free", purchased_at: "2026-09-30 10:00:00" }, ["ann@x.test"])!;
    expect(row).toHaveLength(COLD_COLUMNS.length);
    expect(row[COLD_COLUMNS.indexOf("Opener")]).toBe("I was looking at Joe's Plumbing online and noticed customers can't book with you online.");
  });

  it("suggests which filter to drop when nothing matches", async () => {
    const { db, env } = d1(); seed(db);
    const r = await searchLeads(env, acct(db), new URLSearchParams("city=Orlando%7CFL&q=nomatch"));
    expect(r.total).toBe(0);
    expect(r.maxPage).toBe(200);
    const drop = r.suggestions!.find((s) => s.label.includes("Name contains"))!;
    expect(drop.n).toBe(4);
    expect(new URLSearchParams(drop.query).get("q")).toBeNull();
    expect(r.suggestions!.some((s) => s.label === "Search all of FL")).toBe(true);
    const near = r.suggestions!.find((s) => s.label.startsWith("Nearby"))!;
    expect(new URLSearchParams(near.query).get("radius_miles")).toBe("25");
    const some = await searchLeads(env, acct(db), new URLSearchParams("city=Orlando%7CFL"));
    expect(some).not.toHaveProperty("suggestions");
  });

  it("my leads: filters, email count, facets, and who unlocked in the history", async () => {
    const { db, env } = d1(); seed(db);
    db.exec(`INSERT INTO store_users (id, account_id, email, name, password_hash, password_salt, password_iterations, role) VALUES ('u1', 'acc', 'o@b.test', 'Olive', 'x', 'x', 1, 'owner')`);
    db.exec(`UPDATE leads SET city = 'Tampa' WHERE id = 'g1'`);
    await buy(env, acct(db), { ids: ["f1", "g1"] }, new URLSearchParams(""), "u1");
    const all = await myLeads(env, acct(db), new URLSearchParams("facets=1"));
    expect(all).toMatchObject({ total: 2, withEmail: 1 });
    expect(all.facets!.cities.map((c) => (c as { value: string }).value).sort()).toEqual(["Orlando|FL", "Tampa|FL"]);
    expect(all.results[0]).toHaveProperty("purchasedAt");
    const tampa = await myLeads(env, acct(db), new URLSearchParams("city=Tampa%7CFL"));
    expect(tampa.results.map((x) => x.id)).toEqual(["g1"]);
    expect(tampa).not.toHaveProperty("facets");
    const h = await creditHistory(env, acct(db));
    expect((h.history[0] as { byName: string }).byName).toBe("Olive");
  });
});

describe("free monthly allowance", () => {
  it("covers the priciest leads first", () => {
    const leads = [{ tier: "free" as const }, { tier: "google" as const }, { tier: "free" as const }];
    expect(splitFree(leads, 1, { free: 1, google: 3 })).toEqual({ freeLeads: 1, credits: 2 });
    expect(splitFree(leads, 5, { free: 1, google: 3 })).toEqual({ freeLeads: 3, credits: 0 });
    expect(splitFree(leads, 0, { free: 1, google: 3 })).toEqual({ freeLeads: 0, credits: 5 });
  });

  it("is used before credits, once per month", async () => {
    const { db, env } = d1(); seed(db);
    db.exec(`UPDATE app_settings SET value = '3' WHERE key = 'store_free_per_month'`);
    const dry = await buy(env, acct(db), { all: true, dryRun: true }, new URLSearchParams(""), "u");
    expect(dry).toMatchObject({ count: 4, freeLeads: 3, credits: 1 }); // 2 premium + 1 standard free, 1 standard paid
    const r = await buy(env, acct(db), { all: true }, new URLSearchParams(""), "u");
    expect(r).toMatchObject({ bought: 4, freeLeads: 3, credits: 1, balance: 9 });
    expect(await freeAllowance(env, "acc")).toEqual({ perMonth: 3, used: 3, left: 0 });
    // A new month starts again.
    db.exec(`UPDATE store_accounts SET free_period = '2000-01' WHERE id = 'acc'`);
    expect((await freeAllowance(env, "acc")).left).toBe(3);
    expect(monthKey(new Date("2026-10-15T00:00:00Z"))).toBe("2026-10");
  });
});

describe("map, team and saved searches", () => {
  it("map shows sellable businesses with a position, owned marked", async () => {
    const { db, env } = d1(); seed(db);
    db.exec(`UPDATE leads SET latitude = 28.5, longitude = -81.4`);
    await buy(env, acct(db), { ids: ["f1"] }, new URLSearchParams(""), "u");
    const m = await mapPoints(env, acct(db), new URLSearchParams(""));
    expect(m.points.map((p) => p.id).sort()).toEqual(["f1", "f2", "g1", "g2"]);
    expect(m.points.find((p) => p.id === "f1")!.owned).toBe(true);
    expect(m.points[0]).not.toHaveProperty("phone");
  });

  it("owner adds and removes colleagues; members can't", async () => {
    const { db, env } = d1(); seed(db);
    const owner = { id: "u1", name: "O", email: "o@b.test", must_change_password: 0, role: "owner" as const };
    db.exec(`INSERT INTO store_users (id, account_id, email, password_hash, password_salt, password_iterations, role) VALUES ('u1', 'acc', 'o@b.test', 'x', 'x', 1, 'owner')`);
    const r = await addTeamMember(env, acct(db), owner, { name: "Sam", email: "Sam@B.test" });
    expect(r.password.length).toBeGreaterThanOrEqual(12);
    const team = await listTeam(env, acct(db), owner);
    expect(team.map((t) => [t.email, t.role, t.me])).toEqual([["o@b.test", "owner", true], ["sam@b.test", "member", false]]);
    const member = { ...owner, id: team[1].id, role: "member" as const };
    await expect(addTeamMember(env, acct(db), member, { email: "x@b.test" })).rejects.toMatchObject({ status: 403 });
    await expect(removeTeamMember(env, acct(db), owner, "u1")).rejects.toBeTruthy();
    await removeTeamMember(env, acct(db), owner, team[1].id);
    expect((await listTeam(env, acct(db), owner)).length).toBe(1);
  });

  it("saves searches without paging", async () => {
    const { db, env } = d1(); seed(db);
    await saveSearch(env, acct(db), { name: "Orlando plumbers", query: "?state=FL&category=Plumber&page=3" });
    const list = (await listSaved(env, acct(db))) as { name: string; query: string }[];
    expect(list[0]).toMatchObject({ name: "Orlando plumbers", query: "state=FL&category=Plumber" });
  });
});
