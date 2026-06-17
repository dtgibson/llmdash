# Data Layer Design — Weekly Limit Predictor & Codex Stats
**Feature:** weekly-limit-predictor-and-codex-stats
**Stage:** 3 — The Architect
**Path:** Incremental
**Source:** prd.md (approved)
**Store:** existing SQLite (no change). No new tables/columns/migrations.

## Summary
Two independent threads, neither needing persistence changes:
- **Weekly pacing predictor (FR-01..05, 08, 09):** the 5-hour and weekly windows
  are *already* captured per source in `usage_snapshots` (rows keyed `(source,
  window)`, both `five_hour` and `seven_day`) and served per request from the
  latest snapshot. Pacing is a pure on-demand derivation over `used_pct` +
  `resets_at` + a window-length **code constant** — exactly how the existing
  5-hour predictor already works. We generalize it to weekly and render both
  predictors at once. No schema change.
- **Codex stats (FR-10..13):** re-audit found Codex *does* record reliable local
  token activity; the "not available" state is a **parser bug**, not missing
  data. We fix the parser to expand Codex stats — a read/compute change with one
  correction the audit missed (see Decisions). No storage added (stats stay
  derived-on-demand per CLAUDE.md).

## Existing pieces reused
- `usage_snapshots(id, captured_at, source, window, used_pct, resets_at)` with
  `getLatestPerWindow(source)` and `getSeries(source, window, sinceIso)`
  (`src/db.js:12-22, 49-65`). `window` is a real column; both windows of both
  sources already persist as separate deduped rows.
- `src/poller.js:8-15` — `snapshot()` iterates `Object.entries(live.windows)` and
  writes every window per source on the interval poller. Codex's subprocess read
  (`readCodexLimits`) runs here, **off** the HTTP path; the request path uses the
  stored snapshot via `getLatestPerWindow`.
- `projectFiveHour(usedPct, resetsAtMs, nowMs, windowHours = 5)`
  (`src/stats.js:61-70`) — the existing reset-anchored pace model. It already
  accepts `windowHours`; window **start** is derived as `resetsAtMs -
  windowHours*3600_000`, never stored.
- `toolWrap()` (`src/server.js:47-69`) — already parses both windows into
  `limits.five_hour` / `limits.seven_day` as `{usedPct, remainingPct, resetsAt,
  capturedAt}` or `null`. Today it only projects `five_hour` (`server.js:63-65`).
- `computeHeadroom(tools)` (`src/server.js:74-94`) — **already** considers both
  windows (loops `[['five_hour','5-hour'],['seven_day','weekly']]`, tracks the
  tightest `remainingPct`). FR-09 is satisfied today; the job is to **not
  regress** it. Guarded by `tests/headroom.test.js` (weekly-maxed case).
- Render: `toolHtml()` / `gaugeHtml()` / `burnHtml()` (`public/app.js:35-70,
  105-115`). `burnHtml` renders the single pacing line and already shows a maxed
  window as "limit reached"; `gaugeHtml(null)` shows honest em-dashes, never 0%.
- Codex activity reader `src/codex-stats.js` (`usageFromEvent`, `aggregate`,
  `computeCodexActivity`) and `config.openaiPricing`. The `hasData` honesty gate
  (`hasData: all.length > 0`, `codex-stats.js:108`) is the not-available signal.

## New (read/compute only)

### Weekly pacing predictor — no schema change
- **Inputs per window (already present):** `used_pct` and `resets_at` from the
  served `limits[window]` object; **window length** as a code constant —
  `five_hour = 5h`, `seven_day = 7*24 = 168h`. Window length is the *only* input
  not in storage/poller output, and it lives in code today (`windowHours=5`); we
  add `168` the same way. No duration column is needed or added.
- **Pace logic (mirror of the 5-hour model):** `windowStart = resetsAt -
  windowHours*3600s`; `elapsedH = (now - windowStart)/3600s`; `ratePerH =
  usedPct/elapsedH`; `hoursToFull = (100 - usedPct)/ratePerH`; **on pace** iff the
  projected `etaMs >= resetsAt`, **will hit** iff `etaMs < resetsAt`. Generalize
  `projectFiveHour` into `projectWindow(usedPct, resetsAtMs, nowMs, windowHours)`
  and keep a `projectFiveHour` alias so `tests/stats.test.js` stays green; weekly
  is `projectWindow(..., 168)` anchored to `seven_day.resetsAt`.
- **Maxed window = binding "limit reached" (FR-04):** `usedPct` is clamped 0–100
  at the reader layer, so ~0 remaining ⇒ `remainingPct <= 0`. Treat a maxed
  window as "limit reached" **before** computing pace, **per window** — a maxed
  weekly must not suppress the 5-hour pacing line, and vice versa.
- **Honesty (NFR-01):** if a window's `resets_at` is `null` (toIso unparseable),
  `windowStart` is uncomputable; `projectWindow` returns `null` (as
  `projectFiveHour` does at `stats.js:62`) and the UI shows "limit data not
  available yet" — never a fabricated ETA or 0%.
- **Payload change in `toolWrap` (`src/server.js:63-65`):** replace the single
  `projection` with `projection: { five_hour: <proj|null>, seven_day: <proj|null>
  }`, computing each only when that window exists *and* has `resetsAt`. Null
  sub-fields stay null (no fabricated zeros).
- **Render slot (`public/app.js` `burnHtml`):** emit **two** pacing lines (5-hour
  *and* weekly) shown at the same time, reading `proj.five_hour` /
  `proj.seven_day`. Preserve the existing 5-hour on-pace/at-risk wording verbatim
  (FR-08). Maxed-window "limit reached" wins per line. Reuses existing classes
  (`.burn-proj`, `.burn-cap`, `.is-crit`); verify the right-hand `.burn` block
  actually **renders** two stacked lines (CLAUDE.md blank-bar caution), adjusting
  `public/styles.css:89-94` flex only if it doesn't.
