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
  .builder { display: grid; grid-template-columns: auto 1fr; gap: 10px 14px; align-items: center; }
  .builder > .lbl { font-weight: 600; font-size: 13px; }
  .line { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; border: 1px solid var(--line-strong); border-radius: 6px; padding: 4px 6px; min-width: 260px; background: #fff; }
  .tags input { border: none; outline: none; padding: 3px; min-width: 160px; flex: 1; }
  .tag { background: var(--accent-soft); color: var(--accent); border-radius: 99px; padding: 2px 4px 2px 9px; font-size: 12px; display: inline-flex; gap: 4px; align-items: center; }
  .tag button { background: none; border: none; color: inherit; padding: 0 4px; cursor: pointer; font-size: 13px; line-height: 1; }

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
    <button class="tab" data-tab="history" type="button">Pull history</button>
  </div>
</header>

<main id="findView">
  <section class="card">
    <div class="builder">
      <div class="lbl">Where</div>
      <div class="line">
        <span class="muted">United States ·</span>
        <div class="dd" id="dd-where-state"></div>
        <div class="tags" id="cityTags"><input id="cityInput" list="cityOptions" placeholder="Add a city, e.g. Orlando, FL, then press Enter" autocomplete="off"></div>
        <datalist id="cityOptions"></datalist>
      </div>
      <div class="lbl">What</div>
      <div class="line">
        <div class="dd" id="dd-what"></div>
        <button class="ghost small" id="top100Btn" type="button">+ Top 100 in chosen industries</button>
      </div>
      <div class="lbl">Options</div>
      <div class="line">
        <label class="muted">Up to <select id="maxResults"><option>50</option><option selected>100</option><option>200</option><option>500</option></select> businesses per search</label>
        <label class="muted">Source code <input type="text" id="sourceCode" placeholder="ILS" style="width:80px"></label>
        <button id="findBtn" type="button">Find leads</button>
        <span id="findMsg" class="hint"></span>
      </div>
    </div>
    <div class="hint" style="margin-top:8px">Cities are optional: with no cities, each chosen state is searched as a whole. We reuse anything pulled in the last 30 days and only pull what's missing.</div>
  </section>

  <section class="card plan" id="plan" hidden></section>

  <section class="card" id="filtersCard" hidden>
    <div class="filterbar" id="filterbar"></div>
  </section>

  <section class="card results" id="resultsCard">
    <div class="empty-state" id="emptyState">
      <strong>Nothing to show yet</strong>
      Choose where and what above, then click <b>Find leads</b>.<br>
      <button class="link" id="showAll" type="button" style="margin-top:10px">Or browse everything you've already collected</button>
    </div>
    <div id="resultsBody" hidden>
      <div class="bar">
        <div class="scope"><strong id="count"></strong> <span id="dupInfo" class="muted"></span> <span id="scopeInfo"></span></div>
        <div>
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

<script>
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (v) => "$" + Number(v || 0).toFixed(2);
async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
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
// Search builder (where + what)
// ---------------------------------------------------------------------------
let places = { states: [], knownCities: [] }, tree = null;
const cities = []; // { city, state }

const whereState = dropdown($("dd-where-state"), {
  label: "States", allLabel: "none chosen",
  options: () => places.states.map((s) => ({ value: s.code, label: s.name + " (" + s.code + ")" })),
  onChange: () => fillCityOptions(),
});
const what = dropdown($("dd-what"), {
  label: "Types of business", allLabel: "none chosen", emptyText: "Loading categories…",
  options: () => tree ? tree.industries.flatMap((i) => i.categories.map((c) => ({ value: c.name, label: c.name + (c.top100 ? " ★" : ""), group: i.industry, n: c.n || null }))) : [],
});

function fillCityOptions() {
  const states = whereState.selected;
  $("cityOptions").innerHTML = places.knownCities.filter((c) => !states.size || states.has(c.state))
    .map((c) => '<option value="' + esc(c.city + ", " + c.state) + '">').join("");
}
function renderCityTags() {
  $("cityTags").querySelectorAll(".tag").forEach((t) => t.remove());
  cities.forEach((c, i) => {
    const t = document.createElement("span");
    t.className = "tag";
    t.innerHTML = esc(c.city + ", " + c.state) + ' <button type="button" aria-label="Remove">×</button>';
    t.querySelector("button").onclick = () => { cities.splice(i, 1); renderCityTags(); };
    $("cityTags").insertBefore(t, $("cityInput"));
  });
}
function addCity(text) {
  const m = text.trim().match(/^(.+?)[,\\s]+([A-Za-z]{2})$/);
  const onlyState = whereState.selected.size === 1 ? [...whereState.selected][0] : null;
  const city = m ? m[1].trim() : text.trim();
  const state = m ? m[2].toUpperCase() : onlyState;
  if (!city) return;
  if (!state || !places.states.some((s) => s.code === state)) { $("findMsg").className = "hint err"; $("findMsg").textContent = 'Add the state too, e.g. "' + city + ', FL".'; return; }
  if (!cities.some((c) => c.city.toLowerCase() === city.toLowerCase() && c.state === state)) cities.push({ city, state });
  $("findMsg").textContent = ""; $("cityInput").value = ""; renderCityTags();
}
$("cityInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addCity($("cityInput").value); }
  if (e.key === "Backspace" && !$("cityInput").value && cities.length) { cities.pop(); renderCityTags(); }
});
$("cityInput").addEventListener("change", () => { if ($("cityInput").value.includes(",")) addCity($("cityInput").value); });
$("top100Btn").onclick = () => {
  if (!tree) return;
  const inds = new Set(what.cfg.options().filter((o) => what.selected.has(o.value)).map((o) => o.group));
  tree.industries.filter((i) => !inds.size || inds.has(i.industry)).forEach((i) => i.categories.filter((c) => c.top100).forEach((c) => what.selected.add(c.name)));
  what.refresh();
};

