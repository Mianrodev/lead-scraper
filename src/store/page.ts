// Customer-facing Lead Store page served at "/" by the store Worker. Plain HTML + JS, no build step.
// Contract: docs/store-api.md. The page script lives inside this template literal, so it must not
// contain backslashes, backticks or dollar-brace sequences; brand values are only interpolated into
// the HTML/CSS below (escaped), and the script reads them back from data attributes.

export interface StoreBrand {
  name: string;
  color: string;
  supportEmail: string;
}

const DEFAULT_COLOR = "#4f46e5";

function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Only plain hex colors (#abc or #aabbcc) reach the CSS; anything else falls back to the default. */
export function safeColor(c: unknown): string {
  return typeof c === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c.trim()) ? c.trim() : DEFAULT_COLOR;
}

export function storeHtml(brand: StoreBrand): string {
  const rawName = String(brand?.name ?? "").trim() || "Lead Store";
  const name = esc(rawName);
  const color = safeColor(brand?.color);
  const support = esc(String(brand?.supportEmail ?? "").trim());
  const initial = esc(rawName.charAt(0).toUpperCase() || "L");
  return /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name}</title>
<style>
  :root {
    color-scheme: light;
    --bg: #f4f5f9; --panel: #ffffff; --panel-2: #f9fafc; --chip: #f1f3f8; --text: #0f172a; --muted: #64748b; --line: #e6e9f0; --line-strong: #d3d8e2;
    --accent: ${color}; --on-accent: #ffffff;
    --ok: #047857; --ok-soft: #e9f9f1; --warn: #b45309; --warn-soft: #fff6e5; --bad: #be123c; --bad-soft: #fff0f3;
    --shadow: 0 1px 2px rgba(15, 23, 42, .04), 0 2px 8px rgba(15, 23, 42, .05);
    --radius: 14px;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --bg: #0b1020; --panel: #121a2e; --panel-2: #0f1627; --chip: #1c2640; --text: #e5e9f2; --muted: #94a0b8; --line: #222c44; --line-strong: #2e3a57;
      --accent: color-mix(in srgb, ${color} 65%, #ffffff); --on-accent: #0b1020;
      --ok: #34d399; --ok-soft: #0f2e25; --warn: #fbbf24; --warn-soft: #33260b; --bad: #fb7185; --bad-soft: #3a1420;
      --shadow: 0 1px 2px rgba(0, 0, 0, .3), 0 4px 14px rgba(0, 0, 0, .25);
    }
  }
  :root { --accent-soft: color-mix(in srgb, var(--accent) 13%, var(--panel)); --accent-line: color-mix(in srgb, var(--accent) 40%, var(--panel)); }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  html, body { overflow-x: hidden; }
  body { margin: 0; font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI Variable Text", "Segoe UI", Roboto, sans-serif;
    background: var(--bg); color: var(--text); -webkit-font-smoothing: antialiased; }
  header { position: sticky; top: 0; z-index: 30; background: color-mix(in srgb, var(--panel) 90%, transparent); backdrop-filter: saturate(1.4) blur(10px);
    border-bottom: 1px solid var(--line); padding: 10px 24px; display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
  .brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .logo { width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center; color: #fff; font-weight: 800; font-size: 14px; background: ${color}; flex: none; }
  h1 { font-size: 16px; margin: 0; letter-spacing: -.01em; }
  h1 small { display: block; font-size: 11px; font-weight: 500; color: var(--muted); letter-spacing: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  h2 { font-size: 15px; margin: 0 0 10px; letter-spacing: -.01em; }
  .tabs { display: flex; gap: 2px; background: var(--chip); padding: 3px; border-radius: 11px; }
  .tab { padding: 6px 14px; border: none; border-radius: 8px; cursor: pointer; color: var(--muted); background: none; font: inherit; font-weight: 500; box-shadow: none; white-space: nowrap; }
  .tab:hover { color: var(--text); filter: none; }
  .tab.active { background: var(--panel); color: var(--text); font-weight: 600; box-shadow: 0 1px 3px rgba(15, 23, 42, .12); }
  .hdr-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
  .balance { font-size: 13px; padding: 4px 11px; border-radius: 99px; background: var(--accent-soft); color: var(--accent); font-weight: 600; white-space: nowrap; }
  .menuwrap { position: relative; }
  .menu { position: absolute; right: 0; top: calc(100% + 6px); min-width: 210px; background: var(--panel); border: 1px solid var(--line-strong); border-radius: 12px;
    box-shadow: 0 12px 32px rgba(16,24,40,.16); z-index: 40; padding: 6px; display: flex; flex-direction: column; }
  .menu .who { padding: 6px 10px 8px; font-size: 12px; color: var(--muted); border-bottom: 1px solid var(--line); margin-bottom: 4px; overflow-wrap: anywhere; }
  .menu button { background: none; border: none; color: var(--text); text-align: left; font-weight: 500; box-shadow: none; padding: 8px 10px; }
  .menu button:hover, .menu button:focus-visible { background: var(--chip); filter: none; }
  main { padding: 20px 24px 48px; display: flex; flex-direction: column; gap: 16px; max-width: 1480px; margin: 0 auto; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px 18px; box-shadow: var(--shadow); min-width: 0; }
  input, select, button { font: inherit; }
  input[type=text], input[type=email], input[type=number], input[type=password], input[type=search], select { padding: 7px 10px; border: 1px solid var(--line-strong); border-radius: 9px;
    background: var(--panel); color: var(--text); max-width: 100%; }
  input:focus-visible, select:focus-visible { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  input[type=checkbox], input[type=radio] { accent-color: var(--accent); }
  button { padding: 8px 15px; border-radius: 9px; border: 1px solid var(--accent); background: var(--accent); color: var(--on-accent); cursor: pointer; font-weight: 600;
    box-shadow: 0 1px 2px rgba(15, 23, 42, .08); }
  button:hover { filter: brightness(1.06); }
  button:focus-visible, a:focus-visible, summary:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--accent-line); }
  button.ghost { background: var(--panel); color: var(--text); border-color: var(--line-strong); font-weight: 500; }
  button.ghost:hover { border-color: var(--accent-line); color: var(--accent); filter: none; }
  button.link { background: none; border: none; color: var(--accent); padding: 0; box-shadow: none; font-weight: 500; }
  button.small { padding: 4px 10px; font-size: 12px; border-radius: 8px; }
  button:disabled { opacity: .5; cursor: default; filter: none; }
  .muted { color: var(--muted); } .hint { font-size: 12px; color: var(--muted); }
  .err { color: var(--bad); } .okmsg { color: var(--ok); }
  a { color: var(--accent); text-decoration: none; } a:hover { text-decoration: underline; }
  .banner { border-radius: 12px; padding: 10px 14px; font-weight: 500; }
  .banner.warn { background: var(--warn-soft); color: var(--warn); } .banner.bad { background: var(--bad-soft); color: var(--bad); }

  /* Signed out */
  .auth { display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 400px)); gap: 16px; justify-content: center; padding-top: 24px; }
  .auth h2 { font-size: 18px; }
  form.stack { display: flex; flex-direction: column; gap: 10px; }
  label.field { display: flex; flex-direction: column; gap: 3px; font-size: 13px; color: var(--muted); font-weight: 500; }
  label.field input, label.field select { width: 100%; color: var(--text); }
  .intro { text-align: center; max-width: 620px; margin: 8px auto 0; }
  .intro h2 { font-size: 24px; margin-bottom: 4px; }

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
  .pill { display: inline-block; padding: 1px 8px; border-radius: 99px; font-size: 12px; background: var(--chip); color: var(--muted); white-space: nowrap; }
  .pill.ok { background: var(--ok-soft); color: var(--ok); } .pill.bad { background: var(--bad-soft); color: var(--bad); } .pill.warn { background: var(--warn-soft); color: var(--warn); }
  .pill.prem { background: var(--accent-soft); color: var(--accent); }
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
  .flags { display: inline-flex; gap: 6px; }
  .flag { font-size: 14px; } .flag.off { opacity: .2; filter: grayscale(1); }
  .num { text-align: right; }
  .empty { text-align: center; padding: 40px 20px !important; color: var(--muted); white-space: normal; }
  .pager { display: flex; gap: 10px; align-items: center; justify-content: flex-end; padding: 10px 14px; flex-wrap: wrap; font-size: 13px; }
  .site { display: inline-block; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }

  /* Credits */
  .big { font-size: 30px; font-weight: 800; letter-spacing: -.02em; }
  .delta-pos { color: var(--ok); font-weight: 600; } .delta-neg { color: var(--bad); font-weight: 600; }

  /* Dialogs + toast */
  dialog { border: none; border-radius: 16px; padding: 0; width: min(480px, calc(100vw - 32px)); background: var(--panel); color: var(--text); box-shadow: 0 24px 64px rgba(16, 24, 40, .28); }
  dialog::backdrop { background: rgba(16, 24, 40, .45); }
  .dlg-body { padding: 20px 22px; display: flex; flex-direction: column; gap: 10px; }
  .dlg-body h2 { font-size: 18px; margin: 0; }
  .dlg-foot { display: flex; gap: 10px; justify-content: flex-end; padding: 12px 22px; border-top: 1px solid var(--line); background: var(--panel-2); flex-wrap: wrap; }
  .toast { position: fixed; left: 50%; bottom: 20px; transform: translate(-50%, 20px); opacity: 0; pointer-events: none; transition: opacity .2s, transform .2s;
    background: var(--text); color: var(--bg); padding: 10px 18px; border-radius: 12px; font-weight: 600; z-index: 60; max-width: calc(100vw - 32px); }
  .toast.show { opacity: 1; transform: translate(-50%, 0); }
  .toast.bad { background: var(--bad); color: #fff; }

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
    .bar .actions, .bar .actions button { width: 100%; }
    .auth { padding-top: 8px; grid-template-columns: minmax(0, 1fr); }
  }
