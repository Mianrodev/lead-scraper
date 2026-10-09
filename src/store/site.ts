// The public website of the lead platform (home, pricing, FAQ, contact, legal pages, "remove my
// business" and the business catalogue under /leads). Pure render functions: data in, full HTML page out.
// Routes: src/store/site-routes.ts. Contract: docs/platform-plan.md ("URLs").
// Every dynamic value goes through esc(); the brand color only as #hex, the logo only as https.
// The inline form script lives inside a template literal, so it must not contain backslashes,
// backticks or dollar-brace sequences.
// Words match the customer app: "Get" leads (the app's button is "Get N leads"), "Buy" credits,
// "Standard" leads and leads "With Google rating", and the online score as Weak (under 40) /
// Basic (40-59) / Good (60-79) / Strong (80+), with 0 shown as "No website" or "Site down".

import { safeColor, safeLogo } from "./page";
import { FONT_LINKS, THEME_BOOT, THEME_BUTTON, THEME_SCRIPT, themeCss } from "../theme";
import { CONTACT_MIN } from "./public";

export interface SiteBrand {
  name: string;
  color: string;
  logoUrl?: string;
  supportEmail: string;
  /** false = sign-ups are closed: the demo and "Request access" instead of "Start free". */
  signupOpen?: boolean;
  /** Dollars per credit (owner setting); shown as "1 credit = $0.50" when set. */
  creditPrice?: number | null;
  /** Credit packs on sale (owner setting), smallest first. */
  packs?: { credits: number; price: number }[];
  /** Card payments are switched on (Stripe keys set) and there is at least one pack. */
  cardPayments?: boolean;
  /** A lawyer checked the legal pages (launch checklist): no "Draft" banner. */
  legalReviewed?: boolean;
  /** "https://leads.example.com": for canonical links and structured data. */
  origin?: string;
  /** Cloudflare Turnstile site key, when spam protection is on (contact form). */
  turnstileSiteKey?: string;
  /** false = no listed state has leads with a Google rating yet: the pages call them "coming soon". */
  googleLeads?: boolean;
}
export interface SiteStats { businesses: number; withPhone: number; withEmail: number; withWebsite: number; withOwner: number; states: number; categories: number }
export interface SitePrices { free: number; google: number; freePerMonth: number }
export interface SiteState { st: string; name: string; n: number }
export interface SiteCity { city: string; slug: string; n: number }
export interface SiteCategory { category: string; slug: string; n: number }
export interface SiteCatalogPage {
  st: string; stateName: string; city: string; category: string; n: number;
  withPhone: number; withEmail: number; withWebsite: number; withOwner: number; avgScore: number | null;
  samples: { name: string; rating: number | null; reviews: number | null; score: number | null; website?: boolean }[];
}

/** The date the legal pages' text last changed (shown as "Last updated"). */
export const LEGAL_UPDATED = "October 9, 2026";
/** The state page shows this many cities, then "Show all N cities". */
const TOP_CITIES = 30;
/** States with fewer businesses are "coming soon" (same as STATE_MIN in public.ts). */
const STATE_LISTED = 500;

export function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
const num = (n: number) => esc(Math.round(Number(n) || 0).toLocaleString("en-US"));
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((Number(part) / whole) * 100) : 0);
const plural = (n: number, one: string, many = one + "s") => `${num(n)} ${n === 1 ? one : many}`;
const lower = (s: string) => s.toLowerCase();

type Nav = "home" | "leads" | "pricing" | "faq" | "contact" | "other";

interface Shell {
  title: string;
  description: string;
  nav?: Nav;
  /** The page's own path ("/pricing"), for the canonical link. */
  path?: string;
  body: string;
  script?: string;
  /** Extra tags for <head> (e.g. the Turnstile script). */
  head?: string;
  /** Structured data (JSON-LD) objects. */
  jsonLd?: object[];
}

/** The support address, only when it looks like a plain email. */
function supportOf(b: SiteBrand): string {
  const s = String(b?.supportEmail ?? "").trim();
  return /^[^\s@<>"'()]+@[^\s@<>"'()]+\.[a-z]{2,}$/i.test(s) ? s : "";
}

function brandName(b: SiteBrand): string {
  return String(b?.name ?? "").trim() || "Lead Store";
}

const signupOpen = (b: SiteBrand) => b?.signupOpen !== false;

/** "contact us" always links to the contact form. */
const CONTACT = `<a href="/contact">contact us</a>`;
const ACCESS_HREF = "/contact?subject=access";

/**
 * The two main buttons. Open: "Start free" + the demo. Closed: the demo first, then "Request
 * access" (the contact form with that subject).
 */
function ctaButtons(b: SiteBrand, openLabel: string): string {
  return signupOpen(b)
    ? `<a class="btn" href="/app#signup">${esc(openLabel)}</a>${demoBtn()}`
    : `${demoBtn("btn")}<a class="btn ghost" href="${ACCESS_HREF}">Request access</a>`;
}

/** The no-login demo (works whether or not sign-ups are open). */
function demoBtn(cls = "btn ghost"): string {
  return `<a class="${cls}" href="/demo">Try the demo</a>`;
}

/** "Your first 50 leads every month are free" (or, while sign-ups are closed, "when your account opens"). */
function freeSentence(b: SiteBrand, prices: SitePrices): string {
  if (prices.freePerMonth <= 0) return "";
  return signupOpen(b)
    ? `Your first ${plural(prices.freePerMonth, "lead")} every month are free.`
    : `When your account opens, your first ${plural(prices.freePerMonth, "lead")} every month are free.`;
}

/** Dollars per credit when the owner set it (else null). */
function creditPrice(b: SiteBrand): number | null {
  const n = b?.creditPrice;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}
function packsOf(b: SiteBrand): { credits: number; price: number }[] {
  return Array.isArray(b?.packs) ? b.packs.filter((p) => p && p.credits > 0 && p.price > 0) : [];
}
/** What one credit costs: the owner's setting, else the smallest pack's rate. */
function perCredit(b: SiteBrand): number | null {
  const p = creditPrice(b);
  if (p != null) return p;
  const first = packsOf(b)[0];
  return first ? first.price / first.credits : null;
}
const dollars = (n: number) => {
  const whole = Math.abs(n - Math.round(n)) < 1e-9 && n >= 1;
  return esc(n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }));
};
const cents = (n: number) => esc(n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }));
/** " (about $1.50)" for a price in credits, when what a credit costs is known. */
function inDollars(b: SiteBrand, credits: number): string {
  const p = perCredit(b);
  return p == null ? "" : ` (about ${cents(p * credits)})`;
}

/** " 1 credit = $0.50." when the credit price is set. */
function creditLine(b: SiteBrand): string {
  const p = creditPrice(b);
  return p == null ? "" : ` 1 credit = ${cents(p)}.`;
}

/** "100 credits — $50 ($0.50 each)". */
function packLabel(p: { credits: number; price: number }): string {
  return `${plural(p.credits, "credit")} — ${dollars(p.price)} (${cents(p.price / p.credits)} each)`;
}

/** How to buy credits: by card in the app, or (while card payments are off) by asking. */
function buyLine(b: SiteBrand): string {
  if (b?.cardPayments && packsOf(b).length) return `Buy credits by card in the app, under Credits. They never expire.`;
  return `Card payments are coming soon. To buy credits now, <a href="/contact?subject=credits">contact us</a>.`;
}

/**
 * Online score colours, the same as the app: under 40 weak (red), 40-59 basic (amber), 60-79 good
 * (green), 80+ strong (dark green); 0 (no website / site down) and no score are neutral.
 */
export function scoreClass(score: number | null | undefined): "bad" | "warn" | "ok" | "strong" | "none" {
  if (score == null || !Number.isFinite(Number(score)) || Number(score) <= 0) return "none";
  const n = Number(score);
  return n < 40 ? "bad" : n < 60 ? "warn" : n < 80 ? "ok" : "strong";
}
const SCORE_WORDS = { bad: "Weak", warn: "Basic", ok: "Good", strong: "Strong" } as const;

/** "Weak 34" / "Basic 55" / "Good 65" / "Strong 85", the app's words. Empty when there's no score above 0. */
export function scoreChip(score: number | null | undefined): string {
  const k = scoreClass(score);
  if (k === "none") return "";
  const n = Number(score);
  return `<span class="sc ${k}" title="Online score ${num(n)} of 100">${SCORE_WORDS[k]} ${num(n)}</span>`;
}

/** Whether the pages may offer leads with a Google rating (else "coming soon"). */
const googleOn = (b: SiteBrand) => b?.googleLeads !== false;
const SOON = `<span class="soon">Coming soon</span>`;

