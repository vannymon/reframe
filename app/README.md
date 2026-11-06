# Reframe app

One Cloudflare Worker serves the page and the `/api/reframe` endpoint. The AI logic is shared with the brain in `../brain/brain-core.ts`, so the Worker, the browser and the eval all behave the same.

## How a thought travels

- **Free version (default):** page → this Worker → Anthropic, on your key. The Worker reads the thought, calls Claude and returns the result. It does not log or store the thought, the visitor's IP or anything else. Worker logs are turned off in `wrangler.toml`.
- **Visitor's own key (optional):** page → Anthropic directly. The key stays in that browser tab (sessionStorage) and is forgotten when the tab closes. It never reaches the Worker. If the key is rejected, that thought quietly uses the free version instead.

## Cost limits

- **Per visitor:** 5 thoughts a minute (`[[ratelimits]]` in `wrangler.toml`). The visitor is identified by a hash of their IP, held only in Cloudflare's short-lived rate-limit counters.
- **Everyone combined:** `DAILY_CAP` thoughts a day on your key (default 300, Singapore date). After that, visitors see "come back tomorrow" plus the option to use their own key.
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

- `worker/index.ts`: the API, rate limits and daily cap.
- `web/index.html`, `web/app.ts`: the page (from the live test, with the own-key setting added).
- `build.mjs`: bundles the page into `dist/`.
