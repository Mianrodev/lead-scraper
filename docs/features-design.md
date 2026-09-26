# Nine features: design contract (2026-09-26)

This is the contract every module follows so the pieces fit together. The schema is in
`migrations/0014_features.sql`. Read it first. Module owners write ONLY the files listed
under their feature (plus their test file). `src/index.ts`, `src/dashboard.ts`,
`src/leads.ts`, `src/export.ts` are integrated by the lead engineer afterwards; describe
what they need in your module's top comment (routes, queue messages, UI).

Ground rules (apply to every module)
- Cloudflare Workers, Hono, D1 (SQLite). Assume the FREE plan: at most ~45 outside
  `fetch()` calls per invocation, small CPU budget, D1 100k row writes/day. Every batch
  job must be resumable and idempotent: it runs from a queue message or the minute cron,
  does a small slice, and either queues the next slice or waits for the next cron tick.
- Never throw out of a batch runner; record errors on the row and carry on.
- All text shown to users is plain English for a non-technical sales team.
- Lists of ids in SQL are inlined with `sqlString()` (from `src/leads.ts`), never bound
  (D1 allows at most 100 bound parameters).
- Money: nothing here spends money except DataForSEO counts (saved-search alerts) and,
  optionally, a Google API key for PageSpeed (free quota). Check `monthSpend(env).left`
  before any paid call (`src/ops.ts`).
- Notifications: `notify(env, { kind, level, message, dedupeKey })` from `src/ops.ts`.
- Tests: vitest, pure functions only (no D1). Put them in `test/<module>.test.ts`.

Queue messages (consumer in `src/index.ts`, one message = one small slice of work)
- `{ searchId }` saving step of a pull (exists)
- `{ phones: true, force?: boolean }` phone-check run (exists)
- `{ audits: true }` website visitor slice → `runWebsiteAudits(env)`
- `{ psi: true }` PageSpeed slice → `runPageSpeedChecks(env)`
- `{ ghlJob: "<id>" }` send-to-GHL slice → `runGhlJob(env, id)`
- `{ chains: true }` chain detection slice → `runChainDetection(env)`
The minute cron (`scheduled()`) enqueues a slice whenever the matching queue has work
(cheap `SELECT 1 … LIMIT 1` check first). Saved-search alerts run from `dailyChecks`.

---------------------------------------------------------------------------------------
## 1. Website visitor  — `src/website-audit.ts` (+ `test/website-audit.test.ts`)

Purpose: visit a business's website once and record what it tells us. Fills the
`website_audits` row, `lead_emails`, `leads.socials`, then re-scores the lead.

Exports
- `export interface WebsiteFindings { finalUrl, httpStatus, reachable, https, socialOnly,
   title, builder, hasMetaPixel, hasGoogleTag, hasTiktokPixel, hasBooking, bookingTool,
   hasContactForm, hasChatWidget, mobileViewport, emails: string[], socials: Record<string,string>,
   copyrightYear, pagesChecked, error }` (column names of website_audits, camelCased).
- `export function analyzeHtml(html: string, pageUrl: string): Partial<WebsiteFindings>`
  PURE. Detects: builder (signatures: WordPress `wp-content`/`wp-json`/generator; Wix
  `wixstatic.com`/`X-Wix`; Squarespace `squarespace.com`/`Squarespace`; Shopify
  `cdn.shopify.com`/`Shopify.theme`; GoDaddy `godaddy`/`img1.wsimg.com`/`wsimg`; Weebly
  `weebly.com`/`Weebly`; Duda `duda`/`dudamobile`/`multiscreensite.com`; Webflow
  `webflow.io`/`data-wf-`; HighLevel `leadconnectorhq`/`msgsndr`/`highlevel`; else
  `other` when a page loaded), Meta Pixel (`fbq(`, `connect.facebook.net/*/fbevents.js`),
  Google tag (`googletagmanager.com/gtag/js`, `gtag(`, `googletagmanager.com/gtm.js`,
  `google-analytics.com`), TikTok (`analytics.tiktok.com`, `ttq.load`), booking tools
  (calendly.com, acuityscheduling.com, squareup.com/appointments, booksy.com, vagaro.com,
  setmore.com, housecallpro.com, servicetitan.com, getjobber.com, mindbody, schedulicity,
  simplybook, zocdoc, "book online"/"book now"/"schedule online" text), contact form
  (`<form` with an input of type email/tel, or name containing email/phone), chat widget
  (tawk.to, intercom, drift, tidio, crisp.chat, livechat, hubspot messages, leadconnector chat
  widget, podium), viewport meta, emails (regex `[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}`
  case-insensitive, also `mailto:`; drop image names like `x@2x.png`, `sentry`, `example.com`,
  `wixpress`, `email@domain`, and keep at most 5, business domain first), socials (facebook.com,
  instagram.com, linkedin.com, twitter.com|x.com, youtube.com, tiktok.com, yelp.com,
  nextdoor.com, pinterest.com: first profile URL per network, skipping share/like links),
  copyright year (`©\s*(19|20)\d{2}` or `copyright (19|20)\d{2}`, take the max), title.
  Case-insensitive `includes` checks on a lower-cased copy; cap `html` at 200,000 chars.
