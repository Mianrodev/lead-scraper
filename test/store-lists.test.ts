import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { buy, downloadCsv, examples, maskPhone, searchLeads, zeroResultHelp } from "../src/store/catalog";
import { deleteList, getList, listLists, listName, pluralWord, renameList, saveList } from "../src/store/lists";
import storeApp from "../src/store/index";
import type { StoreAccount } from "../src/store/auth";
import type { StoreEnv } from "../src/store/types";

const fs = (await import("node:" + "fs")) as { readdirSync(p: string): string[]; readFileSync(p: string, enc: "utf8"): string };
const migrations = fs.readdirSync("migrations").filter((x) => x.endsWith(".sql")).sort();

function d1(upTo?: string) {
  const db = new DatabaseSync(":memory:");
  for (const f of migrations.filter((f) => !upTo || f < upTo)) db.exec(fs.readFileSync(`migrations/${f}`, "utf8"));
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
    const row = { id, google_place_id: `p-${id}`, business_name: `Biz ${id}`, gbp_category: "Plumber", city: "Tampa", state: "FL",
      data_source: source, business_status: "operational", gbp_phone_formatted: "+18135550100", owner_name: "Ann Lee", website: "https://x.test",
      website_domain: "x.test", presence_score: 30, ...extra };
    const keys = Object.keys(row);
    db.prepare(`INSERT INTO leads (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...(Object.values(row) as never[]));
  };
  add("f1", "free"); add("f2", "free"); add("g1", "google"); add("g2", "free+google", { gbp_phone_formatted: "+442071234567" });
  add("o1", "free", { city: "Orlando", gbp_category: "Dentist" });
  db.exec(`INSERT INTO store_accounts (id, company, status, credits) VALUES ('A', 'Alpha', 'active', 100), ('B', 'Beta', 'active', 100)`);
  db.exec(`INSERT INTO store_users (id, account_id, email, name, password_hash, password_salt, password_iterations, role) VALUES
    ('ua', 'A', 'a@a.test', 'Ann', 'x', 'x', 1, 'owner'), ('ua2', 'A', 'a2@a.test', 'Al', 'x', 'x', 1, 'member'), ('ub', 'B', 'b@b.test', 'Bo', 'x', 'x', 1, 'owner')`);
  db.exec(`UPDATE app_settings SET value = '0' WHERE key = 'store_free_per_month'`);
}
const acct = (db: DatabaseSync, id: string): StoreAccount => db.prepare("SELECT id, company, status, credits FROM store_accounts WHERE id = ?").get(id) as StoreAccount;
const q = (s: string) => new URLSearchParams(s);
const listIdOf = (r: unknown) => (r as { listId: string | null }).listId!;
async function readStream(s: ReadableStream<Uint8Array>) { return new Response(s).text(); }

describe("list names", () => {
  it("names a list from its search", () => {
    expect(listName(q("category=Plumber&city=Tampa%7CFL"))).toBe("Plumbers · Tampa, FL");
    expect(listName(q("category=Dentist&category=Lawyer&state=FL"))).toBe("Dentists + 1 more · Florida");
    expect(listName(q("near=Tampa%7CFL&radius_miles=25"))).toBe("Businesses · within 25 mi of Tampa, FL");
    expect(listName(q("industry=Home%20services&postal_code=33601"))).toBe("Home services · ZIP 33601");
    expect(listName(q("category=Real%20estate%20agency&area=1,1;2,2;3,3"))).toBe("Real estate agencies · Map area");
    expect(listName(q("city=Tampa%7CFL"), 12)).toBe("Businesses · Tampa, FL (12 picked)");
    expect(listName(q("category=Chimney%20sweep&city=Orlando%7CFL"), 2)).toBe("Chimney sweeps · Orlando, FL (2 picked)");
    expect(listName(q(""), 1)).toBe("1 picked lead");
    expect(pluralWord("Glass & mirrors")).toBe("Glass & mirrors");
    expect(pluralWord("Church")).toBe("Churches");
    expect(pluralWord("Handyman")).toBe("Handymen");
  });

  it("masks phone numbers to the area code (non-US: 3 characters)", () => {
    expect(maskPhone("+1813")).toBe("(813) •••-••••");
    expect(maskPhone("(813)")).toBe("(813) •••-••••");
    expect(maskPhone("+4420")).toBe("+44•••");
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone("")).toBeNull();
  });
});

describe("search rows", () => {
  it("unowned rows carry only a masked phone and yes/no flags; owned rows the real details", async () => {
    const { db, env } = d1(); seed(db);
    await buy(env, acct(db, "A"), { ids: ["f1"] }, q(""), "ua");
    const r = await searchLeads(env, acct(db, "A"), q("owned=all"));
    const f1 = r.results.find((x) => x.id === "f1")!, f2 = r.results.find((x) => x.id === "f2")!, g2 = r.results.find((x) => x.id === "g2")!;
    expect(f1).toMatchObject({ owned: true, phone: "+18135550100" });
    expect(f1).not.toHaveProperty("phoneMasked");
    expect(f2).toMatchObject({ owned: false, phoneMasked: "(813) •••-••••", hasEmail: false, hasOwner: true });
    expect(g2.phoneMasked).toBe("+44•••");
    for (const x of [f2, g2]) for (const k of ["phone", "phone_head", "owner", "email", "emails", "website"]) expect(x).not.toHaveProperty(k);
    expect(JSON.stringify(r.results.filter((x) => !x.owned))).not.toContain("5550100");
  });

  it("the not-yet-owned count updates right after getting leads (no stale cached count)", async () => {
    const { db, env } = d1(); seed(db);
    expect((await searchLeads(env, acct(db, "A"), q("city=Tampa%7CFL&owned=no"))).total).toBe(4);
    await buy(env, acct(db, "A"), { all: true }, q("city=Tampa%7CFL&owned=no&category=Plumber"), "ua");
    expect((await searchLeads(env, acct(db, "A"), q("city=Tampa%7CFL&owned=no"))).total).toBe(0);
    expect((await searchLeads(env, acct(db, "B"), q("city=Tampa%7CFL&owned=no"))).total).toBe(4);
  });

  it("suggests showing leads you already have as owned=all", async () => {
    const { db, env } = d1(); seed(db);
    await buy(env, acct(db, "A"), { all: true }, q("city=Tampa%7CFL"), "ua");
    const s = await zeroResultHelp(env, acct(db, "A"), q("city=Tampa%7CFL&owned=no"));
    const show = s.find((x) => x.label === "Show leads I already have")!;
    expect(new URLSearchParams(show.query).get("owned")).toBe("all");
    expect(show.n).toBe(4);
    expect((await zeroResultHelp(env, acct(db, "A"), q("city=Tampa%7CFL&owned=all&q=zzz"))).some((x) => x.label.includes("already have"))).toBe(false);
  });

  it("offers example searches from the biggest category + city pairs", async () => {
    const { db, env } = d1(); seed(db);
    const ex = await examples(env);
    expect(ex[0]).toEqual({ label: "Plumbers in Tampa", query: "category=Plumber&city=Tampa%7CFL", n: 4 });
    expect(ex[1].label).toBe("Dentists in Orlando");
    expect(ex).toHaveLength(2);
  });
});

describe("lists from getting leads", () => {
  it("every get saves a list with all the leads of the request, including ones already owned", async () => {
    const { db, env } = d1(); seed(db);
    const dry = await buy(env, acct(db, "A"), { all: true, dryRun: true }, q("category=Plumber&city=Tampa%7CFL"), "ua");
    expect(dry).toMatchObject({ count: 4, name: "Plumbers · Tampa, FL" });
    expect(await listLists(env, acct(db, "A"))).toEqual({ lists: [], allCount: 0 }); // a dry run saves nothing
    const p1 = await buy(env, acct(db, "A"), { ids: ["f1", "f2"] }, q("category=Plumber"), "ua");
    expect(p1).toMatchObject({ bought: 2, listName: "Plumbers (2 picked)", listCount: 2 });
    const all = await buy(env, acct(db, "A"), { all: true }, q("category=Plumber&city=Tampa%7CFL&owned=all"), "ua2");
    expect(all).toMatchObject({ bought: 2, credits: 6, listName: "Plumbers · Tampa, FL", listCount: 4 });
    const l = await listLists(env, acct(db, "A"));
    expect(l.allCount).toBe(4);
    expect(l.lists.map((x) => [x.name, x.count, x.byName])).toEqual([["Plumbers · Tampa, FL", 4, "Al"], ["Plumbers (2 picked)", 2, "Ann"]]);
    expect(l.lists[0].query).toBe("category=Plumber&city=Tampa%7CFL&owned=all");
    // Everything already owned: free, and still saved as a list.
    const again = await buy(env, acct(db, "A"), { ids: ["f1", "g1"] }, q(""), "ua");
    expect(again).toMatchObject({ bought: 0, credits: 0, listName: "2 picked leads", listCount: 2 });
    expect(acct(db, "A").credits).toBe(100 - 2 - 6);
  });

  it("keeps the purchase when saving the list fails", async () => {
    const { db, env } = d1(); seed(db);
    db.exec(`DROP TABLE store_list_leads`);
    const r = await buy(env, acct(db, "A"), { ids: ["f1"] }, q(""), "ua");
    expect(r).toMatchObject({ bought: 1, credits: 1, balance: 99, listId: null });
    expect((db.prepare(`SELECT COUNT(*) AS n FROM store_purchases WHERE account_id = 'A'`).get() as { n: number }).n).toBe(1);
  });

  it("saving a list is safe to repeat and only takes leads the account owns", async () => {
    const { db, env } = d1(); seed(db);
    await buy(env, acct(db, "B"), { ids: ["g1"] }, q(""), "ub");
    await buy(env, acct(db, "A"), { ids: ["f1"] }, q(""), "ua");
    const l = await saveList(env, "A", "ua", "Mixed", "", ["f1", "f1", "g1", "nope"]);
    expect(l.count).toBe(1); // g1 is B's, not A's
    expect(db.prepare(`SELECT lead_id FROM store_list_leads WHERE list_id = ?`).all(l.id)).toEqual([{ lead_id: "f1" }]);
  });

  it("rename and delete: own lists only; deleting keeps the leads", async () => {
    const { db, env } = d1(); seed(db);
    const r = await buy(env, acct(db, "A"), { ids: ["f1", "g1"] }, q(""), "ua");
    const id = listIdOf(r);
    await expect(getList(env, acct(db, "B"), id)).rejects.toMatchObject({ status: 404 });
    await expect(renameList(env, acct(db, "B"), id, { name: "Mine now" })).rejects.toMatchObject({ status: 404 });
    await expect(deleteList(env, acct(db, "B"), id)).rejects.toMatchObject({ status: 404 });
    await expect(renameList(env, acct(db, "A"), id, { name: "  " })).rejects.toMatchObject({ status: 400 });
    expect(await renameList(env, acct(db, "A"), id, { name: "  Best   plumbers " })).toEqual({ ok: true, name: "Best plumbers" });
    expect((await getList(env, acct(db, "A"), id)).name).toBe("Best plumbers");
    await deleteList(env, acct(db, "A"), id);
    expect((await listLists(env, acct(db, "A"))).lists).toEqual([]);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM store_list_leads`).get() as { n: number }).n).toBe(0);
    expect((await listLists(env, acct(db, "A"))).allCount).toBe(2);
  });

  it("downloads exactly a list's leads, and nothing from another account's list", async () => {
    const { db, env } = d1(); seed(db);
    const a1 = await buy(env, acct(db, "A"), { ids: ["f1"] }, q(""), "ua");
    await buy(env, acct(db, "A"), { ids: ["g1"] }, q(""), "ua");
    await buy(env, acct(db, "B"), { ids: ["f1", "f2"] }, q(""), "ub");
    const csvA = await readStream(await downloadCsv(env, acct(db, "A"), "simple", [], q(`list=${listIdOf(a1)}`)));
    expect(csvA.trim().split("\r\n")).toHaveLength(2);
    expect(csvA).toContain("Biz f1");
    expect(csvA).not.toContain("Biz g1");
    // B owns f1 too, but A's list is not B's: nothing comes out.
    const csvB = await readStream(await downloadCsv(env, acct(db, "B"), "simple", [], q(`list=${listIdOf(a1)}`)));
    expect(csvB.trim().split("\r\n")).toHaveLength(1);
  });
});