</style>
</head>
<body data-brand="${name}" data-support="${support}">
<header>
  <div class="brand"><div class="logo" aria-hidden="true">${initial}</div><h1><span id="brandName">${name}</span><small id="hdrCompany"></small></h1></div>
  <nav class="tabs" id="appNav" aria-label="Sections" hidden>
    <button type="button" class="tab" data-tab="find">Find leads</button>
    <button type="button" class="tab" data-tab="mine">My leads</button>
    <button type="button" class="tab" data-tab="credits">Credits</button>
  </nav>
  <div class="hdr-right" id="hdrRight" hidden>
    <span class="balance" id="hdrCredits" title="Your credit balance"></span>
    <div class="menuwrap">
      <button type="button" class="ghost small" id="menuBtn" aria-haspopup="true" aria-expanded="false" aria-controls="menu">Account ▾</button>
      <div class="menu" id="menu" hidden>
        <div class="who" id="menuWho"></div>
        <button type="button" id="pwBtn">Change password</button>
        <button type="button" id="logoutBtn">Sign out</button>
      </div>
    </div>
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
          <label class="field">Password<input type="password" id="loginPass" autocomplete="current-password" required></label>
          <div id="loginMsg" class="err" role="alert"></div>
          <button type="submit" id="loginBtn">Sign in</button>
        </form>
      </div>
      <div class="card" id="signupCard">
        <h2>Create an account</h2>
        <form class="stack" id="signupForm" novalidate>
          <label class="field">Company<input type="text" id="suCompany" autocomplete="organization" required maxlength="120"></label>
          <label class="field">Your name<input type="text" id="suName" autocomplete="name" required maxlength="120"></label>
          <label class="field">Email<input type="email" id="suEmail" autocomplete="email" required maxlength="200"></label>
          <label class="field">Password (at least 10 characters)<input type="password" id="suPass" autocomplete="new-password" required minlength="10"></label>
          <label class="field">Repeat password<input type="password" id="suPass2" autocomplete="new-password" required minlength="10"></label>
          <div id="signupMsg" class="err" role="alert"></div>
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
          <fieldset>
            <legend>Where</legend>
            <label class="field">State<select id="fState"><option value="">All states</option></select></label>
            <label class="field">Cities <span id="cityPicked" class="hint"></span><input type="search" id="citySearch" class="nofilter" placeholder="Type to find a city" aria-label="Find a city"></label>
            <div class="checklist" id="cityList" role="group" aria-label="Cities"><div class="hint">Loading…</div></div>
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
            <label class="opt"><input type="radio" name="tier" value="google"> Premium Google <span class="n" id="priceGoogleLbl"></span></label>
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
            <label class="field">Minimum rating<select id="fRating"><option value="">Any rating</option><option value="3">3 ★ and up</option><option value="3.5">3.5 ★ and up</option><option value="4">4 ★ and up</option><option value="4.5">4.5 ★ and up</option></select></label>
            <div class="row2">
              <label class="field">Min reviews<input type="number" id="fMinRev" min="0" step="1" inputmode="numeric"></label>
              <label class="field">Max reviews<input type="number" id="fMaxRev" min="0" step="1" inputmode="numeric"></label>
            </div>
          </fieldset>
          <fieldset>
            <legend>Online presence score</legend>
            <label class="opt"><input type="checkbox" name="score" value="weak"> Weak (under 40): the most to fix</label>
            <label class="opt"><input type="checkbox" name="score" value="basic"> Basic (40-59)</label>
            <label class="opt"><input type="checkbox" name="score" value="good"> Good (60-79)</label>
            <label class="opt"><input type="checkbox" name="score" value="strong"> Strong (80+)</label>
          </fieldset>
          <fieldset>
            <legend>More</legend>
            <label class="field">Name contains<input type="search" id="fName" placeholder="e.g. plumbing"></label>
            <label class="opt"><input type="checkbox" id="fHideOwned"> Hide leads I already own</label>
          </fieldset>
          <button type="button" class="ghost" id="clearFilters">Clear filters</button>
        </form>
      </details>

      <div class="card results">
        <div class="bar">
          <div>
            <div id="resSummary" role="status" style="font-weight:600"></div>
            <div id="resCounts" class="hint"></div>
          </div>
          <div class="actions">
            <button type="button" id="buySelBtn" disabled>Buy selected (0)</button>
            <button type="button" class="ghost" id="buyAllBtn" disabled>Buy all matching</button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th scope="col"><input type="checkbox" id="selAll" aria-label="Select all on this page"></th>
              <th scope="col" data-col="name"><button type="button" class="sortbtn" data-sort="name">Name</button></th>
              <th scope="col">Category</th>
              <th scope="col">City / State</th>
              <th scope="col" data-col="rating"><button type="button" class="sortbtn" data-sort="rating">Rating</button></th>
              <th scope="col" data-col="reviews"><button type="button" class="sortbtn" data-sort="reviews">Reviews</button></th>
              <th scope="col" data-col="score"><button type="button" class="sortbtn" data-sort="score" title="Online presence score: low means the most to fix">Score</button></th>
              <th scope="col">Type</th>
              <th scope="col">Contact info</th>
            </tr></thead>
            <tbody id="resBody"></tbody>
          </table>
        </div>
        <div class="pager" id="resPager"></div>
      </div>
    </div>

    <div id="view-mine" hidden>
      <div class="card results">
        <div class="bar">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <input type="search" id="mineSearch" placeholder="Search by name" aria-label="Search my leads by name">
            <span id="mineSummary" class="hint" role="status"></span>
          </div>
          <div class="actions">
            <button type="button" id="dlSimple">Download all (spreadsheet)</button>
            <button type="button" class="ghost" id="dlCold">Download for cold email</button>
          </div>
        </div>
        <div class="bar" id="mineSelBar" hidden>
          <span id="mineSelCount"></span>
          <div class="actions">
            <button type="button" class="ghost small" id="dlSelSimple">Download selected (spreadsheet)</button>
            <button type="button" class="ghost small" id="dlSelCold">Download selected (cold email)</button>
            <button type="button" class="link small" id="mineSelClear">Clear selection</button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th scope="col"><input type="checkbox" id="mineSelAll" aria-label="Select all on this page"></th>
              <th scope="col">Name</th><th scope="col">Category</th><th scope="col">Phone</th><th scope="col">Email</th><th scope="col">Owner</th>
              <th scope="col">Website</th><th scope="col">Address</th><th scope="col">City</th><th scope="col">State</th>
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
        <p id="crPrices" style="margin:6px 0"></p>
        <p class="muted" id="crTopup" style="margin:0"></p>
      </div>
      <div class="card results">
        <div class="bar"><h2 style="margin:0">History</h2><span class="hint">Last 100 changes</span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th scope="col">When</th><th scope="col">What</th><th scope="col" class="num">Change</th><th scope="col" class="num">Balance after</th></tr></thead>
            <tbody id="crBody"></tbody>
          </table>
        </div>
      </div>
    </div>
  </section>
