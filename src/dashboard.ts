// Single-page dashboard served at "/". Plain HTML + JS, no build step.
// Flow: start empty -> pick where + what -> "Find leads" reuses stored pulls and only
// pulls (and pays for) what's missing -> filter the results with Targetron-style dropdowns.

export const dashboardHtml = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lead Finder</title>
<style>
  :root {
    --bg: #f6f7f9; --panel: #fff; --text: #1d2330; --muted: #667085; --line: #e4e7ec; --line-strong: #d0d5dd;
    --accent: #2563eb; --accent-soft: #eff4ff; --ok: #067647; --ok-soft: #ecfdf3; --warn: #b54708; --warn-soft: #fffaeb;
    --bad: #b42318; --bad-soft: #fef3f2;
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body { margin: 0; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
  header { background: var(--panel); border-bottom: 1px solid var(--line); padding: 12px 20px 0; display: flex; align-items: end; gap: 24px; }
  h1 { font-size: 18px; margin: 0 0 10px; }
  h2 { font-size: 15px; margin: 0 0 10px; }
  .tabs { display: flex; gap: 4px; }
  .tab { padding: 8px 14px; border: 1px solid transparent; border-bottom: none; border-radius: 8px 8px 0 0; cursor: pointer; color: var(--muted); background: none; font: inherit; }
  .tab.active { background: var(--bg); border-color: var(--line); color: var(--text); font-weight: 600; }
  main { padding: 16px 20px 40px; display: flex; flex-direction: column; gap: 14px; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
  input, select, button { font: inherit; }
  input[type=text], input[type=number], input[type=date], select { padding: 6px 8px; border: 1px solid var(--line-strong); border-radius: 6px; background: #fff; color: var(--text); }
  button { padding: 7px 14px; border-radius: 6px; border: 1px solid var(--accent); background: var(--accent); color: #fff; cursor: pointer; }
  button.ghost { background: #fff; color: var(--text); border-color: var(--line-strong); }
  button.link { background: none; border: none; color: var(--accent); padding: 0; }
  button.small { padding: 3px 9px; font-size: 12px; }
  button:disabled { opacity: .5; cursor: default; }
  .muted { color: var(--muted); } .hint { font-size: 12px; color: var(--muted); }
  .err { color: var(--bad); }
  a { color: var(--accent); text-decoration: none; }

  /* Search builder */
  .builder { display: grid; grid-template-columns: 96px 1fr; gap: 12px 14px; align-items: start; }
  .builder > .lbl { font-weight: 600; font-size: 13px; padding-top: 7px; }
  .line { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; border: 1px solid var(--line-strong); border-radius: 6px; padding: 4px 6px; min-width: 260px; background: #fff; }
  .tags input { border: none; outline: none; padding: 3px; min-width: 160px; flex: 1; }
  .tag { background: var(--accent-soft); color: var(--accent); border-radius: 99px; padding: 2px 4px 2px 9px; font-size: 12px; display: inline-flex; gap: 4px; align-items: center; }
  .tag button { background: none; border: none; color: inherit; padding: 0 4px; cursor: pointer; font-size: 13px; line-height: 1; }

  /* "What" button + picks */
  .picked { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .me { margin-left: auto; align-self: center; display: flex; gap: 10px; align-items: center; font-size: 13px; color: var(--muted); padding-bottom: 8px; }
  #whatBtn { display: inline-flex; align-items: center; gap: 8px; padding: 7px 14px; border-radius: 99px; }
  #whatBtn.on { background: var(--accent-soft); border-color: #b2ccff; color: var(--accent); font-weight: 600; }

  /* Category picker: a centered pop-up window over the page */
  .modal-backdrop { position: fixed; inset: 0; z-index: 50; background: rgba(16, 24, 40, .45); display: flex; align-items: center; justify-content: center; padding: 16px; }
  .modal { width: min(1120px, 100%); height: min(780px, 100%); background: #fff; border-radius: 16px; box-shadow: 0 24px 64px rgba(16, 24, 40, .28);
    display: grid; grid-template-rows: auto 1fr auto; overflow: hidden; }
  .modal-head { padding: 18px 22px 14px; border-bottom: 1px solid var(--line); }
  .modal-head .title { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .modal-head h2 { font-size: 18px; margin: 0; }
  .modal-head .x { background: none; border: none; color: var(--muted); font-size: 22px; line-height: 1; padding: 4px 8px; border-radius: 8px; }
  .modal-head .x:hover { background: var(--bg); color: var(--text); }
  .searchrow { display: flex; gap: 10px; align-items: center; }
  .searchbox { flex: 1; position: relative; }
  .searchbox input { width: 100%; padding: 11px 14px 11px 38px; font-size: 15px; border-radius: 10px; border: 1px solid var(--line-strong); }
  .searchbox input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .searchbox::before { content: "⌕"; position: absolute; left: 13px; top: 50%; transform: translateY(-52%); font-size: 18px; color: var(--muted); }
  .pill-btn { border-radius: 99px; padding: 9px 14px; background: #fff; color: var(--text); border: 1px solid var(--line-strong); white-space: nowrap; }
  .pill-btn:hover { border-color: #b2ccff; color: var(--accent); }
  .modal-body { display: grid; grid-template-columns: 290px 1fr; min-height: 0; }
  .side { border-right: 1px solid var(--line); overflow-y: auto; padding: 8px 10px 16px; background: #fcfcfd; }
  .side .gtitle { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; color: var(--text); margin: 14px 8px 6px; }
  .side .gtitle .ico { width: 26px; height: 26px; border-radius: 8px; background: var(--bg); display: grid; place-items: center; font-size: 14px; }
  .side .sec { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 7px 10px 7px 42px; border-radius: 8px; cursor: pointer; font-size: 13px; color: #344054; }
  .side .sec:hover { background: var(--bg); }
  .side .sec.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
  .side .cnt { font-size: 11px; color: var(--muted); white-space: nowrap; }
  .side .cnt.some { background: var(--accent); color: #fff; border-radius: 99px; padding: 1px 7px; font-weight: 700; }
  .main { overflow-y: auto; padding: 20px 24px 28px; }
  .main .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 4px; flex-wrap: wrap; }
  .main h3 { font-size: 20px; margin: 0 0 2px; }
  .main .sub { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin: 20px 0 10px; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
  .tile { display: flex; align-items: center; gap: 10px; border: 1px solid var(--line-strong); border-radius: 10px; padding: 11px 12px; cursor: pointer;
    background: #fff; text-align: left; font-size: 14px; color: var(--text); line-height: 1.3; transition: border-color .12s, background .12s; }
  .tile:hover { border-color: #84adff; background: #f8faff; }
  .tile .tick { flex: none; width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid var(--line-strong); display: grid; place-items: center; font-size: 11px; color: #fff; }
  .tile.on { border-color: var(--accent); background: var(--accent-soft); color: #1d3fa6; font-weight: 600; }
  .tile.on .tick { background: var(--accent); border-color: var(--accent); }
  .tile .star { margin-left: auto; color: #f79009; font-size: 12px; }
  .showall { display: inline-flex; align-items: center; gap: 6px; margin-top: 16px; padding: 8px 14px; border-radius: 99px; background: var(--bg); color: var(--accent); border: none; font-weight: 600; }
  .alllist { columns: 3 220px; column-gap: 22px; margin-top: 4px; }
  .alllist label { display: flex; gap: 8px; align-items: flex-start; padding: 5px 0; break-inside: avoid; font-size: 13px; cursor: pointer; }
  .alllist input { margin-top: 2px; accent-color: var(--accent); }
  .alllist .in { color: var(--muted); font-size: 11px; }
  .modal-foot { display: flex; align-items: center; gap: 12px; padding: 12px 22px; border-top: 1px solid var(--line); background: #fcfcfd; }
  .modal-foot .chosen { flex: 1; display: flex; gap: 6px; overflow-x: auto; white-space: nowrap; align-items: center; min-height: 30px; }
  .modal-foot .done { padding: 9px 20px; border-radius: 10px; font-weight: 600; }
  @media (max-width: 760px) { .modal-body { grid-template-columns: 1fr; grid-template-rows: 200px 1fr; } .side { border-right: none; border-bottom: 1px solid var(--line); } }

  /* Plan */
  .plan table { margin: 8px 0; }
  .plan .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }

  /* Dropdown chips (multi-select) */
  .filterbar { display: flex; flex-direction: column; gap: 8px; }
  .fgroup { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .fgroup > .glabel { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); width: 88px; flex: none; }
  .dd { position: relative; }
  .dd > .chip { background: #fff; color: var(--text); border: 1px solid var(--line-strong); border-radius: 99px; padding: 4px 11px; font-size: 13px; display: inline-flex; gap: 6px; align-items: center; cursor: pointer; }
  .dd > .chip.on { background: var(--accent-soft); border-color: #b2ccff; color: var(--accent); }
  .dd > .chip::after { content: "▾"; font-size: 10px; opacity: .7; }
  .pop { position: absolute; z-index: 20; top: calc(100% + 4px); left: 0; width: 290px; background: #fff; border: 1px solid var(--line-strong); border-radius: 10px;
    box-shadow: 0 8px 24px rgba(16,24,40,.12); padding: 8px; display: none; }
  .dd.open .pop { display: block; }
  .pop .search { width: 100%; margin-bottom: 6px; }
  .pop .bulk { display: flex; justify-content: space-between; font-size: 12px; padding: 0 2px 6px; border-bottom: 1px solid var(--line); margin-bottom: 4px; }
  .pop .opts { max-height: 300px; overflow-y: auto; }
  .pop .opt { display: flex; gap: 7px; align-items: center; padding: 4px 4px; border-radius: 6px; cursor: pointer; }
  .pop .opt:hover { background: var(--bg); }
  .pop .opt .n { margin-left: auto; color: var(--muted); font-size: 12px; }
  .pop .grp { display: flex; justify-content: space-between; align-items: center; font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .03em; color: var(--muted); padding: 8px 4px 3px; }
  .pop .grp button { font-size: 11px; text-transform: none; letter-spacing: 0; font-weight: 500; }
  .pop .empty { padding: 10px; color: var(--muted); font-size: 13px; }
  .pop .dates { display: grid; grid-template-columns: auto 1fr; gap: 6px 8px; align-items: center; font-size: 13px; }

  /* Results */
  .results { padding: 0; overflow: hidden; }
  .bar { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--line); gap: 10px; flex-wrap: wrap; }
  .scope { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; font-size: 13px; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 99px; font-size: 12px; background: #f2f4f7; color: var(--muted); }
  .pill.ok { background: var(--ok-soft); color: var(--ok); } .pill.bad { background: var(--bad-soft); color: var(--bad); } .pill.warn { background: var(--warn-soft); color: var(--warn); }
  .table-wrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  th { font-size: 12px; color: var(--muted); font-weight: 600; background: #fafbfc; }
  th[data-sort] { cursor: pointer; user-select: none; }
  th.sorted::after { content: " ▾"; } th.sorted.asc::after { content: " ▴"; }
  td.name { white-space: normal; min-width: 200px; font-weight: 500; }
  .type-mobile { color: var(--ok); } .type-toll_free { color: #6941c6; } .type-landline { color: #175cd3; }
  .empty-state { text-align: center; padding: 56px 20px; color: var(--muted); }
  .empty-state strong { display: block; color: var(--text); font-size: 16px; margin-bottom: 6px; }
  .history-filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: end; padding: 12px 14px; border-bottom: 1px solid var(--line); }
  label.field { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--muted); }
  @media (max-width: 760px) { .builder { grid-template-columns: 1fr; } .fgroup > .glabel { width: 100%; } }
</style>
</head>
<body>
<header>
  <h1>Lead Finder</h1>
  <div class="tabs">
    <button class="tab active" data-tab="find" type="button">Find leads</button>
    <button class="tab" data-tab="database" type="button">Database</button>
    <button class="tab" data-tab="history" type="button">Pull history</button>
    <button class="tab" data-tab="team" type="button" id="teamTab" hidden>Team</button>
  </div>
  <div class="me" id="me"></div>
</header>

<main id="findView">
  <section class="card" id="builderCard">
    <div class="builder">
      <div class="lbl">Where</div>
      <div class="line">
        <div class="dd" id="dd-country"></div>
        <div class="dd" id="dd-region"></div>
        <div class="dd" id="dd-city"></div>
      </div>
      <div class="lbl">What</div>
      <div class="line">
        <button type="button" class="ghost" id="whatBtn">Types of business: choose…</button>
        <div class="picked" id="whatPicked"></div>
      </div>
      <div class="lbl">How many</div>
      <div class="line">
        <label class="muted">Up to <select id="maxResults">
          <option value="10">10</option><option value="25">25</option><option value="50">50</option><option value="100" selected>100</option>
          <option value="250">250</option><option value="500">500</option><option value="1000">1,000</option><option value="2500">2,500</option>
          <option value="5000">5,000</option><option value="10000">10,000</option><option value="0">No limit (everything)</option>
        </select> businesses per search</label>
        <label class="muted">Source code <input type="text" id="sourceCode" placeholder="ILS" style="width:80px"></label>
      </div>
      <div class="lbl">Phones</div>
      <div class="line">
        <div class="dd" id="dd-phonetypes"></div>
        <label title="Checks each verified, open business's phone after the pull. Uses phone-check credits, so it's only done when you ask.">
          <input type="checkbox" id="checkPhones"> Check phone types after pulling</label>
        <span class="hint">Google doesn't know mobile vs landline, so this is a second step after the pull, charged per number.</span>
      </div>
      <div class="lbl">Count first</div>
      <div class="line">
        <label><input type="checkbox" id="withCounts" checked> Check how many exist on Google</label>
        <select id="countWebsite"><option value="">with or without a website</option><option value="no">without a website</option><option value="yes">with a website</option></select>
        <label><input type="checkbox" id="countPhone"> with a phone number</label>
        <label><input type="checkbox" id="countVerified"> verified only</label>
        <span class="hint">about 1¢ per type + place, remembered for a week</span>
      </div>
      <div></div>
      <div class="line">
        <button id="findBtn" type="button">Find leads</button>
        <span id="findMsg" class="hint"></span>
      </div>
    </div>
    <div class="hint" style="margin-top:8px">Pick cities, or leave cities empty to search whole states/provinces, or leave both empty to search whole countries. Anything pulled in the last 30 days is reused, and only what's missing is pulled.</div>
  </section>

  <section class="card plan" id="plan" hidden></section>

  <section class="card" id="filtersCard" hidden>
    <div class="filterbar" id="filterbar"></div>
  </section>

  <section class="card results" id="resultsCard">
    <div class="empty-state" id="emptyState">
      <strong>Nothing to show yet</strong>
      Choose where and what above, then click <b>Find leads</b>.<br>
      <span class="hint">Everything you've already collected is in the <b>Database</b> tab.</span>
    </div>
    <div id="resultsBody" hidden>
      <div class="bar">
        <div class="scope"><strong id="count"></strong> <span id="dupInfo" class="muted"></span> <span id="scopeInfo"></span></div>
        <div>
          <button class="small" id="downloadBtn" type="button" title="Every business matching the filters, in the GHL upload format">Download CSV</button>
          <button class="ghost small" id="prevBtn" type="button">‹ Prev</button>
          <span id="pageInfo" class="muted"></span>
          <button class="ghost small" id="nextBtn" type="button">Next ›</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th data-sort="name">Business</th><th data-sort="category">Category</th><th>Phone</th><th>Phone type</th><th>Website</th>
            <th data-sort="rating">Rating</th><th data-sort="reviews">Reviews</th><th data-sort="rank">Position</th><th>Verified</th>
            <th>Status</th><th>Location</th><th data-sort="city">City</th><th>State</th><th>Neighborhood</th><th data-sort="added" class="sorted">Added</th>
          </tr></thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
    </div>
  </section>
</main>

<main id="historyView" hidden>
  <section class="card results">
    <div class="history-filters">
      <label class="field">Business type<input type="text" id="hCategory" placeholder="e.g. plumber"></label>
      <label class="field">City<input type="text" id="hCity" placeholder="e.g. Orlando"></label>
      <label class="field">State<input type="text" id="hState" placeholder="FL" style="width:70px"></label>
      <label class="field">Status<select id="hStatus"><option value="">Any</option><option value="done">Done</option>
        <option value="scraping">Collecting</option><option value="failed">Failed</option></select></label>
      <label class="field">From<input type="date" id="hFrom"></label>
      <label class="field">To<input type="date" id="hTo"></label>
      <button class="ghost" id="hViewSelected" type="button" disabled>View businesses from selected pulls</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th></th><th>Date</th><th>Business type</th><th>Location</th><th>Source</th><th>Status</th>
          <th>Found</th><th>New</th><th>In your list</th><th>Cost</th><th>Source code</th><th></th></tr></thead>
        <tbody id="historyRows"></tbody>
      </table>
    </div>
  </section>
</main>

<main id="teamView" hidden>
  <section class="card">
    <h2>Add a team member</h2>
    <div class="line">
      <label class="field">Email<input type="password" id="tEmail" placeholder="name@company.com" autocomplete="off" style="width:230px"></label>
      <label class="field">Name<input type="text" id="tName" placeholder="First Last" style="width:170px"></label>
      <label class="field">Temporary password<input type="text" id="tPassword" style="width:190px"></label>
      <label class="field">Role<select id="tRole"><option value="member">Member</option><option value="admin">Admin (can manage the team)</option></select></label>
      <button type="button" id="tAdd" style="align-self:end">Add</button>
      <span id="tMsg" class="hint" style="align-self:end"></span>
    </div>
    <div class="hint" style="margin-top:8px">Give them the email and temporary password yourself. They'll be asked to choose their own password the first time they sign in.</div>
  </section>
  <section class="card results">
    <div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead>
      <tbody id="teamRows"></tbody>
    </table></div>
  </section>
</main>

<div id="catPicker" class="modal-backdrop" hidden></div>

<script>
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (v) => "$" + Number(v || 0).toFixed(2);
async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && body.signIn) { location.href = "/login"; throw new Error("Please sign in again."); }
  if (!res.ok) { const e = new Error(body.error || "Something went wrong (" + res.status + ")"); e.status = res.status; e.body = body; throw e; }
  return body;
}
const postJson = (path, body) => api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const PHONE_LABELS = { mobile: "Mobile", landline: "Landline", toll_free: "Toll-free", voip: "Internet (VoIP)", unknown: "Couldn't tell", unchecked: "Not checked yet", no_phone: "No phone" };
const STATUS_LABELS = { operational: "Open", temporarily_closed: "Temporarily closed", permanently_closed: "Permanently closed" };
const PULL_LABELS = { pending: "starting", scraping: "collecting…", ingesting: "saving…", enriching: "checking…", done: "done", failed: "failed" };
const REVIEW_LABELS = { none: "No reviews", "1-10": "1 – 10", "11-100": "11 – 100", "101-1000": "101 – 1,000", "1001-10000": "1,001 – 10,000", "10001+": "10,000+" };

// ---------------------------------------------------------------------------
// Dropdown chip: multi-select (default) or single-select, with search, select all / clear, groups and counts.
// ---------------------------------------------------------------------------
const dropdowns = [];
function dropdown(el, cfg) {
  const dd = { el, cfg, selected: cfg.selected || new Set() };
  el.classList.add("dd");
  el.innerHTML = '<button type="button" class="chip"></button><div class="pop"></div>';
  const chip = el.querySelector(".chip"), pop = el.querySelector(".pop");
  let filterText = "";
  dd.summary = () => {
    const opts = cfg.options();
    const picked = [...dd.selected];
    if (cfg.custom) return cfg.summary();
    if (!picked.length) return cfg.label + (cfg.allLabel ? ": " + cfg.allLabel : "");
    if (picked.length === 1) { const o = opts.find((x) => x.value === picked[0]); return cfg.label + ": " + (o ? o.label : picked[0]); }
    return cfg.label + ": " + picked.length + " selected";
  };
  dd.renderChip = () => {
    chip.textContent = dd.summary();
    chip.classList.toggle("on", cfg.custom ? cfg.isOn() : dd.selected.size > 0);
  };
  dd.renderPop = () => {
    if (cfg.custom) { pop.innerHTML = cfg.custom(); cfg.bind && cfg.bind(pop, dd); return; }
    const opts = cfg.options();
    const shown = filterText ? opts.filter((o) => (o.label + " " + (o.group || "")).toLowerCase().includes(filterText)) : opts;
    let html = "";
    if (cfg.search !== false && opts.length > 8) html += '<input type="text" class="search" placeholder="Search…" value="' + esc(filterText) + '">';
    if (!cfg.single) html += '<div class="bulk"><button type="button" class="link" data-act="all">Select all' + (filterText ? " shown" : "") + '</button><button type="button" class="link" data-act="clear">Clear</button></div>';
    html += '<div class="opts">';
    if (!shown.length) html += '<div class="empty">' + esc(cfg.emptyText || "Nothing here yet") + "</div>";
    let group = null;
    for (const o of shown) {
      if (o.group && o.group !== group) {
        group = o.group;
        html += '<div class="grp"><span>' + esc(group) + "</span>" + (cfg.single ? "" : '<button type="button" class="link" data-grp="' + esc(group) + '">Select all</button>') + "</div>";
      }
      const on = dd.selected.has(o.value);
      html += '<label class="opt"><input type="' + (cfg.single ? "radio" : "checkbox") + '" name="' + esc(cfg.label) + '" value="' + esc(o.value) + '"' + (on ? " checked" : "") + "> " +
        '<span>' + esc(o.label) + "</span>" + (o.n != null ? '<span class="n">' + Number(o.n).toLocaleString() + "</span>" : "") + "</label>";
    }
    html += "</div>";
    pop.innerHTML = html;
    const search = pop.querySelector(".search");
    if (search) { search.oninput = () => { filterText = search.value.trim().toLowerCase(); dd.renderPop(); const s = pop.querySelector(".search"); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }; }
  };
  const changed = () => { dd.renderChip(); dd.renderPop(); cfg.onChange && cfg.onChange(dd.selected); };
  pop.addEventListener("click", (e) => {
    const act = e.target.dataset && e.target.dataset.act;
    const grp = e.target.dataset && e.target.dataset.grp;
    if (act === "all") { const opts = cfg.options(); (filterText ? opts.filter((o) => (o.label + " " + (o.group || "")).toLowerCase().includes(filterText)) : opts).forEach((o) => dd.selected.add(o.value)); changed(); }
    else if (act === "clear") { dd.selected.clear(); changed(); }
    else if (grp) { cfg.options().filter((o) => o.group === grp).forEach((o) => dd.selected.add(o.value)); changed(); }
  });
  pop.addEventListener("change", (e) => {
    if (cfg.custom) return;
    const input = e.target;
    if (input.classList.contains("search")) return;
    if (cfg.single) { dd.selected.clear(); if (input.value) dd.selected.add(input.value); el.classList.remove("open"); }
    else input.checked ? dd.selected.add(input.value) : dd.selected.delete(input.value);
    changed();
  });
  chip.onclick = () => {
    const open = !el.classList.contains("open");
    dropdowns.forEach((d) => d.el.classList.remove("open"));
    if (open) { filterText = ""; dd.renderPop(); el.classList.add("open"); const s = pop.querySelector(".search"); if (s) s.focus(); }
  };
  dd.set = (values) => { dd.selected = new Set(values); dd.renderChip(); };
  dd.refresh = () => { dd.renderChip(); if (el.classList.contains("open")) dd.renderPop(); };
  dd.renderChip();
  dropdowns.push(dd);
  return dd;
}
document.addEventListener("click", (e) => { if (!e.target.closest(".dd")) dropdowns.forEach((d) => d.el.classList.remove("open")); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") dropdowns.forEach((d) => d.el.classList.remove("open")); });

// ---------------------------------------------------------------------------
// Search builder: country -> state/province -> city, and what
// ---------------------------------------------------------------------------
let geo = { countries: [], regions: [], cities: [] }, tree = null;
const cityByKey = new Map(); // "US|FL|Orlando" -> { country, region, city }

const whereCountry = dropdown($("dd-country"), {
  label: "Countries", allLabel: "none chosen",
  // United States first, then alphabetical.
  options: () => geo.countries.map((c) => ({ value: c.code, label: c.name, group: c.code === "US" ? "Most used" : "All countries" }))
    .sort((a, b) => (a.group === b.group ? a.label.localeCompare(b.label) : a.group === "Most used" ? -1 : 1)),
  onChange: () => loadRegions(),
});
const whereRegion = dropdown($("dd-region"), {
  label: "States / provinces", allLabel: "whole country", emptyText: "Choose a country first",
  options: () => geo.regions.map((r) => ({ value: r.country + "." + r.code, label: r.name, group: countryLabel(r.country) })),
  onChange: () => loadCities(),
});
const whereCity = dropdown($("dd-city"), {
  label: "Cities", allLabel: "whole state/province", emptyText: "Choose a country or state first",
  options: () => geo.cities.map((c) => {
    const key = c.country + "|" + (c.region || "") + "|" + c.name;
    // Listed biggest first (by population), so the major cities are at the top.
    return { value: key, label: c.name, group: (c.region_name || countryLabel(c.country)) + (whereCountry.selected.size > 1 ? " · " + c.country : "") };
  }),
});
// ---------------------------------------------------------------------------
// "What" picker: groups -> sectors -> popular tiles (+ "show all"), one search box, picks as tags.
// ---------------------------------------------------------------------------
const what = { selected: new Set(), refresh: () => renderWhat(), renderChip: () => renderWhat() };
const picker = { sector: "Home Services", search: "", showAll: false };
const sectorOf = (name) => tree && tree.industries.find((i) => i.industry === name);
const inSector = (name) => { const s = sectorOf(name); return s ? s.categories : []; };

function renderWhat() {
  const n = what.selected.size;
  $("whatBtn").textContent = n ? "Types of business: " + (n === 1 ? [...what.selected][0] : n + " selected") + " ▾" : "Types of business: choose… ▾";
  $("whatBtn").classList.toggle("on", n > 0);
  const shown = [...what.selected].slice(0, 8);
  $("whatPicked").innerHTML = shown.map((c) => '<span class="tag">' + esc(c) + ' <button type="button" data-unpick="' + esc(c) + '" aria-label="Remove">×</button></span>').join("") +
    (n > 8 ? '<span class="muted">+' + (n - 8) + " more</span>" : "") + (n ? ' <button type="button" class="link small" data-act="clear-what">clear</button>' : "");
  if (!$("catPicker").hidden) renderPicker();
}

// Matches the start of any word, so "dent" finds Dentist but not Residents.
function wordMatch(name, q) {
  const words = (s) => " " + s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return words(name).includes(words(q));
}
function groupIcon(sector) { const g = tree && tree.groups.find((x) => x.sectors.includes(sector)); return g ? g.icon : ""; }
function tileHtml(c, sel) {
  return '<button type="button" class="tile' + (sel.has(c.name) ? " on" : "") + '" data-cat="' + esc(c.name) + '"><span class="tick">✓</span><span>' +
    esc(c.name) + "</span>" + (c.top100 ? '<span class="star" title="Top 100">★</span>' : "") + "</button>";
}
function renderPicker() {
  const box = $("catPicker");
  if (!tree) { box.innerHTML = '<div class="modal"><div class="empty-state">Loading categories…</div></div>'; return; }
  const sel = what.selected;
  const total = tree.industries.reduce((s, i) => s + i.categories.length, 0);

  const side = tree.groups.map((g) =>
    '<div class="gtitle"><span class="ico">' + g.icon + "</span>" + esc(g.group) + "</div>" + g.sectors.map((s) => {
      const cats = inSector(s), picked = cats.filter((c) => sel.has(c.name)).length;
      return '<div class="sec' + (picker.sector === s && !picker.search ? " active" : "") + '" data-sector="' + esc(s) + '"><span>' + esc(s) + '</span>' +
        (picked ? '<span class="cnt some">' + picked + "</span>" : '<span class="cnt">' + cats.length + "</span>") + "</div>";
    }).join("")).join("");

  let main = "";
  const q = picker.search.trim().toLowerCase();
  if (q) {
    const hits = tree.industries.flatMap((i) => i.categories.filter((c) => wordMatch(c.name, q)).map((c) => ({ ...c, sector: i.industry })));
    main = '<div class="head"><div><h3>' + hits.length.toLocaleString() + " result" + (hits.length === 1 ? "" : "s") + '</h3><span class="hint">for "' + esc(picker.search.trim()) + '" across all sectors</span></div>' +
      (hits.length ? '<button type="button" class="pill-btn" data-act="add-hits">Select all ' + Math.min(hits.length, 500) + "</button>" : "") + "</div>";
    if (!hits.length) main += '<p class="muted" style="margin-top:18px">Nothing matches. Try a shorter word, e.g. "roof", "dent" or "pizza".</p>';
    else {
      // Group the hits by sector so the same word in different trades is easy to tell apart.
      const bySector = new Map();
      hits.slice(0, 400).forEach((c) => { if (!bySector.has(c.sector)) bySector.set(c.sector, []); bySector.get(c.sector).push(c); });
      for (const [sector, list] of bySector) main += '<div class="sub">' + groupIcon(sector) + " " + esc(sector) + '</div><div class="tiles">' + list.map((c) => tileHtml(c, sel)).join("") + "</div>";
    }
  } else {
    const cats = inSector(picker.sector);
    const popular = cats.slice(0, tree.popularPerSector);
    const picked = cats.filter((c) => sel.has(c.name)).length;
    main = '<div class="head"><div><h3>' + groupIcon(picker.sector) + " " + esc(picker.sector) + '</h3><span class="hint">' + cats.length + " types" + (picked ? " · " + picked + " picked" : "") + "</span></div><div>" +
      (picked ? '<button type="button" class="link small" data-act="sector-none">Clear</button> &nbsp;' : "") +
      '<button type="button" class="pill-btn" data-act="sector-all">' + (picked === cats.length ? "✓ All selected" : "Select all " + cats.length) + "</button></div></div>" +
      '<div class="sub">Most popular</div><div class="tiles">' + popular.map((c) => tileHtml(c, sel)).join("") + "</div>";
    if (cats.length > popular.length) {
      if (!picker.showAll) main += '<button type="button" class="showall" data-act="show-all">Show all ' + cats.length + " types in " + esc(picker.sector) + " ›</button>";
      else {
        main += '<div class="sub">All ' + cats.length + ' types, A–Z</div><div class="alllist">' + [...cats].sort((a, b) => a.name.localeCompare(b.name)).map((c) =>
          '<label><input type="checkbox" data-cat="' + esc(c.name) + '"' + (sel.has(c.name) ? " checked" : "") + "> <span>" + esc(c.name) + (c.top100 ? ' <span style="color:#f79009">★</span>' : "") + "</span></label>").join("") + "</div>";
      }
    }
  }

  const chosen = [...sel];
  const foot = chosen.length
    ? chosen.slice(0, 30).map((c) => '<span class="tag">' + esc(c) + ' <button type="button" data-unpick="' + esc(c) + '" aria-label="Remove">×</button></span>').join("") +
      (chosen.length > 30 ? '<span class="muted">+' + (chosen.length - 30) + " more</span>" : "")
    : '<span class="hint">Nothing picked yet. Click a tile to pick it. ★ marks the Top 100 types.</span>';

  const keepScroll = box.querySelector(".main")?.scrollTop || 0, keepSide = box.querySelector(".side")?.scrollTop || 0;
  box.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-label="Choose types of business">' +
    '<div class="modal-head"><div class="title"><h2>Choose types of business</h2><button type="button" class="x" data-act="close-picker" aria-label="Close">×</button></div>' +
    '<div class="searchrow"><div class="searchbox"><input type="text" id="pickerSearch" placeholder="Search ' + total.toLocaleString() + ' types, e.g. roofing, dentist, pizza" value="' + esc(picker.search) + '"></div>' +
    '<button type="button" class="pill-btn" data-act="top100" title="The 100 types most worth targeting: from the sectors you picked from, or all">★ Add Top 100</button></div></div>' +
    '<div class="modal-body"><div class="side">' + side + '</div><div class="main">' + main + "</div></div>" +
    '<div class="modal-foot"><div class="chosen">' + foot + "</div>" +
    (chosen.length ? '<button type="button" class="link small" data-act="clear-what">Clear all</button>' : "") +
    '<button type="button" class="done" data-act="close-picker">Done' + (chosen.length ? " · " + chosen.length + " picked" : "") + "</button></div></div>";
  const m = box.querySelector(".main"); if (m) m.scrollTop = keepScroll;
  const s = box.querySelector(".side"); if (s) s.scrollTop = keepSide;
  const input = $("pickerSearch");
  input.oninput = () => { picker.search = input.value; renderPicker(); const i = $("pickerSearch"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); };
}
function openPicker() { $("catPicker").hidden = false; document.body.style.overflow = "hidden"; renderPicker(); $("pickerSearch") && $("pickerSearch").focus(); }
function closePicker() { $("catPicker").hidden = true; document.body.style.overflow = ""; }
$("whatBtn").onclick = openPicker;
// Click outside the window or press Escape to close.
$("catPicker").addEventListener("mousedown", (e) => { if (e.target === $("catPicker")) closePicker(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("catPicker").hidden) closePicker(); });
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-cat],[data-sector],[data-act],[data-unpick]");
  if (!t || !(t.closest("#catPicker") || t.closest("#whatPicked"))) return;
  const sel = what.selected;
  if (t.dataset.unpick) sel.delete(t.dataset.unpick);
  else if (t.dataset.sector) { picker.sector = t.dataset.sector; picker.search = ""; picker.showAll = false; }
  else if (t.dataset.cat && t.tagName === "BUTTON") sel.has(t.dataset.cat) ? sel.delete(t.dataset.cat) : sel.add(t.dataset.cat);
  else if (t.dataset.cat) t.checked ? sel.add(t.dataset.cat) : sel.delete(t.dataset.cat);
  else switch (t.dataset.act) {
    case "sector-all": inSector(picker.sector).forEach((c) => sel.add(c.name)); break;
    case "sector-none": inSector(picker.sector).forEach((c) => sel.delete(c.name)); break;
    case "show-all": picker.showAll = true; break;
    case "add-hits": { const q = picker.search.trim().toLowerCase(); tree.industries.flatMap((i) => i.categories).filter((c) => wordMatch(c.name, q)).slice(0, 500).forEach((c) => sel.add(c.name)); break; }
    case "top100": {
      const sectors = new Set(tree.industries.filter((i) => i.categories.some((c) => sel.has(c.name))).map((i) => i.industry));
      tree.industries.filter((i) => !sectors.size || sectors.has(i.industry)).forEach((i) => i.categories.filter((c) => c.top100).forEach((c) => sel.add(c.name)));
      break;
    }
    case "clear-what": sel.clear(); break;
    case "close-picker": closePicker(); break;
    default: return;
  }
  renderWhat();
});
// Phone types wanted: picking any switches phone checks on and filters the results to those types.
const phoneTypesWanted = dropdown($("dd-phonetypes"), {
  label: "Phone types wanted", allLabel: "any", search: false,
  options: () => [{ value: "mobile", label: "Mobile" }, { value: "landline", label: "Landline" }, { value: "voip", label: "Internet (VoIP)" }, { value: "toll_free", label: "Toll-free" }],
  onChange: (sel) => { if (sel.size) $("checkPhones").checked = true; $("checkPhones").disabled = sel.size > 0; },
});
function countryLabel(code) { const c = geo.countries.find((x) => x.code === code); return c ? c.name : code; }

async function loadRegions() {
  const countries = [...whereCountry.selected];
  geo.regions = countries.length ? await api("/api/geo/regions?" + countries.map((c) => "country=" + encodeURIComponent(c)).join("&")) : [];
  // Drop picked states that no longer belong to a picked country.
  [...whereRegion.selected].forEach((k) => { if (!geo.regions.some((r) => r.country + "." + r.code === k)) whereRegion.selected.delete(k); });
  whereRegion.refresh();
  await loadCities();
}
async function loadCities() {
  const regions = [...whereRegion.selected], countries = [...whereCountry.selected];
  if (!countries.length) geo.cities = [];
  else {
    const p = new URLSearchParams();
    if (regions.length) regions.forEach((r) => p.append("region", r)); else countries.forEach((c) => p.append("country", c));
    p.set("limit", regions.length ? "2000" : "500");
    geo.cities = await api("/api/geo/cities?" + p);
  }
  cityByKey.clear();
  geo.cities.forEach((c) => cityByKey.set(c.country + "|" + (c.region || "") + "|" + c.name, { country: c.country, region: c.region, city: c.name }));
  [...whereCity.selected].forEach((k) => { if (!cityByKey.has(k)) whereCity.selected.delete(k); });
  whereCity.refresh();
}

/** Cities if any are picked; else states/provinces; else whole countries. */
function locationsFromBuilder() {
  if (whereCity.selected.size) return [...whereCity.selected].map((k) => cityByKey.get(k)).filter(Boolean);
  if (whereRegion.selected.size) return [...whereRegion.selected].map((k) => { const [country, region] = k.split("."); return { country, region }; });
  return [...whereCountry.selected].map((country) => ({ country }));
}

// ---------------------------------------------------------------------------
// Find leads: plan (+ counts) -> (maybe) pull -> show results
// ---------------------------------------------------------------------------
let lastRequest = null;
const BIG = 100000;
$("findBtn").onclick = async () => {
  const req = {
    categories: [...what.selected], locations: locationsFromBuilder(), maxResults: Number($("maxResults").value),
    sourceCode: $("sourceCode").value.trim() || undefined,
    withCounts: $("withCounts").checked, countWebsite: $("countWebsite").value || null, countVerifiedOnly: $("countVerified").checked,
    countWithPhone: $("countPhone").checked,
    checkPhones: $("checkPhones").checked || phoneTypesWanted.selected.size > 0,
  };
  lastPhoneTypes = [...phoneTypesWanted.selected];
  if (!req.categories.length) { $("findMsg").className = "hint err"; $("findMsg").textContent = "Pick at least one type of business."; return; }
  if (!req.locations.length) { $("findMsg").className = "hint err"; $("findMsg").textContent = "Pick at least one country."; return; }
  $("findMsg").className = "hint"; $("findMsg").textContent = req.withCounts ? "Counting and checking what we already have…" : "Checking what we already have…";
  $("findBtn").disabled = true;
  try {
    const plan = await postJson("/api/find", { ...req, mode: "plan" });
    lastRequest = req;
    $("findMsg").textContent = "";
    showPlan(plan);
    // Nothing to pull and no phone checks to pay for: show the results straight away.
    if (!plan.needPull && !req.checkPhones) showResults(plan);
  } catch (err) { $("findMsg").className = "hint err"; $("findMsg").textContent = err.message; }
  finally { $("findBtn").disabled = false; }
};

function where(c) { return c.place ? c.place.label : c.city ? c.city + ", " + c.state : "all of " + c.state; }
function planLabel(plan) {
  const cats = [...new Set(plan.combinations.map((c) => c.category))], locs = [...new Set(plan.combinations.map(where))];
  return (cats.length > 2 ? cats.length + " types" : cats.join(", ")) + " in " + (locs.length > 2 ? locs.length + " places" : locs.join(", "));
}
const num = (n) => Number(n).toLocaleString();
function showPlan(plan) {
  const counted = plan.combinations.some((c) => c.count);
  const req = lastRequest || {};
  const refine = [req.countWebsite === "no" ? "without a website" : req.countWebsite === "yes" ? "with a website" : "",
    req.countWithPhone ? "with a phone" : "", req.countVerifiedOnly ? "verified" : ""].filter(Boolean).join(", ");
  const phones = plan.checkPhones;
  const done = plan.mode !== "plan";
  const rows = plan.combinations.map((c) => {
    const status = c.started ? (c.error ? '<span class="pill bad">failed: ' + esc(c.error) + "</span>" : '<span class="pill warn">pulling now…</span>')
      : c.existing && c.existing.status === "done" && !c.existing.results_count ? '<span class="pill">none on Google here</span> <span class="muted">pulled ' + esc((c.existing.created_at || "").slice(0, 10)) + ": Google has no such businesses in this area</span>"
      : c.existing ? '<span class="pill ok">have it</span> <span class="muted">pulled ' + esc((c.existing.created_at || "").slice(0, 10)) + ", " + num(c.existing.leads_in_database) + " businesses</span>"
      : '<span class="pill">not pulled yet</span>';
    const count = !c.count ? "" : c.count.total == null ? '<span class="muted" title="' + esc(c.count.error || "") + '">unknown</span>' : num(c.count.total);
    const reuse = c.existing && !c.started && plan.mode !== "refresh_all";
    const pull = reuse ? '<span class="muted">free (have it)</span>' : c.pullCost == null ? '<span class="muted">unknown</span>' : money(c.pullCost) +
      (c.expected != null ? ' <span class="muted">(' + num(c.expected) + ")</span>" : "");
    const phone = !phones ? "" : c.phoneCost == null ? '<span class="muted">unknown</span>' : "up to " + money(c.phoneCost) + ' <span class="muted">(' + num(c.phoneChecks) + ")</span>";
    return "<tr><td>" + esc(c.category) + "</td><td>" + esc(where(c)) + "</td>" + (counted ? "<td>" + count + "</td>" : "") + "<td>" + status + "</td><td>" + pull + "</td>" + (phones ? "<td>" + phone + "</td>" : "") + "</tr>";
  }).join("");

  const cost = (total, pull) => total == null ? "" : " (about " + money(total) + (phones && pull != null ? ": " + money(pull) + " pulling + up to " + money(plan.estimatedPhoneCost) + " phone checks" : "") + ")";
  let actions = "";
  if (!done) {
    const unknownCost = plan.estimatedCostMissing == null;
    if (plan.needPull) actions += '<button type="button" id="pullMissing"' + (unknownCost && plan.maxResults === 0 ? " disabled" : "") + ">Pull " + plan.needPull + " missing search" + (plan.needPull > 1 ? "es" : "") +
      (phones ? " + check phones" : "") + cost(plan.estimatedCostMissing, plan.estimatedPullMissing) + "</button>";
    if (plan.alreadyHave) actions += '<button type="button" class="ghost" id="useHave">' + (phones ? "Use only what we have + check phones (up to " + money(plan.estimatedCostExisting) + ")" : "Show only what we have (free)") + "</button>";
    if (plan.alreadyHave) actions += '<button type="button" class="ghost" id="refreshAll">Refresh everything' + cost(plan.estimatedCostAll, plan.estimatedPullAll) + "</button>";
  }
  let notes = "";
  if (plan.totalCount != null) {
    notes += '<div class="' + (plan.totalCount > BIG ? "err" : "hint") + '" style="margin-top:6px">' + (plan.totalCount > BIG
      ? "That's " + num(plan.totalCount) + " businesses" + (refine ? " (" + esc(refine) + ")" : "") + ". Refine your search (fewer places or types, or cities instead of whole countries), or pull it anyway."
      : "Google has about " + num(plan.totalCount) + " businesses" + (refine ? " " + esc(refine) : "") + " for this search.") + "</div>";
  }
  if (!done && (plan.needPull || phones)) {
    notes += '<div class="hint">' + (plan.maxResults ? "Up to " + num(plan.maxResults) + " businesses per search." : "No limit: every business Google has for each search.") +
      " <b>Pulling</b> costs about $5 per 1,000 businesses and is charged for every business the search returns" +
      (refine ? " (the " + esc(refine) + " part only narrows the count and the results, not what's collected)" : "") + "." +
      (phones ? " <b>Phone checks</b> run after the pull, only on verified, open businesses with a phone: up to $2.50 per 1,000 with Telnyx, free while Abstract's free checks last." : "") +
      (plan.countCost ? " Counting cost " + money(plan.countCost) + "." : "") + "</div>";
    if (plan.estimatedCostMissing == null && plan.maxResults === 0) notes += '<div class="err">With no limit, tick "Check how many exist" so the cost can be shown before pulling.</div>';
  }
  $("plan").hidden = false;
  $("plan").innerHTML = "<h2>" + (plan.needPull && !done ? "Some of this needs pulling" : "Here's what we have") +
    '</h2><div class="table-wrap"><table><thead><tr><th>Type of business</th><th>Where</th>' + (counted ? "<th>On Google" + (refine ? " (" + esc(refine) + ")" : "") + "</th>" : "") +
    "<th>Status</th><th>Pulling</th>" + (phones ? "<th>Phone checks</th>" : "") + "</tr></thead><tbody>" + rows + '</tbody></table></div><div class="actions">' + actions + "</div>" + notes;
  if ($("pullMissing")) $("pullMissing").onclick = () => confirmBig(plan.estimatedCostMissing) && runPull("pull_missing");
  if ($("useHave")) $("useHave").onclick = () => (phones ? runPull("use_existing") : showResults(plan));
  if ($("refreshAll")) $("refreshAll").onclick = () => confirmBig(plan.estimatedCostAll) && runPull("refresh_all");
}
let lastPhoneTypes = [];
/** Show a plan's results; if particular phone types were asked for, filter to them. */
function showResults(plan) {
  useScope(plan.searchIds, planLabel(plan));
  if (lastPhoneTypes.length) { f.phoneType.set(lastPhoneTypes); f.phone.set(["yes"]); reload(); }
}
function confirmBig(cost) {
  return cost == null || cost < 25 || confirm("This pull is estimated at " + money(cost) + ". Go ahead?");
}
async function runPull(mode) {
  document.querySelectorAll("#plan button").forEach((b) => b.disabled = true);
  try {
    const result = await postJson("/api/find", { ...lastRequest, withCounts: false, mode });
    showPlan(result);
    await loadPulls();
    showResults(result);
    startPolling();
  } catch (err) { $("findMsg").className = "hint err"; $("findMsg").textContent = err.message; }
}

// ---------------------------------------------------------------------------
// Results scope + filters
// ---------------------------------------------------------------------------
const view = { scope: null, scopeLabel: "", page: 1, sort: "added", dir: "desc", text: {} };
let facets = null, pulls = [];
const f = {}; // filter dropdowns by key

function countOf(rows, value) { const r = (rows || []).find((x) => x.value === value); return r ? r.n : 0; }
function fromFacet(rows, labels) { return (rows || []).filter((r) => r.value != null).map((r) => ({ value: r.value, label: (labels && labels[r.value]) || r.value, n: r.n })); }

function buildFilters() {
  const bar = $("filterbar");
  const groups = [
    ["Location", ["state", "city", "neighborhood", "postal", "distance"]],
    ["Category", ["industry", "category", "exclude", "top100"]],
    ["Business", ["status", "verified", "location", "price", "photos", "attribute"]],
    ["Reputation", ["rating", "reviews", "position"]],
    ["Contact", ["phone", "phoneType", "website", "dedupe"]],
    ["More", ["dates", "leadStatus", "source", "name", "clear"]],
  ];
  bar.innerHTML = groups.map(([g, keys]) => '<div class="fgroup"><span class="glabel">' + g + "</span>" + keys.map((k) => '<div id="f-' + k + '"></div>').join("") + "</div>").join("");
  const multi = (key, label, options, extra) => { f[key] = dropdown($("f-" + key), { label, allLabel: "All", options, onChange: reload, ...(extra || {}) }); };
  const single = (key, label, options, extra) => { f[key] = dropdown($("f-" + key), { label, allLabel: "Any", single: true, search: false, options, onChange: reload, ...(extra || {}) }); };

  multi("state", "State", () => fromFacet(facets && facets.states));
  multi("city", "City", () => (facets ? facets.cities : []).filter((c) => !f.state.selected.size || f.state.selected.has(c.state)).map((c) => ({ value: c.city, label: c.city + (c.state ? ", " + c.state : ""), n: c.n })));
  multi("neighborhood", "Neighborhood", () => fromFacet(facets && facets.neighborhoods));
  multi("postal", "ZIP code", () => fromFacet(facets && facets.postalCodes));
  f.distance = dropdown($("f-distance"), {
    label: "Distance", custom: () => {
      const placesOpts = (facets ? facets.cities : []).map((c) => '<option value="' + esc(c.city + "|" + (c.state || "")) + '"' + (view.text.near === c.city + "|" + (c.state || "") ? " selected" : "") + ">" + esc(c.city + (c.state ? ", " + c.state : "")) + "</option>").join("") +
        (facets ? facets.postalCodes : []).map((p) => '<option value="zip:' + esc(p.value) + '"' + (view.text.near === "zip:" + p.value ? " selected" : "") + ">ZIP " + esc(p.value) + "</option>").join("");
      return '<div class="dates"><span>Within</span><select id="radiusSel"><option value="">any distance</option>' + [1, 5, 10, 25, 50].map((m) => '<option value="' + m + '"' + (String(view.text.radius) === String(m) ? " selected" : "") + ">" + m + " mile" + (m > 1 ? "s" : "") + "</option>").join("") +
        '</select><span>of</span><select id="nearSel"><option value="">choose a place</option>' + placesOpts + '</select></div><div class="hint" style="margin-top:6px">Measured from the middle of the businesses we have in that place.</div>';
    },
    bind: (pop, dd) => { pop.querySelectorAll("select").forEach((s) => s.onchange = () => { view.text.radius = pop.querySelector("#radiusSel").value; view.text.near = pop.querySelector("#nearSel").value; dd.renderChip(); reload(); }); },
    summary: () => view.text.radius && view.text.near ? "Within " + view.text.radius + " mi of " + view.text.near.replace("zip:", "ZIP ").replace("|", ", ") : "Distance: Any",
    isOn: () => !!(view.text.radius && view.text.near),
    options: () => [],
  });

  multi("industry", "Industry", () => fromFacet(facets && facets.industries));
  multi("category", "Category", () => {
    const inds = f.industry.selected;
    return (facets ? facets.categories : []).filter((c) => !inds.size || inds.has(industryOfCategory(c.value))).map((c) => ({ value: c.value, label: c.value, n: c.n, group: industryOfCategory(c.value) }))
      .sort((a, b) => a.group.localeCompare(b.group) || b.n - a.n);
  });
  multi("exclude", "Exclude", () => fromFacet(facets && facets.categories), { allLabel: "none" });
  single("top100", "Top 100", () => [{ value: "", label: "All categories" }, { value: "1", label: "Top 100 categories only" }], { allLabel: "off" });

  multi("status", "Status", () => Object.keys(STATUS_LABELS).map((v) => ({ value: v, label: STATUS_LABELS[v], n: countOf(facets && facets.statuses, v) })), { selected: new Set(["operational"]) });
  multi("verified", "Verification", () => [{ value: "verified", label: "Verified", n: countOf(facets && facets.verified, "verified") }, { value: "unverified", label: "Not verified", n: countOf(facets && facets.verified, "unverified") }], { selected: new Set(["verified"]) });
  multi("location", "Location type", () => [{ value: "storefront", label: "Physical location (street address)", n: countOf(facets && facets.location, "storefront") }, { value: "service_area", label: "Service area only", n: countOf(facets && facets.location, "service_area") }]);
  multi("price", "Price", () => ["$", "$$", "$$$", "$$$$"].map((v) => ({ value: v, label: v, n: countOf(facets && facets.prices, v) })));
  single("photos", "Photos", () => [{ value: "", label: "Any" }, ...[1, 10, 25, 50, 100].map((n) => ({ value: String(n), label: n + "+ photos" }))]);
  multi("attribute", "Profile features", () => fromFacet(facets && facets.attributes), { allLabel: "Any" });

  single("rating", "Rating", () => [{ value: "", label: "Any rating" },
    ...["4.5", "4.0", "3.5", "3.0", "2.5", "2.0"].map((v) => ({ value: "min:" + v, label: v + " and up" })),
    ...["4.0", "3.5", "3.0", "2.5", "2.0", "1.5"].map((v) => ({ value: "max:" + v, label: v + " and below" }))]);
  multi("reviews", "Reviews", () => Object.keys(REVIEW_LABELS).map((k) => ({ value: k, label: REVIEW_LABELS[k], n: countOf(facets && facets.reviewBuckets, k) })));
  single("position", "Position", () => [{ value: "", label: "Any position" },
    ...[3, 10, 20, 50].map((n) => ({ value: "rank:" + n, label: n === 3 ? "Top 3 (map pack)" : "Top " + n })),
    ...[1, 5, 10, 25].map((n) => ({ value: "pct:" + n, label: "Top " + n + "% of results" }))]);

  single("phone", "Phone", () => [{ value: "", label: "All" }, { value: "yes", label: "With a phone number" }, { value: "no", label: "Without a phone number" }]);
  multi("phoneType", "Phone type", () => ["mobile", "landline", "toll_free", "voip", "unknown", "unchecked"].map((v) => ({ value: v, label: PHONE_LABELS[v], n: countOf(facets && facets.phoneTypes, v) })));
  single("website", "Website", () => [{ value: "", label: "All" }, { value: "yes", label: "With a website" }, { value: "no", label: "Without a website" }]);
  multi("dedupe", "Remove duplicates", () => [{ value: "website", label: "One business per website" }, { value: "phone", label: "One business per phone number" }, { value: "listing", label: "One per Google listing" }], { allLabel: "off", search: false });

  f.dates = dropdown($("f-dates"), {
    label: "Dates", options: () => [],
    custom: () => '<div class="dates"><span>Added from</span><input type="date" id="dAddedFrom" value="' + esc(view.text.addedFrom || "") + '"><span>Added to</span><input type="date" id="dAddedTo" value="' + esc(view.text.addedTo || "") + '">' +
      '<span>Updated from</span><input type="date" id="dUpdatedFrom" value="' + esc(view.text.updatedFrom || "") + '"><span>Updated to</span><input type="date" id="dUpdatedTo" value="' + esc(view.text.updatedTo || "") + '"></div>',
    bind: (pop, dd) => { pop.querySelectorAll("input").forEach((i) => i.onchange = () => {
      view.text.addedFrom = pop.querySelector("#dAddedFrom").value; view.text.addedTo = pop.querySelector("#dAddedTo").value;
      view.text.updatedFrom = pop.querySelector("#dUpdatedFrom").value; view.text.updatedTo = pop.querySelector("#dUpdatedTo").value;
      dd.renderChip(); reload(); }); },
    summary: () => { const n = ["addedFrom", "addedTo", "updatedFrom", "updatedTo"].filter((k) => view.text[k]).length; return "Dates: " + (n ? n + " set" : "Any"); },
    isOn: () => ["addedFrom", "addedTo", "updatedFrom", "updatedTo"].some((k) => view.text[k]),
  });
  multi("leadStatus", "Lead status", () => fromFacet(facets && facets.leadStatuses));
  multi("source", "Source code", () => fromFacet(facets && facets.sourceCodes));
  $("f-name").innerHTML = '<input type="text" id="nameSearch" placeholder="Business name contains…" style="border-radius:99px;padding:4px 11px">';
  let typing; $("nameSearch").oninput = () => { clearTimeout(typing); typing = setTimeout(() => { view.text.q = $("nameSearch").value.trim(); reload(); }, 300); };
  $("f-clear").innerHTML = '<button type="button" class="link" id="clearFilters">Clear filters</button>';
  $("clearFilters").onclick = () => {
    Object.values(f).forEach((d) => d.selected.clear());
    view.text = {}; $("nameSearch").value = "";
    Object.values(f).forEach((d) => d.renderChip());
    reload();
  };
}
function industryOfCategory(cat) {
  if (!tree) return "Other";
  for (const i of tree.industries) if (i.categories.some((c) => c.name.toLowerCase() === cat.toLowerCase())) return i.industry;
  return "Other";
}

function query() {
  const p = new URLSearchParams({ page: view.page, sort: view.sort, dir: view.dir });
  if (view.scope) view.scope.forEach((id) => p.append("search_id", id));
  const add = (key, dd) => dd.selected.forEach((v) => p.append(key, v));
  add("state", f.state); add("city", f.city); add("neighborhood", f.neighborhood); add("postal_code", f.postal);
  add("industry", f.industry); add("category", f.category); add("exclude_category", f.exclude);
  add("status", f.status); add("verified", f.verified); add("location", f.location); add("price", f.price); add("attribute", f.attribute);
  add("reviews", f.reviews); add("phone_type", f.phoneType); add("lead_status", f.leadStatus); add("source_code", f.source);
  const one = (dd) => [...dd.selected][0] || "";
  if (one(f.top100)) p.set("top100", "1");
  if (one(f.photos)) p.set("min_photos", one(f.photos));
  const rating = one(f.rating); if (rating) p.set(rating.startsWith("min:") ? "min_rating" : "max_rating", rating.slice(4));
  const pos = one(f.position); if (pos) p.set(pos.startsWith("rank:") ? "max_rank" : "top_pct", pos.split(":")[1]);
  if (one(f.phone)) p.set("phone", one(f.phone));
  if (one(f.website)) p.set("website", one(f.website));
  f.dedupe.selected.forEach((v) => p.set("dedupe_" + v, "1"));
  if (view.text.radius && view.text.near) { p.set("radius_miles", view.text.radius); p.set("near", view.text.near); }
  const map = { q: "q", addedFrom: "added_from", addedTo: "added_to", updatedFrom: "updated_from", updatedTo: "updated_to" };
  for (const [k, key] of Object.entries(map)) if (view.text[k]) p.set(key, view.text[k]);
  return p;
}

function useScope(searchIds, label) {
  view.scope = searchIds && searchIds.length ? searchIds : null;
  view.scopeLabel = label || "";
  view.page = 1;
  $("emptyState").hidden = true; $("resultsBody").hidden = false; $("filtersCard").hidden = false;
  refreshAll();
}
async function refreshAll() { await loadFacets(); await loadLeads(); }
function reload() { view.page = 1; loadLeads(); }

async function loadFacets() {
  const p = new URLSearchParams();
  if (view.scope) view.scope.forEach((id) => p.append("search_id", id));
  facets = await api("/api/leads/facets?" + p);
  Object.values(f).forEach((d) => d.refresh());
}

async function loadLeads() {
  if ($("resultsBody").hidden) return;
  const data = await api("/api/leads?" + query());
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  $("count").textContent = data.total.toLocaleString() + " business" + (data.total === 1 ? "" : "es");
  $("dupInfo").textContent = data.duplicatesHidden ? "(" + data.duplicatesHidden + " duplicate" + (data.duplicatesHidden === 1 ? "" : "s") + " hidden)" : "";
  const running = view.scope ? pulls.filter((p) => view.scope.includes(p.id) && ["pending", "scraping", "ingesting"].includes(p.status)).length : 0;
  $("scopeInfo").innerHTML = (view.scope ? '<span class="pill">' + esc(view.scopeLabel || view.scope.length + " pulls") + '</span> <button type="button" class="link small" id="clearScope">show everything we have</button>' : '<span class="pill">everything collected</span>') +
    (running ? ' <span class="pill warn">' + running + " still collecting…</span>" : "") +
    (phoneStatus ? ' <span class="pill ' + (phoneStatus.startsWith("Phone checks paused") ? "bad" : "warn") + '">' + esc(phoneStatus) + "</span>" : "") +
    (data.nearNotFound ? ' <span class="pill bad">no businesses with a map position in that place yet</span>' : "");
  if ($("clearScope")) $("clearScope").onclick = () => useScope(null, "");
  $("pageInfo").textContent = "Page " + data.page + " of " + pages;
  $("prevBtn").disabled = data.page <= 1; $("nextBtn").disabled = data.page >= pages;
  $("rows").innerHTML = data.results.length ? data.results.map((l) => {
    const type = l.phone_type || (l.gbp_phone_formatted ? "unchecked" : "");
    const site = l.website ? '<a href="' + esc(l.website) + '" target="_blank" rel="noopener">' + esc(l.website_domain || l.website.replace(/^https?:\\/\\/(www\\.)?/, "").split(/[/?#]/)[0]) + "</a>" : '<span class="muted">None</span>';
    const name = l.gbp_url ? '<a href="' + esc(l.gbp_url) + '" target="_blank" rel="noopener">' + esc(l.business_name) + "</a>" : esc(l.business_name);
    const verified = l.is_claimed === 0 ? '<span class="pill bad">Not verified</span>' : '<span class="pill ok">Verified</span>';
    const status = l.business_status === "operational" ? '<span class="pill ok">Open</span>'
      : '<span class="pill ' + (l.business_status === "permanently_closed" ? "bad" : "warn") + '">' + esc(STATUS_LABELS[l.business_status] || l.business_status) + "</span>";
    const loc = l.has_street_address === 0 ? "Service area" : l.has_street_address === 1 ? "Physical" : "";
    return "<tr><td class=name>" + name + "</td><td>" + esc(l.gbp_category) + "</td><td>" + esc(l.gbp_phone_raw) +
      '</td><td class="type-' + esc(type) + '">' + esc(PHONE_LABELS[type] || "") + (l.phone_carrier ? ' <span class="muted">' + esc(l.phone_carrier) + "</span>" : "") +
      "</td><td>" + site + "</td><td>" + esc(l.rating ?? "") + "</td><td>" + esc(l.review_count ?? "") + "</td><td>" + esc(l.gbp_rank ?? "") +
      "</td><td>" + verified + "</td><td>" + status + "</td><td>" + esc(loc) + "</td><td>" + esc(l.city) + "</td><td>" + esc(l.state) +
      "</td><td>" + esc(l.neighborhood) + "</td><td>" + esc(l.lead_date) + "</td></tr>";
  }).join("") : '<tr><td colspan="15" class="empty-state">' + (running ? "Still collecting. Results appear here as they arrive." : "No businesses match these filters.") + "</td></tr>";
}

document.querySelectorAll("th[data-sort]").forEach((th) => th.onclick = () => {
  if (view.sort === th.dataset.sort) view.dir = view.dir === "asc" ? "desc" : "asc";
  else { view.sort = th.dataset.sort; view.dir = ["name", "city", "category", "rank"].includes(th.dataset.sort) ? "asc" : "desc"; }
  document.querySelectorAll("th").forEach((h) => h.classList.remove("sorted", "asc"));
  th.classList.add("sorted"); if (view.dir === "asc") th.classList.add("asc");
  loadLeads();
});
$("prevBtn").onclick = () => { view.page--; loadLeads(); };
$("nextBtn").onclick = () => { view.page++; loadLeads(); };
// Every business matching the current filters (all pages), in the GHL upload format.
$("downloadBtn").onclick = () => {
  const p = query();
  ["page", "sort", "dir"].forEach((k) => p.delete(k));
  window.location.href = "/api/export?" + p;
};

// ---------------------------------------------------------------------------
// Pulls: polling + history
// ---------------------------------------------------------------------------
let polling = null;
async function loadPulls() { pulls = await api("/api/searches?limit=500"); return pulls; }
let pollBusy = false, phoneStatus = "";
async function pollActive() {
  if (pollBusy) return; // a slow step (e.g. phone checks) is still running
  pollBusy = true;
  try {
    await loadPulls();
    const active = pulls.filter((s) => ["pending", "scraping", "ingesting"].includes(s.status));
    await Promise.all(active.map((s) => api("/api/searches/" + s.id + "/sync", { method: "POST" }).catch(() => {})));
    await loadPulls();
    const stillPulling = pulls.some((s) => ["pending", "scraping", "ingesting"].includes(s.status));
    // Phone types for pulls that asked for them (online, the minute timer also does this).
    const pc = await postJson("/api/phones/check?limit=10", {}).catch(() => null);
    const phonesPending = !!pc && pc.pending > 0 && (pc.checked > 0 || stillPulling);
    phoneStatus = !pc || !pc.pending ? "" : pc.checked || stillPulling ? "Checking phone types: " + pc.pending + " to go"
      : "Phone checks paused: " + ((pc.refused || []).map((r) => r.split(":")[0]).join(", ") || "no phone-check service set up");
    if (!stillPulling && !phonesPending && polling) { clearInterval(polling); polling = null; }
    if (lastRequest && !$("plan").hidden) {
      const plan = await postJson("/api/find", { ...lastRequest, mode: "plan" }).catch(() => null);
      if (plan) { plan.mode = "done"; showPlan(plan); }
    }
    if (!$("resultsBody").hidden) await refreshAll();
    if (!$("historyView").hidden) loadHistory();
  } finally { pollBusy = false; }
}
function startPolling() { if (!polling) polling = setInterval(pollActive, 5000); }

function historyQuery() {
  const p = new URLSearchParams();
  const map = { hCategory: "category", hCity: "city", hState: "state", hStatus: "status", hFrom: "from", hTo: "to" };
  for (const [id, key] of Object.entries(map)) if ($(id).value.trim()) p.set(key, $(id).value.trim());
  return p;
}
const historySelection = new Set();
async function loadHistory() {
  const rows = await api("/api/searches?" + historyQuery());
  $("historyRows").innerHTML = rows.length ? rows.map((s) =>
    '<tr><td><input type="checkbox" data-pick="' + esc(s.id) + '"' + (historySelection.has(s.id) ? " checked" : "") + "></td>" +
    "<td>" + esc((s.created_at || "").slice(0, 16)) + "</td><td>" + esc(s.category) + "</td><td>" + (s.city ? esc(s.city) + ", " : "all of ") + esc(s.state || "") +
    "</td><td>" + esc(s.apify_actor_id === "dataforseo-test" ? "DataForSEO (test)" : "Google Maps (Apify)") +
    '</td><td><span class="pill ' + (s.status === "done" ? "ok" : s.status === "failed" ? "bad" : "warn") + '" title="' + esc(s.error || "") + '">' + esc(PULL_LABELS[s.status] || s.status) + "</span>" +
    "</td><td>" + (s.status === "done" && !s.results_count ? '<span class="muted" title="Google has no such businesses in this area">0 (none on Google)</span>' : esc(s.results_count ?? "")) +
    "</td><td>" + esc(s.new_leads_count ?? "") + "</td><td>" + esc(s.leads_in_database) +
    "</td><td>" + money(s.cost_estimate) + "</td><td>" + esc(s.source_code) +
    '</td><td><button class="ghost small" type="button" data-view="' + esc(s.id) + '">View businesses</button></td></tr>').join("")
    : '<tr><td colspan="12" class="empty-state">No pulls match.</td></tr>';
}
$("historyRows").onclick = (e) => {
  const v = e.target.closest("[data-view]");
  if (v) { const p = pulls.find((x) => x.id === v.dataset.view); showPulls([v.dataset.view], p ? p.category + " in " + (p.city ? p.city + ", " : "all of ") + p.state : ""); return; }
  const pick = e.target.closest("[data-pick]");
  if (pick) { pick.checked ? historySelection.add(pick.dataset.pick) : historySelection.delete(pick.dataset.pick); $("hViewSelected").disabled = !historySelection.size; }
};
$("hViewSelected").onclick = () => showPulls([...historySelection], historySelection.size + " pulls");
let hTyping;
["hCategory", "hCity", "hState"].forEach((id) => $(id).oninput = () => { clearTimeout(hTyping); hTyping = setTimeout(loadHistory, 300); });
["hStatus", "hFrom", "hTo"].forEach((id) => $(id).onchange = loadHistory);
function showPulls(ids, label) {
  setTab("find");
  // Show everything from those pulls, including unverified/closed, until the user narrows it.
  f.verified.set([]); f.status.set([]);
  useScope(ids, label);
}

// "Find leads" and "Database" share the results table but keep their own filters and scope.
let currentTab = "find";
const tabState = { find: null, database: null };
function snapshot() {
  return {
    sel: Object.fromEntries(Object.entries(f).map(([k, d]) => [k, [...d.selected]])),
    text: { ...view.text }, scope: view.scope, label: view.scopeLabel, shown: !$("resultsBody").hidden,
  };
}
function restore(s) {
  Object.entries(f).forEach(([k, d]) => { d.selected = new Set(s.sel[k] || []); d.renderChip(); });
  view.text = { ...s.text }; $("nameSearch").value = view.text.q || "";
  view.scope = s.scope; view.scopeLabel = s.label;
}
function setTab(tab) {
  if (currentTab === "find" || currentTab === "database") tabState[currentTab] = snapshot();
  currentTab = tab;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  $("findView").hidden = tab === "history" || tab === "team";
  $("historyView").hidden = tab !== "history";
  $("teamView").hidden = tab !== "team";
  if (tab === "history") { loadHistory(); return; }
  if (tab === "team") { loadTeam(); return; }
  $("builderCard").hidden = tab === "database";
  $("plan").hidden = tab === "database" || !lastRequest;
  const saved = tabState[tab] || defaultFilters;
  restore(saved);
  if (tab === "database") useScope(null, "");
  else if (saved.shown) useScope(saved.scope, saved.label);
  else { $("emptyState").hidden = false; $("resultsBody").hidden = true; $("filtersCard").hidden = true; }
}
document.querySelectorAll(".tab").forEach((t) => t.onclick = () => setTab(t.dataset.tab));
let defaultFilters = null;

// ---------------------------------------------------------------------------
// Signed-in user + Team (admins)
// ---------------------------------------------------------------------------
let me = null;
async function loadMe() {
  me = await api("/api/me");
  $("me").innerHTML = "<span>" + esc(me.name || "Account") + (me.role === "admin" ? ' <span class="pill">admin</span>' : "") + "</span>" +
    '<button type="button" class="link small" id="changePw">Change password</button><button type="button" class="link small" id="signOut">Sign out</button>';
  $("teamTab").hidden = me.role !== "admin";
  $("signOut").onclick = async () => { await postJson("/api/auth/logout", {}).catch(() => {}); location.href = "/login"; };
  $("changePw").onclick = async () => {
    const current = prompt("Your current password:"); if (!current) return;
    const next = prompt("New password (at least 10 characters):"); if (!next) return;
    try { await postJson("/api/me/password", { current, next }); alert("Password changed."); } catch (err) { alert(err.message); }
  };
}
function tempPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => chars[b % chars.length]).join("");
}
async function loadTeam() {
  if (!$("tPassword").value) $("tPassword").value = tempPassword();
  const users = await api("/api/admin/users");
  $("teamRows").innerHTML = users.map((u) => "<tr><td>" + esc(u.name || "") + "</td><td>" + esc(u.email) + "</td><td>" + (u.role === "admin" ? "Admin" : "Member") +
    "</td><td>" + (u.active ? '<span class="pill ok">Active</span>' : '<span class="pill bad">Switched off</span>') + (u.must_change_password ? ' <span class="pill warn">temporary password</span>' : "") +
    "</td><td>" + esc(u.last_login_at ? u.last_login_at.slice(0, 16) : "never") + "</td><td>" +
    (u.id === me.id ? '<span class="muted">you</span>' :
      '<button type="button" class="ghost small" data-uact="reset" data-uid="' + esc(u.id) + '">Reset password</button> ' +
      '<button type="button" class="ghost small" data-uact="' + (u.active ? "off" : "on") + '" data-uid="' + esc(u.id) + '">' + (u.active ? "Switch off" : "Switch on") + "</button> " +
      '<button type="button" class="ghost small" data-uact="' + (u.role === "admin" ? "member" : "admin") + '" data-uid="' + esc(u.id) + '">' + (u.role === "admin" ? "Make member" : "Make admin") + "</button>") +
    "</td></tr>").join("");
}
$("tAdd").onclick = async () => {
  $("tMsg").className = "hint"; $("tMsg").textContent = "Adding…";
  try {
    const email = $("tEmail").value.trim(), password = $("tPassword").value;
    await postJson("/api/admin/users", { email, name: $("tName").value.trim(), password, role: $("tRole").value });
    $("tMsg").textContent = "Added " + ($("tName").value.trim() || "them") + ". Temporary password: " + password;
    $("tEmail").value = ""; $("tName").value = ""; $("tPassword").value = tempPassword();
    loadTeam();
  } catch (err) { $("tMsg").className = "hint err"; $("tMsg").textContent = err.message; }
};
$("teamRows").onclick = async (e) => {
  const b = e.target.closest("[data-uact]"); if (!b) return;
  const id = b.dataset.uid, act = b.dataset.uact;
  let changes;
  if (act === "reset") {
    const pw = tempPassword();
    if (!confirm("Give this person the new temporary password " + pw + " ? They'll be signed out and asked to choose their own.")) return;
    changes = { password: pw };
  } else if (act === "off" || act === "on") changes = { active: act === "on" };
  else changes = { role: act };
  try {
    await api("/api/admin/users/" + id, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(changes) });
    if (changes.password) alert("New temporary password: " + changes.password);
    loadTeam();
  } catch (err) { alert(err.message); }
};

(async () => {
  buildFilters();
  defaultFilters = { ...snapshot(), shown: false, scope: null, label: "" };
  try {
    await loadMe();
    const [countries, categories] = await Promise.all([api("/api/geo/countries"), api("/api/categories")]);
    geo.countries = countries; tree = categories;
    whereCountry.refresh(); what.refresh();
    await loadPulls();
    if (pulls.some((s) => ["pending", "scraping", "ingesting"].includes(s.status))) startPolling();
  } catch (err) { $("findMsg").className = "hint err"; $("findMsg").textContent = err.message; }
})();
</script>
</body>
</html>`;
