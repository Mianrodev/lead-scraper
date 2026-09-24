// Limited live test of two candidate providers against an existing Apify run.
// Writes only to test-runs/provider-test/ (git-ignored); never touches the D1 lead tables.
//
//   npx tsx scripts/provider-test.ts plan               show every request + cost, no network
//   npx tsx scripts/provider-test.ts apify --live       download the existing Apify dataset (free read)
//   npx tsx scripts/provider-test.ts phones --live      classify 20 numbers with Abstract (free tier)
//   npx tsx scripts/provider-test.ts listings --live    one DataForSEO search (~$0.03)
//   npx tsx scripts/provider-test.ts report             offline comparison -> report.md
//   npx tsx scripts/provider-test.ts import-local       add the DataForSEO test results to the LOCAL
//                                                        Lead Finder database, tagged DFS-TEST
//   npx tsx scripts/provider-test.ts remove-local       remove everything import-local added
//
// Live steps refuse to run without --live. Secrets are read from .dev.vars and never printed.
// import-local/remove-local only touch the local (this computer) database, never the deployed one.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatLeadDate, formatLeadDateTime } from "../src/format";
import { normalizePlace, type NormalizedPlace } from "../src/normalize";
import { isTollFree } from "../src/phone";
import { ABSTRACT_PHONE_ENDPOINT, abstractPhoneClassifier } from "../src/providers/abstract-phone";
import { compareSources, type Comparison } from "../src/providers/compare";
import {
  basicAuth,
  DATAFORSEO_LISTINGS_ENDPOINT,
  DATAFORSEO_USER_DATA_ENDPOINT,
  dataforseoMaxCost,
  dataforseoSource,
  dataforseoTaskBody,
} from "../src/providers/dataforseo-listings";
import { ProviderBlockedError, type BusinessSearchRequest, type PhoneClassification } from "../src/providers/types";

// ---- Test limits (the whole point: keep these small) ----------------------
const APIFY_DATASET_ID = "dUdbbH2Ej421r9W2R"; // "plumbers" in Orlando, FL, 40 results, run 2026-09-24
const PHONE_SAMPLE_SIZE = 20;
const ABSTRACT_DELAY_MS = 1100; // free plan: 1 request/second
const LISTINGS_REQUEST: BusinessSearchRequest = {
  category: "plumber",
  city: "Orlando",
  state: "FL",
  latitude: 28.5383355,
  longitude: -81.3792365,
  radiusKm: 15,
  limit: 50,
  claimedOnly: true,
};

const OUT_DIR = join(process.cwd(), "test-runs", "provider-test");
const FILES = {
  apify: join(OUT_DIR, "apify-dataset.json"),
  phones: join(OUT_DIR, "abstract-phones.json"),
  phonesCsv: join(OUT_DIR, "abstract-phones.csv"),
  dfsRaw: join(OUT_DIR, "dataforseo-response.json"),
  dfsPlaces: join(OUT_DIR, "dataforseo-places.json"),
  report: join(OUT_DIR, "report.md"),
  reportHtml: join(OUT_DIR, "report.html"),
  comparison: join(OUT_DIR, "comparison.json"),
};

function loadDevVars(): Record<string, string> {
  const vars: Record<string, string> = {};
  if (!existsSync(".dev.vars")) return vars;
  for (const line of readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2]) vars[m[1]] = m[2];
  }
  return vars;
}

function requireVar(vars: Record<string, string>, name: string): string {
  const value = vars[name];
  if (!value) {
    console.error(`Missing ${name} in .dev.vars. Stopping; no request was made.`);
    process.exit(1);
  }
  return value;
}

function save(path: string, data: unknown) {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path, typeof data === "string" ? data : JSON.stringify(data, null, 2), "utf8");
  console.log(`  saved ${path.replace(process.cwd() + "\\", "").replace(process.cwd() + "/", "")}`);
}

