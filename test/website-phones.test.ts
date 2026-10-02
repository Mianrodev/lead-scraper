import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { sanitizeFindings, sanitizePhones, saveWebsiteResults } from "../src/website-audit";

const fs = (await import("node:" + "fs")) as { readdirSync(p: string): string[]; readFileSync(p: string, enc: "utf8"): string };

/** The real schema in Node's SQLite, behind the small part of D1's API the code uses. */
function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of fs.readdirSync("migrations").filter((x) => x.endsWith(".sql")).sort()) db.exec(fs.readFileSync(`migrations/${f}`, "utf8"));
  let writes = 0;
  const stmt = (sql: string, binds: unknown[] = []) => ({
    bind: (...b: unknown[]) => stmt(sql, b),
    all: async () => ({ results: db.prepare(sql).all(...(binds as never[])) }),
    first: async (col?: string) => { const r = db.prepare(sql).get(...(binds as never[])) as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
    run: async () => {
      const r = db.prepare(sql).run(...(binds as never[])) as { changes: number };
      if (/lead_phones/.test(sql)) writes += r.changes;
      return { meta: { changes: r.changes } };
    },
  });
  const DB = { prepare: (sql: string) => stmt(sql), batch: async (list: ReturnType<typeof stmt>[]) => { const out = []; for (const s of list) out.push(await s.run()); return out; } };
  return { db, env: { DB } as unknown as Env, phoneWrites: () => writes };
}

const phones = (db: DatabaseSync, id: string) =>
  (db.prepare("SELECT phone, position FROM lead_phones WHERE lead_id = ? ORDER BY position").all(id) as { phone: string; position: number }[]).map((r) => `${r.position}:${r.phone}`);

describe("website phones: sanitize", () => {
  it("keeps US E.164 only, deduped, at most 5", () => {
    expect(sanitizePhones(["+13055551234", " +13055551234 ", "3055551234", "+11055551234", "+447700900123", 5, null, "+1305555123"])).toEqual(["+13055551234"]);
    expect(sanitizePhones(["+12025550001", "+12025550002", "+12025550003", "+12025550004", "+12025550005", "+12025550006"])).toHaveLength(5);
    expect(sanitizePhones("+13055551234")).toEqual([]);
    expect(sanitizeFindings({ id: "a", phones: ["+13055551234", "junk"] })?.phones).toEqual(["+13055551234"]);
    expect(sanitizeFindings({ id: "a" })?.phones).toEqual([]);
  });
});

describe("website phones: save", () => {
  it("adds new numbers after existing ones, skips the main and known numbers, caps at 5, never rewrites", async () => {
    const { db, env, phoneWrites } = d1();
    db.exec(`INSERT INTO leads (id, google_place_id, business_name, gbp_phone_formatted, website_audit_status) VALUES
      ('a', 'p-a', 'A', '+13055550000', 'checking'), ('b', 'p-b', 'B', NULL, 'checking'), ('c', 'p-c', 'C', NULL, 'checking')`);
    db.exec(`INSERT INTO lead_phones (lead_id, phone, phone_type, position) VALUES ('a', '+13055551111', 'mobile', 0), ('a', '+13055552222', NULL, 11),
      ('c', '+12025550001', NULL, 0), ('c', '+12025550002', NULL, 1), ('c', '+12025550003', NULL, 2), ('c', '+12025550004', NULL, 3)`);
    const base = { reachable: true, finalUrl: "https://x.test/" };
    await saveWebsiteResults(env, [
      { ...base, id: "a", phones: ["+13055550000", "+13055551111", "+13055553333", "+13055553333", "+13055554444"] },
      { ...base, id: "b", phones: ["+17865550001", "+17865550002"] },
      { ...base, id: "c", phones: ["+12025550009", "+12025550010"] },
    ]);
    // a: main number and stored number skipped; new ones continue after the highest position.
    expect(phones(db, "a")).toEqual(["0:+13055551111", "11:+13055552222", "12:+13055553333", "13:+13055554444"]);
    expect(db.prepare("SELECT phone_type FROM lead_phones WHERE lead_id = 'a' AND position = 0").get()).toEqual({ phone_type: "mobile" });
    expect(phones(db, "b")).toEqual(["0:+17865550001", "1:+17865550002"]);
    // c already had 4: only one more fits.
    expect(phones(db, "c")).toEqual(["0:+12025550001", "1:+12025550002", "2:+12025550003", "3:+12025550004", "4:+12025550009"]);
    expect(phoneWrites()).toBe(5);

    // The same results again write nothing.
    for (const id of "abc") db.exec(`UPDATE leads SET website_audit_status = 'checking' WHERE id = '${id}'`);
    await saveWebsiteResults(env, [
      { ...base, id: "a", phones: ["+13055553333"] },
      { ...base, id: "b", phones: ["+17865550001", "+17865550002"] },
    ]);
    expect(phoneWrites()).toBe(5);
  });
});
