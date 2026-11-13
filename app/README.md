# Reframe app

One Cloudflare Worker serves the page and the `/api/reframe` endpoint. The AI logic is shared with the brain in `../brain/brain-core.ts`, so the Worker, the browser and the eval all behave the same.

## How a thought travels

- **Free version (default):** page → this Worker → Anthropic, on your key. The Worker reads the thought, calls Claude and returns the result. It does not log or store the thought, the visitor's IP or anything else. Worker logs are turned off in `wrangler.toml`.
- **Llama or Qwen (picked in the footer's model setting):** page → this Worker → Cloudflare Workers AI for the words, and Anthropic (Claude Haiku 5.5, on your key) for the safety check, both at once. Nothing is logged or stored either way.
- **Visitor's own key (optional):** page → Anthropic directly. The key stays in that browser tab (sessionStorage) and is forgotten when the tab closes. It never reaches the Worker. If the key is rejected, that thought quietly uses the free version instead.

## Picking a model, and keeping it safe

Visitors pick Claude (free tier, the default), Llama (`LLAMA_MODEL`, Llama 3.3 70B), Qwen (`QWEN_MODEL`, Qwen 3.8 27B) or Claude with their own key. The choice is remembered in their browser.

An open model never decides on its own whether a thought is safe. For Llama and Qwen, every thought goes through:

1. the keyword net (kms, unalive, kill myself and the rest), on the full text, as for Claude;
2. Claude Haiku 5.5 with the same instructions, which sets the category;
3. the open model's own category, which can only make things more cautious: if it says crisis or harm, that wins.

The open model's words are shown only when the thought is safe to reframe and its line follows the style rules. Otherwise Claude's line is shown, and the page says so. If Claude can't be reached, nothing from the open model is shown (keyword hits still get the safety screen). The logic is `runOpenBrain` in `../brain/brain-core.ts`, with tests in `../brain/open-brain.test.ts`.

**Workers AI cost:** on the Workers Free plan you get 10,000 neurons a day, shared by Llama and Qwen. A Llama reframe uses about 100 and a Qwen reframe about 250 (Qwen reasons first), so roughly 40 to 90 a day. After that Workers AI returns errors until midnight UTC and Claude writes those reframes instead. It never bills on the Free plan. If you move to Workers Paid, it bills $0.011 per 1,000 neurons above the free amount.

## Cost limits

- **Per visitor:** 5 thoughts a minute (`[[ratelimits]]` in `wrangler.toml`). The visitor is identified by a hash of their IP, held only in Cloudflare's short-lived rate-limit counters.
- **Everyone combined, in dollars:** `DAILY_BUDGET_USD` per day on your key (default `3`, Singapore date). After every reply the Worker reads the token usage Anthropic reports and adds up the real cost at list prices (Opus 5.5: $4 per million input tokens, $20 per million output). While a request is in flight it holds back $0.055, the most one reply can cost, so a burst of visitors can't push the day over. Once the budget is reached, visitors see "come back tomorrow" plus the option to use their own key. Visitors using their own key don't count.
- **Everyone combined, by count:** `DAILY_CAP` thoughts a day (default 500) as a second net. Set it to `"0"` to turn it off.
- **"Left today" line:** `GET /api/status` returns `{"left": N}`, the estimated number of free reframes left today (budget left divided by today's average cost). The page shows it above the privacy note and updates it after each reframe. It only shows a count, never dollars.
- **Llama and Qwen:** each thought's safety check on Claude Haiku costs about $0.0003 and comes out of the same daily budget (it holds $0.002 while in flight). It doesn't count toward `DAILY_CAP` or the "left today" number.
- Crisis language always gets the safety screen, even when someone is rate limited, over the cap, or the AI is down.
- Also set a monthly spend limit on your key in the Anthropic Console (Settings → Limits). That is the real backstop.

## Deploy

    npm install
    npx wrangler login
    npx wrangler secret put REFRAME_API_KEY   # paste your Anthropic key
    npm run deploy

Your site is then at `https://reframe.<your-subdomain>.workers.dev`.

Workers AI needs no extra setup: the `[ai]` binding in `wrangler.toml` is created on deploy.

## Compare the models

From `../brain/`, with an Anthropic key and a Cloudflare API token that has Workers AI permissions:

    npm test                      # safety rules for open models, no network
    REFRAME_API_KEY=... CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... npm run eval:models

## Run locally

    echo "REFRAME_API_KEY=sk-ant-..." > .dev.vars
    npm run dev        # http://localhost:8787 (Llama and Qwen need `npx wrangler login` first, since Workers AI runs remotely)

## Files

- `worker/index.ts`: the API, rate limits, daily budget and `/api/status`.
- `web/index.html`, `web/app.ts`: the page (from the live test, with the own-key setting added).
- `build.mjs`: bundles the page into `dist/`.