</main>

<dialog id="buyDlg" aria-labelledby="buyTitle">
  <div class="dlg-body">
    <h2 id="buyTitle">Unlock leads</h2>
    <div id="buyText" role="status"></div>
    <div id="buyErr" class="err" role="alert"></div>
  </div>
  <div class="dlg-foot">
    <button type="button" class="ghost" id="buyCancel">Cancel</button>
    <button type="button" id="buyConfirm">Unlock</button>
  </div>
</dialog>

<dialog id="pwDlg" aria-labelledby="pwTitle">
  <form id="pwForm" novalidate>
    <div class="dlg-body">
      <h2 id="pwTitle">Change password</h2>
      <label class="field">Current password<input type="password" id="pwCur" autocomplete="current-password" required></label>
      <label class="field">New password (at least 10 characters)<input type="password" id="pwNew" autocomplete="new-password" required minlength="10"></label>
      <label class="field">Repeat new password<input type="password" id="pwNew2" autocomplete="new-password" required minlength="10"></label>
      <div id="pwMsg" class="err" role="alert"></div>
    </div>
    <div class="dlg-foot">
      <button type="button" class="ghost" id="pwCancel">Cancel</button>
      <button type="submit" id="pwSave">Change password</button>
    </div>
  </form>
</dialog>

