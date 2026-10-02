import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  BACKFILL_PER_DAY, claimRegistry, foundedDate, registryStatus, registryWaiting, sanitizeContacts, sanitizeRegistry, saveRegistryResults,
} from "../src/registry";

// The project is typed for Workers, not Node, so the file reading is typed by hand here.
const fs = (await import("node:" + "fs")) as { readdirSync(p: string): string[]; readFileSync(p: string, enc: "utf8"): string };
const migrationFiles = () => fs.readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort();

/** The real schema (every migration in order) behind a tiny D1 look-alike. */
function setup() {
  const db = new DatabaseSync(":memory:");
  for (const f of migrationFiles()) db.exec(fs.readFileSync(`migrations/${f}`, "utf8"));
  const batches: number[] = [];
  const stmt = (sql: string, args: unknown[] = []) => ({
    sql, args,
    bind: (...a: unknown[]) => stmt(sql, a),
    first: async (col?: string) => {
      const row = db.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined;
      return row ? (col ? row[col] : row) : null;
    },
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    run: async () => db.prepare(sql).run(...(args as never[])),
  });
  const env = {
    DB: {
      prepare: (sql: string) => stmt(sql),
      batch: async (list: ReturnType<typeof stmt>[]) => {
        batches.push(list.length);
        db.exec("BEGIN");
        try {
          for (const s of list) db.prepare(s.sql).run(...(s.args as never[]));
          db.exec("COMMIT");
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
      },
    },
  } as unknown as Env;
  const addLead = (id: string, state = "FL", over: Record<string, string | null> = {}) => {
    const cols = { id, google_place_id: `ovt:${id}`, business_name: `Biz ${id}`, state, city: "Orlando", ...over };
    db.prepare(`INSERT INTO leads (${Object.keys(cols).join(", ")}) VALUES (${Object.keys(cols).map(() => "?").join(", ")})`).run(...Object.values(cols));
  };
  return { db, env, batches, addLead };
}

describe("registry results: people and founding date", () => {
  it("keeps up to 5 plausible people, once each, with plain titles", () => {
    expect(sanitizeContacts([
      { name: "Bob Ray", title: "PD" }, { name: "<b>x</b>", title: "P" }, { name: "bob ray", title: "S" }, { name: "Ann Lee", title: "MGRM" },
      { name: "Cy Do", title: null }, { name: "Di Fa" }, { name: "Ed Go", title: "T" }, { name: "Flo Ha", title: "S" }, "junk", null,
    ])).toEqual([
      { name: "Bob Ray", title: "President" }, { name: "Ann Lee", title: "Managing Member" }, { name: "Cy Do", title: null },
      { name: "Di Fa", title: null }, { name: "Ed Go", title: "Treasurer" },
    ]);
    expect(sanitizeContacts("Bob Ray")).toEqual([]);
  });

  it("accepts only real dates from 1800 to today", () => {
    expect(foundedDate("2015-03-04", "2026-10-02")).toBe("2015-03-04");
    expect(foundedDate("1800-01-01", "2026-10-02")).toBe("1800-01-01");
    for (const bad of ["1799-12-31", "2027-01-01", "2015-02-30", "03042015", "2015-3-4", "", null, 20150304]) expect(foundedDate(bad, "2026-10-02")).toBeNull();
  });

  it("adds contacts and founded only when present (the owner fields are unchanged)", () => {
    expect(sanitizeRegistry({ id: "a1", ownerName: "Selma Pinto", ownerTitle: "Mana", contacts: [{ name: "Selma Pinto", title: "MGR" }], founded: "2019-11-30" }))
      .toEqual({ id: "a1", ownerName: "Selma Pinto", ownerTitle: "Manager", registryName: null, registryId: null, contacts: [{ name: "Selma Pinto", title: "Manager" }], founded: "2019-11-30" });
    const plain = sanitizeRegistry({ id: "a1", founded: "2999-01-01", contacts: [] })!;
    expect("contacts" in plain || "founded" in plain).toBe(false);
  });
});

describe("saving registry results (real SQLite)", () => {
  it("writes the people and the founding date; the website owner stays", async () => {
    const { db, env, addLead } = setup();
    addLead("a");
    addLead("b", "FL", { owner_name: "Web Owner", owner_source: "website" });
    db.prepare(`INSERT INTO lead_contacts (lead_id, position, name, title, source) VALUES ('a', 3, 'Old Person', NULL, 'registry'), ('a', 10, 'Site Person', NULL, 'website')`).run();
    const res = await saveRegistryResults(env, [
      { id: "a", ownerName: "Bob Ray", ownerTitle: "P", registryName: "BIZ A LLC", registryId: "FL:L1", founded: "2015-03-04",
        contacts: [{ name: "Bob Ray", title: "P" }, { name: "Ann Lee", title: "S" }] },
      { id: "b", ownerName: "Reg Owner", ownerTitle: "MGR", founded: "2001-01-01", contacts: [{ name: "Reg Owner", title: "MGR" }] },
      { id: "gone", ownerName: "No One", contacts: [{ name: "No One", title: "P" }] }, // deleted since it was handed out
    ]);
    expect(res).toEqual({ saved: 3, owners: 3, contacts: 4, founded: 2 });
    const a = db.prepare(`SELECT owner_name, owner_title, owner_source, founded, registry_checked_at IS NOT NULL AS c, registry_details_at IS NOT NULL AS d FROM leads WHERE id = 'a'`).get();
    expect(a).toEqual({ owner_name: "Bob Ray", owner_title: "President", owner_source: "registry", founded: "2015-03-04", c: 1, d: 1 });
    const b = db.prepare(`SELECT owner_name, owner_source, founded FROM leads WHERE id = 'b'`).get();
    expect(b).toEqual({ owner_name: "Web Owner", owner_source: "website", founded: "2001-01-01" });
    expect(db.prepare(`SELECT position, name, title, source FROM lead_contacts WHERE lead_id = 'a' ORDER BY position`).all()).toEqual([
      { position: 0, name: "Bob Ray", title: "President", source: "registry" },
      { position: 1, name: "Ann Lee", title: "Secretary", source: "registry" },
      { position: 10, name: "Site Person", title: null, source: "website" },
    ]);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM lead_contacts WHERE lead_id = 'gone'`).get()).toEqual({ n: 0 });

    // A later look-up replaces the registry people but never overwrites a known founding date.
    await saveRegistryResults(env, [{ id: "a", founded: "1999-01-01", contacts: [{ name: "Cy Do", title: "D" }] }]);
    expect(db.prepare(`SELECT founded, owner_name FROM leads WHERE id = 'a'`).get()).toEqual({ founded: "2015-03-04", owner_name: "Bob Ray" });
    expect(db.prepare(`SELECT name FROM lead_contacts WHERE lead_id = 'a' AND source = 'registry'`).all()).toEqual([{ name: "Cy Do" }]);

    // Not found: marked as looked up, its old registry people dropped.
    await saveRegistryResults(env, [{ id: "a" }]);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM lead_contacts WHERE lead_id = 'a' AND source = 'registry'`).get()).toEqual({ n: 0 });

    const status = await registryStatus(env);
    expect(status.withFounded).toBe(2);
    expect(status.withContacts).toBe(1); // b
  });

  it("keeps each business's statements in one batch of at most 90", async () => {
    const { env, batches, addLead } = setup();
    const many = Array.from({ length: 100 }, (_, i) => `l${i}`);
    many.forEach((id) => addLead(id));
    await saveRegistryResults(env, many.map((id) => ({ id, contacts: [{ name: "Bob Ray", title: "P" }] })));
    expect(Math.max(...batches)).toBeLessThanOrEqual(90);
    for (const n of batches) expect(n % 3).toBe(0);
    expect(batches.reduce((a, b) => a + b, 0)).toBe(300);
  });
});

