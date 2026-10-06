// The public website of the lead platform (home, pricing, FAQ, legal pages, "remove my business"
// and the business catalogue under /leads). Pure render functions: data in, full HTML page out.
// Routes: src/store/site-routes.ts. Contract: docs/platform-plan.md ("URLs").
// Every dynamic value goes through esc(); the brand color only as #hex, the logo only as https.
// The one inline script (on /remove) lives inside a template literal, so it must not contain
// backslashes, backticks or dollar-brace sequences.

import { safeColor, safeLogo } from "./page";
import { FONT_LINKS, THEME_BOOT, THEME_BUTTON, THEME_SCRIPT, themeCss } from "../theme";

export interface SiteBrand {
  name: string;
  color: string;
  logoUrl?: string;
  supportEmail: string;
  /** false = sign-ups are closed: no "Start free" anywhere, people are sent to /contact instead. */
  signupOpen?: boolean;
  /** Dollars per credit (owner setting); shown as "1 credit = $0.50" when set. */
  creditPrice?: number | null;
}
export interface SiteStats { businesses: number; withPhone: number; withEmail: number; withWebsite: number; withOwner: number; states: number; categories: number }
export interface SitePrices { free: number; google: number; freePerMonth: number }
export interface SiteState { st: string; name: string; n: number }
export interface SiteCity { city: string; slug: string; n: number }
export interface SiteCategory { category: string; slug: string; n: number }
export interface SiteCatalogPage {
  st: string; stateName: string; city: string; category: string; n: number;
  withPhone: number; withEmail: number; withWebsite: number; withOwner: number; avgScore: number | null;
  samples: { name: string; rating: number | null; reviews: number | null; score: number | null }[];
}

export function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
const num = (n: number) => esc(Math.round(Number(n) || 0).toLocaleString("en-US"));
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((Number(part) / whole) * 100) : 0);
const plural = (n: number, one: string, many = one + "s") => `${num(n)} ${n === 1 ? one : many}`;
const lower = (s: string) => s.toLowerCase();

type Nav = "home" | "leads" | "pricing" | "faq" | "other";

interface Shell {
  title: string;
  description: string;
  nav?: Nav;
  body: string;
  script?: string;
}

/** The support address, only when it looks like a plain email (else pages say "contact us"). */
function supportOf(b: SiteBrand): string {
  const s = String(b?.supportEmail ?? "").trim();
  return /^[^\s@<>"'()]+@[^\s@<>"'()]+\.[a-z]{2,}$/i.test(s) ? s : "";
}

function brandName(b: SiteBrand): string {
  return String(b?.name ?? "").trim() || "Lead Store";
}

const signupOpen = (b: SiteBrand) => b?.signupOpen !== false;
const CLOSED_TEXT = "Sign-ups are currently closed — contact us";

/** The main call to action: "Start free…" while sign-ups are open, else a link to the contact page. */
function startBtn(b: SiteBrand, label: string, cls = "btn"): string {
  return signupOpen(b) ? `<a class="${cls}" href="/app#signup">${label}</a>` : `<a class="${cls}" href="/contact">${esc(CLOSED_TEXT)}</a>`;
}

/** The no-login demo (works whether or not sign-ups are open). */
function demoBtn(cls = "btn ghost"): string {
  return `<a class="${cls}" href="/demo">Try the demo</a>`;
}

/** Dollars per credit when the owner set it (else null). */
function creditPrice(b: SiteBrand): number | null {
  const n = b?.creditPrice;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}
const dollars = (n: number) => esc(n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }));
/** " (about $1.50)" for a price in credits, when the credit price is known. */
function inDollars(b: SiteBrand, credits: number): string {
  const p = creditPrice(b);
  return p == null ? "" : ` (about ${dollars(p * credits)})`;
}

/** " 1 credit = $0.50." when the credit price is set. */
function creditLine(b: SiteBrand): string {
  const p = creditPrice(b);
  return p == null ? "" : ` 1 credit = ${dollars(p)}.`;
}

/** Online score colours, the same as the app: under 40 weak (red), 40-59 amber, 60+ green. */
export function scoreClass(score: number | null | undefined): "bad" | "warn" | "ok" | "none" {
  if (score == null || !Number.isFinite(Number(score))) return "none";
  const n = Number(score);
  return n < 40 ? "bad" : n < 60 ? "warn" : "ok";
}

