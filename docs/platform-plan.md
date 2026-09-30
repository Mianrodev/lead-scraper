# Lead platform (public, self-serve) — Part A contract

Builds on docs/store-api.md (read it first). Model: Targetron-style data (search with counts
upfront, pay per lead, free monthly allowance, map search, exports) plus our scores and
website insights. Same store Worker (`src/store/*`, `wrangler.store.jsonc`), same database.

## URLs (store Worker)

Public website (server-rendered HTML, `src/store/site.ts`, mounted by `mountSite(app)` from
`src/store/site-routes.ts`; same Goes Local look as `src/store/page.ts`: cream #FBF5EA, navy
#12263F text, brand color accent (default #E4572E), Fraunces headings + Inter text, white
cards r=14, pill buttons; brand name/logo/color from `storeBrand(env)`):
- `/` home: hero ("Find local businesses that need what you sell"), live stats, how it works
  (search -> see counts free -> unlock), what's in a lead (phone, email, owner, website, score,
  what to fix), sample catalog links, pricing teaser, FAQ teaser, CTA to `/app#signup`.
- `/pricing`: free allowance per month, standard vs premium price in credits (from settings),
  "card payments coming soon — contact <supportEmail> to buy credits" until Stripe exists.
- `/faq`, `/contact` (support email as mailto), `/legal/terms`, `/legal/privacy`,
  `/legal/do-not-sell` (drafts, visibly marked "Draft: to be reviewed by a lawyer").
- `/remove`: "Remove my business" form -> `POST /api/remove-request` (public).
- Catalog (SEO): `/leads` (states), `/leads/:st` (cities in a state), `/leads/:st/:city`
  (categories in a city), `/leads/:st/:city/:cat` (count, % with phone/email/website/owner,
  average score, up to 12 sample business names (no contact details), CTA "See all N in the app"
  -> `/app#find?state=..&city=..&category=..`). Slugs: state = lowercase 2 letters; city and
  category = lowercase, non-alphanumerics -> "-".
- `/robots.txt`, `/sitemap.xml` (catalog + site pages). While setting `store_public_pages` is
  not "1", every page sends `X-Robots-Tag: noindex, nofollow` and robots.txt disallows all.
- `/app` = the customer app (`storeHtml`, src/store/page.ts). `/` no longer serves the app.

## Data functions (src/store/public.ts, all cached, sellable leads only)

```ts
export function slug(s: string): string
export async function publicStats(env): Promise<{ businesses: number; withPhone: number; withEmail: number; withWebsite: number; withOwner: number; states: number; categories: number }>
export async function catalogStates(env): Promise<{ st: string; name: string; n: number }[]>
export async function catalogCities(env, st: string): Promise<{ city: string; slug: string; n: number }[]>          // [] if unknown
export async function catalogCategories(env, st: string, citySlug: string): Promise<{ city: string; categories: { category: string; slug: string; n: number }[] } | null>
export async function catalogPage(env, st: string, citySlug: string, catSlug: string): Promise<null | {
  st: string; stateName: string; city: string; category: string; n: number;
  withPhone: number; withEmail: number; withWebsite: number; withOwner: number; avgScore: number | null;
  samples: { name: string; rating: number | null; reviews: number | null; score: number | null }[] }>
export async function publicPrices(env): Promise<{ free: number; google: number; freePerMonth: number }>
export async function saveRemovalRequest(env, input: {...}, ip: string): Promise<{ ok: true }>
```
`storeBrand(env)` is in `src/store/brand.ts` -> `{ name, color, logoUrl, supportEmail, signupOpen, signupMode, publicPages }`.

## App additions (customer API)

- Sign-up modes (`store_signup_mode`): `open` = account active at once (default for self-serve),
  `approval` = pending until the owner approves. `store_signup_open` = "0" still closes sign-ups.
- Free allowance (`store_free_per_month`, default 50): the first N leads each calendar month
  (UTC) are free (any type); then credits. `GET /api/me` adds
  `free: { perMonth, used, left }` and `user.role` ('owner' | 'member').
- `POST /api/buy` dry run adds `freeLeads` (how many the allowance covers); `credits` is what's
  left to pay. Real purchase result adds `freeLeads`.
- `GET /api/map?<filters>` -> `{ points: [{ id, name, lat, lng, score, tier, owned }], total, capped }` (max 3,000).
- `GET /api/download?format=simple|cold_email|json[&ids=]`.
- Saved searches: `GET /api/saved` -> `[{ id, name, query, createdAt }]`; `POST /api/saved { name, query }` -> `{ id }`; `DELETE /api/saved/:id`.
- Team: `GET /api/team` -> `[{ id, name, email, role, lastLoginAt, me }]`; owner only:
  `POST /api/team { name, email }` -> `{ password }` (temporary, shown once; they change it after
  signing in), `DELETE /api/team/:id` (not yourself).
- Public: `POST /api/remove-request { business, phone?, website?, email?, name?, contactEmail?, message? }` -> `{ ok }` (rate limited).

## Owner console additions (internal app, super admin)

- Settings: `signupMode` ('open'|'approval'), `freePerMonth` (0-10000), `publicPages` (bool).
- `GET /api/store/removals` -> `[{ id, business, phone, website, email, name, contactEmail, message, status, createdAt }]` (newest first, status new first).
- `POST /api/store/removals/:id { action: 'suppress' | 'dismiss' }` -> suppress adds the phone,
  website and email to the do-not-contact list (`addSuppressions` in src/suppress.ts, reason
  'asked_to_stop', note "Removal request from the website") and marks it done.
- Accounts list adds `freeUsed` (this month) and `role` per user.

## Tables (migration 0025_platform.sql)

- `store_accounts` + `free_period TEXT`, `free_used INTEGER NOT NULL DEFAULT 0`
- `store_users` + `role TEXT NOT NULL DEFAULT 'owner'`
- `store_saved_searches(id TEXT PK, account_id, name, query, created_at)`
- `store_removal_requests(id INTEGER PK, business, phone, website, email, name, contact_email, message, ip_hash, status 'new'|'done'|'dismissed', created_at, handled_at, handled_by)`
- settings: `store_signup_mode` 'open', `store_free_per_month` '50', `store_public_pages` '0'.