- **Codex predictors are feasible from limits.** Codex captures both limit
  windows with `usedPct` + `resetsAt` (`src/codex-limits.js`), so its weekly/5h
  pacing renders independently of Codex token activity. Do **not** conflate this
  with `hasData` (token activity, a different layer). The pacing lines are gated
  on the limit window existing; the token-rate (`burnTokensPerHour`) line stays
  gated on `hasData`.
- All of the above is synchronous, derived per request from the
  already-assembled `windows` object. No subprocess on the HTTP path; Codex
  limits come from `getLatestPerWindow`, written earlier by the poller.

### Codex stats — expand (parser + aggregation fix), no storage
- **Verdict: expand (FR-10..13).** Re-audit confirmed Codex CLI v0.140.0 writes
  per-session rollout JSONL under `~/.codex/sessions/YYYY/MM/DD/` with
  internally-consistent `token_count` events. The dashboard shows "not available"
  only because `usageFromEvent()` reads tokens at the wrong nesting level.
- **Fix 1 — nesting:** tokens live under `payload.info.last_token_usage`
  (per-turn delta — the field to **sum**) and `payload.info.total_token_usage`
  (running cumulative cross-check), **not** at `info` top level. Descend into
  `last_token_usage` for the per-event delta in `usageFromEvent`
  (`src/codex-stats.js:16-27`). Keep all defensive null/clamp behavior; `hasData`
  flips to true correctly once parsing works.
- **Fix 2 — cached is a SUBSET of input (the audit MISSED this; verification
  refuted the naive fix).** In the Codex schema `cached_input_tokens ⊆
  input_tokens` (verified: `input + output == total_tokens`; `cached <= input`
  for all events). The current `aggregate()`/`recordCost()` in
  `src/codex-stats.js:34-51` were written for the **Anthropic** schema where
  input / cache_read / cache_creation are **disjoint**. Summing `input + output +
  cached` and billing input *plus* cached on top inflates totals **~1.95x**
  (~45.6M vs true ~23.4M), cost **~6.6x** ($32.72 vs ~$4.98), and breaks
  cache-hit-rate (0.488 vs ~0.952). **Required corrections for Codex only:**
  - total tokens = `input + output` (cached is already inside input), not `input
    + output + cached`;
  - cost: bill the **non-cached** portion at input rate and the cached portion at
    cache-read rate: `(input - cached)*p.input + cached*p.cacheRead + output*p.output`;
  - `cacheHitRate = cached / input` (not `cached / (input + cached)`);
  - `cacheSavings = cached * (p.input - p.cacheRead)` (unchanged in form, correct
    given cached ⊆ input).
- **Fix 3 — model for pricing:** `token_count` events carry no model; resolve it
  per session from `turn_context.payload.model` (gpt-5.5, which substring-matches
  the gpt-5 pricing entry) so cost uses real rates, not the empty→default path.
- **Derivable stats (FR-10..13):** total / input / output / cached / reasoning
  tokens; per-window (week / today / 5h / last-hour); session counts; cache hit
  rate; token mix; burn rate; estimated cost & cache savings — all from plain
  local file reads the user owns. No new storage (derived on demand, cached via
  `statsTtlMs`, poller-driven, off the HTTP path).

## Decisions
- **No schema change for the predictor.** Window length (168h) is a code literal,
  supplied exactly as the shipping 5-hour predictor supplies 5h — not a stored
  field. Every other input (`used_pct`, `resets_at`, per window per source) is
  already in `usage_snapshots` / poller output. No table, column, or migration.
- **Generalize, don't fork.** One `projectWindow()` serves both windows; both
  predictors flow through the existing source-aware `toolWrap` → payload →
  `burnHtml` path. Don't duplicate the predictor per source.
- **Headroom unchanged.** `computeHeadroom` already spans both windows (FR-09);
  scope is to preserve it. Run `tests/headroom.test.js` after edits.
- **Maxed precedence is per window.** A maxed window reads "limit reached" and
  wins over on-pace text on its own line, without hiding the other window's line.
- **Codex stats: EXPAND, with the subset correction.** The PRD's default "keep
  not-available" is disproven — reliable local data exists. We expand by fixing
  the parser **and** correcting the Anthropic-vs-Codex token-accounting mismatch.
  Surfacing the data under the audit's naive fix would emit ~2x tokens / ~6.6x
  cost — the exact fabricated/misleading-number outcome NFR-01 forbids — so the
  subset-aware aggregation is non-negotiable for the expansion to ship honestly.
- **Day-bucketing caveat (honesty):** rollout timestamps are **UTC** while the
  session directories are named in **local time**. Bucket by-day strictly from
  the UTC timestamps for consistency, and surface this in UI/docs if per-day
  Codex buckets are shown.
- **Regression guards (add):** (1) `projectWindow` weekly (`windowHours=168`)
  comfortable-vs-at-risk + null-on-no-`resetsAt`; (2) a `toolWrap`/`buildState`
  shape test asserting `projection.five_hour` and `projection.seven_day` exist
  (null when a window is missing); (3) `usageFromEvent` parses a real
  `token_count` event to non-zero tokens; (4) a Codex `aggregate` test pinning
  total = `input+output` and cost with cached billed at cache-read rate.
- **No storage change anywhere.** If the only honest path had required new
  persistence we would design it; it does not. Both threads are pure
  derive-on-demand over data already captured or already on disk.