const CSS = `
  * { box-sizing: border-box; }
  html, body { overflow-x: hidden; }
  body { margin: 0; font: 16px/1.6 var(--sans); background: var(--bg); color: var(--text); -webkit-font-smoothing: antialiased; }
  a { color: var(--accent); }
  a:focus-visible, button:focus-visible, summary:focus-visible, input:focus-visible, textarea:focus-visible { outline: 3px solid var(--accent-line); outline-offset: 2px; }
  .skip { position: absolute; left: -9999px; top: 8px; background: var(--panel); padding: 8px 14px; border-radius: 8px; z-index: 50; }
  .skip:focus { left: 8px; }
  .wrap { max-width: 1140px; margin: 0 auto; padding: 0 20px; }
  h1, h2, h3 { font-family: var(--serif); color: var(--head); font-weight: 600; letter-spacing: -.01em; line-height: 1.15; margin: 0 0 12px; }
  h1 { font-size: clamp(32px, 5.4vw, 56px); }
  h2 { font-size: clamp(26px, 3.6vw, 38px); }
  h3 { font-size: 20px; }
  p { margin: 0 0 14px; }
  .muted { color: var(--muted); }
  .lead { font-size: clamp(17px, 2vw, 20px); color: var(--muted); max-width: 640px; }
  .eyebrow { font-size: 12px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--accent); margin-bottom: 10px; display: block; }

  /* Header */
  .site-header { position: sticky; top: 0; z-index: 30; background: color-mix(in srgb, var(--bg) 94%, transparent); backdrop-filter: saturate(1.4) blur(10px); border-bottom: 1px solid var(--line); }
  .hdr { display: flex; align-items: center; gap: 12px 20px; padding-top: 12px; padding-bottom: 12px; flex-wrap: wrap; }
  .brand { display: flex; align-items: center; gap: 10px; text-decoration: none; min-width: 0; }
  .logoimg { height: 36px; width: auto; display: block; }
  .wordmark { font-family: var(--serif); font-weight: 700; font-size: 21px; color: var(--head); line-height: 1.05; }
  .wordmark span { display: block; font-family: var(--sans); font-size: 9px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--accent); }
  .mainnav { display: flex; align-items: center; gap: 4px; margin-left: auto; flex-wrap: wrap; }
  .mainnav a { color: var(--text); text-decoration: none; font-weight: 500; padding: 8px 12px; border-radius: 999px; white-space: nowrap; font-size: 15px; }
  .mainnav a:hover { background: var(--chip); }
  .mainnav a[aria-current="page"] { color: var(--accent); }
  .mainnav a.btn { color: var(--on-accent); margin-left: 6px; }
  .mainnav .theme-btn { margin-left: 6px; }
  .mainnav a.btn:hover { background: var(--accent); filter: brightness(1.06); }
  .mainnav .narrow { display: none; }
  @media (max-width: 720px) {
    .site-header { position: static; }
    .mainnav .wide { display: none; }
  .mainnav .narrow { display: inline; }
    .hdr { gap: 6px; padding-bottom: 8px; }
    .mainnav { margin-left: 0; width: 100%; justify-content: space-between; gap: 0; flex-wrap: nowrap; overflow-x: auto; }
    .mainnav a { padding: 6px 6px; font-size: 14px; }
    .mainnav a.btn { margin-left: 2px; padding: 7px 12px; }
  }

  /* Buttons */
  .btn { display: inline-block; padding: 12px 24px; border-radius: 999px; border: 1px solid var(--accent); background: var(--accent); color: var(--on-accent); font-weight: 600; text-decoration: none; text-align: center; box-shadow: 0 1px 2px rgba(15, 23, 42, .08); }
  .btn:hover { filter: brightness(1.06); }
  .btn.ghost { background: transparent; color: var(--head); border-color: var(--line-strong); }
  .btn.ghost:hover { border-color: var(--accent); color: var(--accent); filter: none; }
  .btn.small { padding: 8px 16px; font-size: 14px; }
  .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 22px; }

  /* Sections */
  section { padding: 56px 0; }
  section.tight { padding: 36px 0; }
  section.alt { background: var(--panel-2); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
  .sec-head { max-width: 720px; margin-bottom: 28px; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 22px; box-shadow: var(--shadow); min-width: 0; }
  .grid { display: grid; gap: 16px; }
  .g2 { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
  .g3 { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
  .g4 { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }

  /* Hero */
  .hero { padding: 64px 0 48px; }
  .hero-grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, .85fr); gap: 40px; align-items: center; }
  @media (max-width: 860px) { .hero-grid { grid-template-columns: minmax(0, 1fr); } .hero { padding-top: 40px; } }
  .hero h1 em { font-style: normal; color: var(--accent); }
  .sample { position: relative; }
  .sample .tag { position: absolute; top: -12px; left: 18px; background: var(--invert-bg); color: var(--invert-text); font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; padding: 3px 10px; border-radius: 999px; }
  .sample h3 { margin: 6px 0 2px; }
  .kv { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 14px; margin: 14px 0; font-size: 14px; }
  .kv dt { color: var(--muted); } .kv dd { margin: 0; font-weight: 500; overflow-wrap: anywhere; }
  .score { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 12px; background: var(--bad-soft); }
  .score b { font-family: var(--serif); font-size: 30px; color: var(--bad); line-height: 1; }
  .sc { display: inline-block; padding: 0 8px; border-radius: 99px; font-size: 12px; font-weight: 600; background: var(--chip); color: var(--muted); }
  .sc.bad { background: var(--bad-soft); color: var(--bad); } .sc.warn { background: var(--warn-soft); color: var(--warn); } .sc.ok { background: var(--ok-soft); color: var(--ok); }
  .closed-note { font-size: 14px; color: var(--muted); }
  .fix { margin: 12px 0 0; padding-left: 20px; font-size: 14px; }
  .fix li { margin: 3px 0; }

  /* Stats */
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
  .stat { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px 18px; box-shadow: var(--shadow); }
  .stat b { display: block; font-family: var(--serif); font-size: 30px; color: var(--head); line-height: 1.1; }
  .stat span { font-size: 14px; color: var(--muted); }

  /* Steps and features */
  .step .n { display: inline-flex; width: 34px; height: 34px; border-radius: 50%; align-items: center; justify-content: center; background: var(--accent-soft); color: var(--accent); font-weight: 700; margin-bottom: 10px; }
  .feature h3 { font-size: 18px; margin-bottom: 6px; }
  .feature p { margin: 0; color: var(--muted); font-size: 15px; }
  .checks { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
  .checks li { padding-left: 28px; position: relative; }
  .checks li::before { content: ""; position: absolute; left: 4px; top: 8px; width: 12px; height: 7px; border-left: 2.5px solid var(--ok); border-bottom: 2.5px solid var(--ok); transform: rotate(-45deg); }

  /* Links grid */
  .linkgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px; list-style: none; padding: 0; margin: 0; }
  .linkgrid a { display: flex; justify-content: space-between; gap: 10px; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 11px 14px; color: var(--text); text-decoration: none; font-weight: 500; min-width: 0; }
  .linkgrid a span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .linkgrid a:hover { border-color: var(--accent-line); color: var(--accent); }
  .linkgrid .n { color: var(--muted); font-weight: 400; font-variant-numeric: tabular-nums; flex-shrink: 0; }

  /* Pricing */
  .price b { display: block; font-family: var(--serif); font-size: 40px; color: var(--head); line-height: 1.1; margin: 8px 0 2px; }
  .price.hl { border: 2px solid var(--accent); }
  .note { background: var(--warn-soft); color: var(--warn); border-radius: 12px; padding: 12px 16px; font-weight: 500; }

  /* FAQ */
  details.q { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 0 18px; margin-bottom: 10px; }
  details.q summary { cursor: pointer; font-weight: 600; padding: 14px 0; color: var(--head); list-style-position: outside; }
  details.q p { color: var(--muted); }

  /* Catalog */
  .crumbs { font-size: 14px; color: var(--muted); margin-bottom: 14px; }
  .crumbs ol { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 4px; }
  .crumbs li + li::before { content: "/"; margin-right: 4px; color: var(--line-strong); }
  .crumbs a { color: var(--muted); }
  .samples { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px; }
  .samples li { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; min-width: 0; }
  .samples b { display: block; overflow-wrap: anywhere; color: var(--head); }
  .samples span { font-size: 13px; color: var(--muted); }

  /* Forms */
  form.stack { display: grid; gap: 14px; max-width: 640px; }
  .row2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
  label.field { display: flex; flex-direction: column; gap: 4px; font-size: 14px; font-weight: 500; color: var(--head); }
  label.field input, label.field textarea { font: inherit; padding: 10px 12px; border: 1px solid var(--line-strong); border-radius: 10px; background: var(--panel); color: var(--text); width: 100%; }
  label.field textarea { min-height: 110px; resize: vertical; }
  form button { font: inherit; padding: 12px 24px; border-radius: 999px; border: 1px solid var(--accent); background: var(--accent); color: var(--on-accent); font-weight: 600; cursor: pointer; justify-self: start; }
  form button:disabled { opacity: .6; cursor: default; }
  .msg { font-weight: 500; } .msg.ok { color: var(--ok); } .msg.bad { color: var(--bad); }

  /* Legal / prose */
  .prose { max-width: 760px; }
  .prose h2 { font-size: 24px; margin-top: 30px; }
  .prose ul { padding-left: 22px; }
  .draft { background: var(--warn-soft); color: var(--warn); border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent); border-radius: 12px; padding: 12px 16px; font-weight: 600; margin-bottom: 22px; }

  /* CTA band + footer */
  .cta-band { background: var(--invert-bg); color: var(--invert-text); border-radius: 20px; padding: 40px 28px; text-align: center; }
  .cta-band h2 { color: var(--invert-text); }
  .cta-band p { color: color-mix(in srgb, var(--invert-text) 78%, var(--invert-bg)); }
  .cta-band .actions { justify-content: center; }
  .cta-band .btn.ghost { color: var(--invert-text); border-color: color-mix(in srgb, var(--invert-text) 40%, transparent); }
  .site-footer { border-top: 1px solid var(--line); padding: 36px 0 44px; margin-top: 40px; font-size: 14px; color: var(--muted); }
  .foot { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 20px; }
  .foot h2 { font-family: var(--sans); font-size: 12px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--head); margin-bottom: 10px; }
  .foot ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 6px; }
  .foot a { color: var(--muted); text-decoration: none; }
  .foot a:hover { color: var(--accent); text-decoration: underline; }
  .copy { margin-top: 24px; }
`;