<div id="toast" class="toast" role="status" aria-live="polite"></div>

<script>
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Only normal web addresses become links. (No slashes escaped: this script sits inside a template string.)
const isWebLink = (u) => typeof u === "string" && /^https?:[/][/]/i.test(u);
const num = (v) => Number(v || 0).toLocaleString("en-US");
const plural = (n, word) => num(n) + " " + word + (Number(n) === 1 ? "" : "s");
const PAGE_SIZE = 50;
const MAX_BUY = 5000;

const BRAND = { name: document.body.dataset.brand || "Lead Store", supportEmail: document.body.dataset.support || "", signupOpen: true, prices: null };
let me = null;
let signedIn = false;

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

function supportHtml() {
  return BRAND.supportEmail ? '<a href="mailto:' + esc(BRAND.supportEmail) + '">' + esc(BRAND.supportEmail) + "</a>" : "us";
}
function prices() {
  const p = (me && me.prices) || BRAND.prices || {};
  return { free: p.free, google: p.google };
}
function priceText(n) { return n == null ? "" : plural(n, "credit") + " each"; }

let toastTimer = null;
function toast(msg, bad) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast show" + (bad ? " bad" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = "toast"; }, 4500);
}

function fmtDate(v) {
  if (v == null || v === "") return "";
  let d;
  if (typeof v === "number") d = new Date(v < 1e12 ? v * 1000 : v);
  else if (/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:/.test(String(v))) d = new Date(String(v).replace(" ", "T") + "Z");
  else d = new Date(v);
  return isNaN(d.getTime()) ? String(v) : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/* ---------- Sections ---------- */
function show(section) {
  $("bootView").hidden = section !== "boot";
  $("outView").hidden = section !== "out";
  $("appView").hidden = section !== "app";
  $("appNav").hidden = section !== "app";
  $("hdrRight").hidden = section !== "app";
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
  } catch (e) { /* the page still works with the values it was served with */ }
  applyBrand();
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
  closeMenu();
  for (const id of ["buyDlg", "pwDlg"]) { if ($(id).open) $(id).close(); }
  show("out");
  $("loginMsg").textContent = msg || "";
  $("loginMsg").className = msg && /signed out/i.test(msg) ? "okmsg" : "err";
  $("signupCard").hidden = !BRAND.signupOpen;
  $("signupClosed").hidden = BRAND.signupOpen;
  $("signupClosedMsg").innerHTML = "We're not taking new sign-ups right now. To ask about an account, contact " + supportHtml() + ".";
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
    const d = await postJson("/api/signup", { company, name, email, password });
    $("signupForm").hidden = true;
    const done = $("signupDone");
    done.hidden = false;
    done.innerHTML = d.status === "active"
      ? '<p class="okmsg"><strong>Thanks! Your account is ready.</strong></p><p class="muted">Sign in with your email and password to start.</p>'
      : '<p class="okmsg"><strong>Thanks! Your account is waiting for approval.</strong></p><p class="muted">We&#39;ll let you know when it&#39;s ready.</p>';
    $("loginEmail").value = email;
  } catch (err) {
    msg.textContent = err.message;
  } finally { $("signupBtn").disabled = false; }
});

/* ---------- Signed in shell ---------- */
function canBuy() { return !!me && me.account && me.account.status === "active"; }

function renderHeader() {
  if (!me) return;
  $("hdrCompany").textContent = me.account.company || "";
  $("hdrCredits").textContent = plural(me.account.credits, "credit");
  $("menuWho").textContent = (me.user.name ? me.user.name + " · " : "") + (me.user.email || "");
  const b = $("banner");
  const st = me.account.status;
  if (st === "pending") {
    b.hidden = false; b.className = "banner warn";
    b.textContent = "Your account is waiting for approval. You can look around now; buying leads opens once it's approved.";
  } else if (st === "suspended") {
    b.hidden = false; b.className = "banner bad";
    b.innerHTML = "Your account is paused. Contact " + supportHtml() + ".";
  } else { b.hidden = true; }
  applyBrand();
  updateBuyButtons();
}

async function refreshMe() {
  try { me = await api("/api/me"); renderHeader(); }
  catch (e) { if (signedIn) toast("Couldn't refresh your balance: " + e.message, true); }
}

function enterApp() {
  signedIn = true;
  show("app");
  renderHeader();
  const tab = (location.hash || "").slice(1);
  switchTab(["find", "mine", "credits"].indexOf(tab) >= 0 ? tab : "find");
}

