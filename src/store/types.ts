// What the store Worker is given by Cloudflare (see wrangler.store.jsonc): the shared database
// and the team's time zone. Nothing else from the internal app (no API keys, no queues).
export interface StoreEnv {
  DB: D1Database;
  LEAD_TIMEZONE?: string;
}

/** An error shown to the customer as-is, with its HTTP status. */
export class StoreError extends Error {
  constructor(message: string, readonly status: 400 | 401 | 402 | 403 | 404 | 409 | 429 = 400) {
    super(message);
  }
}