function shell(b: SiteBrand, s: Shell): string {
  const name = esc(brandName(b));
  const color = safeColor(b?.color);
  const logo = safeLogo(b?.logoUrl);
  const support = supportOf(b);
  const cur = (k: Nav) => (s.nav === k ? ' aria-current="page"' : "");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(s.title)}</title>
<meta name="description" content="${esc(s.description)}">
<meta property="og:title" content="${esc(s.title)}">
<meta property="og:description" content="${esc(s.description)}">
<meta name="theme-color" content="#FBF5EA">
${FONT_LINKS}
${THEME_BOOT}
<style>${themeCss(color)}${CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap hdr">
    <a class="brand" href="/" aria-label="${name} home">${logo ? `<img class="logoimg" src="${esc(logo)}" alt="${name}">` : `<span class="wordmark">${name}<span>Local leads</span></span>`}</a>
    <nav class="mainnav" aria-label="Main">
      <a href="/leads"${cur("leads")}>Leads<span class="wide"> catalog</span></a>
      <a href="/pricing"${cur("pricing")}>Pricing</a>
      <a href="/faq"${cur("faq")}>FAQ</a>
      <a href="/demo"><span class="wide">Try the demo</span><span class="narrow">Demo</span></a>
      <a href="/app">Sign in</a>
      ${signupOpen(b) ? `<a class="btn small" href="/app#signup">Start free</a>` : `<a class="btn small" href="/contact">Contact us</a>`}
      ${THEME_BUTTON}
    </nav>
  </div>
</header>
<main id="main">
${s.body}
</main>
<footer class="site-footer">
  <div class="wrap">
    <div class="foot">
      <div>
        <h2>${name}</h2>
        <p>Lists of local businesses with phone, email, owner and a score for how well they show up online.</p>
      </div>
      <nav aria-label="Product">
        <h2>Product</h2>
        <ul><li><a href="/leads">Leads catalog</a></li><li><a href="/pricing">Pricing</a></li><li><a href="/faq">FAQ</a></li><li><a href="/app">Sign in</a></li>${signupOpen(b) ? `<li><a href="/app#signup">Start free</a></li>` : ""}</ul>
      </nav>
      <nav aria-label="Legal">
        <h2>Legal</h2>
        <ul><li><a href="/legal/terms">Terms of service</a></li><li><a href="/legal/privacy">Privacy policy</a></li><li><a href="/legal/do-not-sell">Do not sell my information</a></li><li><a href="/remove">Remove my business</a></li></ul>
      </nav>
      <div>
        <h2>Support</h2>
        <ul><li><a href="/contact">Contact us</a></li>${support ? `<li><a href="mailto:${esc(support)}">${esc(support)}</a></li>` : ""}</ul>
      </div>
    </div>
    <p class="copy">&copy; ${new Date().getUTCFullYear()} ${name}. Business information comes from public sources.</p>
  </div>
</footer>
${s.script ? `<script>${s.script}</script>` : ""}
${THEME_SCRIPT}
</body>
</html>`;
}

function ctaBand(b: SiteBrand, prices: SitePrices | null, heading = "Try it on your own town"): string {
  const free = prices && prices.freePerMonth > 0 ? `Start free — ${num(prices.freePerMonth)} leads a month` : "Start free";
  return `<section class="tight"><div class="wrap"><div class="cta-band">
  <h2>${esc(heading)}</h2>
  <p>Search any city and trade, see the counts before you spend anything, and unlock only the leads you want.</p>
  <div class="actions">${startBtn(b, free)}${demoBtn()}<a class="btn ghost" href="/leads">Browse the catalog</a></div>
</div></div></section>`;
}

function credits(n: number): string {
  return plural(n, "credit");
}

// --- Home ----------------------------------------------------------------------------------

const FEATURES: [string, string][] = [
  ["Phone number", "The main business line, ready for a call list or a dialer."],
  ["Email", "Business emails found on their website and public listings, checked for domains that can't receive mail."],
  ["Owner name", "The owner or manager when it's public, so your first line isn't \"Dear business owner\"."],
  ["Website", "Their address, or a clear flag when they have no website at all (or only a social page)."],
  ["Online score", "0 to 100 for how well they show up online. Under 40 means the most to fix: more work you can sell them."],
  ["What to fix", "Plain-English notes: no booking, no contact form, slow on phones, no tracking. Your pitch, written."],
  ["Rating and reviews", "Google rating and review count on Premium (Google) leads, and how they compare to the busiest competitor in town."],
  ["Category and area", "Trade, city, state and ZIP, so you can build lists that match what you actually sell."],
];

export function homePage(b: SiteBrand, stats: SiteStats | null, states: SiteState[], prices: SitePrices): string {
  const name = brandName(b);
  const s = stats && stats.businesses > 0 ? stats : null;
  const statsHtml = s
    ? `<section class="tight" aria-labelledby="stats-h"><div class="wrap">
  <h2 id="stats-h" class="eyebrow" style="font-family:var(--sans)">In the database right now</h2>
  <div class="stats">
    <div class="stat"><b>${num(s.businesses)}</b><span>open local businesses</span></div>
    <div class="stat"><b>${pct(s.withPhone, s.businesses)}%</b><span>have a phone number</span></div>
    <div class="stat"><b>${pct(s.withEmail, s.businesses)}%</b><span>have an email</span></div>
    <div class="stat"><b>${pct(s.withWebsite, s.businesses)}%</b><span>have a website</span></div>
    <div class="stat"><b>${pct(s.withOwner, s.businesses)}%</b><span>have an owner name</span></div>
  </div>
  <p class="muted" style="margin-top:12px">Across ${plural(s.states, "state")} and ${plural(s.categories, "business category", "business categories")}. Closed businesses and anyone who asked not to be contacted are left out.</p>
</div></section>`
    : "";
  const top = states.slice(0, 6);
  const statesHtml = top.length
    ? `<section aria-labelledby="where-h"><div class="wrap">
  <div class="sec-head"><span class="eyebrow">Leads catalog</span><h2 id="where-h">Browse by state, city and trade</h2>
  <p class="muted">Every city and category has its own page with live counts. No account needed to look.</p></div>
  <ul class="linkgrid">${top.map((x) => `<li><a href="/leads/${esc(lower(x.st))}"><span>${esc(x.name)}</span><span class="n">${num(x.n)}</span></a></li>`).join("")}</ul>
  <p style="margin-top:16px"><a href="/leads">See every state</a></p>
</div></section>`
    : "";
  const body = `
<section class="hero"><div class="wrap hero-grid">
  <div>
    <span class="eyebrow">Local business leads for agencies</span>
    <h1>Find local businesses that <em>need what you sell</em></h1>
    <p class="lead">Phone, email, owner name and website for local businesses, plus a score for how well each one shows up online and a short list of what to fix. Built for agencies that sell websites, SEO and ads.</p>
    <div class="actions">
      ${startBtn(b, prices.freePerMonth > 0 ? `Start free — ${num(prices.freePerMonth)} leads a month` : "Create a free account")}
      ${demoBtn()}
      <a class="btn ghost" href="/leads">Browse the catalog</a>
    </div>
    <p class="muted" style="margin-top:14px;font-size:14px">${signupOpen(b) ? "No card needed. See how many leads match before you spend a thing." : `Already have an account? <a href="/app">Sign in</a>.`}</p>
  </div>
  <div class="sample" aria-label="Example lead">
    <span class="tag">Example lead</span>
    <div class="card">
      <h3>Harbor Street Plumbing</h3>
      <div class="muted" style="font-size:14px">Plumber · Tampa, FL</div>
      <dl class="kv">
        <dt>Phone</dt><dd>(813) 555-0142</dd>
        <dt>Email</dt><dd>office@harborstreet.example</dd>
        <dt>Owner</dt><dd>Dana Ruiz</dd>
        <dt>Website</dt><dd>harborstreet.example</dd>
      </dl>
      <div class="score"><b>34</b><span><strong>Online score</strong><br><span class="muted" style="font-size:13px">Weak (under 40): the most to fix</span></span></div>
      <ul class="fix"><li>Site isn't set up for phones</li><li>No online booking or contact form</li><li>No ad tracking installed</li><li>41 reviews vs 380 for the busiest plumber in town</li></ul>
    </div>
  </div>
</div></section>
${statsHtml}
<section class="alt" aria-labelledby="how-h"><div class="wrap">
  <div class="sec-head"><span class="eyebrow">How it works</span><h2 id="how-h">From a town and a trade to a call list in minutes</h2></div>
  <div class="grid g3">
    <div class="card step"><span class="n" aria-hidden="true">1</span><h3>Search</h3><p class="muted">Pick states, cities or a spot on the map, then the trades you sell to. Filter by score, rating, reviews, or "no website".</p></div>
    <div class="card step"><span class="n" aria-hidden="true">2</span><h3>See the counts free</h3><p class="muted">Before you pay, see how many match and how many have a phone, an email, an owner name and a website.</p></div>
    <div class="card step"><span class="n" aria-hidden="true">3</span><h3>Unlock and download</h3><p class="muted">Unlock the leads you want, then download a simple spreadsheet or a cold-email-ready file with an opening line written for each business from what to fix.</p></div>
  </div>
</div></section>
<section aria-labelledby="what-h"><div class="wrap">
  <div class="sec-head"><span class="eyebrow">What's in every lead</span><h2 id="what-h">Everything you need for the first call</h2></div>
  <div class="grid g4">${FEATURES.map(([h, p]) => `<div class="card feature"><h3>${esc(h)}</h3><p>${esc(p)}</p></div>`).join("")}</div>
</div></section>
<section class="alt" aria-labelledby="why-h"><div class="wrap">
  <div class="grid g2" style="align-items:center;gap:32px">
    <div>
      <span class="eyebrow">Why it's different</span>
      <h2 id="why-h">We check every website and score it</h2>
      <p class="muted">Most lead lists stop at a name and a phone number. ${esc(name)} visits each business's website and looks at the things your clients pay you to fix, then turns it into a score and a short list you can read out on the call.</p>
      <p class="muted">Sort by the weakest score and you're talking to the businesses that need you most.</p>
    </div>
    <div class="card">
      <h3>What we look at</h3>
      <ul class="checks">
        <li>Does the site load, and is it secure (https)?</li>
        <li>Does it work on a phone?</li>
        <li>How fast is it?</li>
        <li>Can customers book online or send a message?</li>
        <li>Is there ad tracking (Google tag, Meta pixel), or signs they already run ads?</li>
        <li>No website at all, or just a Facebook page?</li>
        <li>How their reviews compare to the top competitor nearby</li>
      </ul>
    </div>
  </div>
</div></section>
${statesHtml}
<section class="alt" aria-labelledby="price-h"><div class="wrap">
  <div class="sec-head"><span class="eyebrow">Pricing</span><h2 id="price-h">Pay per lead.${signupOpen(b) ? " Start free." : ""}</h2>
  <p class="muted">No subscription. Your first ${plural(prices.freePerMonth, "lead")} every month are free, then each lead costs a few credits.${creditLine(b)}</p></div>
  <div class="grid g3">
    <div class="card price"><h3>Free every month</h3><b>${num(prices.freePerMonth)}</b><span class="muted">leads, any type</span></div>
    <div class="card price"><h3>Standard lead</h3><b>${num(prices.free)}</b><span class="muted">${prices.free === 1 ? "credit" : "credits"} per lead${inDollars(b, prices.free)}</span></div>
    <div class="card price"><h3>Premium (Google) lead</h3><b>${num(prices.google)}</b><span class="muted">${prices.google === 1 ? "credit" : "credits"} per lead${inDollars(b, prices.google)}, with Google rating and reviews</span></div>
  </div>
  <p style="margin-top:16px"><a href="/pricing">See full pricing</a></p>
</div></section>
<section aria-labelledby="faq-h"><div class="wrap">
  <div class="sec-head"><span class="eyebrow">FAQ</span><h2 id="faq-h">Common questions</h2></div>
  ${faqItems(b, prices).slice(0, 4).map(faqHtml).join("")}
  <p style="margin-top:16px"><a href="/faq">Read all questions</a></p>
</div></section>
${ctaBand(b, prices)}`;
  return shell(b, {
    title: `${name} — Local business leads with phone, email, owner and website score`,
    description: `Find local businesses that need what you sell. Phone, email, owner name, website and an online score for every lead. ${prices.freePerMonth} free leads a month.`,
    nav: "home",
    body,
  });
}

// --- Pricing ---------------------------------------------------------------------------------

function buyLine(b: SiteBrand): string {
  const support = supportOf(b);
  return support
    ? `Buying credits by card is coming soon. To buy credits now, email <a href="mailto:${esc(support)}">${esc(support)}</a>.`
    : `Buying credits by card is coming soon. To buy credits now, <a href="/contact">contact us</a>.`;
}

export function pricingPage(b: SiteBrand, prices: SitePrices): string {
  const name = brandName(b);
  const cp = creditPrice(b);
  const qs: [string, string][] = [
    ["What is a credit?", `Credits are how you pay for leads.${cp != null ? ` One credit costs ${dollars(cp)}.` : ""} A Standard lead costs ${credits(prices.free)}${inDollars(b, prices.free)} and a Premium (Google) lead costs ${credits(prices.google)}${inDollars(b, prices.google)}.`],
    ["How do I get more credits?", buyLine(b)],
    ["How do the free leads work?", `The first ${plural(prices.freePerMonth, "lead")} you unlock each calendar month are free, Standard or Premium (Google). The count resets on the 1st (UTC). Unused free leads don't carry over.`],
    ["Do I pay again for a lead I already have?", "No. Leads you've unlocked stay in your account and you can download them again any time at no cost."],
    ["Do credits expire?", "No. Credits stay in your account until you use them."],
    ["Is there a subscription?", "No. There's nothing to cancel. You only pay for the leads you unlock."],
  ];
  const body = `
<section class="hero"><div class="wrap">
  <div class="sec-head"><span class="eyebrow">Pricing</span><h1>Simple, pay-as-you-go pricing</h1>
  <p class="lead">See how many leads match for free. Pay only for the ones you unlock. No subscription, no contract.${creditLine(b)}</p></div>
  <div class="grid g3">
    <div class="card price hl">
      <h2 style="font-size:22px">Free every month</h2>
      <b>${num(prices.freePerMonth)}</b><p class="muted">leads a month, Standard or Premium (Google)</p>
      <ul class="checks"><li>Full search with live counts</li><li>Phone, email, owner, website</li><li>Online score and what to fix</li></ul>
      <div class="actions">${startBtn(b, "Start free")}${demoBtn()}</div>
    </div>
    <div class="card price">
      <h2 style="font-size:22px">Standard lead</h2>
      <b>${num(prices.free)}</b><p class="muted">${prices.free === 1 ? "credit" : "credits"} per lead${inDollars(b, prices.free)}</p>
      <ul class="checks"><li>From open map data and public websites</li><li>Phone, email, owner and website when available</li><li>Online score and what to fix</li></ul>
    </div>
    <div class="card price">
      <h2 style="font-size:22px">Premium (Google) lead</h2>
      <b>${num(prices.google)}</b><p class="muted">${prices.google === 1 ? "credit" : "credits"} per lead${inDollars(b, prices.google)}</p>
      <ul class="checks"><li>Everything in Standard</li><li>Google rating and review count</li><li>Verified listing, photos, hours, and a fuller score</li></ul>
    </div>
  </div>
  <p class="note" style="margin-top:22px">${buyLine(b)}</p>
</div></section>
<section class="alt" aria-labelledby="cfaq-h"><div class="wrap">
  <h2 id="cfaq-h">Questions about credits</h2>
  ${qs.map(faqHtml).join("")}
</div></section>
${ctaBand(b, prices, "Start with free leads")}`;
  return shell(b, {
    title: `Pricing — ${name}`,
    description: `${prices.freePerMonth} free leads every month, then pay per lead: Standard ${prices.free} and Premium (Google) ${prices.google} credits. No subscription.`,
    nav: "pricing",
    body,
  });
}

