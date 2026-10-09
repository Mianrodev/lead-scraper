import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { loadCandidates, previewGoogleDetails, IDS_PER_STATEMENT } from "../src/google-details";
import { clearCountCaches, listLeads, listSearches } from "../src/leads";
import { audit, auditSummary, dayRange, dismissAllNotifications, listAudit, localDayStartUtc, retryRead } from "../src/ops";
import { overview } from "../src/overview";
import { updateLeads, restoreLeadStates } from "../src/crm";
import { dbKey, inDatabase } from "../src/estimate";
import { findLeads } from "../src/find";
import { dncNote, listSuppressions, removeSuppression, suppressLead } from "../src/suppress";
import { emailHint } from "../src/auth";
import { cleanEmail, cleanEmails } from "../src/normalize";
import { firstNameFrom, ownerFirstName } from "../src/emails";
import { buildOpener, categoryWords, DEFAULT_TEMPLATES, pluralCategory } from "../src/openers";
import { renderDemo } from "../src/demo";
import { CSV_COLUMNS, leadSource, leadToCsvRow, rowFor, COLD_EMAIL_COLUMNS } from "../src/export";

// The project is typed for Workers, not Node, so the file reading is typed by hand here.
const fs = (await import("node:" + "fs")) as { readdirSync(p: string): string[]; readFileSync(p: string, enc: "utf8"): string };
const migrations = () => fs.readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort();