- `export async function visitWebsite(url: string, fetchImpl = fetch): Promise<WebsiteFindings>`
  GET with a browser-like User-Agent, `redirect: "follow"`, `AbortSignal.timeout(12000)`,
  read at most 200 KB of the body. On a 2xx HTML page run `analyzeHtml`; if the page
  has a contact/about link on the same host and no email was found, fetch ONE more page
  (`/contact`, `/contact-us`, `/about`) — pagesChecked = 2. Non-HTML (PDF etc.) → reachable
  but nothing else. Network error/timeout → reachable 0, error text. Social-only: the final
  URL host is facebook/instagram/linktr.ee/yelp/etc. → socialOnly 1 (use SHARED_HOSTS logic
  from `src/normalize.ts` websiteDomain: if `websiteDomain(finalUrl)` is null the site is
  social-only).
- `export async function queueWebsiteAudits(env, leadIds: string[], opts?: { recheck?: boolean }): Promise<{ queued, alreadyDone, noWebsite, alreadyQueued, total }>`
  Sets `website_audit_status='queued'` on leads that have a website (skips done ones
  unless recheck). Max 1000 per call.
- `export async function runWebsiteAudits(env, limit = 8): Promise<{ done, failed, pending }>`
  Takes up to `limit` queued leads (oldest first), visits each, writes `website_audits`
  (INSERT OR REPLACE), replaces `lead_emails` rows for that lead when emails were found
  (positions 0..n), sets `leads.socials` (JSON object) when any found, sets
  `website_audit_status='done'|'failed'`, `website_audit_at`, then calls `rescoreLeads(env,[id])`
  from `src/scoring.ts`. Returns counts; `pending` = still queued. If more are pending,
  the caller (index.ts) queues another `{ audits: true }` message.
- `export async function websiteAuditStatus(env): Promise<{ queued: number, done: number }>` cheap counts.
UI needs (for the lead engineer): a "Audit websites" button on the results bar (queues the
list, confirm with counts), an "Email"/"Site" column, filters (email found, socials,
builder, ad tracking, booking, site works). Route: `POST /api/websites/audit` (ids or filters, dryRun).

---------------------------------------------------------------------------------------
## 2. Website speed  — `src/pagespeed.ts` (+ `test/pagespeed.test.ts`)

- `export function parsePageSpeed(json: unknown): { score: number|null, lcpMs: number|null, error: string|null }` PURE
  (score = round(lighthouseResult.categories.performance.score*100); lcp from
  audits['largest-contentful-paint'].numericValue; runtimeError → error).
- `export async function checkPageSpeed(url: string, apiKey: string|undefined, fetchImpl = fetch)`
  GET v5 runPagespeed with strategy=mobile&category=performance, timeout 45 s. Works
  without a key (lower quota); pass `key` when present (env.PAGESPEED_API_KEY).
- `export async function queuePageSpeed(env, leadIds: string[]): Promise<{ queued, noWebsite, alreadyDone }>`
  sets `website_audits.psi_status='queued'` (creates the audit row if missing, for leads with a website_domain).