// --- FAQ -------------------------------------------------------------------------------------

/** Answers are HTML (already escaped where they carry values). */
function faqItems(b: SiteBrand, prices: SitePrices): [string, string][] {
  const support = supportOf(b);
  const contact = support ? `email <a href="mailto:${esc(support)}">${esc(support)}</a>` : `<a href="/contact">contact us</a>`;
  return [
    ["Where does the data come from?", "From public sources: open map data, businesses' own public websites, and public business listings and registries. Premium (Google) leads add details from Google business listings, such as rating, review count and whether the listing is verified. We never sell personal consumer data."],
    ["How much does it cost?", `Your first ${plural(prices.freePerMonth, "lead")} each month are free. After that, a Standard lead is ${credits(prices.free)}${inDollars(b, prices.free)} and a Premium (Google) lead is ${credits(prices.google)}${inDollars(b, prices.google)}. See <a href="/pricing">pricing</a>.`],
    ["What's the difference between Standard and Premium (Google)?", "Standard leads come from open data and public websites: name, category, address, phone, website, emails and owner name when available, plus our website check and online score. Premium (Google) leads add Google details: rating, review count, verification, photos and opening hours, which makes the score fuller."],
    ["How fresh is the data?", "We keep collecting and re-checking businesses. Closed businesses are removed, website checks are repeated over time, and email domains that can't receive mail are marked. No list is ever perfect, which is why you see counts before you pay."],
    ["What is the online score?", "A number from 0 to 100 for how well a business shows up online, based on its website (loads, secure, works on phones, speed, booking, contact form, tracking) and, for Premium (Google) leads, its Google listing. Under 40 (red) means the most to fix, 40 to 59 (amber) some, 60 and up (green) is doing well."],
    ["Can I cancel?", "There's nothing to cancel. There's no subscription: you pay as you go, only for the leads you unlock."],
    ["What if a lead is wrong?", `If you find bad data, ${contact} with the lead's name and what's wrong and we'll make it right.`],
    ["How do you handle do-not-contact and removal requests?", `Any business can ask to be removed on the <a href="/remove">Remove my business</a> page. Once handled, it's taken out of search and future sales. Businesses on our do-not-contact list are never sold. Please follow the rules for your outreach (like CAN-SPAM and the Do Not Call registry).`],
  ];
}