/** The real schema in Node's SQLite behind the part of D1's API the code uses; every statement is recorded. */
function d1(opts: { upTo?: string; failOn?: RegExp } = {}) {
  const db = new DatabaseSync(":memory:");
  for (const f of migrations()) {
    if (opts.upTo && f >= opts.upTo) break;
    db.exec(fs.readFileSync(`migrations/${f}`, "utf8"));
  }
  const seen: string[] = [];
  const check = (sql: string) => {
    seen.push(sql);
    if (opts.failOn?.test(sql)) throw new Error("D1_ERROR: simulated failure");
  };
  const stmt = (sql: string, binds: unknown[] = []) => ({
    sql,
    bind: (...b: unknown[]) => stmt(sql, b),
    all: async () => { check(sql); return { results: db.prepare(sql).all(...(binds as never[])) }; },
    first: async (col?: string) => { check(sql); const r = db.prepare(sql).get(...(binds as never[])) as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
    run: async () => { check(sql); const r = db.prepare(sql).run(...(binds as never[])) as { changes: number }; return { meta: { changes: Number(r.changes) } }; },
    rows: () => {
      check(sql);
      if (/^\s*(SELECT|WITH)\b|\bRETURNING\b/i.test(sql)) { const results = db.prepare(sql).all(...(binds as never[])); return { results, meta: { changes: results.length } }; }
      const r = db.prepare(sql).run(...(binds as never[])) as { changes: number };
      return { results: [], meta: { changes: Number(r.changes) } };
    },
  });
  const DB = { prepare: (sql: string) => stmt(sql), batch: async (list: ReturnType<typeof stmt>[]) => list.map((s) => s.rows()) };
  const env = { DB, LEAD_TIMEZONE: "America/New_York", MAX_RESULTS_DEFAULT: "500" } as unknown as Env;
  return { db, env, seen };
}

const addLead = (db: DatabaseSync, id: string, cols: Record<string, unknown> = {}) => {
  const all = { id, google_place_id: `p-${id}`, business_name: `Biz ${id}`, ...cols };
  db.prepare(`INSERT INTO leads (${Object.keys(all).join(", ")}) VALUES (${Object.keys(all).map(() => "?").join(", ")})`).run(...(Object.values(all) as never[]));
};

describe("Get Google details for a big list", () => {
  it("looks up more than 1,000 businesses without one huge statement", async () => {
    const { db, env, seen } = d1();
    const ins = db.prepare(`INSERT INTO leads (id, google_place_id, business_name, city, state, data_source) VALUES (?, ?, ?, 'Tampa', 'FL', ?)`);
    const ids = Array.from({ length: 1500 }, (_, i) => `lead-${i}`);
    ids.forEach((id, i) => ins.run(id, `ovt:${i}`, `Biz ${i}`, i % 10 === 0 ? "google" : "free"));
    const rows = await loadCandidates(env, [...ids, "missing", ids[0]]);
    expect(rows).toHaveLength(1500);
    expect(rows[0].id).toBe("lead-0"); // in the order asked
    const lookups = seen.filter((s) => s.includes("FROM leads WHERE id IN"));
    expect(lookups.length).toBe(Math.ceil(1500 / IDS_PER_STATEMENT));
    for (const s of lookups) expect((s.match(/'lead-/g) ?? []).length).toBeLessThanOrEqual(90);
    const p = await previewGoogleDetails(env, ids);
    expect(p.total).toBe(1500);
    expect(p.alreadyGoogle).toBe(150);
    expect(p.eligible).toBe(500); // MAX_DETAILS
    expect(p.capped).toBe(true);
  });
});

describe("dates in the viewer's time zone", () => {
  it("turns local days into UTC bounds (and keeps UTC days without tzo)", () => {
    expect(localDayStartUtc("2026-10-09", 240)).toBe("2026-10-09 04:00:00"); // New York summer
    expect(localDayStartUtc("2026-10-09", -120, 1)).toBe("2026-10-09 22:00:00"); // UTC+2, end of the day
    expect(dayRange("2026-10-01", "2026-10-09", "240")).toEqual({ from: "2026-10-01 04:00:00", to: "2026-10-10 04:00:00" });
    expect(dayRange("2026-10-01", "2026-10-09", null)).toEqual({ from: "2026-10-01 00:00:00", to: "2026-10-10 00:00:00" });
    expect(dayRange("2026-10-01", null, "nonsense")).toEqual({ from: "2026-10-01 00:00:00", to: null });
    expect(dayRange("bad", "2026-13-99x", "240")).toEqual({ from: null, to: null });
  });

  it("filters search history and the activity log by local days", async () => {
    const { db, env } = d1();
    // 9 pm New York on Oct 8 is 01:00 UTC on Oct 9: it belongs to Oct 8 for the viewer.
    db.exec(`INSERT INTO searches (id, category, city, max_results, status, created_at) VALUES
      ('evening', 'Plumber', 'Tampa', 10, 'done', '2026-10-09 01:00:00'), ('morning', 'Plumber', 'Tampa', 10, 'done', '2026-10-09 13:00:00')`);
    const ids = async (q: string) => ((await listSearches(env, new URLSearchParams(q))) as unknown as { id: string }[]).map((r) => r.id).sort();
    expect(await ids("from=2026-10-08&to=2026-10-08&tzo=240")).toEqual(["evening"]);
    expect(await ids("from=2026-10-09&to=2026-10-09&tzo=240")).toEqual(["morning"]);
    expect(await ids("from=2026-10-09&to=2026-10-09")).toEqual(["evening", "morning"]); // UTC days without tzo
    db.exec(`INSERT INTO audit_log (at, user_id, user_name, action, details) VALUES ('2026-10-09 01:00:00', 'u', 'Sam', 'signed_in', '{}')`);
    expect((await listAudit(env, new URLSearchParams("from=2026-10-08&to=2026-10-08&tzo=240"))).total).toBe(1);
    expect((await listAudit(env, new URLSearchParams("from=2026-10-09&to=2026-10-09&tzo=240"))).total).toBe(0);
  });
});

describe("search status polling", () => {
  it("answers the followed ids in one query and flags paused free saving", async () => {
    const { db, env, seen } = d1();
    db.exec(`INSERT INTO searches (id, category, city, max_results, status, source, error) VALUES
      ('a', 'Plumber', 'Tampa', 10, 'ingesting', 'free', 'Paused until tomorrow: the free plan saves up to 5,000 free businesses a day.'),
      ('b', 'Plumber', 'Orlando', 10, 'ingesting', 'free', NULL), ('c', 'Plumber', 'Miami', 10, 'done', 'google', NULL)`);
    seen.length = 0;
    const rows = (await listSearches(env, new URLSearchParams("id=a,b&id=x'); DROP TABLE searches;--"))) as unknown as { id: string; paused: boolean }[];
    expect(seen).toHaveLength(1);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.paused]))).toEqual({ a: true, b: false });
  });
});

