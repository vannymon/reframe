# Reframe app

One Cloudflare Worker serves the page and the `/api/reframe` endpoint. The AI logic is shared with the brain in `../brain/brain-core.ts`, so the Worker, the browser and the eval all behave the same.

## How a thought travels

- **Free version (default):** page → this Worker → Anthropic, on your key. The Worker reads the thought, calls Claude and returns the result. It does not log or store the thought, the visitor's IP or anything else. Worker logs are turned off in `wrangler.toml`.
- **Visitor's own key (optional):** page → Anthropic directly. The key stays in that browser tab (sessionStorage) and is forgotten when the tab closes. It never reaches the Worker. If the key is rejected, that thought quietly uses the free version instead.

## Cost limits

- **Per visitor:** 5 thoughts a minute (`[[ratelimits]]` in `wrangler.toml`). The visitor is identified by a hash of their IP, held only in Cloudflare's short-lived rate-limit counters.
- **Everyone combined, in dollars:** `DAILY_BUDGET_USD` per day on your key (default `3`, Singapore date). After every reply the Worker reads the token usage Anthropic reports and adds up the real cost at list prices (Opus 5.5: $4 per million input tokens, $20 per million output). While a request is in flight it holds back $0.055, the most one reply can cost, so a burst of visitors can't push the day over. Once the budget is reached, visitors see "come back tomorrow" plus the option to use their own key. Visitors using their own key don't count.
- **Everyone combined, by count:** `DAILY_CAP` thoughts a day (default 500) as a second net. Set it to `"0"` to turn it off.
- **"Left today" line:** `GET /api/status` returns `{"left": N}`, the estimated number of free reframes left today (budget left divided by today's average cost). The page shows it above the privacy note and updates it after each reframe. It only shows a count, never dollars.
- Crisis language always gets the safety screen, even when someone is rate limited, over the cap, or the AI is down.
- Also set a monthly spend limit on your key in the Anthropic Console (Settings → Limits). That is the real backstop.

## Deploy

    npm install
    npx wrangler login
    npx wrangler secret put REFRAME_API_KEY   # paste your Anthropic key
    npm run deploy

Your site is then at `https://reframe.<your-subdomain>.workers.dev`.

## Run locally

    echo "REFRAME_API_KEY=sk-ant-..." > .dev.vars
    npm run dev        # http://localhost:8787

## Files

- `worker/index.ts`: the API, rate limits, daily budget and `/api/status`.
- `web/index.html`, `web/app.ts`: the page (from the live test, with the own-key setting added).
- `build.mjs`: bundles the page into `dist/`.