function faqHtml([q, a]: [string, string]): string {
  return `<details class="q"><summary>${esc(q)}</summary><p>${a}</p></details>`;
}

export function faqPage(b: SiteBrand, prices: SitePrices): string {
  const name = brandName(b);
  const body = `
<section class="hero"><div class="wrap">
  <div class="sec-head"><span class="eyebrow">FAQ</span><h1>Frequently asked questions</h1>
  <p class="lead">How ${esc(name)} works, where the data comes from, and what you pay.</p></div>
  <div style="max-width:820px">${faqItems(b, prices).map(faqHtml).join("")}</div>
</div></section>
${ctaBand(b, prices)}`;
  return shell(b, { title: `FAQ — ${name}`, description: `Answers about ${name}: where the data comes from, how fresh it is, Standard vs Premium (Google) leads, pricing and removal requests.`, nav: "faq", body });
}

// --- Contact ---------------------------------------------------------------------------------

export function contactPage(b: SiteBrand): string {
  const name = brandName(b);
  const support = supportOf(b);
  const body = `
<section class="hero"><div class="wrap prose">
  <span class="eyebrow">Contact</span><h1>Get in touch</h1>
  ${support
    ? `<p class="lead">Questions about leads, credits or your account? Email us at <a href="mailto:${esc(support)}">${esc(support)}</a> and we'll get back to you, usually within one business day.</p>`
    : `<p class="lead">Questions about leads, credits or your account? Our support email is being set up. Please check back here soon.</p>`}
  ${signupOpen(b) ? "" : `<p class="muted">${esc(CLOSED_TEXT)} using the details above.</p>`}
  <div class="grid g2" style="margin-top:24px">
    <div class="card"><h2 style="font-size:20px">Already a customer?</h2><p class="muted">Sign in to search, unlock and download leads.</p><a class="btn small" href="/app">Sign in</a></div>
    <div class="card"><h2 style="font-size:20px">Own a listed business?</h2><p class="muted">Ask us to remove your business from our catalog.</p><a class="btn small ghost" href="/remove">Remove my business</a></div>
  </div>
