import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { cleanGhlColumns, DEFAULT_GHL_COLUMNS, ensureReportTokens, ghlValues, loadGhlColumns, reviewGap, saveGhlColumns, GHL_SOURCES, type GhlColumn, type GhlLead } from "../src/ghl-columns";
import { CSV_COLUMNS, exportCsv, ghlHeader } from "../src/export";
import { gradeReport, type LocalFacts } from "../src/grade";
import { renderReport } from "../src/report";

const fs = (await import("node:" + "fs")) as { readdirSync(p: string): string[]; readFileSync(p: string, enc: "utf8"): string };

function d1() {
  const db = new DatabaseSync(":memory:");
  for (const f of fs.readdirSync("migrations").filter((x) => x.endsWith(".sql")).sort()) db.exec(fs.readFileSync(`migrations/${f}`, "utf8"));
  const seen: string[] = [];
  const stmt = (sql: string, binds: unknown[] = []) => ({
    sql,
    bind: (...b: unknown[]) => stmt(sql, b),
    all: async () => { seen.push(sql); return { results: db.prepare(sql).all(...(binds as never[])) }; },
    first: async (col?: string) => { seen.push(sql); const r = db.prepare(sql).get(...(binds as never[])) as Record<string, unknown> | undefined; return r ? (col ? r[col] : r) : null; },
    run: async () => { seen.push(sql); const r = db.prepare(sql).run(...(binds as never[])) as { changes: number }; return { meta: { changes: Number(r.changes) } }; },
    rows: () => {
      seen.push(sql);
      if (/^\s*(SELECT|WITH)\b|\bRETURNING\b/i.test(sql)) return { results: db.prepare(sql).all(...(binds as never[])), meta: {} };
      const r = db.prepare(sql).run(...(binds as never[])) as { changes: number };
      return { results: [], meta: { changes: Number(r.changes) } };
    },
  });
  const DB = { prepare: (sql: string) => stmt(sql), batch: async (list: ReturnType<typeof stmt>[]) => list.map((s) => s.rows()) };
  return { db, env: { DB, LEAD_TIMEZONE: "America/New_York", MAX_RESULTS_DEFAULT: "500" } as unknown as Env, seen };
}
const addLead = (db: DatabaseSync, id: string, cols: Record<string, unknown> = {}) => {
  const all = { id, google_place_id: `p-${id}`, business_name: `Biz ${id}`, ...cols };
  db.prepare(`INSERT INTO leads (${Object.keys(all).join(", ")}) VALUES (${Object.keys(all).map(() => "?").join(", ")})`).run(...(Object.values(all) as never[]));
};

const agency = { name: "Bright Local", phone: "(407) 555-0100", email: "hi@bright.test", website: "https://bright.test", blurb: "" };

describe("GoHighLevel column settings", () => {
  it("checks names and what fills them", () => {
    const ok = cleanGhlColumns({ columns: [{ name: "  Report   Link ", source: "report_link" }, { name: "Grade", source: "overall_grade" }] }, CSV_COLUMNS);
    expect(ok).toEqual([{ name: "Report Link", source: "report_link" }, { name: "Grade", source: "overall_grade" }]);
    expect(cleanGhlColumns([], CSV_COLUMNS)).toEqual([]);
    expect(() => cleanGhlColumns([{ name: " ", source: "report_link" }])).toThrow("Row 1: type the GoHighLevel column name.");
    expect(() => cleanGhlColumns([{ name: "x".repeat(61), source: "report_link" }])).toThrow(/too long/);
    expect(() => cleanGhlColumns([{ name: "x".repeat(60), source: "report_link" }])).not.toThrow();
    expect(() => cleanGhlColumns([{ name: "Grade", source: "overall_grade" }, { name: "grade", source: "overall_score" }])).toThrow("“grade” is in the list twice. Each column needs its own name.");
    expect(() => cleanGhlColumns([{ name: "website", source: "overall_grade" }], CSV_COLUMNS)).toThrow(/already a column in the download/);
    expect(() => cleanGhlColumns([{ name: "Grade", source: "nope" }])).toThrow("Row 1: pick what fills “Grade”.");
    expect(() => cleanGhlColumns(Array.from({ length: 31 }, (_, i) => ({ name: `C${i}`, source: "stage" })))).toThrow("Up to 30 columns.");
    expect(() => cleanGhlColumns(Array.from({ length: 30 }, (_, i) => ({ name: `C${i}`, source: "stage" })))).not.toThrow();
    expect(() => cleanGhlColumns("nope")).toThrow();
  });

  it("starts with the starter set, and keeps what's saved (even an empty list)", async () => {
    const { env } = d1();
    expect(DEFAULT_GHL_COLUMNS.map((c) => c.name)).toEqual(["Report Link", "Overall Grade", "Top Quick Win", "AI Opener", "Services", "Top Competitor", "Review Gap"]);
    expect(DEFAULT_GHL_COLUMNS.every((c) => GHL_SOURCES.some((s) => s.id === c.source))).toBe(true);
    expect(await loadGhlColumns(env)).toEqual({ columns: DEFAULT_GHL_COLUMNS, saved: false });
    await saveGhlColumns(env, { columns: [{ name: "Grade", source: "overall_grade" }] }, CSV_COLUMNS);
    expect(await loadGhlColumns(env)).toEqual({ columns: [{ name: "Grade", source: "overall_grade" }], saved: true });
    await saveGhlColumns(env, { columns: [] }, CSV_COLUMNS);
    expect(await loadGhlColumns(env)).toEqual({ columns: [], saved: true });
  });

  it("adds the custom columns after the standard ones, in their order", () => {
    const h = ghlHeader(DEFAULT_GHL_COLUMNS);
    expect(h.slice(0, CSV_COLUMNS.length)).toEqual([...CSV_COLUMNS]);
    expect(h.slice(CSV_COLUMNS.length)).toEqual(DEFAULT_GHL_COLUMNS.map((c) => c.name));
  });
});

