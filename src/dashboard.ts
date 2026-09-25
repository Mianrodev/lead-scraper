// Single-page dashboard served at "/". Plain HTML + JS, no build step.

export const dashboardHtml = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lead Finder</title>
<style>
  :root {
    --bg: #f6f7f9; --panel: #fff; --text: #1d2330; --muted: #667085; --line: #e4e7ec;
    --accent: #2563eb; --accent-soft: #eff4ff; --ok: #067647; --ok-soft: #ecfdf3; --warn: #b54708; --warn-soft: #fffaeb;
    --bad: #b42318; --bad-soft: #fef3f2;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
  header { background: var(--panel); border-bottom: 1px solid var(--line); padding: 14px 20px 0; }
  h1 { font-size: 18px; margin: 0 0 10px; }
  form.search { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; }
  label.field { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--muted); }
  input, select, button { font: inherit; }
  input[type=text], input[type=number], input[type=date], select { padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; background: #fff; color: var(--text); }
  button { padding: 7px 14px; border-radius: 6px; border: 1px solid var(--accent); background: var(--accent); color: #fff; cursor: pointer; }
  button.ghost { background: #fff; color: var(--text); border-color: var(--line); }
  button.small { padding: 3px 9px; font-size: 12px; }
  button:disabled { opacity: .5; cursor: default; }
  #msg { font-size: 13px; } #msg.err { color: var(--bad); }
  .repeat { margin-top: 10px; background: var(--warn-soft); border: 1px solid #fedf89; border-radius: 8px; padding: 10px 12px; color: var(--warn); }
  .repeat .actions { margin-top: 8px; display: flex; gap: 8px; flex-wrap: wrap; }
  .tabs { display: flex; gap: 4px; margin-top: 12px; }
  .tab { padding: 8px 14px; border: 1px solid transparent; border-bottom: none; border-radius: 8px 8px 0 0; cursor: pointer; color: var(--muted); background: none; }
  .tab.active { background: var(--bg); border-color: var(--line); color: var(--text); font-weight: 600; }
  main { display: grid; grid-template-columns: 270px 1fr; gap: 16px; padding: 16px 20px; }
  main.single { grid-template-columns: 1fr; }
  aside { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; align-self: start; overflow: hidden; }
  details { border-bottom: 1px solid var(--line); }
  details:last-of-type { border-bottom: none; }
  summary { padding: 10px 14px; cursor: pointer; font-weight: 600; font-size: 13px; list-style: none; display: flex; justify-content: space-between; }
  summary::after { content: "+"; color: var(--muted); } details[open] summary::after { content: "–"; }
  summary .on { color: var(--accent); font-weight: 500; font-size: 12px; margin-left: auto; margin-right: 8px; }
  .group { padding: 0 14px 12px; display: flex; flex-direction: column; gap: 8px; }
  .sub { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .checks { max-height: 180px; overflow-y: auto; }
  .checks label, .radio label, .toggle { display: flex; gap: 6px; align-items: center; padding: 2px 0; cursor: pointer; }
  .checks .n { margin-left: auto; color: var(--muted); font-size: 12px; }
  .row { display: flex; gap: 6px; align-items: center; } .row input { width: 100%; min-width: 0; }
  .hint { font-size: 12px; color: var(--muted); }
  section.results { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; min-width: 0; }
  .bar { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--line); gap: 10px; flex-wrap: wrap; }
  .table-wrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  th { font-size: 12px; color: var(--muted); font-weight: 600; background: #fafbfc; }
  th[data-sort] { cursor: pointer; user-select: none; }
  th.sorted::after { content: " ▾"; } th.sorted.asc::after { content: " ▴"; }
  td.name { white-space: normal; min-width: 200px; font-weight: 500; }
  a { color: var(--accent); text-decoration: none; }
  .muted { color: var(--muted); }
  .badge { display: inline-block; padding: 1px 7px; border-radius: 99px; font-size: 11px; background: #f2f4f7; color: var(--muted); }
  .badge.ok { background: var(--ok-soft); color: var(--ok); } .badge.bad { background: var(--bad-soft); color: var(--bad); } .badge.warn { background: var(--warn-soft); color: var(--warn); }
  .type-mobile { color: var(--ok); } .type-toll_free { color: #6941c6; } .type-landline { color: #175cd3; }
  .empty { padding: 40px; text-align: center; color: var(--muted); }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .chip { background: var(--accent-soft); color: var(--accent); border-radius: 99px; padding: 2px 8px; font-size: 12px; }
  .history-filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: end; padding: 12px 14px; border-bottom: 1px solid var(--line); }
  @media (max-width: 860px) { main { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header>
  <h1>Lead Finder</h1>
  <form class="search" id="searchForm">
    <label class="field">Industry (optional)
      <select id="searchIndustry" style="width:170px"><option value="">Any industry</option></select>
    </label>
    <label class="field">Type of business
      <input type="text" name="category" id="searchCategory" list="categoryOptions" placeholder="e.g. Plumber" required autocomplete="off">
      <datalist id="categoryOptions"></datalist>
    </label>
    <label class="field">City, State
      <input type="text" name="city" placeholder="e.g. Orlando, FL" required>
    </label>
    <label class="field">How many (max 500)
      <input type="number" name="maxResults" value="100" min="1" max="500" style="width:110px">
    </label>
    <label class="field">Source code
      <input type="text" name="sourceCode" placeholder="ILS" style="width:90px">
    </label>
    <button type="submit" id="runBtn">Find businesses</button>
    <span id="msg"></span>
  </form>
  <div id="repeat"></div>
  <div class="tabs">
    <button class="tab active" data-tab="leads" type="button">Businesses</button>
    <button class="tab" data-tab="history" type="button">Pull history</button>
  </div>
</header>

<main id="leadsView">
  <aside id="filters">
    <details open>
      <summary>Location <span class="on" data-on="location"></span></summary>
      <div class="group">
        <label class="field">Country<select id="country"><option value="USA">United States</option></select></label>
        <div class="sub">State</div><div class="checks" id="f-state"></div>
        <div class="sub">City</div><div class="checks" id="f-city"></div>
      </div>
    </details>

    <details open>
      <summary>Industry &amp; category <span class="on" data-on="category"></span></summary>
      <div class="group">
        <div class="sub">Industry</div><div class="checks" id="f-industry"></div>
        <label class="toggle"><input type="checkbox" id="top100"> Top 100 categories only</label>
        <div class="sub">Category</div>
        <input type="text" id="catSearch" placeholder="Search categories">
        <div class="checks" id="f-category"></div>
        <div class="sub">Exclude categories</div><div class="checks" id="f-exclude"></div>
      </div>
    </details>

    <details>
      <summary>Local area <span class="on" data-on="local"></span></summary>
      <div class="group">
        <div class="sub">Within a distance</div>
        <div class="row">
          <select id="radius" style="width:95px"><option value="">Any</option><option value="1">1 mile</option><option value="5">5 miles</option>
            <option value="10">10 miles</option><option value="25">25 miles</option><option value="50">50 miles</option></select>
          <span>of</span>
          <select id="near" style="flex:1;min-width:0"><option value="">choose a place</option></select>
        </div>
        <div class="hint" id="nearHint">Measured from the middle of the businesses we have in that city or ZIP code.</div>
        <div class="sub">ZIP code</div><div class="checks" id="f-postal"></div>
      </div>
    </details>

    <details open>
      <summary>Business status <span class="on" data-on="status"></span></summary>
      <div class="group">
        <div class="sub">Google verification</div>
        <div class="radio" id="f-verified"></div>
        <div class="sub">Operating status</div>
        <div class="checks" id="f-status"></div>
      </div>
    </details>

    <details>
      <summary>Contact information <span class="on" data-on="contact"></span></summary>
      <div class="group">
        <label class="field">Phone number<select id="phone">
          <option value="">Any</option><option value="yes">Has a phone number</option><option value="no">No phone number</option></select></label>
        <div class="sub">Phone type</div><div class="checks" id="f-phone"></div>
        <label class="field">Website<select id="website">
          <option value="">Any</option><option value="yes">Has a website</option><option value="no">No website</option></select></label>
        <div class="hint">Email and social media filters arrive with email/social enrichment.</div>
      </div>
    </details>

    <details>
      <summary>Remove duplicates <span class="on" data-on="dedupe"></span></summary>
      <div class="group">
        <label class="toggle"><input type="checkbox" id="dedupeWebsite"> One business per website</label>
        <label class="toggle"><input type="checkbox" id="dedupePhone"> One business per phone number</label>
        <label class="toggle"><input type="checkbox" id="dedupeListing"> One per Google listing</label>
        <div class="hint">When businesses share a website or phone, the one with the most reviews is kept.</div>
      </div>
    </details>

    <details>
      <summary>Ratings &amp; reviews <span class="on" data-on="reviews"></span></summary>
      <div class="group">
        <div class="sub">Google rating</div>
        <div class="row"><input type="number" id="minRating" placeholder="from" min="0" max="5" step="0.1"> to <input type="number" id="maxRating" placeholder="to" min="0" max="5" step="0.1"></div>
        <div class="sub">Number of reviews</div>
        <div class="row"><input type="number" id="minReviews" placeholder="from" min="0"> to <input type="number" id="maxReviews" placeholder="to" min="0"></div>
      </div>
    </details>

    <details>
      <summary>Search position <span class="on" data-on="rank"></span></summary>
      <div class="group">
        <select id="maxRank">
          <option value="">Any position</option><option value="3">Top 3 (map pack)</option><option value="10">Top 10</option>
          <option value="20">Top 20</option><option value="50">Top 50</option></select>
        <select id="topPct">
          <option value="">Any percentage</option><option value="1">Top 1% of results</option><option value="5">Top 5% of results</option>
          <option value="10">Top 10% of results</option><option value="25">Top 25% of results</option></select>
        <div class="hint">Where the business appeared in Google's results for the search that found it.</div>
      </div>
    </details>

    <details>
      <summary>Business signals <span class="on" data-on="signals"></span></summary>
      <div class="group">
        <div class="sub">Price level</div><div class="checks" id="f-price"></div>
        <label class="field">Photos on Google (at least)<input type="number" id="minPhotos" min="0" placeholder="e.g. 10"></label>
        <div class="sub">Google profile features (must have all ticked)</div>
        <input type="text" id="attrSearch" placeholder="Search features">
        <div class="checks" id="f-attribute"></div>
        <div class="hint">Employees, revenue and website technology need a paid data add-on.</div>
      </div>
    </details>

    <details>
      <summary>Physical location <span class="on" data-on="physical"></span></summary>
      <div class="group">
        <div class="radio" id="f-location"></div>
        <div class="hint">"Service area only" businesses (many trades) don't show an address on Google.</div>
      </div>
    </details>

    <details>
      <summary>Pulls &amp; dates <span class="on" data-on="pulls"></span></summary>
      <div class="group">
        <div class="sub">From these pulls</div><div class="checks" id="f-pull"></div>
        <div class="sub">Date added</div>
        <div class="row"><input type="date" id="addedFrom"> to <input type="date" id="addedTo"></div>
        <div class="sub">Last updated</div>
        <div class="row"><input type="date" id="updatedFrom"> to <input type="date" id="updatedTo"></div>
        <div class="sub">Source code</div><div class="checks" id="f-source"></div>
        <div class="sub">Lead status</div><div class="checks" id="f-leadstatus"></div>
      </div>
    </details>

    <details>
      <summary>Name <span class="on" data-on="name"></span></summary>
      <div class="group"><input type="text" id="q" placeholder="Business name contains"></div>
    </details>

    <div class="group" style="padding-top:12px"><button class="ghost" id="clearBtn" type="button">Clear all filters</button></div>
  </aside>

  <section class="results">
    <div class="bar">
      <div>
        <strong id="count">Loading…</strong> <span id="dupInfo" class="muted"></span>
        <div class="chips" id="pullChips"></div>
      </div>
      <div>
        <button class="ghost small" id="prevBtn" type="button">‹ Prev</button>
        <span id="pageInfo" class="muted"></span>
        <button class="ghost small" id="nextBtn" type="button">Next ›</button>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th data-sort="name">Business</th>
          <th data-sort="category">Category</th>
          <th>Phone</th>
          <th>Phone type</th>
          <th>Website</th>
          <th data-sort="rating">Rating</th>
          <th data-sort="reviews">Reviews</th>
          <th data-sort="rank">Position</th>
          <th>Verified</th>
          <th>Status</th>
          <th>Location</th>
          <th data-sort="city">City</th>
          <th>State</th>
          <th data-sort="added" class="sorted">Added</th>
        </tr></thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
  </section>
</main>

<main id="historyView" class="single" hidden>
  <section class="results">
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
const PHONE_LABELS = { mobile: "Mobile", landline: "Landline", toll_free: "Toll-free", voip: "Internet (VoIP)",
  unknown: "Couldn't tell", unchecked: "Not checked yet", no_phone: "No phone" };
const STATUS_LABELS = { operational: "Open", temporarily_closed: "Temporarily closed", permanently_closed: "Permanently closed" };
const PULL_LABELS = { pending: "starting", scraping: "collecting…", ingesting: "saving…", enriching: "checking…", done: "done", failed: "failed" };
const DEFAULTS = { verified: "verified", status: ["operational"], location: "" };

const state = {
  page: 1, sort: "added", dir: "desc",
  verified: DEFAULTS.verified, location: DEFAULTS.location,
  selected: { state: new Set(), city: new Set(), category: new Set(), phone_type: new Set(),
    status: new Set(DEFAULTS.status), search_id: new Set(), source_code: new Set(), lead_status: new Set(),
    industry: new Set(), exclude_category: new Set(), postal_code: new Set(), price: new Set(), attribute: new Set() },
};
let tree = null; // industry -> categories, from /api/categories
const industryOfCategory = new Map();
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (v) => v ? "$" + Number(v).toFixed(2) : "$0.00";

async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(body.error || "Something went wrong (" + res.status + ")"); e.status = res.status; e.body = body; throw e; }
  return body;
}

function checkList(el, key, items, filterText) {
  const sel = state.selected[key];
  // Keep ticked values visible even when they have no rows under the current view.
  for (const v of sel) if (!items.some((it) => it.value === v)) items = [{ value: v, label: v, n: 0 }, ...items];
  const shown = filterText ? items.filter((it) => it.label.toLowerCase().includes(filterText)) : items;
  el.innerHTML = shown.length ? shown.map((it) =>
    '<label><input type="checkbox" value="' + esc(it.value) + '"' + (sel.has(it.value) ? " checked" : "") + "> " +
    esc(it.label) + (it.n != null ? '<span class="n">' + it.n + "</span>" : "") + "</label>").join("") : '<span class="muted">Nothing yet</span>';
  el.onchange = (e) => { e.target.checked ? sel.add(e.target.value) : sel.delete(e.target.value); refresh(); if (key === "state" || key === "industry") renderFacets(); };
}

async function loadTree() {
  tree = await api("/api/categories");
  industryOfCategory.clear();
  for (const i of tree.industries) for (const c of i.categories) industryOfCategory.set(c.name.toLowerCase(), i.industry);
  $("searchIndustry").innerHTML = '<option value="">Any industry</option>' + tree.industries.map((i) => '<option>' + esc(i.industry) + "</option>").join("");
  fillCategoryOptions();
}
function fillCategoryOptions() {
  if (!tree) return;
  const ind = $("searchIndustry").value;
  const cats = tree.industries.filter((i) => !ind || i.industry === ind).flatMap((i) => i.categories.map((c) => c.name));
  const ordered = [...cats.filter((c) => tree.top100.includes(c)), ...cats.filter((c) => !tree.top100.includes(c))];
  $("categoryOptions").innerHTML = ordered.map((c) => '<option value="' + esc(c) + '">').join("");
}
$("searchIndustry").onchange = () => { fillCategoryOptions(); $("searchCategory").value = ""; $("searchCategory").focus(); };

function radioList(el, name, options, current, onPick) {
  el.innerHTML = options.map((o) => '<label><input type="radio" name="' + name + '" value="' + esc(o.value) + '"' +
    (current === o.value ? " checked" : "") + "> " + esc(o.label) + (o.n != null ? ' <span class="muted">(' + o.n + ")</span>" : "") + "</label>").join("");
  el.onchange = (e) => onPick(e.target.value);
}

let facets = null, pulls = [];
async function loadFacets() { facets = await api("/api/leads/facets"); renderFacets(); }
function countOf(rows, value) { const r = (rows || []).find((x) => x.value === value); return r ? r.n : 0; }
function renderFacets() {
  if (!facets) return;
  checkList($("f-state"), "state", facets.states.map((s) => ({ value: s.value, label: s.value, n: s.n })));
  const states = state.selected.state;
  const cities = facets.cities.filter((c) => !states.size || states.has(c.state));
  checkList($("f-city"), "city", cities.map((c) => ({ value: c.city, label: c.city + (c.state ? ", " + c.state : ""), n: c.n })));
  checkList($("f-industry"), "industry", facets.industries.map((i) => ({ value: i.value, label: i.value, n: i.n })));
  const inds = state.selected.industry;
  const cats = facets.categories.filter((c) => !inds.size || inds.has(industryOfCategory.get(c.value.toLowerCase()) || "Other"));
  checkList($("f-category"), "category", cats.map((c) => ({ value: c.value, label: c.value, n: c.n })), $("catSearch").value.trim().toLowerCase());
  checkList($("f-exclude"), "exclude_category", facets.categories.map((c) => ({ value: c.value, label: c.value, n: c.n })));
  checkList($("f-postal"), "postal_code", facets.postalCodes.map((p) => ({ value: p.value, label: p.value, n: p.n })));
  checkList($("f-price"), "price", ["$", "$$", "$$$", "$$$$"].map((v) => ({ value: v, label: v, n: countOf(facets.prices, v) })));
  checkList($("f-attribute"), "attribute", facets.attributes.map((a) => ({ value: a.value, label: a.value, n: a.n })), $("attrSearch").value.trim().toLowerCase());
  const nearNow = $("near").value;
  $("near").innerHTML = '<option value="">choose a place</option>' +
    '<optgroup label="Cities">' + facets.cities.map((c) => { const v = c.city + "|" + (c.state || ""); return '<option value="' + esc(v) + '">' + esc(c.city + (c.state ? ", " + c.state : "")) + "</option>"; }).join("") + "</optgroup>" +
    '<optgroup label="ZIP codes">' + facets.postalCodes.map((p) => '<option value="zip:' + esc(p.value) + '">' + esc(p.value) + "</option>").join("") + "</optgroup>";
  $("near").value = nearNow;
  const phoneOrder = ["mobile", "landline", "toll_free", "voip", "unknown", "unchecked"];
  checkList($("f-phone"), "phone_type", phoneOrder.map((v) => ({ value: v, label: PHONE_LABELS[v], n: countOf(facets.phoneTypes, v) })));
  checkList($("f-status"), "status", Object.keys(STATUS_LABELS).map((v) => ({ value: v, label: STATUS_LABELS[v], n: countOf(facets.statuses, v) })));
  radioList($("f-verified"), "verified", [
    { value: "", label: "Any" },
    { value: "verified", label: "Verified only", n: countOf(facets.verified, "verified") },
    { value: "unverified", label: "Not verified only", n: countOf(facets.verified, "unverified") },
  ], state.verified, (v) => { state.verified = v; refresh(); });
  radioList($("f-location"), "location", [
    { value: "", label: "Any" },
    { value: "storefront", label: "Has a street address", n: countOf(facets.location, "storefront") },
    { value: "service_area", label: "Service area only", n: countOf(facets.location, "service_area") },
  ], state.location, (v) => { state.location = v; refresh(); });
  checkList($("f-source"), "source_code", facets.sourceCodes.map((s) => ({ value: s.value, label: s.value, n: s.n })));
  checkList($("f-leadstatus"), "lead_status", facets.leadStatuses.map((s) => ({ value: s.value, label: s.value, n: s.n })));
  renderPullFilter();
  renderActiveMarkers();
}

function pullLabel(p) { return p.category + " · " + p.city + (p.state ? ", " + p.state : "") + " · " + (p.created_at || "").slice(0, 10); }
function renderPullFilter() {
  checkList($("f-pull"), "search_id", pulls.map((p) => ({ value: p.id, label: pullLabel(p), n: p.leads_in_database })));
  $("pullChips").innerHTML = [...state.selected.search_id].map((id) => {
    const p = pulls.find((x) => x.id === id);
    return '<span class="chip">' + esc(p ? pullLabel(p) : "pull") + "</span>";
  }).join("");
}

function renderActiveMarkers() {
  const s = state.selected, v = (id) => $(id).value.trim();
  const on = {
    location: s.state.size + s.city.size,
    category: s.category.size + s.industry.size + s.exclude_category.size + ($("top100").checked ? 1 : 0),
    local: s.postal_code.size + (v("radius") && v("near") ? 1 : 0),
    signals: s.price.size + s.attribute.size + (v("minPhotos") ? 1 : 0),
    status: (state.verified ? 1 : 0) + s.status.size,
    contact: (v("phone") ? 1 : 0) + (v("website") ? 1 : 0) + s.phone_type.size,
    dedupe: ["dedupeWebsite", "dedupePhone", "dedupeListing"].filter((id) => $(id).checked).length,
    reviews: ["minRating", "maxRating", "minReviews", "maxReviews"].filter(v).length,
    rank: (v("maxRank") ? 1 : 0) + (v("topPct") ? 1 : 0),
    physical: state.location ? 1 : 0,
    pulls: s.search_id.size + s.source_code.size + s.lead_status.size +
      ["addedFrom", "addedTo", "updatedFrom", "updatedTo"].filter(v).length,
    name: v("q") ? 1 : 0,
  };
  document.querySelectorAll("[data-on]").forEach((el) => { const n = on[el.dataset.on]; el.textContent = n ? n + " on" : ""; });
}

function query() {
  const p = new URLSearchParams({ page: state.page, sort: state.sort, dir: state.dir });
  for (const [k, set] of Object.entries(state.selected)) for (const v of set) p.append(k, v);
  if (state.verified) p.set("verified", state.verified);
  if (state.location) p.set("location", state.location);
  const map = { q: "q", website: "website", phone: "phone", minRating: "min_rating", maxRating: "max_rating",
    minReviews: "min_reviews", maxReviews: "max_reviews", maxRank: "max_rank", addedFrom: "added_from", addedTo: "added_to",
    topPct: "top_pct", minPhotos: "min_photos", updatedFrom: "updated_from", updatedTo: "updated_to" };
  for (const [id, key] of Object.entries(map)) if ($(id).value.trim()) p.set(key, $(id).value.trim());
  if ($("top100").checked) p.set("top100", "1");
  if ($("radius").value && $("near").value) { p.set("radius_miles", $("radius").value); p.set("near", $("near").value); }
  if ($("dedupeWebsite").checked) p.set("dedupe_website", "1");
  if ($("dedupePhone").checked) p.set("dedupe_phone", "1");
  if ($("dedupeListing").checked) p.set("dedupe_listing", "1");
  return p;
}

function refresh() { state.page = 1; renderActiveMarkers(); renderPullFilter(); loadLeads(); }

async function loadLeads() {
  const data = await api("/api/leads?" + query());
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  $("count").textContent = data.total.toLocaleString() + " business" + (data.total === 1 ? "" : "es");
  $("dupInfo").textContent = data.duplicatesHidden ? "(" + data.duplicatesHidden + " duplicate" + (data.duplicatesHidden === 1 ? "" : "s") + " hidden)" : "";
  $("nearHint").textContent = data.nearNotFound ? "We have no businesses with a map position in that place yet, so there's nothing to measure from."
    : "Measured from the middle of the businesses we have in that city or ZIP code.";
  $("nearHint").style.color = data.nearNotFound ? "var(--bad)" : "";
  $("pageInfo").textContent = "Page " + data.page + " of " + pages;
  $("prevBtn").disabled = data.page <= 1;
  $("nextBtn").disabled = data.page >= pages;
  $("rows").innerHTML = data.results.length ? data.results.map((l) => {
    const type = l.phone_type || (l.gbp_phone_formatted ? "unchecked" : "");
    const site = l.website ? '<a href="' + esc(l.website) + '" target="_blank" rel="noopener">' + esc(l.website_domain || l.website.replace(/^https?:\\/\\/(www\\.)?/, "").split(/[/?#]/)[0]) + "</a>" : '<span class="muted">None</span>';
    const name = l.gbp_url ? '<a href="' + esc(l.gbp_url) + '" target="_blank" rel="noopener">' + esc(l.business_name) + "</a>" : esc(l.business_name);
    const verified = l.is_claimed === 0 ? '<span class="badge bad">Not verified</span>' : '<span class="badge ok">Verified</span>';
    const status = l.business_status === "operational" ? '<span class="badge ok">Open</span>'
      : '<span class="badge ' + (l.business_status === "permanently_closed" ? "bad" : "warn") + '">' + esc(STATUS_LABELS[l.business_status] || l.business_status) + "</span>";
    const where = l.has_street_address === 0 ? "Service area" : l.has_street_address === 1 ? "Street address" : "";
    return "<tr><td class=name>" + name + "</td><td>" + esc(l.gbp_category) + "</td><td>" + esc(l.gbp_phone_raw) +
      '</td><td class="type-' + esc(type) + '">' + esc(PHONE_LABELS[type] || "") + (l.phone_carrier ? ' <span class="muted">' + esc(l.phone_carrier) + "</span>" : "") +
      "</td><td>" + site + "</td><td>" + esc(l.rating ?? "") + "</td><td>" + esc(l.review_count ?? "") +
      "</td><td>" + esc(l.gbp_rank ?? "") + "</td><td>" + verified + "</td><td>" + status + "</td><td>" + esc(where) +
      "</td><td>" + esc(l.city) + "</td><td>" + esc(l.state) + "</td><td>" + esc(l.lead_date) + "</td></tr>";
  }).join("") : '<tr><td colspan="14" class="empty">No businesses match these filters.</td></tr>';
}

// ---- Pull history ----
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
    "<td>" + esc((s.created_at || "").replace("T", " ").slice(0, 16)) + "</td><td>" + esc(s.category) + "</td><td>" + esc(s.city) + (s.state ? ", " + esc(s.state) : "") +
    "</td><td>" + esc(s.apify_actor_id === "dataforseo-test" ? "DataForSEO (test)" : "Google Maps (Apify)") +
    '</td><td><span class="badge ' + (s.status === "done" ? "ok" : s.status === "failed" ? "bad" : "warn") + '" title="' + esc(s.error || "") + '">' + esc(PULL_LABELS[s.status] || s.status) + "</span>" +
    "</td><td>" + esc(s.results_count ?? "") + "</td><td>" + esc(s.new_leads_count ?? "") + "</td><td>" + esc(s.leads_in_database) +
    "</td><td>" + money(s.cost_estimate) + "</td><td>" + esc(s.source_code) +
    '</td><td><button class="ghost small" data-view="' + esc(s.id) + '">View businesses</button></td></tr>').join("")
    : '<tr><td colspan="12" class="empty">No pulls match.</td></tr>';
}
$("historyRows").onclick = (e) => {
  const view = e.target.closest("[data-view]");
  if (view) return showPulls([view.dataset.view]);
  const pick = e.target.closest("[data-pick]");
  if (pick) { pick.checked ? historySelection.add(pick.dataset.pick) : historySelection.delete(pick.dataset.pick); $("hViewSelected").disabled = !historySelection.size; }
};
$("hViewSelected").onclick = () => showPulls([...historySelection]);
let hTyping;
["hCategory", "hCity", "hState"].forEach((id) => $(id).oninput = () => { clearTimeout(hTyping); hTyping = setTimeout(loadHistory, 300); });
["hStatus", "hFrom", "hTo"].forEach((id) => $(id).onchange = loadHistory);

function showPulls(ids) {
  state.selected.search_id = new Set(ids);
  // Show everything from those pulls, including unverified/closed, until the user narrows it.
  state.verified = ""; state.selected.status = new Set();
  renderFacets(); setTab("leads"); refresh();
}

function setTab(tab) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  $("leadsView").hidden = tab !== "leads";
  $("historyView").hidden = tab !== "history";
  if (tab === "history") loadHistory();
}
document.querySelectorAll(".tab").forEach((t) => t.onclick = () => setTab(t.dataset.tab));

// ---- Running searches ----
let polling = null;
async function loadPulls() { pulls = await api("/api/searches?limit=200"); return pulls; }
async function pollActive() {
  const list = await loadPulls();
  const active = list.filter((s) => ["pending", "scraping", "ingesting"].includes(s.status));
  await Promise.all(active.map((s) => api("/api/searches/" + s.id + "/sync", { method: "POST" }).catch(() => {})));
  if (!active.length && polling) { clearInterval(polling); polling = null; $("msg").textContent = "Done."; }
  await Promise.all([loadFacets(), loadLeads()]);
  if (!$("historyView").hidden) loadHistory();
}
function startPolling() { if (!polling) polling = setInterval(pollActive, 5000); }

async function runSearch(body) {
  $("runBtn").disabled = true; $("msg").className = ""; $("msg").textContent = "Starting…"; $("repeat").innerHTML = "";
  try {
    const s = await api("/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    $("msg").textContent = "Collecting businesses. This usually takes under a minute.";
    await loadPulls();
    state.selected.search_id = new Set([s.id]); state.verified = ""; state.selected.status = new Set();
    renderFacets(); refresh(); startPolling();
  } catch (err) {
    if (err.status === 409 && err.body && err.body.repeat) return showRepeat(body, err.body);
    $("msg").className = "err"; $("msg").textContent = err.message;
  } finally { $("runBtn").disabled = false; }
}

function showRepeat(body, info) {
  $("msg").textContent = "";
  const p = info.previous[0];
  const est = ((Number(body.maxResults) || 100) * 0.005).toFixed(2);
  $("repeat").innerHTML = '<div class="repeat"><strong>You already pulled this.</strong> "' + esc(body.category) + '" in ' + esc(body.city) +
    " was pulled on " + esc((p.created_at || "").slice(0, 10)) + ": " + esc(p.results_count ?? 0) + " found, " + esc(p.leads_in_database) +
    " in your list. Pulling again within " + info.windowDays + " days costs money for mostly the same businesses (about $" + est + ").<div class=\\"actions\\">" +
    '<button type="button" id="useExisting">Show those businesses</button>' +
    '<button type="button" class="ghost" id="pullAgain">Pull again anyway</button>' +
    '<button type="button" class="ghost" id="cancelRepeat">Cancel</button></div></div>';
  $("useExisting").onclick = () => { $("repeat").innerHTML = ""; showPulls(info.previous.map((x) => x.id)); };
  $("pullAgain").onclick = () => runSearch({ ...body, force: true });
  $("cancelRepeat").onclick = () => { $("repeat").innerHTML = ""; };
}

$("searchForm").onsubmit = (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  runSearch({ category: f.get("category"), city: f.get("city"), maxResults: Number(f.get("maxResults")) || undefined, sourceCode: f.get("sourceCode") || undefined });
};

// ---- Filter wiring ----
document.querySelectorAll("th[data-sort]").forEach((th) => th.onclick = () => {
  if (state.sort === th.dataset.sort) state.dir = state.dir === "asc" ? "desc" : "asc";
  else { state.sort = th.dataset.sort; state.dir = ["name", "city", "category", "rank"].includes(th.dataset.sort) ? "asc" : "desc"; }
  document.querySelectorAll("th").forEach((h) => h.classList.remove("sorted", "asc"));
  th.classList.add("sorted"); if (state.dir === "asc") th.classList.add("asc");
  loadLeads();
});

let typing;
["q", "minRating", "maxRating", "minReviews", "maxReviews", "minPhotos"].forEach((id) => $(id).oninput = () => { clearTimeout(typing); typing = setTimeout(refresh, 300); });
["website", "phone", "maxRank", "topPct", "addedFrom", "addedTo", "updatedFrom", "updatedTo", "dedupeWebsite", "dedupePhone",
  "dedupeListing", "top100", "radius", "near"].forEach((id) => $(id).onchange = refresh);
$("catSearch").oninput = () => renderFacets();
$("attrSearch").oninput = () => renderFacets();
$("prevBtn").onclick = () => { state.page--; loadLeads(); };
$("nextBtn").onclick = () => { state.page++; loadLeads(); };
$("clearBtn").onclick = () => {
  Object.values(state.selected).forEach((s) => s.clear());
  state.verified = ""; state.location = "";
  ["q", "website", "phone", "minRating", "maxRating", "minReviews", "maxReviews", "maxRank", "topPct", "addedFrom", "addedTo",
    "updatedFrom", "updatedTo", "catSearch", "attrSearch", "minPhotos", "radius", "near"].forEach((id) => $(id).value = "");
  ["dedupeWebsite", "dedupePhone", "dedupeListing", "top100"].forEach((id) => $(id).checked = false);
  renderFacets(); refresh();
};

(async () => {
  try {
    const list = await loadPulls();
    if (list.some((s) => ["pending", "scraping", "ingesting"].includes(s.status))) startPolling();
    await loadTree();
    await Promise.all([loadFacets(), loadLeads()]);
  } catch (err) { $("count").textContent = err.message; }
})();
</script>
</body>
</html>`;
