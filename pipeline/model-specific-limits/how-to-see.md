# How To See: Model-Specific Limits

## Live Dashboard

Open:

```text
http://127.0.0.1:8787
```

When Claude's latest `/usage` capture includes a model-specific cap such as `Current week (Fable)`, the Claude Code card shows a `model-specific limits` section below the account-wide limits/pacing area.

## API Check

Open:

```text
http://127.0.0.1:8787/api/state
```

Each tool object includes `modelLimits`. It is an empty array when the current reading has no model-specific caps.

## Test Fixture Proof

Run:

```sh
node --test tests/claude-refresh-parse.test.js tests/hosts-client.test.js
```

Those tests parse the real Fable fixture and verify the browser render path for the model-specific section.