describe("backfill: businesses looked up before the details were kept", () => {
  const old = (s: ReturnType<typeof setup>, id: string, state = "NY") => s.addLead(id, state, { registry_checked_at: "2026-09-01 00:00:00" });

  it("hands out new businesses first, then old ones within the daily allowance", async () => {
    const s = setup();
    s.addLead("n1", "NY");
    old(s, "o1");
    old(s, "o2");
    old(s, "o3");
    s.addLead("done", "NY", { registry_checked_at: "2026-09-01 00:00:00", registry_details_at: "2026-09-02 00:00:00" });
    expect(await registryWaiting(s.env)).toEqual(["NY"]);

    const p1 = await claimRegistry(s.env, "NY", 0, 2);
    expect(p1.items.map((x) => x.id)).toEqual(["n1", "o1"]);
    expect(p1.done).toBe(false);
    expect(p1.after).toBeLessThan(0);
    const p2 = await claimRegistry(s.env, "NY", p1.after, 2);
    expect(p2.items.map((x) => x.id)).toEqual(["o2", "o3"]);
    const p3 = await claimRegistry(s.env, "NY", p2.after, 2);
    expect(p3.items).toEqual([]);
    expect(p3.done).toBe(true);
    const day = s.db.prepare(`SELECT value FROM app_settings WHERE key = 'registry_backfill_day'`).get() as { value: string };
    expect(day.value).toBe(`${new Date().toISOString().slice(0, 10)} 3`);

    // Saved: nothing left, so the state is remembered as finished and never scanned again.
    await saveRegistryResults(s.env, ["n1", "o1", "o2", "o3"].map((id) => ({ id })));
    expect(await registryWaiting(s.env)).toEqual([]);
    const done = s.db.prepare(`SELECT value FROM app_settings WHERE key = 'registry_backfill_done'`).get() as { value: string };
    expect(done.value.split(",")).toContain("NY");
    old(s, "late"); // (can't really happen; shows the finished state isn't looked at again)
    expect(await registryWaiting(s.env)).toEqual([]);
    expect((await claimRegistry(s.env, "NY", 0, 10)).items).toEqual([]);
  });

  it("stops at the daily cap; new businesses are never capped", async () => {
    const s = setup();
    const today = new Date().toISOString().slice(0, 10);
    s.db.prepare(`INSERT INTO app_settings (key, value) VALUES ('registry_backfill_day', ?)`).run(`${today} ${BACKFILL_PER_DAY - 1}`);
    old(s, "o1");
    old(s, "o2");
    s.addLead("n1", "NY");
    s.addLead("n2", "NY");
    const c = await claimRegistry(s.env, "NY", 0, 10);
    expect(c.items.map((x) => x.id)).toEqual(["n1", "n2", "o1"]);
    expect(c.done).toBe(true);
    expect(await registryWaiting(s.env)).toEqual(["NY"]); // n1, n2 still not saved
    await saveRegistryResults(s.env, ["n1", "n2", "o1"].map((id) => ({ id })));
    expect(await registryWaiting(s.env)).toEqual([]); // o2 waits for tomorrow
    s.addLead("n3", "NY");
    expect((await claimRegistry(s.env, "NY", 0, 10)).items.map((x) => x.id)).toEqual(["n3"]);
    await saveRegistryResults(s.env, [{ id: "n3" }]);
    expect(await registryWaiting(s.env)).toEqual([]);

    // Yesterday's count doesn't carry over.
    s.db.prepare(`UPDATE app_settings SET value = ? WHERE key = 'registry_backfill_day'`).run(`2000-01-01 ${BACKFILL_PER_DAY}`);
    expect(await registryWaiting(s.env)).toEqual(["NY"]);
  });
});