- `export async function runPageSpeedChecks(env, limit = 3): Promise<{ done, failed, pending }>`
  slow calls, so only 3 per slice; writes psi_score/psi_lcp_ms/psi_checked_at/psi_error/psi_status,
  then `rescoreLeads`. Skip a lead whose website_audits.reachable = 0 (psi_status 'failed', error "site doesn't load").

---------------------------------------------------------------------------------------
## 3. Scores + chains  — `src/scoring.ts`, `src/chains.ts` (+ tests)

`src/scoring.ts`
- `export interface ScoreInput { isClaimed, website, websiteDomain, phone, rating, reviewCount,
   photosCount, hasHours, hasDescription, attributesCount, categoryCount, audit?: website_audits row | null }`
- `export function gbpScore(i): { score: number, comment: string, missing: string[] }` PURE, 0-100:
  claimed 20, phone 10, website 10, hours 10, description 10, photos (0:0, 1-4:5, 5-19:10, 20+:15),
  reviews (0:0, 1-9:5, 10-49:10, 50+:15), rating (≥4.5:10, 4.0-4.4:7, 3.5-3.9:4, <3.5:0),
  attributes ≥5: 5 (else 0). Comment like "Verified, 4.8★ from 120 reviews, 12 photos; missing hours and a description."
- `export function websiteScore(i): { score: number|null, ranking: string, comment: string }` PURE:
  no website → 0, ranking "No Website", comment "No website"; social-only page → 10, "Social page only";
  not visited yet → null, ranking "", comment ""; visited: loads 30 (else 0 → "Website doesn't load"),
  https 10, mobile viewport 10, contact form 10, booking 10, Meta pixel 10, Google tag 10,
  PageSpeed score (≥90:10, 50-89:5, else 0; unknown: 5); ranking: 80+ "Strong", 60-79 "Good",
  40-59 "Basic", 1-39 "Weak", 0 "No Website".
- `export function presenceScore(gbp: number, website: number|null): number` = website==null ? gbp : round(0.5*gbp + 0.5*website).
- `export function suggestions(i, gbp, web): string[]` PURE, max 5, most valuable first, plain
  sentences a sales rep can say: "Claim and verify the Google profile", "Add a website (none today)",
  "Add opening hours to Google", "Add photos (only 2 today)", "Ask happy customers for reviews (only 4 today)",
  "Fix the website: it doesn't load", "Move the website to https", "Add online booking", "Add a contact form",
  "Add a Meta pixel / Google tag to track visitors", "Speed up the website (mobile score 23/100)",
  "Reply to reviews / improve rating (3.4★)", "Add a description".
- `export async function rescoreLeads(env, leadIds: string[]): Promise<number>` reads leads (+ raw JSON for
  openingHours/description via `KEPT_RAW_FIELDS`, + lead_attributes count, + website_audits), computes,
  writes gbp_score/website_score/presence_score/score_notes(JSON {gbpComment, websiteComment, websiteRanking, suggestions})/scored_at.
  Batches of 50 ids.
- `export async function rescoreStep(env, limit = 200): Promise<{ scored, done }>` cron: scores leads with scored_at IS NULL (paged by rowid).
Integration note: the CSV audit columns map to: Website Ranking = websiteRanking, Website Comment = websiteComment,
Website Score = website_score, GBP Score = gbp_score, GBP Comment = gbpComment, Overall = presence_score,
Suggestions = suggestions joined with "; ".

`src/chains.ts`
- `export const FRANCHISE_BRANDS: string[]` ~150 well-known US chains/franchises relevant to local services and retail.
- `export function looksLikeChain(name: string): boolean` PURE: normalised name starts with / equals a brand
  (word boundary), e.g. "Roto-Rooter Plumbing & Water Cleanup" → true, "Joe's Rooter" → false.
- `export async function runChainDetection(env, limit = 500): Promise<{ scanned, done }>`
  resumable over `leads` by rowid (marker `app_settings.chains_rowid`): is_chain = 1 when
  looksLikeChain(name) OR the website_domain appears on ≥3 leads in ≥3 different cities OR the
  normalised name appears in ≥5 different cities; else 0. When the marker reaches the end set it to 'done';
  `resetChainDetection(env)` sets it back to 0 (call after big pulls; index.ts does this when a pull finishes).

