import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { dbKey, inDatabase, makeEstimator } from "../src/estimate";

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
  return { db, env: { DB } as unknown as Env };
}

const place = (city: string, state = "FL") => ({ countryCode: "US", countryName: "United States", state, regionName: "Florida", city, label: city ? `${city}, ${state}` : `all of ${state}` });

describe("quick answers for Find leads", () => {
  it("counts what's in the database exactly, per type and place", async () => {
    const { db, env } = d1();
    db.exec(`INSERT INTO leads (id, google_place_id, business_name, gbp_category, city, state, business_status) VALUES
      ('a','pa','A','Plumber','Tampa','FL','operational'), ('b','pb','B','Plumber','Tampa','FL','operational'),
      ('c','pc','C','Plumber','Orlando','FL','operational'), ('d','pd','D','Plumber','Tampa','FL','permanently_closed'),
      ('e','pe','E','Electrician','Tampa','FL','operational')`);
    db.exec(`UPDATE leads SET suppressed = 'client' WHERE id = 'b'`);
    const m = await inDatabase(env, ["Plumber", "Electrician"], [place("Tampa"), place("")]);
    expect(m.get(dbKey("Plumber", place("Tampa")))).toBe(1); // closed and do-not-contact left out
    expect(m.get(dbKey("Plumber", place("")))).toBe(2); // whole state
    expect(m.get(dbKey("Electrician", place("Tampa")))).toBe(1);
  });

  it("estimates places we haven't collected from what we found elsewhere, scaled by population", async () => {
    const { db, env } = d1();
    db.exec(`INSERT INTO geo_cities (id, name, ascii, country, region, population, lat, lng) VALUES
      (900001, 'Testville', 'Testville', 'US', 'FL', 400000, 27.9, -82.4), (900002, 'Sampleton', 'Sampleton', 'US', 'FL', 300000, 28.5, -81.3),
      (900003, 'Demoburg', 'Demoburg', 'US', 'TX', 1000000, 30.2, -97.7)`);
    db.exec(`INSERT INTO searches (id, category, city, state, country_code, max_results, status, source, leads_saved) VALUES
      ('s1', 'Plumber', 'Testville', 'FL', 'US', 100, 'done', 'free', 200)`);
    const est = await makeEstimator(env);
    expect(await est("Plumber", place("Sampleton"))).toBe(150); // 200 per 400k people -> 300k people
    expect(await est("Plumber", place("Demoburg", "TX"))).toBe(500);
    expect(await est("Dentist", place("Sampleton"))).toBe(150); // never collected: the average of all types
    expect(await est("Plumber", place("Nowhere"))).toBeNull();
  });
});
