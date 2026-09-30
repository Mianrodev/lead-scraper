import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { buildOpener, cleanTemplates, DEFAULT_TEMPLATES, pluralCategory, problemPhrase } from "../src/openers";
import { renderDemo } from "../src/demo";
import { isBot } from "../src/events";
import { areaSql, parseArea } from "../src/leads";
import { checkForm, formPage } from "../src/form";
import { COLD_EMAIL_COLUMNS, rowFor } from "../src/export";

const agency = { name: "Bright Local", phone: "(407) 555-0100", email: "hi@bright.test", website: "https://www.bright.test/", blurb: "" };

describe("openers", () => {
  it("turns score suggestions into owner-facing phrases", () => {
    expect(problemPhrase("Add online booking (Housecall Pro, Calendly...)")).toBe("customers can't book with you online");
    expect(problemPhrase("Close the review gap: Acme Plumbing nearby has 1,204 reviews, this business 12")).toBe("Acme Plumbing has 1,204 Google reviews to your 12");
    expect(problemPhrase("Something new")).toBeNull();
  });

  it("pluralises categories", () => {
    expect(pluralCategory("Plumber")).toBe("plumbers");
    expect(pluralCategory("Roofing company")).toBe("roofing companies");
    expect(pluralCategory("Pest control service")).toBe("pest control services");
    expect(pluralCategory("Car wash")).toBe("car washes");
    expect(pluralCategory(null)).toBe("local businesses");
  });

  it("fills the templates per business", () => {
    const o = buildOpener({
      business: "Joe's Plumbing", ownerName: "Joe Smith", city: "Orlando", category: "Plumber",
      suggestions: ["Add online booking (x)", "Make the website work on phones"], agency,
    });
    expect(o.firstLine).toBe("I was looking at Joe's Plumbing online and noticed customers can't book with you online.");
    expect(o.email).toMatch(/^Hi Joe,/);
    expect(o.email).toContain("For plumbers in Orlando");
    expect(o.email).toContain("I also noticed your website is hard to use on a phone");
    expect(o.email).toContain("Bright Local\n(407) 555-0100\nbright.test");
    expect(o.sms).toContain("it's Bright Local here");
    expect(o.subject).toBe("Quick idea for Joe's Plumbing");
  });

  it("falls back politely when little is known", () => {
    const o = buildOpener({ business: null, ownerName: null, city: null, category: null, suggestions: [], agency: { ...agency, name: "" } });
    expect(o.email).toMatch(/^Hi there,/);
    expect(o.email).toContain("a few quick wins");
    expect(o.email).not.toContain("I also noticed");
    expect(o.email).not.toMatch(/\{\w+\}/);
  });

  it("keeps unknown merge fields and cleans saved templates", () => {
    expect(buildOpener({ business: "A", ownerName: "B", city: "C", category: "D", suggestions: [], agency }, { ...DEFAULT_TEMPLATES, sms: "{nope} {business}" }).sms).toBe("{nope} A");
    const t = cleanTemplates({ subject: "  ", email: "x".repeat(5000), sms: 5 });
    expect(t.subject).toBe(DEFAULT_TEMPLATES.subject);
    expect(t.email).toHaveLength(3000);
    expect(t.sms).toBe(DEFAULT_TEMPLATES.sms);
  });
});