---------------------------------------------------------------------------------------
## 4. Do-not-contact list  — `src/suppress.ts` (+ `test/suppress.test.ts`)

- `export function parseSuppressionText(text: string): { phones: string[], emails: string[], domains: string[] }` PURE:
  accepts pasted lines / CSV cells; phones via `toE164` (US default), emails lower-cased, domains via `websiteDomain`.
- `export async function addSuppressions(env, items: {kind, value, reason, note?}[], addedBy: string|null): Promise<{ added, matchedLeads }>`
  INSERT OR IGNORE, then `applySuppressions(env, { kinds: …, values: … })`.
- `export async function removeSuppression(env, id: number)` then recompute the leads that matched that value (set NULL where no other match).
- `export async function applySuppressions(env, leadIds?: string[]): Promise<number>` sets `leads.suppressed` =
  reason of the first matching suppression (phone → gbp_phone_formatted, domain → website_domain, cid → cid,
  email → any lead_emails row), NULL otherwise. Without ids: resumable full pass in pages of 500 by rowid.
- `export async function listSuppressions(env, params): Promise<{ total, results }>` (search, kind, page of 100).
- `export async function suppressionSummary(env): Promise<{ total, byReason: Record<string, number> }>`.
Integration: ingest calls `applySuppressions(env, newLeadIds)`; GHL push adds `sent_to_ghl` suppressions
(phone + domain) for sent contacts; the list filter "Hide do-not-contact" (default ON) = `l.suppressed IS NULL`.

---------------------------------------------------------------------------------------
## 5. Send to GoHighLevel  — `src/ghl.ts` (+ `test/ghl.test.ts`)

Secrets: `env.GHL_API_KEY` (Private Integration token), `env.GHL_LOCATION_ID`. Settings in app_settings:
`ghl_pipeline_id`, `ghl_stage_id`, `ghl_default_tags` (comma list).
- `export function ghlConfigured(env): boolean`
- `export function leadToGhlContact(lead, emails: string[], tags: string[], locationId): object` PURE, the upsert body
  (name = business name, companyName, phone E.164, email = first email, address1/city/state/postalCode/country,
  website, source "Lead Finder", tags, and customFields only if configured). Country: 2-letter.
- `export async function ghlRequest(env, method, path, body?)` adds headers (Authorization Bearer, Version), maps
  429/5xx to a retryable error and 4xx to a permanent one, 20 s timeout.
- `export async function listPipelines(env): Promise<{ id, name, stages: {id,name}[] }[]>`
- `export async function createGhlJob(env, leadIds: string[], opts: { tags?: string[], pipelineId?, stageId?, createdBy })`
  → inserts ghl_jobs + ghl_job_leads (skips leads already sent unless opts.resend, and suppressed ones with reason
  client/dnc → status 'skipped'), returns { id, total, skipped }.