function readJson<T>(path: string, hint: string): T {
  if (!existsSync(path)) {
    console.error(`${path} not found. Run "${hint}" first.`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function apifyPlaces(): NormalizedPlace[] {
  const items = readJson<Record<string, unknown>[]>(FILES.apify, "apify --live");
  return items.map(normalizePlace).filter((p): p is NormalizedPlace => p !== null);
}

/** First N unique, non-toll-free numbers in Apify rank order. */
function phoneSample(places: NormalizedPlace[]): string[] {
  const out: string[] = [];
  for (const p of places) {
    const phone = p.gbp_phone_formatted;
    if (!phone || isTollFree(phone) || out.includes(phone)) continue;
    out.push(phone);
    if (out.length === PHONE_SAMPLE_SIZE) break;
  }
  return out;
}

// ---- plan -----------------------------------------------------------------

function plan() {
  console.log(`Provider test plan. Nothing below has been sent.\nResults go to test-runs/provider-test/ (git-ignored), never into the lead database.\n`);

  console.log(`STEP 1  apify --live   Read the existing Apify dataset (no new scrape)`);
  console.log(`  GET https://api.apify.com/v2/datasets/${APIFY_DATASET_ID}/items?clean=true&format=json`);
  console.log(`  Authorization: Bearer ***APIFY_API_TOKEN***`);
  console.log(`  Expected cost: $0 (reading stored results is free)`);
  console.log(`  Output: ${FILES.apify}\n`);

  const sample = existsSync(FILES.apify) ? phoneSample(apifyPlaces()) : null;
  console.log(`STEP 2  phones --live   Abstract Phone Intelligence, ${PHONE_SAMPLE_SIZE} numbers, 1 per second`);
  console.log(`  GET ${ABSTRACT_PHONE_ENDPOINT}?phone=<+1XXXXXXXXXX>&country=US   (x${PHONE_SAMPLE_SIZE})`);
  console.log(`  Authorization: Bearer ***ABSTRACT_PHONE_API_KEY***`);
  console.log(
    sample
      ? `  Numbers: ${sample.join(", ")}`
      : `  Numbers: first ${PHONE_SAMPLE_SIZE} unique non-toll-free numbers from step 1 (run step 1 to list them)`,
  );
  console.log(`  Expected credit use: ${PHONE_SAMPLE_SIZE} requests from the free plan, $0. Stops at the first quota/billing error.`);
  console.log(`  Output: ${FILES.phones} (raw + normalized line_type), ${FILES.phonesCsv}\n`);

  const maxCost = dataforseoMaxCost(LISTINGS_REQUEST.limit);
  console.log(`STEP 3  listings --live   DataForSEO Business Listings Search, 1 task`);
  console.log(`  3a. GET ${DATAFORSEO_USER_DATA_ENDPOINT}   balance check, free`);
  console.log(`      If balance is below $${maxCost.toFixed(4)} the step stops here and reports it.`);
  console.log(`  3b. POST ${DATAFORSEO_LISTINGS_ENDPOINT}`);
  console.log(`      Authorization: Basic ***DATAFORSEO_LOGIN:DATAFORSEO_PASSWORD***`);
  console.log(`      Body: ${JSON.stringify(dataforseoTaskBody(LISTINGS_REQUEST))}`);
  console.log(`      (radius in km around downtown Orlando; is_claimed=true returns verified profiles only)`);
  console.log(
    `  Expected cost: at most $${maxCost.toFixed(4)} ($0.012 task + ${LISTINGS_REQUEST.limit} items x $0.00036), paid from existing balance`,
  );
  console.log(`  Output: ${FILES.dfsRaw}, ${FILES.dfsPlaces}\n`);

  console.log(`STEP 4  report   Offline comparison, no network`);
  console.log(`  Output: ${FILES.report}, ${FILES.comparison}`);
}

// ---- live steps -----------------------------------------------------------

async function apifyStep(vars: Record<string, string>) {
  const token = requireVar(vars, "APIFY_API_TOKEN");
  const res = await fetch(`https://api.apify.com/v2/datasets/${APIFY_DATASET_ID}/items?clean=true&format=json`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Apify ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const items = await res.json();
  console.log(`Apify dataset: ${items.length} items`);
  save(FILES.apify, items);
}

async function phonesStep(vars: Record<string, string>) {
  const classifier = abstractPhoneClassifier(requireVar(vars, "ABSTRACT_PHONE_API_KEY"));
  const places = apifyPlaces();
  const numbers = phoneSample(places);
  console.log(`Classifying ${numbers.length} numbers with ${classifier.name}…`);
  const results: (PhoneClassification & { business_name: string | null })[] = [];
  let blocker: string | null = null;
  for (const [i, phone] of numbers.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, ABSTRACT_DELAY_MS));
    try {
      const r = await classifier.classify(phone);
      const name = places.find((p) => p.gbp_phone_formatted === phone)?.business_name ?? null;
      results.push({ ...r, business_name: name });
      console.log(`  ${i + 1}/${numbers.length} ${phone} -> ${r.line_type}${r.carrier ? ` (${r.carrier})` : ""}${r.error ? ` [${r.error}]` : ""}`);
    } catch (err) {
      if (err instanceof ProviderBlockedError) {
        blocker = err.message;
        console.error(`  Stopped: ${err.message}`);
        break;
      }
      throw err;
    }
  }
  save(FILES.phones, { provider: classifier.name, ranAt: new Date().toISOString(), blocker, results });
  const csv = ["phone,business_name,line_type,carrier,error"]
    .concat(results.map((r) => [r.phone, r.business_name, r.line_type, r.carrier, r.error].map(csvCell).join(",")))
    .join("\n");
  save(FILES.phonesCsv, csv);
}

async function listingsStep(vars: Record<string, string>) {
  const login = requireVar(vars, "DATAFORSEO_LOGIN");
  const password = requireVar(vars, "DATAFORSEO_PASSWORD");
  const maxCost = dataforseoMaxCost(LISTINGS_REQUEST.limit);

  const userRes = await fetch(DATAFORSEO_USER_DATA_ENDPOINT, { headers: { Authorization: basicAuth(login, password) } });
  const user = (await userRes.json().catch(() => ({}))) as {
    status_code?: number;
    status_message?: string;
    tasks?: { result?: { money?: { balance?: number } }[] }[];
  };
  if (!userRes.ok || user.status_code !== 20000) {
    console.error(`Stopped before searching: DataForSEO account check failed (${userRes.status} ${user.status_message ?? ""}).`);
    process.exit(1);
  }
  const balance = user.tasks?.[0]?.result?.[0]?.money?.balance ?? 0;
  console.log(`DataForSEO balance: $${balance.toFixed(4)} (search costs at most $${maxCost.toFixed(4)})`);
  if (balance < maxCost) {
    console.error(`Stopped: balance too low. DataForSEO needs a deposit (billing), which is outside this test. No search was run.`);
    process.exit(1);
  }

  const source = dataforseoSource(login, password);
  try {
    const result = await source.search(LISTINGS_REQUEST);
    console.log(`DataForSEO returned ${result.places.length} businesses, reported cost $${result.costUsd ?? "?"}`);
    save(FILES.dfsRaw, result.raw);
    save(FILES.dfsPlaces, result.places);
  } catch (err) {
    if (err instanceof ProviderBlockedError) {
      console.error(`Stopped: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}

// ---- report ---------------------------------------------------------------

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function row(label: string, a: string | number, b: string | number) {
  return `| ${label} | ${a} | ${b} |`;
}

function report() {
  const lines: string[] = [`# Provider test report`, ``, `Generated ${new Date().toISOString()}`, ``];

  if (existsSync(FILES.phones)) {
    const phones = readJson<{ provider: string; blocker: string | null; results: (PhoneClassification & { business_name: string | null })[] }>(
      FILES.phones,
      "phones --live",
    );
    const counts: Record<string, number> = {};
    for (const r of phones.results) counts[r.line_type] = (counts[r.line_type] ?? 0) + 1;
    lines.push(`## Phone classification (${phones.provider})`, ``);
    lines.push(`Numbers classified: ${phones.results.length}`, ``);
    lines.push(`| Line type | Count |`, `|---|---|`);
    for (const t of ["mobile", "landline", "voip", "unknown"]) lines.push(`| ${t} | ${counts[t] ?? 0} |`);
    if (phones.blocker) lines.push(``, `Stopped early: ${phones.blocker}`);
    lines.push(``, `| Phone | Business | Line type | Carrier |`, `|---|---|---|---|`);
    for (const r of phones.results) lines.push(`| ${r.phone} | ${r.business_name ?? ""} | ${r.line_type} | ${r.carrier ?? ""} |`);
    lines.push(``);
  } else {
    lines.push(`## Phone classification`, ``, `Not run yet.`, ``);
  }

  if (existsSync(FILES.apify) && existsSync(FILES.dfsPlaces)) {
    const apify = apifyPlaces();
    const dfs = readJson<NormalizedPlace[]>(FILES.dfsPlaces, "listings --live");
    const c: Comparison = compareSources("Apify (compass)", apify, "DataForSEO", dfs);
    lines.push(`## Business source comparison: plumbers, Orlando FL`, ``);
    lines.push(`| | ${c.a.name} | ${c.b.name} |`, `|---|---|---|`);
    lines.push(row("Unique businesses", c.a.total, c.b.total));
    lines.push(row("Claimed / verified", c.a.claimed, c.b.claimed));
    lines.push(row("Unclaimed", c.a.unclaimed, c.b.unclaimed));
    lines.push(row("Claim status unknown", c.a.claimUnknown, c.b.claimUnknown));
    lines.push(row("With a phone number", c.a.withPhone, c.b.withPhone));
    lines.push(row("With a website", c.a.withWebsite, c.b.withWebsite));
    lines.push(row("Only in this source", c.onlyInA.length, c.onlyInB.length));
    lines.push(``, `Overlap: **${c.overlap}** (${c.matchedByPlaceId} by Google place ID, ${c.matchedByMapsUrl} by Google Maps URL/CID).`, ``);

    const disagreements = c.pairs.filter((p) => p.a.is_claimed !== p.b.is_claimed);
    if (disagreements.length) {
      lines.push(`Claimed status disagreements on overlapping businesses:`, ``);
      for (const d of disagreements) lines.push(`- ${d.a.business_name}: Apify ${d.a.is_claimed}, DataForSEO ${d.b.is_claimed}`);
      lines.push(``);
    }
    if (c.samePhoneDifferentId.length) {
      lines.push(`Probably the same business under a different Google ID (same phone number), ${c.samePhoneDifferentId.length}:`, ``);
      for (const x of c.samePhoneDifferentId) lines.push(`- ${x.a.business_name} / ${x.b.business_name} (${x.a.gbp_phone_formatted})`);
      lines.push(``);
    }
    lines.push(`### Only in ${c.a.name}`, ``, ...c.onlyInA.map((p) => `- ${p.business_name} (${p.gbp_phone_raw ?? "no phone"})`), ``);
    lines.push(`### Only in ${c.b.name}`, ``, ...c.onlyInB.map((p) => `- ${p.business_name} (${p.gbp_phone_raw ?? "no phone"})`), ``);
    save(FILES.comparison, c);
  } else {
    lines.push(`## Business source comparison`, ``, `Not run yet (needs steps 1 and 3).`, ``);
  }

  save(FILES.report, lines.join("\n"));
  save(FILES.reportHtml, renderHtml());
}

// ---- HTML report ------------------------------------------------------------

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

// Carriers that sell internet (VoIP) phone service; a "mobile"/"landline" label on one deserves a second look.
const VOIP_CARRIER_HINT = /ip enabled|voip|bandwidth|onvoy|lumen|level 3|twilio|ringcentral|vonage/i;

const TYPE_LABEL: Record<string, string> = { mobile: "Mobile", landline: "Landline", voip: "VoIP", unknown: "Unknown" };

function renderHtml(): string {
  const phones = existsSync(FILES.phones)
    ? readJson<{ provider: string; blocker: string | null; results: (PhoneClassification & { business_name: string | null })[] }>(
        FILES.phones,
        "phones --live",
      )
    : null;
  const comparison =
    existsSync(FILES.apify) && existsSync(FILES.dfsPlaces)
      ? compareSources("Apify", apifyPlaces(), "DataForSEO", readJson<NormalizedPlace[]>(FILES.dfsPlaces, "listings --live"))
      : null;
  const dfsCost = existsSync(FILES.dfsRaw) ? (readJson<{ cost?: number }>(FILES.dfsRaw, "listings --live").cost ?? null) : null;

  let phoneSection = `<p class="muted">Phone test not run yet.</p>`;
  if (phones) {
    const counts: Record<string, number> = { mobile: 0, landline: 0, voip: 0, unknown: 0 };
    for (const r of phones.results) counts[r.line_type]++;
    const total = phones.results.length || 1;
    const flagged = phones.results.filter((r) => r.line_type !== "voip" && r.carrier && VOIP_CARRIER_HINT.test(r.carrier));
    phoneSection = `
      <div class="tiles">
        ${(["mobile", "landline", "voip", "unknown"] as const)
          .map((t) => `<div class="tile"><div class="num t-${t}">${counts[t]}</div><div class="lbl">${TYPE_LABEL[t]}</div></div>`)
          .join("")}
      </div>
      <div class="stack" aria-hidden="true">
        ${(["mobile", "landline", "voip", "unknown"] as const)
          .filter((t) => counts[t])
          .map((t) => `<span class="seg bg-${t}" style="width:${(counts[t] / total) * 100}%"></span>`)
          .join("")}
      </div>
      ${
        flagged.length
          ? `<p class="note">⚠ ${flagged.length} result${flagged.length > 1 ? "s look" : " looks"} doubtful: the carrier sells internet (VoIP) phone service but Abstract says otherwise. Marked below.</p>`
          : ""
      }
      ${phones.blocker ? `<p class="note">Stopped early: ${esc(phones.blocker)}</p>` : ""}
      <div class="table-wrap"><table>
        <thead><tr><th>Business</th><th>Phone</th><th>Type</th><th>Carrier</th></tr></thead>
        <tbody>${phones.results
          .map((r) => {
            const doubt = flagged.includes(r);
            return `<tr><td>${esc(r.business_name)}</td><td class="mono">${esc(r.phone)}</td>
              <td><span class="badge bg-${r.line_type}">${TYPE_LABEL[r.line_type]}</span>${doubt ? ` <span class="warn" title="Carrier suggests VoIP">⚠ check</span>` : ""}</td>
              <td class="muted">${esc(r.carrier)}</td></tr>`;
          })
          .join("")}</tbody>
      </table></div>`;
  }

  let sourceSection = `<p class="muted">Business source test not run yet.</p>`;
  if (comparison) {
    const c = comparison;
    const statRow = (label: string, a: number, b: number) => `<tr><td>${label}</td><td class="n">${a}</td><td class="n">${b}</td></tr>`;
    const list = (items: NormalizedPlace[]) =>
      items
        .map(
          (p) => `<li><span class="name">${esc(p.business_name)}</span>
            <span class="muted mono">${esc(p.gbp_phone_formatted ?? "no phone")}</span>
            ${p.is_claimed === 1 ? `<span class="badge ok">Verified</span>` : p.is_claimed === 0 ? `<span class="badge bad">Not verified</span>` : ""}
            ${p.website ? "" : `<span class="badge">No website</span>`}</li>`,
        )
        .join("");
    const sameIds = new Set(c.samePhoneDifferentId.flatMap((x) => [x.a, x.b]));
    sourceSection = `
      <div class="tiles">
        <div class="tile"><div class="num">${c.a.total}</div><div class="lbl">Apify businesses</div></div>
        <div class="tile"><div class="num">${c.b.total}</div><div class="lbl">DataForSEO businesses</div></div>
        <div class="tile"><div class="num accent">${c.overlap}</div><div class="lbl">Found by both (same Google ID)</div></div>
        <div class="tile"><div class="num">${c.samePhoneDifferentId.length}</div><div class="lbl">Probably the same, different Google ID</div></div>
      </div>
      <div class="table-wrap"><table class="compare">
        <thead><tr><th></th><th class="n">Apify</th><th class="n">DataForSEO</th></tr></thead>
        <tbody>
          ${statRow("Businesses found", c.a.total, c.b.total)}
          ${statRow("Verified by owner", c.a.claimed, c.b.claimed)}
          ${statRow("Not verified", c.a.unclaimed, c.b.unclaimed)}
          ${statRow("Have a phone number", c.a.withPhone, c.b.withPhone)}
          ${statRow("Have a website", c.a.withWebsite, c.b.withWebsite)}
          ${statRow("Only found by this source", c.onlyInA.length - c.samePhoneDifferentId.length, c.onlyInB.length - c.samePhoneDifferentId.length)}
        </tbody>
      </table></div>
      ${
        c.samePhoneDifferentId.length
          ? `<h3>Probably the same business (same phone, different Google ID)</h3>
             <ul class="list">${c.samePhoneDifferentId
               .map((x) => `<li><span class="name">${esc(x.a.business_name)}</span> <span class="muted">/ ${esc(x.b.business_name)}</span> <span class="muted mono">${esc(x.a.gbp_phone_formatted)}</span></li>`)
               .join("")}</ul>`
          : ""
      }
      <h3>Found by both (${c.overlap})</h3>
      <ul class="list">${list(c.pairs.map((p) => p.a))}</ul>
      <div class="cols">
        <div><h3>Only in Apify</h3><ul class="list">${list(c.onlyInA.filter((p) => !sameIds.has(p)))}</ul></div>
        <div><h3>Only in DataForSEO</h3><ul class="list">${list(c.onlyInB.filter((p) => !sameIds.has(p)))}</ul></div>
      </div>`;
  }

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Provider Test Results</title>
<style>
  :root { --bg:#f6f7f9; --panel:#fff; --text:#1d2330; --muted:#667085; --line:#e4e7ec; --accent:#2563eb;
    --mobile:#067647; --landline:#175cd3; --voip:#6941c6; --unknown:#98a2b3; --warn:#b54708; --warn-bg:#fffaeb; --ok-bg:#ecfdf3; --bad-bg:#fef3f2; --bad:#b42318; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg:#0f1115; --panel:#171a21; --text:#e6e8ec; --muted:#98a2b3; --line:#2a2f3a; --accent:#6ea0ff;
    --mobile:#47cd89; --landline:#84adff; --voip:#b692f6; --unknown:#667085; --warn:#fdb022; --warn-bg:#2a2112; --ok-bg:#0f2a1d; --bad-bg:#2d1414; --bad:#f97066; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }
  .wrap { max-width:1000px; margin:0 auto; padding:24px 16px 48px; }
  h1 { font-size:22px; margin:0 0 4px; } h2 { font-size:17px; margin:0 0 4px; } h3 { font-size:14px; margin:20px 0 8px; }
  .muted { color:var(--muted); } .mono { font-variant-numeric: tabular-nums; }
  section { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:18px; margin-top:18px; }
  .sub { color:var(--muted); margin:0 0 14px; }
  .tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin-bottom:12px; }
  .tile { border:1px solid var(--line); border-radius:8px; padding:12px; }
  .num { font-size:26px; font-weight:650; } .num.accent { color:var(--accent); } .lbl { color:var(--muted); font-size:12px; }
  .t-mobile{color:var(--mobile)} .t-landline{color:var(--landline)} .t-voip{color:var(--voip)} .t-unknown{color:var(--unknown)}
  .stack { display:flex; height:10px; border-radius:99px; overflow:hidden; gap:2px; margin-bottom:14px; }
  .seg { display:block; height:100%; }
  .bg-mobile{background:var(--mobile)} .bg-landline{background:var(--landline)} .bg-voip{background:var(--voip)} .bg-unknown{background:var(--unknown)}
  .badge { display:inline-block; padding:1px 8px; border-radius:99px; font-size:11px; background:var(--line); color:var(--text); }
  .badge.bg-mobile,.badge.bg-landline,.badge.bg-voip,.badge.bg-unknown { color:#fff; }
  .badge.ok { background:var(--ok-bg); color:var(--mobile); } .badge.bad { background:var(--bad-bg); color:var(--bad); }
  .warn { color:var(--warn); font-size:12px; font-weight:600; }
  .note { background:var(--warn-bg); color:var(--warn); border-radius:8px; padding:8px 12px; }
  .table-wrap { overflow-x:auto; }
  table { border-collapse:collapse; width:100%; }
  th,td { text-align:left; padding:7px 10px; border-bottom:1px solid var(--line); }
  th { color:var(--muted); font-size:12px; font-weight:600; } td.n, th.n { text-align:right; font-variant-numeric:tabular-nums; }
  table.compare { max-width:520px; }
  .list { list-style:none; padding:0; margin:0; } .list li { padding:5px 0; border-bottom:1px solid var(--line); display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
  .list .name { font-weight:500; }
  .cols { display:grid; grid-template-columns:1fr 1fr; gap:18px; }
  @media (max-width:700px) { .cols { grid-template-columns:1fr; } }
</style></head>
<body><div class="wrap">
  <h1>Provider test results</h1>
  <p class="muted">Plumbers in Orlando, FL · ${esc(new Date().toLocaleString("en-US"))} · Test data only; nothing was added to the lead database.</p>

  <section>
    <h2>Phone types (${esc(phones?.provider ?? "Abstract")})</h2>
    <p class="sub">${phones?.results.length ?? 0} numbers from the Apify results · free plan, $0</p>
    ${phoneSection}
  </section>

  <section>
    <h2>Finding businesses: Apify vs DataForSEO</h2>
    <p class="sub">DataForSEO asked for verified businesses only, within 15 km of downtown Orlando · cost ${dfsCost != null ? `$${dfsCost.toFixed(3)}` : "n/a"} from the free credit</p>
    ${sourceSection}
  </section>
</div></body></html>`;
}

// ---- local import of test results -------------------------------------------

const TEST_SOURCE_CODE = "DFS-TEST";
const TEST_SEARCH_ID = "dfs-test-orlando-plumber";
const LEAD_TIMEZONE = "America/New_York";

function sql(v: unknown): string {
  if (v == null) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  return `'${String(v).replace(/'/g, "''")}'`;
}

function runLocalSql(statements: string[]) {
  const file = join(OUT_DIR, "local-import.sql");
  save(file, statements.join("\n"));
  // Run wrangler's own entry point with this Node binary: no shell, so no argument-quoting issues on Windows.
  const wrangler = join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");
  const out = execFileSync(process.execPath, [wrangler, "d1", "execute", "lead-scraper-db", "--local", `--file=${file}`], {
    encoding: "utf8",
  });
  if (!/executed successfully|Executed \d+ command/i.test(out)) console.log(out);
}

function importLocal() {
  const places = readJson<NormalizedPlace[]>(FILES.dfsPlaces, "listings --live");
  const now = new Date();
  const leadDate = formatLeadDate(now, LEAD_TIMEZONE);
  const leadDateTime = formatLeadDateTime(now, LEAD_TIMEZONE);
  const dfsCost = existsSync(FILES.dfsRaw) ? (readJson<{ cost?: number }>(FILES.dfsRaw, "listings --live").cost ?? 0) : 0;

  const statements = [
    `INSERT OR IGNORE INTO searches (id, category, city, state, source_code, max_results, apify_actor_id, status,
       results_count, cost_apify, finished_at)
     VALUES (${sql(TEST_SEARCH_ID)}, 'plumber (DataForSEO test)', 'Orlando', 'FL', ${sql(TEST_SOURCE_CODE)},
       ${places.length}, 'dataforseo-test', 'done', ${places.length}, ${sql(dfsCost)}, datetime('now'));`,
  ];
  for (const p of places) {
    const id = crypto.randomUUID();
    // DO NOTHING on conflict: businesses Apify already found stay exactly as they are.
    statements.push(
      `INSERT INTO leads (id, search_id, google_place_id, cid, business_name, gbp_category, lead_category, sub_category,
         gbp_phone_raw, gbp_phone_formatted, phone_type, website, gbp_url, gbp_rank, rating, review_count,
         address, city, state, postal_code, country, latitude, longitude, is_claimed, logo_url,
         source_code, lead_date, lead_datetime)
       VALUES (${[
         id, TEST_SEARCH_ID, p.google_place_id, p.cid, p.business_name, p.gbp_category, p.gbp_category, p.sub_category,
         p.gbp_phone_raw, p.gbp_phone_formatted, p.phone_type, p.website, p.gbp_url, p.gbp_rank, p.rating, p.review_count,
         p.address, p.city, p.state, p.postal_code, p.country, p.latitude, p.longitude, p.is_claimed, p.logo_url,
         TEST_SOURCE_CODE, leadDate, leadDateTime,
       ].map(sql).join(", ")})
       ON CONFLICT(google_place_id) DO NOTHING;`,
      `INSERT OR IGNORE INTO search_leads (search_id, lead_id, rank)
       SELECT ${sql(TEST_SEARCH_ID)}, id, ${sql(p.gbp_rank)} FROM leads WHERE google_place_id = ${sql(p.google_place_id)};`,
    );
  }
  statements.push(
    `UPDATE searches SET new_leads_count = (SELECT COUNT(*) FROM leads WHERE source_code = ${sql(TEST_SOURCE_CODE)}),
       skipped_count = 0 WHERE id = ${sql(TEST_SEARCH_ID)};`,
  );
  runLocalSql(statements);
  console.log(`Imported DataForSEO test results into the local Lead Finder (source code ${TEST_SOURCE_CODE}).`);
}

function removeLocal() {
  runLocalSql([
    `DELETE FROM search_leads WHERE search_id = ${sql(TEST_SEARCH_ID)}
       OR lead_id IN (SELECT id FROM leads WHERE source_code = ${sql(TEST_SOURCE_CODE)});`,
    `DELETE FROM leads WHERE source_code = ${sql(TEST_SOURCE_CODE)};`,
    `DELETE FROM searches WHERE id = ${sql(TEST_SEARCH_ID)};`,
  ]);
  console.log(`Removed all ${TEST_SOURCE_CODE} records from the local Lead Finder.`);
}

// ---- main -----------------------------------------------------------------

async function main() {
  const [cmd = "plan", ...flags] = process.argv.slice(2);
  const live = flags.includes("--live");
  const vars = loadDevVars();

  if (cmd === "plan") return plan();
  if (cmd === "report") return report();
  if (cmd === "import-local") return importLocal();
  if (cmd === "remove-local") return removeLocal();

  const steps: Record<string, (v: Record<string, string>) => Promise<void>> = {
    apify: apifyStep,
    phones: phonesStep,
    listings: listingsStep,
  };
  const step = steps[cmd];
  if (!step) {
    console.error(`Unknown command "${cmd}". Use plan | apify | phones | listings | report | import-local | remove-local.`);
    process.exit(1);
  }
  if (!live) {
    console.log(`"${cmd}" makes live requests. Showing the plan instead; add --live to run it.\n`);
    return plan();
  }
  await step(vars);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
