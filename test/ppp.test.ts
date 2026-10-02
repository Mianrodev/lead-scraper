import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { claimPpp, employeeBracket, estimateRanges, pppRanges, pppWaiting, revenueBrackets, sanitizePpp, savePppResults } from "../src/ppp";

const fs = (await import("node:" + "fs")) as { readdirSync(p: string): string[]; readFileSync(p: string, enc: "utf8"): string };

/** The real schema in Node's SQLite, behind the small part of D1's API the code uses. */
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of fs.readdirSync("migrations").filter((x) => x.endsWith(".sql")).sort()) db.exec(fs.readFileSync(`migrations/${f}`, "utf8"));
  const stmt = (sql: string, binds: unknown[] = []) => ({
    bind: (...b: unknown[]) => stmt(sql, b),
    all: async () => ({ results: db.prepare(sql).all(...(binds as never[])) }),
    first: async (col?: string) => { const r = db.prepare(sql).get(...(binds as never[])) as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
    run: async () => { const r = db.prepare(sql).run(...(binds as never[])) as { changes: number }; return { meta: { changes: r.changes } }; },
  });
  const DB = { prepare: (sql: string) => stmt(sql), batch: async (list: ReturnType<typeof stmt>[]) => Promise.all(list.map((s) => s.run())) };
  return { db, env: { DB } as unknown as Env };
}

describe("size brackets", () => {
  it("employees", () => {
    expect(employeeBracket(0)).toEqual({ min: 1, max: 4 });
    expect(employeeBracket(4)).toEqual({ min: 1, max: 4 });
    expect(employeeBracket(5)).toEqual({ min: 5, max: 9 });
    expect(employeeBracket(49)).toEqual({ min: 20, max: 49 });
    expect(employeeBracket(250)).toEqual({ min: 250, max: 499 });
    expect(employeeBracket(800)).toEqual({ min: 500, max: null });
  });

  it("revenue snaps outward to brackets", () => {
    expect(revenueBrackets(240_000, 384_000)).toEqual({ min: 0, max: 500_000 });
    expect(revenueBrackets(300_000, 480_000)).toEqual({ min: 250_000, max: 500_000 });
    expect(revenueBrackets(0, 0)).toEqual({ min: 0, max: 250_000 });
    expect(revenueBrackets(250_000, 250_000)).toEqual({ min: 250_000, max: 500_000 });
    expect(revenueBrackets(12_000_000, 40_000_000)).toEqual({ min: 10_000_000, max: null });
    expect(revenueBrackets(30_000_000, 48_000_000)).toEqual({ min: 25_000_000, max: null });
  });

  it("PPP loan -> ranges", () => {
    // $20k loan -> payroll $96k -> revenue $240k-$384k
    expect(pppRanges({ jobs: 3, loan: 20_000, year: 2020, naics: "238220", draw: "PPP" }))
      .toEqual({ employeesMin: 1, employeesMax: 4, revenueMin: 0, revenueMax: 500_000, sizeSource: "ppp", sizeYear: 2020 });
    // $150k loan -> payroll $720k -> revenue $1.8M-$2.88M
    expect(pppRanges({ jobs: 22, loan: 150_000, year: 2021, naics: null, draw: null }))
      .toMatchObject({ employeesMin: 20, employeesMax: 49, revenueMin: 1_000_000, revenueMax: 5_000_000 });
    // Restaurants' second draw is 3.5 months of payroll: $105k -> payroll $360k -> $900k-$1.44M
    expect(pppRanges({ jobs: 15, loan: 105_000, year: 2021, naics: "722511", draw: "PPS" }))
      .toMatchObject({ revenueMin: 500_000, revenueMax: 2_500_000 });
  });

  it("estimate only from a known review count", () => {
    expect(estimateRanges(null)).toBeNull();
    expect(estimateRanges(undefined)).toBeNull();
    expect(estimateRanges(5)).toEqual({ employeesMin: 1, employeesMax: 4, revenueMin: 0, revenueMax: 1_000_000, sizeSource: "estimate", sizeYear: null });
    expect(estimateRanges(50)).toMatchObject({ employeesMin: 5, employeesMax: 9, revenueMin: 500_000, revenueMax: 2_500_000 });
    expect(estimateRanges(150)).toMatchObject({ employeesMin: 10, employeesMax: 19 });
    expect(estimateRanges(1000)).toMatchObject({ employeesMin: 20, employeesMax: 49, revenueMin: 1_000_000, revenueMax: 10_000_000 });
  });

  it("sanitizes collector results", () => {
    expect(sanitizePpp({ id: "bad id!" })).toBeNull();
    expect(sanitizePpp({ id: "a" })).toEqual({ id: "a", loan: null });
    expect(sanitizePpp({ id: "a", match: { jobs: 3, loan: 99e9, year: 2020 } })).toEqual({ id: "a", loan: null });
    expect(sanitizePpp({ id: "a", match: { jobs: 3, loan: 1000, year: 2019 } })).toEqual({ id: "a", loan: null });
    expect(sanitizePpp({ id: "a", match: { jobs: "3", loan: 1000.4, year: 2021, naics: "x", draw: "ZZZ" } }))
      .toEqual({ id: "a", loan: { jobs: 3, loan: 1000, year: 2021, naics: null, draw: null } });
  });
});

