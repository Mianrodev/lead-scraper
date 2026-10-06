# Launching the store: the accounts and keys

Everything is built. Each feature below stays **off** until its keys are added, and turns on by
itself once they are. The Admin page (Admin → Online store → "Ready to sell?") shows what's
done. Keys are added as Worker secrets (never put them in the code, chat or the repo):

```
npx wrangler secret put NAME -c wrangler.store.jsonc
```

It asks for the value; paste it and press Enter. "Store address" below means your store's
address, e.g. `https://lead-store.dev1-024.workers.dev` or your own domain later.

## 1. Card payments (Stripe)

1. Make an account at stripe.com and finish "Activate payments" (business details, bank account).
2. Developers → API keys → copy the **Secret key** (`sk_live_...`).
   `npx wrangler secret put STRIPE_SECRET_KEY -c wrangler.store.jsonc`
3. Developers → Webhooks → **Add endpoint**:
   - Endpoint URL: `<store address>/api/stripe/webhook`
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`
   - Copy its **Signing secret** (`whsec_...`).
   `npx wrangler secret put STRIPE_WEBHOOK_SECRET -c wrangler.store.jsonc`
4. Settings → Emails → turn on **successful payment receipts** (Stripe emails the receipt).
5. Admin page → Online store → **Selling credits**: add your packs (e.g. 100 credits for $50).

To try it first, use the **test mode** keys (`sk_test_...`, and a webhook made in test mode) and
Stripe's test card 4242 4242 4242 4242; then swap in the live keys.

How it works: the customer picks a pack → pays on Stripe's own page (no card details touch our
app) → Stripe tells the store → the credits are added once, with a line in their history, and you
get a note on the bell in Lead Finder.

## 2. Emails (Resend): forgot password and "confirm your email"

1. Make an account at resend.com.
2. Domains → add your domain (e.g. `yourdomain.com`) and add the DNS records it shows
   (in Cloudflare → your domain → DNS). Wait until it says Verified.
3. API Keys → create one with "Sending access".
   `npx wrangler secret put RESEND_API_KEY -c wrangler.store.jsonc`
4. Admin page → Online store → **Send emails from**: e.g. `Miami Goes Local <hello@yourdomain.com>`
   (the part after @ must be the domain you verified).

Once on: "Forgot your password?" emails a link (works once, for 60 minutes), and people who sign
up get a "confirm your email" link and can unlock leads once they've clicked it. Customers who
signed up before this count as confirmed; team members added by an account owner don't need it.

## 3. Spam protection (Cloudflare Turnstile, free)

1. Cloudflare dashboard → Turnstile → **Add widget**: any name, add your store's domain
   (and `lead-store.dev1-024.workers.dev` while you use that), mode "Managed".
2. Copy the **Site key** and the **Secret key**:
   `npx wrangler secret put TURNSTILE_SITE_KEY -c wrangler.store.jsonc`
   `npx wrangler secret put TURNSTILE_SECRET_KEY -c wrangler.store.jsonc`

Sign-up and "forgot password" then show a small "I'm human" check.

## 4. Your own web address

1. The domain must be in your Cloudflare account (buy it in Cloudflare → Domain Registration,
   or move an existing one's DNS to Cloudflare).
2. Workers & Pages → **lead-store** → Settings → Domains & Routes → **Add** → Custom domain →
   e.g. `leads.yourdomain.com`.
3. Admin page → Online store → **Store web address**: `https://leads.yourdomain.com`.
4. If Stripe and Turnstile were set up with the old address, update the webhook URL (step 1.3)
   and add the new domain to the Turnstile widget (step 3.1).

## 5. Before opening the doors

- Cloudflare → Workers plans → **Workers Paid** ($5 a month): the free plan's daily database
  limits are too small for public customers. Then tick it on the Admin page.
- Have a lawyer check the Terms, Privacy and "Do not sell" pages (they're drafts), reselling
  Google data, state data-broker registration and texting consent. Then tick it on the Admin page.
- Set the support email, what one credit is worth, and your brand on the Admin page.
- Tick **New companies can sign up**, and on launch day **Let search engines list the public
  website**.