describe("store API: lists and the demo (account isolation)", () => {
  async function session(db: DatabaseSync, userId: string) {
    const token = [...crypto.getRandomValues(new Uint8Array(32))].map((x) => x.toString(16).padStart(2, "0")).join("");
    const h = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map((x) => x.toString(16).padStart(2, "0")).join("");
    db.prepare(`INSERT INTO store_sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))`).run(h, userId);
    return token;
  }
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
  const call = (env: StoreEnv, path: string, token?: string, init: RequestInit = {}) =>
    storeApp.fetch(new Request("https://store.test" + path, { ...init, headers: { ...(token ? { Cookie: `ls_session=${token}` } : {}), ...(init.headers ?? {}) } }), env, ctx);

  it("lists are shared by the team and invisible to other accounts", async () => {
    const { db, env } = d1(); seed(db);
    const [ta, ta2, tb] = [await session(db, "ua"), await session(db, "ua2"), await session(db, "ub")];
    const r = await buy(env, acct(db, "A"), { ids: ["f1", "g1"] }, q(""), "ua");
    const id = listIdOf(r);
    expect((await call(env, "/api/lists")).status).toBe(401);
    const mine = await (await call(env, "/api/lists", ta2)).json() as { lists: { id: string }[]; allCount: number };
    expect(mine.lists.map((l) => l.id)).toEqual([id]); // the team member sees the owner's list
    expect(mine.allCount).toBe(2);
    const one = await (await call(env, `/api/lists/${id}?page=1`, ta)).json() as { list: { name: string }; total: number; results: { phone: string }[] };
    expect(one.list.name).toBe("2 picked leads");
    expect(one.total).toBe(2);
    expect(one.results[0].phone).toBe("+18135550100");
    expect(await (await call(env, "/api/lists", tb)).json()).toEqual({ lists: [], allCount: 0 });
    expect((await call(env, `/api/lists/${id}`, tb)).status).toBe(404);
    expect((await call(env, `/api/lists/${id}`, tb, { method: "PATCH", body: JSON.stringify({ name: "x" }), headers: { "content-type": "application/json" } })).status).toBe(404);
    expect((await call(env, `/api/lists/${id}`, tb, { method: "DELETE" })).status).toBe(404);
    expect((await call(env, `/api/download?format=simple&list=${id}`, tb)).status).toBe(404);
    // Cross-site writes are refused.
    expect((await call(env, `/api/lists/${id}`, ta, { method: "DELETE", headers: { Origin: "https://evil.test" } })).status).toBe(403);
    const patched = await call(env, `/api/lists/${id}`, ta, { method: "PATCH", body: JSON.stringify({ name: "Tampa plumbers" }), headers: { "content-type": "application/json" } });
    expect(await patched.json()).toEqual({ ok: true, name: "Tampa plumbers" });
    const dl = await call(env, `/api/download?format=simple&list=${id}`, ta);
    expect(dl.status).toBe(200);
    expect(dl.headers.get("Content-Disposition")).toMatch(/^attachment; filename="tampa-plumbers-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect((await dl.text()).trim().split("\r\n")).toHaveLength(3);
    expect((await call(env, `/api/lists/${id}`, ta, { method: "DELETE" })).status).toBe(200);
    expect((await call(env, `/api/lists/${id}`, ta)).status).toBe(404);
  });

  it("serves the demo without signing in: noindex, no cookies, the demo flag on", async () => {
    const { db, env } = d1(); seed(db);
    db.exec(`UPDATE app_settings SET value = '0' WHERE key = 'store_signup_open'`);
    const r = await call(env, "/demo");
    expect(r.status).toBe(200);
    expect(r.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(r.headers.get("Set-Cookie")).toBeNull();
    const html = await r.text();
    expect(html).toContain('data-demo="1"');
    expect(html).toContain('id="demoCta" href="/contact?subject=access">Request access</a>'); // sign-ups closed: the demo still works
    expect(html).not.toContain("Biz f1"); // no real businesses in the page
  });
});

describe("migration 0028 backfill", () => {
  it("puts each account's earlier leads in one 'Earlier leads' list", () => {
    const db = new DatabaseSync(":memory:");
    for (const f of migrations.filter((f) => f < "0028")) db.exec(fs.readFileSync(`migrations/${f}`, "utf8"));
    db.exec(`INSERT INTO store_accounts (id, company, status, credits) VALUES ('A', 'Alpha', 'active', 0), ('B', 'Beta', 'active', 0), ('C', 'Gamma', 'active', 0)`);
    db.exec(`INSERT INTO store_purchases (account_id, lead_id, tier, credits, purchased_at) VALUES
      ('A', 'l1', 'free', 1, '2026-10-01 10:00:00'), ('A', 'l2', 'google', 3, '2026-10-02 10:00:00'), ('B', 'l1', 'free', 1, '2026-10-03 10:00:00')`);
    for (const f of migrations.filter((f) => f >= "0028")) db.exec(fs.readFileSync(`migrations/${f}`, "utf8"));
    expect(db.prepare(`SELECT id, account_id, name, lead_count, created_at FROM store_lists ORDER BY account_id`).all()).toEqual([
      { id: "earlier-A", account_id: "A", name: "Earlier leads", lead_count: 2, created_at: "2026-10-01 10:00:00" },
      { id: "earlier-B", account_id: "B", name: "Earlier leads", lead_count: 1, created_at: "2026-10-03 10:00:00" },
    ]);
    expect(db.prepare(`SELECT list_id, lead_id FROM store_list_leads ORDER BY list_id, lead_id`).all()).toEqual([
      { list_id: "earlier-A", lead_id: "l1" }, { list_id: "earlier-A", lead_id: "l2" }, { list_id: "earlier-B", lead_id: "l1" },
    ]);
  });
});