describe("claim and save", () => {
  it("hands out unchecked businesses, saves ranges, never replaces PPP with an estimate, keeps to the daily budget", async () => {
    const { db, env } = d1();
    const add = (id: string, reviews: number | null, extra = "") =>
      db.exec(`INSERT INTO leads (id, google_place_id, business_name, state, city, postal_code, review_count${extra ? ", size_source" : ""})
        VALUES ('${id}', 'p-${id}', 'Biz ${id}', 'FL', 'Palm Bay', '32905', ${reviews ?? "NULL"}${extra ? `, '${extra}'` : ""})`);
    add("a", 3); add("b", 150); add("c", null); add("d", 10, "ppp"); add("e", 2);
    db.exec(`UPDATE leads SET employees_min = 50, employees_max = 99, size_year = 2020 WHERE id = 'd'`);
    db.exec(`INSERT INTO leads (id, google_place_id, business_name, state) VALUES ('z', 'p-z', 'Tex', 'TX')`);

    expect(await pppWaiting(env)).toEqual(["FL"]);
    const page = await claimPpp(env, "FL", 0, 10);
    expect(page.items.map((x) => x.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(page.items[0]).toMatchObject({ name: "Biz a", zip: "32905", city: "Palm Bay", reviewCount: 3, registryName: null });
    expect((await claimPpp(env, "TX", 0, 10)).items).toEqual([]);

    const r = await savePppResults(env, [
      { id: "a", match: { jobs: 12, loan: 60_000, year: 2021, naics: "238220", draw: "PPS" } },
      { id: "b" }, { id: "c" }, { id: "d" }, { id: "nope" },
    ]);
    expect(r).toMatchObject({ saved: 4, matched: 1, estimated: 1, capped: false });
    const rows = Object.fromEntries((db.prepare(`SELECT id, employees_min, employees_max, revenue_min, revenue_max, size_source, size_year,
      ppp_checked_at IS NOT NULL AS checked FROM leads WHERE state = 'FL'`).all() as Record<string, unknown>[]).map((x) => [x.id, x]));
    expect(rows.a).toMatchObject({ employees_min: 10, employees_max: 19, revenue_min: 500_000, revenue_max: 2_500_000, size_source: "ppp", size_year: 2021, checked: 1 });
    expect(rows.b).toMatchObject({ employees_min: 10, employees_max: 19, size_source: "estimate", size_year: null, checked: 1 });
    expect(rows.c).toMatchObject({ employees_min: null, size_source: null, checked: 1 }); // unknown stays unknown
    expect(rows.d).toMatchObject({ employees_min: 50, size_source: "ppp", size_year: 2020, checked: 1 }); // PPP kept
    expect(rows.e).toMatchObject({ checked: 0 });

    // Checked businesses aren't handed out again; a second save of the same id is ignored.
    expect((await claimPpp(env, "FL", 0, 10)).items.map((x) => x.id)).toEqual(["e"]);
    expect((await savePppResults(env, [{ id: "a" }])).saved).toBe(0);

    // Budget: with 4 used and a cap of 4, nothing more today.
    db.exec(`INSERT INTO app_settings (key, value) VALUES ('ppp_daily_cap', '4')`);
    expect(await pppWaiting(env)).toEqual([]);
    expect(await claimPpp(env, "FL", 0, 10)).toMatchObject({ items: [], done: true, leftToday: 0 });
    expect(await savePppResults(env, [{ id: "e" }])).toMatchObject({ saved: 0, capped: true });
    db.exec(`UPDATE app_settings SET value = '5' WHERE key = 'ppp_daily_cap'`);
    const last = await claimPpp(env, "FL", 0, 10);
    expect(last).toMatchObject({ done: true, leftToday: 1 });
    expect(last.items.map((x) => x.id)).toEqual(["e"]);
    expect(await savePppResults(env, [{ id: "e" }])).toMatchObject({ saved: 1, estimated: 1, leftToday: 0 });
    expect(await pppWaiting(env)).toEqual([]);
  });
});