describe("activity log", () => {
  it("records the owner's actions too, with a plain sentence per row", async () => {
    const { env } = d1();
    await audit(env, { id: "owner", name: "Pat", role: "super_admin" }, "budget_changed", { amount: 50, previous: 25 });
    await audit(env, { id: "m", name: "Sam", role: "member" }, "csv_downloaded", { filters: { status: "operational", verified: "verified", category: "Plumber", city: "Tampa|FL" } });
    const r = await listAudit(env, new URLSearchParams());
    expect(r.total).toBe(2);
    const sentences = (r.results as { summary: string }[]).map((x) => x.summary);
    expect(sentences).toContain("Set the monthly budget to $50.00 (was $25.00)");
    expect(sentences).toContain("Downloaded a list (type: Plumber; city: Tampa, FL)");
  });

  it("never shows raw keys", () => {
    expect(auditSummary("leads_updated", { count: 3, status: "Won", assigned: "u1", assignedName: "Sam" })).toBe("Changed 3 businesses: stage set to Won, assigned to Sam");
    expect(auditSummary("leads_updated", { count: 1, status: null, assigned: null, assignedName: null })).toBe("Changed 1 business: unassigned");
    expect(auditSummary("leads_updated", { count: 2, undo: true })).toBe("Undid a change to 2 businesses");
    expect(auditSummary("pull_started", { types: ["Plumber", "Roofer"], places: ["Tampa, FL"], searches: 2, maxResults: 100, estimatedCostUsd: 1 }))
      .toBe("Started 2 searches for Plumber and Roofer in Tampa, FL, up to 100 each (about $1.00)");
    expect(auditSummary("csv_downloaded", { filters: { status: "operational, permanently_closed" } })).toBe("Downloaded a list (open / closed: open, permanently closed)");
    expect(auditSummary("dnc_added", { entries: 2, reason: "client", business: "Chase Roofing" })).toBe("Added 2 entries to do-not-contact for Chase Roofing (client)");
    expect(auditSummary("team_member_changed", { name: "Sam", active: false })).toBe("Changed Sam’s account: switched off");
    expect(auditSummary("dnc_removed", { kind: "phone", value: "+18137829400" })).toBe("Took (813) 782-9400 off do-not-contact");
    expect(auditSummary("something_new", {})).toBe("Something new");
  });
});

describe("notifications", () => {
  it("dismisses everything at once", async () => {
    const { db, env } = d1();
    db.exec(`INSERT INTO notifications (kind, message) VALUES ('budget', 'x'), ('hot_lead', 'y')`);
    expect(await dismissAllNotifications(env, "u")).toBe(2);
    expect(await dismissAllNotifications(env, "u")).toBe(0);
  });
});

describe("retrying a read", () => {
  it("tries once more after a passing database error, and not after other errors", async () => {
    let n = 0;
    const flaky = async () => { if (n++ === 0) throw new Error("D1_ERROR: internal error; reference = abc"); return "ok"; };
    expect(await retryRead("test", flaky, 1)).toBe("ok");
    expect(n).toBe(2);
    let m = 0;
    await expect(retryRead("test", async () => { m++; throw new Error("no such column: x"); }, 1)).rejects.toThrow("no such column");
    expect(m).toBe(1);
    await expect(retryRead("test", async () => { throw new Error("D1_ERROR: database is locked"); }, 1)).rejects.toThrow("locked");
  });
});

describe("stage changes", () => {
  it("saves the change even when the history can't be written, and clears cached counts", async () => {
    const { db, env } = d1({ failOn: /INSERT INTO lead_events/ });
    addLead(db, "a");
    db.exec(`INSERT INTO api_cache (key, value, expires_at) VALUES ('count?x=1', '{}', 9999999999), ('facets?', '{}', 9999999999), ('overview', '{}', 9999999999), ('estimate-densities-v1', '{}', 9999999999)`);
    const r = await updateLeads(env, ["a"], { status: "Won" }, "me");
    expect(r.updated).toBe(1);
    expect((db.prepare(`SELECT lead_status FROM leads WHERE id = 'a'`).get() as { lead_status: string }).lead_status).toBe("Won");
    expect((db.prepare(`SELECT key FROM api_cache`).all() as { key: string }[]).map((x) => x.key)).toEqual(["estimate-densities-v1"]);
    db.exec(`INSERT INTO api_cache (key, value, expires_at) VALUES ('count?y=1', '{}', 9999999999)`);
    expect((await restoreLeadStates(env, [{ id: "a", status: "Untouched", assigned: null }], "me")).restored).toBe(1);
    expect(db.prepare(`SELECT key FROM api_cache WHERE key LIKE 'count?%'`).all()).toHaveLength(0);
    await clearCountCaches(env); // nothing left: still fine
  });
});