</div></section>`;
  return shell(b, { title: `Contact — ${name}`, description: `Contact ${name} about leads, credits or your account.`, nav: "other", body });
}

// --- Legal -----------------------------------------------------------------------------------

export type LegalKind = "terms" | "privacy" | "do-not-sell";

export function legalPage(b: SiteBrand, kind: LegalKind): string {
  const name = esc(brandName(b));
  const support = supportOf(b);
  const reach = support ? `email <a href="mailto:${esc(support)}">${esc(support)}</a>` : `use our <a href="/contact">contact page</a>`;
  const updated = "Last updated: draft";
  let title = "", h1 = "", content = "";
  if (kind === "terms") {
    title = "Terms of service"; h1 = "Terms of service";
    content = `
<p>These terms cover your use of ${name} (the "service"): the website, the lead search app and any lists you download. By creating an account or using the service you agree to them.</p>
<h2>The service</h2>
<p>We provide information about businesses gathered from public sources, together with our own analysis such as online presence scores and suggestions. You can search for free and pay, in credits, to unlock a business's contact details.</p>
<h2>Your account</h2>
<ul><li>You must give accurate details and keep your password safe. You're responsible for what happens under your account, including your team members.</li>
<li>Accounts are for businesses, not personal or household use.</li>
<li>We may suspend accounts that break these terms.</li></ul>
<h2>Credits, free leads and payment</h2>
<ul><li>Leads are paid for with credits. Prices in credits are shown before you unlock anything.</li>
<li>A monthly allowance of free leads may be offered. It resets each calendar month and doesn't carry over.</li>
<li>Unlocked leads stay in your account. Credits are not refundable for cash except where the law requires it, but we will credit you back for leads with clearly wrong data if you tell us promptly.</li></ul>
<h2>How you may use the data</h2>
<ul><li>You get a non-exclusive licence to use unlocked leads for your own business outreach. Other customers may unlock the same businesses.</li>
<li>You may not resell, publish or share the data as a list, or use it to build a competing product.</li>
<li>You must follow the laws that apply to your outreach, including the CAN-SPAM Act, the Telephone Consumer Protection Act, the National Do Not Call Registry and state rules, and honour any request to stop contacting a business.</li>
<li>No harassment, spam, fraud, or discrimination.</li></ul>
<h2>Accuracy</h2>
<p>Business information changes all the time. We work to keep it current but provide it "as is", without a guarantee that every detail is correct or complete.</p>
<h2>Limitation of liability</h2>
<p>To the extent the law allows, we are not liable for indirect or consequential losses, and our total liability is limited to the amount you paid us in the three months before the claim.</p>
<h2>Changes</h2>
<p>We may update these terms. If the changes are significant we'll tell you by email or in the app before they apply.</p>
<h2>Contact</h2>
<p>Questions about these terms? ${reach}.</p>`;
  } else if (kind === "privacy") {
    title = "Privacy policy"; h1 = "Privacy policy";
    content = `
<p>This policy explains what information ${name} collects and how it's used. It covers two groups: customers who use the service, and businesses listed in our catalog.</p>
<h2>Customers</h2>
<ul><li><strong>What we collect:</strong> your name, company, email, a securely hashed password, your credit and purchase history, and basic technical data such as IP address for security and abuse prevention.</li>
<li><strong>Why:</strong> to run your account, provide the leads you unlock, prevent fraud, and contact you about the service.</li>
<li><strong>Cookies:</strong> we use one essential cookie to keep you signed in. We don't use advertising cookies.</li></ul>
<h2>Listed businesses</h2>
<ul><li><strong>What we list:</strong> business information from public sources, such as the business name, category, address, phone number, website, business email addresses and, where public, the owner's or manager's name as a business contact. Premium listings include public Google listing details like rating and review count.</li>
<li><strong>Our analysis:</strong> we check public business websites and create a score and suggestions about the business's online presence.</li>
<li><strong>Who sees it:</strong> our customers, who are businesses that offer marketing and web services to local businesses.</li>
<li><strong>Your choices:</strong> you can ask us to remove your business at any time on the <a href="/remove">Remove my business</a> page.</li></ul>
<h2>Sharing</h2>
<p>We don't sell customer account information. We use service providers (for example hosting and email) that process data on our behalf under contract.</p>
<h2>Keeping data</h2>
<p>We keep account data while your account is open and for a reasonable time after, as needed for legal and accounting reasons. Removed businesses are kept on a do-not-contact list so they aren't added back.</p>
<h2>Your rights</h2>
<p>Depending on where you live (for example California), you may have the right to know, correct or delete information about you, and to opt out of its sale. To use these rights, ${reach}, or see <a href="/legal/do-not-sell">Do not sell my information</a>.</p>
<h2>Security</h2>
<p>We use encryption in transit, hashed passwords and access controls. No system is perfectly secure, but we work to protect your information.</p>
<h2>Contact</h2>
<p>Privacy questions? ${reach}.</p>`;
  } else {
    title = "Do not sell my information"; h1 = "Do not sell my information";
    content = `
