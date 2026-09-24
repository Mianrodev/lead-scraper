// Limited live test of two candidate providers against an existing Apify run.
// Writes only to test-runs/provider-test/ (git-ignored); never touches the D1 lead tables.
//
//   npx tsx scripts/provider-test.ts plan               show every request + cost, no network
//   npx tsx scripts/provider-test.ts apify --live       download the existing Apify dataset (free read)
//   npx tsx scripts/provider-test.ts phones --live      classify 20 numbers with Abstract (free tier)
//   npx tsx scripts/provider-test.ts listings --live    one DataForSEO search (~$0.03)
//   npx tsx scripts/provider-test.ts report             offline comparison -> report.md
//
// Live steps refuse to run without --live. Secrets are read from .dev.vars and never printed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
    lines.push(`### Only in ${c.a.name}`, ``, ...c.onlyInA.map((p) => `- ${p.business_name} (${p.gbp_phone_raw ?? "no phone"})`), ``);
    lines.push(`### Only in ${c.b.name}`, ``, ...c.onlyInB.map((p) => `- ${p.business_name} (${p.gbp_phone_raw ?? "no phone"})`), ``);
    save(FILES.comparison, c);
  } else {
    lines.push(`## Business source comparison`, ``, `Not run yet (needs steps 1 and 3).`, ``);
  }

  save(FILES.report, lines.join("\n"));
}

// ---- main -----------------------------------------------------------------

async function main() {
  const [cmd = "plan", ...flags] = process.argv.slice(2);
  const live = flags.includes("--live");
  const vars = loadDevVars();

  if (cmd === "plan") return plan();
  if (cmd === "report") return report();

  const steps: Record<string, (v: Record<string, string>) => Promise<void>> = {
    apify: apifyStep,
    phones: phonesStep,
    listings: listingsStep,
  };
  const step = steps[cmd];
  if (!step) {
    console.error(`Unknown command "${cmd}". Use plan | apify | phones | listings | report.`);
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
