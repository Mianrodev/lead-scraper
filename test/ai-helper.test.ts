import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  aiHelperDue, aiHelperRun, aiHelperStatus, aiHelperStep, cleanAnswer, extractPage, geminiKey, googleReason, NEWEST_SQL, pageFacts, pickCandidates,
  PRIORITY_SQL, rawPageFromHtml, setAiHelperSettings, socialKey, WAITING_SQL, WORKED_SQL, type AiEnv, type PageFacts,
} from "../src/ai-helper";
import { buildOpener, DEFAULT_TEMPLATES } from "../src/openers";

const fs = (await import("node:" + "fs")) as { readdirSync(p: string): string[]; readFileSync(p: string, enc: "utf8"): string };
const migrations = fs.readdirSync("migrations").filter((x) => x.endsWith(".sql")).sort();

function d1(extra: Partial<AiEnv> = {}) {
  const db = new DatabaseSync(":memory:");
  for (const f of migrations) db.exec(fs.readFileSync(`migrations/${f}`, "utf8"));
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
  return { db, env: { DB, LEAD_TIMEZONE: "America/New_York", ...extra } as unknown as AiEnv };
}

let n = 0;
function addLead(db: DatabaseSync, id: string, extra: Record<string, unknown> = {}) {
  n++;
  const row = {
    id, google_place_id: `p-${id}`, business_name: `Biz ${id}`, gbp_category: "Plumber", city: "Tampa", state: "FL",
    website: `https://${id}.test/`, website_domain: `${id}.test`, website_audit_status: "done",
    created_at: `2026-01-${String(n).padStart(2, "0")} 00:00:00`, ...extra,
  };
  const keys = Object.keys(row);
  db.prepare(`INSERT INTO leads (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...(Object.values(row) as never[]));
}
const lead = (db: DatabaseSync, id: string) => db.prepare(`SELECT * FROM leads WHERE id = ?`).get(id) as Record<string, unknown>;
const emailsOf = (db: DatabaseSync, id: string) => (db.prepare(`SELECT email FROM lead_emails WHERE lead_id = ? ORDER BY position`).all(id) as { email: string }[]).map((r) => r.email);
const setting = (db: DatabaseSync, key: string) => (db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key) as { value: string } | undefined)?.value;

const PAGE = `<!doctype html><html><head><title>Joe’s Plumbing | Tampa Plumbers</title>
<meta name="description" content="Family plumbing in Tampa since 1998.">
<script>var secret = "hidden@script.test"; document.write("Do not read me");</script>
<style>.x{color:red}</style></head>
<body><nav><a href="/about-us">About</a> <a href="mailto:Joe@JoesPlumbing.test?subject=hi">Email us</a></nav>
<h1>Joe&rsquo;s Plumbing &amp; Drains</h1>
<p>Owner Joe Smith has fixed leaks across Tampa for 25 years. We do drain cleaning, water heater repair and repiping.</p>
<p>Write to office@joesplumbing.test any time. Emergency service 24/7, licensed and insured, free estimates for every customer in Hillsborough County.</p>
<svg><text>svg text</text></svg><noscript>Turn on JavaScript</noscript>
<a href="https://www.facebook.com/joesplumbing/">Facebook</a>
<a href="https://www.facebook.com/sharer/sharer.php?u=x">Share</a>
<a href="https://instagram.com/joes.plumbing?hl=en">Instagram</a>
<a href="https://webdesignco.test/">Site by WebDesignCo</a>
</body></html>`;

const htmlResponse = (html: string, status = 200) => new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });

/** A fake network: websites by host, and Gemini answering with `gemini`. */
function fakeFetch(sites: Record<string, string | null>, gemini: () => Response, calls: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith("https://generativelanguage.googleapis.com/")) return gemini();
    const host = new URL(url).hostname;
    const html = sites[host];
    if (html === undefined) throw new Error("network down");
    if (html === null) return new Response("{}", { headers: { "Content-Type": "application/json" } });
    return htmlResponse(html);
  }) as typeof fetch;
}
const geminiOk = (answer: unknown) => () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }), { headers: { "Content-Type": "application/json" } });

describe("reading a page", () => {
  it("keeps visible text, drops scripts / styles / svg, and finds mailto, social pages and the about page", async () => {
    const f = await extractPage(PAGE, "https://joesplumbing.test/");
    expect(f.text).toContain("Joe’s Plumbing & Drains");
    expect(f.text).toContain("Family plumbing in Tampa since 1998.");
    expect(f.text).toContain("Owner Joe Smith");
    expect(f.text).not.toContain("Do not read me");
    expect(f.text).not.toContain("color:red");
    expect(f.text).not.toContain("svg text");
    expect(f.text).not.toContain("Turn on JavaScript");
    expect(f.mailtos).toEqual(["joe@joesplumbing.test"]);
    expect(f.socials).toEqual(["https://www.facebook.com/joesplumbing", "https://instagram.com/joes.plumbing"]);
    expect(f.nextPage).toBe("https://joesplumbing.test/about-us");
  });

  it("normalises social links for matching", () => {
    expect(socialKey("https://www.facebook.com/JoesPlumbing/")).toBe("facebook.com/joesplumbing");
    expect(socialKey("facebook.com/joesplumbing")).toBe("facebook.com/joesplumbing");
    expect(socialKey("https://twitter.com/joe")).toBe("x.com/joe");
    expect(socialKey("https://www.facebook.com/sharer/sharer.php?u=1")).toBeNull();
    expect(socialKey("https://facebook.com/")).toBeNull();
    expect(socialKey("https://example.com/joe")).toBeNull();
  });

  it("decodes entities, including obfuscated emails", () => {
    const f = pageFacts(rawPageFromHtml("<p>Mail info&#64;acme.test &amp; more</p>"), "https://acme.test");
    expect(f.text).toContain("info@acme.test & more");
  });
});

describe("nothing made up", () => {
  const page: PageFacts = {
    text: "Joe’s Plumbing\nOwner Joe Smith fixes leaks. Write to office@joesplumbing.test.",
    mailtos: ["joe@joesplumbing.test"],
    socials: ["https://www.facebook.com/joesplumbing"],
    nextPage: null,
  };
  it("keeps only emails, names and social pages that are on the page", () => {
    const a = cleanAnswer({
      ownerName: "Joe Smith", ownerTitle: "Owner",
      emails: ["Office@JoesPlumbing.test", "joe@joesplumbing.test", "invented@joesplumbing.test", "not an email"],
      socials: ["https://facebook.com/joesplumbing/", "https://instagram.com/madeup"],
      services: ["Drain cleaning", "Water heater repair, install", "A very long service name here", "drain cleaning"],
      summary: "Plumber in Tampa 🚰 fixing leaks.",
      opener: "I saw you’ve fixed leaks across Tampa for 25 years.",
    }, page);
    expect(a.emails).toEqual(["office@joesplumbing.test", "joe@joesplumbing.test"]);
    expect(a.ownerName).toBe("Joe Smith");
    expect(a.ownerTitle).toBe("Owner");
    expect(a.socials).toEqual(["https://www.facebook.com/joesplumbing"]);
    expect(a.services).toEqual(["Drain cleaning", "Water heater repair install"]);
    expect(a.summary).toBe("Plumber in Tampa fixing leaks.");
    expect(a.opener).toBe("I saw you’ve fixed leaks across Tampa for 25 years.");
  });

  it("drops an owner name that isn't on the page or isn't a name, and stock phrases", () => {
    expect(cleanAnswer({ ownerName: "Mary Jones" }, page).ownerName).toBe("");
    expect(cleanAnswer({ ownerName: "Joe" }, page).ownerName).toBe("");
    expect(cleanAnswer({ ownerName: "Joe Smith <b>" }, page).ownerName).toBe("");
    expect(cleanAnswer({ ownerName: "", ownerTitle: "Owner" }, page).ownerTitle).toBe("");
    expect(cleanAnswer({ opener: "I hope this finds you well!" }, page).opener).toBe("");
    expect(cleanAnswer({ opener: "Visit https://evil.test now" }, page).opener).toBe("");
    expect(cleanAnswer("garbage", page)).toMatchObject({ ownerName: "", emails: [], socials: [], services: [], summary: "", opener: "" });
  });
});

describe("the key and Google's reasons", () => {
  it("ignores a line ending or byte-order mark stuck to the key (Windows terminals add them)", () => {
    expect(geminiKey({ GEMINI_API_KEY: "\uFEFFAQ.abc123\r\n" } as AiEnv)).toBe("AQ.abc123");
    expect(geminiKey({} as AiEnv)).toBe("");
  });
  it("keeps Google's own reason short and readable", () => {
    expect(googleReason(400, JSON.stringify({ error: { status: "INVALID_ARGUMENT", message: "API key not valid." } }))).toBe("400 INVALID_ARGUMENT: API key not valid.");
    expect(googleReason(503, "Service\n  Unavailable")).toBe("503 Service Unavailable");
  });
});

describe("which businesses next", () => {
  it("uses the small indexes, never the whole table", () => {
    const { db } = d1();
    const plan = (sql: string) => (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(3) as { detail: string }[]).map((r) => r.detail).join(" | ");
    expect(plan(PRIORITY_SQL)).toContain("idx_leads_ai_priority");
    expect(plan(WORKED_SQL)).toContain("idx_leads_ai_worked");
    expect(plan(NEWEST_SQL)).toContain("idx_leads_ai_todo");
    for (const sql of [PRIORITY_SQL, WORKED_SQL, NEWEST_SQL]) expect(plan(sql)).not.toMatch(/SCAN leads\b(?! USING)/);
    expect(() => db.prepare(WAITING_SQL).get()).not.toThrow();
  });

  it("asked-for first, then worked businesses, then those missing an owner or email, newest first", async () => {
    const { db, env } = d1();
    addLead(db, "old-missing", { owner_name: null });
    addLead(db, "has-all", { owner_name: "Ann Lee" });
    db.prepare(`INSERT INTO lead_emails (lead_id, email, position) VALUES ('has-all', 'a@x.test', 0)`).run();
    addLead(db, "new-missing");
    addLead(db, "worked", { lead_status: "Contacted", owner_name: "Bo Diaz" });
    addLead(db, "assigned", { assigned_to: "u1" });
    addLead(db, "not-checked", { website_audit_status: "queued" });
    addLead(db, "dnc", { suppressed: "asked" });
    addLead(db, "already", { ai_status: "done" });
    expect(await pickCandidates(env, 3)).toEqual(["assigned", "worked", "new-missing"]);
    await aiHelperRun(env, ["not-checked"]);
    expect(await pickCandidates(env, 4)).toEqual(["not-checked", "assigned", "worked", "new-missing"]);
    expect(await pickCandidates(env, 10)).not.toContain("dnc");
    expect(await pickCandidates(env, 10)).not.toContain("already");
  });
});

describe("the step", () => {
  it("does nothing without a key", async () => {
    const { db, env } = d1();
    addLead(db, "a");
    expect(await aiHelperDue(env)).toBe(false);
    expect((await aiHelperStep(env, fakeFetch({}, geminiOk({})))).stopped).toBe("no key");
    expect(lead(db, "a").ai_status).toBeNull();
    expect((await aiHelperStatus(env)).enabled).toBe(false);
  });

  it("fills in what's missing and only keeps what's on the page", async () => {
    const { db, env } = d1({ GEMINI_API_KEY: "test-key" });
    addLead(db, "joesplumbing", { socials: "https://yelp.com/biz/joes" });
    db.prepare(`INSERT INTO lead_emails (lead_id, email, position) VALUES ('joesplumbing', 'old@x.test', 3)`).run();
    const calls: string[] = [];
    const r = await aiHelperStep(env, fakeFetch({ "joesplumbing.test": PAGE }, geminiOk({
      ownerName: "Joe Smith", ownerTitle: "Owner", emails: ["office@joesplumbing.test", "ceo@madeup.test"],
      socials: ["https://facebook.com/joesplumbing", "https://linkedin.com/company/fake"],
      services: ["Drain cleaning", "Water heaters"], summary: "Family plumber in Tampa since 1998.", opener: "Twenty-five years of fixing leaks across Tampa is impressive.",
    }), calls));
    expect(r).toEqual({ processed: 1, geminiCalls: 1, stopped: null });
    const l = lead(db, "joesplumbing");
    expect(l).toMatchObject({
      ai_status: "done", owner_name: "Joe Smith", owner_title: "Owner", owner_source: "ai",
      ai_summary: "Family plumber in Tampa since 1998.", ai_services: "Drain cleaning, Water heaters",
      ai_opener: "Twenty-five years of fixing leaks across Tampa is impressive.",
      socials: "https://yelp.com/biz/joes, https://www.facebook.com/joesplumbing",
    });
    expect(l.ai_checked_at).toBeTruthy();
    expect(emailsOf(db, "joesplumbing")).toEqual(["old@x.test", "office@joesplumbing.test"]);
    expect(calls.filter((u) => u.includes("generativelanguage"))).toHaveLength(1);
    // The homepage says little (under 1,500 characters), so its about page is read too: 2 fetches.
    expect(calls.filter((u) => !u.includes("generativelanguage"))).toEqual(["https://joesplumbing.test/", "https://joesplumbing.test/about-us"]);
    expect(setting(db, "ai_helper_today")).toBe(`${new Date().toISOString().slice(0, 10)}:1`);
  });

  it("never overwrites an owner name already known", async () => {
    const { db, env } = d1({ GEMINI_API_KEY: "k" });
    addLead(db, "joesplumbing", { owner_name: "Ann Lee", owner_source: "registry" });
    await aiHelperStep(env, fakeFetch({ "joesplumbing.test": PAGE }, geminiOk({ ownerName: "Joe Smith", ownerTitle: "Owner", emails: [], socials: [], services: [], summary: "", opener: "" })));
    expect(lead(db, "joesplumbing")).toMatchObject({ owner_name: "Ann Lee", owner_source: "registry", ai_status: "done" });
  });

  it("over the limit (429): pauses for an hour and leaves the businesses waiting", async () => {
    const { db, env } = d1({ GEMINI_API_KEY: "k" });
    addLead(db, "a"); addLead(db, "b");
    const r = await aiHelperStep(env, fakeFetch({ "a.test": PAGE, "b.test": PAGE }, () => new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED" } }), { status: 429 })));
    expect(r.stopped).toBe("rate");
    expect(lead(db, "a").ai_status).toBeNull();
    expect(lead(db, "b").ai_status).toBeNull();
    const s = await aiHelperStatus(env);
    expect(s.pausedUntil).toBeTruthy();
    expect(Date.parse(s.pausedUntil!) - Date.now()).toBeGreaterThan(55 * 60_000);
    expect(s.problem).toMatch(/limit/);
    expect(await aiHelperDue(env)).toBe(false);
    // Switching on again lifts the pause.
    await setAiHelperSettings(env, { enabled: true });
    expect(await aiHelperDue(env)).toBe(true);
  });

  it("a key that doesn't work: pauses for 6 hours with one notice", async () => {
    const { db, env } = d1({ GEMINI_API_KEY: "bad" });
    addLead(db, "a");
    const bad = () => new Response(JSON.stringify({ error: { message: "API key not valid. Please pass a valid API key." } }), { status: 400 });
    await aiHelperStep(env, fakeFetch({ "a.test": PAGE }, bad));
    const s = await aiHelperStatus(env);
    expect(s.problem).toBe("The Gemini key isn’t working. Check it (see docs/ai-helper.md) and set it again.");
    expect(Date.parse(s.pausedUntil!) - Date.now()).toBeGreaterThan(5 * 3600_000);
    expect(lead(db, "a").ai_status).toBeNull();
    await setAiHelperSettings(env, { enabled: true });
    await aiHelperStep(env, fakeFetch({ "a.test": PAGE }, bad));
    expect((db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE kind = 'ai_helper'`).get() as { n: number }).n).toBe(1);
  });

  it("other refusals fail that business and carry on", async () => {
    const { db, env } = d1({ GEMINI_API_KEY: "k" });
    addLead(db, "a"); addLead(db, "b");
    await aiHelperStep(env, fakeFetch({ "a.test": PAGE, "b.test": PAGE }, () => new Response("{}", { status: 400 })));
    expect(lead(db, "a").ai_status).toBe("failed");
    expect(lead(db, "b").ai_status).toBe("failed");
  });

  it("test mode: reads the sites without Gemini; unreachable → failed, no text → nothing", async () => {
    const { db, env } = d1({ GEMINI_MOCK: "1" });
    addLead(db, "joesplumbing"); addLead(db, "down"); addLead(db, "empty"); addLead(db, "pdf");
    const calls: string[] = [];
    const sites = { "joesplumbing.test": PAGE, "empty.test": "<html><body><p>Coming soon</p></body></html>", "pdf.test": null };
    const r1 = await aiHelperStep(env, fakeFetch(sites, () => { throw new Error("must not call Gemini"); }, calls));
    const r2 = await aiHelperStep(env, fakeFetch(sites, () => { throw new Error("must not call Gemini"); }, calls));
    expect(r1.processed + r2.processed).toBe(4);
    expect(calls.some((u) => u.includes("generativelanguage"))).toBe(false);
    expect(lead(db, "joesplumbing")).toMatchObject({ ai_status: "done", owner_name: "Joe Smith", owner_source: "ai" });
    expect(String(lead(db, "joesplumbing").ai_summary)).toMatch(/^\(Test answer\)/);
    expect(emailsOf(db, "joesplumbing")).toEqual(["joe@joesplumbing.test", "office@joesplumbing.test"]);
    expect(lead(db, "down").ai_status).toBe("failed");
    expect(lead(db, "pdf").ai_status).toBe("failed");
    expect(lead(db, "empty").ai_status).toBe("nothing");
    expect((await aiHelperStatus(env)).doneToday).toBe(1);
  });

  it("stops at today's limit", async () => {
    const { db, env } = d1({ GEMINI_MOCK: "1" });
    addLead(db, "a");
    db.prepare(`INSERT INTO app_settings (key, value) VALUES ('ai_helper_today', ?)`).run(`${new Date().toISOString().slice(0, 10)}:200`);
    expect(await aiHelperDue(env)).toBe(false);
    expect((await aiHelperStep(env, fakeFetch({}, geminiOk({})))).stopped).toBe("daily limit");
  });
});