<p>${name} lists businesses using information from public sources and makes it available to our customers. If you own or manage a business and don't want it included, you can opt out.</p>
<h2>How to opt out</h2>
<p>Fill in the <a href="/remove">Remove my business</a> form. Tell us the business name and at least one of its phone number, website or email so we can find it. Adding your own name and email lets us confirm when it's done.</p>
<h2>What happens next</h2>
<ul><li>We review each request, usually within a few business days.</li>
<li>Once handled, the business is removed from search and from future sales, and its phone, website and email go on our do-not-contact list so it isn't added again.</li>
<li>We can't recall copies that customers already downloaded before the request, but they can no longer get it from us.</li></ul>
<h2>Individuals</h2>
<p>If you're a person rather than a business and believe we hold information about you, ${reach} and we'll look into it and delete it where appropriate.</p>
<p><a class="btn" href="/remove">Remove my business</a></p>`;
  }
  const body = `
<section class="hero"><div class="wrap prose">
  <p class="draft" role="note">Draft — to be reviewed by a lawyer before launch.</p>
  <span class="eyebrow">Legal</span><h1>${esc(h1)}</h1>
  <p class="muted">${esc(updated)}</p>
  ${content}
</div></section>`;
  return shell(b, { title: `${title} — ${brandName(b)}`, description: `${title} for ${brandName(b)}.`, nav: "other", body });
}

// --- Remove my business ----------------------------------------------------------------------

// Tiny form script: posts the fields as JSON and shows the answer. No backslashes, backticks or dollar-braces.
const REMOVE_SCRIPT = `
(function () {
  var f = document.getElementById("rmform"); var m = document.getElementById("rmmsg"); var nojs = document.getElementById("nojs");
  if (!f || !m) return;
  if (nojs) nojs.hidden = true;
  f.hidden = false;
  f.addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = f.querySelector("button"); var data = {};
    ["business", "phone", "website", "email", "name", "contactEmail", "message"].forEach(function (k) { data[k] = (f.elements[k].value || "").trim(); });
    m.className = "msg"; m.textContent = "Sending...";
    if (btn) btn.disabled = true;
    fetch("/api/remove-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (x.ok) { f.reset(); m.className = "msg ok"; m.textContent = "Thanks. We've received your request and will remove the business once we've checked it."; }
        else { m.className = "msg bad"; m.textContent = (x.j && x.j.error) || "Something went wrong. Please try again."; }
      })
      .catch(function () { m.className = "msg bad"; m.textContent = "Couldn't send. Check your connection and try again."; })
      .then(function () { if (btn) btn.disabled = false; });
  });
})();
`;

export function removePage(b: SiteBrand): string {
  const name = brandName(b);
  const support = supportOf(b);
  const body = `
<section class="hero"><div class="wrap">
  <div class="sec-head"><span class="eyebrow">Remove my business</span><h1>Remove your business from our catalog</h1>
  <p class="lead">Tell us which business it is. Once we've checked the request, it's taken out of search and future sales, and added to our do-not-contact list.</p></div>
  <div class="card" style="max-width:720px">
    <p id="nojs" class="msg bad">This form needs JavaScript. Please enable it${support ? `, or email <a href="mailto:${esc(support)}">${esc(support)}</a>` : `, or <a href="/contact">contact us</a>`}.</p>
    <form id="rmform" class="stack" hidden novalidate>
      <label class="field">Business name *<input name="business" type="text" required maxlength="160" autocomplete="organization"></label>
      <div class="row2">
        <label class="field">Business phone<input name="phone" type="tel" maxlength="40"></label>
        <label class="field">Business website<input name="website" type="text" maxlength="300" inputmode="url" placeholder="example.com"></label>
      </div>
      <label class="field">Business email<input name="email" type="email" maxlength="160"></label>
      <p class="muted" style="margin:0;font-size:14px">Add at least one of phone, website or email so we can find the business.</p>
      <div class="row2">
        <label class="field">Your name<input name="name" type="text" maxlength="120" autocomplete="name"></label>
        <label class="field">Your email<input name="contactEmail" type="email" maxlength="160" autocomplete="email"></label>
      </div>
      <label class="field">Message<textarea name="message" maxlength="1000"></textarea></label>
      <button type="submit">Send removal request</button>
      <p id="rmmsg" class="msg" role="status" aria-live="polite"></p>
    </form>
  </div>
  <p class="muted" style="margin-top:18px">More about how we handle this: <a href="/legal/do-not-sell">Do not sell my information</a>.</p>
</div></section>`;
  return shell(b, { title: `Remove my business — ${name}`, description: `Ask ${name} to remove your business from its catalog.`, nav: "other", body, script: REMOVE_SCRIPT });
}

// --- Catalog ---------------------------------------------------------------------------------

function crumbs(items: [string, string | null][]): string {
  return `<nav class="crumbs" aria-label="Breadcrumb"><ol>${items
    .map(([label, href]) => `<li>${href ? `<a href="${esc(href)}">${esc(label)}</a>` : `<span aria-current="page">${esc(label)}</span>`}</li>`)
    .join("")}</ol></nav>`;
}

function linkGrid(items: { href: string; label: string; n: number }[]): string {
  return `<ul class="linkgrid">${items.map((x) => `<li><a href="${esc(x.href)}"><span>${esc(x.label)}</span><span class="n">${num(x.n)}</span></a></li>`).join("")}</ul>`;
}

export function statesPage(b: SiteBrand, states: SiteState[]): string {
  const name = brandName(b);
  const total = states.reduce((a, x) => a + x.n, 0);
  const body = `
<section class="hero"><div class="wrap">
  ${crumbs([["Home", "/"], ["Leads catalog", null]])}
  <h1>Local business leads by state</h1>
  <p class="lead">${num(total)} open local businesses. Pick a state to see its cities, then the trades in each city.</p>
  ${states.length ? linkGrid(states.map((x) => ({ href: `/leads/${lower(x.st)}`, label: x.name, n: x.n }))) : `<p class="muted">The catalog is being built. Check back soon.</p>`}
</div></section>
${ctaBand(b, null)}`;
  return shell(b, { title: `Local business leads by state — ${name}`, description: `Browse ${total.toLocaleString("en-US")} local business leads by state, city and category.`, nav: "leads", body });
}

export function statePage(b: SiteBrand, st: string, stName: string, cities: SiteCity[]): string {
  const name = brandName(b);
  const ST = st.toUpperCase();
  const total = cities.reduce((a, x) => a + x.n, 0);
  const body = `
