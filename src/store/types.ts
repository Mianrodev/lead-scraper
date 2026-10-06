// What the store Worker is given by Cloudflare (see wrangler.store.jsonc): the shared database
// and the team's time zone. Nothing else from the internal app (no API keys, no queues).
export interface StoreEnv {
  DB: D1Database;
  LEAD_TIMEZONE?: string;
  // Optional secrets (wrangler secret put NAME -c wrangler.store.jsonc). Each feature stays off
  // until its keys are set: docs/launch-setup.md.
  /** Card payments for credit packs (Stripe Checkout). */
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  /** Emails (password reset, email confirmation) through Resend. */
  RESEND_API_KEY?: string;
  /** Spam protection on sign-up and "forgot password" (Cloudflare Turnstile). */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}

/** An error shown to the customer as-is, with its HTTP status. */
export class StoreError extends Error {
  constructor(message: string, readonly status: 400 | 401 | 402 | 403 | 404 | 409 | 429 = 400) {
    super(message);
  }
}
