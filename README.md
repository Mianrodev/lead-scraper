# Lead Scraper

Internal Google Business Profile lead scraper: Cloudflare Workers + D1 + Apify.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars      # add APIFY_API_TOKEN, or set APIFY_MOCK=1 to use the fixture dataset
npm run db:migrate:local
npm run dev                          # http://127.0.0.1:8787
```

Start a search, then poke it (or wait for the minute cron; locally hit `/__scheduled`):

```bash
curl -X POST localhost:8787/api/search -H "content-type: application/json" \
  -d '{"category":"plumbers","city":"Orlando, FL"}'
curl -X POST localhost:8787/api/searches/<id>/sync
curl "localhost:8787/api/leads?search_id=<id>"
```

`POST /api/search` body: `category`, `city` (e.g. `"Orlando, FL"`), optional `state`, `maxResults`
(default 500; above that needs `"allowLarge": true`, hard ceiling 10,000), `sourceCode` (default `ILS`),
`skipPhoneLookup`.

## How a search flows

1. `POST /api/search` inserts a `searches` row and starts the Apify actor run (`status = scraping`).
2. A cron trigger every minute (or `POST /api/searches/:id/sync`) polls the run. On success it
   ingests the dataset: only claimed/verified, not-permanently-closed places are kept, upserted
   into `leads` on `google_place_id`. Re-scrapes refresh Google fields but never touch enrichment,
   status, source code or first-seen dates. `search_leads` records which searches surfaced each lead.
3. Apify spend for the run is stored in `searches.cost_apify`.

## Deploy

```bash
npx wrangler d1 create lead-scraper-db   # put the id into wrangler.jsonc
npm run db:migrate:remote
npx wrangler secret put APIFY_API_TOKEN
npm run deploy
```

Then put the Worker's hostname behind a Cloudflare Access application before using it; the Worker
itself has no login.

## Tests

```bash
npm test
npm run typecheck
```
