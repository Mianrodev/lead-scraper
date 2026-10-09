// Customer-facing Lead Store app served at "/app" by the store Worker (the public website is at "/"),
// and the same app as a no-login demo at "/demo" (made-up businesses generated in the page).
// Plain HTML + JS, no build step. Contract: docs/store-api.md + docs/platform-plan.md.
//
// The app is organised around lists: Search (what + where, a few one-tap filters, one "Get N leads"
// button) and Your lists (every get is saved as a list you can open, rename, download or delete).
// Deep links: /app#signup, /app#find?state=FL&city=Miami%7CFL&category=Plumber&n=42 (runs that
// search; n = how many, for the sign-up card), /app#lists, /app#list?id=<id>, /app#credits,
// /app#team, /app#demo (-> /demo). The search lives in the hash (#find?...) and the last search is
// remembered per browser, so a refresh keeps it.
//
// Demo mode (body data-demo="1"): api() answers from makeDemo() in the page and never calls the
// network, so no real data can show; nothing signs in and no cookies are set.
//
// The map loads Leaflet 1.9.4 from cdnjs at runtime (only when the Map is opened). The page script
// lives inside this template literal, so it must not contain backslashes, backticks or dollar-brace
// sequences; brand values are only interpolated into the HTML/CSS below (escaped), and the script
// reads them back from data attributes. Look + dark mode: src/theme.ts (shared with the website).

import { FONT_LINKS, THEME_BOOT, THEME_BUTTON, THEME_SCRIPT, themeCss } from "../theme";

export interface StoreBrand {
  name: string;
  color: string;
  supportEmail: string;
  /** https address of the logo image (optional; the name is shown as a wordmark without it). */
  logoUrl?: string;
  /** Cloudflare Turnstile site key (public); empty = the "I'm human" check is off. */
  turnstileSiteKey?: string;
  /** false = sign-ups are closed (no sign-up form). Defaults to open. */
  signupOpen?: boolean;
  /** Dollars per credit, shown as "1 credit = $0.50" when set. */
  creditPrice?: number | null;
  /** The no-login demo on made-up data (/demo). */
  demo?: boolean;
}

// The look follows the Goes Local brand (miamigoeslocal.com): warm cream background, deep navy
// text, orange highlight, Fraunces headings and Inter text, white cards, round pill buttons.
const DEFAULT_COLOR = "#E4572E";

/** Only plain https image addresses are used for the logo. */
export function safeLogo(u: unknown): string {
  if (typeof u !== "string") return "";
  try { const x = new URL(u.trim()); return x.protocol === "https:" && !x.username && !x.password ? x.toString() : ""; } catch { return ""; }
}

function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Only plain hex colors (#abc or #aabbcc) reach the CSS; anything else falls back to the default. */
export function safeColor(c: unknown): string {
  return typeof c === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c.trim()) ? c.trim() : DEFAULT_COLOR;
}

const CSS = `
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  /* clip (not hidden): hidden would make body a scroll box and stop the header and table head from sticking */
  body { overflow-x: clip; }
  body { margin: 0; font: 15px/1.55 var(--sans); background: var(--bg); color: var(--text); -webkit-font-smoothing: antialiased; }
  :root { --hdrH: 64px; --strong: color-mix(in srgb, var(--ok) 62%, var(--head)); }
  /* Anything scrolled into view (map, results, a focused field) lands below the sticky header, not under it. */
  html { scroll-padding-top: calc(var(--hdrH) + 12px); }
  header { position: sticky; top: 0; z-index: 30; background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: saturate(1.4) blur(10px);
    border-bottom: 1px solid var(--line); padding: 10px 24px; display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
  .brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
  /* The logo sits in the same size box in both themes (dark mode only adds a white chip behind it). */
  .logoimg { height: 34px; width: auto; max-width: 180px; object-fit: contain; display: block; padding: 4px 8px; border-radius: 8px; box-sizing: content-box; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .logoimg { background: #fff; } }
  :root[data-theme="dark"] .logoimg { background: #fff; }
  .wordmark { font-family: var(--serif); font-weight: 700; font-size: 20px; color: var(--head); line-height: 1.05; }
  .wordmark span { display: block; font-family: var(--sans); font-size: 9px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--accent); }
  h1 { font-size: 16px; margin: 0; letter-spacing: -.01em; }
  h1, h2, h3, .big { font-family: var(--serif); color: var(--head); font-weight: 600; letter-spacing: -.01em; }
  /* The brand in the header is not a heading: each screen has its own one h1. */
  .hdrname { font-size: 16px; line-height: 1.2; min-width: 0; }
  .hdrname .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .hdrname small { display: block; font-size: 11px; font-weight: 500; color: var(--muted); letter-spacing: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  h2 { font-size: 15px; margin: 0 0 10px; }
  .tabs { display: flex; gap: 2px; background: var(--chip); padding: 3px; border-radius: 999px; }
  .tab { padding: 6px 16px; border: none; border-radius: 999px; cursor: pointer; color: var(--muted); background: none; font: inherit; font-weight: 500; box-shadow: none; white-space: nowrap; }
  .tab:hover { color: var(--text); filter: none; }
  .tab.active { background: var(--panel); color: var(--accent-strong); font-weight: 700; box-shadow: inset 0 0 0 1px var(--accent-line), var(--shadow); }
  .homelink { display: flex; align-items: center; border-radius: 8px; }
  .homelink:hover { text-decoration: none; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .hdr-right { margin-left: auto; display: flex; align-items: center; gap: 8px 10px; flex-wrap: wrap; justify-content: flex-end; min-width: 0; }
  .hdr-acct { display: flex; align-items: center; gap: 8px 10px; flex-wrap: wrap; justify-content: flex-end; min-width: 0; }
  .balance { font-size: 13px; padding: 4px 12px; border-radius: 99px; background: var(--accent-soft); color: var(--accent-strong); font-weight: 600; white-space: nowrap; border: 1px solid transparent; box-shadow: none; }
  button.balance:hover { border-color: var(--accent-line); filter: none; }
  .balance.free { background: var(--ok-soft); color: var(--ok); }
  .menuwrap { position: relative; }
  .menu { position: absolute; right: 0; top: calc(100% + 6px); min-width: 220px; background: var(--panel); border: 1px solid var(--line-strong); border-radius: 12px;
    box-shadow: var(--shadow-pop); z-index: 40; padding: 6px; display: flex; flex-direction: column; }
  .menu .who { padding: 6px 10px 8px; font-size: 12px; color: var(--muted); border-bottom: 1px solid var(--line); margin-bottom: 4px; overflow-wrap: anywhere; }
  .menu button { background: none; border: none; color: var(--text); text-align: left; font-weight: 500; box-shadow: none; padding: 8px 10px; border-radius: 8px; }
  .menu button:hover, .menu button:focus-visible { background: var(--chip); filter: none; }
  .demobar { background: var(--invert-bg); color: var(--invert-text); padding: 8px 24px; display: flex; gap: 8px 14px; align-items: center; justify-content: center; flex-wrap: wrap; font-weight: 500; font-size: 14px; text-align: center; }
  .demobar a.btnlink { padding: 5px 14px; font-size: 13px; }
  main { padding: 20px 24px 48px; display: flex; flex-direction: column; gap: 16px; max-width: 1280px; margin: 0 auto; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px 18px; box-shadow: var(--shadow); min-width: 0; }
  input, select, button, textarea { font: inherit; }
  input[type=text], input[type=email], input[type=number], input[type=password], input[type=search], select { padding: 8px 12px; border: 1px solid var(--line-strong); border-radius: 10px;
    background: var(--panel); color: var(--text); max-width: 100%; }
  input:focus-visible, select:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  input[type=search]::-webkit-search-cancel-button { -webkit-appearance: none; appearance: none; display: none; }
  input[type=checkbox], input[type=radio] { accent-color: var(--accent); }
  button { padding: 9px 20px; border-radius: 999px; border: 1px solid var(--accent); background: var(--accent); color: var(--on-accent); cursor: pointer; font-weight: 600; box-shadow: var(--shadow); }
  button:hover { filter: brightness(1.06); }
  button.ghost { background: var(--panel); color: var(--text); border-color: var(--line-strong); font-weight: 500; box-shadow: none; }
  button.ghost:hover { border-color: var(--accent-line); color: var(--accent); filter: none; }
  button.ghost[aria-pressed=true] { border-color: var(--accent); color: var(--accent-strong); background: var(--accent-soft); }
  button.link { background: none; border: none; color: var(--accent); padding: 0; box-shadow: none; font-weight: 500; text-decoration: underline; text-underline-offset: 2px; }
  button.link.danger { color: var(--bad); background: none; }
  button.small { padding: 5px 12px; font-size: 13px; }
  button.danger { background: var(--bad); border-color: var(--bad); color: var(--on-accent); }
  button:disabled { opacity: .5; cursor: default; filter: none; }
  a.btnlink { display: inline-block; padding: 9px 20px; border-radius: 999px; background: var(--accent); color: var(--on-accent); font-weight: 600; text-decoration: none; }
  a.btnlink.ghost { background: var(--panel); color: var(--text); border: 1px solid var(--line-strong); font-weight: 500; }
  .muted { color: var(--muted); } .hint { font-size: 13px; color: var(--muted); }
  .err { color: var(--bad); } .okmsg { color: var(--ok); }
  a { color: var(--accent); text-decoration: none; } a:hover { text-decoration: underline; }
  .banner { border-radius: 12px; padding: 10px 14px; font-weight: 500; }
  .banner.warn { background: var(--warn-soft); color: var(--warn); } .banner.bad { background: var(--bad-soft); color: var(--bad); }
  .banner.info { background: var(--accent-soft); color: var(--text); }
  .pwwrap { display: flex; gap: 6px; align-items: center; }
  .pwwrap input { flex: 1; min-width: 0; }
  .pwtoggle { padding: 6px 12px; font-size: 12px; background: var(--panel); color: var(--text); border-color: var(--line-strong); box-shadow: none; font-weight: 500; flex: none; }

  /* Signed out */
  .auth { display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 400px)); gap: 16px; justify-content: center; padding-top: 16px; }
  .auth h2 { font-size: 22px; }
  form.stack { display: flex; flex-direction: column; gap: 10px; }
  label.field, .field { display: flex; flex-direction: column; gap: 3px; font-size: 13px; color: var(--muted); font-weight: 500; }
  label.field input, label.field select { width: 100%; color: var(--text); }
  .intro { text-align: center; max-width: 620px; margin: 8px auto 0; }
  .intro h1 { font-size: clamp(26px, 4vw, 38px); margin-bottom: 6px; line-height: 1.15; }
  .agree { font-size: 12px; color: var(--muted); margin: 0; }

  /* Search row: what + where + search */
  .searchrow { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr) auto; gap: 0; background: var(--panel); border: 1px solid var(--line-strong);
    border-radius: 20px; box-shadow: var(--shadow); padding: 6px; align-items: stretch; }
  .sbox { position: relative; display: flex; flex-direction: column; justify-content: center; padding: 4px 14px; min-width: 0; border-right: 1px solid var(--line); border-radius: 14px; }
  .sbox:focus-within { background: var(--panel-2); }
  .sbox > label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
  .tokwrap { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; min-width: 0; }
  .tokwrap input { border: none; border-radius: 6px; padding: 4px 2px; flex: 1; min-width: 110px; background: transparent; box-shadow: none; font-size: 16px; color: var(--text); }
  .tokwrap input:focus-visible { box-shadow: none; }
  .tok { display: inline-flex; align-items: center; gap: 2px; padding: 2px 2px 2px 10px; border-radius: 99px; background: var(--accent-soft); color: var(--accent-strong); font-size: 13px; font-weight: 600; max-width: 100%; }
  .tok button { background: none; border: none; box-shadow: none; color: inherit; padding: 0 7px; font-size: 15px; line-height: 1; border-radius: 99px; }
  .tok button:hover { color: var(--bad); filter: none; }
  .radiusrow { display: flex; margin-top: 2px; }
  .radiusrow select { padding: 2px 8px; font-size: 13px; border-radius: 8px; }
  .gobox { display: flex; align-items: center; padding-left: 6px; }
  .gobox button { padding: 12px 26px; font-size: 16px; }
  .sugg { position: absolute; top: calc(100% + 6px); left: 0; right: 0; min-width: 260px; z-index: 35; background: var(--panel); border: 1px solid var(--line-strong); border-radius: 12px;
    box-shadow: var(--shadow-pop); list-style: none; margin: 0; padding: 4px; max-height: 340px; overflow-y: auto; }
  .sugg li { padding: 8px 10px; border-radius: 8px; cursor: pointer; display: flex; justify-content: space-between; gap: 12px; color: var(--text); }
  .sugg li[aria-selected=true], .sugg li:hover { background: var(--chip); }
  .sugg .n { color: var(--muted); font-size: 12px; white-space: nowrap; }
  .sugg .kind { color: var(--muted); font-size: 12px; font-weight: 400; }
  .chiprow { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .fchip { padding: 6px 14px; border-radius: 999px; border: 1px solid var(--line-strong); background: var(--panel); color: var(--text); font-weight: 500; box-shadow: none; font-size: 14px; }
  .fchip:hover { border-color: var(--accent-line); filter: none; }
  .fchip[aria-pressed=true] { background: var(--accent-soft); border-color: var(--accent); color: var(--accent-strong); font-weight: 600; }
  .fchip[aria-pressed=true]::before { content: "✓ "; }
  .fchip.saved { margin-left: auto; }
  .fchip .cnt { display: inline-block; min-width: 18px; padding: 0 5px; margin-left: 4px; border-radius: 99px; background: var(--accent); color: var(--on-accent); font-size: 11px; }
  .startcard { text-align: center; padding: 36px 18px; }
  .startcard p, .startcard h1 { margin: 0 0 14px; font: 400 17px/1.55 var(--sans); color: var(--muted); letter-spacing: 0; }
  .examples { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
  .examples + .examples { margin-top: 12px; }

  /* Results */
  .reshead { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px 20px; flex-wrap: wrap; }
  .reshead h1 { font-size: clamp(24px, 3.4vw, 34px); line-height: 1.15; margin: 0; }
  .reshead p { margin: 4px 0 0; }
  .resact { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .resact #getBtn { padding: 11px 24px; font-size: 16px; }
  .reslinks { display: flex; gap: 6px 16px; flex-wrap: wrap; font-size: 14px; width: 100%; }
  .results { padding: 0; overflow: hidden; }
  .bar { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--line); gap: 10px; flex-wrap: wrap; }
  .bar .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .pill { display: inline-block; padding: 1px 9px; border-radius: 99px; font-size: 12px; font-weight: 600; background: var(--chip); color: var(--muted); white-space: nowrap; }
  .pill.ok { background: var(--ok-soft); color: var(--ok); } .pill.bad { background: var(--bad-soft); color: var(--bad); } .pill.warn { background: var(--warn-soft); color: var(--warn); }
  .pill.strong { background: var(--strong); color: var(--panel); }
  .owned { display: inline-block; padding: 1px 8px; border-radius: 99px; font-size: 11px; font-weight: 700; background: var(--ok-soft); color: var(--ok); margin-left: 6px; white-space: nowrap; }
  .yes { color: var(--ok); font-weight: 700; }
  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line); white-space: nowrap; vertical-align: top; }
  th { font-size: 12px; color: var(--muted); font-weight: 600; background: var(--panel-2); }
  th .sortbtn { background: none; border: none; padding: 0; color: inherit; font-weight: 600; box-shadow: none; font-size: 12px; }
  th .sortbtn:hover { color: var(--accent); filter: none; }
  th[aria-sort=ascending] .sortbtn::after { content: " ▴"; } th[aria-sort=descending] .sortbtn::after { content: " ▾"; }
  /* Results: the column names stay in view under the header while scrolling (no scroll box around the table). */
  #resCard, #resCard .table-wrap { overflow: visible; }
  #resTable thead th { position: sticky; top: var(--hdrH); z-index: 5; box-shadow: inset 0 -1px 0 var(--line); }
  #resTable thead th:first-child { border-top-left-radius: var(--radius); } #resTable thead th:last-child { border-top-right-radius: var(--radius); }
  #resTable.norating .rating, #resTable.onecity .citycol { display: none; }
  #resTable td.name { min-width: 180px; }
  .mline { display: none; }
  .sortrow { display: none; align-items: center; gap: 6px; font-size: 14px; color: var(--muted); }
  .sortrow select { padding: 4px 8px; font-size: 14px; }
  .hiddennote { font-size: 14px; color: var(--muted); }
  table.picking tbody tr:not(.is-owned):not(.emptyrow) { cursor: pointer; }
  .selcol { display: none; width: 36px; }
  table.picking .selcol { display: table-cell; }
  td.name { white-space: normal; min-width: 200px; font-weight: 600; }
  td.name .sub { font-weight: 400; font-size: 13px; color: var(--muted); }
  td.wrap { white-space: normal; min-width: 160px; }
  tr.is-owned td { background: color-mix(in srgb, var(--ok-soft) 45%, transparent); }
  .fixes { font-size: 12px; font-weight: 400; color: var(--text); margin-top: 3px; white-space: normal; }
  .fixes b { color: var(--warn); font-weight: 600; }
  .facts { font-size: 12px; font-weight: 400; color: var(--muted); margin-top: 3px; white-space: normal; }
  .facts .pill { font-size: 11px; padding: 0 7px; }
  .empty { text-align: center; padding: 40px 20px !important; color: var(--muted); white-space: normal; }
  .suggest { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 12px; }
  .pager { display: flex; gap: 10px; align-items: center; justify-content: flex-end; padding: 10px 14px; flex-wrap: wrap; font-size: 13px; }
  .site { display: inline-block; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }

  /* Lists */
  .pagehead { display: flex; justify-content: space-between; align-items: flex-end; gap: 10px 16px; flex-wrap: wrap; }
  .pagehead h1 { font-size: clamp(24px, 3.2vw, 32px); margin: 0; }
  .lists { display: flex; flex-direction: column; gap: 10px; }
  .listcard { display: flex; justify-content: space-between; align-items: center; gap: 10px 16px; flex-wrap: wrap; }
  .listcard .lmain { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .listcard .lname { font-weight: 700; font-size: 16px; color: var(--head); overflow-wrap: anywhere; }
  .listcard .lact { display: flex; gap: 6px 8px; flex-wrap: wrap; align-items: center; }
  .menu.dlmenu { min-width: 200px; }
  .menu.left { right: auto; left: 0; }
  .morebtn { padding: 5px 12px; font-size: 16px; line-height: 1; }
  .listcard.all { border-color: var(--accent-line); }
  .dlrow { display: flex; gap: 8px; flex-wrap: wrap; }
  .backlink { font-size: 14px; }
  /* A list's full details fit the width: long emails and addresses wrap instead of pushing columns off-screen. */
  #view-list td[data-label="Email"], #view-list td[data-label="Website"] { white-space: normal; overflow-wrap: anywhere; min-width: 120px; }
  #view-list .site { max-width: 180px; }
  .listtools { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

  /* Map (isolation keeps Leaflet's own layers, z-index 400-1000, under dialogs and the sticky header) */
  #leadMap { height: 440px; position: relative; z-index: 0; isolation: isolate; background: var(--panel-2); }
  .maplegend { display: flex; gap: 6px 14px; flex-wrap: wrap; padding: 8px 14px; font-size: 12px; color: var(--muted); border-top: 1px solid var(--line); }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 5px; vertical-align: -1px; }
  .dot.weak { background: var(--bad); } .dot.basic { background: var(--warn); } .dot.good { background: var(--ok); } .dot.strong { background: var(--strong); }
  .dot.none { background: var(--muted); }
  .dot.own { background: var(--panel); box-shadow: inset 0 0 0 3px var(--ok); }
  .mappop { font: 13px/1.45 var(--sans); color: var(--text); min-width: 170px; }
  .mappop .cat { color: var(--muted); }
  .mappop .ln { margin-top: 3px; }
  .mappop button { margin-top: 8px; }
  /* Leaflet's own stylesheet loads after this one: these win by being more specific (dark mode too). */
  #leadMap .leaflet-popup-content-wrapper, #leadMap .leaflet-popup-tip { background: var(--panel); color: var(--text); box-shadow: var(--shadow-pop); }
  #leadMap .leaflet-popup-content { color: var(--text); }
  #leadMap a.leaflet-popup-close-button { color: var(--muted); }
  #leadMap .leaflet-bar a, #leadMap .leaflet-bar a:hover { background: var(--panel); color: var(--text); border-bottom-color: var(--line); }
  #leadMap .leaflet-bar { border-color: var(--line-strong); }
  #leadMap .leaflet-control-attribution { background: color-mix(in srgb, var(--panel) 85%, transparent); color: var(--muted); }
  #leadMap .leaflet-control-attribution a { color: var(--accent); }
  #leadMap.drawing, #leadMap.drawing .leaflet-interactive { cursor: crosshair; }

  /* Credits, team */
  .big { font-size: 30px; font-weight: 800; letter-spacing: -.02em; }
  .delta-pos { color: var(--ok); font-weight: 600; } .delta-neg { color: var(--bad); font-weight: 600; }
  .teamform { max-width: 520px; }
  .viewstack { display: flex; flex-direction: column; gap: 16px; }

  /* Dialogs + toast */
  dialog { border: none; border-radius: 16px; padding: 0; width: min(520px, calc(100vw - 32px)); background: var(--panel); color: var(--text); box-shadow: var(--shadow-pop); }
  dialog::backdrop { background: var(--backdrop); }
  .dlg-body { padding: 20px 22px; display: flex; flex-direction: column; gap: 12px; max-height: calc(100vh - 160px); overflow-y: auto; }
  .dlg-body h2 { font-size: 19px; margin: 0; }
  .dlg-body p { margin: 0; }
  .dlg-body ul { margin: 0; padding-left: 20px; }
  .dlg-foot { display: flex; gap: 10px; justify-content: flex-end; padding: 12px 22px; border-top: 1px solid var(--line); background: var(--panel-2); flex-wrap: wrap; }
  .quote { font-size: 17px; font-weight: 600; color: var(--head); }
  .mgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 16px; }
  .mgrid .wide { grid-column: 1 / -1; }
  fieldset { border: none; margin: 0; padding: 0; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
  legend, .flabel { font-size: 13px; color: var(--muted); font-weight: 500; padding: 0; margin-bottom: 2px; }
  .opt { display: flex; gap: 8px; align-items: center; font-size: 14px; cursor: pointer; color: var(--text); }
  .optrow { display: flex; gap: 6px 16px; flex-wrap: wrap; }
  .savedrow { display: flex; gap: 6px; align-items: center; }
  .savedrow select { flex: 1; min-width: 0; }
  .copyrow { display: flex; gap: 8px; align-items: center; }
  .copyrow input { flex: 1; min-width: 0; }
  .copyrow input[readonly] { font: 600 16px/1.3 ui-monospace, Menlo, Consolas, monospace; }
  .agreebox { display: flex; gap: 8px; align-items: flex-start; font-weight: 600; font-size: 14px; background: var(--warn-soft); color: var(--warn); border-radius: 10px; padding: 8px 10px; }
  .packs { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
  .pack { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; text-align: left; background: var(--panel); color: var(--text); border: 1px solid var(--line-strong); border-radius: 14px; padding: 14px 16px; font-weight: 500; box-shadow: none; }
  .pack:hover { border-color: var(--accent); filter: none; }
  .pack b { font-family: var(--serif); font-size: 22px; color: var(--head); }
  .pack .each { font-size: 12px; color: var(--muted); }
  .pack .go { margin-top: 6px; color: var(--accent); font-weight: 700; }
  .cf-turnstile { min-height: 65px; }
  .toast { position: fixed; left: 50%; bottom: 20px; transform: translate(-50%, 20px); opacity: 0; pointer-events: none; transition: opacity .2s, transform .2s;
    background: var(--invert-bg); color: var(--invert-text); padding: 10px 18px; border-radius: 12px; font-weight: 600; z-index: 60; max-width: calc(100vw - 32px);
    display: flex; gap: 10px; align-items: center; box-shadow: var(--shadow-pop); }
  .toast.show { opacity: 1; transform: translate(-50%, 0); pointer-events: auto; }
  .toast.bad { background: var(--bad); color: var(--on-accent); }
  .toast button { background: none; border: none; box-shadow: none; color: inherit; padding: 0 4px; font-size: 18px; line-height: 1; }

  /* Up to 960px wide, tables become cards: no sideways scrolling, no columns off-screen. */
  @media (max-width: 960px) {
    .table-wrap { overflow-x: visible; }
    table.cards thead { display: none; }
    table.cards, table.cards tbody, table.cards tr, table.cards td { display: block; width: 100%; }
    table.cards tr { position: relative; border-bottom: 1px solid var(--line); padding: 10px 12px; }
    table.cards.picking tr { padding-left: 44px; }
    table.cards tr.emptyrow { padding: 0; }
    table.cards td { border: none; padding: 1px 0; white-space: normal; min-width: 0; text-align: left; background: none; overflow-wrap: anywhere; }
    table.cards td.selcol { display: none; }
    table.cards.picking td.selcol { display: block; position: absolute; left: 12px; top: 12px; width: auto; padding: 0; }
    table.cards td[data-label]::before { content: attr(data-label) ": "; color: var(--muted); font-size: 12px; }
    table.cards td.name { font-size: 15px; min-width: 0; }
    /* Search results: one compact card per lead (name + category, then one line of details). */
    #resTable tbody td:not(.name):not(.selcol):not(.empty) { display: none; }
    #resTable .mline { display: block; font-weight: 400; font-size: 13px; color: var(--text); margin-top: 2px; }
    #resTable .mline .yes { font-weight: 600; }
    .sortrow { display: flex; }
    .site { max-width: 100%; }
  }
  /* A list's full details have six wide columns: cards up to 1100px, so nothing scrolls sideways. */
  @media (min-width: 961px) and (max-width: 1100px) {
    #view-list table.cards thead { display: none; }
    #view-list table.cards, #view-list table.cards tbody, #view-list table.cards tr, #view-list table.cards td { display: block; width: 100%; }
    #view-list table.cards tr { border-bottom: 1px solid var(--line); padding: 10px 14px; }
    #view-list table.cards tr.emptyrow { padding: 0; }
    #view-list table.cards td { border: none; padding: 1px 0; white-space: normal; min-width: 0; overflow-wrap: anywhere; }
    #view-list table.cards td[data-label]::before { content: attr(data-label) ": "; color: var(--muted); font-size: 12px; }
    #view-list .site { max-width: 100%; }
  }
  @media (max-width: 760px) {
    /* One compact header row (brand, balance, Account, theme); the tabs go below it. */
    header { padding: 8px 12px; gap: 6px 8px; }
    .brand { flex: 0 1 auto; }
    .logoimg { height: 26px; max-width: 110px; padding: 3px 6px; }
    .wordmark { font-size: 17px; }
    .wordmark span { display: none; }
    .hdrname small { display: none; }
    .hdr-right, .hdr-acct { flex-wrap: nowrap; gap: 6px; }
    .hdr-right .balance { font-size: 12px; padding: 3px 9px; }
    .hdr-right .balance .balfree { display: none; }
    #acctBtn { padding: 4px 10px; }
    .theme-btn { width: 30px; height: 30px; }
    .tabs { order: 3; width: 100%; }
    .tab { flex: 1; padding: 6px 10px; }
    .demobar { padding: 6px 12px; font-size: 13px; }
    main { padding: 12px 12px 32px; gap: 12px; }
    .card { padding: 12px; border-radius: 12px; }
    .results { padding: 0; }
    .bar { padding: 10px; }
    .auth { padding-top: 8px; grid-template-columns: minmax(0, 1fr); }
    .searchrow { grid-template-columns: minmax(0, 1fr); border-radius: 16px; }
    .sbox { border-right: none; border-bottom: 1px solid var(--line); border-radius: 10px; }
    .gobox { padding: 6px 0 0; }
    .gobox button { width: 100%; }
    /* The filters: one row that scrolls sideways (the fade says there is more). */
    .chiprow { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; margin: 0 -12px; padding: 2px 12px;
      -webkit-mask-image: linear-gradient(90deg, #000 85%, transparent); mask-image: linear-gradient(90deg, #000 85%, transparent); }
    .chiprow::-webkit-scrollbar { display: none; }
    .chiprow.atend { -webkit-mask-image: none; mask-image: none; }
    .chipwrap .menu { right: 12px; }
    .fchip { flex: none; white-space: nowrap; }
    .fchip.saved { margin-left: 0; }
    .resact { width: 100%; }
    .resact #getBtn { flex: 1 1 auto; }
    .mgrid { grid-template-columns: minmax(0, 1fr); }
    #leadMap { height: 340px; }
    .listcard .lact { width: 100%; }
    /* The card buttons sit on the left on phones: their menus open rightwards and stay on screen. */
    .listcard .menu { min-width: 180px; }
    .listcard .menu.dlmenu, .pagehead .menu { right: auto; left: 0; }
  }
`;

