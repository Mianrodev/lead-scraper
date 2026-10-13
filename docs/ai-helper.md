# AI helper (free)

The AI helper reads each business’s own website and fills in what’s missing:

- the owner’s name (only if it’s written on their site)
- email addresses (only ones written on their site)
- social pages (only ones their site links to)
- a short list of what they offer, a one-sentence summary, and a personal opening line for your first email

The summary, the list of services and the opening line are written by the AI, and the business window marks them “AI-written”. Read them before you send anything.

It uses Google’s Gemini, which is free within small limits (a few requests a minute and a few hundred a day; Google changes these now and then). The helper works through a few businesses each minute, up to a daily limit (200 to start; admins can change it between 10 and 1,500). If Google says the free limit is used up, the helper takes a one-hour break and then carries on by itself.

Until a key is set, the helper does nothing and nothing else is affected.

## Getting a free key

1. Go to **aistudio.google.com** and sign in with a Google account.
2. Click **Get API key**, then **Create API key**. Copy the key.
3. **Don’t add billing** (don’t set up a payment method for it). With billing turned on, Google charges for use instead of keeping it free.

## Putting the key in

In a terminal, in the `lead-scraper` folder, run:

```
npx wrangler secret put GEMINI_API_KEY
```

Paste the key when it asks and press Enter. The helper starts within a minute or two.

## If something goes wrong

- **“The Gemini key isn’t working”**: the key was deleted, mistyped or blocked. Make a new one (steps above), put it in again, then switch the helper off and on in the app so it tries straight away (otherwise it tries again by itself after 6 hours).
- **“Gemini’s free limit was reached”**: nothing to do. It carries on by itself after an hour, and the daily count starts again each day (midnight UTC). If this happens every day, lower the daily limit.

## Trying it on your own computer without a key

Add `GEMINI_MOCK=1` to `.dev.vars` and run the app locally. The helper then reads the websites for real but makes up a fixed “(Test answer)” instead of asking Gemini, so you can see the whole flow. Never set `GEMINI_MOCK` on the live app.
