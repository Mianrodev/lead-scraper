import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { gradeFor, gradeReport, localFactsFor, parseSocials, SECTION_WEIGHTS, TOP_NEARBY_SQL, type GradeInput, type LocalFacts } from "../src/grade";
import { renderReport, reportPage } from "../src/report";

const fs = (await import("node:" + "fs")) as { readdirSync(p: string): string[]; readFileSync(p: string, enc: "utf8"): string };

/** The real schema in Node's SQLite behind the part of D1's API the code uses; every statement is recorded. */
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
  return { db, env: { DB } as unknown as Env, seen };
}
const addLead = (db: DatabaseSync, id: string, cols: Record<string, unknown> = {}) => {
  const all = { id, google_place_id: `p-${id}`, business_name: `Biz ${id}`, ...cols };
  db.prepare(`INSERT INTO leads (${Object.keys(all).join(", ")}) VALUES (${Object.keys(all).map(() => "?").join(", ")})`).run(...(Object.values(all) as never[]));
};

const today = new Date("2026-10-15T12:00:00Z");
const agency = { name: "Bright Local", phone: "(407) 555-0100", email: "hi@bright.test", website: "https://bright.test", blurb: "" };

/** A Google business with a good website and a good profile. */
const strong: GradeInput = {
  id: "me", business_name: "Joe's Plumbing", gbp_category: "Plumber", city: "Tampa", state: "FL", website: "https://joes.test", website_domain: "joes.test",
  data_source: "google", is_claimed: 1, phone: "+18135550100", has_hours: 1, has_description: 1, photos_count: 40, rating: 4.8, review_count: 220,
  reachable: 1, https: 1, mobile_viewport: 1, has_contact_form: 1, has_booking: 1, has_meta_pixel: 1, has_google_tag: 1, has_chat_widget: 1,
  copyright_year: 2026, psi_score: 92, audit_error: null, social_only: 0, email_provider: "Google Workspace", checked_at: "2026-10-01 10:00:00",
  has_google_ads: 1, has_bing_ads: 0, call_tracking: "CallRail", has_tiktok_pixel: 1, builder: "wordpress",
  socials: "https://facebook.com/joes, https://www.instagram.com/joes, https://www.yelp.com/biz/joes", ai_status: "done",
  ai_summary: "Family plumber serving Tampa since 1998.", ai_services: "Drain cleaning, Water heaters, Repiping",
};
const facts: LocalFacts = {
  average: { avg_rating: 4.4, avg_reviews: 60, businesses: 12 },
  top: [
    { id: "me", name: "Joe's Plumbing", rating: 4.8, reviews: 900 },
    { id: "c1", name: "Acme Plumbing", rating: 4.6, reviews: 800 },
    { id: "c2", name: "Best Drains", rating: 4.1, reviews: 300 },
    { id: "c3", name: "City Rooter", rating: 4.9, reviews: 150 },
  ],
};