<section class="hero"><div class="wrap">
  ${crumbs([["Home", "/"], ["Leads catalog", "/leads"], [stName, null]])}
  <h1>Local business leads in ${esc(stName)}</h1>
  <p class="lead">${num(total)} businesses across ${plural(cities.length, "city", "cities")} in ${esc(stName)}. Pick a city to see the trades.</p>
  ${linkGrid(cities.map((x) => ({ href: `/leads/${lower(ST)}/${x.slug}`, label: x.city, n: x.n })))}
</div></section>
${ctaBand(b, null, `Find leads in ${stName}`)}`;
  return shell(b, { title: `${stName} business leads — ${name}`, description: `Local business leads in ${stName} by city: phone, email, owner name, website and online score.`, nav: "leads", body });
}

export function cityPage(b: SiteBrand, st: string, stName: string, city: string, citySlug: string, categories: SiteCategory[]): string {
  const name = brandName(b);
  const ST = st.toUpperCase();
  const total = categories.reduce((a, x) => a + x.n, 0);
  const body = `
<section class="hero"><div class="wrap">
  ${crumbs([["Home", "/"], ["Leads catalog", "/leads"], [stName, `/leads/${lower(ST)}`], [city, null]])}
  <h1>Business leads in ${esc(city)}, ${esc(ST)}</h1>
  <p class="lead">${num(total)} businesses in ${plural(categories.length, "category", "categories")}. Pick a trade to see how many have a phone, email, owner name and website.</p>
  ${linkGrid(categories.map((x) => ({ href: `/leads/${lower(ST)}/${citySlug}/${x.slug}`, label: x.category, n: x.n })))}
</div></section>
${ctaBand(b, null, `Find leads in ${city}`)}`;
  return shell(b, { title: `${city}, ${ST} business leads — ${name}`, description: `Local business leads in ${city}, ${ST} by category, with phone, email, owner name, website and online score.`, nav: "leads", body });
}

/**
 * "/app#find?state=FL&city=Tampa%7CFL&category=Plumber" (+ "&n=42", the count, so the sign-up
 * card can say "Create a free account to see the 42 plumbers in Tampa").
 */
export function appFindLink(st: string, city: string, category: string, n?: number): string {
  const ST = st.toUpperCase();
  return `/app#find?state=${encodeURIComponent(ST)}&city=${encodeURIComponent(`${city}|${ST}`)}&category=${encodeURIComponent(category)}${n != null && Number.isFinite(n) ? `&n=${Math.round(n)}` : ""}`;
}

const titleCase = (s: string) => s.replace(/(^|\s)(\p{Ll})/gu, (_m, a: string, c: string) => a + c.toUpperCase());

export function categoryPage(b: SiteBrand, p: SiteCatalogPage, citySlug: string): string {
  const name = brandName(b);
  const ST = p.st.toUpperCase();
  const cat = titleCase(p.category);
  const h1 = `${cat} in ${p.city}, ${ST}`;
  const stat = (v: number, label: string) => `<div class="stat"><b>${pct(v, p.n)}%</b><span>${esc(label)}</span></div>`;
  const body = `
<section class="hero"><div class="wrap">
  ${crumbs([["Home", "/"], ["Leads catalog", "/leads"], [p.stateName, `/leads/${lower(ST)}`], [p.city, `/leads/${lower(ST)}/${citySlug}`], [cat, null]])}
  <h1>${esc(h1)}</h1>
  <p class="lead">${num(p.n)} ${esc(lower(p.category))} ${p.n === 1 ? "business" : "businesses"} in ${esc(p.city)}, ${esc(p.stateName)}, with contact details and an online score.</p>
  <div class="stats" style="margin-top:22px">
    <div class="stat"><b>${num(p.n)}</b><span>businesses</span></div>
    ${stat(p.withPhone, "have a phone number")}
    ${stat(p.withEmail, "have an email")}
    ${stat(p.withWebsite, "have a website")}
    ${stat(p.withOwner, "have an owner name")}
    <div class="stat"><b>${p.avgScore == null ? "—" : num(p.avgScore)}</b><span>average online score (of 100)</span></div>
  </div>
  <div class="actions"><a class="btn" href="${esc(appFindLink(p.st, p.city, p.category, p.n))}">See all ${num(p.n)} in the app</a><a class="btn ghost" href="/pricing">Pricing</a></div>
  ${signupOpen(b) ? "" : `<p class="closed-note" style="margin-top:12px">${esc(CLOSED_TEXT)}: <a href="/contact">contact page</a>.</p>`}
</div></section>
${p.samples.length ? `<section class="alt" aria-labelledby="s-h"><div class="wrap">
  <h2 id="s-h">Some of the businesses</h2>
  <p class="muted">Contact details, owner names and what to fix are in the app.</p>
  <ul class="samples">${p.samples.map((x) => {
    const bits = [
      x.rating != null ? `${esc(Number(x.rating).toFixed(1))} stars` : "",
      x.reviews != null ? plural(x.reviews, "review") : "",
      x.score != null ? `<span class="sc ${scoreClass(x.score)}">online score ${num(x.score)}</span>` : "",
    ].filter(Boolean).join(" · ");
    return `<li><b>${esc(x.name)}</b>${bits ? `<span>${bits}</span>` : ""}</li>`;
  }).join("")}</ul>
</div></section>` : ""}
${ctaBand(b, null, `Get the full ${lower(cat)} list`)}`;
  return shell(b, {
    title: `${h1}: ${p.n.toLocaleString("en-US")} leads — ${name}`,
    description: `${p.n.toLocaleString("en-US")} ${lower(p.category)} businesses in ${p.city}, ${ST}. ${pct(p.withPhone, p.n)}% with phone, ${pct(p.withEmail, p.n)}% with email, ${pct(p.withWebsite, p.n)}% with a website.`,
    nav: "leads",
    body,
  });
}

export function notFoundPage(b: SiteBrand): string {
  const body = `
<section class="hero"><div class="wrap">
  <span class="eyebrow">Not found</span>
  <h1>We couldn't find that page</h1>
  <p class="lead">The place or category may have no listed businesses yet, or the link may be old.</p>
  <div class="actions"><a class="btn" href="/leads">Browse the catalog</a><a class="btn ghost" href="/">Home</a></div>
</div></section>`;
  return shell(b, { title: `Page not found — ${brandName(b)}`, description: "This page could not be found.", nav: "other", body });
}

// --- robots.txt / sitemap.xml ----------------------------------------------------------------

export function robotsTxt(publicPages: boolean, origin: string): string {
  if (!publicPages) return "User-agent: *\nDisallow: /\n";
  return `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /app\n\nSitemap: ${origin}/sitemap.xml\n`;
}

const xmlEsc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

export function sitemapXml(origin: string, paths: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths
    .map((p) => `  <url><loc>${xmlEsc(origin + p)}</loc></url>`)
    .join("\n")}\n</urlset>\n`;
}