/**
 * Business names for reading, like the app: "JOE'S PLUMBING LLC" -> "Joe's Plumbing LLC",
 * "Acme Llc" -> "Acme LLC", "U.s. Roofing" -> "U.S. Roofing", "P&a Pools" -> "P&A Pools".
 */
export function niceName(v: string): string {
  let s = String(v ?? "").trim().replace(/\s+/g, " ");
  const caps = /[A-Z]/.test(s) && !/[a-z]/.test(s);
  if (caps) s = s.toLowerCase().replace(/(^|[ (&/-])([a-z])/g, (_m, a: string, ch: string) => a + ch.toUpperCase());
  return s.split(" ").map((w) => {
    if (/^u\.?s\.?a?\.?[,:;)]?$/i.test(w) && /\./.test(w)) return w.toUpperCase();
    if (caps && /^us[,:;)]?$/i.test(w)) return w.toUpperCase();
    if (/^[a-z]&[a-z][,:;)]?$/i.test(w)) return w.toUpperCase();
    return w.replace(/^(llc|pllc|llp|inc|usa|hvac)([.,:;)]?)$/i, (_m, a: string, b2: string) => (a.toLowerCase() === "inc" ? "Inc" : a.toUpperCase()) + b2);
  }).join(" ");
}

// --- Category names ------------------------------------------------------------------------

const CATEGORY_NAMES: Record<string, [string, string]> = {
  "handyman/handywoman/handyperson": ["Handyman", "Handymen"],
  handyman: ["Handyman", "Handymen"],
};
const isAcronym = (w: string) => /^[A-Z0-9&]{2,}$/.test(w);
function pluralWord(w: string): string {
  if (/man$/.test(w)) return w.slice(0, -3) + "men";
  if (/[^aeiou]y$/i.test(w)) return w.slice(0, -1) + "ies";
  if (/(s|x|z|ch|sh)$/i.test(w)) return w + "es";
  return w + "s";
}

/** "Plumbers", "HVAC contractors", "Handymen" (or the singular). Sentence case, acronyms kept. */
export function categoryName(raw: string, many = true): string {
  const s = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!s) return "";
  const known = CATEGORY_NAMES[s.toLowerCase()];
  if (known) return many ? known[1] : known[0];
  const words = s.split(" ");
  if (many) words[words.length - 1] = pluralWord(words[words.length - 1]);
  words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
  return words.join(" ");
}
/** The same, in the middle of a sentence: "plumbers", "HVAC contractors". */
export function categoryInline(raw: string, many = true): string {
  const s = categoryName(raw, many);
  const first = s.split(" ")[0];
  return isAcronym(first) ? s : s.charAt(0).toLowerCase() + s.slice(1);
}

const CSS = `
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body { margin: 0; font: 16px/1.6 var(--sans); background: var(--bg); color: var(--text); -webkit-font-smoothing: antialiased; overflow-x: clip; }
  a { color: var(--accent); }
  a:focus-visible, button:focus-visible, summary:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 3px solid var(--accent-line); outline-offset: 2px; }
  .skip { position: absolute; left: -9999px; top: 8px; background: var(--panel); padding: 8px 14px; border-radius: 8px; z-index: 50; }
  .skip:focus { left: 8px; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .wrap { max-width: 1140px; margin: 0 auto; padding: 0 20px; }
  h1, h2, h3 { font-family: var(--serif); color: var(--head); font-weight: 600; letter-spacing: -.01em; line-height: 1.15; margin: 0 0 12px; text-wrap: balance; }
  h1 { font-size: clamp(32px, 5.4vw, 56px); }
  h2 { font-size: clamp(26px, 3.6vw, 38px); }
  h3 { font-size: 20px; }
  p { margin: 0 0 14px; }
  .muted { color: var(--muted); }
  .lead { font-size: clamp(17px, 2vw, 20px); color: var(--muted); max-width: 640px; text-wrap: pretty; }
  .eyebrow { font-size: 12px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--accent); margin-bottom: 10px; display: block; }

  /* Header */
  .site-header { position: sticky; top: 0; z-index: 30; background: color-mix(in srgb, var(--bg) 94%, transparent); backdrop-filter: saturate(1.4) blur(10px); border-bottom: 1px solid var(--line); }
  .hdr { display: flex; align-items: center; gap: 12px 16px; padding-top: 12px; padding-bottom: 12px; }
  .brand { display: flex; align-items: center; gap: 10px; text-decoration: none; min-width: 0; }
  /* The logo sits in the same size box in both themes (dark mode only adds a white chip behind it). */
  .logoimg { height: 34px; width: auto; max-width: 200px; object-fit: contain; display: block; padding: 4px 8px; border-radius: 8px; box-sizing: content-box; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .logoimg { background: #fff; } }
  :root[data-theme="dark"] .logoimg { background: #fff; }
  .wordmark { font-family: var(--serif); font-weight: 700; font-size: 21px; color: var(--head); line-height: 1.05; }
  .wordmark span { display: block; font-family: var(--sans); font-size: 9px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--accent); }
  .mainnav { display: flex; align-items: center; gap: 4px; margin-left: auto; }
  .mainnav a { color: var(--text); text-decoration: none; font-weight: 500; padding: 8px 12px; border-radius: 999px; white-space: nowrap; font-size: 15px; }
  .mainnav a:hover { background: var(--chip); }
  .mainnav a[aria-current="page"] { color: var(--accent); background: var(--accent-soft); }
  .hdr-cta { white-space: nowrap; }
  .hdr-cta[aria-current="page"] { box-shadow: 0 0 0 3px var(--accent-line); }
  .mainnav .narrow { display: none; }
  /* Up to 820px (phones and an upright iPad): logo, button and theme on one row, the menu below. */
  @media (max-width: 820px) {
    .site-header { position: static; }
    .hdr { flex-wrap: wrap; gap: 8px; padding-bottom: 8px; }
    .brand { flex: 1 1 auto; }
    .hdr-cta { order: 1; }
    .hdr .theme-btn { order: 2; }
    .mainnav { order: 3; margin-left: 0; width: 100%; flex-wrap: wrap; gap: 2px 0; overflow-x: auto; scrollbar-width: none; }
    .mainnav::-webkit-scrollbar { display: none; }
    .mainnav .wide { display: none; }
    .mainnav .narrow { display: inline; }
    .mainnav { justify-content: space-between; }
    .mainnav a { padding: 6px 8px; font-size: 15px; }
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
  section:not(.alt) + section.cta-sec { padding-top: 0; }
  .sec-head { max-width: 720px; margin-bottom: 28px; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 22px; box-shadow: var(--shadow); min-width: 0; }
  .grid { display: grid; gap: 16px; }
  .g2 { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
  .g3 { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
  .g4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  @media (max-width: 960px) { .g4 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 480px) { .g4 { grid-template-columns: minmax(0, 1fr); } }

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
  .sc { display: inline-block; padding: 0 8px; border-radius: 99px; font-size: 12px; font-weight: 600; background: var(--chip); color: var(--muted); white-space: nowrap; }
  .sc.bad { background: var(--bad-soft); color: var(--bad); } .sc.warn { background: var(--warn-soft); color: var(--warn); } .sc.ok { background: var(--ok-soft); color: var(--ok); }
  .sc.strong { background: color-mix(in srgb, var(--ok) 62%, var(--head)); color: var(--panel); }
  .soon { display: inline-block; margin-left: 6px; padding: 1px 9px; border-radius: 99px; background: var(--chip); color: var(--muted); font: 600 11px/1.6 var(--sans); letter-spacing: .04em; text-transform: uppercase; vertical-align: middle; }
  .closed-note { font-size: 14px; color: var(--muted); }
  .fix { margin: 12px 0 0; padding-left: 20px; font-size: 14px; }
  .fix li { margin: 3px 0; }

  /* Stats: rows always filled (5 = one row on wide screens; 1 + 2 + 2 on phones). */
  .stats { display: flex; flex-wrap: wrap; gap: 12px; }
  .stat { flex: 1 1 170px; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px 18px; box-shadow: var(--shadow); min-width: 0; }
  @media (max-width: 560px) { .stat { flex-basis: 130px; } .stat.big { flex-basis: 100%; } }
  .stat b { display: block; font-family: var(--serif); font-size: 30px; color: var(--head); line-height: 1.1; }
  .stat span { font-size: 14px; color: var(--muted); }

  /* Steps and features */
  .step .n { display: inline-flex; width: 34px; height: 34px; border-radius: 50%; align-items: center; justify-content: center; background: var(--accent-soft); color: var(--accent); font-weight: 700; margin-bottom: 10px; }
  .feature h3 { font-size: 18px; margin-bottom: 6px; }
  .feature p { margin: 0; color: var(--muted); font-size: 15px; }
  .checks { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
  .checks li { padding-left: 28px; position: relative; }
  .checks li::before { content: ""; position: absolute; left: 4px; top: 8px; width: 12px; height: 7px; border-left: 2.5px solid var(--ok); border-bottom: 2.5px solid var(--ok); transform: rotate(-45deg); }

  /* Links grid (names may take two lines) */
  .linkgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 8px; list-style: none; padding: 0; margin: 0; }
  .linkgrid a { display: flex; justify-content: space-between; align-items: center; gap: 10px; height: 100%; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 10px 14px; color: var(--text); text-decoration: none; font-weight: 500; min-width: 0; line-height: 1.3; }
  .linkgrid a span:first-child { overflow-wrap: anywhere; }
  .linkgrid a:hover { border-color: var(--accent-line); color: var(--accent); }
  .linkgrid .n { color: var(--muted); font-weight: 400; font-variant-numeric: tabular-nums; flex-shrink: 0; }
  .linkgrid.plain li { display: flex; justify-content: space-between; gap: 10px; border: 1px dashed var(--line-strong); border-radius: 12px; padding: 10px 14px; color: var(--muted); }
  details.all { margin-top: 18px; }
  details.all > summary { cursor: pointer; font-weight: 600; color: var(--accent); padding: 8px 0; }
  .filter { font: inherit; padding: 9px 12px; border: 1px solid var(--line-strong); border-radius: 10px; background: var(--panel); color: var(--text); width: 100%; max-width: 360px; margin: 8px 0 14px; }

  /* Pricing */
  .price b { display: block; font-family: var(--serif); font-size: 40px; color: var(--head); line-height: 1.1; margin: 8px 0 2px; }
  .price.hl { border: 2px solid var(--accent); }
  .note { background: var(--warn-soft); color: var(--warn); border-radius: 12px; padding: 12px 16px; font-weight: 500; }
  .note.ok { background: var(--ok-soft); color: var(--ok); }
  .packs { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; }
  .packs li { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; font-weight: 600; color: var(--head); }

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
  label.field input, label.field textarea, label.field select { font: inherit; padding: 10px 12px; border: 1px solid var(--line-strong); border-radius: 10px; background: var(--panel); color: var(--text); width: 100%; }
  label.field [aria-invalid="true"] { border-color: var(--bad); box-shadow: 0 0 0 3px var(--bad-soft); }
  label.field textarea { min-height: 130px; resize: vertical; }
  .hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
  form button { font: inherit; padding: 12px 24px; border-radius: 999px; border: 1px solid var(--accent); background: var(--accent); color: var(--on-accent); font-weight: 600; cursor: pointer; justify-self: start; }
  form button:disabled { opacity: .6; cursor: default; }
  .msg { font-weight: 500; } .msg.ok { color: var(--ok); } .msg.bad { color: var(--bad); }
  .done { background: var(--ok-soft); color: var(--ok); border-radius: 12px; padding: 18px 20px; font-weight: 500; }
  .done:focus { outline: 3px solid var(--accent-line); outline-offset: 2px; }
  .done strong { display: block; font-size: 18px; margin-bottom: 4px; }

  /* Legal / prose */
  .prose { max-width: 760px; }
  .prose h2 { font-size: 24px; margin-top: 30px; }
  .prose ul { padding-left: 22px; }
  .draft { background: var(--warn-soft); color: var(--warn); border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent); border-radius: 12px; padding: 12px 16px; font-weight: 600; margin-bottom: 22px; }

  /* CTA band + footer (the band is a deep panel in both themes) */
  :root { --cta-bg: #12263F; --cta-text: #ffffff; --cta-line: transparent; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --cta-bg: #1A2940; --cta-text: #F6F0E4; --cta-line: #2C3E57; } }
  :root[data-theme="dark"] { --cta-bg: #1A2940; --cta-text: #F6F0E4; --cta-line: #2C3E57; }
  .cta-band { background: var(--cta-bg); color: var(--cta-text); border: 1px solid var(--cta-line); border-radius: 20px; padding: 40px 28px; text-align: center; }
  .cta-band h2 { color: var(--cta-text); }
  .cta-band p { color: color-mix(in srgb, var(--cta-text) 78%, var(--cta-bg)); max-width: 640px; margin-left: auto; margin-right: auto; }
  .cta-band .actions { justify-content: center; }
  .cta-band .btn.ghost { color: var(--cta-text); border-color: color-mix(in srgb, var(--cta-text) 40%, transparent); }
  .site-footer { border-top: 1px solid var(--line); padding: 36px 0 44px; margin-top: 40px; font-size: 14px; color: var(--muted); }
  .foot { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 20px; }
  .foot h2 { font-family: var(--sans); font-size: 12px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--head); margin-bottom: 10px; }
  .foot ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 6px; }
  .foot a { color: var(--muted); text-decoration: none; }
  .foot a:hover { color: var(--accent); text-decoration: underline; }
  .copy { margin-top: 24px; }
`;

