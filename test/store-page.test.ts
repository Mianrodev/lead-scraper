import { describe, expect, it } from "vitest";
import { safeColor, safeLogo, storeHtml } from "../src/store/page";

const html = storeHtml({ name: "Lead Store", color: "#4f46e5", supportEmail: "help@example.com", creditPrice: 0.5 });
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
// The app's own script (the other two are the shared theme boot + toggle from src/theme.ts).
const script = scripts.find((s) => s.includes("const $ = "))!;
const fn = (name: string) => script.match(new RegExp(`function ${name}[\\s\\S]*?\\r?\\n}\\r?\\n`))![0];

describe("store page script", () => {
  it("parses", () => {
    for (const s of scripts) expect(() => new Function(s)).not.toThrow();
  });

  it("has only inline scripts: the app's plus the theme boot and toggle", () => {
    expect(scripts.length).toBe(3);
    expect(html).not.toMatch(/<script[^>]+src=/);
  });

  it("has no template-literal leftovers (no backslashes, backticks or dollar-braces)", () => {
    expect(script).not.toMatch(/[`\\]|\$\{/);
  });

  it("never uses the browser's prompt, confirm or alert", () => {
    expect(script).not.toMatch(/window\.(prompt|confirm|alert)\(|[^.\w](prompt|confirm|alert)\(/);
  });

  it("links only web addresses", () => {
    const isWebLink = new Function(script.match(/const isWebLink = [^\n]+/)![0] + "; return isWebLink;")() as (u: unknown) => boolean;
    expect(isWebLink("https://joes.com")).toBe(true);
    expect(isWebLink("http://joes.com/a")).toBe(true);
    expect(isWebLink("javascript:alert(1)")).toBe(false);
    expect(isWebLink(null)).toBe(false);
  });

  it("loads Leaflet only at runtime from cdnjs (no <script src> in the page)", () => {
    expect(script).toContain("https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js");
    expect(script).toContain("https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css");
    expect(script).toContain("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
    expect(script).toContain("OpenStreetMap contributors");
  });

  it("keeps only valid map areas (3 to 40 points)", () => {
    const cleanArea = new Function(fn("cleanArea") + "; return cleanArea;")() as (v: unknown) => string;
    expect(cleanArea("25.1,-80.2;25.2,-80.3;25.3,-80.1")).toBe("25.10000,-80.20000;25.20000,-80.30000;25.30000,-80.10000");
    expect(cleanArea("25.1,-80.2;25.2,-80.3")).toBe("");
    expect(cleanArea("a,b;c,d;e,f")).toBe("");
    expect(cleanArea("95,0;1,1;2,2")).toBe("");
    expect(cleanArea(Array.from({ length: 60 }, (_, i) => i / 10 + ",1").join(";")).split(";").length).toBe(40);
    expect(cleanArea(null)).toBe("");
  });

  it("reads deep links from the hash", () => {
    const parse = (hash: string) => new Function("location", fn("parseHash") + "; return parseHash();")({ hash });
    expect(parse("#find?state=FL&city=Miami%7CFL&category=Plumber")).toEqual({ tab: "find", query: "state=FL&city=Miami%7CFL&category=Plumber" });
    expect(parse("#list?id=abc")).toEqual({ tab: "list", query: "id=abc" });
    expect(parse("#signup")).toEqual({ tab: "signup", query: "" });
    expect(parse("")).toEqual({ tab: "", query: "" });
  });

  it("colours online presence the same way everywhere (under 40 red, 40-59 amber, 60+ green)", () => {
    const scoreClass = new Function(fn("scoreClass") + "; return scoreClass;")() as (s: unknown) => string;
    expect([scoreClass(10), scoreClass(39), scoreClass(40), scoreClass(59), scoreClass(60), scoreClass(79), scoreClass(95), scoreClass(null), scoreClass(0)])
      .toEqual(["bad", "bad", "warn", "warn", "ok", "ok", "strong", "none", "none"]);
    // Bands: under 40 Weak, 40-59 Basic, 60-79 Good, 80+ Strong; 0 = no website / site down (grey).
    const pill = new Function("esc", fn("scoreClass") + fn("onlinePill") + "; return onlinePill;")(String) as (s: unknown, web?: boolean) => string;
    expect(pill(20)).toContain(">Weak<");
    expect(pill(45)).toContain(">Basic<");
    expect(pill(70)).toContain(">Good<");
    expect(pill(85)).toContain(">Strong<");
    expect(pill(85)).toContain('class="pill strong"');
    expect(pill(0)).toContain('class="pill none"');
    expect(pill(0)).toContain(">No website<");
    expect(pill(0, true)).toContain(">Site down<");
    // More filters uses the same Strong pill.
    expect(html).toContain('<span class="pill strong">Strong</span>');
  });

  it("cleans up data labels for reading", () => {
    const get = (name: string, ...deps: string[]) => new Function(...deps, fn(name) + "; return " + name + ";");
    const niceName = get("niceName")() as (s: string) => string;
    expect(niceName("JOE'S PLUMBING LLC")).toBe("Joe's Plumbing LLC");
    expect(niceName("Acme Roofing Llc")).toBe("Acme Roofing LLC");
    expect(niceName("Bob's Hvac, Inc.")).toBe("Bob's HVAC, Inc.");
    expect(niceName("U.s. Roofing")).toBe("U.S. Roofing");
    expect(niceName("P&a Pools")).toBe("P&A Pools");
    // Typed places match however the city is written ("st pete" finds "St. Petersburg").
    const placeNorm = get("placeNorm")() as (s: string) => string;
    expect(placeNorm("St. Petersburg").startsWith(placeNorm("st pete"))).toBe(true);
    expect(placeNorm("Saint Petersburg")).toBe(placeNorm("St. Petersburg"));
    expect(placeNorm("Ft Myers")).toBe(placeNorm("Fort Myers"));
    expect(placeNorm("Opa-locka")).toBe(placeNorm("opa locka"));
    const prettyCat = get("prettyCat")() as (s: string) => string;
    expect(prettyCat("Handyman/Handywoman/Handyperson")).toBe("Handyman");
    expect(prettyCat("Plumber")).toBe("Plumber");
    const siteText = get("siteText")() as (s: string) => string;
    expect(siteText("https://www.joes.com/")).toBe("joes.com");
    const addressText = get("addressText")() as (r: object) => string;
    expect(addressText({ address: "12 Main St, Orlando, FL 32806", city: "Orlando", state: "FL", zip: "32806" })).toBe("12 Main St, Orlando, FL 32806");
    expect(addressText({ address: "12 Main St", city: "Orlando", state: "FL", zip: "32806" })).toBe("12 Main St, Orlando, FL 32806");
    expect(addressText({ address: null, city: "Orlando", state: "FL", zip: null })).toBe("Orlando, FL");
    const num = (v: number) => Number(v || 0).toLocaleString("en-US");
    const plural = (n: number, w: string) => num(n) + " " + w + (Number(n) === 1 ? "" : "s");
    const ledgerNote = get("ledgerNote", "num", "plural")(num, plural) as (s: string) => string;
    expect(ledgerNote("1 leads (1 standard, 0 premium, 1 free this month)")).toBe("1 lead (free this month)");
    expect(ledgerNote("12 leads (10 standard, 2 premium, 5 free this month)")).toBe("12 leads (10 standard, 2 with Google rating; 5 free this month)");
    expect(ledgerNote("Pretend credits")).toBe("Pretend credits");
  });

  it("has a tab icon in the brand colour", () => {
    expect(html).toMatch(/<link rel="icon" href="data:image\/svg\+xml,[^"]+">/);
    expect(decodeURIComponent(html.match(/<link rel="icon" href="data:image\/svg\+xml,([^"]+)">/)![1].replace(/&#39;/g, "'"))).toContain("fill='#4f46e5'");
  });

  it("names searches in plain words: plurals and the headline", () => {
    const pluralWord = new Function(fn("pluralWord") + "; return pluralWord;")() as (w: string) => string;
    expect(["Plumber", "Real estate agency", "Glass & mirrors", "Church", "Day spa"].map(pluralWord)).toEqual(["Plumbers", "Real estate agencies", "Glass & mirrors", "Churches", "Day spas"]);
    const lowerFirst = new Function(fn("lowerFirst") + "; return lowerFirst;")() as (s: string) => string;
    expect(lowerFirst("Plumbers")).toBe("plumbers");
    expect(lowerFirst("HVAC contractors")).toBe("HVAC contractors");
  });

  it("states the price in one sentence from the dry run", () => {
    const F = { cats: ["Plumber"], inds: [], cities: ["Tampa|FL"], state: "", radius: "", zips: [], area: "" };
    const ctx = new Function("F", "STATES", "num", "plural", "approx",
      // The "Words for the search" section (pluralWord ... headline), then quoteSentence.
      [script.slice(script.indexOf("function pluralWord"), script.indexOf("/* ---------- What / Where boxes")), fn("creditMix"), fn("quoteSentence"), "function prices() { return { free: 1, google: 3 }; }", "return quoteSentence;"].join("\n"));
    const num = (v: number) => Number(v || 0).toLocaleString("en-US");
    const plural = (n: number, w: string) => num(n) + " " + w + (Number(n) === 1 ? "" : "s");
    const approx = (c: number) => " (≈ $" + c / 2 + ")";
    const quote = ctx(F, { FL: "Florida" }, num, plural, approx) as (job: unknown, d: unknown) => string;
    expect(quote({ picked: false }, { count: 248, alreadyOwned: 0, freeLeads: 50, credits: 198, balance: 200, freeLeft: 50 }))
      .toBe("248 plumbers in Tampa, FL: 50 free this month + 198 credits (≈ $99). You'll have 2 credits left.");
    expect(quote({ picked: true }, { count: 10, alreadyOwned: 2, freeLeads: 0, credits: 30, balance: 10, freeLeft: 0 }))
      .toBe("12 picked leads: 30 credits (≈ $15) (2 already yours). You have 10 credits, so you need 20 more.");
    expect(quote({ picked: false }, { count: 5000, alreadyOwned: 0, freeLeads: 0, credits: 5000, balance: 9000, freeLeft: 0, capped: true }))
      .toMatch(/^The first 5,000 plumbers in Tampa, FL: /);
    // The mix of standard leads and ones with a Google rating (the free ones cover the rated first).
    expect(quote({ picked: false }, { count: 12, free: 10, google: 2, alreadyOwned: 0, freeLeads: 1, credits: 13, balance: 20, freeLeft: 1 }))
      .toBe("12 plumbers in Tampa, FL: 1 free this month + 13 credits (≈ $6.5) (10 standard × 1 + 1 with Google rating × 3). You'll have 7 credits left.");
  });
});

describe("store page sections", () => {
  it("links the logo to the website and signs out to it", () => {
    expect(html).toContain('<a class="homelink" href="/"');
    expect(script).toContain('location.href = "/"');
    expect(html).toContain("<span>Local leads</span>");
  });

  it("uses the shared theme: tokens, fonts, dark mode switch always in the header", () => {
    expect(html).toContain("--brand: #4f46e5;");
    expect(html).toContain('data-theme-toggle');
    expect(html).toContain('prefers-color-scheme: dark');
    // The theme button sits outside the signed-in part of the header.
    expect(html.indexOf("data-theme-toggle")).toBeGreaterThan(html.indexOf('id="hdrAcct"'));
    expect(html).toMatch(/<div class="hdr-right">/);
    expect(script).toContain('"themechange"');
    expect(html).not.toMatch(/outline: none/);
  });

  it("has the simple header: Search, Your lists, a balance pill with its menu, and an Account menu", () => {
    expect(html).toContain('data-tab="find">Search<');
    expect(html).toContain('data-tab="lists">Your lists<');
    for (const id of ["hdrBal", "balMenu", "balBuy", "balHist", "acctBtn", "acctMenu", "teamBtn", "pwBtn", "helpBtn", "logoutBtn"]) expect(html).toContain('id="' + id + '"');
    expect(script).toContain(`esc(plural(me.account.credits, "credit")) + (left > 0 ? '<span class="balfree"> · ' + esc(num(left)) + " free</span>" : "")`);
  });

  it("has one search row (what + where) with one-tap filters and More filters", () => {
    for (const id of ["searchForm", "qWhat", "whatList", "qWhere", "whereList", "qRadius", "moreBtn", "moreDlg", "mHideOwned", "startCard", "examples"]) expect(html).toContain('id="' + id + '"');
    for (const chip of ["phone", "email", "owner", "noweb", "weak", "google"]) expect(html).toContain('data-chip="' + chip + '"');
    expect(html).toMatch(/role="combobox"[^>]*aria-controls="whatList"/);
    expect(html).toMatch(/id="mHideOwned" checked/); // hiding leads you already have is the default
    expect(script).toContain('p.set("owned", F.hideOwned ? "no" : "all")');
    expect(script).toContain('"/api/examples"');
    expect(html).toContain("Contact details show once you get them");
  });

  it("shows the free allowance and the value of a credit", () => {
    expect(html).toContain('id="crFree"');
    expect(html).toContain('data-credit-price="0.5"');
    expect(script).toContain(" free this month");
    expect(script).toContain("free leads every month, ");
    expect(script).toContain("Welcome! You have ");
    expect(script).toContain("1 credit = ");
    expect(script).toContain('"Credits for " + company');
  });

  it("never leaves a buyer stuck: buy credits, get what you can afford, forgot password, help", () => {
    for (const id of ["balBuy", "crMore", "buyMore", "forgotBtn", "helpBtn", "buyPart"]) expect(html).toContain('id="' + id + '"');
    expect(html).toContain("Forgot your password?");
    expect(script).toContain('href="/contact"');
    expect(script).toContain('" you can afford (cheapest first)"');
  });

  it("guards purchases: expected price, re-quote on 409, big-spend tick box, Cancel focused", () => {
    expect(script).toContain("expectedCredits: Number(job.quote.credits || 0)");
    expect(script).toContain("e.status === 409");
    expect(script).toContain("I understand this spends ");
    expect(script).toContain('$("buyCancel").focus()');
    expect(script).toContain('"Get the first " + num(MAX_BUY)');
    expect(html).toContain(">Get the leads<");
  });

  it("gets leads with one button, or picked ones, and saves a list", () => {
    for (const id of ["getBtn", "pickBtn", "resTable", "doneDlg", "doneLists"]) expect(html).toContain('id="' + id + '"');
    expect(script).toContain('"Get " + plural(S.total, "lead")');
    expect(script).toContain('"Get " + plural(n, "lead")');
    expect(html).toContain(">Pick individual leads<");
    expect(html).toContain(">List saved<");
    for (const dl of ["Download spreadsheet", "Spreadsheet (CSV)", "For cold email", "JSON"]) expect(html).toContain(">" + dl + "<");
    expect(script).toContain("{ list: lastBuy.listId }");
  });

  it("shows masked phones and yes/no for contact details until you have the lead", () => {
    expect(script).toContain("r.phoneMasked");
    expect(script).toContain("r.hasEmail ? YES : NO");
    expect(script).toContain("r.hasOwner ? YES : NO");
    expect(script).toContain("In your lists");
  });

  it("has Your lists: open, rename, download, delete (the leads stay)", () => {
    for (const id of ["view-lists", "listsBody", "view-list", "lvBody", "lvDl", "lvSearch", "lvRename", "lvDelete", "listBack"]) expect(html).toContain('id="' + id + '"');
    expect(script).toContain('"/api/lists"');
    expect(script).toContain('"/api/lists/" + encodeURIComponent(id)');
    expect(script).toContain('method: "PATCH"');
    expect(script).toContain("The leads stay yours");
    expect(script).toContain("All my leads");
  });

  it("has the map, isolated under dialogs", () => {
    for (const id of ["mapBtn", "mapCard", "leadMap", "mapDraw", "mapUse", "mapClear", "mAreaDraw"]) expect(html).toContain('id="' + id + '"');
    expect(html).toMatch(/#leadMap \{[^}]*isolation: isolate/);
    expect(script).toContain('"/api/map"');
    expect(script).toContain('p.set("area", F.area)');
  });

  it("has saved searches (with the sort) and remembers the last search", () => {
    for (const id of ["savedSel", "savedUse", "savedDel", "saveSearch", "savedQuick"]) expect(html).toContain('id="' + id + '"');
    expect(script).toContain('"/api/saved"');
    expect(script).toContain('"/api/saved/" + encodeURIComponent(id)');
    expect(script).toContain("query: fullQuery()");
    expect(script).toContain('"ls.lastFind"');
    expect(script).toContain('"#find?" + q');
  });

  it("has the team page with the temporary password in a copy dialog", () => {
    for (const id of ["view-team", "teamBody", "teamAddCard", "teamForm", "askCopy"]) expect(html).toContain('id="' + id + '"');
    expect(script).toContain("they'll choose their own after signing in");
    expect(script).toContain('"/api/team"');
    expect(script).toContain('"/api/team/" + encodeURIComponent(');
  });

  it("keeps card payments, the emailed links and the forced password change", () => {
    expect(script).toContain('"/api/checkout"');
    expect(script).toContain('"/api/payments/" + encodeURIComponent(id)');
    expect(script).toContain('get("paid")');
    expect(script).toContain('"/api/password/forgot"');
    expect(script).toContain('link === "reset"');
    expect(script).toContain('link === "verify"');
    expect(script).toContain('"/api/email/resend"');
    expect(html).toContain("Choose your own password to continue.");
    expect(script).toContain("mustChangePassword");
  });

  it("says Get (leads) and Buy (credits) only", () => {
    expect(html).not.toMatch(/>Buy (?!credits)/);
    expect(script).not.toMatch(/"Buy (?!credits)/);
    expect(html).not.toMatch(/Unlock/);
    expect(script).not.toMatch(/Unlock/);
  });

  it("asks new buyers to agree to the terms, hides sign-up when closed, and offers the demo", () => {
    expect(html).toContain('By creating an account you agree to the <a href="/legal/terms"');
    expect(html).toContain('data-signup="1"');
    expect(storeHtml({ name: "X", color: "#000000", supportEmail: "", signupOpen: false })).toContain('data-signup="0"');
    expect(script).toContain("Sign-ups are closed for now. <a href=\"' + ACCESS_HREF + '\">Request access</a>");
    expect(script).toContain('const ACCESS_HREF = "/contact?subject=access";');
    expect(html).toContain('<a class="btnlink ghost" href="/demo" id="demoLink">Try the demo</a>');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
  });
});

describe("demo mode", () => {
  const demoHtml = storeHtml({ name: "Lead Store", color: "#4f46e5", supportEmail: "", demo: true, turnstileSiteKey: "abc" });
  const demoScript = [...demoHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes("const $ = "))!;
  type Demo = { handle(method: string, path: string, body?: unknown): any; ownedRows(extra: Record<string, string>): any[]; addCredits(n: number): void }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const makeDemo = () => (new Function(fn("makeDemo") + "; return makeDemo;")() as () => Demo)();

  it("shows the demo banner, is noindex, and has no sign-up spam check script", () => {
    expect(demoHtml).toContain('data-demo="1"');
    expect(demoHtml).toContain("Demo: sample businesses. Nothing here is real or charged.");
    expect(demoHtml).toContain('<a class="btnlink" id="demoCta" href="/app#signup">Create a free account</a>');
    expect(demoHtml).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(demoHtml).not.toContain("challenges.cloudflare.com");
    expect(demoScript).toBe(script); // the same app, switched by data-demo
    expect(html).toMatch(/class="demobar" id="demoBar" role="note" hidden>/);
  });

  it("says Request access when sign-ups are closed", () => {
    expect(storeHtml({ name: "X", color: "#000000", supportEmail: "", demo: true, signupOpen: false }))
      .toContain('<a class="btnlink" id="demoCta" href="/contact?subject=access">Request access</a>');
  });

  it("has made-up businesses for any Florida city and category a catalog link asks for, without Google ratings", () => {
    const d = makeDemo();
    for (const [city, cat] of [["Wauchula|FL", "Roofing contractor"], ["St. Petersburg|FL", "Handyman/Handywoman/Handyperson"], ["Opa-locka|FL", "Dentist"]]) {
      const q = "/api/leads?category=" + encodeURIComponent(cat) + "&city=" + encodeURIComponent(city) + "&owned=no";
      const r = d.handle("GET", q);
      expect(r.total, city).toBeGreaterThan(0);
      expect(r).toEqual(makeDemo().handle("GET", q)); // the same every time
      expect(r.counts.google).toBe(0);
      for (const x of r.results) { expect(x.rating).toBeNull(); expect(x.city).toBe(city.split("|")[0]); expect(x.category).toBe(cat); }
    }
    expect(d.handle("GET", "/api/leads?category=Plumber&city=Austin%7CTX").total).toBe(0); // Florida only
    const names = d.handle("GET", "/api/places").cities.map((c: { value: string }) => c.value);
    expect(names).toContain("Wauchula|FL");
    expect(names.every((v: string) => v.endsWith("|FL"))).toBe(true);
    // No website (and a website that doesn't load) score 0 and sort after real low scores.
    const rows = d.handle("GET", "/api/leads?category=Plumber&city=Miami%7CFL&sort=score&dir=asc&page_size=50").results;
    const scores = rows.map((x: { score: number }) => x.score);
    const firstZero = scores.indexOf(0);
    if (firstZero >= 0) expect(scores.slice(firstZero).every((s: number) => s === 0)).toBe(true);
  });

  it("never calls the network or touches cookies in demo mode", () => {
    expect(script).toMatch(/async function api\(path, opts\) \{\s+if \(DEMO\) return demoApi\(path, opts\);/);
    expect(script).toMatch(/async function download\(format, extra, btn\) \{\s+if \(DEMO\) \{ demoDownload\(/);
    expect(script).not.toContain("document.cookie");
    for (const f of ["makeDemo", "demoDownload", "demoApi"]) expect(fn(f)).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|document\.cookie/);
    expect(script).toMatch(/if \(DEMO\) \{ location\.href = "\/"; return; \}/); // sign out: just leave
  });

  it("makes the same made-up businesses for the same search, with fictional contact details", () => {
    const a = makeDemo(), b = makeDemo();
    const q = "/api/leads?category=Plumber&city=Tampa%7CFL&owned=no&sort=score&dir=asc";
    const r1 = a.handle("GET", q), r2 = b.handle("GET", q);
    expect(r1.total).toBeGreaterThan(0);
    expect(r1).toEqual(r2);
    for (const r of r1.results) {
      expect(r.name).toMatch(/^(Sample|Example|Demo) /);
      expect(r).not.toHaveProperty("phone");
      expect(r).not.toHaveProperty("email");
      if (r.hasPhone) expect(r.phoneMasked).toBe("(813) •••-••••");
    }
  });

  it("gets leads into a list, with the same price rules as the store", () => {
    const d = makeDemo();
    const q = "/api/buy?category=Roofer&city=Orlando%7CFL&owned=no";
    const dry = d.handle("POST", q, { all: true, dryRun: true });
    expect(dry.freeLeads).toBe(Math.min(50, dry.count));
    expect(dry.name).toBe("Roofers · Orlando, FL");
    expect(() => d.handle("POST", q, { all: true, expectedCredits: dry.credits - 1 })).toThrow(/price changed/);
    const r = d.handle("POST", q, { all: true, expectedCredits: dry.credits });
    expect(r.listName).toBe("Roofers · Orlando, FL");
    expect(r.listCount).toBe(dry.count);
    const lists = d.handle("GET", "/api/lists");
    expect(lists.lists).toHaveLength(1);
    expect(lists.allCount).toBe(dry.count);
    const one = d.handle("GET", "/api/lists/" + r.listId + "?page=1");
    expect(one.list.name).toBe("Roofers · Orlando, FL");
    expect(one.results[0].email === null || one.results[0].email.endsWith(".example.com")).toBe(true);
    expect(one.results[0].phone === null || /^\+1407555010?[0-9]{1,2}$/.test(one.results[0].phone)).toBe(true);
    // Already owned: hidden by default, and a second get of them costs nothing.
    expect(d.handle("GET", "/api/leads?category=Roofer&city=Orlando%7CFL&owned=no").total).toBe(0);
    d.handle("PATCH", "/api/lists/" + r.listId, { name: "My dentists" });
    expect(d.handle("GET", "/api/lists").lists[0].name).toBe("My dentists");
    expect(d.ownedRows({ list: r.listId }).length).toBe(dry.count);
    d.handle("DELETE", "/api/lists/" + r.listId);
    expect(d.handle("GET", "/api/lists")).toEqual({ lists: [], allCount: dry.count });
  });

  it("refuses when short of credits and offers what the balance covers", () => {
    const d = makeDemo();
    const q = "/api/buy?state=FL&industry=Cleaning%20Services&owned=no";
    const dry = d.handle("POST", q, { all: true, dryRun: true });
    expect(dry.credits).toBeGreaterThan(dry.balance);
    expect(() => d.handle("POST", q, { all: true })).toThrow(/needs/);
    const part = d.handle("POST", q, { all: true, affordable: true });
    expect(part.bought).toBe(dry.coverable);
    expect(part.balance).toBeGreaterThanOrEqual(0);
  });
});

describe("store page brand values", () => {
  const evil = storeHtml({
    name: '<script>alert(1)</script>"Acme\'s',
    color: "red;}</style><script>alert(2)</script>",
    supportEmail: '"><img src=x onerror=alert(3)>',
  });

  it("escapes the brand name and support email", () => {
    expect(evil).not.toContain("<script>alert(1)");
    expect(evil).not.toContain("<img src=x");
    expect(evil).toContain("&lt;script&gt;alert(1)&lt;/script&gt;&quot;Acme&#39;s");
    expect(evil).toContain('data-support="&quot;&gt;&lt;img src=x onerror=alert(3)&gt;"');
    expect(evil.match(/<script>/g)!.length).toBe(3);
  });

  it("only accepts hex brand colors", () => {
    expect(evil).not.toContain("alert(2)");
    expect(evil).toContain("--brand: #E4572E;");
    expect(safeColor("#ABCDEF")).toBe("#ABCDEF");
    expect(safeColor("#abc")).toBe("#abc");
    expect(safeColor("blue")).toBe("#E4572E");
    expect(safeColor(undefined)).toBe("#E4572E");
  });

  it("shows only an https logo, escaped, else the name as a wordmark", () => {
    expect(safeLogo("https://cdn.example.com/logo.png")).toBe("https://cdn.example.com/logo.png");
    expect(safeLogo("http://cdn.example.com/logo.png")).toBe("");
    expect(safeLogo("javascript:alert(1)")).toBe("");
    expect(safeLogo('https://x.test/a.png" onerror="alert(1)')).not.toContain('"');
    const withLogo = storeHtml({ name: "Goes Local", color: "#E4572E", supportEmail: "", logoUrl: "https://cdn.example.com/logo.png" });
    expect(withLogo).toContain('<img class="logoimg" src="https://cdn.example.com/logo.png" alt="Goes Local">');
    expect(storeHtml({ name: "Goes Local", color: "#E4572E", supportEmail: "" })).toContain('class="wordmark"');
    expect(storeHtml({ name: "X", color: "#0f766e", supportEmail: "" })).toContain("--brand: #0f766e;");
  });

  it("falls back to a default name", () => {
    expect(storeHtml({ name: "  ", color: "", supportEmail: "" })).toContain("<title>Lead Store</title>");
  });
});
