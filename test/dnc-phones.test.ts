import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { addSuppressions, applyToLeads, removeSuppression } from "../src/suppress";

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

describe("do-not-contact and phones found on websites", () => {
  it("hides a business whose website phone is on the list, and shows it again when removed", async () => {
    const { db, env } = d1();
    db.exec(`INSERT INTO leads (id, google_place_id, business_name, gbp_phone_formatted) VALUES ('a', 'pa', 'A', '+13055550100'), ('b', 'pb', 'B', '+13055550200')`);
    db.exec(`INSERT INTO lead_phones (lead_id, phone, position) VALUES ('b', '+13055550999', 0)`);
    await addSuppressions(env, "(305) 555-0999", "client", null, null);
    const state = () => Object.fromEntries((db.prepare("SELECT id, suppressed FROM leads ORDER BY id").all() as { id: string; suppressed: string | null }[]).map((r) => [r.id, r.suppressed]));
    expect(state()).toEqual({ a: null, b: "client" });
    // A business that gets that number later (website check) is hidden by the re-check.
    db.exec(`INSERT INTO lead_phones (lead_id, phone, position) VALUES ('a', '+13055550999', 0)`);
    await applyToLeads(env, ["a"]);
    expect(state()).toEqual({ a: "client", b: "client" });
    const entry = db.prepare("SELECT id FROM suppressions").get() as { id: number };
    await removeSuppression(env, entry.id);
    expect(state()).toEqual({ a: null, b: null });
  });
});