/** JSON-LD inside a script tag: "<" escaped so nothing can close the tag. */
function jsonLd(o: object): string {
  return `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`;
}

function originOf(b: SiteBrand): string {
  const o = String(b?.origin ?? "");
  return /^https?:\/\/[a-z0-9.:[\]-]+$/i.test(o) ? o : "";
}

function shell(b: SiteBrand, s: Shell): string {
  const name = esc(brandName(b));
  const color = safeColor(b?.color);
  const logo = safeLogo(b?.logoUrl);
  const support = supportOf(b);
  const origin = originOf(b);
  const url = origin && s.path ? origin + s.path : "";
  const cur = (k: Nav) => (s.nav === k ? ' aria-current="page"' : "");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(s.title)}</title>
<meta name="description" content="${esc(s.description)}">
${url ? `<link rel="canonical" href="${esc(url)}">\n<meta property="og:url" content="${esc(url)}">\n` : ""}<meta property="og:type" content="website">
<meta property="og:site_name" content="${name}">
<meta property="og:title" content="${esc(s.title)}">
<meta property="og:description" content="${esc(s.description)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta name="theme-color" content="#FBF5EA">
${FONT_LINKS}
${THEME_BOOT}
<style>${themeCss(color)}${CSS}</style>
${s.head ?? ""}${(s.jsonLd ?? []).map(jsonLd).join("\n")}
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
    </nav>
    ${signupOpen(b) ? `<a class="btn small hdr-cta" href="/app#signup">Start free</a>` : `<a class="btn small hdr-cta" href="/contact"${cur("contact")}>Contact</a>`}
    ${THEME_BUTTON}
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
        <ul><li><a href="/leads">Leads catalog</a></li><li><a href="/pricing">Pricing</a></li><li><a href="/faq">FAQ</a></li><li><a href="/demo">Try the demo</a></li><li><a href="/app">Sign in</a></li>${signupOpen(b) ? `<li><a href="/app#signup">Start free</a></li>` : `<li><a href="${ACCESS_HREF}">Request access</a></li>`}</ul>
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

/** The closing call to action. `catalog` = on a catalog page (no "Browse the catalog" self-link). */
function ctaBand(b: SiteBrand, prices: SitePrices | null, heading = "Try it on your own town", catalog = false): string {
  const free = prices && prices.freePerMonth > 0 ? `Start free — ${prices.freePerMonth.toLocaleString("en-US")} leads a month` : "Start free";
  return `<section class="tight cta-sec"><div class="wrap"><div class="cta-band">
  <h2>${esc(heading)}</h2>
  <p>Search any city and trade, see the counts before you spend anything, and get only the leads you want.</p>
  <div class="actions">${ctaButtons(b, free)}${catalog ? "" : `<a class="btn ghost" href="/leads">Browse the catalog</a>`}</div>
</div></div></section>`;
}

function credits(n: number): string {
  return plural(n, "credit");
}

// --- Home ----------------------------------------------------------------------------------

/** The score bands in words (the same everywhere: site, app, FAQ). */
const BANDS = "Weak under 40, Basic 40 to 59, Good 60 to 79, Strong 80 and up";

/** What a download really holds (see SIMPLE_COLUMNS in src/store/catalog.ts). */
function features(b: SiteBrand): [string, string][] {
  return [
    ["Phone numbers", "The main business line, extra numbers when we have them, and whether it can get a text."],
    ["Emails", "Up to three business emails, checked for domains that can't receive mail."],
    ["Owner and contacts", "The owner or manager and their title when it's public, plus other people at the business."],
    ["Website and address", "Their website (or a clear flag when they have none), street address, city, state and ZIP."],
    ["Online score", `0 to 100 for how well they show up online: ${BANDS}. "No website" when they have none.`],
    ["What to fix", "The top thing to fix and a short comment on their website. Your pitch, written."],
    ["Company size", "Employee range, an estimated revenue and the year founded, when public records have them."],
    googleOn(b)
      ? ["Rating and reviews", "Google rating and review count on leads with a Google rating."]
      : ["Rating and reviews", "Leads with a Google rating and review count are coming soon."],
  ];
}