describe("settings and run", () => {
  it("checks the daily limit and the picked businesses", async () => {
    const { db, env } = d1({ GEMINI_API_KEY: "k" });
    await expect(setAiHelperSettings(env, { dailyLimit: 5 })).rejects.toThrow(/10 and 1,500/);
    await setAiHelperSettings(env, { dailyLimit: 300, enabled: false });
    const s = await aiHelperStatus(env);
    expect(s).toMatchObject({ dailyLimit: 300, enabled: false, switchedOn: false, keySet: true, doneToday: 0 });
    await expect(aiHelperRun(env, [])).rejects.toThrow();
    await expect(aiHelperRun(env, Array.from({ length: 51 }, (_, i) => `x${i}`))).rejects.toThrow(/50/);
    addLead(db, "a", { ai_status: "done" }); addLead(db, "b", { website: null });
    expect(await aiHelperRun(env, ["a", "b", "zzz"])).toEqual({ queued: 1 });
    expect(lead(db, "a").ai_status).toBeNull();
    expect(Number(lead(db, "a").ai_priority)).toBeGreaterThan(0);
  });

  it("counts waiting businesses and caches the count", async () => {
    const { db, env } = d1({ GEMINI_API_KEY: "k" });
    addLead(db, "a"); addLead(db, "b");
    expect((await aiHelperStatus(env)).waiting).toBe(2);
    addLead(db, "c");
    expect((await aiHelperStatus(env)).waiting).toBe(2); // cached for 10 minutes
  });
});

describe("opener", () => {
  const base = { business: "Joe’s Plumbing", ownerName: "Joe Smith", city: "Tampa", category: "Plumber", suggestions: ["Add online booking"], agency: { name: "Acme", phone: "", email: "", website: "" } };
  it("uses the AI line as the first line and in the email", () => {
    const o = buildOpener({ ...base, aiOpener: "Twenty-five years of fixing leaks across Tampa is impressive {business}." }, DEFAULT_TEMPLATES);
    expect(o.firstLine).toBe("Twenty-five years of fixing leaks across Tampa is impressive {business}.");
    expect(o.email).toContain("Hi Joe,\n\nTwenty-five years of fixing leaks across Tampa is impressive {business}. I noticed customers can't book with you online.");
    expect(o.email).not.toContain("I was looking at");
  });
  it("without one, nothing changes", () => {
    const o = buildOpener(base, DEFAULT_TEMPLATES);
    expect(o.firstLine).toBe("I was looking at Joe’s Plumbing online and noticed customers can't book with you online.");
    expect(o.email).toContain("I was looking at Joe’s Plumbing online and noticed customers can't book with you online.");
  });
});
