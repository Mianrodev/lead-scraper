# Lead Store: design and API contract

The store is a second Cloudflare Worker (`lead-store`, config `wrangler.store.jsonc`, entry
`src/store/index.ts`) that shares the business database (D1 `DB`) with the internal app.
Customers (companies) sign up, are approved by the owner, get credits, search the database
with contact details hidden, spend credits to unlock leads, and download what they bought.
Card payments (Stripe) come later: until then the owner adds credits by hand.

## Rules

- Customers never see: the team's stages, assignments, notes, activity, reports/demo links,
  costs, search history, users, or anything from `data_source` `form` / `upload` (those are
  the agency's own requests and lists). Only `free`, `google`, `free+google` leads are sold,
  only open businesses (`business_status = 'operational'`), never do-not-contact leads.
- Tier: `free` = data_source `free`; `google` = `google` or `free+google`. Prices in credits
  (whole numbers) are in `app_settings`: `store_price_free`, `store_price_google`.
- Non-exclusive: any number of customers may buy the same lead. Buying a lead you already own
  costs nothing.
- Hidden until bought: phone, emails, owner name/title, website URL, street address.
  Shown before buying: name, category, city, state, zip, rating, review count, score,
  tier, and yes/no flags (has phone, has email, has owner, has website).

## Tables (migration 0024_store.sql)

- `store_accounts(id, company, status 'pending'|'active'|'suspended', credits INTEGER, created_at, approved_at, note)`
- `store_users(id, account_id, email UNIQUE, name, password_hash, password_salt, password_iterations, must_change_password, created_at, last_login_at)`
- `store_sessions(token_hash PK, user_id, expires_at, created_at)`
- `store_ledger(id, account_id, delta, balance, kind 'grant'|'purchase'|'refund'|'adjust', note, created_by, created_at)`
- `store_purchases(account_id, lead_id, tier, credits, purchased_at, PK(account_id, lead_id))`
- settings in `app_settings`: `store_price_free` (1), `store_price_google` (3),
  `store_brand_name` ("Lead Store"), `store_brand_color` ("#4f46e5"), `store_support_email` (""),
  `store_signup_open` ("1"), `store_welcome_credits` ("0"), `store_url` ("").

## Store API (served by the store Worker; JSON; cookie session `ls_session`)

Errors: `{ error: string }` with 4xx/5xx; 401 `{ error, signIn: true }` when signed out.
All POST/PUT/DELETE require same-origin (Origin check).

Public:
- `GET /` -> the store page (HTML, from `src/store/page.ts` `storeHtml(brand)`).
- `GET /api/brand` -> `{ name, color, supportEmail, signupOpen, prices: { free, google } }`
- `POST /api/signup` `{ company, name, email, password }` -> `{ ok: true, status: 'pending' | 'active' }`
  (account starts `pending` until the owner approves; password min 10 chars).
- `POST /api/login` `{ email, password }` -> `{ ok: true }` (sets cookie). Pending/suspended
  accounts CAN sign in but get `me.account.status` so the page can explain.
- `POST /api/logout` -> `{ ok: true }`

Signed in:
- `GET /api/me` -> `{ user: { name, email }, account: { id, company, status, credits }, prices: { free, google } }`
- `POST /api/password` `{ current, next }` -> `{ ok: true }`
- `GET /api/places` -> `{ states: [{ value, n }], cities: [{ value: "City|ST", n }] }` (cached; optional `state=FL` narrows cities)
- `GET /api/categories` -> `{ industries: [{ value, n }], categories: [{ value, n, industry }] }` (cached)
- `GET /api/leads?<filters>&page=1&page_size=50&sort=score|rating|reviews|name&dir=asc|desc` ->
  `{ total, page, pageSize, counts: { free, google }, results: [Row] }`
  Row = `{ id, name, category, city, state, zip, rating, reviews, score, tier, hasPhone, hasEmail, hasOwner, hasWebsite, owned,
          // only when owned:
          phone?, email?, owner?, ownerTitle?, website?, address? }`
  Filters (anything else is ignored): `state` (repeat), `city` ("City|ST", repeat), `industry` (repeat), `category` (repeat),
  `postal_code` (repeat), `tier` (free|google), `phone=yes`, `email=yes`, `owner=yes`, `website=yes|no|no_real`,
  `min_rating`, `min_reviews`, `max_reviews`, `score` (weak|basic|good|strong, repeat), `q` (name contains),
  `near` + `radius_miles`, `area` (map polygon "lat,lng;..."), `owned=yes|no`.
- `POST /api/buy` `{ ids?: string[], all?: boolean, dryRun?: boolean }` + the same filter query string when `all`.
  -> dry run: `{ count, alreadyOwned, free, google, credits, balance, capped }`
  -> real: `{ bought, free, google, credits, balance }`; 402 `{ error }` when not enough credits;
     403 when the account isn't active. Max 5,000 leads per purchase.
- `GET /api/my-leads?page=&page_size=&q=` -> `{ total, results: [Row with contact details], }` (newest purchases first)
- `GET /api/download?format=simple|cold_email[&ids=a,b]` -> CSV of owned leads (all, or the given ids).
- `GET /api/credits` -> `{ balance, history: [{ at, delta, balance, kind, note }] }` (last 100)

## Owner console (internal app, super admin only; `src/store/admin.ts`, routes in `src/index.ts`)

- `GET /api/store/settings` -> `{ priceFree, priceGoogle, brandName, brandColor, supportEmail, signupOpen, welcomeCredits, storeUrl }`
- `PUT /api/store/settings` same shape (validated; prices 0-1000 whole credits)
- `GET /api/store/accounts` -> `[{ id, company, status, credits, createdAt, approvedAt, users: [{ name, email }], leadsBought, creditsSpent, lastPurchaseAt }]`
- `POST /api/store/accounts/:id/status` `{ status: 'active'|'suspended' }` (approving gives `store_welcome_credits` once)
- `POST /api/store/accounts/:id/credits` `{ delta: int (+/-), note }` -> `{ balance }` (never below 0)
- `POST /api/store/accounts/:id/reset-password` `{ email }` -> `{ password }` (temporary; user must change it)
- `GET /api/store/stats` -> `{ accounts: { pending, active, suspended }, leadsSold, creditsSpent, creditsGranted, byDay: [{ day, leads, credits }] (30 days), topLeads? }`