export function homePage(b: SiteBrand, stats: SiteStats | null, states: SiteState[], prices: SitePrices): string {
  const name = brandName(b);
  const s = stats && stats.businesses > 0 ? stats : null;
  // Only states with a catalog count ("coming soon" ones don't).
  const listedCount = states.filter((x) => x.n >= STATE_LISTED).length;
  const g = googleOn(b);
  const tile = (part: number, label: string) => {
    const p = pct(part, s!.businesses);
    return p > 0 ? `<div class="stat"><b>${p}%</b><span>${esc(label)}</span></div>` : "";
  };
  const statsHtml = s
    ? `<section class="tight" aria-labelledby="stats-h"><div class="wrap">
  <h2 id="stats-h" class="eyebrow" style="font-family:var(--sans)">In the database right now</h2>
  <div class="stats">
    <div class="stat big"><b>${num(s.businesses)}</b><span>open local businesses</span></div>
    ${tile(s.withPhone, "have a phone number")}${tile(s.withEmail, "have an email")}${tile(s.withWebsite, "have a website")}${tile(s.withOwner, "have an owner name")}
  </div>
  <p class="muted" style="margin-top:12px">${listedCount ? `Across ${plural(listedCount, "state")} and ` : "In "}${plural(s.categories, "business category", "business categories")}. Closed businesses and anyone who asked not to be contacted are left out.</p>
</div></section>`
    : "";
  const top = states.filter((x) => x.n >= STATE_LISTED).slice(0, 6);
  const statesHtml = top.length
    ? `<section aria-labelledby="where-h"><div class="wrap">
  <div class="sec-head"><span class="eyebrow">Leads catalog</span><h2 id="where-h">Browse by state, city and trade</h2>
  <p class="muted">Bigger cities and trades have their own page with live counts. No account needed to look.</p></div>
  ${linkGrid(top.map((x) => ({ href: `/leads/${lower(x.st)}`, label: x.name, n: x.n })))}
  <p style="margin-top:16px"><a href="/leads">See every state</a></p>
</div></section>`
    : "";
  const packs = packsOf(b);
  const open = signupOpen(b);
  const body = `
<section class="hero"><div class="wrap hero-grid">
  <div>
    <span class="eyebrow">Local business leads for agencies</span>
    <h1>Find local businesses that <em>need what you sell</em></h1>
    <p class="lead">Phone, email, owner name and website for local businesses, plus a score for how well each one shows up online and what to fix first. Built for agencies that sell websites, SEO and ads.</p>
    <div class="actions">
      ${ctaButtons(b, prices.freePerMonth > 0 ? `Start free — ${prices.freePerMonth.toLocaleString("en-US")} leads a month` : "Create a free account")}
      <a class="btn ghost" href="/leads">Browse the catalog</a>
    </div>
    <p class="muted" style="margin-top:14px;font-size:14px">${open ? "No card needed. See how many leads match before you spend a thing." : `Sign-ups are closed for now. The demo works without an account. Already a customer? <a href="/app">Sign in</a>.`}</p>
  </div>
  <div class="sample" aria-label="Example lead">
    <span class="tag">Example lead</span>
    <div class="card">
      <h3>Harbor Street Plumbing</h3>
      <div class="muted" style="font-size:14px">Plumber · Tampa, FL</div>
      <dl class="kv">
        <dt>Phone</dt><dd>(813) 555-0142 · can text</dd>
        <dt>Email</dt><dd>office@harborstreet.example</dd>
        <dt>Owner</dt><dd>Dana Ruiz</dd>
        <dt>Website</dt><dd>harborstreet.example</dd>
      </dl>
      <div class="score"><b>34</b><span><strong>Online score: Weak</strong><br><span class="muted" style="font-size:13px">Under 40: the most to fix</span></span></div>
      <ul class="fix"><li>Make the website work on phones</li><li>Add online booking</li><li>Add a contact form</li><li>Add a Meta pixel / Google tag to track visitors</li></ul>
    </div>
  </div>
</div></section>
${statsHtml}
<section class="alt" aria-labelledby="how-h"><div class="wrap">
  <div class="sec-head"><span class="eyebrow">How it works</span><h2 id="how-h">From a town and a trade to a call list in minutes</h2></div>
  <div class="grid g3">
    <div class="card step"><span class="n" aria-hidden="true">1</span><h3>Search</h3><p class="muted">Pick states, cities or a spot on the map, then the trades you sell to. Filter by score, rating, reviews, or "no website".</p></div>
    <div class="card step"><span class="n" aria-hidden="true">2</span><h3>See the counts free</h3><p class="muted">Before you pay, see how many match and how many have a phone, an email, an owner name and a website.</p></div>
    <div class="card step"><span class="n" aria-hidden="true">3</span><h3>Get and download</h3><p class="muted">Get the leads you want, then download a simple spreadsheet or a cold-email-ready file with an opening line written for each business.</p></div>
  </div>
</div></section>
<section aria-labelledby="what-h"><div class="wrap">
  <div class="sec-head"><span class="eyebrow">What's in every download</span><h2 id="what-h">Everything you need for the first call</h2></div>
  <div class="grid g4">${features(b).map(([h, p]) => `<div class="card feature"><h3>${esc(h)}</h3><p>${esc(p)}</p></div>`).join("")}</div>
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
        ${g ? "<li>On leads with a Google rating: their Google listing and how their reviews compare to the busiest one nearby</li>" : ""}
      </ul>
    </div>
  </div>
</div></section>
${statesHtml}
<section class="alt" aria-labelledby="price-h"><div class="wrap">
  <div class="sec-head"><span class="eyebrow">Pricing</span><h2 id="price-h">Pay per lead.${open ? " Start free." : ""}</h2>
  <p class="muted">No subscription. ${freeSentence(b, prices)} After that, each lead costs a few credits.${creditLine(b)}</p></div>
  <div class="grid g3">
    <div class="card price"><h3>Free every month</h3><b>${num(prices.freePerMonth)}</b><span class="muted">leads${g ? ", of either type" : ""}${open ? "" : ", once your account opens"}</span></div>
    <div class="card price"><h3>Standard lead</h3><b>${num(prices.free)}</b><span class="muted">${prices.free === 1 ? "credit" : "credits"} per lead${inDollars(b, prices.free)}</span></div>
    <div class="card price"><h3>With Google rating${g ? "" : SOON}</h3><b>${num(prices.google)}</b><span class="muted">${prices.google === 1 ? "credit" : "credits"} per lead${inDollars(b, prices.google)}, adds the Google rating and reviews</span></div>
  </div>
  ${packs.length ? `<p style="margin-top:16px">Credit packs: ${packs.map(packLabel).join("; ")}.</p>` : ""}
  <p style="margin-top:16px"><a href="/pricing">See full pricing</a></p>
</div></section>
<section aria-labelledby="faq-h"><div class="wrap">
  <div class="sec-head"><span class="eyebrow">FAQ</span><h2 id="faq-h">Common questions</h2></div>
  ${faqItems(b, prices).slice(0, 4).map(faqHtml).join("")}
  <p style="margin-top:16px"><a href="/faq">Read all questions</a></p>
</div></section>
${ctaBand(b, prices)}`;
  const origin = originOf(b);
  const logo = safeLogo(b?.logoUrl);
  const support = supportOf(b);
  return shell(b, {
    title: `${name} — Local business leads with phone, email, owner and website score`,
    description: `Find local businesses that need what you sell. Phone, email, owner name, website and an online score for every lead. ${open
      ? (prices.freePerMonth > 0 ? `${prices.freePerMonth} free leads a month.` : "")
      : "Try the demo, no account needed."}`.trim(),
    nav: "home",
    path: "/",
    body,
    jsonLd: [{
      "@context": "https://schema.org", "@type": "Organization", name,
      ...(origin ? { url: origin + "/" } : {}), ...(logo ? { logo } : {}), ...(support ? { email: support } : {}),
    }],
  });
}

// --- Pricing ---------------------------------------------------------------------------------