function locationsFromBuilder() {
  if (cities.length) return cities.map((c) => ({ city: c.city, state: c.state }));
  return [...whereState.selected].map((s) => ({ state: s }));
}

// ---------------------------------------------------------------------------
// Find leads: plan -> (maybe) pull -> show results
// ---------------------------------------------------------------------------
let lastRequest = null;
$("findBtn").onclick = async () => {
  if ($("cityInput").value.trim()) addCity($("cityInput").value);
  const req = { categories: [...what.selected], locations: locationsFromBuilder(), maxResults: Number($("maxResults").value), sourceCode: $("sourceCode").value.trim() || undefined };
  $("findMsg").className = "hint"; $("findMsg").textContent = "Checking what we already have…";
  try {
    const plan = await postJson("/api/find", { ...req, mode: "plan" });
    lastRequest = req;
    $("findMsg").textContent = "";
    showPlan(plan);
    if (!plan.needPull) useScope(plan.searchIds, planLabel(plan));
  } catch (err) { $("findMsg").className = "hint err"; $("findMsg").textContent = err.message; }
};

function where(c) { return c.city ? c.city + ", " + c.state : "all of " + c.state; }
function planLabel(plan) {
  const cats = [...new Set(plan.combinations.map((c) => c.category))], locs = [...new Set(plan.combinations.map(where))];
  return (cats.length > 2 ? cats.length + " types" : cats.join(", ")) + " in " + (locs.length > 2 ? locs.length + " places" : locs.join(", "));
}
function showPlan(plan) {
  const rows = plan.combinations.map((c) => {
    const status = c.started ? (c.error ? '<span class="pill bad">failed: ' + esc(c.error) + "</span>" : '<span class="pill warn">pulling now…</span>')
      : c.existing ? '<span class="pill ok">have it</span> <span class="muted">pulled ' + esc((c.existing.created_at || "").slice(0, 10)) + ", " + c.existing.leads_in_database + " businesses</span>"
      : '<span class="pill">not pulled yet</span>';
    return "<tr><td>" + esc(c.category) + "</td><td>" + esc(where(c)) + "</td><td>" + status + "</td></tr>";
  }).join("");
  let actions = "";
  if (plan.mode === "plan") {
    if (plan.needPull) actions += '<button type="button" id="pullMissing">Pull ' + plan.needPull + " missing search" + (plan.needPull > 1 ? "es" : "") + " (about " + money(plan.estimatedCostMissing) + ")</button>";
    if (plan.alreadyHave) actions += '<button type="button" class="ghost" id="useHave">Show only what we have (free)</button>';
    if (plan.alreadyHave) actions += '<button type="button" class="ghost" id="refreshAll">Refresh everything (about ' + money(plan.estimatedCostAll) + ")</button>";
  }
  $("plan").hidden = false;
  $("plan").innerHTML = "<h2>" + (plan.needPull && plan.mode === "plan" ? "Some of this needs pulling" : "Here's what we have") + '</h2><div class="table-wrap"><table><thead><tr><th>Type of business</th><th>Where</th><th>Status</th></tr></thead><tbody>' +
    rows + '</tbody></table></div><div class="actions">' + actions + "</div>" +
    (plan.mode === "plan" && plan.needPull ? '<div class="hint">Up to ' + plan.maxResults + " businesses per search. Costs are estimates from the scraper's price.</div>" : "");
  if ($("pullMissing")) $("pullMissing").onclick = () => runPull("pull_missing");
  if ($("useHave")) $("useHave").onclick = () => useScope(plan.searchIds, planLabel(plan));
  if ($("refreshAll")) $("refreshAll").onclick = () => runPull("refresh_all");
}
async function runPull(mode) {
  document.querySelectorAll("#plan button").forEach((b) => b.disabled = true);
  try {
    const result = await postJson("/api/find", { ...lastRequest, mode });
    showPlan(result);
    await loadPulls();
    useScope(result.searchIds, planLabel(result));
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
$("showAll").onclick = () => useScope(null, "");

// ---------------------------------------------------------------------------
// Pulls: polling + history
// ---------------------------------------------------------------------------
let polling = null;
async function loadPulls() { pulls = await api("/api/searches?limit=500"); return pulls; }
async function pollActive() {
  await loadPulls();
  const active = pulls.filter((s) => ["pending", "scraping", "ingesting"].includes(s.status));
  await Promise.all(active.map((s) => api("/api/searches/" + s.id + "/sync", { method: "POST" }).catch(() => {})));
  await loadPulls();
  if (!pulls.some((s) => ["pending", "scraping", "ingesting"].includes(s.status)) && polling) { clearInterval(polling); polling = null; }
  if (lastRequest && !$("plan").hidden) {
    const plan = await postJson("/api/find", { ...lastRequest, mode: "plan" }).catch(() => null);
    if (plan) { plan.mode = "done"; showPlan(plan); }
  }
  if (!$("resultsBody").hidden) await refreshAll();
  if (!$("historyView").hidden) loadHistory();
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
    "</td><td>" + esc(s.results_count ?? "") + "</td><td>" + esc(s.new_leads_count ?? "") + "</td><td>" + esc(s.leads_in_database) +
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
  // Show everything from those pulls, including unverified/closed, until the user narrows it.
  f.verified.set([]); f.status.set([]);
  setTab("find"); useScope(ids, label);
}

function setTab(tab) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  $("findView").hidden = tab !== "find";
  $("historyView").hidden = tab !== "history";
  if (tab === "history") loadHistory();
}
document.querySelectorAll(".tab").forEach((t) => t.onclick = () => setTab(t.dataset.tab));

(async () => {
  buildFilters();
  try {
    [places, tree] = await Promise.all([api("/api/places"), api("/api/categories")]);
    whereState.refresh(); what.refresh(); fillCityOptions();
    await loadPulls();
    if (pulls.some((s) => ["pending", "scraping", "ingesting"].includes(s.status))) startPolling();
  } catch (err) { $("findMsg").className = "hint err"; $("findMsg").textContent = err.message; }
})();
</script>
</body>
</html>`;