describe("overview numbers", () => {
  it("counts only real businesses per person and leaves do-not-contact out of growth and hot leads", async () => {
    const { db, env } = d1();
    db.exec(`INSERT INTO users (id, email, name, role, password_hash, password_salt, password_iterations) VALUES
      ('u1', 'a@x.test', 'Ann', 'member', 'h', 's', 1), ('u2', 'b@x.test', 'Bob', 'member', 'h', 's', 1)`);
    addLead(db, "a", { assigned_to: "u1", lead_status: "Untouched", created_at: new Date().toISOString().slice(0, 19).replace("T", " ") });
    addLead(db, "b", { assigned_to: "u1", lead_status: "Won" });
    addLead(db, "c", { suppressed: "client", report_viewed_at: new Date().toISOString().slice(0, 19).replace("T", " ") });
    addLead(db, "d", { report_viewed_at: new Date().toISOString().slice(0, 19).replace("T", " ") });
    const o = await overview(env);
    const reps = Object.fromEntries((o.reps as { name: string; total: number; untouched: number; won: number }[]).map((r) => [r.name, r]));
    expect(reps.Bob).toMatchObject({ total: 0, untouched: 0, won: 0 });
    expect(reps.Ann).toMatchObject({ total: 2, untouched: 1, won: 1 });
    expect((o.hot as { id: string }[]).map((h) => h.id)).toEqual(["d"]);
    expect(o.growth.reduce((s, g) => s + g.n, 0)).toBe(4 - 1); // c (do not contact) left out
  });
});

describe("Find answer vs the Database list", () => {
  it("counts exactly what the list shows with its usual filters", async () => {
    const { db, env } = d1();
    const rows: [string, Record<string, unknown>][] = [
      ["a", { business_status: "operational" }], ["b", { business_status: "operational", is_claimed: 1 }],
      ["c", { business_status: "temporarily_closed" }], ["d", { business_status: "permanently_closed" }], ["e", { business_status: "operational", is_claimed: 0 }],
      ["f", { business_status: "operational", suppressed: "client" }], ["g", { business_status: "operational", city: "TAMPA" }],
    ];
    for (const [id, cols] of rows) addLead(db, id, { gbp_category: "Plumber", city: "Tampa", state: "FL", ...cols });
    const place = { countryCode: "US", countryName: "United States", state: "FL", regionName: "Florida", city: "Tampa", label: "Tampa, FL" };
    const quick = (await inDatabase(env, ["Plumber"], [place])).get(dbKey("Plumber", place));
    const list = await listLeads(env, new URLSearchParams("status=operational&verified=verified&category=Plumber&city=Tampa|FL"));
    expect(list.total).toBe(3); // a, b, g
    expect(quick).toBe(list.total);
  });

  it("gives every plan row its own in-database count, for free searches too", async () => {
    const { db, env } = d1();
    db.exec(`INSERT OR IGNORE INTO geo_countries (code, name) VALUES ('US', 'United States')`);
    db.exec(`INSERT OR IGNORE INTO geo_regions (country, code, name) VALUES ('US', 'FL', 'Florida')`);
    for (const id of ["a", "b"]) addLead(db, id, { gbp_category: "Plumber", city: "Tampa", state: "FL", business_status: "operational" });
    addLead(db, "c", { gbp_category: "Plumber", city: "Orlando", state: "FL", business_status: "operational" });
    const plan = await findLeads(env, { categories: ["Plumber"], locations: [{ country: "US", region: "FL", city: "Tampa" }, { country: "US", region: "FL", city: "Orlando" }], source: "free" });
    expect(plan.combinations.map((c) => [c.place.city, c.inDb])).toEqual([["Tampa", 2], ["Orlando", 1]]);
    expect(plan.inDatabase).toBe(3);
  });
});