- `export async function runGhlJob(env, jobId, limit = 15): Promise<{ sent, failed, skipped, remaining }>`
  upsert contact (dedupe by phone/email is GHL's), then add tags if the contact existed, then create an
  opportunity when pipeline/stage are set; write ghl_contact_id/ghl_sent_at on the lead, add `sent_to_ghl`
  suppressions (phone + domain) via `addSuppressions`, update job counters; on a retryable error stop the slice
  (leave rows queued); on a permanent error mark the row failed with a plain message. When remaining = 0 mark
  the job done and `notify` (info) "Sent N businesses to GoHighLevel".
- `export async function syncGhlContactsToSuppressions(env, limit = 100): Promise<{ imported, more: boolean }>`
  pages through GHL contacts (startAfterId stored in app_settings `ghl_sync_cursor`) adding `in_ghl` suppressions
  for their phones/emails; resumable; `more` = keep going next slice.
- `export async function listGhlJobs(env)`.
Routes needed: GET /api/ghl/status, GET /api/ghl/pipelines, PUT /api/ghl/settings (super admin), POST /api/ghl/send
(ids or filters, dryRun), GET /api/ghl/jobs, POST /api/ghl/sync-contacts.

---------------------------------------------------------------------------------------
## 6. Saved searches + alerts  — `src/saved-searches.ts` (+ `test/saved-searches.test.ts`)

- `export async function saveSearch(env, name, request: FindRequest, createdBy)`; `listSavedSearches(env)`;
  `deleteSavedSearch(env, id)`; `setSavedSearchAlert(env, id, on: boolean)`; `touchSavedSearchRun(env, id)`.
- `export async function checkSavedSearchAlerts(env): Promise<{ checked, alerts }>` at most once every 7 days
  (marker `app_settings.saved_search_check_at`): for each saved search with alert_new = 1, sum the DataForSEO
  counts of its type × place combinations (`countBusinesses` from `src/count.ts`, only within budget: stop when
  `monthSpend(env).left < 0.0124 * combos`), compare with last_count; when higher, `notify` (info,
  dedupeKey `saved-new-<id>-<week>`): "About 12 new plumbers appeared in Orlando, FL since 12 Sep. Run the search
  to collect them." Store last_count/last_count_at/last_alert_at.
- `export function describeRequest(req: FindRequest): string` PURE: "Plumber, Roofer in Orlando, FL and 2 more (up to 100)".

---------------------------------------------------------------------------------------
## 7. Radius search  — owner edits `src/find.ts`, `src/pipeline.ts`, `src/apify.ts`, `src/count.ts`, `src/geo.ts` ONLY

- `FindLocation` gains `radiusMiles?: number` (5, 10, 25, 50). Only with a city. `resolvePlace` looks up the
  city's lat/lng in `geo_cities` (name + region + country; if several, the most populous) → `ResolvedPlace`
  gains `radiusMiles?, lat?, lng?`; label "within 25 mi of Orlando, FL". Unknown city → the place is dropped
  (reported in unknownPlaces).
- `findRecentPulls(env, category, city, state, countryCode, radiusMiles?)`: a radius search only reuses pulls with
  the same radius (searches.radius_miles), and a plain city search only reuses non-radius ones.
- `createSearch` input gains `radiusMiles?, centerLat?, centerLng?`; stored on searches; `ScrapeRequest` gains
  `radiusKm?, lat?, lng?`; compass input uses `customGeolocation` (circle) INSTEAD of `locationQuery` — use the exact
  shape from the research facts in `docs/features-research.json`.
- `CountQuestion` gains `lat?, lng?, radiusKm?` → DataForSEO `location_coordinate: "lat,lng,radiusKm"` INSTEAD of the
  region/city filters (see `src/providers/dataforseo-listings.ts` for the format); `countKey` includes them.
- History/progress labels: `placeLabel` must show "within 25 mi of Orlando, FL": add `radius_miles` to the
  search rows the API returns (it's a column, so `SELECT s.*` already has it).
- Tests: `test/radius.test.ts` for label/key/input building (pure parts).

---------------------------------------------------------------------------------------
## 8. Audit report page  — `src/report.ts` (+ `test/report.test.ts`)

- `export function renderReport(lead: LeadForReport, agency: AgencySettings): string` PURE HTML (self-contained,
  print-friendly, light theme, no external scripts; same look as the app: system font, cards, score rings via CSS).
  Sections: header (business name, category, city; "Online presence check, <date>"), three big scores
  (Google profile, Website, Overall) with a one-line verdict each, "What's working" / "What's missing" checklists
  (from score notes + audit row), "What we'd fix first" (suggestions), agency block (name, phone, email, website,
  blurb) and a footer "Prepared by <agency> with Lead Finder". Escape everything.
- `export async function ensureReportToken(env, leadId): Promise<string>` creates `report_token` (32 hex) if missing.
- `export async function loadReport(env, token): Promise<{ lead, agency } | null>` joins leads + website_audits +
  lead_attributes count + app_settings agency_*; `null` for an unknown token.
Routes: `POST /api/leads/:id/report` (signed in; returns { url }), `GET /r/:token` (PUBLIC, no sign-in;
`Cache-Control: private, max-age=0`; 404 page for unknown tokens). The public path must be added to PUBLIC_PATHS
handling in index.ts (prefix match `/r/`).