describe("demo website", () => {
  const lead = { business_name: `Bob's <script>alert(1)</script> "Roof"`, gbp_category: "Roofing contractor", industry: null, city: "Tampa", state: "FL",
    gbp_phone_formatted: "+18135550123", rating: 4.6, review_count: 38, address: null, owner_name: null };

  it("escapes everything the business supplied", () => {
    const html = renderDemo(lead, agency);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("Bob&#39;s &lt;script&gt;");
    // The name inside the form's alert() can't break out of the JS string.
    const alertArg = html.match(/alert\('([^']*)'\)/)![1];
    expect(alertArg).not.toMatch(/["'<>\\]/);
  });

  it("uses the business's kind, phone and reviews", () => {
    const html = renderDemo(lead, agency);
    expect(html).toContain("Roof replacement");
    expect(html).toContain('href="tel:+18135550123"');
    expect(html).toContain("(813) 555-0123");
    expect(html).toContain("4.6 from 38 Google reviews");
    expect(html).toContain("noindex");
  });
});

describe("view tracking", () => {
  it("ignores link previews and scripts, counts browsers", () => {
    expect(isBot("Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)")).toBe(true);
    expect(isBot("facebookexternalhit/1.1")).toBe(true);
    expect(isBot("WhatsApp/2.23.20.0")).toBe(true);
    expect(isBot("")).toBe(true);
    expect(isBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")).toBe(false);
    expect(isBot("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36")).toBe(false);
  });
});

describe("map area filter", () => {
  it("reads only sensible corners", () => {
    expect(parseArea("28.5,-81.4;28.6,-81.3;28.4,-81.2")).toHaveLength(3);
    expect(parseArea("28.5,-81.4;28.6,-81.3")).toBeUndefined();
    expect(parseArea("91,0;1,1;2,2")).toBeUndefined();
    expect(parseArea("a,b;1,1;2,2;3,3")).toHaveLength(3);
    expect(parseArea("1; drop table leads;2,2;3,3")).toBeUndefined();
    expect(parseArea(null)).toBeUndefined();
  });

  it("finds the points inside a drawn shape (real SQLite)", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE leads (id TEXT, latitude REAL, longitude REAL)");
    const ins = db.prepare("INSERT INTO leads VALUES (?, ?, ?)");
    // An L-shaped area: the notch (inside the box, outside the shape) must be left out.
    const L: [number, number][] = [[0, 0], [0, 10], [5, 10], [5, 5], [10, 5], [10, 0]];
    for (const [id, lat, lng] of [["in-a", 2, 2], ["in-b", 8, 2], ["in-c", 2, 8], ["notch", 8, 8], ["out", 12, 2], ["nopos", null, null]] as const) ins.run(id, lat, lng);
    const rows = db.prepare(`SELECT id FROM leads l WHERE ${areaSql(L)} ORDER BY id`).all() as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual(["in-a", "in-b", "in-c"]);
  });
});

describe("free-check form", () => {
  it("checks and cleans a submission", () => {
    expect(checkForm({ business: "", email: "a@b.co" })).toEqual({ error: "Please enter your business name." });
    expect(checkForm({ business: "Acme", email: "nope" })).toEqual({ error: "Please enter a valid email address." });
    const v = checkForm({ business: " Acme Pools ", email: "Owner@AcmePools.com", website: "acmepools.com", phone: "(407) 555-0199", city: "Orlando, Florida", name: "Ann Lee" });
    expect(v).toMatchObject({ business: "Acme Pools", email: "owner@acmepools.com", domain: "acmepools.com", phone: "+14075550199", city: "Orlando", state: "FL", name: "Ann Lee" });
  });

  it("escapes the error and has a hidden trap field", () => {
    const html = formPage("abc", agency, `<img src=x onerror=alert(1)>`);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain('name="company_url"');
  });
});

describe("cold email download", () => {
  it("adds a first line and a text message", () => {
    const l = { id: "1", business_name: "Joe's Plumbing", industry: null, cid: null, gbp_category: "Plumber", lead_category: null, sub_category: null, gbp_phone_raw: null,
      gbp_phone_formatted: "+14075550100", phone_type: "mobile", website: "https://joes.test", owner_name: null, gbp_url: null, gbp_rank: null, rating: null, review_count: null,
      address: null, city: "Orlando", state: "FL", country: "USA", socials: null, logo_url: null, lead_source: null, source_code: null, lead_status: null, lead_date: null,
      lead_datetime: null, presence_score: 30, score_notes: JSON.stringify({ suggestions: ["Add online booking (x)"] }) };
    const row = rowFor("cold_email", l, ["joe@joes.test"], [], {}, { templates: DEFAULT_TEMPLATES, agency })!;
    expect(row).toHaveLength(COLD_EMAIL_COLUMNS.length);
    expect(row[COLD_EMAIL_COLUMNS.indexOf("First Line")]).toBe("I was looking at Joe's Plumbing online and noticed customers can't book with you online.");
    expect(row[COLD_EMAIL_COLUMNS.indexOf("SMS")]).toMatch(/^Hi Joe, it's Bright Local here/);
  });
});