describe("do not contact from a business", () => {
  it("returns the entries it made (for Undo), names the business in the note, shows phones readably", async () => {
    const { db, env } = d1();
    addLead(db, "a", { business_name: "Chase Roofing", gbp_phone_formatted: "+18137829400", website_domain: "chaseroofing.com" });
    db.exec(`INSERT INTO lead_emails (lead_id, email, position) VALUES ('a', 'info@chaseroofing.com', 0)`);
    const r = await suppressLead(env, "a", "client", "u1");
    expect(r.entryIds).toHaveLength(3);
    expect(r.added).toBe(3);
    const list = await listSuppressions(env, "", 1);
    expect((list.results as { note: string }[]).every((x) => x.note === "Chase Roofing (added from its business window)")).toBe(true);
    expect((list.results as { kind: string; display: string }[]).find((x) => x.kind === "phone")!.display).toBe("(813) 782-9400");
    expect((db.prepare(`SELECT suppressed FROM leads WHERE id = 'a'`).get() as { suppressed: string }).suppressed).toBe("client");
    for (const id of r.entryIds) await removeSuppression(env, id); // Undo
    expect((db.prepare(`SELECT suppressed FROM leads WHERE id = 'a'`).get() as { suppressed: string | null }).suppressed).toBeNull();
    // Already listed: nothing new to undo.
    await suppressLead(env, "a", "client", "u1");
    expect((await suppressLead(env, "a", "client", "u1")).entryIds).toEqual([]);
    expect(dncNote("x".repeat(300)).length).toBeLessThanOrEqual(200);
    expect(dncNote(null)).toBe("Added from a business window");
  });
});

describe("team emails", () => {
  it("shows a partly hidden address", () => {
    expect(emailHint("sam@company.com")).toBe("sa…@company.com");
    expect(emailHint("qa@test.localhost")).toBe("qa…@test.localhost");
    expect(emailHint("qa.team@test.localhost")).toBe("qa…@test.localhost");
    expect(emailHint("s@x.com")).toBe("s…@x.com");
    expect(emailHint("")).toBe("******");
  });
});