export function pricingPage(b: SiteBrand, prices: SitePrices): string {
  const name = brandName(b);
  const cp = perCredit(b);
  const packs = packsOf(b);
  const open = signupOpen(b);
  const g = googleOn(b);
  const qs: [string, string][] = [
    ["What is a credit?", `Credits are how you pay for leads.${cp != null ? ` One credit costs about ${cents(cp)}.` : ""} A Standard lead costs ${credits(prices.free)}${inDollars(b, prices.free)}${g
      ? ` and a lead with a Google rating costs ${credits(prices.google)}${inDollars(b, prices.google)}.`
      : `. Leads with a Google rating are coming soon and will cost ${credits(prices.google)}${inDollars(b, prices.google)}.`}`],
    ["How do I get more credits?", `${packs.length ? `Credit packs: ${packs.map(packLabel).join("; ")}. ` : ""}${buyLine(b)}`],
    ["How do the free leads work?", `${freeSentence(b, prices) || "There are no free leads at the moment."}${g ? " They can be leads of either type." : ""} The count starts again at the start of each month, and unused free leads don't carry over.`],
    ["Do I pay again for a lead I already have?", "No. Leads you've got stay in your account and you can download them again any time at no cost."],
    ["Do credits expire?", "No. Credits stay in your account until you use them."],
    ["Is there a subscription?", "No. There's nothing to cancel. You only pay for the leads you get."],
  ];
  const body = `
<section class="hero"><div class="wrap">
  <div class="sec-head"><span class="eyebrow">Pricing</span><h1>Simple, pay-as-you-go pricing</h1>
  <p class="lead">See how many leads match for free. Pay only for the ones you get. No subscription, no contract.${creditLine(b)}</p></div>
  <div class="grid g3">
    <div class="card price hl">
      <h2 style="font-size:22px">Free every month</h2>
      <b>${num(prices.freePerMonth)}</b><p class="muted">leads a month${g ? ", of either type" : ""}${open ? "" : ", once your account opens"}</p>
      <ul class="checks"><li>Full search with live counts</li><li>Phone, email, owner, website</li><li>Online score and what to fix</li></ul>
      <div class="actions">${ctaButtons(b, "Start free")}</div>
    </div>
    <div class="card price">
      <h2 style="font-size:22px">Standard lead</h2>
      <b>${num(prices.free)}</b><p class="muted">${prices.free === 1 ? "credit" : "credits"} per lead${inDollars(b, prices.free)}</p>
      <ul class="checks"><li>From open map data, public websites and public records</li><li>Phones, emails, owner and other contacts, website and address when available</li><li>Online score and what to fix</li><li>Company size and year founded when public</li></ul>
    </div>
    <div class="card price">
      <h2 style="font-size:22px">With Google rating${g ? "" : SOON}</h2>
      <b>${num(prices.google)}</b><p class="muted">${prices.google === 1 ? "credit" : "credits"} per lead${inDollars(b, prices.google)}</p>
      <ul class="checks"><li>Everything in Standard</li><li>Google rating and review count</li><li>A fuller online score that includes their Google listing</li></ul>
      ${g ? "" : `<p class="muted" style="margin:12px 0 0;font-size:14px">Not in the catalog yet. Standard leads are available now.</p>`}
    </div>
  </div>
  ${packs.length ? `<h2 style="font-size:24px;margin-top:36px">Credit packs</h2><ul class="packs">${packs.map((p) => `<li>${packLabel(p)}</li>`).join("")}</ul>` : ""}
  <p class="note${b?.cardPayments && packs.length ? " ok" : ""}" style="margin-top:22px">${buyLine(b)}</p>
</div></section>
<section class="alt" aria-labelledby="cfaq-h"><div class="wrap">
  <h2 id="cfaq-h">Questions about credits</h2>
  ${qs.map(faqHtml).join("")}
</div></section>
${ctaBand(b, prices, open ? "Start with free leads" : "See it working in the demo")}`;
  return shell(b, {
    title: `Pricing — ${name}`,
    description: `Pay per lead: ${g
      ? `${prices.free} ${prices.free === 1 ? "credit" : "credits"} for a Standard lead, ${prices.google} with a Google rating.`
      : `${prices.free} ${prices.free === 1 ? "credit" : "credits"} for a Standard lead.`}${open && prices.freePerMonth > 0 ? ` ${prices.freePerMonth} free leads every month.` : ""} No subscription.`,
    nav: "pricing",
    path: "/pricing",
    body,
  });
}

// --- FAQ -------------------------------------------------------------------------------------

/** Answers are HTML (already escaped where they carry values). */
function faqItems(b: SiteBrand, prices: SitePrices): [string, string][] {
  const packs = packsOf(b);
  const g = googleOn(b);
  return [
    ["Where does the data come from?", `From public sources: open map data, businesses' own public websites, and public business listings and registries.${g
      ? " Leads with a Google rating also carry details from Google business listings: the rating and review count."
      : ""} We never sell personal consumer data.`],
    ["How much does it cost?", `${freeSentence(b, prices)} A Standard lead is ${credits(prices.free)}${inDollars(b, prices.free)}${g
      ? ` and a lead with a Google rating is ${credits(prices.google)}${inDollars(b, prices.google)}.`
      : `. Leads with a Google rating are coming soon (${credits(prices.google)} each).`}${packs.length ? ` Credits come in packs from ${dollars(packs[0].price)}.` : ""} See <a href="/pricing">pricing</a>.`],
    ["What's the difference between Standard leads and leads with a Google rating?", `Standard leads come from open data, public websites and public records: name, category, address, phones, website, emails, owner and other contacts when available, plus our website check and online score. ${g
      ? "Leads with a Google rating come from Google business listings: they add the rating and review count, and their score also looks at the Google listing."
      : "Leads with a Google rating are coming soon: they will add the rating and review count, and their score will also look at the Google listing."}`],
    ["How fresh is the data?", "We keep collecting and re-checking businesses. Closed businesses are removed, website checks are repeated over time, and email domains that can't receive mail are marked. No list is ever perfect, which is why you see counts before you pay."],
    ["What is the online score?", `A number from 0 to 100 for how well a business shows up online, based on its website (loads, secure, works on phones, speed, booking, contact form, tracking)${g ? " and, for leads with a Google rating, its Google listing" : ""}. Weak (under 40) means the most to fix, Basic (40 to 59) some, Good (60 to 79) is doing well and Strong (80 and up) has little to fix. Businesses without a website are marked "No website", and ones whose website doesn't load "Site down".`],
    ["Can I cancel?", "There's nothing to cancel. There's no subscription: you pay as you go, only for the leads you get."],
    ["What if a lead is wrong?", `If you find bad data, <a href="/contact?subject=data">contact us</a> with the lead's name and what's wrong and we'll make it right.`],
    ["How do you handle do-not-contact and removal requests?", `Any business can ask to be removed on the <a href="/remove">Remove my business</a> page. Once handled, it's taken out of search and future sales. Businesses on our do-not-contact list are never sold. Please follow the rules for your outreach (like CAN-SPAM and the Do Not Call registry).`],
  ];
}

function faqHtml([q, a]: [string, string]): string {
  return `<details class="q"><summary>${esc(q)}</summary><p>${a}</p></details>`;
}

const plainText = (html: string) => html.replace(/<[^>]*>/g, "").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

export function faqPage(b: SiteBrand, prices: SitePrices): string {
  const name = brandName(b);
  const items = faqItems(b, prices);
  const body = `
<section class="hero"><div class="wrap">
  <div class="sec-head"><span class="eyebrow">FAQ</span><h1>Frequently asked questions</h1>
  <p class="lead">How ${esc(name)} works, where the data comes from, and what you pay.</p></div>
  <div style="max-width:820px">${items.map(faqHtml).join("")}</div>
</div></section>
${ctaBand(b, prices)}`;
  return shell(b, {
    title: `FAQ — ${name}`, description: `Answers about ${name}: where the data comes from, how fresh it is, the lead types, pricing and removal requests.`,
    nav: "faq", path: "/faq", body,
    jsonLd: [{
      "@context": "https://schema.org", "@type": "FAQPage",
      mainEntity: items.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: plainText(a) } })),
    }],
  });
}

// --- Forms (contact, remove my business) -----------------------------------------------------