describe("report grades", () => {
  it("turns scores into letters at the right boundaries", () => {
    expect([100, 85, 84.9, 84, 70, 69, 55, 54, 40, 39, 0].map(gradeFor)).toEqual(["A", "A", "B", "B", "B", "C", "C", "D", "D", "F", "F"]);
  });

  it("grades every section of a strong business", () => {
    const g = gradeReport(strong, facts, today);
    expect(g.sections.map((s) => s.key)).toEqual(["google", "reviews", "website", "ads", "social"]);
    expect(g.sections.every((s) => s.status === "graded" && s.score != null && s.grade != null)).toBe(true);
    expect(g.sections.find((s) => s.key === "google")!.grade).toBe("A");
    expect(g.sections.find((s) => s.key === "website")!.score).toBe(100);
    expect(g.overall!.grade).toBe("A");
    expect(g.about).toEqual({ summary: "Family plumber serving Tampa since 1998.", services: ["Drain cleaning", "Water heaters", "Repiping"] });
    expect(g.socialPages.map((p) => p.key)).toEqual(["facebook", "instagram", "yelp"]);
  });

  it("shows free / uploaded data without Google details as “Not checked yet”, not counted against the overall", () => {
    const free: GradeInput = { ...strong, data_source: "free", is_claimed: null, rating: null, review_count: null, photos_count: null };
    const g = gradeReport(free, facts, today);
    const google = g.sections.find((s) => s.key === "google")!;
    const reviews = g.sections.find((s) => s.key === "reviews")!;
    expect(google).toMatchObject({ status: "not_checked", score: null, grade: null });
    expect(reviews).toMatchObject({ status: "not_checked", score: null, grade: null, note: "Your Google rating: not checked" });
    // The overall is the weighted average of the graded sections only.
    const graded = g.sections.filter((s) => s.status === "graded");
    const w = graded.reduce((a, s) => a + SECTION_WEIGHTS[s.key], 0);
    expect(g.overall!.score).toBe(Math.round(graded.reduce((a, s) => a + SECTION_WEIGHTS[s.key] * s.score!, 0) / w));
    expect(g.overall!.grade).toBe("A");
    expect(g.reviews).toBeNull();
    // A website not visited yet is not a fail either.
    const unvisited = gradeReport({ ...free, reachable: null, checked_at: null, socials: null, ai_status: null }, null, today);
    expect(unvisited.sections.map((s) => s.status)).toEqual(["not_checked", "not_checked", "not_checked", "not_checked", "not_checked"]);
    expect(unvisited.overall).toBeNull();
    expect(unvisited.quickWins).toEqual([]);
  });

  it("lists the 3 busiest similar businesses nearby, never the business itself", () => {
    const g = gradeReport(strong, facts, today);
    expect(g.competitors.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    // Free data: the table still shows, with “not checked” for this business.
    const html = renderReport({ ...strong, data_source: "free" }, agency, today, facts);
    expect(html).toContain("You vs. top businesses near you");
    expect(html).toContain("Your Google rating: not checked");
    expect(html).toContain("Acme Plumbing");
    expect(html).not.toMatch(/<td>Joe&#39;s Plumbing<\/td>/);
  });

  it("orders quick wins by value: no website first, then the profile claim, then the review gap", () => {
    const weak: GradeInput = { ...strong, website: null, website_domain: undefined, is_claimed: 0, review_count: 12, rating: 4.6, reachable: null, checked_at: null,
      has_hours: 0, socials: null, ai_status: null };
    const g = gradeReport(weak, facts, today);
    expect(g.quickWins).toHaveLength(3);
    expect(g.quickWins[0]).toMatch(/^Get a simple website/);
    expect(g.quickWins[1]).toMatch(/^Claim and verify your Google profile/);
    expect(g.quickWins[2]).toBe("Close the review gap: Acme Plumbing nearby has 800 Google reviews to your 12.");
    // The missing website is said once, even though both the profile and the website sections miss it.
    expect(g.quickWins.filter((w) => /website/i.test(w))).toHaveLength(1);
    expect(g.sections.find((s) => s.key === "website")).toMatchObject({ status: "graded", score: 0, grade: "F" });
    expect(g.sections.find((s) => s.key === "ads")).toMatchObject({ status: "na" });
  });

  it("asks for a Meta pixel / Google tag once, and reads the social pages", () => {
    const g = gradeReport({ ...strong, has_meta_pixel: 0, has_google_tag: 0 }, facts, today);
    expect(g.quickWins.filter((w) => /Meta pixel/.test(w))).toHaveLength(1);
    expect(g.sections.find((s) => s.key === "ads")!.checks.filter((c) => !c.ok)).toHaveLength(2);
    expect(parseSocials("https://fb.com/x, twitter.com/y, https://m.youtube.com/z, https://example.com").map((p) => p.name)).toEqual(["Facebook", "YouTube", "X (Twitter)"]);
  });
});

describe("report page", () => {
  it("shows the overall grade, the sections, the quick wins and the agency, and stays indexed-off and script-free", () => {
    const html = renderReport(strong, agency, today, facts);
    for (const t of ["Overall grade", "Google profile", "Reviews", "Website", "Ads &amp; tracking", "Social pages", "About your business", "Drain cleaning", "Call (407) 555-0100"]) expect(html).toContain(t);
    expect(html).not.toMatch(/\bAI\b/);
    expect(html).toContain('name="robots" content="noindex,nofollow"');
    expect(html).not.toContain("<script");
    expect(html).toContain("@media print");
  });

  it("is served by token, with the local facts cached for a day per city and type", async () => {
    const { db, env, seen } = d1();
    addLead(db, "me", { business_name: "Joe's Plumbing", gbp_category: "Plumber", city: "Tampa", state: "FL", rating: 4.2, review_count: 12, data_source: "google",
      report_token: "a".repeat(32), raw: JSON.stringify({ openingHours: [{ day: "Monday" }], description: "" }) });
    addLead(db, "c1", { business_name: "Acme Plumbing", gbp_category: "Plumber", city: "Tampa", state: "FL", rating: 4.6, review_count: 800 });
    addLead(db, "c2", { business_name: "Gone Plumbing", gbp_category: "Plumber", city: "Tampa", state: "FL", rating: 4.6, review_count: 5000, business_status: "closed_permanently" });
    addLead(db, "c3", { business_name: "Free Plumbing", gbp_category: "Plumber", city: "Tampa", state: "FL", data_source: "free" });
    const page = await reportPage(env, "a".repeat(32));
    expect(page!.id).toBe("me");
    expect(page!.html).toContain("Acme Plumbing");
    expect(page!.html).not.toContain("Gone Plumbing"); // closed
    expect(page!.html).not.toContain("Free Plumbing"); // no Google reviews
    expect(page!.html).toContain("Opening hours listed");
    expect(page!.html).toContain("No business description");
    const lookups = () => seen.filter((s) => s.includes("ORDER BY review_count DESC")).length;
    expect(lookups()).toBe(1);
    await reportPage(env, "a".repeat(32));
    expect(lookups()).toBe(1); // the second open reads the cached answer
    expect(await reportPage(env, "b".repeat(32))).toBeNull();
    expect(await reportPage(env, "nope")).toBeNull();
  });

  it("finds the busiest nearby with the index, not by reading the whole city", () => {
    const { db } = d1();
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${TOP_NEARBY_SQL}`).all("FL", "Tampa", "Plumber") as { detail: string }[];
    expect(plan.map((p) => p.detail).join(" ")).toContain("idx_leads_local_top");
    expect(plan.map((p) => p.detail).join(" ")).not.toContain("TEMP B-TREE");
  });

  it("looks up many places together and reuses them", async () => {
    const { db, env, seen } = d1();
    addLead(db, "c1", { gbp_category: "Plumber", city: "Tampa", state: "FL", review_count: 10 });
    addLead(db, "c2", { gbp_category: "Roofer", city: "Tampa", state: "FL", review_count: 20 });
    const memo = await localFactsFor(env, [
      { state: "FL", city: "Tampa", category: "Plumber" }, { state: "FL", city: "Tampa", category: "Roofer" },
      { state: "FL", city: "Tampa", category: "Plumber" }, { state: null, city: "Tampa", category: "Plumber" },
    ]);
    expect(memo.size).toBe(2);
    expect(memo.get("local3:FL|Tampa|Roofer")!.top[0].id).toBe("c2");
    const before = seen.length;
    await localFactsFor(env, [{ state: "FL", city: "Tampa", category: "Plumber" }], memo);
    expect(seen.length).toBe(before); // already in hand
  });
});

describe("quick wins say each fix once", () => {
  it("the review gap and the review count are one fix", () => {
    const g = gradeReport({ id: "me", business_name: "Me", data_source: "google", review_count: 17, rating: 5, website: null, gbp_category: "Plumber" } as unknown as GradeInput,
      { average: { avg_rating: 4.9, avg_reviews: 204, businesses: 30 }, top: [{ id: "big", name: "Big Plumbing", rating: 4.9, reviews: 1014 }] } as unknown as LocalFacts);
    expect(g.quickWins.filter((w) => /review/i.test(w) && !/reply/i.test(w))).toHaveLength(1);
  });
});
