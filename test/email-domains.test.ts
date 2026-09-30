import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { domainOf, emailDomainStep, mailFromDns } from "../src/email-domains";

const fs = (await import("node:" + "fs")) as { readdirSync(p: string): string[]; readFileSync(p: string, enc: "utf8"): string };

/** The real schema in Node's SQLite, behind the small part of D1's API the step uses. */
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

const ans = (Status: number, recs: [number, string][] = []) => ({ Status, Answer: recs.map(([type, data]) => ({ type, data })) });

describe("mail from DNS", () => {
  it("reads the answers", () => {
    expect(mailFromDns(ans(0, [[15, "10 mx.acme.com."]]), null)).toBe("mail");
    expect(mailFromDns(ans(3), null)).toBe("none"); // no such domain
    expect(mailFromDns(ans(0, [[15, "0 ."]]), null)).toBe("none"); // "this domain takes no mail"
    expect(mailFromDns(ans(0), ans(0, [[1, "1.2.3.4"]]))).toBe("mail"); // no MX, falls back to the address
    expect(mailFromDns(ans(0), ans(0))).toBe("none");
    expect(mailFromDns(ans(2), null)).toBe("unknown"); // DNS trouble: no verdict
    expect(mailFromDns(null, null)).toBe("unknown");
    expect(domainOf("Joe@Acme.COM ")).toBe("acme.com");
  });
});

describe("email domain step", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("marks addresses on dead domains, once per domain, and never overrides a paid answer", async () => {
    const { db, env } = d1();
    for (const id of "abcdef") db.exec(`INSERT INTO leads (id, google_place_id, business_name) VALUES ('${id}', 'p-${id}', 'B ${id}')`);
    db.exec(`INSERT INTO lead_emails (lead_id, email, position) VALUES
      ('a', 'joe@gmail.com', 0), ('b', 'info@dead.test', 0), ('c', 'sam@dead.test', 0), ('d', 'hi@live.test', 0), ('e', 'x@paid-dead.test', 0)`);
    db.exec(`INSERT INTO email_checks (email, result, checked_at) VALUES ('x@paid-dead.test', 'ok', datetime('now'))`);
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      const name = new URL(url).searchParams.get("name")!;
      asked.push(name);
      const body = name === "live.test" ? ans(0, [[15, "5 mx.live.test."]]) : ans(3);
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const r = await emailDomainStep(env);
    expect(asked.sort()).toEqual(["dead.test", "live.test", "paid-dead.test"]); // gmail never asked; dead.test once
    expect(r.marked).toBe(3);
    const checks = Object.fromEntries((db.prepare("SELECT email, result FROM email_checks").all() as { email: string; result: string }[]).map((x) => [x.email, x.result]));
    expect(checks).toEqual({ "info@dead.test": "invalid", "sam@dead.test": "invalid", "x@paid-dead.test": "ok" });
    // Next run: nothing new.
    const again = await emailDomainStep(env);
    expect(again.looked).toBe(0);
    // A later address on a known dead domain is marked without asking DNS again.
    db.exec(`INSERT INTO lead_emails (lead_id, email, position) VALUES ('f', 'new@dead.test', 0)`);
    asked.length = 0;
    await emailDomainStep(env);
    expect(asked).toEqual([]);
    expect(db.prepare("SELECT result FROM email_checks WHERE email = 'new@dead.test'").get()).toEqual({ result: "invalid" });
  });
});
