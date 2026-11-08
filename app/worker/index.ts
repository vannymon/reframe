// Reframe API. Stateless: the thought is read, sent to Claude, and forgotten.
// Nothing here logs, stores or forwards thought text, IPs or keys.
import { DurableObject } from "cloudflare:workers";
import { CRISIS_RESULT, hasCrisisWords, MAX_CHARS, anthropicCaller, prepareThought, runBrain } from "../../brain/brain-core.ts";

interface Env {
  REFRAME_API_KEY: string;
  DAILY_BUDGET_USD: string;
  DAILY_CAP: string;
  ALLOWED_ORIGINS: string;
  PER_VISITOR: RateLimit;
  DAILY: DurableObjectNamespace<DailyCounter>;
}

// Anthropic list prices in US dollars per million tokens. A refusal can fall back to another model, so price by the model that answered.
// An unknown model is priced at the most expensive rate, so a surprise never undercounts.
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};
const PRICIEST = { input: 10, output: 50 };

/** Real cost of one response in micro-dollars, from the usage the API reports. */
export function costMicros(res: any): number {
  const u = res?.usage ?? {};
  const p = PRICES[String(res?.model ?? "").replace(/-\d{8}$/, "")] ?? PRICIEST;
  const tokens = (n: unknown) => (typeof n === "number" && n > 0 ? n : 0);
  const inputMTok =
    tokens(u.input_tokens) + tokens(u.cache_creation_input_tokens) * 1.25 + tokens(u.cache_read_input_tokens) * 0.1;
  return Math.ceil(inputMTok * p.input + tokens(u.output_tokens) * p.output); // tokens x $/MTok = micro-dollars
}

// Held back while a request is in flight: about 2.5k input tokens plus the full 2,048 output tokens on Opus 5.5, rounded up.
// This stops a burst of parallel requests from going over the budget.
const RESERVE_MICROS = 55_000;
// Used for the "left today" estimate until a few real requests have been counted.
const TYPICAL_MICROS = 15_000;

type Day = { day: string; spent: number; held: number; count: number };
const sgDate = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10); // Singapore date

/** Tracks today's spend on the owner's key. Holds only {day, spent, held, count}: no thoughts, no visitors. */
export class DailyCounter extends DurableObject {
  private async today(): Promise<Day> {
    const day = sgDate();
    const cur = await this.ctx.storage.get<Day>("d");
    return cur && cur.day === day ? cur : { day, spent: 0, held: 0, count: 0 };
  }

  private left(d: Day, budget: number, cap: number): number {
    const avg = d.count >= 5 ? d.spent / d.count : TYPICAL_MICROS;
    // reserve() needs a full hold's worth of room for the last one, so count that one separately.
    const room = budget - d.spent - d.held - RESERVE_MICROS;
    let n = room < 0 ? 0 : Math.floor(room / Math.max(avg, 1)) + 1;
    if (cap > 0) n = Math.min(n, Math.max(0, cap - d.count));
    return n;
  }

  /** Holds money for one request. Returns false when today's budget or count cap is used up. */
  async reserve(budget: number, cap: number): Promise<{ ok: boolean; day: string; left: number }> {
    const d = await this.today();
    if (d.spent + d.held + RESERVE_MICROS > budget || (cap > 0 && d.count >= cap)) return { ok: false, day: d.day, left: 0 };
    d.held += RESERVE_MICROS;
    await this.ctx.storage.put("d", d);
    return { ok: true, day: d.day, left: this.left(d, budget, cap) };
  }

  /** Swaps the hold for what the request really cost (0 if the call never reached the model). */
  async settle(day: string, actual: number, budget: number, cap: number): Promise<number> {
    const d = await this.today();
    if (d.day === day) {
      d.held = Math.max(0, d.held - RESERVE_MICROS);
      d.spent += actual;
      if (actual > 0) d.count += 1;
      await this.ctx.storage.put("d", d);
    }
    return this.left(d, budget, cap);
  }

  async status(budget: number, cap: number): Promise<{ left: number; spentUsd: number }> {
    const d = await this.today();
    return { left: this.left(d, budget, cap), spentUsd: Math.round(d.spent / 1e4) / 100 };
  }
}

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });

function corsHeaders(req: Request, env: Env): Record<string, string> | null {
  const origin = req.headers.get("origin");
  if (!origin) return {}; // same-origin GETs and non-browser clients
  const self = new URL(req.url).origin;
  const allowed = [self, ...env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)];
  if (!allowed.includes(origin)) return null;
  return { "access-control-allow-origin": origin, vary: "origin" };
}

async function visitorKey(req: Request): Promise<string> {
  // Hash the IP so the raw address is never used as a key anywhere.
  const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("reframe:" + ip));
  return btoa(String.fromCharCode(...new Uint8Array(digest).slice(0, 12)));
}

const publicResult = (r: { category: string; reframe: string; pattern: string; about: string }) =>
  ({ category: r.category, reframe: r.reframe, pattern: r.pattern, about: r.about });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const budget = Math.round((Number(env.DAILY_BUDGET_USD) || 0) * 1e6);
    const cap = Number(env.DAILY_CAP) || 0;
    const counter = () => env.DAILY.get(env.DAILY.idFromName("global"));

    if (url.pathname === "/api/status") {
      // How many free reframes are left today, for everyone combined. Spend is shown to nobody; only the count.
      if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      const { left } = await counter().status(budget, cap);
      return json({ left });
    }
    if (url.pathname !== "/api/reframe") return json({ error: "not_found" }, 404);

    const cors = corsHeaders(req, env);
    if (!cors) return json({ error: "forbidden_origin" }, 403);
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { ...cors, "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" },
      });
    }
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);

    let thought: unknown;
    try {
      thought = ((await req.json()) as any)?.thought;
    } catch {
      return json({ error: "bad_request" }, 400, cors);
    }
    if (typeof thought !== "string" || thought.length > MAX_CHARS * 2) return json({ error: "bad_request" }, 400, cors);
    const text = prepareThought(thought);
    if (!text) return json({ category: "not_a_thought", reframe: "", pattern: "none", about: "self" }, 200, cors);

    // Crisis language always gets the safety screen, even when the visitor is rate limited or the day's cap is used up.
    const keywordCrisis = hasCrisisWords(thought);

    const { success } = await env.PER_VISITOR.limit({ key: await visitorKey(req) });
    if (!success) return keywordCrisis ? json(publicResult(CRISIS_RESULT), 200, cors) : json({ error: "rate_limited" }, 429, cors);

    const hold = await counter().reserve(budget, cap);
    if (!hold.ok) return keywordCrisis ? json(publicResult(CRISIS_RESULT), 200, cors) : json({ error: "daily_cap", left: 0 }, 429, cors);

    // Wrap the caller so the real token usage of every response is counted, including a failed parse after a good call.
    let spent = 0;
    const call = anthropicCaller(env.REFRAME_API_KEY);
    const counted = async (body: unknown) => {
      const res = await call(body);
      spent += costMicros(res);
      return res;
    };
    try {
      const result = await runBrain(thought, counted); // the brain checks the full text, then trims it
      const left = await counter().settle(hold.day, spent, budget, cap);
      return json({ ...publicResult(result), left }, 200, cors);
    } catch {
      await counter().settle(hold.day, spent, budget, cap);
      // No details: an error object could carry the thought.
      return json({ error: "unavailable" }, 502, cors);
    }
  },
} satisfies ExportedHandler<Env>;