export function storeHtml(brand: StoreBrand): string {
  const rawName = String(brand?.name ?? "").trim() || "Lead Store";
  const name = esc(rawName);
  const color = safeColor(brand?.color);
  const support = esc(String(brand?.supportEmail ?? "").trim());
  const logo = safeLogo(brand?.logoUrl);
  const signupOpen = brand?.signupOpen !== false;
  const signup = signupOpen ? "1" : "0";
  const demo = brand?.demo === true;
  const ts = !demo && /^[0-9A-Za-z_-]{1,100}$/.test(String(brand?.turnstileSiteKey ?? "")) ? String(brand.turnstileSiteKey) : "";
  const tsBox = ts ? `<div class="cf-turnstile" data-sitekey="${esc(ts)}" data-theme="auto"></div>` : "";
  const cp = typeof brand?.creditPrice === "number" && Number.isFinite(brand.creditPrice) && brand.creditPrice >= 0 ? String(brand.creditPrice) : "";
  const demoCta = signupOpen ? `<a class="btnlink" id="demoCta" href="/app#signup">Create a free account</a>` : `<a class="btnlink" id="demoCta" href="/contact?subject=access">Request access</a>`;
  // Tab icon: the brand colour with the name's first letter (only a plain letter or digit goes in the SVG).
  const initial = (/^[A-Za-z0-9]/.exec(rawName)?.[0] ?? "L").toUpperCase();
  const favicon = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='${color}'/>`
    + `<text x='32' y='45' font-family='Arial,Helvetica,sans-serif' font-size='38' font-weight='700' text-anchor='middle' fill='#ffffff'>${initial}</text></svg>`);
  return /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#FBF5EA">
<title>${demo ? `Demo · ${name}` : name}</title>
<link rel="icon" href="${esc(favicon)}">
${FONT_LINKS}
${THEME_BOOT}
<style>${themeCss(color)}${CSS}</style>
${ts ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ""}
</head>
<body data-brand="${name}" data-support="${support}" data-signup="${signup}" data-credit-price="${esc(cp)}" data-turnstile="${ts ? "1" : ""}" data-demo="${demo ? "1" : ""}">
<header>
  <div class="brand"><a class="homelink" href="/" title="Go to the website">${logo ? `<img class="logoimg" src="${esc(logo)}" alt="${name}">` : `<div class="wordmark" aria-hidden="true">${name}<span>Local leads</span></div><span class="sr-only">${name} website</span>`}</a><div class="hdrname"><span id="brandName" class="sr">${name}</span><small id="hdrCompany"></small></div></div>
  <nav class="tabs" id="appNav" aria-label="Sections" hidden>
    <button type="button" class="tab" data-tab="find">Search</button>
    <button type="button" class="tab" data-tab="lists">Your lists</button>
  </nav>
  <div class="hdr-right">
    <div class="hdr-acct" id="hdrAcct" hidden>
      <div class="menuwrap">
        <button type="button" class="balance" id="hdrBal" aria-haspopup="true" aria-expanded="false" aria-controls="balMenu"></button>
        <div class="menu" id="balMenu" hidden>
          <div class="who" id="balWho"></div>
          <button type="button" id="balBuy">Buy credits</button>
          <button type="button" id="balHist">Credits</button>
        </div>
      </div>
      <div class="menuwrap">
        <button type="button" class="ghost small" id="acctBtn" aria-haspopup="true" aria-expanded="false" aria-controls="acctMenu">Account ▾</button>
        <div class="menu" id="acctMenu" hidden>
          <div class="who" id="acctWho"></div>
          <button type="button" id="teamBtn">Team</button>
          <button type="button" id="pwBtn">Change password</button>
          <button type="button" id="helpBtn">Help</button>
          <button type="button" id="logoutBtn">Sign out</button>
        </div>
      </div>
    </div>
    ${THEME_BUTTON}
  </div>
</header>
<div class="demobar" id="demoBar" role="note"${demo ? "" : " hidden"}><span>Demo: sample businesses. Nothing here is real or charged.</span> ${demoCta}</div>

<main>
  <div id="bootView" class="card" role="status"><span id="bootMsg">Loading…</span></div>

  <section id="outView" hidden>
    <div class="intro">
      <h1>Local business leads, ready to call</h1>
      <p class="muted">See how many match for free. Pay only for the leads you get.</p>
      <p><a class="btnlink ghost" href="/demo" id="demoLink">Try the demo</a></p>
    </div>
    <div class="auth">
      <div class="card">
        <h2>Sign in</h2>
        <form class="stack" id="loginForm" novalidate>
          <label class="field">Email<input type="email" id="loginEmail" autocomplete="username" required></label>
          <label class="field">Password<span class="pwwrap"><input type="password" id="loginPass" autocomplete="current-password" required><button type="button" class="pwtoggle" data-pw="loginPass" aria-pressed="false" aria-label="Show password">Show</button></span></label>
          <div id="loginMsg" class="err" role="alert"></div>
          <button type="submit" id="loginBtn">Sign in</button>
          <button type="button" class="link" id="forgotBtn" style="align-self:flex-start">Forgot your password?</button>
        </form>
        <form class="stack" id="forgotForm" novalidate hidden>
          <p class="muted" style="margin:0">We'll email you a link to choose a new password.</p>
          <label class="field">Email<input type="email" id="forgotEmail" autocomplete="username" required></label>
          ${tsBox}
          <div id="forgotMsg" class="err" role="alert"></div>
          <button type="submit" id="forgotSend">Send me the link</button>
          <button type="button" class="link" id="forgotBack" style="align-self:flex-start">Back to sign in</button>
        </form>
      </div>
      <div class="card" id="signupCard">
        <h2 id="signupTitle">Create a free account</h2>
        <p class="banner info" id="signupFor" hidden style="margin:0 0 10px"></p>
        <form class="stack" id="signupForm" novalidate>
          <label class="field">Company<input type="text" id="suCompany" autocomplete="organization" required maxlength="120"></label>
          <label class="field">Your name<input type="text" id="suName" autocomplete="name" required maxlength="120"></label>
          <label class="field">Email<input type="email" id="suEmail" autocomplete="email" required maxlength="200"></label>
          <label class="field">Password (at least 10 characters)<span class="pwwrap"><input type="password" id="suPass" autocomplete="new-password" required minlength="10"><button type="button" class="pwtoggle" data-pw="suPass" aria-pressed="false" aria-label="Show password">Show</button></span></label>
          <label class="field">Repeat password<span class="pwwrap"><input type="password" id="suPass2" autocomplete="new-password" required minlength="10"><button type="button" class="pwtoggle" data-pw="suPass2" aria-pressed="false" aria-label="Show password">Show</button></span></label>
          <div id="signupMsg" class="err" role="alert"></div>
          ${tsBox}
          <p class="agree">By creating an account you agree to the <a href="/legal/terms" target="_blank" rel="noopener">Terms</a> and <a href="/legal/privacy" target="_blank" rel="noopener">Privacy policy</a>.</p>
          <button type="submit" id="signupBtn">Create account</button>
        </form>
        <div id="signupDone" hidden role="status"></div>
      </div>
      <div class="card" id="signupClosed" hidden>
        <h2>New accounts</h2>
        <p class="muted" id="signupClosedMsg"></p>
      </div>
    </div>
  </section>

  <section id="appView" hidden>
    <div id="banner" class="banner" role="status" hidden style="margin-bottom:16px"></div>

    <div id="view-find" class="viewstack" hidden>
      <form id="searchForm" class="searchrow" role="search" novalidate>
        <div class="sbox">
          <label for="qWhat">What</label>
          <div class="tokwrap"><span id="whatTokens" class="tokwrap"></span><input type="text" id="qWhat" name="ls-what-q" data-lpignore="true" data-1p-ignore placeholder="Plumbers, dentists…" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="whatList"></div>
          <ul class="sugg" id="whatList" role="listbox" aria-label="Categories" hidden></ul>
        </div>
        <div class="sbox">
          <label for="qWhere">Where</label>
          <div class="tokwrap"><span id="whereTokens" class="tokwrap"></span><input type="text" id="qWhere" name="ls-where-q" data-lpignore="true" data-1p-ignore placeholder="City or state" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="whereList"></div>
          <div class="radiusrow" id="radiusRow" hidden><select id="qRadius" aria-label="Distance"><option value="">Just this city</option><option value="10">Within 10 miles</option><option value="25">Within 25 miles</option><option value="50">Within 50 miles</option></select></div>
          <ul class="sugg" id="whereList" role="listbox" aria-label="Places" hidden></ul>
        </div>
        <div class="gobox"><button type="submit" id="searchBtn">Search</button></div>
      </form>
      <div class="menuwrap chipwrap">
        <div class="chiprow" id="chipRow" role="group" aria-label="Filters">
          <button type="button" class="fchip" data-chip="phone" aria-pressed="false">Has phone</button>
          <button type="button" class="fchip" data-chip="email" aria-pressed="false">Has email</button>
          <button type="button" class="fchip" data-chip="owner" aria-pressed="false">Has owner name</button>
          <button type="button" class="fchip" data-chip="noweb" aria-pressed="false">No website</button>
          <button type="button" class="fchip" data-chip="weak" aria-pressed="false">Weak online presence</button>
          <button type="button" class="fchip" data-chip="google" aria-pressed="false">With Google rating</button>
          <button type="button" class="fchip" id="moreBtn" aria-haspopup="dialog">More filters<span class="cnt" id="moreCount" hidden></span></button>
          <button type="button" class="fchip saved" id="savedBtn" aria-haspopup="true" aria-expanded="false" aria-controls="savedMenu" hidden>Saved ▾</button>
        </div>
        <div class="menu" id="savedMenu" hidden></div>
      </div>
      <div id="findMsg" class="err" role="alert"></div>

      <div class="card startcard" id="startCard">
        <h1>Find local businesses to sell to.</h1>
        <div class="examples" id="examples"></div>
        <div class="examples" id="savedQuick" hidden></div>
      </div>

      <div class="card results" id="mapCard" hidden>
        <div class="bar">
          <div id="mapInfo" class="hint" role="status"></div>
          <div class="actions">
            <button type="button" class="ghost small" id="mapDraw" aria-pressed="false">Draw an area</button>
            <button type="button" class="small" id="mapUse" hidden>Use this area</button>
            <button type="button" class="ghost small" id="mapClear" hidden>Clear area</button>
          </div>
        </div>
        <div id="leadMap" role="region" aria-label="Map of the matching businesses"></div>
        <div class="maplegend"><span><span class="dot weak"></span>Weak</span><span><span class="dot basic"></span>Basic</span><span><span class="dot good"></span>Good</span><span><span class="dot strong"></span>Strong</span><span><span class="dot none"></span>No website or not checked</span><span><span class="dot own"></span>Yours</span></div>
      </div>

      <div id="resultsArea" class="viewstack" hidden>
        <div class="reshead">
          <div>
            <h1 id="resTitle"></h1>
            <p class="hint" id="resSub">Contact details show once you get them</p>
          </div>
          <div class="resact">
            <button type="button" class="ghost" id="mapBtn" aria-pressed="false" aria-controls="mapCard">Map</button>
            <button type="button" id="getBtn" disabled>Get leads</button>
          </div>
          <div class="reslinks">
            <button type="button" class="link" id="pickBtn" aria-pressed="false">Pick individual leads</button>
            <button type="button" class="link" id="saveSearch">Save search</button>
            <span class="hiddennote" id="hiddenNote" hidden></span>
            <label class="sortrow" id="sortRow">Sort <select id="sortSel" aria-label="Sort the results"></select></label>
          </div>
        </div>
        <span class="sr-only" id="srLive" aria-live="polite"></span>
        <div class="card results" id="resCard">
          <div class="table-wrap">
            <table class="cards" id="resTable">
              <thead><tr>
                <th scope="col" class="selcol"><input type="checkbox" id="selAll" aria-label="Pick all on this page"></th>
                <th scope="col" data-col="name"><button type="button" class="sortbtn" data-sort="name">Business</button></th>
                <th scope="col" class="citycol">City</th>
                <th scope="col">Phone</th>
                <th scope="col">Email</th>
                <th scope="col">Owner</th>
                <th scope="col" data-col="score"><button type="button" class="sortbtn" data-sort="score">Online</button></th>
                <th scope="col" data-col="rating" class="rating"><button type="button" class="sortbtn" data-sort="rating">Rating</button></th>
              </tr></thead>
              <tbody id="resBody"></tbody>
            </table>
          </div>
          <div class="pager" id="resPager"></div>
        </div>
      </div>
    </div>

    <div id="view-lists" class="viewstack" hidden>
      <div class="pagehead"><h1>Your lists</h1></div>
      <div class="lists" id="listsBody"></div>
    </div>

    <div id="view-list" class="viewstack" hidden>
      <div><button type="button" class="link backlink" id="listBack">‹ Your lists</button></div>
      <div class="pagehead">
        <div>
          <h1 id="lvName"></h1>
          <p class="hint" id="lvMeta" style="margin:4px 0 0"></p>
        </div>
        <div class="menuwrap" id="lvDl">
          <button type="button" data-menu="lvDlMenu" aria-haspopup="true" aria-expanded="false" aria-controls="lvDlMenu">Download ▾</button>
          <div class="menu dlmenu" id="lvDlMenu" hidden>
            <button type="button" data-dl="simple">Spreadsheet (CSV)</button>
            <button type="button" data-dl="cold_email">For cold email</button>
            <button type="button" data-dl="json">JSON</button>
          </div>
        </div>
      </div>
      <div class="listtools">
        <input type="search" id="lvSearch" placeholder="Search by name" aria-label="Search this list by name">
        <button type="button" class="link" id="lvRename">Rename</button>
        <button type="button" class="link danger" id="lvDelete">Delete list</button>
        <span class="hint" id="lvDlNote" hidden>Downloads always have the whole list.</span>
      </div>
      <div class="card results">
        <div class="table-wrap">
          <table class="cards">
            <thead><tr>
              <th scope="col">Business</th><th scope="col">Phone</th><th scope="col">Email</th><th scope="col">Owner</th>
              <th scope="col">Website</th><th scope="col">Address</th>
            </tr></thead>
            <tbody id="lvBody"></tbody>
          </table>
        </div>
        <div class="pager" id="lvPager"></div>
      </div>
    </div>

    <div id="view-credits" class="viewstack" hidden>
      <div class="pagehead"><h1>Credits</h1></div>
      <div class="card">
        <div class="big" id="crBalance"></div>
        <p id="crValue" class="muted" style="margin:0" hidden></p>
        <p id="crFree" class="okmsg" style="margin:6px 0;font-weight:600" hidden></p>
        <p id="crPrices" class="hint" style="margin:6px 0"></p>
        <p style="margin:10px 0 0"><button type="button" id="crMore">Buy credits</button></p>
      </div>
      <div class="card" id="crPacksCard" hidden>
        <h2 style="margin:0 0 4px">Buy credits</h2>
        <p class="hint" style="margin:0 0 12px">Pay by card. Credits never expire.</p>
        <div class="packs" id="crPacks"></div>
      </div>
      <div class="card results">
        <div class="bar"><h2 style="margin:0">History</h2></div>
        <div class="table-wrap">
          <table class="cards">
            <thead><tr><th scope="col">When</th><th scope="col">What</th><th scope="col">Who</th><th scope="col">Change</th><th scope="col">Balance</th></tr></thead>
            <tbody id="crBody"></tbody>
          </table>
        </div>
      </div>
    </div>

    <div id="view-team" class="viewstack" hidden>
      <div class="pagehead"><h1>Team</h1></div>
      <div class="card banner info" id="teamDemo" hidden></div>
      <div class="card results">
        <div class="bar"><h2 style="margin:0">People</h2><span class="hint" id="teamHint"></span></div>
        <div class="table-wrap">
          <table class="cards">
            <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Last sign-in</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
            <tbody id="teamBody"></tbody>
          </table>
        </div>
      </div>
      <div class="card" id="teamAddCard" hidden>
        <h2>Add a person</h2>
        <p class="hint" style="margin-top:0">They share this account's credits and lists.</p>
        <form class="stack teamform" id="teamForm" novalidate>
          <label class="field">Name<input type="text" id="tmName" autocomplete="off" required maxlength="120"></label>
          <label class="field">Email<input type="email" id="tmEmail" autocomplete="off" required maxlength="200"></label>
          <div id="teamMsg" class="err" role="alert"></div>
          <div><button type="submit" id="teamAddBtn">Add person</button></div>
        </form>
      </div>
    </div>
  </section>
</main>

<dialog id="moreDlg" aria-labelledby="moreTitle">
  <form id="moreForm" novalidate>
    <div class="dlg-body">
      <h2 id="moreTitle">More filters</h2>
      <div class="mgrid">
        <label class="field" id="mRatingBox">Google rating<select id="mRating"><option value="">Any</option><option value="3">3 ★ and up</option><option value="3.5">3.5 ★ and up</option><option value="4">4 ★ and up</option><option value="4.5">4.5 ★ and up</option></select></label>
        <div class="optrow" id="mRevBox" style="align-items:flex-end">
          <label class="field" style="flex:1">Reviews from<input type="number" id="mMinRev" min="0" step="1" inputmode="numeric"></label>
          <label class="field" style="flex:1">to<input type="number" id="mMaxRev" min="0" step="1" inputmode="numeric"></label>
        </div>
        <fieldset class="wide"><legend>Online presence</legend>
          <div class="optrow">
            <label class="opt"><input type="checkbox" name="mScore" value="weak"> <span class="pill bad">Weak</span></label>
            <label class="opt"><input type="checkbox" name="mScore" value="basic"> <span class="pill warn">Basic</span></label>
            <label class="opt"><input type="checkbox" name="mScore" value="good"> <span class="pill ok">Good</span></label>
            <label class="opt"><input type="checkbox" name="mScore" value="strong"> <span class="pill strong">Strong</span></label>
          </div>
        </fieldset>
        <fieldset><legend>Website</legend>
          <div class="optrow">
            <label class="opt"><input type="radio" name="mWeb" value="" checked> Any</label>
            <label class="opt"><input type="radio" name="mWeb" value="yes"> Has one</label>
            <label class="opt"><input type="radio" name="mWeb" value="no_real"> None</label>
          </div>
        </fieldset>
        <fieldset id="mTierBox"><legend>Lead type</legend>
          <div class="optrow">
            <label class="opt"><input type="radio" name="mTier" value="" checked> Any</label>
            <label class="opt"><input type="radio" name="mTier" value="free"> Standard <span class="hint" id="priceFreeLbl"></span></label>
            <label class="opt"><input type="radio" name="mTier" value="google"> With Google rating <span class="hint" id="priceGoogleLbl"></span></label>
          </div>
        </fieldset>
        <label class="field">ZIP codes<input type="text" id="mZip" placeholder="33101, 33102" inputmode="numeric"></label>
        <label class="field">Name contains<input type="search" id="mName"></label>
        <div class="field">Area on the map
          <div class="optrow" style="align-items:center"><span id="mAreaTxt" style="color:var(--text)">None</span><button type="button" class="ghost small" id="mAreaDraw">Draw on the map</button><button type="button" class="link" id="mAreaClear" hidden>Clear</button></div>
        </div>
        <label class="field">Sort<select id="mSort">
          <option value="best:desc">Most contact details first</option><option value="score:asc">Weakest online first</option><option value="score:desc">Strongest online first</option>
          <option value="rating:desc" data-rating>Highest rating</option><option value="reviews:desc" data-rating>Most reviews</option><option value="reviews:asc" data-rating>Fewest reviews</option>
          <option value="name:asc">Name, A to Z</option>
        </select></label>
        <label class="opt wide"><input type="checkbox" id="mHideOwned" checked> Hide leads I already have</label>
        <div class="field wide">Saved searches <span class="hint">(up to 50)</span>
          <div class="savedrow">
            <select id="savedSel" aria-label="Saved searches"><option value="">None yet</option></select>
            <button type="button" class="ghost small" id="savedUse" disabled>Use</button>
            <button type="button" class="ghost small" id="savedDel" disabled aria-label="Delete the chosen saved search">Delete</button>
          </div>
        </div>
      </div>
    </div>
    <div class="dlg-foot">
      <button type="button" class="ghost" id="moreClear">Clear all</button>
      <button type="button" class="ghost" id="moreCancel">Cancel</button>
      <button type="submit" id="moreApply">Show results</button>
    </div>
  </form>
</dialog>

<dialog id="buyDlg" aria-labelledby="buyTitle">
  <div class="dlg-body">
    <h2 id="buyTitle">Get leads</h2>
    <div id="buyNote" class="banner warn" hidden></div>
    <p id="buyText" class="quote" role="status"></p>
    <label class="agreebox" id="buyAgreeBox" hidden><input type="checkbox" id="buyAgree"> <span id="buyAgreeText"></span></label>
    <div id="buyErr" class="err" role="alert"></div>
  </div>
  <div class="dlg-foot">
    <button type="button" class="ghost" id="buyCancel">Cancel</button>
    <button type="button" class="ghost" id="buyPart" hidden></button>
    <button type="button" id="buyMore" hidden>Buy credits</button>
    <button type="button" id="buyConfirm" hidden>Get the leads</button>
  </div>
</dialog>

<dialog id="doneDlg" aria-labelledby="doneTitle">
  <div class="dlg-body">
    <h2 id="doneTitle">List saved</h2>
    <p id="doneText" class="quote" role="status"></p>
    <p id="doneHint" class="hint"></p>
    <div class="dlrow" id="doneDl">
      <button type="button" data-dl="simple">Download spreadsheet</button>
      <button type="button" class="ghost" data-dl="cold_email">For cold email</button>
      <button type="button" class="ghost" data-dl="json">JSON</button>
    </div>
  </div>
  <div class="dlg-foot">
    <button type="button" class="ghost" id="doneLists">See your lists</button>
    <button type="button" class="ghost" id="doneKeep">Keep searching</button>
  </div>
</dialog>

<dialog id="askDlg" aria-labelledby="askTitle">
  <form id="askForm" novalidate>
    <div class="dlg-body">
      <h2 id="askTitle"></h2>
      <div id="askText"></div>
      <div id="askField" hidden>
        <label class="field" for="askInput" id="askLabel"></label>
        <div class="copyrow"><input type="text" id="askInput" maxlength="120" autocomplete="off"><button type="button" class="ghost small" id="askCopy" hidden>Copy</button></div>
      </div>
      <div id="askMsg" class="hint" role="status"></div>
    </div>
    <div class="dlg-foot">
      <button type="button" class="ghost" id="askCancel">Cancel</button>
      <button type="submit" id="askOk">OK</button>
    </div>
  </form>
</dialog>

<dialog id="resetDlg" aria-labelledby="resetTitle">
  <form id="resetForm" novalidate>
    <div class="dlg-body">
      <h2 id="resetTitle">Choose a new password</h2>
      <label class="field">New password (at least 10 characters)<span class="pwwrap"><input type="password" id="rsNew" autocomplete="new-password" required minlength="10"><button type="button" class="pwtoggle" data-pw="rsNew" aria-pressed="false" aria-label="Show password">Show</button></span></label>
      <label class="field">Repeat new password<span class="pwwrap"><input type="password" id="rsNew2" autocomplete="new-password" required minlength="10"><button type="button" class="pwtoggle" data-pw="rsNew2" aria-pressed="false" aria-label="Show password">Show</button></span></label>
      <div id="rsMsg" class="err" role="alert"></div>
    </div>
    <div class="dlg-foot">
      <button type="button" class="ghost" id="rsCancel">Cancel</button>
      <button type="submit" id="rsSave">Save the new password</button>
    </div>
  </form>
</dialog>

<dialog id="pwDlg" aria-labelledby="pwTitle">
  <form id="pwForm" novalidate>
    <div class="dlg-body">
      <h2 id="pwTitle">Change password</h2>
      <p id="pwNote" class="banner warn" hidden style="margin:0">Choose your own password to continue.</p>
      <label class="field">Current password<span class="pwwrap"><input type="password" id="pwCur" autocomplete="current-password" required><button type="button" class="pwtoggle" data-pw="pwCur" aria-pressed="false" aria-label="Show password">Show</button></span></label>
      <label class="field">New password (at least 10 characters)<span class="pwwrap"><input type="password" id="pwNew" autocomplete="new-password" required minlength="10"><button type="button" class="pwtoggle" data-pw="pwNew" aria-pressed="false" aria-label="Show password">Show</button></span></label>
      <label class="field">Repeat new password<span class="pwwrap"><input type="password" id="pwNew2" autocomplete="new-password" required minlength="10"><button type="button" class="pwtoggle" data-pw="pwNew2" aria-pressed="false" aria-label="Show password">Show</button></span></label>
      <div id="pwMsg" class="err" role="alert"></div>
    </div>
    <div class="dlg-foot">
      <button type="button" class="ghost" id="pwCancel">Cancel</button>
      <button type="submit" id="pwSave">Change password</button>
    </div>
  </form>
</dialog>

<div id="toast" class="toast" aria-live="polite"><span id="toastMsg"></span><button type="button" id="toastX" aria-label="Dismiss message" hidden>×</button></div>
<span id="colorProbe" hidden></span>

<script>
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Only normal web addresses become links. (No slashes escaped: this script sits inside a template string.)
const isWebLink = (u) => typeof u === "string" && /^https?:[/][/]/i.test(u);
const num = (v) => Number(v || 0).toLocaleString("en-US");
const plural = (n, word) => num(n) + " " + word + (Number(n) === 1 ? "" : "s");
const PAGE_SIZE = 50;
const MAX_BUY = 5000;
const API_TIMEOUT = 15000;
const MAX_SAVED = 50; // the same cap as the server ("You can keep up to 50 saved searches")
const BIG_SPEND = 500; // above this many credits, the buyer ticks "I understand" first
// The no-login demo (/demo): everything runs on made-up data in this page (makeDemo), no API calls.
const DEMO = document.body.dataset.demo === "1";
const NL = String.fromCharCode(13, 10);
const NO = '<span class="muted" title="No">—</span>';
// Sign-ups closed: every "Request access" goes to the contact form with that subject.
const ACCESS_HREF = "/contact?subject=access";
const YES = '<span class="yes" title="Yes">✓</span>';

const STATES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming" };

const BRAND = {
  name: document.body.dataset.brand || "Lead Store", supportEmail: document.body.dataset.support || "",
  signupOpen: document.body.dataset.signup !== "0", prices: null,
  creditPrice: document.body.dataset.creditPrice === "" ? null : Number(document.body.dataset.creditPrice),
  packs: [], cardPayments: false, emails: false, turnstile: document.body.dataset.turnstile === "1",
};
/** The "I'm human" answer inside a form (when the check is on). */
function humanToken(formId) {
  const f = document.querySelector("#" + formId + " [name=cf-turnstile-response]");
  return f ? f.value : "";
}
function resetHuman(formId) {
  const box = document.querySelector("#" + formId + " .cf-turnstile");
  try { if (box && window.turnstile) window.turnstile.reset(box); } catch (e) { /* ignore */ }
}
let me = null;
let signedIn = false;

// Browser storage is a convenience only (private windows can refuse it). The demo keeps nothing.
function lsGet(k) { if (DEMO) return null; try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { if (DEMO) return; try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

async function api(path, opts) {
  if (DEMO) return demoApi(path, opts); // never the network in the demo
  let res;
  // Give up after 15 seconds so a stuck request shows a message instead of spinning forever.
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), API_TIMEOUT) : null;
  try { res = await fetch(path, Object.assign({ credentials: "same-origin" }, ctl ? { signal: ctl.signal } : {}, opts || {})); }
  catch (e) {
    clearTimeout(timer);
    throw new Error(ctl && ctl.signal.aborted ? "The store is taking too long to answer. Please try again." : "Can't reach the store. Check your internet connection and try again.");
  }
  const body = await res.json().catch(() => ({}));
  clearTimeout(timer);
  if (res.status === 401 && signedIn) { showSignedOut("Your session ended. Please sign in again."); }
  if (!res.ok) { const e = new Error(body.error || "Something went wrong (" + res.status + "). Please try again."); e.status = res.status; e.body = body; throw e; }
  return body;
}
const postJson = (path, body) => api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });

let demoEngine = null;
async function demoApi(path, opts) {
  if (!demoEngine) demoEngine = makeDemo();
  const o = opts || {};
  let body = null;
  try { body = o.body ? JSON.parse(o.body) : null; } catch (e) { body = null; }
  await new Promise((ok) => setTimeout(ok, 90));
  return demoEngine.handle(o.method || "GET", path, body);
}

function money(n) { return Number(n).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
/** "$99" for whole dollars, else "$99.50". */
function dollars(n) { const v = Number(n); const whole = Math.abs(v - Math.round(v)) < 0.005; return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }); }
function creditPrice() { const p = BRAND.creditPrice; return typeof p === "number" && Number.isFinite(p) && p >= 0 ? p : null; }
function approx(credits) { const p = creditPrice(); return p == null ? "" : " (≈ " + dollars(p * Number(credits || 0)) + ")"; }

// How to reach the team, to finish a sentence: "email help@x.com" or "use our contact page" (links).
function contactHtml() {
  return BRAND.supportEmail ? 'email <a href="mailto:' + esc(BRAND.supportEmail) + '">' + esc(BRAND.supportEmail) + "</a>" : 'use our <a href="/contact" target="_blank" rel="noopener">contact page</a>';
}
function contactSentence() { const s = contactHtml(); return s.charAt(0).toUpperCase() + s.slice(1); }
function mailto(subject) { return "mailto:" + BRAND.supportEmail + "?subject=" + encodeURIComponent(subject); }
function prices() {
  const p = (me && me.prices) || BRAND.prices || {};
  return { free: p.free, google: p.google };
}

let toastTimer = null;
// Errors stay until dismissed (×); other messages, and brief notes (brief = true), go away by themselves.
function toast(msg, bad, brief) {
  const t = $("toast");
  $("toastMsg").textContent = msg;
  t.className = "toast show" + (bad ? " bad" : "");
  t.setAttribute("role", bad ? "alert" : "status");
  $("toastX").hidden = !bad;
  clearTimeout(toastTimer);
  if (!bad || brief) toastTimer = setTimeout(hideToast, bad ? 6000 : 4500);
}
function hideToast() { $("toast").className = "toast"; $("toastX").hidden = true; }
$("toastX").addEventListener("click", hideToast);

// The sticky table head sits right under the sticky header, whatever its height (one or two rows).
function syncHeaderHeight() { const h = document.querySelector("header"); if (h) document.documentElement.style.setProperty("--hdrH", h.offsetHeight + "px"); }
try { new ResizeObserver(syncHeaderHeight).observe(document.querySelector("header")); } catch (e) { window.addEventListener("resize", syncHeaderHeight); }
syncHeaderHeight();

function fmtDate(v, dateOnly) {
  if (v == null || v === "") return "";
  let d;
  if (typeof v === "number") d = new Date(v < 1e12 ? v * 1000 : v);
  else if (/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:/.test(String(v))) d = new Date(String(v).replace(" ", "T") + "Z");
  else d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return dateOnly ? d.toLocaleDateString(undefined, { dateStyle: "medium" }) : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/* ---------- In-page dialogs (instead of the browser's prompt / confirm / alert) ---------- */
let askResolve = null;
function openAsk(o) {
  $("askTitle").textContent = o.title || "";
  $("askText").innerHTML = o.html || "";
  const inp = $("askInput");
  $("askField").hidden = !o.input && !o.copy;
  $("askLabel").textContent = o.label || "";
  inp.value = o.value || "";
  inp.readOnly = !!o.copy;
  $("askCopy").hidden = !o.copy;
  $("askCopy").textContent = "Copy";
  $("askOk").textContent = o.okLabel || "OK";
  // okGhost: the dialog's own content holds the one main (orange) button, so Close stays plain.
  $("askOk").className = o.danger ? "danger" : o.okGhost ? "ghost" : "";
  $("askCancel").textContent = o.cancelLabel || "Cancel";
  $("askCancel").hidden = !!o.noCancel;
  $("askMsg").textContent = "";
  if (askResolve) { const r = askResolve; askResolve = null; r(null); }
  return new Promise((resolve) => {
    askResolve = resolve;
    if (!$("askDlg").open) $("askDlg").showModal();
    if (o.input) { inp.focus(); inp.select(); }
    else if (o.copy) $("askCopy").focus();
    else if (o.noCancel) $("askOk").focus();
    else $("askCancel").focus(); // the safe choice is the default
  });
}
function closeAsk(v) {
  const r = askResolve;
  askResolve = null;
  if ($("askDlg").open) $("askDlg").close();
  if (r) r(v);
}
$("askForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const inp = $("askInput");
  closeAsk(!$("askField").hidden && !inp.readOnly ? inp.value : true);
});
$("askCancel").addEventListener("click", () => closeAsk(null));
$("askDlg").addEventListener("close", () => { if (askResolve) { const r = askResolve; askResolve = null; r(null); } });
$("askCopy").addEventListener("click", async () => {
  const inp = $("askInput");
  try { await navigator.clipboard.writeText(inp.value); $("askCopy").textContent = "Copied"; $("askMsg").textContent = "Copied."; }
  catch (e) { inp.focus(); inp.select(); $("askMsg").textContent = "Press Ctrl+C (or Cmd+C) to copy it."; }
});
/** Yes / no. Resolves true only when the person presses okLabel. */
function ask(title, text, okLabel, danger) {
  return openAsk({ title, html: "<p>" + esc(text) + "</p>", okLabel, danger }).then((v) => v === true);
}
/** A line of text, or null when cancelled. */
function askText(title, label, value, okLabel) {
  return openAsk({ title, input: true, label, value, okLabel }).then((v) => (typeof v === "string" ? v : null));
}
/** Shows a value with a Copy button (e.g. a temporary password). */
function showCopy(title, value, note) {
  return openAsk({ title, html: note ? "<p>" + esc(note) + "</p>" : "", copy: true, value, label: "Password", okLabel: "Done", noCancel: true });
}
/** A message with a Close button; html must already be escaped. ghost: the html has its own main button. */
function info(title, html, ghost) { return openAsk({ title, html, okLabel: "Close", noCancel: true, okGhost: !!ghost }); }

/* ---------- Credits: card packs (Stripe), or by email until card payments are on ---------- */
function packsHtml() {
  return BRAND.packs.map((p) => '<button type="button" class="pack" data-pack="' + esc(p.credits) + '"><b>' + esc(plural(p.credits, "credit")) + "</b><span>" + esc(money(p.price)) + "</span>"
    + '<span class="each">' + esc(money(p.price / p.credits)) + ' per credit</span><span class="go">Pay by card →</span></button>').join("");
}
async function startPack(credits, btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await postJson("/api/checkout", { credits: Number(credits) });
    location.href = r.url; // Stripe's secure payment page
  } catch (e) { toast(e.message, true); if (btn) btn.disabled = false; }
}
document.addEventListener("click", (e) => {
  const b = e.target && e.target.closest ? e.target.closest("[data-pack]") : null;
  if (!b) return;
  if ($("askDlg").open) closeAsk(null);
  startPack(b.dataset.pack, b);
});
// Back from Stripe: wait for the payment to arrive, then show the new balance.
async function checkPaid(id) {
  try { history.replaceState(null, "", "#credits"); } catch (e) { /* ignore */ }
  toast("Payment received. Adding your credits…");
  for (let i = 0; i < 8; i++) {
    try {
      const r = await api("/api/payments/" + encodeURIComponent(id));
      if (r.status === "paid") { await refreshMe(); if (currentTab === "credits") loadCredits(); toast(plural(r.credits, "credit") + " added. Thank you!"); return; }
    } catch (e) { if (e.status === 404) break; }
    await new Promise((ok) => setTimeout(ok, 2500));
  }
  toast("Your payment is still being confirmed. The credits will appear here within a few minutes.", true);
}
function getMoreCredits() {
  closeMenu();
  if (DEMO) {
    return openAsk({ title: "Buy credits", html: "<p>In the demo, credits are pretend. Add some to try getting more leads.</p>", okLabel: "Add 500 pretend credits" })
      .then((v) => { if (v === true && demoEngine) { demoEngine.addCredits(500); refreshMe(); if (currentTab === "credits") loadCredits(); toast("500 pretend credits added."); } });
  }
  if (BRAND.cardPayments) {
    return info("Buy credits", '<div class="packs">' + packsHtml() + "</div>"
      + '<p class="hint">Pay by card. Credits never expire.' + (me ? " You have " + esc(plural(me.account.credits, "credit")) + "." : "") + "</p>", true);
  }
  const company = (me && me.account && me.account.company) || "";
  let html = "<p>Credits are added by our team. " + (BRAND.packs.length ? "Tell us which pack you'd like." : "Tell us how many credits you want.") + "</p>";
  // The packs and prices when they are known.
  if (BRAND.packs.length) {
    html += "<ul>" + BRAND.packs.map((p) => "<li><strong>" + esc(plural(p.credits, "credit")) + "</strong>: " + esc(money(p.price))
      + ' <span class="hint">(' + esc(money(p.price / p.credits)) + " per credit)</span></li>").join("") + "</ul>";
  }
  const pl = priceLine();
  if (pl) html += '<p class="hint">' + esc(pl) + "</p>";
  html += BRAND.supportEmail
    ? '<p><a class="btnlink" href="' + esc(mailto("Credits for " + company)) + '">Email ' + esc(BRAND.supportEmail) + '</a></p><p class="hint">Or use our <a href="/contact?subject=credits" target="_blank" rel="noopener">contact page</a>.</p>'
    : '<p><a class="btnlink" href="/contact?subject=credits" target="_blank" rel="noopener">Contact us</a></p>';
  if (me) html += '<p class="hint">You have ' + esc(plural(me.account.credits, "credit")) + ". Credits never expire.</p>";
  return info("Buy credits", html, true);
}
/** "Standard lead: 1 credit · With Google rating: 3 credits · 1 credit = $0.50" (the parts that are known). */
function priceLine() {
  const p = prices(), cp = creditPrice(), bits = [];
  if (p.free != null) bits.push("Standard lead: " + plural(p.free, "credit"));
  if (p.google != null) bits.push("With Google rating: " + plural(p.google, "credit"));
  if (cp != null) bits.push("1 credit = " + money(cp));
  return bits.join(" · ");
}

function showHelp() {
  closeMenu();
  const fr = me && me.free;
  const pl = priceLine();
  info("Help", "<ul><li><strong>Search:</strong> type what and where, then Search.</li>"
    + "<li><strong>Get leads:</strong> one button gets them all and saves a list. Or pick individual leads.</li>"
    + "<li><strong>Contact details</strong> show once you get a lead: in Your lists and the downloads.</li>"
    + (fr && fr.perMonth ? "<li><strong>Free:</strong> " + esc(num(fr.perMonth)) + " leads every month, then credits.</li>" : "")
    + (pl ? "<li><strong>Prices:</strong> " + esc(pl) + "</li>" : "")
    + "<li><strong>Questions or wrong data?</strong> " + contactSentence() + ".</li></ul>");
}

/* ---------- Forgot password, emailed links ---------- */
function forgotPassword() {
  info("Forgot your password?", "<ul>"
    + "<li><strong>Someone on your team added you?</strong> Ask them to remove you and add you again. You'll get a new temporary password.</li>"
    + '<li><strong>You made the account?</strong> Use our <a href="/contact">contact page</a> and give the email you signed up with.</li></ul>');
}
$("forgotBtn").addEventListener("click", () => {
  if (!BRAND.emails) return forgotPassword();
  $("loginForm").hidden = true; $("forgotForm").hidden = false;
  $("forgotEmail").value = $("loginEmail").value; $("forgotMsg").textContent = ""; $("forgotEmail").focus();
});
$("forgotBack").addEventListener("click", () => { $("forgotForm").hidden = true; $("loginForm").hidden = false; $("loginEmail").focus(); });
$("forgotForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("forgotEmail").value.trim(), msg = $("forgotMsg");
  msg.className = "err";
  if (email.indexOf("@") < 1) { msg.textContent = "Type the email you signed up with."; return; }
  $("forgotSend").disabled = true;
  try {
    await postJson("/api/password/forgot", { email, turnstile: humanToken("forgotForm") });
    msg.className = "okmsg";
    msg.textContent = "If there's an account for " + email + ", the link is on its way (check spam too). It works for 60 minutes.";
  } catch (err) { msg.textContent = err.message; resetHuman("forgotForm"); }
  finally { $("forgotSend").disabled = false; }
});
// The emailed links: #reset?t=... (new password) and #verify?t=... (confirm email).
function linkToken() { return new URLSearchParams(parseHash().query).get("t") || ""; }
function clearLinkHash() { try { history.replaceState(null, "", location.pathname); } catch (e) { /* ignore */ } }
function openReset() {
  $("rsNew").value = ""; $("rsNew2").value = ""; $("rsMsg").textContent = "";
  if (!$("resetDlg").open) $("resetDlg").showModal();
  $("rsNew").focus();
}
$("rsCancel").addEventListener("click", () => { $("resetDlg").close(); clearLinkHash(); });
$("resetForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const a = $("rsNew").value, b = $("rsNew2").value;
  if (a.length < 10) { $("rsMsg").textContent = "The password needs at least 10 characters."; return; }
  if (a !== b) { $("rsMsg").textContent = "The two passwords don't match."; return; }
  $("rsSave").disabled = true;
  try {
    await postJson("/api/password/reset", { token: linkToken(), password: a });
    $("resetDlg").close(); hidePasswords(); clearLinkHash();
    showSignedOut("Your password is changed. Sign in with the new one.");
    $("loginMsg").className = "okmsg";
  } catch (err) { $("rsMsg").textContent = err.message; }
  finally { $("rsSave").disabled = false; }
});
async function confirmFromLink() {
  const t = linkToken();
  clearLinkHash();
  try { await postJson("/api/email/confirm", { token: t }); toast("Thanks, your email is confirmed. You can get leads now."); }
  catch (err) { toast(err.message, true); }
}
async function resendConfirm(btn) {
  if (btn) btn.disabled = true;
  try { const r = await postJson("/api/email/resend", {}); toast(r.already ? "Your email is already confirmed." : "Sent. Check your inbox (and spam) for the link."); if (r.already) refreshMe(); }
  catch (err) { toast(err.message, true); }
  finally { if (btn) btn.disabled = false; }
}

// Show / hide password buttons.
document.addEventListener("click", (e) => {
  const b = e.target && e.target.closest ? e.target.closest(".pwtoggle") : null;
  if (!b) return;
  const inp = $(b.dataset.pw);
  const showIt = inp.type === "password";
  inp.type = showIt ? "text" : "password";
  b.textContent = showIt ? "Hide" : "Show";
  b.setAttribute("aria-pressed", String(showIt));
  b.setAttribute("aria-label", showIt ? "Hide password" : "Show password");
});
function hidePasswords() {
  for (const b of document.querySelectorAll(".pwtoggle")) { $(b.dataset.pw).type = "password"; b.textContent = "Show"; b.setAttribute("aria-pressed", "false"); b.setAttribute("aria-label", "Show password"); }
}

/* ---------- Sections ---------- */
function show(section) {
  $("bootView").hidden = section !== "boot";
  $("outView").hidden = section !== "out";
  $("appView").hidden = section !== "app";
  $("appNav").hidden = section !== "app";
  $("hdrAcct").hidden = section !== "app";
  if (section !== "app") $("hdrCompany").textContent = "";
}

function applyBrand() {
  if (!DEMO) document.title = BRAND.name;
  $("brandName").textContent = BRAND.name;
  const p = prices();
  $("priceFreeLbl").textContent = p.free != null ? plural(p.free, "credit") : "";
  $("priceGoogleLbl").textContent = p.google != null ? plural(p.google, "credit") : "";
}

async function boot() {
  if (!DEMO && parseHash().tab === "demo") { location.replace("/demo"); return; }
  show("boot");
  $("bootMsg").textContent = "Loading…";
  if (DEMO) {
    me = await api("/api/me");
    applyBrand();
    enterApp();
    return;
  }
  try {
    const b = await api("/api/brand");
    if (b.name) BRAND.name = b.name;
    if (typeof b.supportEmail === "string") BRAND.supportEmail = b.supportEmail;
    BRAND.signupOpen = b.signupOpen !== false;
    if (b.prices) BRAND.prices = b.prices;
    if ("creditPrice" in b) BRAND.creditPrice = typeof b.creditPrice === "number" ? b.creditPrice : null;
    BRAND.packs = Array.isArray(b.packs) ? b.packs : [];
    BRAND.cardPayments = b.cardPayments === true && BRAND.packs.length > 0;
    BRAND.emails = b.emails === true;
  } catch (e) { /* the page still works with the values it was served with */ }
  applyBrand();
  const link = parseHash().tab;
  if (link === "verify") await confirmFromLink();
  if (link === "reset") { showSignedOut(); openReset(); return; }
  try {
    me = await api("/api/me");
  } catch (e) {
    if (e.status === 401) { showSignedOut(); return; }
    $("bootMsg").innerHTML = esc(e.message) + ' <button type="button" class="ghost small" id="bootRetry">Try again</button>';
    $("bootRetry").onclick = boot;
    return;
  }
  enterApp();
}

function showSignedOut(msg) {
  if (DEMO) { location.href = "/app"; return; }
  signedIn = false;
  me = null;
  pwForced = false;
  closeMenu();
  for (const id of ["buyDlg", "pwDlg", "doneDlg", "askDlg", "moreDlg"]) { if ($(id).open) $(id).close(); }
  show("out");
  $("loginMsg").textContent = msg || "";
  $("loginMsg").className = msg && /signed out/i.test(msg) ? "okmsg" : "err";
  $("signupCard").hidden = !BRAND.signupOpen;
  $("signupClosed").hidden = BRAND.signupOpen;
  $("signupClosedMsg").innerHTML = 'Sign-ups are closed for now. <a href="' + ACCESS_HREF + '">Request access</a>, or <a href="/demo">try the demo</a>.';
  const h = parseHash();
  // Coming from a catalog page: say what they'll see.
  const q = new URLSearchParams(h.query);
  const city = (q.get("city") || "").split("|"), cat = q.get("category") || "", n = Number(q.get("n") || 0);
  const what = cat && city[0] ? (n > 0 ? "the " + num(n) + " " : "the ") + cat + " leads in " + city[0] + (city[1] ? ", " + city[1] : "") : "";
  $("signupFor").hidden = !what || !BRAND.signupOpen;
  $("signupFor").textContent = what ? "Create a free account to see " + what + "." : "";
  if (h.tab === "signup" || (h.tab === "find" && what)) focusSignup();
}

// "#find?state=FL&city=Miami%7CFL" -> { tab: "find", query: "state=FL&city=Miami%7CFL" }
function parseHash() {
  const h = (location.hash || "").slice(1);
  const i = h.indexOf("?");
  return { tab: i >= 0 ? h.slice(0, i) : h, query: i >= 0 ? h.slice(i + 1) : "" };
}
function focusSignup() {
  const card = BRAND.signupOpen ? $("signupCard") : $("signupClosed");
  card.style.order = "-1";
  card.scrollIntoView({ block: "start" });
  if (BRAND.signupOpen && !$("signupForm").hidden) $("suCompany").focus();
}

/* ---------- Sign in / sign up ---------- */
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("loginEmail").value.trim(), password = $("loginPass").value;
  const msg = $("loginMsg");
  msg.className = "err";
  if (!email || !password) { msg.textContent = "Enter your email and password."; return; }
  $("loginBtn").disabled = true;
  msg.className = "muted"; msg.textContent = "Signing in…";
  try {
    await postJson("/api/login", { email, password });
    $("loginPass").value = "";
    hidePasswords();
    me = await api("/api/me");
    msg.textContent = "";
    enterApp();
  } catch (err) {
    msg.className = "err"; msg.textContent = err.message;
  } finally { $("loginBtn").disabled = false; }
});

$("signupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const company = $("suCompany").value.trim(), name = $("suName").value.trim(), email = $("suEmail").value.trim();
  const password = $("suPass").value, repeat = $("suPass2").value;
  const msg = $("signupMsg");
  if (!company || !name || !email) { msg.textContent = "Please fill in your company, your name and your email."; return; }
  if (email.indexOf("@") < 1) { msg.textContent = "That email address doesn't look right."; return; }
  if (password.length < 10) { msg.textContent = "The password needs at least 10 characters."; return; }
  if (password !== repeat) { msg.textContent = "The two passwords don't match."; return; }
  msg.textContent = "";
  $("signupBtn").disabled = true;
  try {
    const d = await postJson("/api/signup", { company, name, email, password, turnstile: humanToken("signupForm") });
    // Both kinds of account can sign in: an approved one starts at once, a waiting one can look around.
    if (await signInAfterSignup(email, password)) {
      $("signupForm").reset();
      hidePasswords();
      const left = me && me.free ? Number(me.free.left || 0) : null;
      if (d.confirmEmail) toast("Welcome! We sent a link to " + email + ": confirm your email, then you can get leads.");
      else if (d.status === "active") toast(left != null ? "Welcome! You have " + num(left) + " free leads this month." : "Welcome! Your account is ready.");
      else toast("Welcome! Your account is waiting for approval. You can look around now.");
      return;
    }
    $("signupForm").hidden = true;
    const done = $("signupDone");
    done.hidden = false;
    done.innerHTML = d.status === "active"
      ? '<p class="okmsg"><strong>Thanks! Your account is ready.</strong></p><p class="muted">Sign in with your email and password to start.</p>'
      : '<p class="okmsg"><strong>Thanks! Your account is waiting for approval.</strong></p><p class="muted">' + esc(waitingText()) + "</p>";
    $("loginEmail").value = email;
  } catch (err) {
    msg.textContent = err.message;
    resetHuman("signupForm");
  } finally { $("signupBtn").disabled = false; }
});
function waitingText() {
  return "You can look around now. Getting leads opens once " + BRAND.name + " approves your account.";
}

// After sign-up: use the session if sign-up already started one, else sign in with the new password.
async function signInAfterSignup(email, password) {
  try {
    try { me = await api("/api/me"); }
    catch (e) {
      if (e.status !== 401) throw e;
      await postJson("/api/login", { email, password });
      me = await api("/api/me");
    }
    $("suPass").value = ""; $("suPass2").value = "";
    enterApp();
    return true;
  } catch (e) {
    me = null;
    return false;
  }
}

/* ---------- Signed-in shell ---------- */
function canBuy() { return !!me && me.account && me.account.status === "active"; }

function renderHeader() {
  if (!me) return;
  $("hdrCompany").textContent = me.account.company || "";
  const fr = me.free, left = fr ? Number(fr.left || 0) : 0;
  // The balance pill: credits, plus the free leads left this month.
  // (On phones the free part is hidden by CSS so the header stays one row.)
  $("hdrBal").innerHTML = esc(plural(me.account.credits, "credit")) + (left > 0 ? '<span class="balfree"> · ' + esc(num(left)) + " free</span>" : "") + " ▾";
  $("hdrBal").setAttribute("aria-label", plural(me.account.credits, "credit") + (left > 0 ? ", " + num(left) + " free leads left" : "") + ". Open the credits menu");
  $("hdrBal").classList.toggle("free", left > 0);
  $("balWho").textContent = plural(me.account.credits, "credit") + approx(me.account.credits) + (fr ? " · " + num(left) + " free this month" : "");
  $("acctWho").textContent = (me.user.name ? me.user.name + " · " : "") + (me.user.email || "");
  const b = $("banner");
  const st = me.account.status;
  if (st === "pending") {
    b.hidden = false; b.className = "banner warn";
    b.textContent = "Your account is waiting for approval. " + waitingText();
  } else if (st === "suspended") {
    b.hidden = false; b.className = "banner bad";
    b.innerHTML = "Your account is paused. To ask why, " + contactHtml() + ".";
  } else if (me.user && me.user.needsEmailConfirmation) {
    b.hidden = false; b.className = "banner warn";
    b.innerHTML = "Please confirm your email: we sent a link to <strong>" + esc(me.user.email) + "</strong>. "
      + '<button type="button" class="link" id="resendBtn">Send it again</button>';
    $("resendBtn").onclick = () => resendConfirm($("resendBtn"));
  } else { b.hidden = true; }
  applyBrand();
  updateGetButton();
}

async function refreshMe() {
  try { me = await api("/api/me"); renderHeader(); }
  catch (e) { if (signedIn) toast("Couldn't refresh your balance: " + e.message, true); }
}

const TABS = ["find", "lists", "list", "credits", "team"];
let pendingQuery = null;
function enterApp() {
  signedIn = true;
  show("app");
  renderHeader();
  const h = parseHash();
  if (h.tab === "find" && h.query) pendingQuery = h.query;
  else if (!h.tab || h.tab === "find") { const last = lsGet("ls.lastFind"); if (last) pendingQuery = last; }
  if (h.tab === "list") openList(new URLSearchParams(h.query).get("id") || "all");
  else switchTab(TABS.indexOf(h.tab) >= 0 ? h.tab : "find");
  if (me && me.user && me.user.mustChangePassword) openPw(true);
  const paid = h.tab === "credits" ? new URLSearchParams(h.query).get("paid") : null;
  if (paid) checkPaid(paid);
}

let currentTab = "find";
function setHash(h) { try { history.replaceState(null, "", h); } catch (e) { /* ignore */ } }
function switchTab(t) {
  currentTab = t;
  closeMenu();
  const navOn = t === "list" ? "lists" : t;
  for (const b of document.querySelectorAll(".tab")) {
    const on = b.dataset.tab === navOn;
    b.classList.toggle("active", on);
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  }
  for (const v of TABS) $("view-" + v).hidden = v !== t;
  if (t === "find") {
    setupFind();
    if (pendingQuery != null) {
      // Deep link or last search: fill in the search, then run it.
      const q = pendingQuery;
      pendingQuery = null;
      applyQuery(q);
      if (hasScope()) runSearch(); else renderStart();
    } else if (S.active) rememberSearch();
    else { setHash("#find"); renderStart(); }
  } else if (t === "lists") { setHash("#lists"); loadLists(); }
  else if (t === "list") loadListView();
  else if (t === "team") { setHash("#team"); loadTeam(); }
  else { setHash("#credits"); loadCredits(); }
  window.scrollTo(0, 0);
}
for (const b of document.querySelectorAll(".tab")) b.addEventListener("click", () => switchTab(b.dataset.tab));
window.addEventListener("hashchange", () => {
  const h = parseHash();
  if (!signedIn) { if ((h.tab === "signup" || h.tab === "find") && !$("outView").hidden) showSignedOut($("loginMsg").textContent); return; }
  if (h.tab === "find" && h.query) { pendingQuery = h.query; switchTab("find"); }
  else if (h.tab === "list") openList(new URLSearchParams(h.query).get("id") || "all");
  else if (TABS.indexOf(h.tab) >= 0 && h.tab !== currentTab) switchTab(h.tab);
});

// Drop-down menus: the header ones, plus any button with data-menu="<menu id>" (Download ▾, ⋯, Saved ▾).
const MENUS = [["acctBtn", "acctMenu"], ["hdrBal", "balMenu"], ["savedBtn", "savedMenu"]];
function menuPairs() {
  const out = MENUS.map((m) => [$(m[0]), $(m[1])]);
  for (const b of document.querySelectorAll("[data-menu]")) { const m = $(b.dataset.menu); if (m) out.push([b, m]); }
  return out;
}
function closeMenu() { for (const p of menuPairs()) { p[1].hidden = true; p[0].setAttribute("aria-expanded", "false"); } }
function toggleMenu(btn, menu) {
  const open = menu.hidden;
  closeMenu();
  menu.hidden = !open;
  btn.setAttribute("aria-expanded", String(open));
  if (open) { const f = menu.querySelector("button:not([disabled])"); if (f) f.focus(); }
  // A list's Download menu: "For cold email" is greyed out when none of its leads has an email.
  const cold = open ? menu.querySelector('[data-dl="cold_email"][data-list]') : null;
  if (cold) {
    const id = cold.dataset.list;
    if (emailCounts[id] != null) setColdEmail(cold, emailCounts[id]);
    else withEmailOf(id).then((n) => setColdEmail(cold, n)).catch(() => {});
  }
}
document.addEventListener("click", (e) => {
  const t = e.target;
  const btn = t && t.closest ? t.closest("[data-menu], #acctBtn, #hdrBal, #savedBtn") : null;
  if (btn) {
    const id = btn.dataset.menu || (MENUS.find((m) => m[0] === btn.id) || [])[1];
    const menu = id ? $(id) : null;
    if (menu) { toggleMenu(btn, menu); return; }
  }
  // A choice in a menu (its own handler runs too), or a click outside: close.
  for (const p of menuPairs()) {
    if (p[1].hidden) continue;
    const item = t && t.closest ? t.closest("button") : null;
    if (!p[1].contains(t) || (item && p[1].contains(item))) { p[1].hidden = true; p[0].setAttribute("aria-expanded", "false"); }
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  for (const p of menuPairs()) if (!p[1].hidden) { closeMenu(); p[0].focus(); }
});
$("balBuy").addEventListener("click", getMoreCredits);
$("balHist").addEventListener("click", () => switchTab("credits"));
$("teamBtn").addEventListener("click", () => switchTab("team"));
$("helpBtn").addEventListener("click", showHelp);
$("crMore").addEventListener("click", getMoreCredits);

// After signing out, go to the public website.
async function signOut(onError) {
  closeMenu();
  if (DEMO) { location.href = "/"; return; }
  try {
    await postJson("/api/logout", {});
    signedIn = false; pwForced = false;
    location.href = "/";
  } catch (e) { (onError || ((m) => toast(m, true)))("Couldn't sign out: " + e.message); }
}
$("logoutBtn").addEventListener("click", () => signOut());

/* ---------- Change password ---------- */
// forced = the user signed in with a temporary password and must choose their own first.
let pwForced = false;
function openPw(forced) {
  closeMenu();
  if (DEMO) { info("Change password", "<p>Not part of the demo.</p>"); return; }
  pwForced = !!forced;
  $("pwForm").reset(); $("pwMsg").textContent = "";
  hidePasswords();
  $("pwNote").hidden = !pwForced;
  $("pwCancel").textContent = pwForced ? "Sign out" : "Cancel";
  if (!$("pwDlg").open) $("pwDlg").showModal();
  $("pwCur").focus();
}
$("pwBtn").addEventListener("click", () => openPw(false));
$("pwCancel").addEventListener("click", () => {
  if (pwForced) signOut((m) => { $("pwMsg").textContent = m; });
  else $("pwDlg").close();
});
$("pwDlg").addEventListener("cancel", (e) => { if (pwForced) e.preventDefault(); });
$("pwDlg").addEventListener("close", () => {
  if (pwForced && signedIn && me && me.user && me.user.mustChangePassword) setTimeout(() => { if (pwForced && signedIn) openPw(true); }, 0);
});
$("pwForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const current = $("pwCur").value, next = $("pwNew").value, repeat = $("pwNew2").value;
  const msg = $("pwMsg");
  if (!current) { msg.textContent = "Enter your current password."; return; }
  if (next.length < 10) { msg.textContent = "The new password needs at least 10 characters."; return; }
  if (next !== repeat) { msg.textContent = "The two new passwords don't match."; return; }
  msg.textContent = "";
  $("pwSave").disabled = true;
  try {
    await postJson("/api/password", { current, next });
    if (me && me.user) me.user.mustChangePassword = false;
    pwForced = false;
    $("pwNote").hidden = true;
    $("pwDlg").close();
    toast("Password changed");
  } catch (err) { msg.textContent = err.message; }
  finally { $("pwSave").disabled = false; }
});

/* ---------- Search state ---------- */
// F = the search (what, where, filters); S = what's on screen.
const F = { cats: [], inds: [], cities: [], state: "", radius: "", zips: [], phone: false, email: false, owner: false, website: "", scores: [], tier: "",
  minRating: "", minRev: "", maxRev: "", q: "", hideOwned: true, area: "" };
// noGoogle: no lead in this search has a Google rating (hide the rating column, chip and sorts).
// failed: the last search didn't load. justGot: { key, n } = leads just got for this search (now hidden).
const S = { active: false, page: 1, sort: "best", dir: "desc", total: 0, maxPage: 200, rows: [], loaded: false, req: 0, suggestions: [], picking: false, selected: new Set(),
  noGoogle: false, failed: false, justGot: null };
const DEFAULT_DIR = { best: "desc", name: "asc", score: "asc", rating: "desc", reviews: "desc" };

function resetFilters() {
  Object.assign(F, { zips: [], phone: false, email: false, owner: false, website: "", scores: [], tier: "", minRating: "", minRev: "", maxRev: "", q: "", hideOwned: true, area: "" });
}
function wholeNumber(v) { const s = String(v == null ? "" : v).trim(); if (!s) return ""; const n = Number(s); return Number.isFinite(n) && n >= 0 ? String(Math.floor(n)) : ""; }
/** Something to search in: a category, an industry, a place, a ZIP or a drawn area (keeps the queries cheap). */
function hasScope() { return !!(F.cats.length || F.inds.length || F.cities.length || F.state || F.zips.length || F.area); }

// The search as the API's filter query (also kept in the address, saved searches and "Get N leads").
function filterQuery() {
  const p = new URLSearchParams();
  if (F.cities.length === 1 && F.radius) { p.set("near", F.cities[0]); p.set("radius_miles", F.radius); }
  else for (const c of F.cities) p.append("city", c);
  if (!F.cities.length && F.state) p.append("state", F.state);
  for (const v of F.inds) p.append("industry", v);
  for (const v of F.cats) p.append("category", v);
  for (const z of F.zips) p.append("postal_code", z);
  if (F.tier) p.set("tier", F.tier);
  if (F.phone) p.set("phone", "yes");
  if (F.email) p.set("email", "yes");
  if (F.owner) p.set("owner", "yes");
  if (F.website) p.set("website", F.website);
  if (F.minRating) p.set("min_rating", F.minRating);
  if (F.minRev) p.set("min_reviews", F.minRev);
  if (F.maxRev) p.set("max_reviews", F.maxRev);
  for (const s of F.scores) p.append("score", s);
  if (F.q) p.set("q", F.q);
  p.set("owned", F.hideOwned ? "no" : "all");
  if (F.area) p.set("area", F.area);
  return p.toString();
}
const sortQuery = () => "sort=" + S.sort + "&dir=" + S.dir;
function fullQuery() { const q = filterQuery(); return (q ? q + "&" : "") + sortQuery(); }

// Only "lat,lng;lat,lng;..." with 3 to 40 valid points is used as a map area.
function cleanArea(v) {
  const pts = String(v || "").split(";").map((x) => x.split(",").map(Number))
    .filter((x) => x.length === 2 && Number.isFinite(x[0]) && Number.isFinite(x[1]) && Math.abs(x[0]) <= 90 && Math.abs(x[1]) <= 180);
  return pts.length >= 3 ? pts.slice(0, 40).map((x) => x[0].toFixed(5) + "," + x[1].toFixed(5)).join(";") : "";
}

// Fill the search from a query string (deep links, saved searches, suggestions, the last search).
function applyQuery(qs) {
  const p = new URLSearchParams(qs || "");
  const list = (k) => p.getAll(k).map((v) => String(v).trim()).filter(Boolean);
  resetFilters();
  F.cats = list("category").slice(0, 20);
  F.inds = list("industry").slice(0, 5);
  F.cities = list("city").filter((c) => c.indexOf("|") > 0).slice(0, 20);
  F.radius = "";
  const near = p.get("near") || "";
  if (near.indexOf("|") > 0 && p.get("radius_miles")) { F.cities = [near.slice(0, 120)]; F.radius = String(Math.min(Math.max(Number(p.get("radius_miles")) || 25, 1), 200)); }
  F.state = F.cities.length ? "" : (list("state")[0] || "").toUpperCase().slice(0, 2);
  F.zips = list("postal_code").slice(0, 50);
  const tier = p.get("tier"); F.tier = tier === "free" || tier === "google" ? tier : "";
  F.phone = p.get("phone") === "yes"; F.email = p.get("email") === "yes"; F.owner = p.get("owner") === "yes";
  const web = p.get("website"); F.website = web === "yes" ? "yes" : web === "no" || web === "no_real" ? "no_real" : "";
  F.minRating = /^[0-9]([.][0-9])?$/.test(p.get("min_rating") || "") ? p.get("min_rating") : "";
  F.minRev = wholeNumber(p.get("min_reviews")); F.maxRev = wholeNumber(p.get("max_reviews"));
  F.scores = list("score").filter((s) => ["weak", "basic", "good", "strong"].indexOf(s) >= 0);
  F.q = (p.get("q") || "").slice(0, 80);
  // Hiding leads you already have is the default: only owned=all (or yes) shows them.
  F.hideOwned = p.get("owned") !== "all" && p.get("owned") !== "yes";
  F.area = cleanArea(p.get("area"));
  // No sort in the query (examples, old links): the default, most contact details first.
  const sort = p.get("sort");
  if (sort && DEFAULT_DIR[sort]) { S.sort = sort; S.dir = p.get("dir") === "desc" ? "desc" : p.get("dir") === "asc" ? "asc" : DEFAULT_DIR[sort]; }
  else { S.sort = "best"; S.dir = "desc"; }
  renderTokens();
  renderChips();
}

/* ---------- Words for the search ---------- */
/** "Plumber" -> "Plumbers", "Real estate agency" -> "Real estate agencies" (same rule as the server). */
function pluralWord(w) {
  w = String(w || "").trim();
  if (!w || /s$/i.test(w)) return w;
  if (/man$/i.test(w)) return w.slice(0, -3) + "men";
  if (/[^aeiou]y$/i.test(w)) return w.slice(0, -1) + "ies";
  if (/(x|z|ch|sh)$/i.test(w)) return w + "es";
  return w + "s";
}
// "Plumbers" -> "plumbers", but "HVAC contractors" stays.
function lowerFirst(s) { s = String(s || ""); return s.length > 1 && s[1] === s[1].toLowerCase() ? s[0].toLowerCase() + s.slice(1) : s; }
const cityLabel = (v) => String(v || "").split("|").join(", ");
/** Google's category names, for people: "Handyman/Handywoman/Handyperson" -> "Handyman". */
function prettyCat(v) { const s = String(v == null ? "" : v); const first = s.split("/")[0].trim(); return first || s; }
/** "Home Services" -> "home services" (an industry name in a sentence). */
const lowerAll = (s) => String(s || "").toLowerCase();
function whatWords(n) {
  const one = Number(n) === 1;
  const cat = (i) => prettyCat(F.cats[i]);
  if (F.cats.length === 1) return lowerFirst(one ? cat(0) : pluralWord(cat(0)));
  if (F.cats.length === 2) return lowerFirst(pluralWord(cat(0))) + " and " + lowerFirst(pluralWord(cat(1)));
  if (F.cats.length > 2) return (one ? "business" : "businesses") + " in " + F.cats.length + " categories";
  if (F.inds.length) return lowerAll(F.inds[0]) + (one ? " business" : " businesses");
  return one ? "business" : "businesses";
}
function whereWords() {
  // A drawn area is the narrowest place, so the heading names it.
  if (F.area) return "in the drawn area";
  if (F.cities.length === 1) return (F.radius ? "within " + F.radius + " miles of " : "in ") + cityLabel(F.cities[0]);
  if (F.cities.length > 1) return "in " + cityLabel(F.cities[0]) + " and " + (F.cities.length - 1) + " more " + (F.cities.length === 2 ? "city" : "cities");
  if (F.state) return "in " + (STATES[F.state] || F.state);
  if (F.zips.length) return "in ZIP " + F.zips.slice(0, 3).join(", ") + (F.zips.length > 3 ? "…" : "");
  return "";
}
/** "248 plumbers in Tampa, FL" */
function headline(n) { const w = whereWords(); return num(n) + " " + whatWords(n) + (w ? " " + w : ""); }

/* ---------- What / Where boxes (autocomplete) ---------- */
const pick = { cats: [], inds: [], states: [], cities: [], stateCities: {}, placeCats: {}, loading: null };
const MIN_SUGGEST = 3; // categories with fewer businesses than this aren't suggested (odd one-offs)
function loadPickData() {
  if (pick.loading) return pick.loading;
  pick.loading = Promise.all([
    api("/api/categories").then((d) => { pick.cats = d.categories || []; pick.inds = d.industries || []; renderTokens(); }),
    api("/api/places").then((d) => { pick.states = d.states || []; pick.cities = d.cities || []; }),
  ]).catch((e) => { pick.loading = null; throw e; });
  return pick.loading;
}
/** The What box's example text, from the biggest real categories ("Roofers, plumbers…"). */
function whatHint() {
  const top = [];
  for (const c of pick.cats) {
    const w = pluralWord(prettyCat(c.value));
    if (Number(c.n) >= MIN_SUGGEST && top.indexOf(w) < 0) top.push(w);
    if (top.length >= 2) break;
  }
  return top.length === 2 ? top[0] + ", " + lowerFirst(top[1]) + "…" : "What kind of business?";
}
/** The categories to suggest, counted in the chosen place when there is one (else the whole database). */
function placeKey() {
  if (F.area || F.zips.length) return "-";
  if (F.cities.length === 1 && !F.radius) return "city=" + encodeURIComponent(F.cities[0]);
  if (!F.cities.length && F.state) return "state=" + encodeURIComponent(F.state);
  return F.cities.length ? "-" : "";
}
async function catsForPlace() {
  const key = placeKey();
  if (!key) return { cats: pick.cats, inds: pick.inds, counts: true };
  if (key === "-") return { cats: pick.cats, inds: pick.inds, counts: false }; // several places: no one count fits
  if (!pick.placeCats[key]) pick.placeCats[key] = api("/api/categories?" + key).catch(() => { delete pick.placeCats[key]; return null; });
  const d = await pick.placeCats[key];
  // Only an answer that says which place it counted is used; otherwise no counts (they'd be for everywhere).
  if (d && d.place) return { cats: d.categories || [], inds: d.industries || [], counts: true };
  return { cats: pick.cats, inds: pick.inds, counts: false };
}
async function loadStateCities(st) {
  if (pick.stateCities[st]) return pick.stateCities[st];
  const d = await api("/api/places?state=" + encodeURIComponent(st));
  pick.stateCities[st] = (d.cities || []).slice().sort((a, b) => Number(b.n) - Number(a.n));
  return pick.stateCities[st];
}
// Best matches first: starts with the text, then contains it.
function ranked(list, text, labelOf, limit) {
  const t = text.toLowerCase();
  const starts = [], has = [];
  for (const x of list) {
    const l = String(labelOf(x)).toLowerCase();
    if (!t || l.indexOf(t) === 0 || l.indexOf(" " + t) > 0) starts.push(x); else if (l.indexOf(t) > 0) has.push(x);
    if (starts.length >= limit) break;
  }
  return starts.concat(has).slice(0, limit);
}
async function whatSource(text) {
  try { await loadPickData(); } catch (e) { return [{ kind: "msg", label: "Couldn't load the categories: " + e.message }]; }
  const src = await catsForPlace();
  const free = src.cats.filter((c) => F.cats.indexOf(c.value) < 0);
  // Odd one-off categories aren't suggested, unless nothing else matches what was typed.
  let cats = ranked(free.filter((c) => Number(c.n) >= MIN_SUGGEST), text, (c) => prettyCat(c.value), 12);
  if (!cats.length && text) cats = ranked(free, text, (c) => prettyCat(c.value), 12);
  const seen = {};
  cats = cats.filter((c) => { const k = prettyCat(c.value).toLowerCase(); if (seen[k]) return false; seen[k] = 1; return true; }).slice(0, 8)
    .map((c) => ({ kind: "cat", value: String(c.value), label: prettyCat(c.value), n: src.counts ? c.n : null }));
  const inds = text ? ranked(src.inds.filter((c) => F.inds.indexOf(c.value) < 0), text, (c) => c.value, 2)
    .map((c) => ({ kind: "ind", value: String(c.value), label: "All " + lowerAll(c.value), n: src.counts ? c.n : null })) : [];
  const out = cats.concat(inds);
  return out.length || !text ? out : [{ kind: "msg", label: "No category matches “" + text + "”" }];
}
/** A place name for matching what's typed: "St. Petersburg" = "st petersburg" = "saint pete…", "Ft Myers" = "fort myers", "Opa-locka" = "opa locka". */
function placeNorm(s) {
  return String(s || "").toLowerCase().split(".").join("").split("'").join("").split("-").join(" ").replace(/ +/g, " ").trim()
    .replace(/(^| )saint /g, (m, a) => a + "st ").replace(/(^| )ft /g, (m, a) => a + "fort ").replace(/(^| )mt /g, (m, a) => a + "mount ");
}
async function whereSource(text) {
  try { await loadPickData(); } catch (e) { return [{ kind: "msg", label: "Couldn't load the places: " + e.message }]; }
  const t = text.trim();
  // "Tampa, FL" / "springfield il" / "Florida": look in that state's cities.
  const m = /^(.*?)[ ,]+([a-z]{2})$/i.exec(t);
  let code = m && STATES[m[2].toUpperCase()] ? m[2].toUpperCase() : "";
  let cityText = code ? m[1] : t;
  const exact = Object.keys(STATES).find((k) => k.toLowerCase() === t.toLowerCase() || STATES[k].toLowerCase() === t.toLowerCase());
  if (!code && exact) { code = exact; cityText = ""; }
  let pool = pick.cities;
  if (code) { try { pool = await loadStateCities(code); } catch (e) { pool = pick.cities; } }
  const states = !t ? [] : ranked(pick.states.filter((s) => s.value !== F.state), t, (s) => (STATES[s.value] || s.value) + " " + s.value, 3)
    .map((s) => ({ kind: "state", value: String(s.value), label: STATES[s.value] || String(s.value), tag: "state", n: s.n }));
  const cities = ranked(pool.filter((c) => F.cities.indexOf(c.value) < 0), placeNorm(cityText), (c) => placeNorm(String(c.value).split("|")[0]), 8)
    .map((c) => ({ kind: "city", value: String(c.value), label: cityLabel(c.value), n: c.n }));
  const out = (exact ? states.concat(cities) : cities.concat(states)).slice(0, 9);
  if (out.length || !t) return out;
  return [{ kind: "msg", label: code ? "No city matches in " + (STATES[code] || code) : "Add the state, e.g. “" + t + ", FL”" }];
}

function combo(inputId, listId, source, onPick, onBackspace) {
  const inp = $(inputId), list = $(listId);
  let items = [], active = -1, seq = 0;
  function render() {
    list.innerHTML = items.map((it, i) => '<li role="option" id="' + listId + "-" + i + '" data-i="' + i + '"' + (i === active ? ' aria-selected="true"' : ' aria-selected="false"')
      + (it.kind === "msg" ? ' aria-disabled="true"' : "") + "><span>" + esc(it.label) + (it.tag ? ' <span class="kind">' + esc(it.tag) + "</span>" : "") + "</span>"
      + '<span class="n">' + (it.n != null ? esc(num(it.n)) : "") + "</span></li>").join("");
    const open = items.length > 0;
    list.hidden = !open;
    inp.setAttribute("aria-expanded", String(open));
    if (active >= 0) inp.setAttribute("aria-activedescendant", listId + "-" + active); else inp.removeAttribute("aria-activedescendant");
  }
  async function update() {
    const my = ++seq;
    const r = await source(inp.value.trim());
    if (my !== seq || document.activeElement !== inp) return;
    items = r.slice(0, 9);
    active = items.length && items[0].kind !== "msg" ? 0 : -1;
    render();
  }
  function close() { seq++; items = []; active = -1; render(); }
  function choose(i) { const it = items[i]; if (!it || it.kind === "msg") return; inp.value = ""; close(); onPick(it); inp.focus(); }
  inp.addEventListener("input", update);
  // quietFocus() puts the cursor here without opening the list (so a message above stays visible).
  inp.addEventListener("focus", () => { if (inp.dataset.quiet) { delete inp.dataset.quiet; return; } update(); });
  inp.addEventListener("keydown", (e) => {
    const usable = items.filter((x) => x.kind !== "msg").length;
    if (e.key === "ArrowDown" && usable) { e.preventDefault(); active = (active + 1) % items.length; render(); }
    else if (e.key === "ArrowUp" && usable) { e.preventDefault(); active = (active - 1 + items.length) % items.length; render(); }
    else if (e.key === "Enter" && inp.value.trim() && active >= 0) { e.preventDefault(); choose(active); }
    else if (e.key === "Escape" && items.length) { e.preventDefault(); close(); }
    else if (e.key === "Backspace" && !inp.value && onBackspace) onBackspace();
  });
  list.addEventListener("mousedown", (e) => { const li = e.target.closest("li[data-i]"); if (li) { e.preventDefault(); choose(Number(li.dataset.i)); } });
  inp.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== inp) close(); }, 150));
  return { close, source };
}
const whatBox = combo("qWhat", "whatList", whatSource, (it) => {
  if (it.kind === "ind") F.inds.push(it.value); else F.cats.push(it.value);
  F.cats = F.cats.slice(0, 20);
  searchChanged();
}, () => { if (F.inds.length) F.inds.pop(); else if (F.cats.length) F.cats.pop(); else return; searchChanged(); });
const whereBox = combo("qWhere", "whereList", whereSource, (it) => {
  if (it.kind === "state") { F.state = it.value; F.cities = []; F.radius = ""; }
  else { F.state = ""; F.cities.push(it.value); F.cities = F.cities.slice(0, 20); if (F.cities.length > 1) F.radius = ""; }
  searchChanged();
}, () => { if (F.cities.length) F.cities.pop(); else if (F.state) F.state = ""; else return; F.radius = ""; searchChanged(); });

function quietFocus(inp) { if (document.activeElement === inp) return; inp.dataset.quiet = "1"; inp.focus(); }
function tokHtml(label, kind, i) {
  return '<span class="tok">' + esc(label) + '<button type="button" data-untok="' + kind + '" data-i="' + i + '" aria-label="Remove ' + esc(label) + '">×</button></span>';
}
function renderTokens() {
  $("whatTokens").innerHTML = F.cats.map((c, i) => tokHtml(prettyCat(c), "cat", i)).join("") + F.inds.map((c, i) => tokHtml("All " + lowerAll(c), "ind", i)).join("");
  $("whereTokens").innerHTML = F.cities.map((c, i) => tokHtml(cityLabel(c), "city", i)).join("") + (F.state ? tokHtml(STATES[F.state] || F.state, "state", 0) : "")
    + (F.area ? tokHtml("Area", "area", 0).replace('aria-label="Remove Area"', 'aria-label="Remove the drawn area"') : "");
  $("qWhat").placeholder = F.cats.length || F.inds.length ? "Add another" : whatHint();
  $("qWhere").placeholder = F.cities.length || F.state || F.area ? "" : "City or state";
  $("radiusRow").hidden = F.cities.length !== 1;
  const r = $("qRadius");
  if (F.radius && !Array.from(r.options).some((o) => o.value === F.radius)) r.add(new Option("Within " + F.radius + " miles", F.radius));
  r.value = F.cities.length === 1 ? F.radius : "";
}
document.addEventListener("click", (e) => {
  const b = e.target && e.target.closest ? e.target.closest("[data-untok]") : null;
  if (!b) return;
  const i = Number(b.dataset.i), k = b.dataset.untok;
  if (k === "cat") F.cats.splice(i, 1);
  else if (k === "ind") F.inds.splice(i, 1);
  else if (k === "city") { F.cities.splice(i, 1); F.radius = ""; }
  else if (k === "state") F.state = "";
  else if (k === "area") { F.area = ""; $("mapClear").hidden = true; renderChips(); }
  searchChanged();
  (k === "cat" || k === "ind" ? $("qWhat") : $("qWhere")).focus();
});
$("qRadius").addEventListener("change", () => { F.radius = $("qRadius").value; searchChanged(); });

// What or where changed: redraw, and when results are showing, search again straight away.
let searchTimer = null;
function searchChanged() {
  renderTokens();
  $("findMsg").textContent = "";
  if (!S.active) return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { if (hasScope()) runSearch(); else showStart(); }, 250);
}
function showStart() { S.active = false; S.req++; $("resultsArea").hidden = true; renderStart(); setHash("#find"); }

$("searchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("findMsg").textContent = "";
  // Text typed but not picked from the list: take the best match.
  for (const [inp, src, box] of [[$("qWhat"), whatSource, whatBox], [$("qWhere"), whereSource, whereBox]]) {
    const t = inp.value.trim();
    if (!t) continue;
    const best = (await src(t)).find((x) => x.kind !== "msg");
    if (!best) { $("findMsg").textContent = "Nothing matches “" + t + "”. Pick from the list as you type."; box.close(); quietFocus(inp); return; }
    inp.value = "";
    box.close();
    if (inp.id === "qWhat") { if (best.kind === "ind") F.inds.push(best.value); else F.cats.push(best.value); }
    else if (best.kind === "state") { F.state = best.value; F.cities = []; F.radius = ""; }
    else { F.state = ""; F.cities.push(best.value); }
  }
  renderTokens();
  if (!hasScope()) { whatBox.close(); whereBox.close(); $("findMsg").textContent = "Type what or where first."; quietFocus($("qWhat")); return; }
  runSearch();
});

/* ---------- One-tap filters + More filters ---------- */
const CHIPS = {
  phone: [() => F.phone, (on) => { F.phone = on; }],
  email: [() => F.email, (on) => { F.email = on; }],
  owner: [() => F.owner, (on) => { F.owner = on; }],
  noweb: [() => F.website === "no_real", (on) => { F.website = on ? "no_real" : ""; }],
  weak: [() => F.scores.indexOf("weak") >= 0, (on) => { F.scores = F.scores.filter((s) => s !== "weak"); if (on) F.scores.push("weak"); }],
  google: [() => F.tier === "google", (on) => { F.tier = on ? "google" : ""; }],
};
/** How many filters are on in "More filters" (the one-tap ones and the default "hide leads I have" aside). */
function moreCount() {
  let n = 0;
  if (F.minRating) n++;
  if (F.minRev || F.maxRev) n++;
  if (F.scores.some((s) => s !== "weak")) n++;
  if (F.website === "yes") n++;
  if (F.tier === "free") n++;
  if (F.zips.length) n++;
  if (F.q) n++;
  if (F.area) n++;
  if (!F.hideOwned) n++;
  return n;
}
function renderChips() {
  for (const b of document.querySelectorAll(".fchip[data-chip]")) b.setAttribute("aria-pressed", String(!!CHIPS[b.dataset.chip][0]()));
  // No lead in this search has a Google rating: the chip would only empty the results.
  document.querySelector('.fchip[data-chip="google"]').hidden = S.noGoogle && F.tier !== "google";
  const n = moreCount();
  $("moreCount").hidden = !n;
  $("moreCount").textContent = String(n);
}
for (const b of document.querySelectorAll(".fchip[data-chip]")) {
  b.addEventListener("click", () => {
    const c = CHIPS[b.dataset.chip];
    c[1](!c[0]());
    renderChips();
    if (S.active) runSearch(); // the count updates at once
  });
}

function openMore() {
  $("mRating").value = F.minRating;
  if (F.minRating && $("mRating").value !== F.minRating) { $("mRating").add(new Option(F.minRating + " ★ and up", F.minRating)); $("mRating").value = F.minRating; }
  $("mMinRev").value = F.minRev; $("mMaxRev").value = F.maxRev;
  for (const b of document.querySelectorAll('input[name="mScore"]')) b.checked = F.scores.indexOf(b.value) >= 0;
  for (const r of document.querySelectorAll('input[name="mWeb"]')) r.checked = r.value === F.website;
  for (const r of document.querySelectorAll('input[name="mTier"]')) r.checked = r.value === F.tier;
  $("mZip").value = F.zips.join(", ");
  $("mName").value = F.q;
  $("mHideOwned").checked = F.hideOwned;
  for (const o of $("mSort").querySelectorAll("option[data-rating]")) o.hidden = o.disabled = !!S.noGoogle;
  // No lead in this search has a Google rating: its rating, reviews and lead type filters could only
  // empty the results, so they're hidden (unless one is already on, so it can be turned off).
  $("mRatingBox").hidden = S.noGoogle && !F.minRating;
  $("mRevBox").hidden = S.noGoogle && !F.minRev && !F.maxRev;
  $("mTierBox").hidden = S.noGoogle && !F.tier;
  moreClearChips = false;
  $("mSort").value = S.sort + ":" + S.dir;
  if (!$("mSort").value || $("mSort").selectedOptions[0].disabled) $("mSort").value = "best:desc";
  moreArea = F.area; // the area only changes when Show results is pressed
  renderAreaNote();
  loadSaved();
  if (!$("moreDlg").open) $("moreDlg").showModal();
  ($("mRatingBox").hidden ? document.querySelector('input[name="mScore"]') : $("mRating")).focus();
}
let moreArea = "";
// "Clear all" was pressed: Show results also turns off the one-tap filters (phone, email, owner).
let moreClearChips = false;
function renderAreaNote() { $("mAreaTxt").textContent = moreArea ? "Drawn" : "None"; $("mAreaClear").hidden = !moreArea; }
function readMore() {
  F.minRating = $("mRating").value;
  F.minRev = wholeNumber($("mMinRev").value); F.maxRev = wholeNumber($("mMaxRev").value);
  F.scores = Array.from(document.querySelectorAll('input[name="mScore"]:checked')).map((b) => b.value);
  const web = document.querySelector('input[name="mWeb"]:checked'); F.website = web ? web.value : "";
  const tier = document.querySelector('input[name="mTier"]:checked'); F.tier = tier ? tier.value : "";
  F.zips = $("mZip").value.split(/[ ,;]+/).map((z) => z.trim()).filter((z) => /^[0-9A-Za-z-]{3,10}$/.test(z)).slice(0, 50);
  F.q = $("mName").value.trim().slice(0, 80);
  F.hideOwned = $("mHideOwned").checked;
  F.area = moreArea;
  if (moreClearChips) { F.phone = false; F.email = false; F.owner = false; moreClearChips = false; }
  const s = $("mSort").value.split(":");
  if (DEFAULT_DIR[s[0]]) { S.sort = s[0]; S.dir = s[1] === "desc" ? "desc" : "asc"; }
  else { S.sort = "best"; S.dir = "desc"; }
}
$("moreBtn").addEventListener("click", openMore);
$("moreCancel").addEventListener("click", () => $("moreDlg").close());
$("moreClear").addEventListener("click", () => {
  for (const b of document.querySelectorAll('input[name="mScore"]')) b.checked = false;
  for (const r of document.querySelectorAll('input[name="mWeb"], input[name="mTier"]')) r.checked = r.value === "";
  for (const id of ["mRating", "mMinRev", "mMaxRev", "mZip", "mName"]) $(id).value = "";
  $("mHideOwned").checked = true;
  $("mSort").value = "best:desc";
  moreArea = ""; renderAreaNote(); // F.area itself only changes on Show results
  // Every filter goes, the one-tap ones above the results too (on Show results; Cancel keeps them).
  moreClearChips = true;
});
$("moreForm").addEventListener("submit", (e) => {
  e.preventDefault();
  readMore();
  $("moreDlg").close();
  renderTokens(); renderChips();
  if (hasScope()) runSearch();
  else $("findMsg").textContent = "Type what or where, then Search.";
});
$("mAreaClear").addEventListener("click", () => { moreArea = ""; renderAreaNote(); });
$("mAreaDraw").addEventListener("click", () => {
  readMore();
  $("moreDlg").close();
  renderTokens(); renderChips();
  openMap(true);
});

/* ---------- Results ---------- */
// Online presence, the same colours everywhere (and on the website): under 40 red, 40-59 amber,
// 60-79 green, 80+ dark green. 0 is no website (or one that doesn't load): grey, not red.
function scoreClass(s) { if (s == null || s === "") return "none"; const n = Number(s); return n <= 0 ? "none" : n < 40 ? "bad" : n < 60 ? "warn" : n < 80 ? "ok" : "strong"; }
/** The band's name: Weak, Basic, Good, Strong; 0 = "No website" or "Site down" (has one that doesn't load); "" when not checked. */
function scoreWord(s, hasWebsite) {
  if (s == null || s === "") return "";
  const n = Number(s);
  return n <= 0 ? (hasWebsite ? "Site down" : "No website") : n < 40 ? "Weak" : n < 60 ? "Basic" : n < 80 ? "Good" : "Strong";
}
function onlinePill(s, hasWebsite) {
  if (s == null || s === "") return '<span class="muted" title="Not checked yet">—</span>';
  const w = scoreWord(s, hasWebsite);
  return '<span class="pill ' + scoreClass(s) + '" title="' + (Number(s) <= 0 ? esc(w) : "Online score " + esc(s) + " of 100") + '">' + w + "</span>";
}
/** Business names for reading: "JOE'S PLUMBING LLC" -> "Joe's Plumbing LLC", "Acme Llc" -> "Acme LLC". */
// The same rules as niceName() on the website (src/store/site.ts): "U.s." -> "U.S.", "P&a" -> "P&A".
function niceName(v) {
  let s = String(v == null ? "" : v).trim().split("  ").join(" ");
  const caps = /[A-Z]/.test(s) && !/[a-z]/.test(s);
  if (caps) s = s.toLowerCase().replace(/(^|[ (&/-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  return s.split(" ").map((w) => {
    if (/^u[.]?s[.]?a?[.]?[,:;)]?$/i.test(w) && w.indexOf(".") >= 0) return w.toUpperCase();
    if (caps && /^us[,:;)]?$/i.test(w)) return w.toUpperCase();
    if (/^[a-z]&[a-z][,:;)]?$/i.test(w)) return w.toUpperCase();
    return w.replace(/^(llc|pllc|llp|inc|usa|hvac)([.,:;)]?)$/i, (m, a, b) => (a.toLowerCase() === "inc" ? "Inc" : a.toUpperCase()) + b);
  }).join(" ");
}
/** "https://www.joes.com/" -> "joes.com" (for showing; the link keeps the real address). */
function siteText(u) { return String(u || "").replace(/^https?:[/][/](www[.])?/i, "").replace(/[/]+$/, ""); }
/** One line for an owned lead's address, without the city twice (street: the server's street part). */
function addressText(r) {
  const street = String(r.street != null ? r.street : r.address || "").trim(), city = String(r.city || "").trim();
  const cityLine = [city, [r.state, r.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  if (street && city && street.toLowerCase().indexOf(city.toLowerCase()) >= 0) return street;
  return [street, cityLine].filter(Boolean).join(", ");
}
function ratingHtml(r) {
  return r.rating != null ? esc(Number(r.rating).toFixed(1)) + " ★" + (r.reviews != null ? ' <span class="hint">(' + esc(num(r.reviews)) + ")</span>" : "") : NO;
}
const telHref = (p) => "tel:" + String(p).replace(/[^0-9+]/g, "");
/** "+18135550101" -> "(813) 555-0101"; other countries stay as they are. */
const phoneText = (p) => { const d = String(p || "").replace(/[^0-9]/g, ""); return d.length === 11 && d[0] === "1" ? "(" + d.slice(1, 4) + ") " + d.slice(4, 7) + "-" + d.slice(7) : String(p || ""); };
function ownerOf(r) { const c = r.contacts && r.contacts.length ? r.contacts[0] : (r.owner ? { name: r.owner, title: r.ownerTitle } : null); return c; }

function leadRow(r) {
  const own = !!r.owned;
  const phone = own ? (r.phone ? '<a href="' + esc(telHref(r.phone)) + '">' + esc(phoneText(r.phone)) + "</a>" : NO) : (r.phoneMasked ? esc(r.phoneMasked) : NO);
  const email = own ? (r.email ? '<a href="mailto:' + esc(r.email) + '">' + esc(r.email) + "</a>" : NO) : (r.hasEmail ? YES : NO);
  const o = own ? ownerOf(r) : null;
  const owner = own ? (o ? esc(o.name) : NO) : (r.hasOwner ? YES : NO);
  const id = String(r.id);
  const name = niceName(r.name);
  const city = [r.city, r.state].filter(Boolean).join(", ");
  // Phones and narrow screens: one line of details instead of the columns (only what's there).
  const bits = [];
  if (own ? r.phone : r.phoneMasked) bits.push(own ? phone : esc(r.phoneMasked));
  if (own ? r.email : r.hasEmail) bits.push(own ? email : "Email " + YES);
  if (own ? o : r.hasOwner) bits.push(own ? "Owner: " + owner : "Owner " + YES);
  if (scoreWord(r.score)) bits.push(onlinePill(r.score, r.hasWebsite));
  if (r.rating != null && !S.noGoogle) bits.push(esc(Number(r.rating).toFixed(1)) + " ★");
  if (city && F.cities.length !== 1) bits.push(esc(city));
  return '<tr class="' + (own ? "is-owned" : "") + '" data-id="' + esc(id) + '">'
    + '<td class="selcol">' + (own ? "" : '<input type="checkbox" class="rowsel" data-id="' + esc(id) + '"' + (S.selected.has(id) ? " checked" : "") + ' aria-label="Pick ' + esc(name) + '">') + "</td>"
    + '<td class="name">' + esc(name) + (own ? '<span class="owned">In your lists</span>' : "") + '<div class="sub">' + esc(prettyCat(r.category || "")) + "</div>"
    + (bits.length ? '<div class="mline">' + bits.join(" · ") + "</div>" : "") + "</td>"
    + '<td class="citycol" data-label="City">' + esc(city) + "</td>"
    + '<td data-label="Phone">' + phone + "</td>"
    + '<td data-label="Email">' + email + "</td>"
    + '<td data-label="Owner">' + owner + "</td>"
    + '<td data-label="Online">' + onlinePill(r.score, r.hasWebsite) + "</td>"
    + '<td class="rating" data-label="Rating">' + ratingHtml(r) + "</td></tr>";
}

function pagerHtml(total, page, size, maxPage) {
  const all = Math.max(1, Math.ceil(total / size));
  const pages = maxPage ? Math.min(all, maxPage) : all;
  if (total <= size) return "";
  return '<button type="button" class="ghost small" data-page="' + (page - 1) + '"' + (page <= 1 ? " disabled" : "") + ">‹ Previous</button>"
    + "<span>Page " + num(page) + " of " + num(pages) + "</span>"
    + '<button type="button" class="ghost small" data-page="' + (page + 1) + '"' + (page >= pages ? " disabled" : "") + ">Next ›</button>"
    + (all > pages ? '<span class="hint">The first ' + num(pages * size) + " are shown. Narrow the search to see the rest.</span>" : "");
}

function renderSortHeaders() {
  for (const th of document.querySelectorAll("#resTable th[data-col]")) {
    if (th.dataset.col === S.sort) th.setAttribute("aria-sort", S.dir === "asc" ? "ascending" : "descending");
    else th.removeAttribute("aria-sort");
  }
}

function updateGetButton() {
  const b = $("getBtn");
  const ok = canBuy();
  if (S.picking) {
    const n = S.selected.size;
    b.textContent = n ? "Get " + plural(n, "lead") : "Pick leads below";
    b.disabled = !ok || !n;
  } else if (!S.loaded) {
    // Never a stale count while a search runs.
    b.textContent = "Searching…";
    b.disabled = true;
  } else {
    b.textContent = S.total > MAX_BUY ? "Get the first " + num(MAX_BUY) : "Get " + plural(S.total, "lead");
    b.disabled = !ok || !S.total;
  }
  b.hidden = S.failed || (S.loaded && !S.total && !S.picking);
  // Picking and saving only make sense when there are results.
  const none = S.failed || (S.loaded && !S.total);
  $("pickBtn").hidden = none && !S.picking;
  $("saveSearch").hidden = none;
  $("sortRow").hidden = none;
  const why = !me ? "" : me.account.status === "pending" ? "Opens once your account is approved" : me.account.status === "suspended" ? "Your account is paused" : "";
  b.title = why;
  $("pickBtn").textContent = S.picking ? "Stop picking" : "Pick individual leads";
  $("pickBtn").setAttribute("aria-pressed", String(S.picking));
  $("resTable").classList.toggle("picking", S.picking);
}
function setPicking(on) {
  S.picking = !!on;
  if (!on) S.selected.clear();
  for (const box of document.querySelectorAll("#resBody .rowsel")) box.checked = S.selected.has(box.dataset.id);
  selectionChanged();
}
$("pickBtn").addEventListener("click", () => setPicking(!S.picking));

function updateSelAll() {
  const boxes = Array.from(document.querySelectorAll("#resBody .rowsel"));
  const all = $("selAll");
  all.disabled = boxes.length === 0;
  const on = boxes.filter((b) => b.checked).length;
  all.checked = boxes.length > 0 && on === boxes.length;
  all.indeterminate = on > 0 && on < boxes.length;
}
function selectionChanged() { updateSelAll(); updateGetButton(); }

// Keep the search in the address (so refresh keeps it) and remember it in this browser.
function rememberSearch() {
  const q = fullQuery();
  if (currentTab === "find") setHash("#find?" + q);
  lsSet("ls.lastFind", q);
}

// A browser sometimes drops a saved email into a search box: clear it.
["qWhat", "qWhere"].forEach((id) => $(id).addEventListener("input", () => { if ($(id).value.indexOf("@") >= 0) $(id).value = ""; }));
function runSearch() {
  S.active = true;
  S.page = 1;
  refreshFind();
}
function refreshFind() {
  loadLeads();
  if (map.on) loadMap();
}

function zeroHtml() {
  const s = S.suggestions || [];
  return '<tr class="emptyrow"><td colspan="8" class="empty">'
    + (s.length ? "Try:" + '<div class="suggest">' + s.map((x, i) => '<button type="button" class="ghost small" data-suggest="' + i + '">' + esc(x.label) + (x.n != null ? " (" + esc(num(x.n)) + ")" : "") + "</button>").join("") + "</div>"
      : "Try fewer filters or a wider area.")
    + "</td></tr>";
}

const SORT_OPTIONS = [["best:desc", "Most contact details first"], ["score:asc", "Weakest online first"], ["score:desc", "Strongest online first"],
  ["rating:desc", "Highest rating", 1], ["rating:asc", "Lowest rating", 1], ["reviews:desc", "Most reviews", 1], ["reviews:asc", "Fewest reviews", 1],
  ["name:asc", "Name, A to Z"], ["name:desc", "Name, Z to A"]];
/** The Sort menu (for phones and narrow screens, where the column headers aren't shown). */
function renderSortSel() {
  $("sortSel").innerHTML = SORT_OPTIONS.filter((o) => !(o[2] && S.noGoogle)).map((o) => '<option value="' + o[0] + '">' + esc(o[1]) + "</option>").join("");
  $("sortSel").value = S.sort + ":" + S.dir;
  if (!$("sortSel").value) $("sortSel").value = "best:desc";
}
$("sortSel").addEventListener("change", () => {
  const s = $("sortSel").value.split(":");
  if (!DEFAULT_DIR[s[0]]) return;
  S.sort = s[0]; S.dir = s[1] === "asc" ? "asc" : "desc"; S.page = 1;
  loadLeads();
});

/** "6 you already have are hidden · Show them" after getting leads from this search. */
function renderHiddenNote() {
  const j = S.justGot, el = $("hiddenNote");
  const on = !!(j && j.key === filterQuery() && F.hideOwned && j.n > 0 && !S.failed);
  el.hidden = !on;
  if (on) el.innerHTML = esc(num(j.n)) + " you already have " + (j.n === 1 ? "is" : "are") + ' hidden · <button type="button" class="link" id="showOwned">Show them</button>';
}
$("hiddenNote").addEventListener("click", (e) => {
  if (!e.target.closest || !e.target.closest("#showOwned")) return;
  F.hideOwned = false; S.justGot = null;
  renderChips(); runSearch();
});

async function loadLeads() {
  const my = ++S.req;
  S.loaded = false;
  S.failed = false;
  $("startCard").hidden = true;
  $("resultsArea").hidden = false;
  renderSortHeaders();
  renderSortSel();
  $("resBody").innerHTML = '<tr class="emptyrow"><td colspan="8" class="empty">Searching…</td></tr>';
  $("resTitle").textContent = "Searching…";
  $("resSub").hidden = true;
  $("resPager").innerHTML = "";
  updateGetButton();
  rememberSearch();
  try {
    const q = filterQuery();
    const d = await api("/api/leads?" + (q ? q + "&" : "") + "page=" + S.page + "&page_size=" + PAGE_SIZE + "&" + sortQuery());
    if (my !== S.req) return;
    S.total = Number(d.total || 0);
    S.maxPage = Number(d.maxPage || 200);
    S.rows = d.results || [];
    S.suggestions = d.suggestions || [];
    S.loaded = true;
    // No lead here has a Google rating: drop the rating column, chip and sorts (they'd only be empty).
    S.noGoogle = !!(d.counts && Number(d.counts.google) === 0 && S.total > 0);
    if (S.noGoogle && (S.sort === "rating" || S.sort === "reviews")) { S.sort = "best"; S.dir = "desc"; loadLeads(); return; }
    $("resTable").classList.toggle("norating", S.noGoogle);
    $("resTable").classList.toggle("onecity", F.cities.length === 1 && !F.radius);
    renderChips();
    renderSortSel();
    renderSortHeaders();
    const title = S.total ? headline(S.total) : "No " + (F.hideOwned ? "new " : "") + whatWords(2) + (whereWords() ? " " + whereWords() : "");
    $("resTitle").textContent = title;
    $("srLive").textContent = title;
    $("resSub").hidden = !S.total;
    $("resBody").innerHTML = S.rows.length ? S.rows.map(leadRow).join("") : zeroHtml();
    $("resPager").innerHTML = pagerHtml(S.total, S.page, PAGE_SIZE, S.maxPage);
  } catch (e) {
    if (my !== S.req) return;
    S.total = 0;
    S.loaded = true;
    S.failed = true;
    $("resTitle").textContent = "Couldn't load the results";
    $("srLive").textContent = "Couldn't load the results";
    $("resSub").hidden = true;
    $("resBody").innerHTML = '<tr class="emptyrow"><td colspan="8" class="empty"><span class="err">' + esc(e.message) + '</span><br><button type="button" data-retry="leads" style="margin-top:8px">Try again</button></td></tr>';
  }
  renderHiddenNote();
  selectionChanged();
}

$("resBody").addEventListener("change", (e) => {
  const t = e.target;
  if (!t.classList.contains("rowsel")) return;
  if (t.checked) S.selected.add(t.dataset.id); else S.selected.delete(t.dataset.id);
  selectionChanged();
});
$("resBody").addEventListener("click", (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.retry) { loadLeads(); return; }
  // Picking: a click anywhere on a row (not on a link or the box itself) ticks it.
  if (S.picking && t.closest && !t.closest("a, button, input")) {
    const tr = t.closest("tr[data-id]"), box = tr && tr.querySelector(".rowsel");
    if (box) { box.checked = !box.checked; box.dispatchEvent(new Event("change", { bubbles: true })); return; }
  }
  const b = t.closest && t.closest("button[data-suggest]");
  if (b) {
    const s = S.suggestions[Number(b.dataset.suggest)];
    if (!s) return;
    applyQuery(s.query + "&" + sortQuery());
    if (hasScope()) runSearch(); else showStart();
  }
});
$("selAll").addEventListener("change", () => {
  const on = $("selAll").checked;
  for (const b of document.querySelectorAll("#resBody .rowsel")) {
    b.checked = on;
    if (on) S.selected.add(b.dataset.id); else S.selected.delete(b.dataset.id);
  }
  selectionChanged();
});
$("resPager").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-page]");
  if (!b || b.disabled) return;
  S.page = Math.min(Math.max(Number(b.dataset.page), 1), S.maxPage || 200);
  loadLeads();
  $("resultsArea").scrollIntoView({ block: "start" });
});
for (const b of document.querySelectorAll("#resTable .sortbtn")) {
  b.addEventListener("click", () => {
    const s = b.dataset.sort;
    if (S.sort === s) S.dir = S.dir === "asc" ? "desc" : "asc";
    else { S.sort = s; S.dir = DEFAULT_DIR[s] || "asc"; }
    S.page = 1;
    loadLeads();
  });
}
// The filters row on phones scrolls sideways; the fade on the right goes once you reach the end.
$("chipRow").addEventListener("scroll", () => { const c = $("chipRow"); c.classList.toggle("atend", c.scrollLeft + c.clientWidth >= c.scrollWidth - 4); });

/* ---------- Before searching: examples + saved searches ---------- */
let examplesP = null;
function renderStart() {
  $("startCard").hidden = false;
  $("resultsArea").hidden = true;
  if (!examplesP) {
    examplesP = api("/api/examples").then((list) => {
      $("examples").innerHTML = (Array.isArray(list) ? list : []).slice(0, 3).map((x) => '<button type="button" class="ghost" data-example="' + esc(x.query) + '">' + esc(x.label) + "</button>").join("");
    }).catch(() => { examplesP = null; });
  }
  loadSaved();
}
$("examples").addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("[data-example]");
  if (!b) return;
  applyQuery(b.dataset.example);
  runSearch();
});

let findSetup = false;
function setupFind() {
  if (findSetup) return;
  findSetup = true;
  renderTokens(); renderChips();
  loadPickData().catch(() => {});
  loadSaved();
}

/* ---------- Get leads ---------- */
let pendingBuy = null;
function buyJob(affordable) {
  const picked = S.picking;
  const q = picked ? filterQuery() : fullQuery();
  const body = picked ? { ids: Array.from(S.selected) } : { all: true };
  if (affordable) body.affordable = true;
  return { picked, affordable: !!affordable, path: "/api/buy" + (q ? "?" + q : ""), body, quote: null };
}
$("getBtn").addEventListener("click", () => { if (canBuy()) openBuy(buyJob(false)); });

async function openBuy(job, note) {
  pendingBuy = job;
  job.quote = null;
  $("buyTitle").textContent = job.affordable ? "Get what you can afford" : "Get leads";
  $("buyNote").hidden = !note; $("buyNote").textContent = note || "";
  $("buyText").textContent = "Working out the price…";
  $("buyErr").textContent = "";
  for (const id of ["buyConfirm", "buyMore", "buyPart", "buyAgreeBox"]) $(id).hidden = true;
  $("buyAgree").checked = false;
  $("buyConfirm").disabled = false;
  $("buyConfirm").textContent = "Get the leads";
  $("buyCancel").textContent = "Cancel";
  if (!$("buyDlg").open) $("buyDlg").showModal();
  $("buyCancel").focus();
  try {
    const d = await postJson(job.path, Object.assign({ dryRun: true }, job.body));
    if (pendingBuy !== job) return;
    job.quote = d;
    renderQuote(job, d);
  } catch (e) {
    if (pendingBuy !== job) return;
    $("buyText").textContent = "";
    $("buyErr").textContent = e.message;
    $("buyMore").hidden = e.status !== 402;
    $("buyCancel").textContent = "Close";
  }
}

/**
 * The price in one sentence, from the dry run: "248 plumbers in Tampa, FL: 50 free this month +
 * 198 credits (≈ $99). You'll have 2 credits left."
 */
function quoteSentence(job, d) {
  const count = Number(d.count || 0), owned = Number(d.alreadyOwned || 0), free = Number(d.freeLeads || 0);
  const credits = Number(d.credits || 0), balance = Number(d.balance || 0), all = count + owned;
  const subject = job.picked ? plural(all, "picked lead")
    : d.capped ? "The first " + num(all) + " " + whatWords(all) + (whereWords() ? " " + whereWords() : "") : headline(all);
  const parts = [];
  if (free) parts.push(num(free) + " free this month");
  if (credits) parts.push(plural(credits, "credit") + approx(credits) + creditMix(d));
  let s = subject + ": " + (parts.length ? parts.join(" + ") : "free") + (owned ? " (" + num(owned) + " already yours)" : "") + ".";
  if (credits > balance) s += " You have " + plural(balance, "credit") + ", so you need " + num(credits - balance) + " more.";
  else if (credits) s += " You'll have " + plural(balance - credits, "credit") + " left.";
  else if (free) s += " You'll have " + num(Math.max(0, Number(d.freeLeft || 0) - free)) + " free leads left this month.";
  return s;
}

/**
 * What the credits pay for, when leads with a Google rating cost more: " (10 standard × 1 + 2 with
 * Google rating × 3)". The free leads cover the priciest first, so they come off the rated ones first.
 */
function creditMix(d) {
  const google = Number(d.google || 0), standard = Number(d.free || 0), freeLeads = Number(d.freeLeads || 0);
  const paidGoogle = Math.max(0, google - freeLeads);
  if (!paidGoogle || typeof prices !== "function") return "";
  const p = prices();
  if (p.free == null || p.google == null) return "";
  const paidStd = Math.max(0, standard - Math.max(0, freeLeads - google));
  return " (" + (paidStd ? num(paidStd) + " standard × " + num(p.free) + " + " : "") + num(paidGoogle) + " with Google rating × " + num(p.google) + ")";
}

function renderQuote(job, d) {
  const count = Number(d.count || 0), credits = Number(d.credits || 0), balance = Number(d.balance || 0);
  const owned = Number(d.alreadyOwned || 0);
  if (count === 0) {
    if (job.affordable || !owned) {
      $("buyText").textContent = "Your free leads and credits don't cover any of these yet.";
      $("buyMore").hidden = false;
      $("buyCancel").textContent = "Close";
      return;
    }
    // Already theirs: nothing to pay, but they can still save them as a list.
    $("buyText").textContent = "You already have " + (owned === 1 ? "this lead" : "all " + num(owned) + " of these") + ". Nothing to pay.";
    $("buyConfirm").hidden = false;
    $("buyConfirm").textContent = "Save as a list";
    return;
  }
  $("buyText").textContent = quoteSentence(job, d);
  if (credits > balance) {
    $("buyMore").hidden = false;
    const cover = Number(d.coverable || 0);
    if (cover > 0 && !job.affordable) { $("buyPart").hidden = false; $("buyPart").textContent = "Get the first " + num(cover) + " you can afford (cheapest first)"; }
    return;
  }
  $("buyConfirm").hidden = false;
  if (credits > BIG_SPEND) {
    $("buyAgreeBox").hidden = false;
    $("buyAgreeText").textContent = "I understand this spends " + plural(credits, "credit") + approx(credits) + ".";
    $("buyConfirm").disabled = true;
  }
}
$("buyAgree").addEventListener("change", () => { $("buyConfirm").disabled = !$("buyAgree").checked; });
$("buyCancel").addEventListener("click", () => $("buyDlg").close());
$("buyMore").addEventListener("click", () => { $("buyDlg").close(); getMoreCredits(); });
// Only what the free leads + balance cover (cheapest first), for the same request.
$("buyPart").addEventListener("click", () => {
  const j = pendingBuy;
  if (j) openBuy({ picked: j.picked, affordable: true, path: j.path, body: Object.assign({}, j.body, { affordable: true }), quote: null });
});
$("buyDlg").addEventListener("close", () => { pendingBuy = null; });
$("buyConfirm").addEventListener("click", async () => {
  const job = pendingBuy;
  if (!job || !job.quote) return;
  $("buyConfirm").disabled = true;
  $("buyConfirm").textContent = "Getting them…";
  $("buyErr").textContent = "";
  try {
    // expectedCredits: the server refuses (409) rather than charge more than shown here.
    const d = await postJson(job.path, Object.assign({ expectedCredits: Number(job.quote.credits || 0) }, job.body));
    if ($("buyDlg").open) $("buyDlg").close();
    if (me && d.balance != null) { me.account.credits = d.balance; renderHeader(); }
    setPicking(false);
    refreshMe();
    // The leads just got now count as "already have" (hidden by default): say so, with a way to show them.
    emailCounts = {}; // All my leads changed
    const key = filterQuery(), got = Number(d.bought || 0);
    if (got) S.justGot = { key, n: (S.justGot && S.justGot.key === key ? S.justGot.n : 0) + got };
    refreshFind();
    showDone(d);
  } catch (e) {
    if (pendingBuy !== job) return;
    if (e.status === 409) { openBuy(job, e.message); return; } // show the new price instead of trying again
    $("buyErr").textContent = e.message;
    $("buyMore").hidden = e.status !== 402;
    $("buyConfirm").disabled = e.status === 402 || e.status === 403;
    $("buyConfirm").textContent = "Try again";
    if (e.status === 403) refreshMe();
  }
});

let lastBuy = null;
function showDone(d) {
  lastBuy = d;
  const listed = !!d.listId;
  $("doneTitle").textContent = listed ? "List saved" : "Done";
  // "Plumbers · Tampa, FL · 248 leads" ("… (2 picked)" and "12 picked leads" already say how many).
  $("doneText").textContent = !listed ? "You got " + plural(d.bought, "lead") + "."
    : / picked leads?$|[(][0-9,]+ picked[)]$/.test(d.listName) ? d.listName : d.listName + " · " + plural(d.listCount, "lead");
  const bits = [];
  if (Number(d.freeLeads) > 0) bits.push(num(d.freeLeads) + " free");
  if (Number(d.credits) > 0) bits.push(plural(d.credits, "credit") + " used");
  bits.push(plural(d.balance, "credit") + " left");
  $("doneHint").textContent = bits.join(" · ");
  $("doneDl").hidden = !listed && !Number(d.bought);
  const cold = $("doneDl").querySelector('[data-dl="cold_email"]');
  setColdEmail(cold, null);
  if (listed) withEmailOf(d.listId).then((n) => { if (lastBuy === d) setColdEmail(cold, n); }).catch(() => {});
  $("doneDlg").showModal();
  const first = $("doneDl").hidden ? $("doneLists") : $("doneDl").querySelector("button");
  first.focus();
}
$("doneKeep").addEventListener("click", () => $("doneDlg").close());
$("doneLists").addEventListener("click", () => { $("doneDlg").close(); switchTab("lists"); });
$("doneDl").addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("[data-dl]");
  if (!b || !lastBuy) return;
  download(b.dataset.dl, lastBuy.listId ? { list: lastBuy.listId } : { since: lastBuy.at || "" }, b);
});

/* ---------- Your lists ---------- */
// How many leads of a list ("all" = All my leads) have an email: the cold email file needs them.
let emailCounts = {};
async function withEmailOf(listId) {
  const k = String(listId || "all");
  if (emailCounts[k] != null) return emailCounts[k];
  const d = await api(k === "all" ? "/api/my-leads?page_size=1" : "/api/lists/" + encodeURIComponent(k) + "?page_size=1");
  emailCounts[k] = Number(d.withEmail || 0);
  return emailCounts[k];
}
const COLD_LABEL = "For cold email";
/** n = how many have an email (null = not known yet). */
function setColdEmail(btn, n) {
  if (!btn) return;
  const none = n === 0;
  btn.disabled = none;
  btn.textContent = none ? "No emails in this list" : COLD_LABEL;
  btn.title = none ? "None of these leads has an email, so the cold email file would be empty." : "";
}
const lists = { items: [], allCount: 0, req: 0 };
let menuSeq = 0;
function dlMenu(id, label) {
  const m = "dlm" + (++menuSeq);
  return '<div class="menuwrap"><button type="button" class="ghost small" data-menu="' + m + '" aria-haspopup="true" aria-expanded="false" aria-controls="' + m + '" aria-label="Download ' + esc(label) + '">Download ▾</button>'
    + '<div class="menu dlmenu" id="' + m + '" hidden>'
    + '<button type="button" data-dl="simple" data-list="' + esc(id) + '">Spreadsheet (CSV)</button>'
    + '<button type="button" data-dl="cold_email" data-list="' + esc(id) + '">' + COLD_LABEL + "</button>"
    + '<button type="button" data-dl="json" data-list="' + esc(id) + '">JSON</button></div></div>';
}
function listCard(l) {
  const meta = [fmtDate(l.createdAt, true), plural(l.count, "lead")].concat(l.byName ? ["by " + l.byName] : []).join(" · ");
  const m = "lom" + (++menuSeq);
  return '<div class="card listcard"><div class="lmain"><span class="lname">' + esc(l.name) + '</span><span class="hint">' + esc(meta) + "</span></div>"
    + '<div class="lact"><button type="button" class="ghost small" data-open="' + esc(l.id) + '">Open</button>' + dlMenu(l.id, l.name)
    + '<div class="menuwrap"><button type="button" class="ghost small morebtn" data-menu="' + m + '" aria-haspopup="true" aria-expanded="false" aria-controls="' + m + '" aria-label="More for ' + esc(l.name) + '">⋯</button>'
    + '<div class="menu" id="' + m + '" hidden><button type="button" data-rename="' + esc(l.id) + '">Rename</button>'
    + '<button type="button" data-del="' + esc(l.id) + '" style="color:var(--bad)">Delete list</button></div></div></div></div>';
}
async function loadLists() {
  const my = ++lists.req;
  $("listsBody").innerHTML = '<div class="card hint">Loading…</div>';
  try {
    const d = await api("/api/lists");
    if (my !== lists.req) return;
    lists.items = d.lists || [];
    lists.allCount = Number(d.allCount || 0);
    if (!lists.items.length && !lists.allCount) {
      $("listsBody").innerHTML = '<div class="card startcard"><p>No lists yet. Every time you get leads, they are saved here.</p><button type="button" data-go="find">Start searching</button></div>';
      return;
    }
    $("listsBody").innerHTML = '<div class="card listcard all"><div class="lmain"><span class="lname">All my leads</span><span class="hint">' + esc(plural(lists.allCount, "lead")) + "</span></div>"
      + '<div class="lact"><button type="button" class="ghost small" data-open="all">Open</button>' + dlMenu("all", "all my leads") + "</div></div>"
      + lists.items.map(listCard).join("");
  } catch (e) {
    if (my !== lists.req) return;
    $("listsBody").innerHTML = '<div class="card"><span class="err">' + esc(e.message) + '</span> <button type="button" class="ghost small" data-go="lists">Try again</button></div>';
  }
}
async function renameList(id, current) {
  const input = await askText("Rename list", "Name", current, "Save");
  if (input == null) return false;
  const name = input.trim().slice(0, 80);
  if (!name) { toast("The list needs a name.", true); return false; }
  try {
    await api("/api/lists/" + encodeURIComponent(id), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    toast("Renamed");
    return name;
  } catch (e) { toast("Couldn't rename it: " + e.message, true); return false; }
}
async function deleteList(id, name) {
  if (!(await ask("Delete this list?", "“" + name + "” goes from Your lists. The leads stay yours, in All my leads.", "Delete list", true))) return false;
  try { await api("/api/lists/" + encodeURIComponent(id), { method: "DELETE" }); toast("List deleted"); return true; }
  catch (e) { toast("Couldn't delete it: " + e.message, true); return false; }
}
$("listsBody").addEventListener("click", async (e) => {
  const b = e.target.closest && e.target.closest("button");
  if (!b) return;
  if (b.dataset.go === "find") { switchTab("find"); return; }
  if (b.dataset.go === "lists") { loadLists(); return; }
  if (b.dataset.open) { openList(b.dataset.open); return; }
  if (b.dataset.dl) { download(b.dataset.dl, b.dataset.list === "all" ? {} : { list: b.dataset.list }, b); return; }
  const l = lists.items.find((x) => x.id === (b.dataset.rename || b.dataset.del));
  if (!l) return;
  if (b.dataset.rename) { if (await renameList(l.id, l.name)) loadLists(); }
  else if (b.dataset.del) { if (await deleteList(l.id, l.name)) loadLists(); }
});

/* ---------- One list (or All my leads), with full details ---------- */
const lv = { id: "all", name: "", page: 1, req: 0, total: 0 };
function openList(id) {
  lv.id = String(id || "all");
  lv.page = 1;
  lv.name = "";
  lv.total = 0;
  $("lvSearch").value = "";
  setHash("#list?id=" + encodeURIComponent(lv.id));
  switchTab("list");
}
function fixesLine(r) {
  const f = (r.fixes || []).filter(Boolean);
  return f.length ? '<div class="fixes"><b>What to fix:</b> ' + f.map(esc).join("; ") + "</div>" : "";
}
function factsLine(r) {
  const bits = [];
  if (r.employees) bits.push(esc(r.employees) + " employees");
  if (r.revenue) bits.push(esc(r.revenue) + " revenue");
  if (r.foundedYear) bits.push("since " + esc(r.foundedYear));
  const pills = (r.labels || []).map((t) => '<span class="pill ' + (t.indexOf("Above") === 0 ? "ok" : "warn") + '">' + esc(t) + "</span>").join(" ");
  if (!bits.length && !pills) return "";
  return '<div class="facts"' + (r.sizeSource ? ' title="Size: ' + esc(r.sizeSource) + '"' : "") + ">" + bits.join(" · ") + (pills ? (bits.length ? " " : "") + pills : "") + "</div>";
}
function ownedRow(r) {
  const site = isWebLink(r.website) ? '<a class="site" href="' + esc(r.website) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(siteText(r.website)) + "</a>" : (r.website ? esc(siteText(r.website)) : NO);
  const people = r.contacts && r.contacts.length ? r.contacts : (r.owner ? [{ name: r.owner, title: r.ownerTitle }] : []);
  const owner = people.length ? people.map((p) => esc(p.name) + (p.title ? ' <span class="hint">' + esc(p.title) + "</span>" : "")).join("<br>") : NO;
  const phones = r.phones && r.phones.length ? r.phones : (r.phone ? [r.phone] : []);
  const phone = phones.length ? phones.map((p) => '<a href="' + esc(telHref(p)) + '">' + esc(phoneText(p)) + "</a>").join("<br>") : NO;
  const emails = r.emails && r.emails.length ? r.emails : (r.email ? [r.email] : []);
  const email = emails.length ? emails.map((m) => '<a href="mailto:' + esc(m) + '">' + esc(m) + "</a>").join("<br>") : NO;
  const where = addressText(r);
  return "<tr>"
    + '<td class="name">' + esc(niceName(r.name)) + '<div class="sub">' + esc([prettyCat(r.category || ""), [r.city, r.state].filter(Boolean).join(", ")].filter(Boolean).join(" · "))
    + (scoreWord(r.score) ? " " + onlinePill(r.score, r.hasWebsite) : "") + "</div>" + factsLine(r) + fixesLine(r) + "</td>"
    + '<td data-label="Phone">' + phone + '</td><td data-label="Email">' + email + '</td><td data-label="Owner">' + owner + '</td><td data-label="Website">' + site + "</td>"
    + '<td class="wrap" data-label="Address">' + (where ? esc(where) : NO) + "</td></tr>";
}
async function loadListView() {
  const my = ++lv.req;
  const all = lv.id === "all";
  $("lvRename").hidden = all; $("lvDelete").hidden = all;
  if (!lv.name) $("lvName").textContent = all ? "All my leads" : "…";
  $("lvBody").innerHTML = '<tr class="emptyrow"><td colspan="6" class="empty">Loading…</td></tr>';
  $("lvPager").innerHTML = "";
  const p = new URLSearchParams();
  p.set("page", String(lv.page)); p.set("page_size", String(PAGE_SIZE));
  const q = $("lvSearch").value.trim(); if (q) p.set("q", q);
  try {
    const d = await api((all ? "/api/my-leads?" : "/api/lists/" + encodeURIComponent(lv.id) + "?") + p.toString());
    if (my !== lv.req) return;
    lv.name = all ? "All my leads" : d.list.name;
    $("lvName").textContent = lv.name;
    const total = Number(d.total || 0);
    $("lvMeta").textContent = plural(total, "lead") + (q ? (total === 1 ? " matches" : " match") : "") + (all ? "" : " · " + fmtDate(d.list.createdAt, true));
    // A name search only filters what's shown here: the downloads always have the whole list.
    $("lvDlNote").hidden = !q;
    const rows = d.results || [];
    $("lvBody").innerHTML = rows.length ? rows.map(ownedRow).join("")
      : '<tr class="emptyrow"><td colspan="6" class="empty">' + (q ? "Nothing matches." : "No leads here yet.") + "</td></tr>";
    $("lvPager").innerHTML = pagerHtml(total, lv.page, PAGE_SIZE, 0);
    if (!q) { lv.total = total; emailCounts[lv.id] = Number(d.withEmail || 0); }
    $("lvDl").querySelector("[data-menu]").disabled = !lv.total;
    setColdEmail($("lvDl").querySelector('[data-dl="cold_email"]'), emailCounts[lv.id] != null ? emailCounts[lv.id] : null);
  } catch (e) {
    if (my !== lv.req) return;
    if (e.status === 404) { toast("That list wasn't found.", true); switchTab("lists"); return; }
    $("lvBody").innerHTML = '<tr class="emptyrow"><td colspan="6" class="empty"><span class="err">' + esc(e.message) + '</span><br><button type="button" class="ghost small" data-retry="list" style="margin-top:8px">Try again</button></td></tr>';
  }
}
let lvTimer = null;
$("lvSearch").addEventListener("input", () => { clearTimeout(lvTimer); lvTimer = setTimeout(() => { lv.page = 1; loadListView(); }, 350); });
$("lvBody").addEventListener("click", (e) => { if (e.target.dataset && e.target.dataset.retry) loadListView(); });
$("lvPager").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-page]");
  if (!b || b.disabled) return;
  lv.page = Number(b.dataset.page);
  loadListView();
});
$("listBack").addEventListener("click", () => switchTab("lists"));
$("lvDl").addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("[data-dl]");
  if (b) download(b.dataset.dl, lv.id === "all" ? {} : { list: lv.id }, b);
});
$("lvRename").addEventListener("click", async () => { const n = await renameList(lv.id, lv.name); if (n) { lv.name = n; $("lvName").textContent = n; } });
$("lvDelete").addEventListener("click", async () => { if (await deleteList(lv.id, lv.name)) switchTab("lists"); });

/* ---------- Downloads ---------- */
function saveBlob(blob, name) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href; a.download = name; a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 20000);
}
// Fetch the file first so a failure shows a message instead of a broken download.
// extra: { list } = exactly that list's leads, { since } = what was just got, {} = all your leads.
async function download(format, extra, btn) {
  if (DEMO) { demoDownload(format, extra || {}); return; }
  // A cold email file of a list without emails would be empty: say so instead.
  if (format === "cold_email" && !(extra && extra.since)) {
    let n = null;
    try { n = await withEmailOf((extra && extra.list) || "all"); } catch (e) { n = null; }
    if (n === 0) { toast("No emails in this list, so the cold email file would be empty.", true, true); return; }
  }
  const p = new URLSearchParams();
  p.set("format", format);
  for (const k of Object.keys(extra || {})) if (extra[k]) p.set(k, extra[k]);
  const url = "/api/download?" + p.toString();
  if (btn) btn.disabled = true;
  toast("Preparing your download…");
  try {
    let res;
    try { res = await fetch(url, { credentials: "same-origin" }); }
    catch (e) { throw new Error("Can't reach the store. Check your internet connection and try again."); }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (res.status === 401 && signedIn) showSignedOut("Your session ended. Please sign in again.");
      throw new Error(body.error || "Something went wrong (" + res.status + "). Please try again.");
    }
    const blob = await res.blob();
    const m = /filename="?([^";]+)"?/i.exec(res.headers.get("content-disposition") || "");
    saveBlob(blob, m ? m[1] : "leads." + (format === "json" ? "json" : "csv"));
    toast("Your download is ready" + (format === "cold_email" ? " (only leads with an email are in this file)" : ""));
  } catch (e) {
    toast("Couldn't download: " + e.message, true);
  } finally { if (btn) btn.disabled = false; }
}

/* ---------- Credits ---------- */
const KIND_LABELS = { grant: "Credits added", purchase: "Leads", refund: "Refund", adjust: "Adjustment", payment: "Credits bought" };
/**
 * Older history lines read "1 leads (1 standard, 0 premium, 1 free this month)": shown the new way,
 * "1 lead (free this month)" (proper plural, no zero parts). New lines already come like that.
 */
function ledgerNote(note) {
  const m = /^([0-9,]+) leads [(]([0-9,]+) standard, ([0-9,]+) premium(, ([0-9,]+) free this month)?[)]$/.exec(String(note || ""));
  if (!m) return String(note || "");
  const n = (x) => Number(String(x || "0").split(",").join(""));
  const count = n(m[1]), std = n(m[2]), google = n(m[3]), free = n(m[5]);
  const parts = [];
  if (std && google) parts.push(num(std) + " standard, " + num(google) + " with Google rating");
  else if (google) parts.push("with Google rating");
  if (free) parts.push(free >= count ? "free this month" : num(free) + " free this month");
  return plural(count, "lead") + (parts.length ? " (" + parts.join("; ") + ")" : "");
}
async function loadCredits() {
  const p = prices();
  const cp = creditPrice();
  const showBalance = () => {
    $("crBalance").textContent = me ? plural(me.account.credits, "credit") : "";
    $("crValue").hidden = cp == null || !me;
    if (cp != null && me) $("crValue").textContent = "≈ " + money(cp * Number(me.account.credits || 0)) + " · 1 credit = " + money(cp);
  };
  showBalance();
  const fr = me && me.free;
  $("crFree").hidden = !fr;
  if (fr) $("crFree").textContent = num(fr.perMonth) + " free leads every month, " + num(fr.left) + " left this month";
  $("crPacksCard").hidden = !BRAND.cardPayments;
  if (BRAND.cardPayments) $("crPacks").innerHTML = packsHtml();
  $("crMore").hidden = BRAND.cardPayments;
  $("crPrices").textContent = p.free != null && p.google != null
    ? "Standard lead: " + plural(p.free, "credit") + approx(p.free) + " · With Google rating: " + plural(p.google, "credit") + approx(p.google) + " · Leads you have are free to download again"
    : "";
  $("crBody").innerHTML = '<tr><td colspan="5" class="empty">Loading…</td></tr>';
  try {
    const d = await api("/api/credits");
    if (me && d.balance != null) { me.account.credits = d.balance; renderHeader(); showBalance(); }
    const rows = d.history || [];
    $("crBody").innerHTML = rows.length ? rows.map((h) => {
      const delta = Number(h.delta || 0);
      const note = ledgerNote(h.note);
      // A purchase reads "Got 12 leads (5 free this month)" (the note already says "leads").
      const what = h.kind === "purchase" && note ? esc("Got " + note)
        : esc(KIND_LABELS[h.kind] || h.kind || "") + (note ? ' <span class="hint">' + esc(note) + "</span>" : "");
      return '<tr><td class="name">' + esc(fmtDate(h.at)) + '</td><td class="wrap">' + what + "</td>"
        + '<td data-label="Who">' + (h.byName ? esc(h.byName) : NO) + "</td>"
        + '<td data-label="Change"' + (delta ? ' class="' + (delta > 0 ? "delta-pos" : "delta-neg") + '">' + (delta > 0 ? "+" : "") + num(delta) : ' class="muted">Free') + "</td>"
        + '<td data-label="Balance">' + num(h.balance) + "</td></tr>";
    }).join("") : '<tr><td colspan="5" class="empty">No changes yet.</td></tr>';
  } catch (e) {
    $("crBody").innerHTML = '<tr><td colspan="5" class="empty"><span class="err">' + esc(e.message) + '</span><br><button type="button" class="ghost small" id="crRetry" style="margin-top:8px">Try again</button></td></tr>';
    $("crRetry").onclick = loadCredits;
  }
}

/* ---------- Map (Leaflet from cdnjs, OpenStreetMap tiles), with a drawn-area filter ---------- */
const map = { on: false, req: 0, lmap: null, layer: null, areaShape: null, drawLine: null, drawing: false, pts: [], fitKey: null, points: [] };
let leafletLoading = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (leafletLoading) return leafletLoading;
  leafletLoading = new Promise((ok, fail) => {
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"; document.head.appendChild(css);
    const js = document.createElement("script"); js.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
    js.onload = () => ok();
    js.onerror = () => { leafletLoading = null; js.remove(); fail(new Error("The map couldn't load. Check your internet connection and try again.")); };
    document.head.appendChild(js);
  });
  return leafletLoading;
}
// Theme colours as plain rgb() (custom properties may hold color-mix(), which canvas can't read).
function themeColor(name) {
  const p = $("colorProbe");
  p.style.color = "var(" + name + ")";
  const c = getComputedStyle(p).color;
  if (/^rgb/.test(c)) return c;
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return "rgb(" + d[0] + ", " + d[1] + ", " + d[2] + ")";
  } catch (e) { return c; }
}
function mapColors() {
  return { bad: themeColor("--bad"), warn: themeColor("--warn"), ok: themeColor("--ok"), strong: themeColor("--strong"), none: themeColor("--muted"),
    head: themeColor("--head"), accent: themeColor("--accent"), panel: themeColor("--panel") };
}
function dotColor(v, c) { return c[scoreClass(v)] || c.none; }
function popupHtml(p) {
  const sel = S.selected.has(String(p.id));
  const bits = [];
  if (p.phoneMasked) bits.push(esc(p.phoneMasked));
  if (p.hasEmail) bits.push("Email " + YES);
  if (p.hasOwner) bits.push("Owner " + YES);
  return '<div class="mappop"><strong>' + esc(niceName(p.name)) + "</strong>"
    + (p.category ? '<div class="cat">' + esc(prettyCat(p.category)) + "</div>" : "")
    + (bits.length ? '<div class="ln">' + bits.join(" · ") + "</div>" : "")
    + (scoreWord(p.score) ? '<div class="ln">' + onlinePill(p.score, p.hasWebsite) + "</div>" : "")
    + (p.owned ? '<div class="ln"><span class="owned" style="margin-left:0">In your lists</span></div>'
      : '<button type="button" class="small" data-mapsel="' + esc(p.id) + '"' + (sel ? " disabled" : "") + ">" + (sel ? "Picked" : "Pick") + "</button>")
    + "</div>";
}
function areaPoints(a) { return a ? a.split(";").map((x) => x.split(",").map(Number)) : []; }

function drawPoints() {
  if (!map.lmap || !window.L) return [];
  const c = mapColors();
  if (map.layer) map.layer.remove();
  map.layer = L.layerGroup().addTo(map.lmap);
  const pts = [];
  for (const p of map.points) {
    if (!Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lng))) continue;
    const ll = [Number(p.lat), Number(p.lng)];
    // While drawing an area the dots don't catch clicks, so a corner can go right on top of one.
    const dot = L.circleMarker(ll, { radius: 6, color: p.owned ? c.ok : c.panel, weight: p.owned ? 3 : 1, fillColor: dotColor(p.score, c), fillOpacity: .85,
      bubblingMouseEvents: false, interactive: !map.drawing });
    if (!map.drawing) dot.bindPopup(() => popupHtml(p));
    dot.addTo(map.layer);
    pts.push(ll);
  }
  if (map.areaShape) { map.areaShape.remove(); map.areaShape = null; }
  if (F.area) map.areaShape = L.polygon(areaPoints(F.area), { color: c.head, weight: 2, fillOpacity: .05, interactive: false }).addTo(map.lmap);
  return pts;
}

async function loadMap() {
  const my = ++map.req;
  const infoEl = $("mapInfo");
  infoEl.textContent = "Loading the map…";
  try {
    await loadLeaflet();
    if (my !== map.req || !map.on) return;
    if (!map.lmap) {
      map.lmap = L.map("leadMap", { preferCanvas: true }).setView([39.5, -98.35], 4);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(map.lmap);
      map.lmap.on("click", (e) => { if (!map.drawing || map.pts.length >= 40) return; map.pts.push([e.latlng.lat, e.latlng.lng]); drawShape(); });
    }
    setTimeout(() => { if (map.lmap) map.lmap.invalidateSize(); }, 30);
    // Only search the map when there's something to search in (keeps it cheap).
    if (!hasScope()) {
      map.points = []; drawPoints();
      infoEl.textContent = map.drawing ? "Click the map to add corners, then Use this area." : "Search first to see businesses, or draw an area.";
      return;
    }
    const q = filterQuery();
    const d = await api("/api/map" + (q ? "?" + q : ""));
    if (my !== map.req || !map.on) return;
    map.points = d.points || [];
    const pts = drawPoints();
    // Only move the view when the search changed (not after getting leads or reloading the same search).
    if (map.fitKey !== q) {
      map.fitKey = q;
      if (map.areaShape) map.lmap.fitBounds(map.areaShape.getBounds(), { padding: [20, 20] });
      else if (pts.length) map.lmap.fitBounds(pts, { padding: [20, 20], maxZoom: 14 });
    }
    const total = Number(d.total || 0);
    infoEl.textContent = (pts.length === total ? num(pts.length) + (pts.length === 1 ? " business" : " businesses") + " on the map" : num(pts.length) + " of " + num(total) + " on the map")
      + (d.capped ? " (narrow the search to see the rest)" : "")
      + (map.drawing ? ". Click the map to add corners, then Use this area." : "");
  } catch (e) {
    if (my !== map.req) return;
    infoEl.innerHTML = '<span class="err">' + esc(e.message) + '</span> <button type="button" class="ghost small" id="mapRetry">Try again</button>';
    $("mapRetry").onclick = () => loadMap();
  }
}
function drawShape() {
  if (!map.lmap) return;
  if (map.drawLine) { map.drawLine.remove(); map.drawLine = null; }
  if (map.pts.length) map.drawLine = L.polygon(map.pts, { color: mapColors().accent, weight: 2, fillOpacity: .08, dashArray: "4 4", interactive: false }).addTo(map.lmap);
  $("mapUse").hidden = map.pts.length < 3;
  if (map.drawing) $("mapInfo").textContent = map.pts.length >= 40 ? "That's the most corners (40). Press Use this area."
    : plural(map.pts.length, "corner") + ". Click the map to add corners (3 or more), then Use this area.";
}
// Light / dark switch: redraw the dots and shapes in the new colours.
document.addEventListener("themechange", () => { if (map.lmap) { drawPoints(); drawShape(); } });
function stopDrawing() {
  const was = map.drawing;
  map.drawing = false; map.pts = []; drawShape();
  $("leadMap").classList.remove("drawing");
  if (was && map.lmap) drawPoints(); // the dots catch clicks again
  $("mapDraw").textContent = "Draw an area";
  $("mapDraw").setAttribute("aria-pressed", "false");
  $("mapUse").hidden = true;
}
function startDrawing() {
  map.drawing = true; map.pts = []; drawShape();
  $("leadMap").classList.add("drawing");
  if (map.lmap) { map.lmap.closePopup(); drawPoints(); }
  $("mapDraw").textContent = "Cancel drawing";
  $("mapDraw").setAttribute("aria-pressed", "true");
  $("mapInfo").textContent = "Click the map to add corners (3 or more), then Use this area.";
}
function setMapOn(on) {
  map.on = !!on;
  $("mapCard").hidden = !map.on;
  $("mapBtn").setAttribute("aria-pressed", String(map.on));
  $("mapClear").hidden = !F.area;
  if (map.on) { loadMap(); $("mapCard").scrollIntoView({ block: "start" }); }
  else { map.req++; stopDrawing(); }
}
async function openMap(draw) {
  setMapOn(true);
  if (!draw) return;
  try { await loadLeaflet(); } catch (e) { return; }
  if (map.lmap) startDrawing(); else setTimeout(() => { if (map.lmap) startDrawing(); }, 400);
}
function setArea(a) {
  F.area = a;
  $("mapClear").hidden = !F.area;
  renderTokens(); renderChips();
  if (hasScope()) runSearch(); else { showStart(); if (map.on) loadMap(); }
}
$("mapBtn").addEventListener("click", () => setMapOn(!map.on));
$("mapDraw").addEventListener("click", () => {
  if (map.drawing) { stopDrawing(); loadMap(); return; }
  if (!map.lmap) { toast("Wait for the map to load, then draw."); return; }
  startDrawing();
});
$("mapUse").addEventListener("click", () => {
  const a = cleanArea(map.pts.map((x) => x[0] + "," + x[1]).join(";"));
  stopDrawing();
  if (a) setArea(a);
});
$("mapClear").addEventListener("click", () => setArea(""));
$("leadMap").addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("[data-mapsel]");
  if (!b) return;
  const id = String(b.dataset.mapsel);
  if (!S.picking) S.picking = true;
  S.selected.add(id);
  b.textContent = "Picked"; b.disabled = true;
  for (const box of document.querySelectorAll("#resBody .rowsel")) if (box.dataset.id === id) box.checked = true;
  selectionChanged();
  toast(plural(S.selected.size, "lead") + " picked");
});

/* ---------- Saved searches ---------- */
let savedList = [];
function renderSaved(keepId) {
  const sel = $("savedSel");
  sel.innerHTML = savedList.length
    ? '<option value="">Pick a saved search</option>' + savedList.map((s) => '<option value="' + esc(s.id) + '">' + esc(s.name) + "</option>").join("")
    : '<option value="">None yet</option>';
  if (keepId != null && savedList.some((s) => String(s.id) === String(keepId))) sel.value = String(keepId);
  sel.disabled = !savedList.length;
  updateSavedButtons();
  const quick = savedList.slice(0, 5);
  $("savedQuick").hidden = !quick.length;
  $("savedQuick").innerHTML = quick.length ? '<span class="hint" style="align-self:center">Saved:</span>' + quick.map((s) => '<button type="button" class="ghost small" data-saved="' + esc(s.id) + '">' + esc(s.name) + "</button>").join("") : "";
  // "Saved ▾" next to the filters: every saved search, one tap away.
  $("savedBtn").hidden = !savedList.length;
  $("savedMenu").innerHTML = '<div class="who">Saved searches (' + esc(num(savedList.length)) + " of " + MAX_SAVED + ")</div>"
    + savedList.map((s) => '<button type="button" data-saved="' + esc(s.id) + '">' + esc(s.name) + "</button>").join("");
}
function updateSavedButtons() { const on = !!$("savedSel").value; $("savedUse").disabled = !on; $("savedDel").disabled = !on; }
let savedReq = 0;
async function loadSaved(keepId) {
  const my = ++savedReq;
  try {
    const d = await api("/api/saved");
    if (my !== savedReq) return;
    savedList = Array.isArray(d) ? d : (d.results || []);
    renderSaved(keepId);
  } catch (e) {
    if (my !== savedReq) return;
    savedList = []; renderSaved();
  }
}
function useSaved(id) {
  const s = savedList.find((x) => String(x.id) === String(id));
  if (!s) return;
  applyQuery(s.query);
  if ($("moreDlg").open) $("moreDlg").close();
  if (hasScope()) runSearch(); else showStart();
  toast("Showing “" + s.name + "”");
}
function suggestName() {
  const what = F.cats.length ? pluralWord(prettyCat(F.cats[0])) : F.inds[0] || "Businesses";
  const where = F.cities.length ? cityLabel(F.cities[0]) : F.state ? STATES[F.state] || F.state : "";
  return [what, where].filter(Boolean).join(" in ").slice(0, 80);
}
$("savedSel").addEventListener("change", updateSavedButtons);
$("savedUse").addEventListener("click", () => useSaved($("savedSel").value));
for (const id of ["savedQuick", "savedMenu"]) $(id).addEventListener("click", (e) => { const b = e.target.closest && e.target.closest("[data-saved]"); if (b) { closeMenu(); useSaved(b.dataset.saved); } });
$("savedDel").addEventListener("click", async () => {
  const id = $("savedSel").value;
  const s = savedList.find((x) => String(x.id) === id);
  if (!s) return;
  // The question opens over More filters, which stays open afterwards.
  if (!(await ask("Delete saved search?", "Delete “" + s.name + "”? Your lists aren't affected.", "Delete", true))) { $("savedSel").focus(); return; }
  try {
    await api("/api/saved/" + encodeURIComponent(id), { method: "DELETE" });
    toast("Saved search deleted");
    await loadSaved();
    $("savedSel").focus();
  } catch (e) { toast("Couldn't delete it: " + e.message, true); }
});
$("saveSearch").addEventListener("click", async () => {
  if (!hasScope()) { toast("Search first, then save it.", true); return; }
  if (savedList.length >= MAX_SAVED) { toast("You can keep up to " + MAX_SAVED + " saved searches. Delete one first (under More filters).", true); return; }
  const input = await askText("Save search", "Name", suggestName(), "Save");
  if (input == null) return;
  const name = input.trim().slice(0, 120);
  if (!name) { toast("The search needs a name.", true); return; }
  try {
    const d = await postJson("/api/saved", { name, query: fullQuery() });
    toast("Saved. Find it under Saved, next to the filters.");
    await loadSaved(d && d.id);
  } catch (e) { toast("Couldn't save the search: " + e.message, true); }
});

/* ---------- Team ---------- */
const ROLE_LABELS = { owner: "Owner", member: "Member" };
const isOwner = () => !!(me && me.user && me.user.role === "owner");
let teamReq = 0;
async function loadTeam() {
  const my = ++teamReq;
  const owner = isOwner();
  // The demo has no team to add to: say how to get one instead of showing a form that can't work.
  $("teamAddCard").hidden = !owner || DEMO;
  $("teamDemo").hidden = !DEMO;
  if (DEMO) $("teamDemo").innerHTML = "In your own account you can add the people you work with. They share its credits and lists. "
    + (BRAND.signupOpen ? '<a class="btnlink ghost" href="/app#signup">Create a free account</a>' : '<a class="btnlink ghost" href="' + ACCESS_HREF + '">Request access</a>');
  $("teamHint").textContent = owner ? "Everyone here shares the credits and lists." : "Only the account owner can add or remove people.";
  $("teamBody").innerHTML = '<tr><td colspan="5" class="empty">Loading…</td></tr>';
  try {
    const d = await api("/api/team");
    if (my !== teamReq) return;
    const rows = Array.isArray(d) ? d : (d.results || []);
    $("teamBody").innerHTML = rows.length ? rows.map((r) => "<tr>"
      + '<td class="name">' + esc(r.name || "") + (r.me ? ' <span class="pill">You</span>' : "") + "</td>"
      + '<td class="wrap">' + esc(r.email || "") + "</td>"
      + '<td data-label="Role">' + esc(ROLE_LABELS[r.role] || r.role || "") + "</td>"
      + '<td data-label="Last sign-in">' + (r.lastLoginAt ? esc(fmtDate(r.lastLoginAt)) : '<span class="muted">Never</span>') + "</td>"
      + "<td>" + (owner && !r.me ? '<button type="button" class="ghost small" data-remove="' + esc(r.id) + '" data-name="' + esc(r.name || r.email || "") + '">Remove</button>' : "") + "</td>"
      + "</tr>").join("") : '<tr><td colspan="5" class="empty">No one here yet.</td></tr>';
  } catch (e) {
    if (my !== teamReq) return;
    $("teamBody").innerHTML = '<tr><td colspan="5" class="empty"><span class="err">' + esc(e.message) + '</span><br><button type="button" class="ghost small" data-retry="team" style="margin-top:8px">Try again</button></td></tr>';
  }
}
$("teamBody").addEventListener("click", async (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.retry) { loadTeam(); return; }
  const b = t.closest && t.closest("button[data-remove]");
  if (!b || !isOwner()) return;
  const who = b.dataset.name || "this person";
  if (!(await ask("Remove " + who + "?", "Remove " + who + " from your team? They can't sign in any more. The leads and lists stay.", "Remove", true))) return;
  b.disabled = true;
  try {
    await api("/api/team/" + encodeURIComponent(b.dataset.remove), { method: "DELETE" });
    toast("Removed " + who);
    loadTeam();
  } catch (err) { b.disabled = false; toast("Couldn't remove them: " + err.message, true); }
});
$("teamForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("tmName").value.trim(), email = $("tmEmail").value.trim();
  const msg = $("teamMsg");
  if (!name || !email) { msg.textContent = "Enter their name and email."; return; }
  if (email.indexOf("@") < 1) { msg.textContent = "That email address doesn't look right."; return; }
  msg.textContent = "";
  $("teamAddBtn").disabled = true;
  try {
    const d = await postJson("/api/team", { name, email });
    $("teamForm").reset();
    loadTeam();
    await showCopy("Temporary password for " + name, d.password || "",
      "Give " + name + " (" + email + ") this password; they'll choose their own after signing in. It is shown only once.");
    $("tmName").focus();
  } catch (err) { msg.textContent = err.message; }
  finally { $("teamAddBtn").disabled = false; }
});

/* ---------- Demo: made-up businesses, all in this page (no network, no sign-in) ---------- */
// Everything the demo shows is generated here, deterministically from the category and city, so
// the same search always shows the same businesses. Names say "Sample"/"Example"/"Demo", phones
// are 555-01xx (reserved for fiction), sites and emails are on example.com.
function makeDemo() {
  // Florida only, like the real catalog: [name, state, lat, lng, area code, ZIP prefix]. Any other
  // Florida city a link or search asks for is added (cityIndex), placed around the state's centre.
  const CITIES = [
    ["Miami", 25.76, -80.19, "305", "331"], ["Tampa", 27.95, -82.46, "813", "336"], ["Orlando", 28.54, -81.38, "407", "328"], ["Jacksonville", 30.33, -81.66, "904", "322"],
    ["St. Petersburg", 27.77, -82.64, "727", "337"], ["Fort Lauderdale", 26.12, -80.14, "954", "333"], ["Hialeah", 25.86, -80.28, "305", "330"], ["Tallahassee", 30.44, -84.28, "850", "323"],
    ["Cape Coral", 26.56, -81.95, "239", "339"], ["Port St. Lucie", 27.27, -80.35, "772", "349"], ["Pembroke Pines", 26.01, -80.22, "954", "330"], ["Hollywood", 26.01, -80.15, "954", "330"],
    ["Gainesville", 29.65, -82.32, "352", "326"], ["Coral Springs", 26.27, -80.27, "954", "330"], ["Clearwater", 27.97, -82.8, "727", "337"], ["Palm Bay", 28.03, -80.59, "321", "329"],
    ["West Palm Beach", 26.72, -80.05, "561", "334"], ["Lakeland", 28.04, -81.95, "863", "338"], ["Pompano Beach", 26.24, -80.12, "954", "330"], ["Miami Gardens", 25.94, -80.25, "305", "330"],
    ["Boca Raton", 26.37, -80.13, "561", "334"], ["Sarasota", 27.34, -82.53, "941", "342"], ["Naples", 26.14, -81.79, "239", "341"], ["Fort Myers", 26.64, -81.87, "239", "339"],
    ["Kissimmee", 28.29, -81.41, "407", "347"], ["Daytona Beach", 29.21, -81.02, "386", "321"], ["Pensacola", 30.42, -87.22, "850", "325"], ["Ocala", 29.19, -82.14, "352", "344"],
    ["Melbourne", 28.08, -80.61, "321", "329"], ["Boynton Beach", 26.53, -80.07, "561", "334"], ["Bradenton", 27.5, -82.57, "941", "342"], ["Miami Beach", 25.79, -80.13, "305", "331"],
    ["Sanford", 28.8, -81.27, "407", "327"], ["Palm Coast", 29.58, -81.21, "386", "321"], ["Doral", 25.82, -80.36, "305", "331"], ["Jupiter", 26.93, -80.09, "561", "334"],
    ["Brandon", 27.94, -82.29, "813", "335"], ["Winter Park", 28.6, -81.34, "407", "327"], ["St. Cloud", 28.25, -81.28, "407", "347"], ["Land O' Lakes", 28.22, -82.46, "813", "346"],
    ["DeLand", 29.03, -81.3, "386", "327"], ["Opa-locka", 25.9, -80.25, "305", "330"], ["Dania Beach", 26.05, -80.14, "954", "330"], ["Hallandale Beach", 25.98, -80.15, "954", "330"],
  ].map((c) => [c[0], "FL", c[1], c[2], c[3], c[4]]);
  // The real category names (the catalog's links use them); any other one asked for is added (catIndex).
  const CATS = [
    ["HVAC contractor", "Home Services", "Heating & Air"], ["Plumber", "Home Services", "Plumbing"], ["Roofing contractor", "Home Services", "Roofing"],
    ["Electrician", "Home Services", "Electric"], ["Pest control service", "Home Services", "Pest Control"], ["House cleaning service", "Cleaning Services", "Cleaning"],
    ["Painter", "Home Services", "Painting"], ["Locksmith", "Home Services", "Lock & Key"], ["Moving service", "Home Services", "Moving"],
    ["Garage door supplier", "Home Services", "Garage Doors"], ["Appliance repair service", "Home Services", "Appliance Repair"],
    ["Handyman/Handywoman/Handyperson", "Home Services", "Handyman"], ["Window installation service", "Home Services", "Windows"],
    ["Water damage restoration service", "Home Services", "Restoration"], ["Interior designer", "Home Services", "Interiors"],
    ["Septic system service", "Home Services", "Septic"], ["Junk removal service", "Home Services", "Junk Removal"], ["Chimney sweep", "Home Services", "Chimney"],
  ];
  const AREA_CODES = ["305", "407", "561", "727", "813", "904", "954", "239", "321", "352", "386", "850", "863", "941"];
  /** "St. Petersburg", "saint petersburg", "St Petersburg" are the same city. */
  const placeKey = (s) => String(s || "").toLowerCase().split(".").join("").split("'").join("").replace(/^saint /, "st ").replace(/ saint /g, " st ").replace(/[^a-z0-9]+/g, " ").trim();
  /** The demo's index of "City|FL" (added when new), or -1 for other states. */
  function cityIndex(value) {
    const parts = String(value || "").split("|"), name = parts[0].trim(), state = (parts[1] || "FL").trim().toUpperCase();
    if (!name || state !== "FL") return -1;
    const k = placeKey(name);
    const i = CITIES.findIndex((c) => placeKey(c[0]) === k);
    if (i >= 0) return i;
    // Somewhere in Florida, the same place every time for the same name.
    const h = hash("city|" + k);
    CITIES.push([name, "FL", 28.1 + ((h % 200) - 100) / 140, -81.6 + (((h >>> 8) % 200) - 100) / 150, AREA_CODES[h % AREA_CODES.length], "33" + String(h % 10)]);
    return CITIES.length - 1;
  }
  /** The demo's index of a category (added, under "Other", when new). */
  function catIndex(value) {
    const name = String(value || "").trim();
    if (!name) return -1;
    const i = CATS.findIndex((k) => k[0].toLowerCase() === name.toLowerCase());
    if (i >= 0) return i;
    const stem = (name.split("/")[0].trim() || name).replace(/(^|[ -])([a-z])/g, (m, a, b) => a + b.toUpperCase());
    CATS.push([name, "Other", stem]);
    return CATS.length - 1;
  }
  const PRICE = { free: 1, google: 3 };
  const FIRST = ["Alex", "Sam", "Jordan", "Taylor", "Casey", "Riley", "Morgan", "Jamie", "Avery", "Quinn"];
  const LAST = ["Sample", "Example", "Placeholder", "Demo"];
  const PRE = ["Sample", "Example", "Demo"];
  const SUF = ["Co", "Group", "Services", "Pros"];
  const FIXES = ["Add online booking", "Make the website work on phones", "Add a contact form", "Speed up the website", "Ask happy customers for reviews", "Add ad tracking"];
  // Same plain actions as the store's suggestions ("Any category (2,828)").
  const DROP = [["q", "Any name"], ["email", "With or without email"], ["owner", "With or without owner name"], ["phone", "With or without phone"], ["website", "Any website"],
    ["min_rating", "Any rating"], ["min_reviews", "Any number of reviews"], ["max_reviews", "Any number of reviews"], ["score", "Any online presence"], ["tier", "Any lead type"],
    ["owned", "Show leads I already have"], ["postal_code", "Any ZIP code"], ["category", "Any category"], ["area", "Remove the drawn area"]];
  const STATE_NAMES = { FL: "Florida" };
  const st = { credits: 200, freePer: 50, freeUsed: 0, owned: new Map(), lists: [], saved: [], ledger: [], seq: 0 };
  const memo = new Map();
  const plural = (n, w) => Number(n).toLocaleString("en-US") + " " + w + (Number(n) === 1 ? "" : "s");
  function pluralWord(w) { if (/s$/i.test(w)) return w; if (/man$/i.test(w)) return w.slice(0, -3) + "men"; if (/[^aeiou]y$/i.test(w)) return w.slice(0, -1) + "ies"; if (/(x|z|ch|sh)$/i.test(w)) return w + "es"; return w + "s"; }
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function pairCount(ci, ki) { return 12 + (hash("n|" + CITIES[ci][0] + "|" + CATS[ki][0]) % 140); }
  function pairRows(ci, ki) {
    const key = ci + "|" + ki;
    if (memo.has(key)) return memo.get(key);
    const c = CITIES[ci], k = CATS[ki], rows = [];
    for (let i = 1; i <= pairCount(ci, ki); i++) {
      const r = rng(hash(c[0] + "|" + k[0] + "|" + i));
      const name = PRE[Math.floor(r() * PRE.length)] + " " + k[2] + " " + SUF[Math.floor(r() * SUF.length)] + " " + i;
      const slug = (name + " " + c[0]).toLowerCase().replace(/[^a-z0-9]+/g, "-");
      // Like the real Florida data: no Google ratings (Standard leads only); no website scores 0, and
      // a few websites don't load (also 0, "Site down").
      const google = false, hasWebsite = r() < 0.7, down = r() < 0.06;
      const f1 = Math.floor(r() * FIXES.length), f2 = (f1 + 1 + Math.floor(r() * (FIXES.length - 1))) % FIXES.length;
      rows.push({
        id: "demo-" + ci + "-" + ki + "-" + i, name, category: k[0], industry: k[1], city: c[0], state: c[1],
        zip: c[5] + String(10 + Math.floor(r() * 80)), tier: google ? "google" : "free",
        rating: null, reviews: null,
        score: hasWebsite && !down ? 12 + Math.floor(r() * 84) : 0,
        hasPhone: r() < 0.92, hasEmail: r() < 0.55, hasOwner: r() < 0.4, hasWebsite,
        lat: c[2] + (r() - 0.5) * 0.3, lng: c[3] + (r() - 0.5) * 0.3,
        phone: "+1" + c[4] + "55501" + String(Math.floor(r() * 100)).padStart(2, "0"),
        email: "office@" + slug + ".example.com", website: "https://" + slug + ".example.com",
        owner: FIRST[Math.floor(r() * FIRST.length)] + " " + LAST[Math.floor(r() * LAST.length)],
        address: (100 + Math.floor(r() * 8900)) + " Sample St", fixes: !hasWebsite ? ["Get a website"] : down ? ["Fix the website (it doesn't load)"] : [FIXES[f1], FIXES[f2]],
      });
    }
    memo.set(key, rows);
    return rows;
  }
  function byId(id) {
    const m = /^demo-([0-9]+)-([0-9]+)-([0-9]+)$/.exec(String(id));
    if (!m || !CITIES[Number(m[1])] || !CATS[Number(m[2])]) return null;
    return pairRows(Number(m[1]), Number(m[2]))[Number(m[3]) - 1] || null;
  }
  function nowText() { return new Date().toISOString().slice(0, 19).replace("T", " "); }
  function miles(a, b) { const y = (a[2] - b[2]) * 69, x = (a[3] - b[3]) * 69 * Math.cos((a[2] * Math.PI) / 180); return Math.sqrt(x * x + y * y); }
  function inArea(lat, lng, area) {
    const pts = String(area).split(";").map((x) => x.split(",").map(Number));
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a[1] > lng) !== (b[1] > lng) && lat < ((b[0] - a[0]) * (lng - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }
  function bucket(s) { return s < 40 ? "weak" : s < 60 ? "basic" : s < 80 ? "good" : "strong"; }
  function matches(p) {
    const cats = p.getAll("category"), inds = p.getAll("industry"), cities = p.getAll("city"), states = p.getAll("state");
    const near = p.get("near"), radius = Number(p.get("radius_miles") || 0);
    // Any Florida city and any category asked for has made-up businesses (added before filtering).
    const wantCities = cities.map(cityIndex), nearI = near ? cityIndex(near) : -1, wantCats = cats.map(catIndex);
    let ci = CITIES.map((c, i) => i);
    if (near && radius) ci = nearI >= 0 ? ci.filter((i) => miles(CITIES[nearI], CITIES[i]) <= radius) : [];
    else if (cities.length) ci = ci.filter((i) => wantCities.indexOf(i) >= 0);
    if (states.length) ci = ci.filter((i) => states.indexOf(CITIES[i][1]) >= 0);
    let ki = CATS.map((c, i) => i);
    if (cats.length) ki = ki.filter((i) => wantCats.indexOf(i) >= 0);
    if (inds.length) ki = ki.filter((i) => inds.indexOf(CATS[i][1]) >= 0);
    const zips = p.getAll("postal_code"), scores = p.getAll("score"), q = (p.get("q") || "").toLowerCase();
    const tier = p.get("tier"), web = p.get("website"), owned = p.get("owned"), area = p.get("area");
    const minRating = Number(p.get("min_rating") || 0), minRev = p.get("min_reviews"), maxRev = p.get("max_reviews");
    const out = [];
    for (const a of ci) for (const b of ki) for (const r of pairRows(a, b)) {
      if ((p.get("phone") === "yes" && !r.hasPhone) || (p.get("email") === "yes" && !r.hasEmail) || (p.get("owner") === "yes" && !r.hasOwner)) continue;
      if ((web === "yes" && !r.hasWebsite) || ((web === "no" || web === "no_real") && r.hasWebsite)) continue;
      if (scores.length && scores.indexOf(bucket(r.score)) < 0) continue;
      if ((tier === "free" || tier === "google") && r.tier !== tier) continue;
      if (minRating && !(r.rating >= minRating)) continue;
      if (minRev && !(r.reviews != null && r.reviews >= Number(minRev))) continue;
      if (maxRev && !(r.reviews != null && r.reviews <= Number(maxRev))) continue;
      if (q && r.name.toLowerCase().indexOf(q) < 0) continue;
      if (zips.length && zips.indexOf(r.zip) < 0) continue;
      if ((owned === "no" && st.owned.has(r.id)) || (owned === "yes" && !st.owned.has(r.id))) continue;
      if (area && !inArea(r.lat, r.lng, area)) continue;
      out.push(r);
    }
    return out;
  }
  function sortRows(rows, p) {
    const col = { score: "score", rating: "rating", reviews: "reviews", name: "name" }[p.get("sort")] || "best";
    const dir = p.get("dir") === "desc" ? -1 : p.get("dir") === "asc" ? 1 : col === "score" || col === "name" ? 1 : -1;
    const best = (r) => (r.hasEmail ? 4 : 0) + (r.hasOwner ? 2 : 0) + (r.hasWebsite ? 1 : 0) + (r.rating != null ? 1 : 0);
    // "Weakest online first": real low scores first, 0 (no website / site down) after them (like the store).
    const val = (r) => (col === "best" ? best(r) : col === "score" && dir === 1 && r.score === 0 ? 1000 : r[col]);
    return rows.slice().sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null && y != null) return 1;
      if (y == null && x != null) return -1;
      if (x != null && y != null && x !== y) return (x < y ? -1 : 1) * dir;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }
  // Same shape as the real API: contact details only for leads you have; else the area code only.
  function shape(r) {
    const own = st.owned.has(r.id);
    const o = { id: r.id, name: r.name, category: r.category, city: r.city, state: r.state, zip: r.zip, rating: r.rating, reviews: r.reviews, score: r.score,
      tier: r.tier, hasPhone: r.hasPhone, hasEmail: r.hasEmail, hasOwner: r.hasOwner, hasWebsite: r.hasWebsite, owned: own };
    if (own) {
      o.phone = r.hasPhone ? r.phone : null; o.phones = o.phone ? [o.phone] : [];
      o.email = r.hasEmail ? r.email : null; o.emails = o.email ? [o.email] : [];
      o.owner = r.hasOwner ? r.owner : null; o.contacts = o.owner ? [{ name: o.owner, title: "Owner" }] : [];
      o.website = r.hasWebsite ? r.website : null; o.address = r.address; o.fixes = r.fixes; o.purchasedAt = st.owned.get(r.id);
    } else o.phoneMasked = r.hasPhone ? "(" + r.phone.slice(2, 5) + ") •••-••••" : null;
    return o;
  }
  function listName(p, picked) {
    const base = searchName(p);
    if (!picked) return base;
    return base === "Businesses" ? plural(picked, "picked lead") : base + " (" + Number(picked).toLocaleString("en-US") + " picked)";
  }
  function searchName(p) {
    const cats = p.getAll("category"), cities = p.getAll("city"), states = p.getAll("state"), near = p.get("near");
    const what = cats.length ? pluralWord(cats[0].split("/")[0].trim() || cats[0]) + (cats.length > 1 ? " + " + (cats.length - 1) + " more" : "") : p.get("industry") || "Businesses";
    const where = near && p.get("radius_miles") ? "within " + p.get("radius_miles") + " mi of " + near.split("|").join(", ")
      : cities.length ? cities[0].split("|").join(", ") + (cities.length > 1 ? " + " + (cities.length - 1) + " more" : "")
      : states.length ? STATE_NAMES[states[0]] || states[0] : p.get("area") ? "Map area" : "";
    return [what, where].filter(Boolean).join(" · ");
  }
  function affordableCount(costs, freeLeft, balance) {
    let paid = 0, j = 0;
    while (j < costs.length - Math.min(freeLeft, costs.length) && paid + costs[j] <= balance) { paid += costs[j]; j++; }
    return Math.min(costs.length, Math.min(freeLeft, costs.length) + j);
  }
  function fail(msg, status) { const e = new Error(msg); e.status = status; e.body = { error: msg }; throw e; }
  function pageOf(rows, p, maxPage) {
    const size = Math.min(Math.max(Number(p.get("page_size")) || 50, 1), 50);
    const page = Math.min(Math.max(Number(p.get("page")) || 1, 1), maxPage || 1e9);
    return { page, pageSize: size, slice: rows.slice((page - 1) * size, page * size) };
  }
  function suggest(p) {
    const out = [];
    for (const d of DROP) {
      if (out.length >= 3) break;
      const v = p.get(d[0]);
      if (!v || (d[0] === "owned" && v === "all")) continue;
      const q = new URLSearchParams(p);
      q.delete(d[0]);
      if (d[0] === "owned") q.set("owned", "all");
      for (const k of ["page", "page_size", "sort", "dir"]) q.delete(k);
      const n = matches(q).length;
      if (n && !out.some((x) => x.label === d[1])) out.push({ label: d[1], query: q.toString(), n });
    }
    return out;
  }
  function me() {
    return { user: { name: "Demo", email: "demo@example.com", role: "owner", mustChangePassword: false, needsEmailConfirmation: false },
      account: { id: "demo", company: "Demo company", status: "active", credits: st.credits }, prices: PRICE,
      free: { perMonth: st.freePer, used: st.freeUsed, left: Math.max(0, st.freePer - st.freeUsed) } };
  }
  function ownedList(rows, p) {
    const q = (p.get("q") || "").toLowerCase();
    const list = rows.filter((r) => r && st.owned.has(r.id) && (!q || r.name.toLowerCase().indexOf(q) >= 0))
      .sort((a, b) => (st.owned.get(b.id) || "").localeCompare(st.owned.get(a.id) || "") || a.name.localeCompare(b.name));
    const pg = pageOf(list, p, 0);
    return { total: list.length, withEmail: list.filter((r) => r.hasEmail).length, page: pg.page, pageSize: pg.pageSize, results: pg.slice.map(shape) };
  }
  function buy(p, b) {
    let cands, capped = false;
    if (b.all === true) { const rows = sortRows(matches(p), p); capped = rows.length > 5000; cands = rows.slice(0, 5000); }
    else {
      const ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
      if (!ids.length) fail("Pick at least one lead.", 400);
      cands = ids.map(byId).filter(Boolean);
    }
    const ownedIds = cands.filter((r) => st.owned.has(r.id)).map((r) => r.id);
    let fresh = cands.filter((r) => !st.owned.has(r.id));
    const cost = (r) => (r.tier === "free" ? PRICE.free : PRICE.google);
    const freeLeft = Math.max(0, st.freePer - st.freeUsed);
    const cheapest = fresh.map((r, i) => ({ r, i })).sort((x, y) => cost(x.r) - cost(y.r) || x.i - y.i).map((x) => x.r);
    const coverable = affordableCount(cheapest.map(cost), freeLeft, st.credits);
    if (b.affordable === true) fresh = cheapest.slice(0, coverable);
    const priciest = fresh.slice().sort((x, y) => cost(y) - cost(x));
    const freeLeads = Math.min(freeLeft, priciest.length);
    const credits = priciest.slice(freeLeads).reduce((s, r) => s + cost(r), 0);
    const free = fresh.filter((r) => r.tier === "free").length;
    const name = listName(p, b.all === true ? 0 : cands.length);
    if (b.dryRun === true) return { count: fresh.length, alreadyOwned: ownedIds.length, free, google: fresh.length - free, freeLeads, credits, balance: st.credits, freeLeft, capped, coverable, name };
    if (typeof b.expectedCredits === "number" && credits > b.expectedCredits) fail("The price changed since you checked it: this now costs " + plural(credits, "credit") + ". Nothing was charged.", 409);
    if (credits > st.credits) fail("That needs " + plural(credits, "credit") + " and you have " + st.credits + ".", 402);
    const at = nowText();
    st.credits -= credits;
    st.freeUsed += freeLeads;
    for (const r of fresh) st.owned.set(r.id, at);
    if (fresh.length) st.ledger.unshift({ at, delta: -credits, balance: st.credits, kind: "purchase", note: plural(fresh.length, "lead") + (freeLeads ? " (" + (freeLeads >= fresh.length ? "" : freeLeads + " ") + "free this month)" : ""), byName: "Demo" });
    let list = null;
    if (fresh.length || (b.affordable !== true && ownedIds.length)) {
      list = { id: "demo-list-" + (++st.seq), name, query: p.toString(), createdAt: at, byName: "Demo", ids: ownedIds.concat(fresh.map((r) => r.id)) };
      st.lists.unshift(list);
    }
    return { bought: fresh.length, free, google: fresh.length - free, freeLeads, credits, balance: st.credits, at,
      listId: list ? list.id : null, listName: list ? list.name : name, listCount: list ? list.ids.length : 0 };
  }
  const listOut = (l) => ({ id: l.id, name: l.name, query: l.query, count: l.ids.length, createdAt: l.createdAt, byName: l.byName });
  function findList(id) { const l = st.lists.find((x) => x.id === id); if (!l) fail("That list wasn't found.", 404); return l; }
  function totals() {
    const byCity = CITIES.map((c, ci) => CATS.reduce((s, k, ki) => s + pairCount(ci, ki), 0));
    const byCat = CATS.map((k, ki) => CITIES.reduce((s, c, ci) => s + pairCount(ci, ki), 0));
    return { byCity, byCat };
  }
  function handle(method, path, body) {
    const u = new URL(path, "https://demo.invalid");
    const p = u.searchParams, route = u.pathname, b = body || {};
    if (route === "/api/me") return me();
    if (route === "/api/places") {
      const t = totals(), code = (p.get("state") || "").toUpperCase(), states = {};
      CITIES.forEach((c, i) => { states[c[1]] = (states[c[1]] || 0) + t.byCity[i]; });
      return { states: Object.keys(states).sort().map((k) => ({ value: k, n: states[k] })),
        cities: CITIES.map((c, i) => ({ value: c[0] + "|" + c[1], n: t.byCity[i] })).filter((c) => !code || c.value.slice(-2) === code).sort((x, y) => y.n - x.n) };
    }
    if (route === "/api/categories") {
      // Like the store: the whole database, or one place (city=City|ST or state=ST) and it says which.
      const t = totals(), inds = {};
      const city = p.get("city") || "", stc = (city.split("|")[1] || p.get("state") || "").toUpperCase();
      const cityI = city ? cityIndex(city) : -1;
      const inPlace = city || stc ? CITIES.map((c, i) => i).filter((i) => (city ? i === cityI : CITIES[i][1] === stc)) : null;
      const byCat = inPlace ? CATS.map((k, ki) => inPlace.reduce((s, ci) => s + pairCount(ci, ki), 0)) : t.byCat;
      CATS.forEach((k, i) => { if (byCat[i]) inds[k[1]] = (inds[k[1]] || 0) + byCat[i]; });
      const out = { industries: Object.keys(inds).map((k) => ({ value: k, n: inds[k] })).sort((x, y) => y.n - x.n),
        categories: CATS.map((k, i) => ({ value: k[0], industry: k[1], n: byCat[i] })).filter((c) => c.n > 0).sort((x, y) => y.n - x.n) };
      return inPlace ? Object.assign({ place: city || stc }, out) : out;
    }
    if (route === "/api/examples") {
      return [["Plumber", 0], ["Roofing contractor", 2], ["HVAC contractor", 1]].map((x) => {
        const c = CITIES[x[1]], ki = CATS.findIndex((k) => k[0] === x[0]);
        return { label: pluralWord(x[0]) + " in " + c[0], query: "category=" + encodeURIComponent(x[0]) + "&city=" + encodeURIComponent(c[0] + "|" + c[1]), n: pairCount(x[1], ki) };
      });
    }
    if (route === "/api/leads") {
      const rows = sortRows(matches(p), p), pg = pageOf(rows, p, 200), free = rows.filter((r) => r.tier === "free").length;
      const out = { total: rows.length, page: pg.page, pageSize: pg.pageSize, maxPage: 200, counts: { free, google: rows.length - free }, results: pg.slice.map(shape) };
      if (!rows.length && pg.page === 1) out.suggestions = suggest(p);
      return out;
    }
    if (route === "/api/map") {
      const rows = matches(p).sort((x, y) => x.score - y.score);
      return { points: rows.slice(0, 3000).map((r) => ({ id: r.id, name: r.name, category: r.category, lat: r.lat, lng: r.lng, score: r.score, tier: r.tier, owned: st.owned.has(r.id),
        phoneMasked: r.hasPhone ? "(" + r.phone.slice(2, 5) + ") •••-••••" : null, hasEmail: r.hasEmail, hasOwner: r.hasOwner, hasWebsite: r.hasWebsite })),
        total: rows.length > 3000 ? 3001 : rows.length, capped: rows.length > 3000 };
    }
    if (route === "/api/buy" && method === "POST") return buy(p, b);
    if (route === "/api/lists") return { lists: st.lists.map(listOut), allCount: st.owned.size };
    const lm = /^[/]api[/]lists[/]([^/]+)$/.exec(route);
    if (lm) {
      const l = findList(decodeURIComponent(lm[1]));
      if (method === "PATCH") { const n = String(b.name || "").trim().slice(0, 80); if (!n) fail("Give the list a name.", 400); l.name = n; return { ok: true, name: n }; }
      if (method === "DELETE") { st.lists = st.lists.filter((x) => x !== l); return { ok: true }; }
      return Object.assign({ list: listOut(l) }, ownedList(l.ids.map(byId), p));
    }
    if (route === "/api/my-leads") return ownedList(Array.from(st.owned.keys()).map(byId), p);
    if (route === "/api/credits") return { balance: st.credits, history: st.ledger.slice(0, 100), free: me().free };
    if (route === "/api/saved") {
      if (method === "POST" && st.saved.length >= 50) fail("You can keep up to 50 saved searches. Delete one first.", 400);
      if (method === "POST") { const s ={ id: "demo-saved-" + (++st.seq), name: String(b.name || "").slice(0, 80), query: String(b.query || ""), createdAt: nowText() }; st.saved.unshift(s); return { id: s.id }; }
      return st.saved;
    }
    const sm = /^[/]api[/]saved[/]([^/]+)$/.exec(route);
    if (sm && method === "DELETE") { st.saved = st.saved.filter((s) => s.id !== decodeURIComponent(sm[1])); return { ok: true }; }
    if (route === "/api/team" && method === "GET") return [{ id: "demo-you", name: "Demo", email: "demo@example.com", role: "owner", lastLoginAt: null, me: true }];
    if (route === "/api/logout") return { ok: true };
    const closed = typeof BRAND === "object" && BRAND && BRAND.signupOpen === false;
    fail("That isn't part of the demo. " + (closed ? "Request access to use it (on our contact page)." : "Create a free account to use it."), 400);
  }
  // The leads a demo file holds: one list, what was just got (since), or all of them.
  function ownedRows(extra) {
    const ids = extra.list ? findList(extra.list).ids : Array.from(st.owned.keys()).filter((id) => !extra.since || (st.owned.get(id) || "") >= extra.since);
    return ids.map(byId).filter((r) => r && st.owned.has(r.id));
  }
  function addCredits(n) {
    st.credits += n;
    st.ledger.unshift({ at: nowText(), delta: n, balance: st.credits, kind: "payment", note: "Pretend credits", byName: "Demo" });
  }
  return { handle, ownedRows, addCredits };
}

// A small file built in the page (at most 25 made-up rows); nothing is fetched.
function demoDownload(format, extra) {
  if (!demoEngine) demoEngine = makeDemo();
  let rows;
  try { rows = demoEngine.ownedRows(extra); } catch (e) { toast(e.message, true); return; }
  if (format === "cold_email") rows = rows.filter((r) => r.hasEmail);
  if (format === "cold_email" && !rows.length) { toast("No emails in this list, so the cold email file would be empty.", true, true); return; }
  rows = rows.slice(0, 25);
  const v = (r, k) => (k === "phone" ? (r.hasPhone ? phoneText(r.phone) : "") : k === "email" ? (r.hasEmail ? r.email : "") : k === "owner" ? (r.hasOwner ? r.owner : "")
    : k === "website" ? (r.hasWebsite ? r.website : "") : k === "first" ? (r.hasOwner ? r.owner.split(" ")[0] : "") : r[k] == null ? "" : r[k]);
  const cols = format === "cold_email"
    ? [["Email", "email"], ["First Name", "first"], ["Company Name", "name"], ["Website", "website"], ["Phone", "phone"], ["City", "city"], ["State", "state"], ["Category", "category"], ["Score", "score"]]
    : [["Business Name", "name"], ["Owner", "owner"], ["Category", "category"], ["Phone", "phone"], ["Email", "email"], ["Website", "website"], ["Address", "address"],
      ["City", "city"], ["State", "state"], ["Zip", "zip"], ["Rating", "rating"], ["Reviews", "reviews"], ["Score", "score"]];
  let text;
  if (format === "json") text = JSON.stringify(rows.map((r) => Object.fromEntries(cols.map((c) => [c[0], v(r, c[1])]))), null, 2);
  else {
    const cell = (x) => '"' + String(x).split('"').join('""') + '"';
    text = String.fromCharCode(65279) + [cols.map((c) => cell(c[0])).join(",")].concat(rows.map((r) => cols.map((c) => cell(v(r, c[1]))).join(","))).join(NL) + NL;
  }
  saveBlob(new Blob([text], { type: format === "json" ? "application/json" : "text/csv" }), "demo-sample-leads" + (format === "cold_email" ? "-cold-email" : "") + (format === "json" ? ".json" : ".csv"));
  toast("Sample file: " + plural(rows.length, "made-up row") + " (the demo gives at most 25).");
}

boot();
</script>
${THEME_SCRIPT}
</body>
</html>`;
}