describe("junk email addresses", () => {
  it("are tidied when saved", () => {
    expect(cleanEmail("%20%20Info@HawthorneFLMovers.com")).toBe("info@hawthorneflmovers.com");
    expect(cleanEmail("mailto:joe@joes.com?subject=Hi")).toBe("joe@joes.com");
    expect(cleanEmail("<joe@joes.com.com>")).toBe("joe@joes.com");
    expect(cleanEmail("joe%40joes.com")).toBe("joe@joes.com");
    expect(cleanEmail("not an email")).toBeNull();
    expect(cleanEmail("a b@x.com")).toBeNull();
    expect(cleanEmails(["%20a@x.com", "A@X.com", "bad", 5, "b@x.com.com"])).toEqual(["a@x.com", "b@x.com"]);
  });

  it("are cleaned in the saved data by migration 0030 (and running it twice changes nothing)", () => {
    const { db } = d1({ upTo: "0030" });
    addLead(db, "a");
    addLead(db, "b");
    db.exec(`INSERT INTO lead_emails (lead_id, email, position) VALUES
      ('a', '%20info@acme.com', 0), ('a', 'INFO@acme.com', 1), ('a', 'sales@acme.com.com', 2), ('a', 'mailto:joe@acme.com', 3), ('a', 'nothing here', 4),
      ('b', 'info@acme.com', 0), ('b', ' %20Bob@Bobs.net.net ', 1)`);
    db.exec(`INSERT INTO notifications (kind, message) VALUES ('credit', 'DataForSEO credit is low: $-0.01 left'), ('counts', 'Payment Required'), ('credit', 'Apify usage'), ('budget', 'Over 80%')`);
    const run = () => db.exec(fs.readFileSync("migrations/0030_cleanup.sql", "utf8"));
    run();
    const emails = () => db.prepare(`SELECT lead_id, email, position FROM lead_emails ORDER BY lead_id, position`).all();
    const after = emails();
    expect(after).toEqual([
      { lead_id: "a", email: "info@acme.com", position: 0 },
      { lead_id: "a", email: "sales@acme.com", position: 2 },
      { lead_id: "a", email: "joe@acme.com", position: 3 },
      { lead_id: "b", email: "info@acme.com", position: 0 },
      { lead_id: "b", email: "bob@bobs.net", position: 1 },
    ]);
    const open = () => (db.prepare(`SELECT message FROM notifications WHERE dismissed_at IS NULL ORDER BY id`).all() as { message: string }[]).map((x) => x.message);
    expect(open()).toEqual(["Apify usage", "Over 80%"]);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM notifications`).get()).toEqual({ n: 4 }); // dismissed, not deleted
    run();
    expect(emails()).toEqual(after);
  });
});

describe("cold email wording", () => {
  const agency = { name: "Bright Local", phone: "(407) 555-0100", email: "hi@bright.test", website: "https://bright.test" };
  it("never greets a mailbox", () => {
    for (const box of ["projects", "info", "office", "sales", "estimating", "roofing", "admin", "team", "booking"]) expect(firstNameFrom(`${box}@acme.com`)).toBe("");
    expect(firstNameFrom("maria.lopez@acme.com")).toBe("Maria");
    expect(ownerFirstName("SMITH, JOHN A")).toBe("John");
    expect(ownerFirstName("Dr. Maria Lopez")).toBe("Maria");
    expect(ownerFirstName("ABC Holdings LLC")).toBe("");
    expect(ownerFirstName("Projects Manager")).toBe("");
    const o = buildOpener({ business: "Acme", ownerName: "Office", firstNameFromEmail: "", city: "Tampa", category: "Plumber", suggestions: [], agency });
    expect(o.email).toMatch(/^Hi there,/);
  });

  it("writes business types properly and never doubles a full stop", () => {
    expect(categoryWords("HVAC contractor")).toBe("HVAC contractor");
    expect(categoryWords("hvac_contractor")).toBe("HVAC contractor");
    expect(categoryWords("Italian restaurant")).toBe("Italian restaurant");
    expect(categoryWords("Plumber")).toBe("plumber");
    expect(categoryWords("ROOFING CONTRACTOR")).toBe("roofing contractor");
    expect(pluralCategory("HVAC contractor")).toBe("HVAC contractors");
    expect(pluralCategory("CPA")).toBe("CPAs");
    const o = buildOpener({ business: "Smith & Co.", ownerName: null, city: "Tampa", category: "HVAC contractor", suggestions: [], agency },
      { ...DEFAULT_TEMPLATES, sms: "I noticed {problem} for {business}. We fix that for local {category_plural}." });
    expect(o.sms).toContain("for Smith & Co. We fix that for local HVAC contractors.");
    expect(o.sms).not.toContain("..");
    expect(o.email).toContain("For HVAC contractors in Tampa");
  });

  it("leaves out a made-up sign-off when the agency name isn't set", () => {
    const o = buildOpener({ business: "Acme", ownerName: "Joe Smith", city: "Tampa", category: "Plumber", suggestions: [], agency: { ...agency, name: "" } });
    for (const text of [o.email, o.sms, o.call]) {
      expect(text).not.toMatch(/our team|\{agency\}|\{signature\}/);
    }
    expect(o.email).toMatch(/^Hi Joe,/);
    expect(o.email.trim()).toMatch(/useful\?$/);
    expect(o.sms).toMatch(/^Hi Joe, I noticed/);
    expect(o.call).toContain("This is [your name]. I was looking");
    const demo = renderDemo({ business_name: "Acme", gbp_category: "HVAC contractor", industry: null, city: "Tampa", state: "FL", gbp_phone_formatted: null,
      rating: null, review_count: null, address: null, owner_name: null }, { ...agency, name: "", blurb: "" } as never);
    expect(demo).toContain("<b>Preview</b> made for Acme. This isn't live yet.");
    expect(demo).not.toContain("our team");
    expect(demo).toContain("your local HVAC contractor");
  });

  it("uses the owner's or a person's first name in the cold-email file, not a mailbox word", () => {
    const l = { id: "1", business_name: "Acme", industry: null, cid: null, gbp_category: "Plumber", lead_category: null, sub_category: null, gbp_phone_raw: null,
      gbp_phone_formatted: null, phone_type: null, website: null, owner_name: null, gbp_url: null, gbp_rank: null, rating: null, review_count: null,
      address: null, city: "Tampa", state: "FL", country: "USA", socials: null, logo_url: null, lead_source: null, source_code: null, lead_status: null, lead_date: null,
      lead_datetime: null };
    const first = (owner: string | null, email: string) => rowFor("cold_email", { ...l, owner_name: owner }, [email], [])![COLD_EMAIL_COLUMNS.indexOf("First Name")];
    expect(first(null, "projects@acme.com")).toBe("");
    expect(first("ACME HOLDINGS LLC", "projects@acme.com")).toBe("");
    expect(first("Jane Doe", "projects@acme.com")).toBe("Jane");
  });
});

describe("regression QA fixes", () => {
  it("says how many closed or not-verified businesses the usual view hides", async () => {
    const { db, env } = d1();
    addLead(db, "a", { business_status: "operational" });
    addLead(db, "b", { business_status: "permanently_closed" });
    addLead(db, "c", { business_status: "operational", is_claimed: 0 });
    addLead(db, "d", { business_status: "operational", suppressed: "client" });
    const usual = await listLeads(env, new URLSearchParams("status=operational&verified=verified"));
    expect(usual.total).toBe(1);
    expect(usual.hiddenByUsual).toBe(2); // b and c; do-not-contact stays out of it
    expect((await listLeads(env, new URLSearchParams())).hiddenByUsual).toBeNull();
  });

  it("leaves only “Note deleted” on the timeline when a note goes", async () => {
    const { db, env } = d1();
    db.exec(`INSERT INTO users (id, email, name, role, password_hash, password_salt, password_iterations) VALUES ('u1', 'a@x.test', 'Ann', 'admin', 'h', 's', 1)`);
    addLead(db, "a");
    const { addNote, deleteNote } = await import("../src/crm");
    await addNote(env, "a", "Called, the owner wants a quote", "u1");
    const id = (db.prepare(`SELECT id FROM lead_notes`).get() as { id: number }).id;
    await deleteNote(env, id, { id: "u1", role: "admin" });
    expect(db.prepare(`SELECT kind, detail FROM lead_events`).all()).toEqual([{ kind: "note", detail: "Note deleted" }]);
  });

  it("filters search history to the ones waiting for the daily free limit", async () => {
    const { db, env } = d1();
    db.exec(`INSERT INTO searches (id, category, city, max_results, status, source, error) VALUES
      ('a', 'Plumber', 'Tampa', 10, 'ingesting', 'free', 'Paused: waiting for tomorrow’s free allowance.'), ('b', 'Plumber', 'Orlando', 10, 'ingesting', 'free', NULL)`);
    const ids = async (q: string) => ((await listSearches(env, new URLSearchParams(q))) as unknown as { id: string }[]).map((r) => r.id);
    expect(await ids("status=paused")).toEqual(["a"]);
    expect(await ids("status=ingesting")).toEqual(["b"]);
  });

  it("writes downloads and names in plain words", () => {
    expect(auditSummary("csv_downloaded", { filters: { format: "ghl", id: "x" } })).toBe("Downloaded a list (GoHighLevel file; 1 picked business)");
    expect(auditSummary("saved_search_added", { name: "Tampa plumbers" })).toBe("Saved the search “Tampa plumbers”");
  });
});

describe("GHL download lead source", () => {
  it("says where each business came from", () => {
    expect(leadSource({ data_source: "free", lead_source: "Google" })).toBe("Open map data");
    expect(leadSource({ data_source: "google", lead_source: "Google" })).toBe("Google Maps");
    expect(leadSource({ data_source: "free+google", lead_source: "Google" })).toBe("Google Maps");
    expect(leadSource({ data_source: "upload", lead_source: "Google" })).toBe("Uploaded list");
    expect(leadSource({ data_source: "form", lead_source: null })).toBe("Website form");
    const row = leadToCsvRow({ id: "1", business_name: "A", industry: null, cid: null, gbp_category: null, lead_category: null, sub_category: null, gbp_phone_raw: null,
      gbp_phone_formatted: "+14075550100", phone_type: null, website: null, owner_name: null, gbp_url: null, gbp_rank: null, rating: null, review_count: null,
      address: null, city: null, state: null, country: "USA", socials: null, logo_url: null, lead_source: "Google", data_source: "free", source_code: null,
      lead_status: null, lead_date: null, lead_datetime: null }, [], []);
    expect(row[CSV_COLUMNS.indexOf("Lead Source")]).toBe("Open map data");
    expect(row[CSV_COLUMNS.indexOf("GBP Phone")]).toBe("1407-555-0100"); // the sheet's phone style is unchanged
  });
});