describe("GoHighLevel column values", () => {
  const lead: GhlLead = {
    id: "me", business_name: "Joe's Plumbing", gbp_category: "Plumber", city: "Tampa", state: "FL", website: "https://joes.test", website_domain: "joes.test",
    data_source: "google", is_claimed: 0, phone: "+18135550100", has_hours: 1, has_description: 1, photos_count: 30, rating: 4.6, review_count: 12,
    reachable: 1, https: 1, mobile_viewport: 1, has_contact_form: 1, has_booking: 0, has_meta_pixel: 0, has_google_tag: 1, has_chat_widget: 0,
    copyright_year: 2025, psi_score: null, audit_error: null, social_only: 0, email_provider: null, checked_at: "2026-10-01 10:00:00",
    has_google_ads: 0, has_bing_ads: 0, call_tracking: null, has_tiktok_pixel: 0, builder: "wix",
    socials: "https://facebook.com/joes", ai_status: "done", ai_summary: "Family plumber in Tampa.", ai_services: "Drain cleaning,  Water heaters",
    ai_opener: "Saw your drain cleaning page —\nnice work.", owner_name: "Joe Smith", owner_title: "Owner", score_notes: null, lead_status: "Contacted", assigned_to: "u1",
  };
  const facts: LocalFacts = { average: { avg_rating: 4.4, avg_reviews: 48, businesses: 9 }, top: [{ id: "c1", name: "Acme Plumbing", rating: 4.7, reviews: 640 }, { id: "me", name: "Joe's Plumbing", rating: 4.6, reviews: 12 }] };
  const all: GhlColumn[] = GHL_SOURCES.map((s) => ({ name: s.label, source: s.id }));

  it("fills every source for a sample business, matching the report", () => {
    const v = Object.fromEntries(all.map((c, i) => [c.source, ghlValues(all, lead, { reportUrl: "https://app.test/r/abc", facts, agency, people: new Map([["u1", "Ann Lee"]]) })[i]]));
    const g = gradeReport(lead, facts);
    expect(v.report_link).toBe("https://app.test/r/abc");
    expect(v.overall_grade).toBe(g.overall!.grade);
    expect(v.overall_score).toBe(String(g.overall!.score));
    expect(v.google_grade).toBe(g.sections[0].grade);
    expect(v.top_quick_win).toBe("Claim and verify your Google profile so you control what customers see.");
    expect(v.quick_wins).toBe(g.quickWins.join(" | "));
    expect(v.quick_wins.split(" | ")).toHaveLength(3);
    expect(v.opener).toBe("Saw your drain cleaning page — nice work.");
    expect(v.summary).toBe("Family plumber in Tampa.");
    expect(v.services).toBe("Drain cleaning, Water heaters");
    expect(v.owner_name).toBe("Joe Smith");
    expect(v.owner_title).toBe("Owner");
    expect(v.top_competitor).toBe("Acme Plumbing");
    expect(v.review_gap).toBe("You: 12 reviews · area average: 48");
    expect(v.rating).toBe("4.6");
    expect(v.review_count).toBe("12");
    expect(v.social_pages).toBe("Facebook");
    expect(v.builder).toBe("Wix");
    expect(v.stage).toBe("Contacted");
    expect(v.assigned).toBe("Ann Lee");
    // The same quick win is on the report.
    expect(renderReport(lead, agency, new Date(), facts)).toContain("Claim and verify your Google profile so you control what customers see.");
  });

  it("says “not checked” for the review gap of free data, and leaves grades of unchecked sections empty", () => {
    const free = { ...lead, data_source: "free", rating: null, review_count: null };
    const cols: GhlColumn[] = [{ name: "G", source: "google_grade" }, { name: "R", source: "reviews_grade" }, { name: "Gap", source: "review_gap" }];
    expect(ghlValues(cols, free, { reportUrl: "", facts, agency: null, people: new Map() })).toEqual(["", "", "You: not checked · area average: 48"]);
    expect(reviewGap(gradeReport(free, null))).toBe("");
  });
});