// One small script for both forms: checks the required fields, posts them as JSON, then swaps the
// form for the thank-you note (scrolled into view and focused). On a problem it marks and focuses
// the field at fault. No backslashes, backticks or dollar-braces (it sits in a template literal).
const FORM_SCRIPT = `
(function () {
  var f = document.querySelector("form[data-api]"); var m = document.getElementById("fmsg");
  var done = document.getElementById("fdone"); var nojs = document.getElementById("nojs");
  if (!f || !m) return;
  if (nojs) nojs.hidden = true;
  f.hidden = false;
  function clear() { var bad = f.querySelectorAll("[aria-invalid]"); for (var i = 0; i < bad.length; i++) bad[i].removeAttribute("aria-invalid"); }
  function fail(name, text) {
    m.className = "msg bad"; m.textContent = text;
    var el = name ? f.elements[name] : null;
    if (el && el.focus) { el.setAttribute("aria-invalid", "true"); el.focus(); }
    if (window.turnstile) { try { window.turnstile.reset(); } catch (x) {} }
  }
  f.addEventListener("input", function (e) { if (e.target && e.target.removeAttribute) e.target.removeAttribute("aria-invalid"); });
  f.addEventListener("submit", function (e) {
    e.preventDefault();
    clear();
    var btn = f.querySelector("button[type=submit]"); var data = {};
    f.getAttribute("data-fields").split(" ").forEach(function (k) { var el = f.elements[k]; data[k] = el ? (el.value || "").trim() : ""; });
    var req = f.querySelectorAll("[required]");
    for (var i = 0; i < req.length; i++) { if (!(req[i].value || "").trim()) return fail(req[i].name, req[i].getAttribute("data-msg") || "Please fill this in."); }
    var mins = f.querySelectorAll("[data-min]");
    for (var k = 0; k < mins.length; k++) { if ((mins[k].value || "").trim().length < Number(mins[k].getAttribute("data-min"))) return fail(mins[k].name, mins[k].getAttribute("data-minmsg") || "Please write a little more."); }
    var mails = f.querySelectorAll("input[type=email]");
    for (var j = 0; j < mails.length; j++) { var v = (mails[j].value || "").trim(); if (v && !/^[^@ ]+@[^@ ]+[.][a-z]{2,}$/i.test(v)) return fail(mails[j].name, "Check the email address."); }
    var t = f.elements["cf-turnstile-response"]; if (t) data.turnstile = t.value || "";
    m.className = "msg"; m.textContent = "Sending...";
    if (btn) btn.disabled = true;
    fetch(f.getAttribute("data-api"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) {
        if (x.ok) {
          f.hidden = true; m.textContent = "";
          if (done) { done.hidden = false; done.scrollIntoView({ block: "center" }); done.focus(); }
        } else fail(x.j && x.j.field, (x.j && x.j.error) || "Something went wrong. Please try again.");
      })
      .catch(function () { fail(null, "Couldn't send. Check your connection and try again."); })
      .then(function () { if (btn) btn.disabled = false; });
  });
})();
`;

const SUBJECTS: [string, string][] = [
  ["question", "A question"], ["access", "Request access"], ["credits", "Buying credits"], ["data", "Wrong data on a lead"], ["other", "Something else"],
];

