// Node entry for the Reframe brain (used by eval.ts). The logic lives in brain-core.ts,
// which the Worker and the browser also use, so all three behave the same.
import Anthropic from "@anthropic-ai/sdk";
import { BETA, runBrain, type ReframeResult } from "./brain-core.ts";

export * from "./brain-core.ts";

// Reads the key from REFRAME_API_KEY (ANTHROPIC_API_KEY is reserved in some environments), falling back to ANTHROPIC_API_KEY.
export function createClient(): Anthropic {
  const apiKey = process.env.REFRAME_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Set REFRAME_API_KEY (or ANTHROPIC_API_KEY)");
  return new Anthropic({ apiKey, baseURL: "https://api.anthropic.com" });
}

export function reframeThought(client: Anthropic, thought: string): Promise<ReframeResult> {
  return runBrain(thought, (body) => client.beta.messages.create({ ...body, betas: [BETA] } as any));
}