let currentTab = "find";
function switchTab(t) {
  currentTab = t;
  for (const b of document.querySelectorAll(".tab")) {
    const on = b.dataset.tab === t;
    b.classList.toggle("active", on);
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  }
  for (const v of ["find", "mine", "credits"]) $("view-" + v).hidden = v !== t;
  try { history.replaceState(null, "", "#" + t); } catch (e) { /* ignore */ }
  if (t === "find") { setupFind(); loadLeads(); }
  else if (t === "mine") loadMine();
  else loadCredits();
}
for (const b of document.querySelectorAll(".tab")) b.addEventListener("click", () => switchTab(b.dataset.tab));

function closeMenu() { $("menu").hidden = true; $("menuBtn").setAttribute("aria-expanded", "false"); }
$("menuBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  const open = $("menu").hidden;
  $("menu").hidden = !open;
  $("menuBtn").setAttribute("aria-expanded", String(open));
  if (open) $("pwBtn").focus();
});
document.addEventListener("click", (e) => { if (!$("menu").hidden && !$("menu").contains(e.target)) closeMenu(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("menu").hidden) { closeMenu(); $("menuBtn").focus(); } });

$("logoutBtn").addEventListener("click", async () => {
  closeMenu();
  try { await postJson("/api/logout", {}); showSignedOut("You're signed out."); }
  catch (e) { toast("Couldn't sign out: " + e.message, true); }
});

/* ---------- Change password ---------- */
$("pwBtn").addEventListener("click", () => {
  closeMenu();
  $("pwForm").reset(); $("pwMsg").textContent = "";
  $("pwDlg").showModal();
  $("pwCur").focus();
});
$("pwCancel").addEventListener("click", () => $("pwDlg").close());
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
    $("pwDlg").close();
    toast("Password changed");
  } catch (err) { msg.textContent = err.message; }
  finally { $("pwSave").disabled = false; }
});

/* ---------- Pick lists (cities, categories) ---------- */
function checklist(boxId, searchId, pickedId, what) {
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
      : '<div class="hint">' + esc(q && st.options.length ? "Nothing matches “" + q + "”" : st.empty) + "</div>";
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
const cities = checklist("cityList", "citySearch", "cityPicked", "city");
const cats = checklist("catList", "catSearch", "catPicked", "category");
const cityOpts = (list) => (list || []).map((c) => ({ value: String(c.value), label: String(c.value).split("|").join(", "), n: c.n }));
let allCategories = [];

function renderCategories() {
  const ind = $("fIndustry").value;
  const list = allCategories.filter((c) => !ind || c.industry === ind);
  if (ind) { const ok = new Set(list.map((c) => c.value)); for (const v of Array.from(cats.st.sel)) if (!ok.has(v)) cats.st.sel.delete(v); }
  cats.set(list.map((c) => ({ value: String(c.value), label: String(c.value), n: c.n })), "No categories");
}

async function loadCities() {
  const st = $("fState").value;
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

let findSetup = false;
async function setupFind() {
  if (findSetup) return;
  findSetup = true;
  if (window.matchMedia && window.matchMedia("(max-width: 900px)").matches) $("filterBox").open = false;
  const placesP = api("/api/places").then((d) => {
    $("fState").innerHTML = '<option value="">All states</option>' + (d.states || []).map((s) => '<option value="' + esc(s.value) + '">' + esc(s.value) + " (" + num(s.n) + ")</option>").join("");
    cities.set(cityOpts(d.cities), "No cities found");
  }).catch((e) => { cities.set([], "Couldn't load places: " + e.message); findSetup = false; });
  const catsP = api("/api/categories").then((d) => {
    $("fIndustry").innerHTML = '<option value="">All industries</option>' + (d.industries || []).map((s) => '<option value="' + esc(s.value) + '">' + esc(s.value) + " (" + num(s.n) + ")</option>").join("");
    allCategories = d.categories || [];
    renderCategories();
  }).catch((e) => { cats.set([], "Couldn't load categories: " + e.message); findSetup = false; });
  await Promise.all([placesP, catsP]);
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
  return p.toString();
}
function updateFilterCount() {
  const n = Array.from(new URLSearchParams(filterQuery()).keys()).length;
  $("filterCount").hidden = !n;
  $("filterCount").textContent = n + " on";
}

let filterTimer = null;
function filtersChanged() {
  clearTimeout(filterTimer);
  updateFilterCount();
  filterTimer = setTimeout(() => { find.page = 1; find.selected.clear(); loadLeads(); }, 350);
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
  cities.clear(); cats.clear();
  if (hadState) loadCities();
  if (hadInd) renderCategories();
  filtersChanged();
});

/* ---------- Results ---------- */
const find = { page: 1, sort: "score", dir: "asc", total: 0, counts: {}, rows: [], selected: new Set(), req: 0, loaded: false };
const DEFAULT_DIR = { name: "asc", score: "asc", rating: "desc", reviews: "desc" };
const FLAGS = [["hasPhone", "📞", "phone"], ["hasEmail", "✉", "email"], ["hasOwner", "👤", "owner name"], ["hasWebsite", "🌐", "website"]];

function scorePill(s) {
  if (s == null) return '<span class="muted" title="Not scored yet">–</span>';
  const n = Number(s);
  const cls = n >= 80 ? "ok" : n >= 40 ? "warn" : "bad";
  const word = n >= 80 ? "Strong" : n >= 60 ? "Good" : n >= 40 ? "Basic" : "Weak: the most to fix";
  return '<span class="pill ' + cls + '" title="' + esc(word) + '">' + esc(n) + "</span>";
}
function leadRow(r) {
  const flags = FLAGS.map((f) => {
    const has = !!r[f[0]];
    const label = (has ? "Has " : "No ") + f[2];
    return '<span class="flag' + (has ? "" : " off") + '" role="img" aria-label="' + label + '" title="' + label + '">' + f[1] + "</span>";
  }).join("");
  let reveal = "";
  if (r.owned) {
    const bits = [];
    if (r.phone) bits.push('📞 <a href="tel:' + esc(String(r.phone).replace(/[^0-9+]/g, "")) + '">' + esc(r.phone) + "</a>");
    if (r.email) bits.push('✉ <a href="mailto:' + esc(r.email) + '">' + esc(r.email) + "</a>");
    if (bits.length) reveal = '<div class="reveal">' + bits.join(" · ") + "</div>";
  }
  const place = [r.city, r.state].filter(Boolean).join(", ");
  return '<tr class="' + (r.owned ? "is-owned" : "") + '">'
    + "<td>" + (r.owned
      ? '<input type="checkbox" disabled aria-label="You already own ' + esc(r.name) + '" title="You already own this lead">'
      : '<input type="checkbox" class="rowsel" data-id="' + esc(r.id) + '"' + (find.selected.has(String(r.id)) ? " checked" : "") + ' aria-label="Select ' + esc(r.name) + '">') + "</td>"
    + '<td class="name">' + esc(r.name) + (r.owned ? '<span class="owned">Owned</span>' : "") + reveal + "</td>"
    + '<td class="wrap">' + esc(r.category || "") + "</td>"
    + "<td>" + esc(place) + (r.zip ? ' <span class="hint">' + esc(r.zip) + "</span>" : "") + "</td>"
    + '<td class="num">' + (r.rating != null ? esc(Number(r.rating).toFixed(1)) + " ★" : '<span class="muted">–</span>') + "</td>"
    + '<td class="num">' + (r.reviews != null ? num(r.reviews) : '<span class="muted">–</span>') + "</td>"
    + "<td>" + scorePill(r.score) + "</td>"
    + "<td>" + (r.tier === "google" ? '<span class="pill prem">Premium</span>' : '<span class="pill">Standard</span>') + "</td>"
    + '<td><span class="flags">' + flags + "</span></td>"
    + "</tr>";
}

function pagerHtml(total, page, size) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (total <= size) return "";
  return '<button type="button" class="ghost small" data-page="' + (page - 1) + '"' + (page <= 1 ? " disabled" : "") + ">‹ Previous</button>"
    + "<span>Page " + num(page) + " of " + num(pages) + "</span>"
    + '<button type="button" class="ghost small" data-page="' + (page + 1) + '"' + (page >= pages ? " disabled" : "") + ">Next ›</button>";
}

