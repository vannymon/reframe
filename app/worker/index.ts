// Reframe API. Stateless: the thought is read, sent to Claude, and forgotten.
// Nothing here logs, stores or forwards thought text, IPs or keys.
import { DurableObject } from "cloudflare:workers";
import { CRISIS_RE, CRISIS_RESULT, MAX_CHARS, anthropicCaller, prepareThought, runBrain } from "../../brain/brain-core.ts";

interface Env {
  REFRAME_API_KEY: string;
  DAILY_CAP: string;
  ALLOWED_ORIGINS: string;
  PER_VISITOR: RateLimit;
  DAILY: DurableObjectNamespace<DailyCounter>;
}

/** Counts today's model calls on the owner's key. Holds only {day, count}. */
export class DailyCounter extends DurableObject {
  async take(cap: number): Promise<boolean> {
    const day = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10); // Singapore date
    const cur = (await this.ctx.storage.get<{ day: string; count: number }>("c")) ?? { day, count: 0 };
    const count = cur.day === day ? cur.count : 0;
    if (count >= cap) return false;
    await this.ctx.storage.put("c", { day, count: count + 1 });
    return true;
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

const publicResult = (r: { category: string; reframe: string; pattern: string }) =>
  ({ category: r.category, reframe: r.reframe, pattern: r.pattern });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
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
    if (!text) return json({ category: "not_a_thought", reframe: "", pattern: "none" }, 200, cors);

    // Crisis language always gets the safety screen, even when the visitor is rate limited or the day's cap is used up.
    const keywordCrisis = CRISIS_RE.test(text);

    const { success } = await env.PER_VISITOR.limit({ key: await visitorKey(req) });
    if (!success) return keywordCrisis ? json(publicResult(CRISIS_RESULT), 200, cors) : json({ error: "rate_limited" }, 429, cors);

    const cap = Number(env.DAILY_CAP) || 0;
    const allowed = await env.DAILY.get(env.DAILY.idFromName("global")).take(cap);
    if (!allowed) return keywordCrisis ? json(publicResult(CRISIS_RESULT), 200, cors) : json({ error: "daily_cap" }, 429, cors);

    try {
      const result = await runBrain(text, anthropicCaller(env.REFRAME_API_KEY));
      return json(publicResult(result), 200, cors);
    } catch {
      // No details: an error object could carry the thought.
      return json({ error: "unavailable" }, 502, cors);
    }
  },
} satisfies ExportedHandler<Env>;
