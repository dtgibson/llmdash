# Decisions — llmdash

## Weekly pacing + Codex stats expanded; "Codex has no usage data" corrected — 2026-06-17 (feature)
**Decision:** Show both the 5-hour and weekly pacing predictors at once for each
tool (status pills; "limit reached" is per-window), and EXPAND Codex token stats —
superseding the 2026-06-16 conclusion that "Codex records no per-token usage
anywhere readable."
**Rationale:** A re-audit found Codex CLI v0.140.0 *does* write per-session rollout
JSONL under `~/.codex/sessions` with `token_count` events; the "not available"
state was a parser bug (it read tokens at the wrong nesting level —
`payload.info.last_token_usage` holds the per-turn delta), not missing data.
Verified by independently re-deriving the weekly totals from the raw logs.
**Implications:** Codex now shows real token activity and trends. Codex token
accounting is subset-based, not disjoint like Anthropic's (see CLAUDE.md):
`cached_input_tokens` ⊆ `input_tokens`, so total = input + output, cache hit rate =
cached/input, and cached is billed at the cache-read rate — the naive additive sum
inflates tokens ~2x and cost ~6.6x. Per-day Codex buckets use UTC (its session dirs
are local-named, timestamps UTC). Pacing is derived on demand (no schema change).
The prior "limits-only" decision now holds only if a future Codex build stops
writing rollout logs. Status pills (`.burn-pill`, `--good-bg`/`--crit-bg`) are a new
design-system component (see `pipeline/design-system.md`).

## Codex provides limits only; quota display hardened — 2026-06-16 (fix)
**Bug:** Codex activity showed fake `0`/`$0`; a maxed weekly quota wasn't
surfaced (burn said "on pace to stay under the 5-hour"); the headroom strip never
appeared.
**Cause:** Codex (this build) records no per-token usage anywhere readable — no
session rollout logs, and its internal `threads`/`thread_goals` tables are empty
(verified via a WAL-merged snapshot). Separately, the maxed-window display and the
headroom logic only ever considered the 5-hour window.
**Resolution:** Show Codex token activity as "not available" (no fabricated
zeros), and Codex trends as limits-only. A maxed window (≈0 remaining) now reads
"limit reached" and is the binding signal in the burn callout. `computeHeadroom`
and the limit display consider **both** windows. If a future Codex version
populates `threads.tokens_used`, activity could be revisited.

## Scope: Claude Code + Codex only; Kagi dropped — 2026-06-16
**Decision:** Track Claude Code now and Codex next; do not include Kagi.
**Rationale:** Feasibility research showed Kagi Ultimate is unlimited (no meter),
and only developer-API credit is readable — a different concept. Claude Code and
Codex both expose the real 5-hour and weekly subscription windows.
**Implications:** The product is built around time-window meters; Kagi would need
a separate, confusing widget.

## Use sanctioned data paths, not OAuth-token reuse — 2026-06-16
**Decision:** Read Claude Code limits via its statusline output, not by calling
the usage endpoint with the OAuth token.
**Rationale:** Anthropic's Feb-2026 policy bans subscription-OAuth reuse in
third-party tools. The statusline path is sanctioned and risk-free.
**Implications:** Limits reflect the latest Claude Code render, not a free-running
poll. Accepted.

## Vanilla, zero-dependency stack — 2026-06-16
**Decision:** Plain Node + `node:sqlite` + vanilla HTML/CSS/JS, no framework or
build step. Reversed the initial React/Tailwind/shadcn pick.
**Rationale:** A personal single-user tool; simple, fast, and library-light was
the explicit goal.
**Implications:** Charts (feature 3) will use vanilla SVG.

## Self-logged history, no backfill — 2026-06-16
**Decision:** Limit history accrues from first run via snapshots; no backfill.
**Rationale:** Neither data source provides limit history.
**Implications:** Trend charts start empty and fill forward.

## Multi-source architecture — 2026-06-16
**Decision:** The dashboard is source-aware — each tool is a `source` in one
schema and one set of UI components, with a cross-tool headroom cue. Codex limits
come from its app-server (polled); Claude from its statusline.
**Rationale:** Adding tools should be additive, not a fork; the product's value
is cross-tool comparison ("switch when one maxes out").
**Implications:** A third tool slots in as a new source + reader, with no schema
or UI redesign.

## Inline-style CSP + no-store static assets — 2026-06-16
**Decision:** Allow `style-src 'unsafe-inline'` (script-src stays `'self'`) and
serve static assets `cache-control: no-store`.
**Rationale:** The UI sets dynamic widths/colors via inline styles, which the
strict CSP from feature 1 was silently blocking (blank bars). No untrusted input
reaches a style value, so the relaxation is safe; no-store prevents stale-asset
confusion on refresh.
**Implications:** Keep style values to literals/coerced numbers; never interpolate
untrusted input into style or HTML without escaping.

## Don't reproduce /usage's "what's contributing" insights — 2026-06-16
**Decision:** Exclude the subagent-heavy / high-context / long-session
percentages.
**Rationale:** They are Claude Code's internal analysis; recomputing them from
logs diverges materially and would conflict with `/usage`. Honesty over feature
count.