function renderSortHeaders() {
  for (const th of document.querySelectorAll("#view-find th[data-col]")) {
    if (th.dataset.col === find.sort) th.setAttribute("aria-sort", find.dir === "asc" ? "ascending" : "descending");
    else th.removeAttribute("aria-sort");
  }
}

function updateBuyButtons() {
  const n = find.selected.size;
  const ok = canBuy();
  $("buySelBtn").textContent = "Buy selected (" + num(n) + ")";
  $("buySelBtn").disabled = !ok || n === 0;
  $("buyAllBtn").textContent = find.total ? "Buy all " + num(find.total) + " matching" : "Buy all matching";
  $("buyAllBtn").disabled = !ok || !find.loaded || find.total === 0;
  const why = !me ? "" : me.account.status === "pending" ? "Buying opens once your account is approved" : me.account.status === "suspended" ? "Your account is paused" : "";
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

async function loadLeads() {
  const my = ++find.req;
  find.loaded = false;
  renderSortHeaders();
  $("resBody").innerHTML = '<tr><td colspan="9" class="empty">Loading…</td></tr>';
  $("resSummary").textContent = "Searching…";
  $("resCounts").textContent = "";
  $("resPager").innerHTML = "";
  updateBuyButtons();
  try {
    const q = filterQuery();
    const d = await api("/api/leads?" + (q ? q + "&" : "") + "page=" + find.page + "&page_size=" + PAGE_SIZE + "&sort=" + find.sort + "&dir=" + find.dir);
    if (my !== find.req) return;
    find.total = Number(d.total || 0);
    find.counts = d.counts || {};
    find.rows = d.results || [];
    find.loaded = true;
    $("resSummary").textContent = find.total === 1 ? "1 lead matches" : num(find.total) + " leads match";
    const p = prices();
    $("resCounts").textContent = num(find.counts.free) + " standard" + (p.free != null ? " (" + plural(p.free, "credit") + " each)" : "")
      + " · " + num(find.counts.google) + " premium Google" + (p.google != null ? " (" + plural(p.google, "credit") + " each)" : "");
    $("resBody").innerHTML = find.rows.length
      ? find.rows.map(leadRow).join("")
      : '<tr><td colspan="9" class="empty"><strong>No leads match these filters.</strong><br>Try removing a filter or picking a wider area.</td></tr>';
    $("resPager").innerHTML = pagerHtml(find.total, find.page, PAGE_SIZE);
  } catch (e) {
    if (my !== find.req) return;
    find.total = 0;
    $("resSummary").textContent = "";
    $("resBody").innerHTML = '<tr><td colspan="9" class="empty"><span class="err">' + esc(e.message) + '</span><br><button type="button" class="ghost small" data-retry="leads" style="margin-top:8px">Try again</button></td></tr>';
  }
  updateSelAll();
  updateBuyButtons();
}

$("resBody").addEventListener("change", (e) => {
  const t = e.target;
  if (!t.classList.contains("rowsel")) return;
  if (t.checked) find.selected.add(t.dataset.id); else find.selected.delete(t.dataset.id);
  updateSelAll(); updateBuyButtons();
});
$("resBody").addEventListener("click", (e) => { if (e.target.dataset && e.target.dataset.retry) loadLeads(); });
$("selAll").addEventListener("change", () => {
  const on = $("selAll").checked;
  for (const b of document.querySelectorAll("#resBody .rowsel")) {
    b.checked = on;
    if (on) find.selected.add(b.dataset.id); else find.selected.delete(b.dataset.id);
  }
  updateSelAll(); updateBuyButtons();
});
$("resPager").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-page]");
  if (!b || b.disabled) return;
  find.page = Number(b.dataset.page);
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