describe("report links in a download", () => {
  it("makes missing links 90 businesses per statement, keeps existing ones, and stops at the limit", async () => {
    const { db, env, seen } = d1();
    for (let i = 0; i < 200; i++) addLead(db, `l${i}`, i < 10 ? { report_token: `${String(i).padStart(2, "0")}${"f".repeat(30)}` } : {});
    const rows = db.prepare("SELECT id, report_token FROM leads ORDER BY rowid").all() as { id: string; report_token: string | null }[];
    const t = await ensureReportTokens(env, rows);
    expect(t.size).toBe(200);
    expect(t.get("l0")).toBe(`00${"f".repeat(30)}`);
    expect([...t.values()].every((v) => /^[0-9a-f]{32}$/.test(v))).toBe(true);
    expect(new Set(t.values()).size).toBe(200);
    const updates = seen.filter((s) => s.startsWith("UPDATE leads SET report_token"));
    expect(updates).toHaveLength(Math.ceil(190 / 90));
    for (const u of updates) expect((u.match(/WHEN 'l/g) ?? []).length).toBeLessThanOrEqual(90);
    // Stored, so the links work.
    expect((db.prepare("SELECT COUNT(*) AS n FROM leads WHERE report_token IS NOT NULL").get() as { n: number }).n).toBe(200);
    // Nothing more to make the second time.
    seen.length = 0;
    await ensureReportTokens(env, db.prepare("SELECT id, report_token FROM leads").all() as { id: string; report_token: string | null }[]);
    expect(seen).toEqual([]);
    // A limit leaves the rest without a link.
    const { db: db2, env: env2 } = d1();
    for (let i = 0; i < 5; i++) addLead(db2, `m${i}`);
    expect((await ensureReportTokens(env2, db2.prepare("SELECT id, report_token FROM leads").all() as { id: string }[], 2)).size).toBe(2);
  });

  it("puts the custom columns and report links in the GoHighLevel file", async () => {
    const { db, env } = d1();
    addLead(db, "a", { business_name: "Joe's Plumbing", gbp_category: "Plumber", city: "Tampa", state: "FL", rating: 4.2, review_count: 12, ai_services: "Drains, Heaters" });
    addLead(db, "b", { business_name: "Acme Plumbing", gbp_category: "Plumber", city: "Tampa", state: "FL", rating: 4.6, review_count: 800, report_token: "c".repeat(32) });
    const stream = await exportCsv(env, new URLSearchParams("format=ghl&id=a,b"), { origin: "https://app.test/" });
    const text = await new Response(stream).text();
    const lines = text.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe([...CSV_COLUMNS, ...DEFAULT_GHL_COLUMNS.map((c) => c.name)].join(","));
    expect(lines).toHaveLength(3);
    const tokenA = (db.prepare("SELECT report_token FROM leads WHERE id = 'a'").get() as { report_token: string }).report_token;
    expect(tokenA).toMatch(/^[0-9a-f]{32}$/);
    const rowA = lines.find((l) => l.startsWith("Joe's Plumbing"))!;
    expect(rowA).toContain(`https://app.test/r/${tokenA}`);
    expect(rowA).toContain("Acme Plumbing"); // top competitor
    expect(rowA).toContain('"Drains, Heaters"');
    expect(lines.find((l) => l.startsWith("Acme Plumbing"))).toContain(`https://app.test/r/${"c".repeat(32)}`);
    // Other formats are unchanged.
    const simple = await new Response(await exportCsv(env, new URLSearchParams("format=simple&id=a"), { origin: "https://app.test" })).text();
    expect(simple).not.toContain("Report Link");
  });
});

describe("the opener column without an AI line", () => {
  it("names the same weakness and competitor as the report, keeping names capitalised", async () => {
    const { ghlValues } = await import("../src/ghl-columns");
    const facts = { average: { avg_rating: 4.9, avg_reviews: 204, businesses: 30 }, top: [{ id: "big", name: "Mr. Rooter Plumbing", rating: 4.9, reviews: 1014 }] };
    const lead = { id: "me", business_name: "Economy Plumbing", data_source: "google", review_count: 19, rating: 4.8, website: null, gbp_category: "Plumber",
      owner_name: null, lead_status: null, ai_opener: null, score_notes: JSON.stringify({ suggestions: ["Rooter Man has 635 reviews"] }) };
    const [opener, competitor] = ghlValues([{ name: "Opener", source: "opener" }, { name: "Top", source: "top_competitor" }], lead as never,
      { facts, reportUrl: "", agency: { name: "A", phone: "", email: "", website: "", blurb: "" }, people: new Map() } as never);
    expect(competitor).toBe("Mr. Rooter Plumbing");
    expect(opener).toContain("Economy Plumbing");
    expect(opener).not.toContain("Rooter Man");
    expect(opener).not.toMatch(/mr\. Rooter/);
  });
});
