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
    --accent: #2563eb; --accent-soft: #eff4ff; --ok: #067647; --warn: #b54708; --bad: #b42318;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
  header { background: var(--panel); border-bottom: 1px solid var(--line); padding: 14px 20px; }
  h1 { font-size: 18px; margin: 0 0 10px; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 18px 0 6px; }
  form.search { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; }
  label.field { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--muted); }
  input, select, button { font: inherit; }
  input[type=text], input[type=number], select { padding: 7px 9px; border: 1px solid var(--line); border-radius: 6px; background: #fff; color: var(--text); }
  button { padding: 7px 14px; border-radius: 6px; border: 1px solid var(--accent); background: var(--accent); color: #fff; cursor: pointer; }
  button.ghost { background: #fff; color: var(--text); border-color: var(--line); }
  button:disabled { opacity: .5; cursor: default; }
  #searches { display: flex; gap: 8px; overflow-x: auto; margin-top: 12px; padding-bottom: 2px; }
  .job { flex: 0 0 auto; border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; font-size: 12px; background: #fff; cursor: pointer; }
  .job.active { border-color: var(--accent); background: var(--accent-soft); }
  .pill { display: inline-block; padding: 1px 7px; border-radius: 99px; font-size: 11px; background: #f2f4f7; color: var(--muted); }
  .pill.done { background: #ecfdf3; color: var(--ok); } .pill.failed { background: #fef3f2; color: var(--bad); }
  .pill.scraping, .pill.ingesting, .pill.pending { background: #fffaeb; color: var(--warn); }
  main { display: grid; grid-template-columns: 250px 1fr; gap: 16px; padding: 16px 20px; }
  aside { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 4px 14px 14px; align-self: start; }
  .checks { max-height: 190px; overflow-y: auto; }
  .checks label { display: flex; gap: 6px; align-items: center; padding: 2px 0; cursor: pointer; }
  .checks .n { margin-left: auto; color: var(--muted); font-size: 12px; }
  .row { display: flex; gap: 6px; } .row input { width: 100%; }
  section.results { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; min-width: 0; }
  .bar { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--line); gap: 10px; flex-wrap: wrap; }
  .table-wrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  th { font-size: 12px; color: var(--muted); font-weight: 600; background: #fafbfc; cursor: pointer; user-select: none; }
  th.sorted::after { content: " ▾"; } th.sorted.asc::after { content: " ▴"; }
  td.name { white-space: normal; min-width: 200px; font-weight: 500; }
  a { color: var(--accent); text-decoration: none; }
  .muted { color: var(--muted); }
  .type-mobile { color: var(--ok); } .type-toll_free { color: #6941c6; } .type-landline { color: #175cd3; }
  .empty { padding: 40px; text-align: center; color: var(--muted); }
  #msg { font-size: 13px; }
  #msg.err { color: var(--bad); }
  @media (max-width: 800px) { main { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header>
  <h1>Lead Finder</h1>
  <form class="search" id="searchForm">
    <label class="field">Type of business
      <input type="text" name="category" placeholder="e.g. plumbers" required>
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
  <div id="searches"></div>
</header>

<main>
  <aside id="filters">
    <h2>Name contains</h2>
    <input type="text" id="q" placeholder="Search names" style="width:100%">

    <h2>State</h2>
    <div class="checks" id="f-state"></div>

    <h2>City</h2>
    <div class="checks" id="f-city"></div>

    <h2>Category</h2>
    <div class="checks" id="f-category"></div>

    <h2>Phone type</h2>
    <div class="checks" id="f-phone"></div>

    <h2>Website</h2>
    <select id="website" style="width:100%">
      <option value="">Any</option>
      <option value="no">No website</option>
      <option value="yes">Has a website</option>
    </select>

    <h2>Google rating at least</h2>
    <select id="minRating" style="width:100%">
      <option value="">Any</option><option>3</option><option>3.5</option><option>4</option><option>4.5</option>
    </select>

    <h2>Number of reviews</h2>
    <div class="row">
      <input type="number" id="minReviews" placeholder="from" min="0">
      <input type="number" id="maxReviews" placeholder="to" min="0">
    </div>

    <p><button class="ghost" id="clearBtn" type="button" style="width:100%">Clear filters</button></p>
  </aside>

  <section class="results">
    <div class="bar">
      <strong id="count">Loading…</strong>
      <div>
        <button class="ghost" id="prevBtn" type="button">‹ Prev</button>
        <span id="pageInfo" class="muted"></span>
        <button class="ghost" id="nextBtn" type="button">Next ›</button>
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
          <th data-sort="city">City</th>
          <th>State</th>
          <th data-sort="added" class="sorted">Added</th>
        </tr></thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
  </section>
</main>

<script>
const PHONE_LABELS = { mobile: "Mobile", landline: "Landline", toll_free: "Toll-free", voip: "Internet (VoIP)",
  unknown: "Couldn't tell", unchecked: "Not checked yet", no_phone: "No phone" };
const state = { page: 1, sort: "added", dir: "desc", searchId: "", selected: { state: new Set(), city: new Set(), category: new Set(), phone_type: new Set() } };
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Something went wrong (" + res.status + ")");
  return body;
}

function checkList(el, key, items) {
  const sel = state.selected[key];
  el.innerHTML = items.length ? items.map((it) =>
    '<label><input type="checkbox" value="' + esc(it.value) + '"' + (sel.has(it.value) ? " checked" : "") + '> ' +
    esc(it.label) + '<span class="n">' + it.n + "</span></label>").join("") : '<span class="muted">Nothing yet</span>';
  el.onchange = (e) => { e.target.checked ? sel.add(e.target.value) : sel.delete(e.target.value); state.page = 1; loadLeads(); if (key === "state") renderFacets(); };
}

let facets = null;
async function loadFacets() { facets = await api("/api/leads/facets"); renderFacets(); }
function renderFacets() {
  if (!facets) return;
  checkList($("f-state"), "state", facets.states.map((s) => ({ value: s.value, label: s.value, n: s.n })));
  const states = state.selected.state;
  const cities = facets.cities.filter((c) => !states.size || states.has(c.state));
  checkList($("f-city"), "city", cities.map((c) => ({ value: c.city, label: c.city + (c.state ? ", " + c.state : ""), n: c.n })));
  checkList($("f-category"), "category", facets.categories.map((c) => ({ value: c.value, label: c.value, n: c.n })));
  const order = ["mobile", "landline", "toll_free", "voip", "unknown", "unchecked"];
  const counts = Object.fromEntries(facets.phoneTypes.map((p) => [p.value, p.n]));
  checkList($("f-phone"), "phone_type", order.map((v) => ({ value: v, label: PHONE_LABELS[v], n: counts[v] || 0 })));
}

function query() {
  const p = new URLSearchParams({ page: state.page, sort: state.sort, dir: state.dir });
  if (state.searchId) p.set("search_id", state.searchId);
  for (const [k, set] of Object.entries(state.selected)) for (const v of set) p.append(k, v);
  const map = { q: "q", website: "website", minRating: "min_rating", minReviews: "min_reviews", maxReviews: "max_reviews" };
  for (const [id, key] of Object.entries(map)) if ($(id).value.trim()) p.set(key, $(id).value.trim());
  return p;
}

async function loadLeads() {
  const data = await api("/api/leads?" + query());
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  $("count").textContent = data.total.toLocaleString() + " business" + (data.total === 1 ? "" : "es") + (state.searchId ? " in this search" : "");
  $("pageInfo").textContent = "Page " + data.page + " of " + pages;
  $("prevBtn").disabled = data.page <= 1;
  $("nextBtn").disabled = data.page >= pages;
  $("rows").innerHTML = data.results.length ? data.results.map((l) => {
    const type = l.phone_type || (l.gbp_phone_formatted ? "unchecked" : "");
    const site = l.website ? '<a href="' + esc(l.website) + '" target="_blank" rel="noopener">' + esc(l.website.replace(/^https?:\\/\\/(www\\.)?/, "").split(/[/?#]/)[0]) + "</a>" : '<span class="muted">None</span>';
    const name = l.gbp_url ? '<a href="' + esc(l.gbp_url) + '" target="_blank" rel="noopener">' + esc(l.business_name) + "</a>" : esc(l.business_name);
    return "<tr><td class=name>" + name + "</td><td>" + esc(l.gbp_category) + "</td><td>" + esc(l.gbp_phone_raw) +
      '</td><td class="type-' + esc(type) + '">' + esc(PHONE_LABELS[type] || "") + (l.phone_carrier ? ' <span class="muted">' + esc(l.phone_carrier) + "</span>" : "") +
      "</td><td>" + site + "</td><td>" + esc(l.rating ?? "") + "</td><td>" + esc(l.review_count ?? "") +
      "</td><td>" + esc(l.city) + "</td><td>" + esc(l.state) + "</td><td>" + esc(l.lead_date) + "</td></tr>";
  }).join("") : '<tr><td colspan="10" class="empty">No businesses match these filters.</td></tr>';
}

const STATUS_LABELS = { pending: "starting", scraping: "collecting…", ingesting: "saving…", enriching: "checking…", done: "done", failed: "failed" };
async function loadSearches() {
  const list = await api("/api/searches");
  $("searches").innerHTML = '<div class="job' + (state.searchId ? "" : " active") + '" data-id="">All businesses</div>' +
    list.slice(0, 15).map((s) => '<div class="job' + (state.searchId === s.id ? " active" : "") + '" data-id="' + esc(s.id) + '" title="' + esc(s.error || "") + '">' +
      esc(s.category) + " · " + esc(s.city) + (s.state ? ", " + esc(s.state) : "") + ' <span class="pill ' + esc(s.status) + '">' + esc(STATUS_LABELS[s.status] || s.status) + "</span>" +
      (s.status === "done" ? ' <span class="muted">' + (s.results_count ?? 0) + " found, " + (s.new_leads_count ?? 0) + " new</span>" : "") + "</div>").join("");
  return list;
}
$("searches").onclick = (e) => {
  const job = e.target.closest(".job"); if (!job) return;
  state.searchId = job.dataset.id; state.page = 1; loadSearches(); loadLeads();
};

let polling = null;
async function pollActive() {
  const list = await loadSearches();
  const active = list.filter((s) => ["pending", "scraping", "ingesting"].includes(s.status));
  await Promise.all(active.map((s) => api("/api/searches/" + s.id + "/sync", { method: "POST" }).catch(() => {})));
  if (!active.length && polling) { clearInterval(polling); polling = null; }
  await Promise.all([loadFacets(), loadLeads()]);
}
function startPolling() { if (!polling) polling = setInterval(pollActive, 5000); }

$("searchForm").onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const body = { category: f.get("category"), city: f.get("city"), maxResults: Number(f.get("maxResults")) || undefined, sourceCode: f.get("sourceCode") || undefined };
  $("runBtn").disabled = true; $("msg").className = ""; $("msg").textContent = "Starting…";
  try {
    const s = await api("/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    $("msg").textContent = "Collecting businesses. This usually takes under a minute.";
    state.searchId = s.id; state.page = 1;
    await loadSearches(); startPolling();
  } catch (err) { $("msg").className = "err"; $("msg").textContent = err.message; }
  finally { $("runBtn").disabled = false; }
};

document.querySelectorAll("th[data-sort]").forEach((th) => th.onclick = () => {
  if (state.sort === th.dataset.sort) state.dir = state.dir === "asc" ? "desc" : "asc";
  else { state.sort = th.dataset.sort; state.dir = th.dataset.sort === "name" || th.dataset.sort === "city" || th.dataset.sort === "category" ? "asc" : "desc"; }
  document.querySelectorAll("th").forEach((h) => h.classList.remove("sorted", "asc"));
  th.classList.add("sorted"); if (state.dir === "asc") th.classList.add("asc");
  loadLeads();
});

let typing;
["q", "minReviews", "maxReviews"].forEach((id) => $(id).oninput = () => { clearTimeout(typing); typing = setTimeout(() => { state.page = 1; loadLeads(); }, 300); });
["website", "minRating"].forEach((id) => $(id).onchange = () => { state.page = 1; loadLeads(); });
$("prevBtn").onclick = () => { state.page--; loadLeads(); };
$("nextBtn").onclick = () => { state.page++; loadLeads(); };
$("clearBtn").onclick = () => {
  Object.values(state.selected).forEach((s) => s.clear());
  ["q", "website", "minRating", "minReviews", "maxReviews"].forEach((id) => $(id).value = "");
  state.page = 1; renderFacets(); loadLeads();
};

(async () => {
  try {
    const list = await loadSearches();
    if (list.some((s) => ["pending", "scraping", "ingesting"].includes(s.status))) startPolling();
    await Promise.all([loadFacets(), loadLeads()]);
  } catch (err) { $("count").textContent = err.message; }
})();
</script>
</body>
</html>`;