/* ---------- Buying ---------- */
let pendingBuy = null;
function howToGetCredits() {
  return '<p class="hint" style="margin:4px 0 0">How to get credits: contact ' + supportHtml() + " and we'll top up your account.</p>";
}
async function startBuy(all) {
  if (!canBuy()) return;
  const q = filterQuery();
  pendingBuy = all
    ? { path: "/api/buy" + (q ? "?" + q : ""), body: { all: true } }
    : { path: "/api/buy", body: { ids: Array.from(find.selected) } };
  $("buyTitle").textContent = all ? "Unlock all matching leads" : "Unlock selected leads";
  $("buyText").innerHTML = '<span class="muted">Working out the price…</span>';
  $("buyErr").innerHTML = "";
  $("buyConfirm").hidden = true;
  $("buyConfirm").disabled = false;
  $("buyCancel").textContent = "Cancel";
  $("buyDlg").showModal();
  $("buyCancel").focus();
  const mine = pendingBuy;
  try {
    const d = await postJson(pendingBuy.path, Object.assign({ dryRun: true }, pendingBuy.body));
    if (pendingBuy !== mine) return;
    const count = Number(d.count || 0), credits = Number(d.credits || 0), balance = Number(d.balance || 0);
    let html = "";
    if (count === 0) {
      html = "<p>You already own " + (Number(d.alreadyOwned || 0) === 1 ? "this lead" : "all of these leads") + ". Nothing to pay.</p>";
      $("buyCancel").textContent = "Close";
    } else {
      html = "<p><strong>" + plural(count, "new lead") + "</strong> (" + num(d.free) + " standard, " + num(d.google) + " premium) = <strong>" + plural(credits, "credit") + "</strong>.</p>"
        + "<p>You have " + plural(balance, "credit") + ". Already owned: " + num(d.alreadyOwned) + " (free).</p>";
      if (d.capped) html += '<p class="hint">This purchase is limited to ' + num(MAX_BUY) + " leads per purchase. Buy again afterwards to get the rest.</p>";
      if (credits > balance) {
        $("buyErr").innerHTML = "You need " + plural(credits - balance, "more credit") + " for this." + howToGetCredits();
      } else {
        $("buyConfirm").hidden = false;
        $("buyConfirm").textContent = "Unlock for " + plural(credits, "credit");
        $("buyConfirm").focus();
      }
    }
    $("buyText").innerHTML = html;
  } catch (e) {
    if (pendingBuy !== mine) return;
    $("buyText").innerHTML = "";
    $("buyErr").innerHTML = esc(e.message) + (e.status === 402 ? howToGetCredits() : "");
    $("buyCancel").textContent = "Close";
  }
}
$("buySelBtn").addEventListener("click", () => startBuy(false));
$("buyAllBtn").addEventListener("click", () => startBuy(true));
$("buyCancel").addEventListener("click", () => $("buyDlg").close());
$("buyDlg").addEventListener("close", () => { pendingBuy = null; });
$("buyConfirm").addEventListener("click", async () => {
  if (!pendingBuy) return;
  const job = pendingBuy;
  $("buyConfirm").disabled = true;
  $("buyConfirm").textContent = "Unlocking…";
  $("buyErr").innerHTML = "";
  try {
    const d = await postJson(job.path, job.body);
    if ($("buyDlg").open) $("buyDlg").close();
    toast("Unlocked " + plural(d.bought, "lead"));
    if (me && d.balance != null) { me.account.credits = d.balance; renderHeader(); }
    find.selected.clear();
    refreshMe();
    loadLeads();
  } catch (e) {
    $("buyErr").innerHTML = esc(e.message) + (e.status === 402 ? howToGetCredits() : "");
    $("buyConfirm").disabled = e.status === 402 || e.status === 403;
    $("buyConfirm").textContent = "Try again";
    if (e.status === 403) refreshMe();
  }
});