export function contactPage(b: SiteBrand, opts: { subject?: string } = {}): string {
  const name = brandName(b);
  const support = supportOf(b);
  const subject = SUBJECTS.some(([k]) => k === opts.subject) ? opts.subject! : "question";
  const access = subject === "access";
  const ts = /^[0-9A-Za-z_-]{1,100}$/.test(String(b?.turnstileSiteKey ?? "")) ? String(b.turnstileSiteKey) : "";
  const body = `
<section class="hero"><div class="wrap">
  <div class="sec-head"><span class="eyebrow">Contact</span><h1>${access ? "Request access" : "Get in touch"}</h1>
  <p class="lead">${access
    ? "Sign-ups are closed for now while we get ready. Tell us about your agency and we'll let you know when your account can open."
    : "Questions about leads, credits or your account? Send us a message and we'll reply by email, usually within one business day."}</p>
  ${support ? `<p class="muted">Or email us at <a href="mailto:${esc(support)}">${esc(support)}</a>.</p>` : ""}</div>
  <div class="card" style="max-width:720px">
    <p id="nojs" class="msg bad">This form needs JavaScript. Please enable it${support ? `, or email <a href="mailto:${esc(support)}">${esc(support)}</a>` : ""}.</p>
    <form id="ctform" class="stack" data-api="/api/contact" data-fields="name email subject message website" hidden novalidate>
      <div class="row2">
        <label class="field">Your name *<input name="name" type="text" required maxlength="120" autocomplete="name" data-msg="Enter your name."></label>
        <label class="field">Your email *<input name="email" type="email" required maxlength="160" autocomplete="email" data-msg="Enter your email address, so we can reply."></label>
      </div>
      <label class="field">About<select name="subject">${SUBJECTS.map(([k, v]) => `<option value="${k}"${k === subject ? " selected" : ""}>${esc(v)}</option>`).join("")}</select></label>
      <label class="field">Message *<textarea name="message" required maxlength="4000" data-msg="Write your message." data-min="${CONTACT_MIN}" data-minmsg="Write a little more, so we know how to help."${access ? ` placeholder="Your agency, what you sell, and the areas you work in"` : ""}></textarea></label>
      <div class="hp" aria-hidden="true"><label>Leave this empty<input name="website" type="text" tabindex="-1" autocomplete="off"></label></div>
      ${ts ? `<div class="cf-turnstile" data-sitekey="${esc(ts)}"></div>` : ""}
      <button type="submit">Send message</button>
      <p id="fmsg" class="msg" role="status" aria-live="polite"></p>
    </form>
    <div id="fdone" class="done" tabindex="-1" role="status" hidden><strong>Thanks, your message is on its way.</strong>We'll reply to the email you gave us.</div>
  </div>
  <div class="grid g2" style="margin-top:24px;max-width:720px">
    <div class="card"><h2 style="font-size:20px">Already a customer?</h2><p class="muted">Sign in to search, get and download leads.</p><a class="btn small" href="/app">Sign in</a></div>
    <div class="card"><h2 style="font-size:20px">Own a listed business?</h2><p class="muted">Ask us to remove your business from our catalog.</p><a class="btn small ghost" href="/remove">Remove my business</a></div>
  </div>
</div></section>`;
  return shell(b, {
    title: `${access ? "Request access" : "Contact"} — ${name}`, description: `Contact ${name} about leads, credits or your account.`,
    nav: "contact", path: "/contact", body, script: FORM_SCRIPT,
    head: ts ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>\n` : "",
  });
}

// --- Legal -----------------------------------------------------------------------------------

export type LegalKind = "terms" | "privacy" | "do-not-sell";

export function legalPage(b: SiteBrand, kind: LegalKind): string {
  const name = esc(brandName(b));
  const support = supportOf(b);
  const reach = `use our <a href="/contact">contact form</a>${support ? ` or email <a href="mailto:${esc(support)}">${esc(support)}</a>` : ""}`;
  let title = "", h1 = "", content = "";
  if (kind === "terms") {
    title = "Terms of service"; h1 = "Terms of service";
    content = `
<p>These terms cover your use of ${name} (the "service"): the website, the lead search app and any lists you download. By creating an account or using the service you agree to them.</p>
<h2>The service</h2>
<p>We provide information about businesses gathered from public sources, together with our own analysis such as online presence scores and suggestions. You can search for free and pay, in credits, to get a business's contact details.</p>
<h2>Your account</h2>
<ul><li>You must give accurate details and keep your password safe. You're responsible for what happens under your account, including your team members.</li>
<li>Accounts are for businesses, not personal or household use.</li>
<li>We may suspend accounts that break these terms.</li></ul>
<h2>Credits, free leads and payment</h2>
<ul><li>Leads are paid for with credits. Prices in credits are shown before you get anything.</li>
<li>A monthly allowance of free leads may be offered. It starts again each calendar month and doesn't carry over.</li>
<li>Leads you get stay in your account. Credits are not refundable for cash except where the law requires it, but we will credit you back for leads with clearly wrong data if you tell us promptly.</li></ul>
<h2>How you may use the data</h2>
<ul><li>You get a non-exclusive licence to use the leads you get for your own business outreach. Other customers may get the same businesses.</li>
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
<p>Questions about these terms? Please ${reach}.</p>`;
  } else if (kind === "privacy") {
    title = "Privacy policy"; h1 = "Privacy policy";
    content = `
<p>This policy explains what information ${name} collects and how it's used. It covers two groups: customers who use the service, and businesses listed in our catalog.</p>
<h2>Customers</h2>
<ul><li><strong>What we collect:</strong> your name, company, email, a securely hashed password, your credit and purchase history, and basic technical data such as IP address for security and abuse prevention.</li>
<li><strong>Why:</strong> to run your account, provide the leads you get, prevent fraud, and contact you about the service.</li>
<li><strong>Cookies:</strong> we use one essential cookie to keep you signed in. We don't use advertising cookies.</li></ul>
<h2>Listed businesses</h2>
<ul><li><strong>What we list:</strong> business information from public sources, such as the business name, category, address, phone number, website, business email addresses and, where public, the owner's or manager's name as a business contact. Listings with a Google rating include public Google listing details like the rating and review count.</li>
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
<p>Privacy questions? Please ${reach}.</p>`;
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
<p>If you're a person rather than a business and believe we hold information about you, please ${reach} and we'll look into it and delete it where appropriate.</p>
<p><a class="btn" href="/remove">Remove my business</a></p>`;
  }
  const body = `
<section class="hero"><div class="wrap prose">
  ${b?.legalReviewed ? "" : `<p class="draft" role="note">Draft — to be reviewed by a lawyer before launch.</p>`}
  <span class="eyebrow">Legal</span><h1>${esc(h1)}</h1>
  <p class="muted">Last updated: ${esc(LEGAL_UPDATED)}</p>
  ${content}
</div></section>`;
  return shell(b, { title: `${title} — ${brandName(b)}`, description: `${title} for ${brandName(b)}.`, nav: "other", path: `/legal/${kind}`, body });
}

// --- Remove my business ----------------------------------------------------------------------

export function removePage(b: SiteBrand): string {
  const name = brandName(b);
  const support = supportOf(b);
  const body = `
<section class="hero"><div class="wrap">
  <div class="sec-head"><span class="eyebrow">Remove my business</span><h1>Remove your business from our catalog</h1>
  <p class="lead">Tell us which business it is. Once we've checked the request, it's taken out of search and future sales, and added to our do-not-contact list.</p></div>
  <div class="card" style="max-width:720px">
    <p id="nojs" class="msg bad">This form needs JavaScript. Please enable it${support ? `, or email <a href="mailto:${esc(support)}">${esc(support)}</a>` : `, or ${CONTACT}`}.</p>
    <form id="rmform" class="stack" data-api="/api/remove-request" data-fields="business phone website email name contactEmail message" hidden novalidate>
      <label class="field">Business name *<input name="business" type="text" required maxlength="160" autocomplete="organization" data-msg="Enter the business name."></label>
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
      <p id="fmsg" class="msg" role="status" aria-live="polite"></p>
    </form>
    <div id="fdone" class="done" tabindex="-1" role="status" hidden><strong>Thanks, we've got your request.</strong>We'll remove the business once we've checked it.</div>
  </div>
  <p class="muted" style="margin-top:18px">More about how we handle this: <a href="/legal/do-not-sell">Do not sell my information</a>.</p>
</div></section>`;
  return shell(b, { title: `Remove my business — ${name}`, description: `Ask ${name} to remove your business from its catalog.`, nav: "other", path: "/remove", body, script: FORM_SCRIPT });
}

// --- Catalog ---------------------------------------------------------------------------------

type Crumb = [string, string | null];

function crumbs(items: Crumb[]): string {
  return `<nav class="crumbs" aria-label="Breadcrumb"><ol>${items
    .map(([label, href]) => `<li>${href ? `<a href="${esc(href)}">${esc(label)}</a>` : `<span aria-current="page">${esc(label)}</span>`}</li>`)
    .join("")}</ol></nav>`;
}

/** BreadcrumbList structured data for the same trail (the last item is the page itself). */
function crumbsLd(b: SiteBrand, items: Crumb[], path: string): object {
  const origin = originOf(b);
  return {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: items.map(([label, href], i) => ({ "@type": "ListItem", position: i + 1, name: label, item: origin + (href ?? path) })),
  };
}

function linkGrid(items: { href: string; label: string; n: number }[], cls = ""): string {
  return `<ul class="linkgrid${cls ? " " + cls : ""}">${items.map((x) => `<li><a href="${esc(x.href)}" title="${esc(x.label)}"><span>${esc(x.label)}</span><span class="n">${num(x.n)}</span></a></li>`).join("")}</ul>`;
}

export function statesPage(b: SiteBrand, states: SiteState[]): string {
  const name = brandName(b);
  const total = states.reduce((a, x) => a + x.n, 0);
  const listed = states.filter((x) => x.n >= STATE_LISTED);
  const soon = states.filter((x) => x.n < STATE_LISTED);
  const trail: Crumb[] = [["Home", "/"], ["Leads catalog", null]];
  const body = `
<section class="hero"><div class="wrap">
  ${crumbs(trail)}
  <h1>Local business leads by state</h1>
  <p class="lead">${num(total)} open local businesses. Pick a state to see its cities, then the trades in each city.</p>
  ${listed.length ? linkGrid(listed.map((x) => ({ href: `/leads/${lower(x.st)}`, label: x.name, n: x.n }))) : `<p class="muted">The catalog is being built. Check back soon.</p>`}
  ${soon.length ? `<h2 style="font-size:22px;margin-top:32px">Coming soon</h2><p class="muted">We're still collecting businesses in these states.</p>
  <ul class="linkgrid plain">${soon.map((x) => `<li><span>${esc(x.name)}</span><span class="n">${num(x.n)}</span></li>`).join("")}</ul>` : ""}
</div></section>
${ctaBand(b, null, "Try it on your own town", true)}`;
  return shell(b, {
    title: `Local business leads by state — ${name}`, description: `Browse ${total.toLocaleString("en-US")} local business leads by state, city and category.`,
    nav: "leads", path: "/leads", body, jsonLd: [crumbsLd(b, trail, "/leads")],
  });
}

// Filters the full city list on the state page. No backslashes, backticks or dollar-braces.
const CITY_FILTER_SCRIPT = `
(function () {
  var box = document.getElementById("cityfilter"); var list = document.getElementById("allcities");
  if (!box || !list) return;
  box.hidden = false;
  box.addEventListener("input", function () {
    var q = box.value.trim().toLowerCase(); var items = list.querySelectorAll("li");
    for (var i = 0; i < items.length; i++) items[i].hidden = q !== "" && items[i].textContent.toLowerCase().indexOf(q) < 0;
  });
})();
`;

/** `total` is the state's count (the same number as its tile); cities below the threshold are "smaller towns". */
export function statePage(b: SiteBrand, st: string, stName: string, cities: SiteCity[], total?: number): string {
  const name = brandName(b);
  const ST = st.toUpperCase();
  const listedSum = cities.reduce((a, x) => a + x.n, 0);
  const all = Math.max(total ?? listedSum, listedSum);
  const small = all - listedSum;
  const href = (x: SiteCity) => `/leads/${lower(ST)}/${x.slug}`;
  const top = cities.slice(0, TOP_CITIES);
  const more = cities.length > TOP_CITIES;
  const trail: Crumb[] = [["Home", "/"], ["Leads catalog", "/leads"], [stName, null]];
  const body = `
<section class="hero"><div class="wrap">
  ${crumbs(trail)}
  <h1>Local business leads in ${esc(stName)}</h1>
  <p class="lead">${num(all)} businesses in ${esc(stName)}: ${cities.length === 1 ? "1 city with its own page" : `${num(cities.length)} cities with their own page`}${small > 0 ? `, plus ${plural(small, "business", "businesses")} in smaller towns` : ""}. Pick a city to see the trades.</p>
  ${more ? `<h2 style="font-size:22px">Biggest cities</h2>` : ""}
  ${linkGrid(top.map((x) => ({ href: href(x), label: x.city, n: x.n })))}
  ${more ? `<details class="all"><summary>Show all ${num(cities.length)} cities</summary>
    <label class="sr-only" for="cityfilter">Find a city</label><input id="cityfilter" class="filter" type="search" placeholder="Find a city" autocomplete="off" hidden>
    <div id="allcities">${linkGrid([...cities].sort((a, b2) => a.city.localeCompare(b2.city)).map((x) => ({ href: href(x), label: x.city, n: x.n })))}</div>
  </details>` : ""}
</div></section>
${ctaBand(b, null, `Find leads in ${stName}`, true)}`;
  return shell(b, {
    title: `${stName} business leads — ${name}`, description: `Local business leads in ${stName} by city: phone, email, owner name, website and online score.`,
    nav: "leads", path: `/leads/${lower(ST)}`, body, script: more ? CITY_FILTER_SCRIPT : undefined, jsonLd: [crumbsLd(b, trail, `/leads/${lower(ST)}`)],
  });
}

/** `total` = all businesses in the city (trades under 5 businesses have no page of their own). */
export function cityPage(b: SiteBrand, st: string, stName: string, city: string, citySlug: string, categories: SiteCategory[], total?: number): string {
  const name = brandName(b);
  const ST = st.toUpperCase();
  const all = total ?? categories.reduce((a, x) => a + x.n, 0);
  const path = `/leads/${lower(ST)}/${citySlug}`;
  const trail: Crumb[] = [["Home", "/"], ["Leads catalog", "/leads"], [stName, `/leads/${lower(ST)}`], [city, null]];
  const body = `
<section class="hero"><div class="wrap">
  ${crumbs(trail)}
  <h1>Business leads in ${esc(city)}, ${esc(ST)}</h1>
  <p class="lead">${num(all)} businesses. ${categories.length ? "Pick a trade to see how many have a phone, email, owner name and website." : "Each trade here has only a few businesses so far."}</p>
  ${categories.length ? linkGrid(categories.map((x) => ({ href: `${path}/${x.slug}`, label: categoryName(x.category), n: x.n }))) : ""}
  <p class="muted" style="margin-top:16px">${signupOpen(b)
    ? `Every business in ${esc(city)}, including smaller trades, is in the <a href="/app#find?state=${encodeURIComponent(ST)}&amp;city=${esc(encodeURIComponent(`${city}|${ST}`))}">app</a>.`
    : `See how the search works in the <a href="/demo">demo</a>, or <a href="${ACCESS_HREF}">request access</a>.`}</p>
</div></section>
${ctaBand(b, null, `Find leads in ${city}`, true)}`;
  return shell(b, {
    title: `${city}, ${ST} business leads — ${name}`, description: `Local business leads in ${city}, ${ST} by category, with phone, email, owner name, website and online score.`,
    nav: "leads", path, body, jsonLd: [crumbsLd(b, trail, path)],
  });
}

/**
 * "/app#find?state=FL&city=Tampa%7CFL&category=Plumber" (+ "&n=42", the count, so the sign-up
 * card can say "Create a free account to see the 42 plumbers in Tampa").
 */
export function appFindLink(st: string, city: string, category: string, n?: number): string {
  const ST = st.toUpperCase();
  return `/app#find?state=${encodeURIComponent(ST)}&city=${encodeURIComponent(`${city}|${ST}`)}&category=${encodeURIComponent(category)}${n != null && Number.isFinite(n) ? `&n=${Math.round(n)}` : ""}`;
}
/** The same search in the no-login demo (made-up businesses). */
export function demoFindLink(st: string, city: string, category: string): string {
  return "/demo" + appFindLink(st, city, category).slice("/app".length);
}

export function categoryPage(b: SiteBrand, p: SiteCatalogPage, citySlug: string): string {
  const name = brandName(b);
  const ST = p.st.toUpperCase();
  const many = categoryName(p.category);
  const h1 = `${many} in ${p.city}, ${ST}`;
  const path = `/leads/${lower(ST)}/${citySlug}/${slugOf(p.category)}`;
  const stat = (v: number, label: string) => {
    const x = pct(v, p.n);
    return x > 0 ? `<div class="stat"><b>${x}%</b><span>${esc(label)}</span></div>` : "";
  };
  const trail: Crumb[] = [["Home", "/"], ["Leads catalog", "/leads"], [p.stateName, `/leads/${lower(ST)}`], [p.city, `/leads/${lower(ST)}/${citySlug}`], [many, null]];
  const open = signupOpen(b);
  // The meta description only names what most of them have (never "0% with email").
  const shares = [[p.withPhone, "phone"], [p.withEmail, "email"], [p.withWebsite, "a website"]] as const;
  const described = shares.filter(([v]) => pct(v, p.n) > 0).map(([v, w]) => `${pct(v, p.n)}% with ${w}`);
  const actions = open
    ? `<a class="btn" href="${esc(appFindLink(p.st, p.city, p.category, p.n))}">See all ${num(p.n)} in the app</a><a class="btn ghost" href="/pricing">Pricing</a>`
    : `<a class="btn" href="${esc(demoFindLink(p.st, p.city, p.category))}">Try this search in the demo</a><a class="btn ghost" href="${ACCESS_HREF}">Request access</a>`;
  const body = `
<section class="hero"><div class="wrap">
  ${crumbs(trail)}
  <h1>${esc(h1)}</h1>
  <p class="lead">${num(p.n)} ${esc(categoryInline(p.category, p.n !== 1))} in ${esc(p.city)}, ${esc(p.stateName)}, with contact details and an online score.</p>
  <div class="stats" style="margin-top:22px">
    <div class="stat"><b>${num(p.n)}</b><span>businesses</span></div>
    ${stat(p.withPhone, "have a phone number")}
    ${stat(p.withEmail, "have an email")}
    ${stat(p.withWebsite, "have a website")}
    ${stat(p.withOwner, "have an owner name")}
    ${p.avgScore != null && p.avgScore > 0 ? `<div class="stat"><b>${num(p.avgScore)}</b><span>average online score (of 100, websites checked)</span></div>` : ""}
  </div>
  <div class="actions">${actions}</div>
  ${open ? "" : `<p class="closed-note" style="margin-top:12px">Sign-ups are closed for now. The demo shows made-up businesses.</p>`}
</div></section>
${p.samples.length ? `<section class="alt" aria-labelledby="s-h"><div class="wrap">
  <h2 id="s-h">Some of the businesses</h2>
  <p class="muted">Contact details, owner names and what to fix come with the leads.</p>
  <ul class="samples">${p.samples.map((x) => {
    const chip = scoreChip(x.score);
    // A score of 0 means no website, or (with one) a website that doesn't load.
    const zero = x.score != null && Number(x.score) <= 0;
    const bits = [
      x.rating != null ? `${esc(Number(x.rating).toFixed(1))} stars` : "",
      x.reviews != null ? plural(x.reviews, "review") : "",
      x.website === false ? `<span class="sc none">No website</span>` : zero ? `<span class="sc none">Site down</span>` : chip || `<span class="sc none">Not scored</span>`,
      x.website === false && chip ? chip : "",
    ].filter(Boolean).join(" · ");
    return `<li><b>${esc(niceName(x.name))}</b>${bits ? `<span>${bits}</span>` : ""}</li>`;
  }).join("")}</ul>
</div></section>` : ""}
${ctaBand(b, null, `Get the full list of ${categoryInline(p.category)}`, true)}`;
  return shell(b, {
    title: `${h1}: ${p.n.toLocaleString("en-US")} leads — ${name}`,
    description: `${p.n.toLocaleString("en-US")} ${categoryInline(p.category, p.n !== 1)} in ${p.city}, ${ST}${described.length ? `: ${described.join(", ")}` : ", with an online score"}.`,
    nav: "leads",
    path,
    body,
    jsonLd: [crumbsLd(b, trail, path)],
  });
}

const slugOf = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** `catalog` = the address was under /leads (then the copy talks about places and trades). */
export function notFoundPage(b: SiteBrand, opts: { catalog?: boolean } = {}): string {
  const body = `
<section class="hero"><div class="wrap">
  <span class="eyebrow">Not found</span>
  <h1>We couldn't find that page</h1>
  <p class="lead">${opts.catalog
    ? "The place or trade may have too few listed businesses for a page yet, or the link may be old."
    : "The link may be old or mistyped."}</p>
  <div class="actions">${opts.catalog ? `<a class="btn" href="/leads">Browse the catalog</a><a class="btn ghost" href="/">Home</a>` : `<a class="btn" href="/">Home</a><a class="btn ghost" href="/leads">Browse the catalog</a>`}</div>
</div></section>`;
  return shell(b, { title: `Page not found — ${brandName(b)}`, description: "This page could not be found.", nav: "other", body });
}

/**
 * A state that isn't in the catalog yet (fewer than STATE_MIN businesses), and its city and trade
 * addresses: "coming soon" (served as 404, so search engines skip it), with the way back.
 */
export function comingSoonPage(b: SiteBrand, stName: string): string {
  const body = `
<section class="hero"><div class="wrap">
  <span class="eyebrow">Coming soon</span>
  <h1>${esc(stName)} is coming soon</h1>
  <p class="lead">We're still collecting businesses in ${esc(stName)}. Its pages open once there are enough of them.</p>
  <div class="actions"><a class="btn" href="/leads">See the states we have</a>${demoBtn()}</div>
</div></section>`;
  return shell(b, { title: `${stName}: coming soon — ${brandName(b)}`, description: `Business leads in ${stName} are coming soon.`, nav: "leads", body });
}

/** Shown (status 503) when the catalog can't be read right now. */
export function busyPage(b: SiteBrand): string {
  const body = `
<section class="hero"><div class="wrap">
  <span class="eyebrow">Busy</span>
  <h1>We're a little busy right now</h1>
  <p class="lead">This page couldn't load just now. Please try again in a few seconds.</p>
  <div class="actions"><a class="btn" href="">Try again</a><a class="btn ghost" href="/">Home</a></div>
</div></section>`;
  return shell(b, { title: `Busy, try again — ${brandName(b)}`, description: "This page couldn't load just now.", nav: "leads", body });
}

// --- Favicon / robots.txt / sitemap.xml ------------------------------------------------------

/** A rounded square in the brand colour with the brand's first letter (the same icon as the app's tab). */
export function faviconSvg(b: SiteBrand): string {
  const color = safeColor(b?.color);
  const letter = (brandName(b).match(/[A-Za-z0-9]/)?.[0] ?? "L").toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${color}"/>` +
    `<text x="32" y="45" font-family="Arial,Helvetica,sans-serif" font-size="38" font-weight="700" fill="#ffffff" text-anchor="middle">${letter}</text></svg>`;
}

export function robotsTxt(publicPages: boolean, origin: string): string {
  if (!publicPages) return "User-agent: *\nDisallow: /\n";
  return `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /app\n\nSitemap: ${origin}/sitemap.xml\n`;
}

const xmlEsc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

export function sitemapXml(origin: string, paths: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...new Set(paths)]
    .map((p) => `  <url><loc>${xmlEsc(origin + p)}</loc></url>`)
    .join("\n")}\n</urlset>\n`;
}
