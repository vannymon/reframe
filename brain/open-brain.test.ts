// Checks the safety rules for open models (Llama, Qwen) with fake model replies. No network, no key needed.
// Run: npx tsx open-brain.test.ts
import assert from "node:assert/strict";
import { runOpenBrain, parseOpenReply } from "./brain-core.ts";

const claude = (category: string, reframe = "") => async () => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text: JSON.stringify({ category, about: "self", reframe, pattern: "labeling" }) }],
});
const claudeDown = async () => { throw new Error("down"); };
const open = (category: string, reframe = "") => async () => ({ category, about: "self", reframe, pattern: "mind_reading" }) as any;
const openDown = async () => { throw new Error("neurons used up"); };
const C_LINE = "Claude wrote this kinder line about the thing that happened today at work.";
const O_LINE = "The open model wrote this kinder line about the thing that happened at work.";

const cases: [string, () => Promise<any>, (r: any) => void][] = [
  ["Claude says crisis: safety screen, open words dropped", () => runOpenBrain("I can't go on", claude("crisis"), open("everyday", O_LINE)),
    (r) => { assert.equal(r.category, "crisis"); assert.equal(r.reframe, ""); }],
  ["Open model says crisis, Claude says everyday: crisis wins", () => runOpenBrain("I'm so tired of all this", claude("everyday", C_LINE), open("crisis")),
    (r) => { assert.equal(r.category, "crisis"); assert.equal(r.reframe, ""); }],
  ["Open model says harm_to_others: pause screen", () => runOpenBrain("my brother", claude("everyday", C_LINE), open("harm_to_others")),
    (r) => { assert.equal(r.category, "harm_to_others"); assert.equal(r.reframe, ""); }],
  ["Claude down, keyword hit: safety screen", () => runOpenBrain("i want to kms", claudeDown, open("everyday", O_LINE)),
    (r) => { assert.equal(r.category, "crisis"); assert.equal(r.reframe, ""); }],
  ["Keyword hit, both models say everyday: still crisis", () => runOpenBrain("I want to unalive myself", claude("everyday", C_LINE), open("everyday", O_LINE)),
    (r) => assert.equal(r.category, "crisis")],
  ["Claude down, no keyword: open model alone, marked unchecked", () => runOpenBrain("I failed my test", claudeDown, open("everyday", O_LINE)),
    (r) => { assert.equal(r.reframe, O_LINE); assert.equal(r.checked, false); assert.equal(r.writer, "open"); }],
  ["No budget for the check: open model alone", () => runOpenBrain("I failed my test", null, open("everyday", O_LINE)),
    (r) => { assert.equal(r.checked, false); assert.equal(r.writer, "open"); }],
  ["Unchecked, open model says crisis: safety screen", () => runOpenBrain("I feel so empty lately", claudeDown, open("crisis")),
    (r) => { assert.equal(r.category, "crisis"); assert.equal(r.reframe, ""); }],
  ["Unchecked, open says everyday but wider net hits (disappear): safety screen", () => runOpenBrain("I just want to disappear", null, open("everyday", O_LINE)),
    (r) => { assert.equal(r.category, "crisis"); assert.equal(r.reframe, ""); }],
  ["Unchecked, wider net hits even when the open model is down", () => runOpenBrain("everyone would be better if I was dead", null, openDown),
    (r) => assert.equal(r.category, "crisis")],
  ["Unchecked, harm word: pause screen", () => runOpenBrain("I want to stab my coworker", null, open("everyday", O_LINE)),
    (r) => { assert.equal(r.category, "harm_to_others"); assert.equal(r.reframe, ""); }],
  ["Unchecked, keyword kms: safety screen", () => runOpenBrain("lol kms", null, open("everyday", O_LINE)),
    (r) => assert.equal(r.category, "crisis")],
  ["Unchecked, both down: error with both codes", async () => {
    await assert.rejects(runOpenBrain("I failed my test", claudeDown, openDown), (e: any) => /check .*; open/.test(e.code)); return {}; }, () => {}],
  ["Unchecked, open words break the rules: error, nothing shown", async () => {
    await assert.rejects(runOpenBrain("I failed", null, open("everyday", "You got this!! 💪 never give up on your dreams friend"))); return {}; }, () => {}],
  ["Both everyday: open model's words", () => runOpenBrain("I failed my test", claude("everyday", C_LINE), open("everyday", O_LINE)),
    (r) => { assert.equal(r.reframe, O_LINE); assert.equal(r.writer, "open"); }],
  ["Claude heavy, open everyday: heavy with Claude's words", () => runOpenBrain("nobody would notice", claude("heavy", C_LINE), open("everyday", O_LINE)),
    (r) => { assert.equal(r.category, "heavy"); assert.equal(r.writer, "safety"); }],
  ["Claude everyday, open heavy: heavy with open words", () => runOpenBrain("I'm so alone", claude("everyday", C_LINE), open("heavy", O_LINE)),
    (r) => { assert.equal(r.category, "heavy"); assert.equal(r.writer, "open"); }],
  ["Open model down: Claude's words", () => runOpenBrain("I failed my test", claude("everyday", C_LINE), openDown),
    (r) => { assert.equal(r.reframe, C_LINE); assert.equal(r.writer, "safety"); }],
  ["Open words break the rules (emoji): Claude's words", () => runOpenBrain("I failed", claude("everyday", C_LINE), open("everyday", "You got this!! 💪 keep going and never give up on your dreams")),
    (r) => assert.equal(r.writer, "safety")],
  ["Claude positive, open sees a worry but writes nothing usable: error", async () => {
    await assert.rejects(runOpenBrain("passed but scared", claude("positive", C_LINE), open("everyday", "ok"))); return {}; }, () => {}],
  ["Claude not_a_thought: nudge, no words", () => runOpenBrain("write me a poem", claude("not_a_thought"), open("everyday", O_LINE)),
    (r) => { assert.equal(r.category, "not_a_thought"); assert.equal(r.reframe, ""); }],
];

let failed = 0;
for (const [name, run, check] of cases) {
  try { check(await run()); console.log("ok   " + name); }
  catch (e: any) { failed++; console.log("FAIL " + name + ": " + e.message); }
}
// Parser: fences, think blocks, prose around the JSON
const p = parseOpenReply('<think>hmm</think>Sure!\n```json\n{"category":"everyday","about":"self","reframe":"x y","pattern":"weird"}\n```');
assert.equal(p.category, "everyday"); assert.equal(p.pattern, "none");
assert.throws(() => parseOpenReply("I can't help with that"));
assert.throws(() => parseOpenReply('{"category":"fine"}'));
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