/* ---------- My leads ---------- */
const mine = { page: 1, total: 0, selected: new Set(), req: 0 };
function mineRow(r) {
  const site = isWebLink(r.website) ? '<a class="site" href="' + esc(r.website) + '" target="_blank" rel="noopener noreferrer nofollow">' + esc(String(r.website).replace(/^https?:[/][/](www[.])?/i, "")) + "</a>" : (r.website ? esc(r.website) : '<span class="muted">–</span>');
  const owner = r.owner ? esc(r.owner) + (r.ownerTitle ? ' <span class="hint">' + esc(r.ownerTitle) + "</span>" : "") : '<span class="muted">–</span>';
  const phone = r.phone ? '<a href="tel:' + esc(String(r.phone).replace(/[^0-9+]/g, "")) + '">' + esc(r.phone) + "</a>" : '<span class="muted">–</span>';
  const email = r.email ? '<a href="mailto:' + esc(r.email) + '">' + esc(r.email) + "</a>" : '<span class="muted">–</span>';
  return "<tr>"
    + '<td><input type="checkbox" class="minesel" data-id="' + esc(r.id) + '"' + (mine.selected.has(String(r.id)) ? " checked" : "") + ' aria-label="Select ' + esc(r.name) + '"></td>'
    + '<td class="name">' + esc(r.name) + (r.tier === "google" ? ' <span class="pill prem">Premium</span>' : "") + "</td>"
    + '<td class="wrap">' + esc(r.category || "") + "</td>"
    + "<td>" + phone + "</td><td>" + email + "</td><td>" + owner + "</td><td>" + site + "</td>"
    + '<td class="wrap">' + esc(r.address || "") + "</td><td>" + esc(r.city || "") + "</td><td>" + esc(r.state || "") + "</td></tr>";
}
function updateMineSel() {
  const n = mine.selected.size;
  $("mineSelBar").hidden = n === 0;
  $("mineSelCount").textContent = plural(n, "lead") + " selected";
  const boxes = Array.from(document.querySelectorAll("#mineBody .minesel"));
  const on = boxes.filter((b) => b.checked).length;
  $("mineSelAll").disabled = boxes.length === 0;
  $("mineSelAll").checked = boxes.length > 0 && on === boxes.length;
  $("mineSelAll").indeterminate = on > 0 && on < boxes.length;
}
async function loadMine() {
  const my = ++mine.req;
  $("mineBody").innerHTML = '<tr><td colspan="10" class="empty">Loading…</td></tr>';
  $("minePager").innerHTML = "";
  $("mineSummary").textContent = "";
  try {
    const q = $("mineSearch").value.trim();
    const d = await api("/api/my-leads?page=" + mine.page + "&page_size=" + PAGE_SIZE + (q ? "&q=" + encodeURIComponent(q) : ""));
    if (my !== mine.req) return;
    mine.total = Number(d.total || 0);
    const rows = d.results || [];
    $("mineSummary").textContent = mine.total === 1 ? "1 lead" : num(mine.total) + " leads";
    $("mineBody").innerHTML = rows.length ? rows.map(mineRow).join("")
      : '<tr><td colspan="10" class="empty">' + (q ? "No leads you own match “" + esc(q) + "”." : "<strong>You haven't unlocked any leads yet.</strong><br>Go to Find leads, pick the ones you want and unlock them.") + "</td></tr>";
    $("minePager").innerHTML = pagerHtml(mine.total, mine.page, PAGE_SIZE);
    $("dlSimple").disabled = $("dlCold").disabled = mine.total === 0 && !q;
  } catch (e) {
    if (my !== mine.req) return;
    $("mineBody").innerHTML = '<tr><td colspan="10" class="empty"><span class="err">' + esc(e.message) + '</span><br><button type="button" class="ghost small" data-retry="mine" style="margin-top:8px">Try again</button></td></tr>';
  }
  updateMineSel();
}
let mineTimer = null;
$("mineSearch").addEventListener("input", () => { clearTimeout(mineTimer); mineTimer = setTimeout(() => { mine.page = 1; loadMine(); }, 350); });
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
function download(format, ids) {
  const a = document.createElement("a");
  a.href = "/api/download?format=" + format + (ids && ids.length ? "&ids=" + encodeURIComponent(ids.join(",")) : "");
  a.download = "";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast("Your download is starting");
}
$("dlSimple").addEventListener("click", () => download("simple"));
$("dlCold").addEventListener("click", () => download("cold_email"));
$("dlSelSimple").addEventListener("click", () => download("simple", Array.from(mine.selected)));
$("dlSelCold").addEventListener("click", () => download("cold_email", Array.from(mine.selected)));

/* ---------- Credits ---------- */
const KIND_LABELS = { grant: "Credits added", purchase: "Leads unlocked", refund: "Refund", adjust: "Adjustment" };
async function loadCredits() {
  const p = prices();
  $("crBalance").textContent = me ? plural(me.account.credits, "credit") : "";
  $("crPrices").textContent = p.free != null && p.google != null
    ? "Standard lead = " + plural(p.free, "credit") + ", Premium Google lead = " + plural(p.google, "credit") + ". Leads you already own are free to download again."
    : "";
  $("crTopup").innerHTML = "Buying credits by card is coming soon. To top up now, contact " + supportHtml() + ".";
  $("crBody").innerHTML = '<tr><td colspan="4" class="empty">Loading…</td></tr>';
  try {
    const d = await api("/api/credits");
    if (me && d.balance != null) { me.account.credits = d.balance; renderHeader(); $("crBalance").textContent = plural(d.balance, "credit"); }
    const rows = d.history || [];
    $("crBody").innerHTML = rows.length ? rows.map((h) => {
      const delta = Number(h.delta || 0);
      return "<tr><td>" + esc(fmtDate(h.at)) + '</td><td class="wrap">' + esc(KIND_LABELS[h.kind] || h.kind || "") + (h.note ? ' <span class="hint">' + esc(h.note) + "</span>" : "") + "</td>"
        + '<td class="num ' + (delta >= 0 ? "delta-pos" : "delta-neg") + '">' + (delta > 0 ? "+" : "") + num(delta) + "</td>"
        + '<td class="num">' + num(h.balance) + "</td></tr>";
    }).join("") : '<tr><td colspan="4" class="empty">No credit changes yet.</td></tr>';
  } catch (e) {
    $("crBody").innerHTML = '<tr><td colspan="4" class="empty"><span class="err">' + esc(e.message) + '</span><br><button type="button" class="ghost small" id="crRetry" style="margin-top:8px">Try again</button></td></tr>';
    $("crRetry").onclick = loadCredits;
  }
}

boot();
</script>
</body>
</html>`;
}
