// Customer-facing Lead Store app served at "/app" by the store Worker (the public website is at "/").
// Plain HTML + JS, no build step. Contract: docs/store-api.md + docs/platform-plan.md ("App additions").
// Deep links: /app#signup, /app#find?state=FL&city=Miami%7CFL&category=Plumber&n=42 (pre-fills the
// filters; n = how many, for the sign-up card). The Find filters live in the hash (#find?...) and the
// last search is remembered per browser, so a refresh keeps them.
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
  html, body { overflow-x: hidden; }
  body { margin: 0; font: 15px/1.55 var(--sans); background: var(--bg); color: var(--text); -webkit-font-smoothing: antialiased; }
  header { position: sticky; top: 0; z-index: 30; background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: saturate(1.4) blur(10px);
    border-bottom: 1px solid var(--line); padding: 10px 24px; display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
  .brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .logoimg { height: 34px; width: auto; display: block; }
  .wordmark { font-family: var(--serif); font-weight: 700; font-size: 20px; color: var(--head); line-height: 1.05; }
  .wordmark span { display: block; font-family: var(--sans); font-size: 9px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--accent); }
  h1 { font-size: 16px; margin: 0; letter-spacing: -.01em; }
  h1, h2, h3, .big, .intro h2 { font-family: var(--serif); color: var(--head); font-weight: 600; letter-spacing: -.01em; }
  h1 .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  h1 small { display: block; font-size: 11px; font-weight: 500; color: var(--muted); letter-spacing: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  h2 { font-size: 15px; margin: 0 0 10px; }
  h3 { font-size: 15px; margin: 0 0 4px; }
  .tabs { display: flex; gap: 2px; background: var(--chip); padding: 3px; border-radius: 999px; }
  .tab { padding: 6px 16px; border: none; border-radius: 999px; cursor: pointer; color: var(--muted); background: none; font: inherit; font-weight: 500; box-shadow: none; white-space: nowrap; }
  .tab:hover { color: var(--text); filter: none; }
  .tab.active { background: var(--panel); color: var(--text); font-weight: 600; box-shadow: var(--shadow); }
  .homelink { display: flex; align-items: center; border-radius: 8px; }
  .homelink:hover { text-decoration: none; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .hdr-right { margin-left: auto; display: flex; align-items: center; gap: 8px 10px; flex-wrap: wrap; justify-content: flex-end; min-width: 0; }
  .hdr-acct { display: flex; align-items: center; gap: 8px 10px; flex-wrap: wrap; justify-content: flex-end; min-width: 0; }
  .balance { font-size: 13px; padding: 4px 11px; border-radius: 99px; background: var(--accent-soft); color: var(--accent-strong); font-weight: 600; white-space: nowrap; border: 1px solid transparent; box-shadow: none; }
  button.balance:hover { border-color: var(--accent-line); filter: none; }
  .balance.free { background: var(--ok-soft); color: var(--ok); }
  .menuwrap { position: relative; }
  .menu { position: absolute; right: 0; top: calc(100% + 6px); min-width: 230px; background: var(--panel); border: 1px solid var(--line-strong); border-radius: 12px;
    box-shadow: var(--shadow-pop); z-index: 40; padding: 6px; display: flex; flex-direction: column; }
  .menu .who { padding: 6px 10px 8px; font-size: 12px; color: var(--muted); border-bottom: 1px solid var(--line); margin-bottom: 4px; overflow-wrap: anywhere; }
  .menu button { background: none; border: none; color: var(--text); text-align: left; font-weight: 500; box-shadow: none; padding: 8px 10px; border-radius: 8px; }
  .menu button:hover, .menu button:focus-visible { background: var(--chip); filter: none; }
  main { padding: 20px 24px 48px; display: flex; flex-direction: column; gap: 16px; max-width: 1480px; margin: 0 auto; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px 18px; box-shadow: var(--shadow); min-width: 0; }
  input, select, button, textarea { font: inherit; }
  input[type=text], input[type=email], input[type=number], input[type=password], input[type=search], select { padding: 8px 12px; border: 1px solid var(--line-strong); border-radius: 10px;
    background: var(--panel); color: var(--text); max-width: 100%; }
  input:focus-visible, select:focus-visible { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  input[type=checkbox], input[type=radio] { accent-color: var(--accent); }
  button { padding: 9px 20px; border-radius: 999px; border: 1px solid var(--accent); background: var(--accent); color: var(--on-accent); cursor: pointer; font-weight: 600;
    box-shadow: var(--shadow); }
  button:hover { filter: brightness(1.06); }
  button.ghost { background: var(--panel); color: var(--text); border-color: var(--line-strong); font-weight: 500; box-shadow: none; }
  button.ghost:hover { border-color: var(--accent-line); color: var(--accent); filter: none; }
  button.link { background: none; border: none; color: var(--accent); padding: 0; box-shadow: none; font-weight: 500; text-decoration: underline; text-underline-offset: 2px; }
  button.small { padding: 5px 12px; font-size: 12px; border-radius: 999px; }
  button.danger { background: var(--bad); border-color: var(--bad); color: var(--on-accent); }
  button:disabled { opacity: .5; cursor: default; filter: none; }
  a.btnlink { display: inline-block; padding: 9px 20px; border-radius: 999px; background: var(--accent); color: var(--on-accent); font-weight: 600; text-decoration: none; }
  a.btnlink.ghost { background: var(--panel); color: var(--text); border: 1px solid var(--line-strong); font-weight: 500; }
  .muted { color: var(--muted); } .hint { font-size: 12px; color: var(--muted); }
  .err { color: var(--bad); } .okmsg { color: var(--ok); }
  a { color: var(--accent); text-decoration: none; } a:hover { text-decoration: underline; }
  .banner { border-radius: 12px; padding: 10px 14px; font-weight: 500; }
  .banner.warn { background: var(--warn-soft); color: var(--warn); } .banner.bad { background: var(--bad-soft); color: var(--bad); }
  .banner.info { background: var(--accent-soft); color: var(--text); }
  .pwwrap { display: flex; gap: 6px; align-items: center; }
  .pwwrap input { flex: 1; min-width: 0; }
  .pwtoggle { padding: 6px 12px; font-size: 12px; background: var(--panel); color: var(--text); border-color: var(--line-strong); box-shadow: none; font-weight: 500; flex: none; }

  /* Signed out */
  .auth { display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 400px)); gap: 16px; justify-content: center; padding-top: 24px; }
  .auth h2 { font-size: 22px; }
  form.stack { display: flex; flex-direction: column; gap: 10px; }
  label.field { display: flex; flex-direction: column; gap: 3px; font-size: 13px; color: var(--muted); font-weight: 500; }
  label.field input, label.field select { width: 100%; color: var(--text); }
  .intro { text-align: center; max-width: 620px; margin: 8px auto 0; }
  .intro h2 { font-size: clamp(26px, 4vw, 38px); margin-bottom: 6px; line-height: 1.15; }
  .agree { font-size: 12px; color: var(--muted); margin: 0; }

  /* Find leads */
  .findgrid { display: grid; grid-template-columns: 290px minmax(0, 1fr); gap: 16px; align-items: start; }
  details.filters { padding: 0; }
  details.filters > summary { list-style: none; cursor: pointer; padding: 12px 16px; font-weight: 700; display: flex; justify-content: space-between; align-items: center; border-radius: var(--radius); }
  details.filters > summary::-webkit-details-marker { display: none; }
  details.filters[open] > summary { border-bottom: 1px solid var(--line); border-radius: var(--radius) var(--radius) 0 0; }
  .fbody { padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 14px; }
  fieldset { border: none; margin: 0; padding: 0; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
  legend, .flabel { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); padding: 0; margin-bottom: 4px; }
  .fbody select, .fbody input[type=text], .fbody input[type=search] { width: 100%; }
  .opt { display: flex; gap: 8px; align-items: center; font-size: 13px; cursor: pointer; }
  .opt .n { margin-left: auto; color: var(--muted); font-size: 12px; }
  .checklist { max-height: 190px; overflow-y: auto; border: 1px solid var(--line); border-radius: 9px; padding: 4px 8px; background: var(--panel-2); }
  .checklist .opt { padding: 3px 0; }
  .checklist .hint { padding: 6px 0; }
  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .row2 input { width: 100%; }
  .results { padding: 0; overflow: hidden; }
  .bar { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--line); gap: 10px; flex-wrap: wrap; }
  .bar .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; padding: 8px 14px; border-bottom: 1px solid var(--line); background: var(--panel-2); font-size: 12px; }
  .chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 4px 2px 10px; border-radius: 99px; background: var(--chip); color: var(--text); font-size: 12px; font-weight: 500; }
  .chip button { background: none; border: none; box-shadow: none; color: var(--muted); padding: 0 6px; font-size: 14px; line-height: 1; border-radius: 99px; }
  .chip button:hover { color: var(--bad); filter: none; }
  .chip.sel { background: var(--accent-soft); color: var(--accent-strong); padding-right: 10px; }
  .chip.sel button { color: var(--accent); font-size: 12px; text-decoration: underline; padding: 0 0 0 4px; }
  .legend { padding: 6px 14px; font-size: 12px; color: var(--muted); border-bottom: 1px solid var(--line); }
  .legend .pill { font-size: 11px; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 99px; font-size: 12px; background: var(--chip); color: var(--muted); white-space: nowrap; }
  .pill.ok { background: var(--ok-soft); color: var(--ok); } .pill.bad { background: var(--bad-soft); color: var(--bad); } .pill.warn { background: var(--warn-soft); color: var(--warn); }
  .pill.prem { background: var(--accent-soft); color: var(--accent-strong); }
  .owned { display: inline-block; padding: 1px 8px; border-radius: 99px; font-size: 11px; font-weight: 700; background: var(--ok-soft); color: var(--ok); margin-left: 6px; }
  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--line); white-space: nowrap; vertical-align: top; }
  th { font-size: 12px; color: var(--muted); font-weight: 600; background: var(--panel-2); }
  th .sortbtn { background: none; border: none; padding: 0; color: inherit; font-weight: 600; box-shadow: none; font-size: 12px; }
  th .sortbtn:hover { color: var(--accent); filter: none; }
  th[aria-sort=ascending] .sortbtn::after { content: " ▴"; } th[aria-sort=descending] .sortbtn::after { content: " ▾"; }
  td.name { white-space: normal; min-width: 200px; font-weight: 500; }
  td.wrap { white-space: normal; min-width: 160px; }
  tr.is-owned td { background: color-mix(in srgb, var(--ok-soft) 45%, transparent); }
  .reveal { font-size: 12px; font-weight: 400; color: var(--text); margin-top: 2px; overflow-wrap: anywhere; }
  .fixes { font-size: 12px; font-weight: 400; color: var(--text); margin-top: 3px; white-space: normal; }
  .fixes b { color: var(--warn); font-weight: 600; }
  .flags { display: inline-flex; gap: 6px; }
  .flag { font-size: 14px; } .flag.off { opacity: .35; filter: grayscale(1); }
  .flag small { font-size: 11px; font-weight: 700; color: var(--muted); margin-left: 1px; }
  .locked { display: block; font-size: 11px; color: var(--muted); margin-top: 2px; }
  .facts { font-size: 12px; font-weight: 400; color: var(--muted); margin-top: 3px; white-space: normal; }
  .facts .pill { font-size: 11px; padding: 0 7px; }
  .num { text-align: right; }
  .empty { text-align: center; padding: 40px 20px !important; color: var(--muted); white-space: normal; }
  .suggest { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 12px; }
  .pager { display: flex; gap: 10px; align-items: center; justify-content: flex-end; padding: 10px 14px; flex-wrap: wrap; font-size: 13px; }
  .site { display: inline-block; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
  .findmain { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
  button.toggle-on { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
  .savedrow { display: flex; gap: 6px; align-items: center; }
  .savedrow select { flex: 1; min-width: 0; }
  .areanote { font-size: 13px; background: var(--accent-soft); border-radius: 9px; padding: 8px 10px; }
  .welcome { position: relative; }
  .welcome ol { margin: 8px 0 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
  .welcome li { display: flex; gap: 10px; align-items: flex-start; font-size: 14px; }
  .welcome .n { flex: none; display: inline-flex; width: 28px; height: 28px; border-radius: 50%; align-items: center; justify-content: center; background: var(--accent-soft); color: var(--accent-strong); font-weight: 700; }
  .welcome .x { position: absolute; top: 10px; right: 12px; }
  .mineflt { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .mineflt select { max-width: 220px; }

  /* Map (isolation keeps Leaflet's own layers, z-index 400-1000, under dialogs and the sticky header) */
  #leadMap { height: 460px; position: relative; z-index: 0; isolation: isolate; background: var(--panel-2); }
  .maplegend { display: flex; gap: 6px 14px; flex-wrap: wrap; padding: 8px 14px; font-size: 12px; color: var(--muted); border-top: 1px solid var(--line); }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 5px; vertical-align: -1px; }
  .dot.weak { background: var(--bad); } .dot.basic { background: var(--warn); } .dot.good { background: var(--ok); } .dot.none { background: var(--muted); }
  .dot.own { background: var(--panel); box-shadow: inset 0 0 0 3px var(--ok); }
  .mappop { font: 13px/1.45 var(--sans); color: var(--text); min-width: 150px; }
  .mappop button { margin-top: 6px; }

  /* Credits */
  .big { font-size: 30px; font-weight: 800; letter-spacing: -.02em; }
  .delta-pos { color: var(--ok); font-weight: 600; } .delta-neg { color: var(--bad); font-weight: 600; }
  .teamform { max-width: 520px; }

  /* Dialogs + toast */
  dialog { border: none; border-radius: 16px; padding: 0; width: min(500px, calc(100vw - 32px)); background: var(--panel); color: var(--text); box-shadow: var(--shadow-pop); }
  dialog::backdrop { background: var(--backdrop); }
  .dlg-body { padding: 20px 22px; display: flex; flex-direction: column; gap: 10px; }
  .dlg-body h2 { font-size: 18px; margin: 0; }
  .dlg-body p { margin: 0; }
  .dlg-body ul { margin: 0; padding-left: 20px; }
  .dlg-foot { display: flex; gap: 10px; justify-content: flex-end; padding: 12px 22px; border-top: 1px solid var(--line); background: var(--panel-2); flex-wrap: wrap; }
  .copyrow { display: flex; gap: 8px; align-items: center; }
  .copyrow input { flex: 1; min-width: 0; font: 600 16px/1.3 ui-monospace, Menlo, Consolas, monospace; }
  .agreebox { display: flex; gap: 8px; align-items: flex-start; font-weight: 600; font-size: 14px; background: var(--warn-soft); color: var(--warn); border-radius: 10px; padding: 8px 10px; }
  .packs { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
  .pack { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; text-align: left; background: var(--panel); color: var(--text); border: 1px solid var(--line-strong); border-radius: 14px; padding: 14px 16px; font-weight: 500; }
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

  @media (min-width: 901px) { details.filters > summary { pointer-events: none; } details.filters > summary .toggle { display: none; } }
  @media (max-width: 900px) {
    .findgrid { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 760px) {
    header { padding: 10px 12px; gap: 8px 12px; }
    .tabs { order: 3; width: 100%; overflow-x: auto; scrollbar-width: none; }
    .tab { flex: 1; padding: 8px 10px; }
    main { padding: 12px 12px 32px; gap: 12px; }
    .card { padding: 12px; border-radius: 12px; }
    .results, details.filters { padding: 0; }
    .bar { padding: 10px; }
    .bar .actions { width: 100%; }
    .bar .actions button { flex: 1 1 auto; padding: 8px 12px; }
    .auth { padding-top: 8px; grid-template-columns: minmax(0, 1fr); }
    #leadMap { height: 360px; }
    .hdr-right .balance { font-size: 12px; padding: 3px 9px; }
    /* Results and My leads as cards: no sideways scrolling */
    .table-wrap { overflow-x: visible; }
    table.cards thead { display: none; }
    table.cards, table.cards tbody, table.cards tr, table.cards td { display: block; width: 100%; }
    table.cards tr { position: relative; border-bottom: 1px solid var(--line); padding: 10px 12px 10px 44px; }
    table.cards tr.emptyrow { padding: 0; }
    table.cards td { border: none; padding: 1px 0; white-space: normal; min-width: 0; text-align: left; background: none; }
    table.cards td.selcell { position: absolute; left: 12px; top: 12px; width: auto; padding: 0; }
    table.cards td[data-label]::before { content: attr(data-label) ": "; color: var(--muted); font-size: 12px; }
    table.cards td.hide-m { display: none; }
    table.cards td.name { font-size: 15px; }
    .site { max-width: 100%; }
  }
`;

export function storeHtml(brand: StoreBrand): string {
  const rawName = String(brand?.name ?? "").trim() || "Lead Store";
  const name = esc(rawName);
  const color = safeColor(brand?.color);
  const support = esc(String(brand?.supportEmail ?? "").trim());
  const logo = safeLogo(brand?.logoUrl);
  const signup = brand?.signupOpen === false ? "0" : "1";
  const ts = /^[0-9A-Za-z_-]{1,100}$/.test(String(brand?.turnstileSiteKey ?? "")) ? String(brand.turnstileSiteKey) : "";
  const tsBox = ts ? `<div class="cf-turnstile" data-sitekey="${esc(ts)}" data-theme="auto"></div>` : "";
  const cp = typeof brand?.creditPrice === "number" && Number.isFinite(brand.creditPrice) && brand.creditPrice >= 0 ? String(brand.creditPrice) : "";
  return /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#FBF5EA">
<title>${name}</title>
${FONT_LINKS}
${THEME_BOOT}
<style>${themeCss(color)}${CSS}</style>
${ts ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ""}
</head>
<body data-brand="${name}" data-support="${support}" data-signup="${signup}" data-credit-price="${esc(cp)}" data-turnstile="${ts ? "1" : ""}">
<header>
  <div class="brand"><a class="homelink" href="/" title="Go to the website">${logo ? `<img class="logoimg" src="${esc(logo)}" alt="${name}">` : `<div class="wordmark" aria-hidden="true">${name}<span>Local leads</span></div><span class="sr-only">${name} website</span>`}</a><h1><span id="brandName" class="sr">${name}</span><small id="hdrCompany"></small></h1></div>
  <nav class="tabs" id="appNav" aria-label="Sections" hidden>
    <button type="button" class="tab" data-tab="find">Find leads</button>
    <button type="button" class="tab" data-tab="mine">My leads</button>
    <button type="button" class="tab" data-tab="credits">Credits</button>
    <button type="button" class="tab" data-tab="team">Team</button>
  </nav>
  <div class="hdr-right">
    <div class="hdr-acct" id="hdrAcct" hidden>
      <div class="menuwrap">
        <button type="button" class="balance" id="hdrCredits" aria-haspopup="true" aria-expanded="false" aria-controls="balMenu" title="Your credit balance"></button>
        <div class="menu" id="balMenu" hidden>
          <div class="who" id="balWho"></div>
          <button type="button" id="balMore">Get more credits</button>
          <button type="button" id="balHist">See credit history</button>
        </div>
      </div>
      <span class="balance free" id="hdrFree" title="Free leads left this month" hidden></span>
      <div class="menuwrap">
        <button type="button" class="ghost small" id="menuBtn" aria-haspopup="true" aria-expanded="false" aria-controls="menu">Account ▾</button>
        <div class="menu" id="menu" hidden>
          <div class="who" id="menuWho"></div>
          <button type="button" id="pwBtn">Change password</button>
          <button type="button" id="helpBtn">Help</button>
          <button type="button" id="logoutBtn">Sign out</button>
        </div>
      </div>
    </div>
    ${THEME_BUTTON}
  </div>
</header>

<main>
  <div id="bootView" class="card" role="status"><span id="bootMsg">Loading…</span></div>

  <section id="outView" hidden>
    <div class="intro"><h2>Ready-to-call local business leads</h2><p class="muted">Search thousands of businesses for free. Pay only for the leads you unlock, with phone, email, owner and website.</p></div>
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
          <p class="muted" style="margin:0">Type the email you signed up with. We'll send you a link to choose a new password.</p>
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

    <div id="view-find" class="findgrid" hidden>
      <details class="card filters" id="filterBox" open>
        <summary><span>Filters <span id="filterCount" class="pill" hidden></span></span><span class="toggle hint">Show / hide</span></summary>
        <form class="fbody" id="filterForm" onsubmit="return false">
          <fieldset id="savedBox">
            <legend>Saved searches</legend>
            <div class="savedrow">
              <select id="savedSel" class="nofilter" aria-label="Saved searches"><option value="">Loading…</option></select>
              <button type="button" class="ghost small" id="savedUse" disabled>Use</button>
              <button type="button" class="ghost small" id="savedDel" disabled aria-label="Delete the chosen saved search">Delete</button>
            </div>
            <div id="savedMsg" class="hint" role="status"></div>
          </fieldset>
          <div class="areanote" id="areaNote" hidden>Only leads inside the area drawn on the map. <button type="button" class="link" id="areaClear2">Clear area</button></div>
          <fieldset>
            <legend>Where</legend>
            <label class="field">State<select id="fState"><option value="">All states</option></select></label>
            <label class="field">Cities <span id="cityPicked" class="hint"></span><input type="search" id="citySearch" class="nofilter" placeholder="Type to find a city" aria-label="Find a city"></label>
            <div class="checklist" id="cityList" role="group" aria-label="Cities"><div class="hint">Loading…</div></div>
            <div class="hint" id="cityHint"></div>
          </fieldset>
          <fieldset>
            <legend>What</legend>
            <label class="field">Industry<select id="fIndustry"><option value="">All industries</option></select></label>
            <label class="field">Categories <span id="catPicked" class="hint"></span><input type="search" id="catSearch" class="nofilter" placeholder="Type to find a category" aria-label="Find a category"></label>
            <div class="checklist" id="catList" role="group" aria-label="Categories"><div class="hint">Loading…</div></div>
          </fieldset>
          <fieldset>
            <legend>Data type</legend>
            <label class="opt"><input type="radio" name="tier" value="" checked> Any</label>
            <label class="opt"><input type="radio" name="tier" value="free"> Standard <span class="n" id="priceFreeLbl"></span></label>
            <label class="opt"><input type="radio" name="tier" value="google"> Premium (Google) <span class="n" id="priceGoogleLbl"></span></label>
          </fieldset>
          <fieldset>
            <legend>Must have</legend>
            <label class="opt"><input type="checkbox" id="fPhone"> Has phone</label>
            <label class="opt"><input type="checkbox" id="fEmail"> Has email</label>
            <label class="opt"><input type="checkbox" id="fOwner"> Has owner name</label>
            <label class="opt"><input type="checkbox" id="fWebYes"> Has website</label>
            <label class="opt"><input type="checkbox" id="fWebNo"> No website</label>
          </fieldset>
          <fieldset>
            <legend>Google reviews</legend>
            <p class="hint" style="margin:0">Only Premium (Google) leads have Google ratings and reviews.</p>
            <label class="field">Minimum rating<select id="fRating"><option value="">Any rating</option><option value="3">3 ★ and up</option><option value="3.5">3.5 ★ and up</option><option value="4">4 ★ and up</option><option value="4.5">4.5 ★ and up</option></select></label>
            <div class="row2">
              <label class="field">Min reviews<input type="number" id="fMinRev" min="0" step="1" inputmode="numeric"></label>
              <label class="field">Max reviews<input type="number" id="fMaxRev" min="0" step="1" inputmode="numeric"></label>
            </div>
          </fieldset>
          <fieldset>
            <legend>Online score</legend>
            <label class="opt"><input type="checkbox" name="score" value="weak"> <span class="pill bad">Weak</span> under 40: the most to fix</label>
            <label class="opt"><input type="checkbox" name="score" value="basic"> <span class="pill warn">Basic</span> 40-59</label>
            <label class="opt"><input type="checkbox" name="score" value="good"> <span class="pill ok">Good</span> 60-79</label>
            <label class="opt"><input type="checkbox" name="score" value="strong"> <span class="pill ok">Strong</span> 80+</label>
          </fieldset>
          <fieldset>
            <legend>More</legend>
            <label class="field">Name contains<input type="search" id="fName" placeholder="e.g. plumbing"></label>
            <label class="opt"><input type="checkbox" id="fHideOwned"> Hide leads I already unlocked</label>
          </fieldset>
          <button type="button" class="ghost" id="clearFilters">Clear filters</button>
        </form>
      </details>

      <div class="findmain">
      <div class="card welcome" id="welcome" hidden>
        <h2 style="font-size:18px;margin:0">How it works</h2>
        <ol>
          <li><span class="n">1</span><span><strong>Pick a place and a trade.</strong> Choose a state, cities and the kind of business you sell to in the filters. <button type="button" class="link" id="welcomePick">Pick a place</button></span></li>
          <li><span class="n">2</span><span><strong>Look through the list.</strong> You see each business's name, area and online score. Contact details stay hidden until you unlock them; the icons show what we have.</span></li>
          <li><span class="n">3</span><span><strong>Unlock the ones you want.</strong> Tick them and press Unlock. <span id="welcomeFree"></span></span></li>
        </ol>
        <button type="button" class="ghost small x" id="welcomeX">Got it</button>
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
        <div id="leadMap" role="region" aria-label="Map of the matching leads"></div>
        <div class="maplegend" aria-label="Map key">
          <span><span class="dot weak"></span>Weak online score (under 40): the most to fix</span>
          <span><span class="dot basic"></span>Basic (40-59)</span>
          <span><span class="dot good"></span>Good or strong (60+)</span>
          <span><span class="dot none"></span>Not scored</span>
          <span><span class="dot own"></span>Green ring: you unlocked it</span>
        </div>
      </div>
      <div class="card results">
        <div class="bar">
          <div>
            <div id="resSummary" style="font-weight:600"></div>
            <div id="resCounts" class="hint"></div>
            <div id="resSort" class="hint"></div>
          </div>
          <div class="actions">
            <button type="button" class="ghost" id="mapBtn" aria-pressed="false" aria-controls="mapCard">Map</button>
            <button type="button" class="ghost" id="saveSearch">Save this search</button>
            <button type="button" id="buySelBtn" disabled>Unlock selected (0)</button>
            <button type="button" class="ghost" id="buyAllBtn" disabled>Unlock all matching</button>
          </div>
        </div>
        <div class="chips" id="chips" hidden></div>
        <div class="legend" id="legend">Contact info: 📞 phone · ✉ email · 👤 owner or contact · 🌐 website. Faded = we don't have it; a small number = how many. Online score: <span class="pill bad">under 40</span> the most to fix, <span class="pill warn">40-59</span>, <span class="pill ok">60+</span> doing well.</div>
        <span class="sr-only" id="srLive" aria-live="polite"></span>
        <div class="table-wrap">
          <table class="cards">
            <thead><tr>
              <th scope="col"><input type="checkbox" id="selAll" aria-label="Select all on this page"></th>
              <th scope="col" data-col="name"><button type="button" class="sortbtn" data-sort="name">Name</button></th>
              <th scope="col">Category</th>
              <th scope="col">City / State</th>
              <th scope="col" data-col="rating"><button type="button" class="sortbtn" data-sort="rating">Rating</button></th>
              <th scope="col" data-col="reviews"><button type="button" class="sortbtn" data-sort="reviews">Reviews</button></th>
              <th scope="col" data-col="score"><button type="button" class="sortbtn" data-sort="score" title="Online score: under 40 means the most to fix">Online score</button></th>
              <th scope="col">Type</th>
              <th scope="col">Contact info</th>
            </tr></thead>
            <tbody id="resBody"></tbody>
          </table>
        </div>
        <div class="pager" id="resPager"></div>
      </div>
      </div>
    </div>

    <div id="view-mine" hidden>
      <div class="card results">
        <div class="bar">
          <div class="mineflt">
            <input type="search" id="mineSearch" placeholder="Search by name" aria-label="Search my leads by name">
            <select id="mineCity" aria-label="City"><option value="">All cities</option></select>
            <select id="mineCat" aria-label="Category"><option value="">All categories</option></select>
            <span id="mineSummary" class="hint" role="status"></span>
          </div>
          <div class="actions">
            <button type="button" id="dlSimple">Download (spreadsheet)</button>
            <button type="button" class="ghost" id="dlCold">Download for cold email</button>
            <button type="button" class="ghost" id="dlJson">Download as JSON</button>
          </div>
        </div>
        <div class="bar" id="mineSelBar" hidden>
          <span id="mineSelCount"></span>
          <div class="actions">
            <button type="button" class="ghost small" id="dlSelSimple">Download selected (spreadsheet)</button>
            <button type="button" class="ghost small" id="dlSelCold">Download selected (cold email)</button>
            <button type="button" class="ghost small" id="dlSelJson">Download selected (JSON)</button>
            <button type="button" class="link small" id="mineSelClear">Clear selection</button>
          </div>
        </div>
        <div class="table-wrap">
          <table class="cards">
            <thead><tr>
              <th scope="col"><input type="checkbox" id="mineSelAll" aria-label="Select all on this page"></th>
              <th scope="col">Name</th><th scope="col">Phone</th><th scope="col">Email</th><th scope="col">Owner / contacts</th>
              <th scope="col">Website</th><th scope="col">Address</th><th scope="col">Unlocked on</th>
            </tr></thead>
            <tbody id="mineBody"></tbody>
          </table>
        </div>
        <div class="pager" id="minePager"></div>
      </div>
    </div>

    <div id="view-credits" hidden style="display:flex;flex-direction:column;gap:16px">
      <div class="card">
        <div class="hint">Your balance</div>
        <div class="big" id="crBalance"></div>
        <p id="crValue" class="muted" style="margin:0" hidden></p>
        <p id="crFree" class="okmsg" style="margin:6px 0;font-weight:600" hidden></p>
        <p id="crPrices" style="margin:6px 0"></p>
        <p style="margin:10px 0 0"><button type="button" id="crMore">Get more credits</button></p>
      </div>
      <div class="card" id="crPacksCard" hidden>
        <h2 style="margin:0 0 4px">Buy credits</h2>
        <p class="hint" style="margin:0 0 12px">Pay by card on Stripe's secure page. The credits are added as soon as the payment goes through, and never expire.</p>
        <div class="packs" id="crPacks"></div>
      </div>
      <div class="card results">
        <div class="bar"><h2 style="margin:0">History</h2><span class="hint">Last 100 changes</span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th scope="col">When</th><th scope="col">What</th><th scope="col">Who</th><th scope="col" class="num">Change</th><th scope="col" class="num">Balance after</th></tr></thead>
            <tbody id="crBody"></tbody>
          </table>
        </div>
      </div>
    </div>

    <div id="view-team" hidden style="display:flex;flex-direction:column;gap:16px">
      <div class="card results">
        <div class="bar"><h2 style="margin:0">Your team</h2><span class="hint" id="teamHint"></span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Last sign-in</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
            <tbody id="teamBody"></tbody>
          </table>
        </div>
      </div>
      <div class="card" id="teamAddCard" hidden>
        <h2>Add a person</h2>
        <p class="hint" style="margin-top:0">They get their own sign-in and share this account's credits and leads. You'll see a temporary password to give them.</p>
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

<dialog id="buyDlg" aria-labelledby="buyTitle">
  <div class="dlg-body">
    <h2 id="buyTitle">Unlock leads</h2>
    <div id="buyNote" class="banner warn" hidden></div>
    <div id="buyText"></div>
    <label class="agreebox" id="buyAgreeBox" hidden><input type="checkbox" id="buyAgree"> <span id="buyAgreeText"></span></label>
    <div id="buyErr" class="err" role="alert"></div>
  </div>
  <div class="dlg-foot">
    <button type="button" class="ghost" id="buyCancel">Cancel</button>
    <button type="button" class="ghost" id="buyMore" hidden>Get more credits</button>
    <button type="button" class="ghost" id="buyPart" hidden></button>
    <button type="button" id="buyConfirm" hidden>Unlock</button>
  </div>
</dialog>

<dialog id="doneDlg" aria-labelledby="doneTitle">
  <div class="dlg-body">
    <h2 id="doneTitle">Leads unlocked</h2>
    <p id="doneText" role="status"></p>
    <p class="hint">They're saved in My leads with the phone, email, owner, website, address and what to fix. Downloading them again is always free.</p>
  </div>
  <div class="dlg-foot">
    <button type="button" class="ghost" id="doneKeep">Keep searching</button>
    <button type="button" class="ghost" id="doneMine">See them in My leads</button>
    <button type="button" id="doneDl">Download spreadsheet</button>
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
const BIG_SPEND = 500; // above this many credits, the buyer ticks "I understand" first

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

// Browser storage is a convenience only (private windows can refuse it).
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

async function api(path, opts) {
  let res;
  try { res = await fetch(path, Object.assign({ credentials: "same-origin" }, opts || {})); }
  catch (e) { throw new Error("Can't reach the store. Check your internet connection and try again."); }
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && signedIn) { showSignedOut("Your session ended. Please sign in again."); }
  if (!res.ok) { const e = new Error(body.error || "Something went wrong (" + res.status + "). Please try again."); e.status = res.status; e.body = body; throw e; }
  return body;
}
const postJson = (path, body) => api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });

function money(n) { return Number(n).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function creditPrice() { const p = BRAND.creditPrice; return typeof p === "number" && Number.isFinite(p) && p >= 0 ? p : null; }
function aboutDollars(credits) { const p = creditPrice(); return p == null ? "" : " (about " + money(p * Number(credits || 0)) + ")"; }

// The support email as a link, or the contact page when there isn't one.
function supportHtml() {
  return BRAND.supportEmail ? '<a href="mailto:' + esc(BRAND.supportEmail) + '">' + esc(BRAND.supportEmail) + "</a>" : '<a href="/contact" target="_blank" rel="noopener">our contact page</a>';
}
function mailto(subject) { return "mailto:" + BRAND.supportEmail + "?subject=" + encodeURIComponent(subject); }
function prices() {
  const p = (me && me.prices) || BRAND.prices || {};
  return { free: p.free, google: p.google };
}
function priceText(n) { return n == null ? "" : plural(n, "credit") + " each" + aboutDollars(n); }

let toastTimer = null;
// Errors stay until dismissed (×); other messages go away by themselves.
function toast(msg, bad) {
  const t = $("toast");
  $("toastMsg").textContent = msg;
  t.className = "toast show" + (bad ? " bad" : "");
  t.setAttribute("role", bad ? "alert" : "status");
  $("toastX").hidden = !bad;
  clearTimeout(toastTimer);
  if (!bad) toastTimer = setTimeout(hideToast, 4500);
}
function hideToast() { $("toast").className = "toast"; $("toastX").hidden = true; }
$("toastX").addEventListener("click", hideToast);

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
  $("askOk").className = o.danger ? "danger" : "";
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
  return openAsk({ title, html: note ? "<p>" + esc(note) + "</p>" : "", copy: true, value, label: title, okLabel: "Done", noCancel: true });
}
/** A message with a Close button; html must already be escaped. */
function info(title, html) { return openAsk({ title, html, okLabel: "Close", noCancel: true }); }

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
  if (BRAND.cardPayments) {
    return info("Buy credits", "<p>Pay by card on Stripe's secure page. Credits are added as soon as the payment goes through, and never expire.</p>"
      + '<div class="packs">' + packsHtml() + "</div>"
      + (me ? '<p class="hint">You have ' + esc(plural(me.account.credits, "credit")) + " now.</p>" : ""));
  }
  const company = (me && me.account && me.account.company) || "";
  const cp = creditPrice();
  const p = prices();
  let html = "<p>Paying by card isn't available yet, so we add credits to your account for you. Tell us how many you'd like.</p>";
  if (cp != null) html += "<p><strong>1 credit = " + esc(money(cp)) + "</strong>" + (p.free != null ? ". A Standard lead is " + esc(plural(p.free, "credit")) + ", a Premium (Google) lead " + esc(plural(p.google, "credit")) + "." : "") + "</p>";
  html += BRAND.supportEmail
    ? '<p><a class="btnlink" href="' + esc(mailto("Credits for " + company)) + '">Email ' + esc(BRAND.supportEmail) + '</a></p><p class="hint">Or use <a href="/contact" target="_blank" rel="noopener">the contact page</a>.</p>'
    : '<p><a class="btnlink" href="/contact" target="_blank" rel="noopener">Open the contact page</a></p>';
  if (me) html += '<p class="hint">You have ' + esc(plural(me.account.credits, "credit")) + ' now. Credits never expire.</p>';
  return info("Get more credits", html);
}

function showHelp() {
  closeMenu();
  info("Help", "<ul><li><strong>Find leads:</strong> pick a place and a trade, tick the businesses you want and press Unlock.</li>"
    + "<li><strong>Contact details</strong> (phone, email, owner, website, address, what to fix) show once a lead is unlocked, in My leads and in the downloads.</li>"
    + "<li><strong>Free leads:</strong> each month some leads are free; after that a lead costs credits.</li>"
    + "<li><strong>Questions or wrong data?</strong> Contact " + supportHtml() + ".</li></ul>");
}

function forgotPassword() {
  info("Forgot your password?", "<p>We can't email a reset link yet. To get back in:</p><ul>"
    + "<li><strong>If a colleague added you</strong>, ask your account owner: on the Team tab they can remove you and add you again, which gives you a new temporary password.</li>"
    + "<li><strong>If you own the account</strong>, contact " + supportHtml() + " from the email you signed up with and we'll give you a temporary password.</li></ul>");
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
    msg.textContent = "If there's an account for " + email + ", the link is on its way. Check your inbox (and spam). It works for 60 minutes.";
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
  try { await postJson("/api/email/confirm", { token: t }); toast("Thanks, your email is confirmed. You can unlock leads now."); }
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
  const show = inp.type === "password";
  inp.type = show ? "text" : "password";
  b.textContent = show ? "Hide" : "Show";
  b.setAttribute("aria-pressed", String(show));
  b.setAttribute("aria-label", show ? "Hide password" : "Show password");
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
  document.title = BRAND.name;
  $("brandName").textContent = BRAND.name;
  const p = prices();
  $("priceFreeLbl").textContent = priceText(p.free);
  $("priceGoogleLbl").textContent = priceText(p.google);
}

async function boot() {
  show("boot");
  $("bootMsg").textContent = "Loading…";
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
  signedIn = false;
  me = null;
  pwForced = false;
  closeMenu();
  for (const id of ["buyDlg", "pwDlg", "doneDlg", "askDlg"]) { if ($(id).open) $(id).close(); }
  show("out");
  $("loginMsg").textContent = msg || "";
  $("loginMsg").className = msg && /signed out/i.test(msg) ? "okmsg" : "err";
  $("signupCard").hidden = !BRAND.signupOpen;
  $("signupClosed").hidden = BRAND.signupOpen;
  $("signupClosedMsg").innerHTML = "Sign-ups are currently closed. To ask about an account, contact " + supportHtml() + ".";
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
      if (d.confirmEmail) toast("Welcome! We sent a link to " + email + ": confirm your email, then you can unlock leads.");
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
  return "You can sign in and look around now. Unlocking leads opens once the owner of " + BRAND.name + " approves your account: sign in again later to check.";
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

/* ---------- Signed in shell ---------- */
function canBuy() { return !!me && me.account && me.account.status === "active"; }

function renderHeader() {
  if (!me) return;
  $("hdrCompany").textContent = me.account.company || "";
  $("hdrCredits").textContent = plural(me.account.credits, "credit") + " ▾";
  $("balWho").textContent = "You have " + plural(me.account.credits, "credit") + aboutDollars(me.account.credits) + ".";
  const fr = me.free;
  $("hdrFree").hidden = !fr;
  if (fr) $("hdrFree").textContent = num(fr.left) + " free lead" + (Number(fr.left) === 1 ? "" : "s") + " left";
  $("menuWho").textContent = (me.user.name ? me.user.name + " · " : "") + (me.user.email || "");
  const b = $("banner");
  const st = me.account.status;
  if (st === "pending") {
    b.hidden = false; b.className = "banner warn";
    b.textContent = "Your account is waiting for approval. " + waitingText();
  } else if (st === "suspended") {
    b.hidden = false; b.className = "banner bad";
    b.innerHTML = "Your account is paused. Contact " + supportHtml() + ".";
  } else if (me.user && me.user.needsEmailConfirmation) {
    b.hidden = false; b.className = "banner warn";
    b.innerHTML = "Please confirm your email: we sent a link to <strong>" + esc(me.user.email) + "</strong>. Unlocking leads starts once it's confirmed. "
      + '<button type="button" class="link" id="resendBtn">Send it again</button>';
    $("resendBtn").onclick = () => resendConfirm($("resendBtn"));
  } else { b.hidden = true; }
  applyBrand();
  updateBuyButtons();
  renderWelcome();
}

async function refreshMe() {
  try { me = await api("/api/me"); renderHeader(); }
  catch (e) { if (signedIn) toast("Couldn't refresh your balance: " + e.message, true); }
}

const TABS = ["find", "mine", "credits", "team"];
let pendingQuery = null;
function enterApp() {
  signedIn = true;
  show("app");
  renderHeader();
  const h = parseHash();
  if (h.tab === "find" && h.query) pendingQuery = h.query;
  else if (!h.tab || h.tab === "find") { const last = lsGet("ls.lastFind"); if (last) pendingQuery = last; }
  switchTab(TABS.indexOf(h.tab) >= 0 ? h.tab : "find");
  if (me && me.user && me.user.mustChangePassword) openPw(true);
  const paid = h.tab === "credits" ? new URLSearchParams(h.query).get("paid") : null;
  if (paid) checkPaid(paid);
}

let currentTab = "find";
function switchTab(t) {
  currentTab = t;
  closeMenu();
  for (const b of document.querySelectorAll(".tab")) {
    const on = b.dataset.tab === t;
    b.classList.toggle("active", on);
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  }
  for (const v of TABS) $("view-" + v).hidden = v !== t;
  if (t !== "find") { try { history.replaceState(null, "", "#" + t); } catch (e) { /* ignore */ } }
  if (t === "find") {
    if (pendingQuery != null) {
      // Deep link or last search: wait for the pick lists, fill in the filters, then search.
      const q = pendingQuery;
      pendingQuery = null;
      $("resSummary").textContent = "Searching…";
      setupFind().then(() => {
        applyQuery(q);
        find.page = 1;
        updateFilterCount();
        refreshFind();
      });
    } else { setupFind(); refreshFind(); }
  }
  else if (t === "mine") loadMine();
  else if (t === "team") loadTeam();
  else loadCredits();
}
for (const b of document.querySelectorAll(".tab")) b.addEventListener("click", () => switchTab(b.dataset.tab));
window.addEventListener("hashchange", () => {
  const h = parseHash();
  if (!signedIn) { if ((h.tab === "signup" || h.tab === "find") && !$("outView").hidden) showSignedOut($("loginMsg").textContent); return; }
  if (h.tab === "find" && h.query) { pendingQuery = h.query; switchTab("find"); }
  else if (TABS.indexOf(h.tab) >= 0 && h.tab !== currentTab) switchTab(h.tab);
});

const MENUS = [["menuBtn", "menu"], ["hdrCredits", "balMenu"]];
function closeMenu() { for (const m of MENUS) { $(m[1]).hidden = true; $(m[0]).setAttribute("aria-expanded", "false"); } }
for (const m of MENUS) {
  $(m[0]).addEventListener("click", (e) => {
    e.stopPropagation();
    const open = $(m[1]).hidden;
    closeMenu();
    $(m[1]).hidden = !open;
    $(m[0]).setAttribute("aria-expanded", String(open));
    if (open) { const f = $(m[1]).querySelector("button"); if (f) f.focus(); }
  });
}
document.addEventListener("click", (e) => { for (const m of MENUS) if (!$(m[1]).hidden && !$(m[1]).contains(e.target)) closeMenu(); });
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  for (const m of MENUS) if (!$(m[1]).hidden) { closeMenu(); $(m[0]).focus(); }
});
$("balMore").addEventListener("click", getMoreCredits);
$("balHist").addEventListener("click", () => switchTab("credits"));
$("helpBtn").addEventListener("click", showHelp);
$("crMore").addEventListener("click", getMoreCredits);

// After signing out, go to the public website.
async function signOut(onError) {
  closeMenu();
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

/* ---------- First-run welcome ---------- */
function renderWelcome() {
  const done = lsGet("ls.welcomeDone") === "1";
  $("welcome").hidden = done;
  if (done || !me) return;
  const fr = me.free;
  $("welcomeFree").textContent = fr && Number(fr.left) > 0
    ? "You have " + num(fr.left) + " free leads this month" + (Number(me.account.credits) > 0 ? ", then " + plural(me.account.credits, "credit") + "." : ".")
    : "You have " + plural(me.account.credits, "credit") + aboutDollars(me.account.credits) + ".";
}
$("welcomeX").addEventListener("click", () => { lsSet("ls.welcomeDone", "1"); $("welcome").hidden = true; });
$("welcomePick").addEventListener("click", () => { $("filterBox").open = true; $("fState").focus(); });

/* ---------- Pick lists (cities, categories) ---------- */
function checklist(boxId, searchId, pickedId, noMatch) {
  const box = $(boxId), search = $(searchId);
  const st = { options: [], sel: new Set(), empty: "Loading…" };
  function render() {
    const q = search.value.trim().toLowerCase();
    const list = st.options.filter((o) => !q || o.label.toLowerCase().indexOf(q) >= 0);
    list.sort((a, b) => (st.sel.has(b.value) ? 1 : 0) - (st.sel.has(a.value) ? 1 : 0));
    const shown = list.slice(0, 200);
    box.innerHTML = shown.length
      ? shown.map((o) => '<label class="opt"><input type="checkbox" value="' + esc(o.value) + '"' + (st.sel.has(o.value) ? " checked" : "") + "> <span>" + esc(o.label) + '</span><span class="n">' + num(o.n) + "</span></label>").join("")
        + (list.length > shown.length ? '<div class="hint">' + num(list.length - shown.length) + " more: type to narrow the list</div>" : "")
      : '<div class="hint">' + esc(q && st.options.length ? (noMatch ? noMatch(q) : "Nothing matches “" + q + "”") : st.empty) + "</div>";
    $(pickedId).textContent = st.sel.size ? "(" + st.sel.size + " picked)" : "";
  }
  search.addEventListener("input", render);
  box.addEventListener("change", (e) => {
    const t = e.target;
    if (!t || t.type !== "checkbox") return;
    if (t.checked) st.sel.add(t.value); else st.sel.delete(t.value);
    $(pickedId).textContent = st.sel.size ? "(" + st.sel.size + " picked)" : "";
  });
  return {
    st, render,
    set(options, emptyText) { st.options = options; st.empty = emptyText || "Nothing here"; render(); },
    clear() { st.sel.clear(); search.value = ""; render(); },
  };
}
const cities = checklist("cityList", "citySearch", "cityPicked", (q) => $("fState").value
  ? "No city matches “" + q + "” in this state."
  : "“" + q + "” isn't one of the biggest cities. Pick a state to see all its cities.");
const cats = checklist("catList", "catSearch", "catPicked");
const cityOpts = (list) => (list || []).map((c) => ({ value: String(c.value), label: String(c.value).split("|").join(", "), n: c.n }));
let allCategories = [];
function updateCityHint() { $("cityHint").textContent = $("fState").value ? "" : "Showing the biggest cities. Pick a state to see all of them."; }

function renderCategories() {
  const ind = $("fIndustry").value;
  const list = allCategories.filter((c) => !ind || c.industry === ind);
  if (ind) { const ok = new Set(list.map((c) => c.value)); for (const v of Array.from(cats.st.sel)) if (!ok.has(v)) cats.st.sel.delete(v); }
  cats.set(list.map((c) => ({ value: String(c.value), label: String(c.value), n: c.n })), "No categories");
}

async function loadCities() {
  const st = $("fState").value;
  updateCityHint();
  if (st) for (const v of Array.from(cities.st.sel)) if (v.split("|")[1] !== st) cities.st.sel.delete(v);
  cities.set([], "Loading cities…");
  try {
    const d = await api("/api/places" + (st ? "?state=" + encodeURIComponent(st) : ""));
    if ($("fState").value !== st) return;
    cities.set(cityOpts(d.cities), "No cities found");
  } catch (e) {
    if ($("fState").value === st) cities.set([], "Couldn't load cities: " + e.message);
  }
}

let findSetupP = null;
function setupFind() {
  if (findSetupP) return findSetupP;
  if (window.matchMedia && window.matchMedia("(max-width: 900px)").matches) $("filterBox").open = false;
  let failed = false;
  const placesP = api("/api/places").then((d) => {
    const st = $("fState").value;
    $("fState").innerHTML = '<option value="">All states</option>' + (d.states || []).map((s) => '<option value="' + esc(s.value) + '">' + esc(s.value) + " (" + num(s.n) + ")</option>").join("");
    if (st) setSelect("fState", st);
    updateCityHint();
    if (!st) cities.set(cityOpts(d.cities), "No cities found"); else loadCities();
  }).catch((e) => { cities.set([], "Couldn't load places: " + e.message); failed = true; });
  const catsP = api("/api/categories").then((d) => {
    const ind = $("fIndustry").value;
    $("fIndustry").innerHTML = '<option value="">All industries</option>' + (d.industries || []).map((s) => '<option value="' + esc(s.value) + '">' + esc(s.value) + " (" + num(s.n) + ")</option>").join("");
    if (ind) setSelect("fIndustry", ind);
    allCategories = d.categories || [];
    renderCategories();
  }).catch((e) => { cats.set([], "Couldn't load categories: " + e.message); failed = true; });
  loadSaved();
  findSetupP = Promise.all([placesP, catsP]).then(() => { if (failed) findSetupP = null; });
  return findSetupP;
}
// Pick a value in a select, adding it as an option when the list doesn't have it (yet).
function setSelect(id, v) {
  const sel = $(id);
  v = String(v || "");
  if (v && !Array.from(sel.options).some((o) => o.value === v)) sel.add(new Option(v, v));
  sel.value = v;
}
window.addEventListener("resize", () => { if (window.matchMedia && !window.matchMedia("(max-width: 900px)").matches) $("filterBox").open = true; });

/* ---------- Filters ---------- */
function wholeNumber(v) { const s = String(v).trim(); if (!s) return null; const n = Number(s); return Number.isFinite(n) && n >= 0 ? String(Math.floor(n)) : null; }
function filterQuery() {
  const p = new URLSearchParams();
  const st = $("fState").value; if (st) p.append("state", st);
  for (const c of cities.st.sel) p.append("city", c);
  const ind = $("fIndustry").value; if (ind) p.append("industry", ind);
  for (const c of cats.st.sel) p.append("category", c);
  const tier = document.querySelector('input[name="tier"]:checked'); if (tier && tier.value) p.set("tier", tier.value);
  if ($("fPhone").checked) p.set("phone", "yes");
  if ($("fEmail").checked) p.set("email", "yes");
  if ($("fOwner").checked) p.set("owner", "yes");
  if ($("fWebYes").checked) p.set("website", "yes"); else if ($("fWebNo").checked) p.set("website", "no_real");
  if ($("fRating").value) p.set("min_rating", $("fRating").value);
  const minR = wholeNumber($("fMinRev").value); if (minR != null) p.set("min_reviews", minR);
  const maxR = wholeNumber($("fMaxRev").value); if (maxR != null) p.set("max_reviews", maxR);
  for (const b of document.querySelectorAll('input[name="score"]:checked')) p.append("score", b.value);
  const q = $("fName").value.trim(); if (q) p.set("q", q);
  if ($("fHideOwned").checked) p.set("owned", "no");
  if (find.area) p.set("area", find.area);
  if (find.near) { p.set("near", find.near); p.set("radius_miles", String(find.radius || 25)); }
  return p.toString();
}
const sortQuery = () => "sort=" + find.sort + "&dir=" + find.dir;
// Filters + sort, as kept in the address (#find?...), saved searches and "Unlock all matching".
function fullQuery() { const q = filterQuery(); return (q ? q + "&" : "") + sortQuery(); }
function updateFilterCount() {
  const n = Array.from(new URLSearchParams(filterQuery()).keys()).filter((k) => k !== "radius_miles").length;
  $("filterCount").hidden = !n;
  $("filterCount").textContent = n + " on";
  $("areaNote").hidden = !find.area;
  $("mapClear").hidden = !find.area;
  renderChips();
}

// Only "lat,lng;lat,lng;..." with 3 to 40 valid points is used as a map area.
function cleanArea(v) {
  const pts = String(v || "").split(";").map((x) => x.split(",").map(Number))
    .filter((x) => x.length === 2 && Number.isFinite(x[0]) && Number.isFinite(x[1]) && Math.abs(x[0]) <= 90 && Math.abs(x[1]) <= 180);
  return pts.length >= 3 ? pts.slice(0, 40).map((x) => x[0].toFixed(5) + "," + x[1].toFixed(5)).join(";") : "";
}

// Fill the filter controls (and the sort) from a query string (saved searches, deep links, suggestions).
function applyQuery(qs) {
  const p = new URLSearchParams(qs || "");
  $("filterForm").reset();
  cities.st.sel.clear(); cats.st.sel.clear();
  $("citySearch").value = ""; $("catSearch").value = "";
  setSelect("fState", p.get("state") || "");
  setSelect("fIndustry", p.get("industry") || "");
  for (const c of p.getAll("city")) if (c) cities.st.sel.add(c);
  for (const c of p.getAll("category")) if (c) cats.st.sel.add(c);
  const tier = p.get("tier") || "";
  for (const r of document.querySelectorAll('input[name="tier"]')) r.checked = r.value === tier;
  if (!document.querySelector('input[name="tier"]:checked')) document.querySelector('input[name="tier"]').checked = true;
  $("fPhone").checked = p.get("phone") === "yes";
  $("fEmail").checked = p.get("email") === "yes";
  $("fOwner").checked = p.get("owner") === "yes";
  const web = p.get("website") || "";
  $("fWebYes").checked = web === "yes";
  $("fWebNo").checked = web === "no" || web === "no_real";
  const rating = p.get("min_rating") || "";
  if (rating && !Array.from($("fRating").options).some((o) => o.value === rating)) $("fRating").add(new Option(rating + " ★ and up", rating));
  $("fRating").value = rating;
  $("fMinRev").value = wholeNumber(p.get("min_reviews") || "") || "";
  $("fMaxRev").value = wholeNumber(p.get("max_reviews") || "") || "";
  const scores = p.getAll("score");
  for (const b of document.querySelectorAll('input[name="score"]')) b.checked = scores.indexOf(b.value) >= 0;
  $("fName").value = p.get("q") || "";
  $("fHideOwned").checked = p.get("owned") === "no";
  find.area = cleanArea(p.get("area"));
  find.near = p.get("near") && p.get("radius_miles") ? String(p.get("near")).slice(0, 80) : "";
  find.radius = find.near ? Math.min(Math.max(Number(p.get("radius_miles")) || 25, 1), 200) : 0;
  const sort = p.get("sort");
  if (sort && DEFAULT_DIR[sort]) { find.sort = sort; find.dir = p.get("dir") === "desc" ? "desc" : p.get("dir") === "asc" ? "asc" : DEFAULT_DIR[sort]; }
  renderCategories();
  loadCities();
}

function refreshFind() {
  loadLeads();
  if (map.on) loadMap();
}

let filterTimer = null;
function filtersChanged() {
  clearTimeout(filterTimer);
  updateFilterCount();
  filterTimer = setTimeout(() => { find.page = 1; refreshFind(); }, 350);
}
$("filterForm").addEventListener("change", (e) => {
  const t = e.target;
  if (t.classList && t.classList.contains("nofilter")) return;
  if (t.id === "fWebYes" && t.checked) $("fWebNo").checked = false;
  if (t.id === "fWebNo" && t.checked) $("fWebYes").checked = false;
  if (t.id === "fState") loadCities();
  if (t.id === "fIndustry") renderCategories();
  filtersChanged();
});
$("filterForm").addEventListener("input", (e) => {
  const id = e.target && e.target.id;
  if (id === "fName" || id === "fMinRev" || id === "fMaxRev") filtersChanged();
});
$("clearFilters").addEventListener("click", () => {
  const hadState = !!$("fState").value, hadInd = !!$("fIndustry").value;
  $("filterForm").reset();
  find.area = ""; find.near = ""; find.radius = 0;
  cities.clear(); cats.clear();
  if (hadState) loadCities();
  if (hadInd) renderCategories();
  filtersChanged();
});

// The filters that are on, as chips with a remove button (also shown when nothing matches).
const SCORE_WORDS = { weak: "Weak score (under 40)", basic: "Basic score (40-59)", good: "Good score (60-79)", strong: "Strong score (80+)" };
function activeFilters() {
  const out = [];
  const add = (key, value, label) => out.push({ key, value, label });
  if ($("fState").value) add("state", "", "State: " + $("fState").value);
  for (const c of cities.st.sel) add("city", c, c.split("|").join(", "));
  if ($("fIndustry").value) add("industry", "", $("fIndustry").value);
  for (const c of cats.st.sel) add("category", c, c);
  const tier = document.querySelector('input[name="tier"]:checked');
  if (tier && tier.value) add("tier", "", tier.value === "google" ? "Premium (Google) only" : "Standard only");
  if ($("fPhone").checked) add("phone", "", "Has phone");
  if ($("fEmail").checked) add("email", "", "Has email");
  if ($("fOwner").checked) add("owner", "", "Has owner name");
  if ($("fWebYes").checked) add("website", "", "Has website");
  if ($("fWebNo").checked) add("website", "", "No website");
  if ($("fRating").value) add("min_rating", "", $("fRating").value + " ★ and up");
  if (wholeNumber($("fMinRev").value) != null) add("min_reviews", "", "At least " + wholeNumber($("fMinRev").value) + " reviews");
  if (wholeNumber($("fMaxRev").value) != null) add("max_reviews", "", "At most " + wholeNumber($("fMaxRev").value) + " reviews");
  for (const b of document.querySelectorAll('input[name="score"]:checked')) add("score", b.value, SCORE_WORDS[b.value] || b.value);
  if ($("fName").value.trim()) add("q", "", "Name contains “" + $("fName").value.trim() + "”");
  if ($("fHideOwned").checked) add("owned", "", "Hiding leads I unlocked");
  if (find.area) add("area", "", "Area drawn on the map");
  if (find.near) add("near", "", "Within " + find.radius + " miles of " + find.near.split("|").join(", "));
  return out;
}
function removeFilter(key, value) {
  if (key === "state") { $("fState").value = ""; loadCities(); }
  else if (key === "city") { cities.st.sel.delete(value); cities.render(); }
  else if (key === "industry") { $("fIndustry").value = ""; renderCategories(); }
  else if (key === "category") { cats.st.sel.delete(value); cats.render(); }
  else if (key === "tier") document.querySelector('input[name="tier"]').checked = true;
  else if (key === "phone") $("fPhone").checked = false;
  else if (key === "email") $("fEmail").checked = false;
  else if (key === "owner") $("fOwner").checked = false;
  else if (key === "website") { $("fWebYes").checked = false; $("fWebNo").checked = false; }
  else if (key === "min_rating") $("fRating").value = "";
  else if (key === "min_reviews") $("fMinRev").value = "";
  else if (key === "max_reviews") $("fMaxRev").value = "";
  else if (key === "score") { for (const b of document.querySelectorAll('input[name="score"]')) if (b.value === value) b.checked = false; }
  else if (key === "q") $("fName").value = "";
  else if (key === "owned") $("fHideOwned").checked = false;
  else if (key === "area") find.area = "";
  else if (key === "near") { find.near = ""; find.radius = 0; }
  filtersChanged();
}
function renderChips() {
  const list = activeFilters();
  const sel = find.selected.size;
  const html = list.map((f, i) => '<span class="chip">' + esc(f.label) + '<button type="button" data-chip="' + i + '" aria-label="Remove filter: ' + esc(f.label) + '">×</button></span>').join("")
    + (list.length > 1 ? '<button type="button" class="link small" id="chipsClear">Clear all filters</button>' : "")
    + (sel ? '<span class="chip sel">' + esc(num(sel)) + ' selected ·<button type="button" data-clearsel="1">Clear</button></span>' : "");
  $("chips").innerHTML = html;
  $("chips").hidden = !html;
  $("chips").dataset.list = JSON.stringify(list.map((f) => [f.key, f.value]));
}
$("chips").addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("button");
  if (!b) return;
  if (b.id === "chipsClear") { $("clearFilters").click(); return; }
  if (b.dataset.clearsel) { clearSelection(); return; }
  if (b.dataset.chip != null) {
    const list = JSON.parse($("chips").dataset.list || "[]");
    const f = list[Number(b.dataset.chip)];
    if (f) removeFilter(f[0], f[1]);
  }
});

/* ---------- Results ---------- */
const find = { page: 1, sort: "score", dir: "asc", total: 0, maxPage: 200, counts: {}, rows: [], selected: new Set(), req: 0, loaded: false, area: "", near: "", radius: 0, suggestions: [] };
const DEFAULT_DIR = { name: "asc", score: "asc", rating: "desc", reviews: "desc" };
const SORT_WORDS = { name: ["Name, A to Z", "Name, Z to A"], score: ["Online score, lowest first (the most to fix)", "Online score, highest first"],
  rating: ["Rating, lowest first", "Rating, highest first"], reviews: ["Fewest reviews first", "Most reviews first"] };

// Online score colours, the same everywhere: under 40 weak (red), 40-59 amber, 60+ green, none grey.
function scoreClass(s) { if (s == null || s === "") return "none"; const n = Number(s); return n < 40 ? "bad" : n < 60 ? "warn" : "ok"; }
function scorePill(s) {
  if (s == null) return '<span class="muted" title="Not scored yet">–</span>';
  const n = Number(s);
  const word = n >= 80 ? "Strong" : n >= 60 ? "Good" : n >= 40 ? "Basic" : "Weak: the most to fix";
  return '<span class="pill ' + scoreClass(n) + '" title="' + esc(word) + '">' + esc(n) + "</span>";
}
// How many of each the business has (the details themselves unlock when bought).
const COUNTS = [["contactsCount", "hasOwner", "👤", "contact", "contacts"], ["phonesCount", "hasPhone", "📞", "phone", "phones"], ["emailsCount", "hasEmail", "✉", "email", "emails"]];
function factsLine(r) {
  const bits = [];
  if (r.employees) bits.push(esc(r.employees) + " employees");
  if (r.revenue) bits.push(esc(r.revenue) + " revenue");
  if (r.foundedYear) bits.push("since " + esc(r.foundedYear));
  const pills = (r.labels || []).map((t) => '<span class="pill ' + (t.indexOf("Above") === 0 ? "ok" : "warn") + '">' + esc(t) + "</span>").join(" ");
  if (!bits.length && !pills) return "";
  const src = r.sizeSource ? ' title="Size: ' + esc(r.sizeSource) + '"' : "";
  return '<div class="facts"' + src + ">" + bits.join(" · ") + (pills ? (bits.length ? " " : "") + pills : "") + "</div>";
}
function fixesLine(r) {
  const f = (r.fixes || []).filter(Boolean);
  return f.length ? '<div class="fixes"><b>What to fix:</b> ' + f.map(esc).join("; ") + "</div>" : "";
}
const telHref = (p) => "tel:" + String(p).replace(/[^0-9+]/g, "");
/** "+18135550101" -> "(813) 555-0101"; other countries stay as they are. */
const phoneText = (p) => { const d = String(p || "").replace(/[^0-9]/g, ""); return d.length === 11 && d[0] === "1" ? "(" + d.slice(1, 4) + ") " + d.slice(4, 7) + "-" + d.slice(7) : String(p || ""); };
function flagsHtml(r) {
  return COUNTS.map((f) => {
    const n = Number(r[f[0]] != null ? r[f[0]] : (r[f[1]] ? 1 : 0));
    const label = n ? n + " " + (n === 1 ? f[3] : f[4]) : "No " + f[3];
    return '<span class="flag' + (n ? "" : " off") + '" role="img" aria-label="' + label + '" title="' + label + '">' + f[2] + (n > 1 ? "<small>" + n + "</small>" : "") + "</span>";
  }).join("") + '<span class="flag' + (r.hasWebsite ? "" : " off") + '" role="img" aria-label="' + (r.hasWebsite ? "Has a website" : "No website") + '" title="' + (r.hasWebsite ? "Has a website" : "No website") + '">🌐</span>';
}
function leadRow(r) {
  let reveal = "";
  if (r.owned) {
    const bits = [];
    const phones = (r.phones && r.phones.length ? r.phones : (r.phone ? [r.phone] : []));
    phones.forEach((p) => bits.push('📞 <a href="' + esc(telHref(p)) + '">' + esc(phoneText(p)) + "</a>"));
    (r.emails && r.emails.length ? r.emails : (r.email ? [r.email] : [])).forEach((e) => bits.push('✉ <a href="mailto:' + esc(e) + '">' + esc(e) + "</a>"));
    const people = (r.contacts && r.contacts.length ? r.contacts : (r.owner ? [{ name: r.owner, title: r.ownerTitle }] : []));
    people.forEach((p) => bits.push("👤 " + esc(p.name) + (p.title ? ' <span class="hint">' + esc(p.title) + "</span>" : "")));
    if (isWebLink(r.website)) bits.push('🌐 <a href="' + esc(r.website) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(String(r.website).replace(/^https?:[/][/](www[.])?/i, "")) + "</a>");
    if (bits.length) reveal = '<div class="reveal">' + bits.join(" · ") + "</div>";
    reveal += fixesLine(r);
  }
  const place = [r.city, r.state].filter(Boolean).join(", ");
  return '<tr class="' + (r.owned ? "is-owned" : "") + '">'
    + '<td class="selcell">' + (r.owned
      ? '<input type="checkbox" disabled aria-label="You already unlocked ' + esc(r.name) + '" title="You already unlocked this lead">'
      : '<input type="checkbox" class="rowsel" data-id="' + esc(r.id) + '"' + (find.selected.has(String(r.id)) ? " checked" : "") + ' aria-label="Select ' + esc(r.name) + '">') + "</td>"
    + '<td class="name">' + esc(r.name) + (r.owned ? '<span class="owned">Unlocked</span>' : "") + factsLine(r) + reveal + "</td>"
    + '<td class="wrap" data-label="Category">' + esc(r.category || "") + "</td>"
    + '<td data-label="Where">' + esc(place) + (r.zip ? ' <span class="hint">' + esc(r.zip) + "</span>" : "") + "</td>"
    + '<td class="num hide-m">' + (r.rating != null ? esc(Number(r.rating).toFixed(1)) + " ★" : '<span class="muted">–</span>') + "</td>"
    + '<td class="num hide-m">' + (r.reviews != null ? num(r.reviews) : '<span class="muted">–</span>') + "</td>"
    + '<td data-label="Online score">' + scorePill(r.score) + "</td>"
    + '<td class="hide-m">' + (r.tier === "google" ? '<span class="pill prem">Premium (Google)</span>' : '<span class="pill">Standard</span>') + "</td>"
    + '<td data-label="Contact info"><span class="flags">' + flagsHtml(r) + "</span>" + (r.owned ? "" : '<span class="locked">Locked: unlock to see</span>') + "</td>"
    + "</tr>";
}

function pagerHtml(total, page, size, maxPage) {
  const all = Math.max(1, Math.ceil(total / size));
  const pages = maxPage ? Math.min(all, maxPage) : all;
  if (total <= size) return "";
  return '<button type="button" class="ghost small" data-page="' + (page - 1) + '"' + (page <= 1 ? " disabled" : "") + ">‹ Previous</button>"
    + "<span>Page " + num(page) + " of " + num(pages) + "</span>"
    + '<button type="button" class="ghost small" data-page="' + (page + 1) + '"' + (page >= pages ? " disabled" : "") + ">Next ›</button>"
    + (all > pages ? '<span class="hint">Showing the first ' + num(pages * size) + ". Narrow your filters to see more.</span>" : "");
}

function renderSortHeaders() {
  for (const th of document.querySelectorAll("#view-find th[data-col]")) {
    if (th.dataset.col === find.sort) th.setAttribute("aria-sort", find.dir === "asc" ? "ascending" : "descending");
    else th.removeAttribute("aria-sort");
  }
  const w = SORT_WORDS[find.sort];
  $("resSort").textContent = w ? "Sorted by: " + w[find.dir === "asc" ? 0 : 1] + ". Click a column name to change." : "";
}

function updateBuyButtons() {
  const n = find.selected.size;
  const ok = canBuy();
  $("buySelBtn").textContent = "Unlock selected (" + num(n) + ")";
  $("buySelBtn").disabled = !ok || n === 0;
  $("buyAllBtn").textContent = !find.total ? "Unlock all matching"
    : find.total > MAX_BUY ? "Unlock the first " + num(MAX_BUY) + " (of " + num(find.total) + ")" : "Unlock all " + num(find.total) + " matching";
  $("buyAllBtn").disabled = !ok || !find.loaded || find.total === 0;
  const why = !me ? "" : me.account.status === "pending" ? "Unlocking opens once your account is approved" : me.account.status === "suspended" ? "Your account is paused" : "";
  $("buySelBtn").title = why; $("buyAllBtn").title = why;
}

function updateSelAll() {
  const boxes = Array.from(document.querySelectorAll("#resBody .rowsel"));
  const all = $("selAll");
  all.disabled = boxes.length === 0;
  const on = boxes.filter((b) => b.checked).length;
  all.checked = boxes.length > 0 && on === boxes.length;
  all.indeterminate = on > 0 && on < boxes.length;
}
function selectionChanged() { updateSelAll(); updateBuyButtons(); renderChips(); }
function clearSelection() {
  find.selected.clear();
  for (const b of document.querySelectorAll("#resBody .rowsel")) b.checked = false;
  selectionChanged();
}

// Keep the search in the address (so refresh keeps it) and remember it in this browser.
function rememberSearch() {
  const q = fullQuery();
  try { if (currentTab === "find") history.replaceState(null, "", "#find?" + q); } catch (e) { /* ignore */ }
  lsSet("ls.lastFind", q);
}

function zeroHtml() {
  const s = find.suggestions || [];
  return '<tr class="emptyrow"><td colspan="9" class="empty"><strong>No leads match these filters.</strong><br>'
    + (s.length ? "Try one of these:" : "Try removing a filter (the chips above) or picking a wider area.")
    + (s.length ? '<div class="suggest">' + s.map((x, i) => '<button type="button" class="ghost small" data-suggest="' + i + '">' + esc(x.label) + (x.n != null ? " (" + esc(plural(x.n, "lead")) + ")" : "") + "</button>").join("") + "</div>" : "")
    + "</td></tr>";
}

async function loadLeads() {
  const my = ++find.req;
  find.loaded = false;
  renderSortHeaders();
  $("resBody").innerHTML = '<tr class="emptyrow"><td colspan="9" class="empty">Loading…</td></tr>';
  $("resSummary").textContent = "Searching…";
  $("resCounts").textContent = "";
  $("resPager").innerHTML = "";
  updateBuyButtons();
  rememberSearch();
  try {
    const q = filterQuery();
    const d = await api("/api/leads?" + (q ? q + "&" : "") + "page=" + find.page + "&page_size=" + PAGE_SIZE + "&" + sortQuery());
    if (my !== find.req) return;
    find.total = Number(d.total || 0);
    find.maxPage = Number(d.maxPage || 200);
    find.counts = d.counts || {};
    find.rows = d.results || [];
    find.suggestions = d.suggestions || [];
    find.loaded = true;
    const summary = find.total === 1 ? "1 lead matches" : num(find.total) + " leads match";
    $("resSummary").textContent = summary;
    $("srLive").textContent = summary;
    const p = prices();
    $("resCounts").textContent = num(find.counts.free) + " Standard" + (p.free != null ? " (" + plural(p.free, "credit") + " each)" : "")
      + " · " + num(find.counts.google) + " Premium (Google)" + (p.google != null ? " (" + plural(p.google, "credit") + " each)" : "");
    $("resBody").innerHTML = find.rows.length ? find.rows.map(leadRow).join("") : zeroHtml();
    $("resPager").innerHTML = pagerHtml(find.total, find.page, PAGE_SIZE, find.maxPage);
  } catch (e) {
    if (my !== find.req) return;
    find.total = 0;
    $("resSummary").textContent = "";
    $("resBody").innerHTML = '<tr class="emptyrow"><td colspan="9" class="empty"><span class="err">' + esc(e.message) + '</span><br><button type="button" class="ghost small" data-retry="leads" style="margin-top:8px">Try again</button></td></tr>';
  }
  selectionChanged();
}

$("resBody").addEventListener("change", (e) => {
  const t = e.target;
  if (!t.classList.contains("rowsel")) return;
  if (t.checked) find.selected.add(t.dataset.id); else find.selected.delete(t.dataset.id);
  selectionChanged();
});
$("resBody").addEventListener("click", (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.retry) { loadLeads(); return; }
  const b = t.closest && t.closest("button[data-suggest]");
  if (b) {
    const s = find.suggestions[Number(b.dataset.suggest)];
    if (!s) return;
    const keep = sortQuery();
    applyQuery(s.query + "&" + keep);
    find.page = 1;
    updateFilterCount();
    refreshFind();
  }
});
$("selAll").addEventListener("change", () => {
  const on = $("selAll").checked;
  for (const b of document.querySelectorAll("#resBody .rowsel")) {
    b.checked = on;
    if (on) find.selected.add(b.dataset.id); else find.selected.delete(b.dataset.id);
  }
  selectionChanged();
});
$("resPager").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-page]");
  if (!b || b.disabled) return;
  find.page = Math.min(Math.max(Number(b.dataset.page), 1), find.maxPage || 200);
  loadLeads();
  $("view-find").scrollIntoView({ block: "start" });
});
for (const b of document.querySelectorAll("#view-find .sortbtn")) {
  b.addEventListener("click", () => {
    const s = b.dataset.sort;
    if (find.sort === s) find.dir = find.dir === "asc" ? "desc" : "asc";
    else { find.sort = s; find.dir = DEFAULT_DIR[s] || "asc"; }
    find.page = 1;
    loadLeads();
  });
}

/* ---------- Unlocking ---------- */
let pendingBuy = null;
function buyJob(all, affordable) {
  const q = all ? fullQuery() : "";
  const body = all ? { all: true } : { ids: Array.from(find.selected) };
  if (affordable) body.affordable = true;
  return { all, affordable: !!affordable, path: "/api/buy" + (q ? "?" + q : ""), body, quote: null };
}
function startBuy(all) { if (canBuy()) openBuy(buyJob(all, false)); }

// Which of the paid leads are Standard / Premium: the free allowance covers the priciest first.
function paidSplit(d) {
  const p = prices();
  const std = Number(d.free || 0), prem = Number(d.google || 0), freeLeads = Number(d.freeLeads || 0);
  const premFirst = Number(p.google) >= Number(p.free);
  const coverPrem = premFirst ? Math.min(freeLeads, prem) : Math.max(0, freeLeads - std);
  const coverStd = freeLeads - coverPrem;
  const paidStd = std - coverStd, paidPrem = prem - coverPrem;
  const ok = paidStd >= 0 && paidPrem >= 0 && paidStd * Number(p.free) + paidPrem * Number(p.google) === Number(d.credits || 0);
  return { ok, paidStd, paidPrem, p };
}

async function openBuy(job, note) {
  pendingBuy = job;
  job.quote = null;
  $("buyTitle").textContent = job.affordable ? "Unlock what your free leads and credits cover" : job.all ? "Unlock all matching leads" : "Unlock the selected leads";
  $("buyNote").hidden = !note; $("buyNote").textContent = note || "";
  $("buyText").innerHTML = '<p class="muted">Working out the price…</p>';
  $("buyErr").innerHTML = "";
  for (const id of ["buyConfirm", "buyMore", "buyPart", "buyAgreeBox"]) $(id).hidden = true;
  $("buyAgree").checked = false;
  $("buyConfirm").disabled = false;
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
    $("buyText").innerHTML = "";
    $("buyErr").textContent = e.message;
    $("buyMore").hidden = e.status !== 402;
    $("buyCancel").textContent = "Close";
  }
}

function renderQuote(job, d) {
  const count = Number(d.count || 0), credits = Number(d.credits || 0), balance = Number(d.balance || 0), freeLeads = Number(d.freeLeads || 0);
  const owned = Number(d.alreadyOwned || 0);
  if (count === 0) {
    $("buyText").innerHTML = "<p>" + (job.affordable ? "Your free leads and credits don't cover any of these yet."
      : "You already unlocked " + (owned === 1 ? "this lead" : "all of these leads") + ". Nothing to pay.") + "</p>";
    $("buyCancel").textContent = "Close";
    if (job.affordable) $("buyMore").hidden = false;
    return;
  }
  const s = paidSplit(d);
  const parts = [];
  if (freeLeads) parts.push(num(freeLeads) + " use your free leads");
  let sentence;
  if (s.ok) {
    if (s.paidStd) parts.push(num(s.paidStd) + " Standard × " + plural(s.p.free, "credit"));
    if (s.paidPrem) parts.push(num(s.paidPrem) + " Premium (Google) × " + plural(s.p.google, "credit"));
    sentence = plural(count, "lead") + ": " + parts.join(", ") + (credits > 0 ? " = " + plural(credits, "credit") + aboutDollars(credits) : "") + ".";
  } else {
    sentence = plural(count, "lead") + ": " + (parts.length ? parts[0] + ", " : "") + plural(credits, "credit") + " to pay" + aboutDollars(credits) + ".";
  }
  const short = credits > balance;
  sentence += short ? " You have " + plural(balance, "credit") + "." : " Balance after: " + plural(balance - credits, "credit") + aboutDollars(balance - credits) + ".";
  let html = "<p><strong>" + esc(sentence) + "</strong></p>"
    + "<p>For each lead you get the phone, email, owner, website, address and what to fix (when we have them).</p>";
  if (owned) html += '<p class="hint">' + esc(plural(owned, "lead")) + " you already unlocked " + (owned === 1 ? "is" : "are") + " skipped (no charge).</p>";
  if (d.capped) html += '<p class="hint">You can unlock up to ' + num(MAX_BUY) + " leads at a time: these are the first " + num(MAX_BUY) + " in the order shown. Unlock again afterwards for the rest.</p>";
  $("buyText").innerHTML = html;
  if (short) {
    $("buyErr").textContent = "You need " + plural(credits - balance, "more credit") + " to unlock all of these.";
    $("buyMore").hidden = false;
    const cover = Number(d.coverable || 0);
    if (cover > 0 && !job.affordable) {
      const what = Number(d.freeLeft || 0) > 0 && balance > 0 ? "your free leads and credits cover" : Number(d.freeLeft || 0) > 0 ? "your free leads cover" : "your credits cover";
      $("buyPart").hidden = false;
      $("buyPart").textContent = "Unlock the " + num(cover) + " " + what;
    }
    return;
  }
  $("buyConfirm").hidden = false;
  $("buyConfirm").textContent = "Unlock " + plural(count, "lead") + (credits > 0 ? " for " + plural(credits, "credit") : " free");
  if (credits > BIG_SPEND) {
    $("buyAgreeBox").hidden = false;
    $("buyAgreeText").textContent = "I understand this spends " + plural(credits, "credit") + aboutDollars(credits) + ".";
    $("buyConfirm").disabled = true;
  }
}
$("buyAgree").addEventListener("change", () => { $("buyConfirm").disabled = !$("buyAgree").checked; });
$("buySelBtn").addEventListener("click", () => startBuy(false));
$("buyAllBtn").addEventListener("click", () => startBuy(true));
$("buyCancel").addEventListener("click", () => $("buyDlg").close());
$("buyMore").addEventListener("click", getMoreCredits);
$("buyPart").addEventListener("click", () => { if (pendingBuy) openBuy(buyJob(pendingBuy.all, true)); });
$("buyDlg").addEventListener("close", () => { pendingBuy = null; });
$("buyConfirm").addEventListener("click", async () => {
  const job = pendingBuy;
  if (!job || !job.quote) return;
  $("buyConfirm").disabled = true;
  $("buyConfirm").textContent = "Unlocking…";
  $("buyErr").innerHTML = "";
  try {
    // expectedCredits: the server refuses (409) rather than charge more than shown here.
    const d = await postJson(job.path, Object.assign({ expectedCredits: Number(job.quote.credits || 0) }, job.body));
    if ($("buyDlg").open) $("buyDlg").close();
    if (me && d.balance != null) { me.account.credits = d.balance; renderHeader(); }
    clearSelection();
    mine.facets = false; // new cities / categories for the My leads filters
    refreshMe();
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
  const bits = [];
  if (Number(d.freeLeads) > 0) bits.push(num(d.freeLeads) + " free");
  if (Number(d.credits) > 0) bits.push(plural(d.credits, "credit") + " spent");
  $("doneTitle").textContent = Number(d.bought) ? "Unlocked " + plural(d.bought, "lead") : "Nothing new to unlock";
  $("doneText").textContent = (bits.length ? bits.join(", ") + ". " : "") + "Your balance: " + plural(d.balance, "credit") + ".";
  $("doneDl").hidden = !Number(d.bought);
  $("doneDlg").showModal();
  (Number(d.bought) ? $("doneDl") : $("doneKeep")).focus();
}
$("doneKeep").addEventListener("click", () => $("doneDlg").close());
$("doneMine").addEventListener("click", () => { $("doneDlg").close(); switchTab("mine"); });
$("doneDl").addEventListener("click", () => {
  const extra = lastBuy && lastBuy.at ? { since: lastBuy.at } : {};
  download("simple", null, $("doneDl"), extra);
});

/* ---------- My leads ---------- */
const mine = { page: 1, total: 0, withEmail: 0, selected: new Set(), emailOf: new Map(), req: 0, facets: false };
function mineParams() {
  const p = new URLSearchParams();
  const q = $("mineSearch").value.trim(); if (q) p.set("q", q);
  if ($("mineCity").value) p.set("city", $("mineCity").value);
  if ($("mineCat").value) p.set("category", $("mineCat").value);
  return p;
}
const dash = '<span class="muted">–</span>';
function mineRow(r) {
  const site = isWebLink(r.website) ? '<a class="site" href="' + esc(r.website) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(String(r.website).replace(/^https?:[/][/](www[.])?/i, "")) + "</a>" : (r.website ? esc(r.website) : dash);
  const people = r.contacts && r.contacts.length ? r.contacts : (r.owner ? [{ name: r.owner, title: r.ownerTitle }] : []);
  const owner = people.length ? people.map((p) => esc(p.name) + (p.title ? ' <span class="hint">' + esc(p.title) + "</span>" : "")).join("<br>") : dash;
  const phones = r.phones && r.phones.length ? r.phones : (r.phone ? [r.phone] : []);
  const phone = phones.length ? phones.map((p) => '<a href="' + esc(telHref(p)) + '">' + esc(phoneText(p)) + "</a>").join("<br>") : dash;
  const emails = r.emails && r.emails.length ? r.emails : (r.email ? [r.email] : []);
  const email = emails.length ? emails.map((e) => '<a href="mailto:' + esc(e) + '">' + esc(e) + "</a>").join("<br>") : dash;
  const where = [r.address, [r.city, r.state].filter(Boolean).join(", "), r.zip].filter(Boolean).join(", ");
  return "<tr>"
    + '<td class="selcell"><input type="checkbox" class="minesel" data-id="' + esc(r.id) + '"' + (mine.selected.has(String(r.id)) ? " checked" : "") + ' aria-label="Select ' + esc(r.name) + '"></td>'
    + '<td class="name">' + esc(r.name) + (r.tier === "google" ? ' <span class="pill prem">Premium (Google)</span>' : "")
    + '<div class="hint">' + esc([r.category, [r.city, r.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")) + " · Online score " + scorePill(r.score) + "</div>" + fixesLine(r) + "</td>"
    + '<td data-label="Phone">' + phone + '</td><td data-label="Email">' + email + '</td><td data-label="Owner">' + owner + '</td><td data-label="Website">' + site + "</td>"
    + '<td class="wrap" data-label="Address">' + (where ? esc(where) : dash) + '</td><td data-label="Unlocked on">' + esc(fmtDate(r.purchasedAt, true)) + "</td></tr>";
}
function selectedWithEmail() { let n = 0; for (const id of mine.selected) if (mine.emailOf.get(id)) n++; return n; }
function updateMineSel() {
  const n = mine.selected.size;
  $("mineSelBar").hidden = n === 0;
  $("mineSelCount").textContent = plural(n, "lead") + " selected";
  $("dlSelCold").textContent = "Download selected (cold email: " + num(selectedWithEmail()) + " with email)";
  $("dlSelCold").disabled = selectedWithEmail() === 0;
  const boxes = Array.from(document.querySelectorAll("#mineBody .minesel"));
  const on = boxes.filter((b) => b.checked).length;
  $("mineSelAll").disabled = boxes.length === 0;
  $("mineSelAll").checked = boxes.length > 0 && on === boxes.length;
  $("mineSelAll").indeterminate = on > 0 && on < boxes.length;
}
function fillSelect(id, list, allLabel, label) {
  const sel = $(id), keep = sel.value;
  sel.innerHTML = '<option value="">' + esc(allLabel) + "</option>" + (list || []).map((x) => '<option value="' + esc(x.value) + '">' + esc(label(x.value)) + " (" + num(x.n) + ")</option>").join("");
  if (keep) setSelect(id, keep);
}
async function loadMine() {
  const my = ++mine.req;
  $("mineBody").innerHTML = '<tr class="emptyrow"><td colspan="8" class="empty">Loading…</td></tr>';
  $("minePager").innerHTML = "";
  $("mineSummary").textContent = "";
  const p = mineParams();
  const filtered = Array.from(p.keys()).length > 0;
  try {
    const d = await api("/api/my-leads?page=" + mine.page + "&page_size=" + PAGE_SIZE + (mine.facets ? "" : "&facets=1") + (filtered ? "&" + p.toString() : ""));
    if (my !== mine.req) return;
    if (d.facets) {
      mine.facets = true;
      fillSelect("mineCity", d.facets.cities, "All cities", (v) => String(v).split("|").join(", "));
      fillSelect("mineCat", d.facets.categories, "All categories", (v) => String(v));
    }
    mine.total = Number(d.total || 0);
    mine.withEmail = Number(d.withEmail || 0);
    const rows = d.results || [];
    for (const r of rows) mine.emailOf.set(String(r.id), !!((r.emails && r.emails.length) || r.email));
    $("mineSummary").textContent = (mine.total === 1 ? "1 lead" : num(mine.total) + " leads") + (filtered ? " match" : "");
    $("mineBody").innerHTML = rows.length ? rows.map(mineRow).join("")
      : '<tr class="emptyrow"><td colspan="8" class="empty">' + (filtered ? "None of your leads match these filters." : "<strong>You haven't unlocked any leads yet.</strong><br>Go to Find leads, tick the ones you want and press Unlock.") + "</td></tr>";
    $("minePager").innerHTML = pagerHtml(mine.total, mine.page, PAGE_SIZE, 0);
    const what = filtered ? "these " + num(mine.total) : "all " + num(mine.total);
    $("dlSimple").textContent = "Download " + what + " (spreadsheet)";
    $("dlCold").textContent = "Download for cold email (" + num(mine.withEmail) + " of " + num(mine.total) + " have an email)";
    $("dlJson").textContent = "Download " + what + " as JSON";
    $("dlSimple").disabled = $("dlJson").disabled = mine.total === 0;
    $("dlCold").disabled = mine.withEmail === 0;
  } catch (e) {
    if (my !== mine.req) return;
    $("mineBody").innerHTML = '<tr class="emptyrow"><td colspan="8" class="empty"><span class="err">' + esc(e.message) + '</span><br><button type="button" class="ghost small" data-retry="mine" style="margin-top:8px">Try again</button></td></tr>';
  }
  updateMineSel();
}
let mineTimer = null;
$("mineSearch").addEventListener("input", () => { clearTimeout(mineTimer); mineTimer = setTimeout(() => { mine.page = 1; loadMine(); }, 350); });
for (const id of ["mineCity", "mineCat"]) $(id).addEventListener("change", () => { mine.page = 1; loadMine(); });
$("mineBody").addEventListener("change", (e) => {
  const t = e.target;
  if (!t.classList.contains("minesel")) return;
  if (t.checked) mine.selected.add(t.dataset.id); else mine.selected.delete(t.dataset.id);
  updateMineSel();
});
$("mineBody").addEventListener("click", (e) => { if (e.target.dataset && e.target.dataset.retry) loadMine(); });
$("mineSelAll").addEventListener("change", () => {
  const on = $("mineSelAll").checked;
  for (const b of document.querySelectorAll("#mineBody .minesel")) { b.checked = on; if (on) mine.selected.add(b.dataset.id); else mine.selected.delete(b.dataset.id); }
  updateMineSel();
});
$("mineSelClear").addEventListener("click", () => { mine.selected.clear(); for (const b of document.querySelectorAll("#mineBody .minesel")) b.checked = false; updateMineSel(); });
$("minePager").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-page]");
  if (!b || b.disabled) return;
  mine.page = Number(b.dataset.page);
  loadMine();
});
// Fetch the file first so a failure shows a message instead of a broken download.
// ids = these leads; else the My leads filters (or extra, e.g. { since } after unlocking).
async function download(format, ids, btn, extra) {
  const p = ids && ids.length ? new URLSearchParams() : (extra ? new URLSearchParams() : mineParams());
  p.set("format", format);
  if (ids && ids.length) p.set("ids", ids.join(","));
  if (extra) for (const k of Object.keys(extra)) p.set(k, extra[k]);
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
    const name = m ? m[1] : "leads." + (format === "json" ? "json" : "csv");
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href; a.download = name; a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 20000);
    toast("Your download is ready" + (format === "cold_email" ? " (only leads with an email are in this file)" : ""));
  } catch (e) {
    toast("Couldn't download: " + e.message, true);
  } finally { if (btn) btn.disabled = false; }
}
for (const [id, format, sel] of [["dlSimple", "simple", false], ["dlCold", "cold_email", false], ["dlJson", "json", false],
  ["dlSelSimple", "simple", true], ["dlSelCold", "cold_email", true], ["dlSelJson", "json", true]]) {
  $(id).addEventListener("click", () => download(format, sel ? Array.from(mine.selected) : null, $(id)));
}

/* ---------- Credits ---------- */
const KIND_LABELS = { grant: "Credits added", purchase: "Leads unlocked", refund: "Refund", adjust: "Adjustment", payment: "Credits bought" };
function renderFreeAllowance() {
  const fr = me && me.free;
  $("crFree").hidden = !fr;
  if (fr) $("crFree").textContent = num(fr.perMonth) + " free leads every month, " + num(fr.used) + " used this month ("
    + num(fr.left) + " left). After that, leads cost credits. The allowance starts again on the 1st of each month.";
}
async function loadCredits() {
  const p = prices();
  const cp = creditPrice();
  const showBalance = () => {
    $("crBalance").textContent = me ? plural(me.account.credits, "credit") : "";
    $("crValue").hidden = cp == null || !me;
    if (cp != null && me) $("crValue").textContent = "Worth about " + money(cp * Number(me.account.credits || 0)) + " (1 credit = " + money(cp) + ")";
  };
  showBalance();
  renderFreeAllowance();
  $("crPacksCard").hidden = !BRAND.cardPayments;
  if (BRAND.cardPayments) $("crPacks").innerHTML = packsHtml();
  $("crMore").hidden = BRAND.cardPayments;
  $("crPrices").textContent = p.free != null && p.google != null
    ? "Standard lead = " + plural(p.free, "credit") + aboutDollars(p.free) + ", Premium (Google) lead = " + plural(p.google, "credit") + aboutDollars(p.google) + ". Leads you already unlocked are free to download again."
    : "";
  $("crBody").innerHTML = '<tr><td colspan="5" class="empty">Loading…</td></tr>';
  try {
    const d = await api("/api/credits");
    if (me && d.balance != null) { me.account.credits = d.balance; renderHeader(); showBalance(); }
    const rows = d.history || [];
    $("crBody").innerHTML = rows.length ? rows.map((h) => {
      const delta = Number(h.delta || 0);
      return "<tr><td>" + esc(fmtDate(h.at)) + '</td><td class="wrap">' + esc(KIND_LABELS[h.kind] || h.kind || "") + (h.note ? ' <span class="hint">' + esc(h.note) + "</span>" : "") + "</td>"
        + "<td>" + (h.byName ? "by " + esc(h.byName) : '<span class="muted">–</span>') + "</td>"
        + '<td class="num ' + (delta >= 0 ? "delta-pos" : "delta-neg") + '">' + (delta > 0 ? "+" : "") + num(delta) + "</td>"
        + '<td class="num">' + num(h.balance) + "</td></tr>";
    }).join("") : '<tr><td colspan="5" class="empty">No credit changes yet.</td></tr>';
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
  // e.g. "color(srgb ...)" from color-mix(): paint one pixel to get plain rgb().
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return "rgb(" + d[0] + ", " + d[1] + ", " + d[2] + ")";
  } catch (e) { return c; }
}
function mapColors() {
  return { bad: themeColor("--bad"), warn: themeColor("--warn"), ok: themeColor("--ok"), none: themeColor("--muted"),
    head: themeColor("--head"), accent: themeColor("--accent"), panel: themeColor("--panel") };
}
function dotColor(v, c) { const k = scoreClass(v); return k === "none" ? c.none : c[k]; }
function popupHtml(p) {
  const sel = find.selected.has(String(p.id));
  return '<div class="mappop"><strong>' + esc(p.name) + "</strong>"
    + '<div class="hint">Online score: ' + esc(p.score == null ? "–" : p.score) + " · " + (p.tier === "google" ? "Premium (Google)" : "Standard") + "</div>"
    + (p.owned ? '<span class="owned" style="margin-left:0">You unlocked this lead</span>'
      : '<button type="button" class="small" data-mapsel="' + esc(p.id) + '"' + (sel ? " disabled" : "") + ">" + (sel ? "Selected" : "Select") + "</button>")
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
    L.circleMarker(ll, { radius: 6, color: p.owned ? c.ok : c.panel, weight: p.owned ? 3 : 1, fillColor: dotColor(p.score, c), fillOpacity: .85, bubblingMouseEvents: false })
      .bindPopup(() => popupHtml(p))
      .addTo(map.layer);
    pts.push(ll);
  }
  if (map.areaShape) { map.areaShape.remove(); map.areaShape = null; }
  if (find.area) map.areaShape = L.polygon(areaPoints(find.area), { color: c.head, weight: 2, fillOpacity: .05, interactive: false }).addTo(map.lmap);
  return pts;
}

async function loadMap() {
  const my = ++map.req;
  const info = $("mapInfo");
  info.textContent = "Loading the map…";
  try {
    await loadLeaflet();
    if (my !== map.req || !map.on) return;
    if (!map.lmap) {
      map.lmap = L.map("leadMap", { preferCanvas: true }).setView([39.5, -98.35], 4);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(map.lmap);
      map.lmap.on("click", (e) => { if (!map.drawing || map.pts.length >= 40) return; map.pts.push([e.latlng.lat, e.latlng.lng]); drawShape(); });
    }
    setTimeout(() => { if (map.lmap) map.lmap.invalidateSize(); }, 30);
    const q = filterQuery();
    const d = await api("/api/map" + (q ? "?" + q : ""));
    if (my !== map.req || !map.on) return;
    map.points = d.points || [];
    const pts = drawPoints();
    // Only move the view when the search changed (not after unlocking or reloading the same search).
    if (map.fitKey !== q) {
      map.fitKey = q;
      if (map.areaShape) map.lmap.fitBounds(map.areaShape.getBounds(), { padding: [20, 20] });
      else if (pts.length) map.lmap.fitBounds(pts, { padding: [20, 20], maxZoom: 14 });
    }
    const total = Number(d.total || 0);
    info.textContent = (pts.length === total ? plural(pts.length, "lead") + " on the map" : num(pts.length) + " of " + num(total) + " matching leads on the map")
      + (d.capped ? " (the most we show at once: narrow the filters to see the rest)" : "")
      + (map.drawing ? ". Click the map to add corners (3 or more), then press Use this area." : "");
  } catch (e) {
    if (my !== map.req) return;
    info.innerHTML = '<span class="err">' + esc(e.message) + '</span> <button type="button" class="ghost small" id="mapRetry">Try again</button>';
    $("mapRetry").onclick = () => loadMap();
  }
}
function drawShape() {
  if (!map.lmap) return;
  if (map.drawLine) { map.drawLine.remove(); map.drawLine = null; }
  if (map.pts.length) map.drawLine = L.polygon(map.pts, { color: mapColors().accent, weight: 2, fillOpacity: .08, dashArray: "4 4", interactive: false }).addTo(map.lmap);
  $("mapUse").hidden = map.pts.length < 3;
  if (map.drawing) $("mapInfo").textContent = map.pts.length >= 40 ? "That's the most corners (40). Press Use this area."
    : plural(map.pts.length, "corner") + " so far. Click the map to add corners (3 or more), then press Use this area.";
}
// Light / dark switch: redraw the dots and shapes in the new colours.
document.addEventListener("themechange", () => { if (map.lmap) { drawPoints(); drawShape(); } });
function stopDrawing() {
  map.drawing = false; map.pts = []; drawShape();
  $("mapDraw").textContent = "Draw an area";
  $("mapDraw").setAttribute("aria-pressed", "false");
  $("mapUse").hidden = true;
}
function setArea(a) {
  find.area = a;
  find.page = 1;
  updateFilterCount();
  refreshFind();
}
$("mapBtn").addEventListener("click", () => {
  map.on = !map.on;
  $("mapCard").hidden = !map.on;
  $("mapBtn").setAttribute("aria-pressed", String(map.on));
  $("mapBtn").classList.toggle("toggle-on", map.on);
  if (map.on) { loadMap(); $("mapCard").scrollIntoView({ block: "start" }); }
  else { map.req++; stopDrawing(); }
});
$("mapDraw").addEventListener("click", () => {
  if (map.drawing) { stopDrawing(); loadMap(); return; }
  if (!map.lmap) { toast("Wait for the map to load, then draw."); return; }
  map.drawing = true; map.pts = []; drawShape();
  $("mapDraw").textContent = "Cancel drawing";
  $("mapDraw").setAttribute("aria-pressed", "true");
});
$("mapUse").addEventListener("click", () => {
  const a = cleanArea(map.pts.map((x) => x[0] + "," + x[1]).join(";"));
  stopDrawing();
  if (a) setArea(a);
});
$("mapClear").addEventListener("click", () => setArea(""));
$("areaClear2").addEventListener("click", () => setArea(""));
$("leadMap").addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("[data-mapsel]");
  if (!b) return;
  const id = String(b.dataset.mapsel);
  find.selected.add(id);
  b.textContent = "Selected"; b.disabled = true;
  for (const box of document.querySelectorAll("#resBody .rowsel")) if (box.dataset.id === id) box.checked = true;
  selectionChanged();
  toast("Added to your selection (" + num(find.selected.size) + ")");
});

/* ---------- Saved searches ---------- */
let savedList = [];
function renderSaved(keepId) {
  const sel = $("savedSel");
  sel.innerHTML = savedList.length
    ? '<option value="">Pick a saved search</option>' + savedList.map((s) => '<option value="' + esc(s.id) + '">' + esc(s.name) + "</option>").join("")
    : '<option value="">No saved searches yet</option>';
  if (keepId != null && savedList.some((s) => String(s.id) === String(keepId))) sel.value = String(keepId);
  sel.disabled = !savedList.length;
  updateSavedButtons();
}
function updateSavedButtons() { const on = !!$("savedSel").value; $("savedUse").disabled = !on; $("savedDel").disabled = !on; }
async function loadSaved(keepId) {
  $("savedMsg").textContent = "";
  try {
    const d = await api("/api/saved");
    savedList = Array.isArray(d) ? d : (d.results || []);
    renderSaved(keepId);
  } catch (e) {
    savedList = []; renderSaved();
    $("savedMsg").innerHTML = '<span class="err">' + esc("Couldn't load saved searches: " + e.message) + '</span> <button type="button" class="link small" id="savedRetry">Try again</button>';
    $("savedRetry").onclick = () => loadSaved();
  }
}
function suggestName() {
  const cat = Array.from(cats.st.sel)[0] || $("fIndustry").value;
  const city = Array.from(cities.st.sel)[0];
  const where = city ? city.split("|").join(", ") : $("fState").value;
  return [cat, where].filter(Boolean).join(" in ").slice(0, 80) || "My search";
}
$("savedSel").addEventListener("change", updateSavedButtons);
$("savedUse").addEventListener("click", () => {
  const id = $("savedSel").value;
  const s = savedList.find((x) => String(x.id) === id);
  if (!s) return;
  applyQuery(s.query);
  $("savedSel").value = id; updateSavedButtons();
  find.page = 1;
  updateFilterCount();
  refreshFind();
  toast("Showing “" + s.name + "”");
});
$("savedDel").addEventListener("click", async () => {
  const id = $("savedSel").value;
  const s = savedList.find((x) => String(x.id) === id);
  if (!s || !(await ask("Delete saved search?", "Delete the saved search “" + s.name + "”? Your leads aren't affected.", "Delete", true))) return;
  $("savedDel").disabled = true;
  try {
    await api("/api/saved/" + encodeURIComponent(id), { method: "DELETE" });
    toast("Saved search deleted");
    await loadSaved();
  } catch (e) { toast("Couldn't delete it: " + e.message, true); updateSavedButtons(); }
});
$("saveSearch").addEventListener("click", async () => {
  if (!filterQuery()) { toast("Pick at least one filter first, then save the search.", true); return; }
  const input = await askText("Save this search", "Name", suggestName(), "Save");
  if (input == null) return;
  const name = input.trim().slice(0, 120);
  if (!name) { toast("The search needs a name.", true); return; }
  $("saveSearch").disabled = true;
  try {
    const d = await postJson("/api/saved", { name, query: fullQuery() });
    toast("Search saved. Find it under Saved searches in the filters.");
    await loadSaved(d && d.id);
  } catch (e) { toast("Couldn't save the search: " + e.message, true); }
  finally { $("saveSearch").disabled = false; }
});

/* ---------- Team ---------- */
const ROLE_LABELS = { owner: "Owner", member: "Member" };
const isOwner = () => !!(me && me.user && me.user.role === "owner");
let teamReq = 0;
async function loadTeam() {
  const my = ++teamReq;
  const owner = isOwner();
  $("teamAddCard").hidden = !owner;
  $("teamHint").textContent = owner ? "Everyone here shares the account's credits and leads." : "Only the account owner can add or remove people.";
  $("teamBody").innerHTML = '<tr><td colspan="5" class="empty">Loading…</td></tr>';
  try {
    const d = await api("/api/team");
    if (my !== teamReq) return;
    const rows = Array.isArray(d) ? d : (d.results || []);
    $("teamBody").innerHTML = rows.length ? rows.map((r) => "<tr>"
      + '<td class="name">' + esc(r.name || "") + (r.me ? ' <span class="pill">You</span>' : "") + "</td>"
      + "<td>" + esc(r.email || "") + "</td>"
      + "<td>" + esc(ROLE_LABELS[r.role] || r.role || "") + "</td>"
      + "<td>" + (r.lastLoginAt ? esc(fmtDate(r.lastLoginAt)) : '<span class="muted">Never</span>') + "</td>"
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
  if (!(await ask("Remove " + who + "?", "Remove " + who + " from your team? They won't be able to sign in any more. The leads they unlocked stay in your account.", "Remove", true))) return;
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

boot();
</script>
${THEME_SCRIPT}
</body>
</html>`;
}
