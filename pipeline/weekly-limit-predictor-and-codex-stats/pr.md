## Weekly Limit Predictor & Codex Stats

### What this does
Each tool now shows both its 5-hour **and** weekly pacing at the same time: a
per-window row in the burn callout with a plain-language status and a tinted pill
(on pace / at risk / limit reached). A maxed window reads "limit reached" on its
own row without hiding the other window. Separately, Codex token stats are now
populated for the first time: the dashboard's "not available" state was a parser
bug, not missing data.

### What changed
- **`src/stats.js`** — generalized `projectFiveHour` into
  `projectWindow(usedPct, resetsAtMs, nowMs, windowHours)`; kept `projectFiveHour`
  as an alias. Window length is a code constant (5h / 168h), not stored data.
- **`src/server.js`** — `toolWrap` now returns
  `projection: { five_hour, seven_day }` (null per window when there's no reading
  or no reset time). `computeHeadroom` already spanned both windows — unchanged.
  Exported `toolWrap` for testing.
- **`public/app.js`** — `burnHtml` renders two pacing rows (5-hour + weekly) via a
  new `pacingLine`, each with per-window "limit reached" precedence and an honest
  "not available" fallback. `mixHtml` is cache-model aware (Codex: cached ⊆ input).
- **`public/styles.css`** — added the status-pill component (`.burn-pill`,
  `.pill-*`) and `--good-bg` / `--crit-bg` tokens; `.burn` stacks vertically. This
  is a deliberate design-system evolution (see `decisions.md` DS-01).
- **`src/codex-stats.js`** — fixed `usageFromEvent` to read
  `payload.info.last_token_usage`; corrected the accounting because Codex's
  `cached_input_tokens` is a **subset** of `input_tokens` (Anthropic's are
  disjoint): total = input + output, cache hit rate = cached/input, cost bills
  non-cached input at the input rate and cached at the cache-read rate. Resolves
  the per-session model (gpt-5.5) from `turn_context` for pricing.
- **`src/trends.js`** — Codex daily buckets use UTC day boundaries and show input
  as the non-cached part (consistent with the mix bar). `dailySeries` gained an
  optional `opts` arg ({ utc, subset }) — backward compatible.
- **Tests** — updated Codex tests to the corrected accounting; added
  `projectWindow` weekly, the dual-window projection shape (`tests/server.test.js`),
  the real `payload.info.last_token_usage` parse, and the subset cost/total checks.
  Full suite: 20 passing.

### How to test
1. `npm test` — all 20 pass.
2. Restart the dashboard so the new code loads, then open it. Each tool shows two
   pacing rows; Codex now shows token tiles, a token-mix bar with a "cached is a
   subset of input" note, and four trend charts.

### Notes for reviewer
- No schema/DB change (incremental). Pacing is derived on demand from the existing
  `usage_snapshots` data + the live poller.
- Verified against the real `~/.codex` logs: Codex now reports ~23.4M tokens this
  week, 95% cache hit rate, ~$4.98 est. value (the numbers the audit predicted),
  and the token mix sums exactly to input + output (no double-count).
- The maxed "limit reached" state is exercised by tests and the design mockup; the
  current live limits are all comfortable, so it doesn't appear in the live view
  right now.

## Seeing the feature locally

1. Open a terminal in the `llmdash` project folder.

2. Start the dashboard fresh so it picks up the new code:
   `npm start`
   (or, if you run it as a background service, restart that —
   `systemctl --user restart llmdash`.)

3. Open the dashboard in your browser:
   `http://localhost:8787` (or your machine's Tailscale name on port 8787).

4. For each tool (Claude Code and Codex), look at the burn callout under the two
   gauges. You should see two rows — one for the 5-hour window and one for the
   weekly window — each with a short status sentence and a colored pill.

5. Scroll to the Codex section. Its token stats (tiles, token mix, and trend
   charts) should now be filled in, with a note explaining that cached tokens are
   a subset of input.

## Convention Flags
- Codex token accounting differs from Anthropic's: `cached_input_tokens` is a
  **subset** of `input_tokens` (not a disjoint bucket). Always compute Codex total
  as input + output, cache hit rate as cached/input, and bill cached at the
  cache-read rate. Reusing the Anthropic-style additive aggregation inflates totals
  (~2x) and cost (~6.6x).
- Codex local logs are UTC-stamped while session directories are named in local
  time — bucket Codex per-day data from the timestamps (UTC), and say so in the UI.
- Status pills (`.burn-pill` + `--good-bg`/`--crit-bg`) are a new design-system
  component established this feature (see `decisions.md` DS-01) — fold into
  `pipeline/design-system.md` at the Chronicler stage.
