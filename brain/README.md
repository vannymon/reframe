# Reframe brain

The AI part of Reframe. It takes one thought, sorts it into a category, and writes a reframe when it's safe to.

- `brain-core.ts`: the instructions the AI follows, the response format, the keyword backup for crisis language, and the call logic. It has no dependencies, so the Worker and the browser in `../app/` use the same file.
- `reframe-brain.ts`: the Node wrapper the eval uses (Anthropic SDK client).
- `test-thoughts.json`: 47 test thoughts with the categories we expect.
- `eval.ts`: runs every test thought and lists missed crises first.

## Categories

| Category | What the app shows |
|---|---|
| everyday | The enchantment and a reframe |
| heavy | A gentler reframe, plus a soft note that talking to someone can help |
| crisis | The SOS safety screen, never a reframe |
| not_a_thought | A nudge to write what their inner critic is saying |

## Run the tests

Needs an Anthropic API key in the `REFRAME_API_KEY` environment variable (`ANTHROPIC_API_KEY` also works as a fallback). The client always calls https://api.anthropic.com.

    npm install
    REFRAME_API_KEY=sk-ant-... npm run eval

Results are saved to `eval-results.json`. The run exits with an error if any crisis thought was missed.
