# Evaluation — Trends warming and Codex scan state

Confirmed with `node pipeline/trends-warming-scan-state/reproduce.mjs` on Node v24.18.0; exit 0. Observations are retained in `evaluation.json`.

Six cases covered three ranges in both-cold and Claude-cold/Codex-ready states. Three requests per case executed twelve snapshot-series queries, reused no response, and changed `generatedAt` each time: 72 queries for 18 near-identical requests. This proves repeated rebuilds, not a remaining request-path transcript scan or a measured one-second latency. The ready-state positive control reused its cached response.

The real Codex scanner was pointed at a temporary sessions root that was a regular file. Two refreshes returned false. `/api/codex-insights?range=7d` and `/api/trends?range=7d` both returned HTTP 200; activity and insights retained `generatedAt: null`, and Codex trends still reported `warming`. Executing the actual `renderCodexInsights` function with the returned payload and a minimal DOM rendered `Reading local Codex session metadata…` after the failed scans.

Restoring a valid synthetic rollout published 110 weekly tokens. Another unreadable-root refresh retained those values and their publication time but exposed no failure. Restoring the fixture recovered successfully with a new publication time. The build must preserve this last-good behavior while making failure explicit.

## Scoped resolution

Use a fixed two-second warming-response TTL, three canonical cache entries at most, and immediate invalidation whenever either publication or the Codex scan outcome changes. Preserve the normal ready-response TTL and build 4's own-key range guard. A timer alone must not hide first publication or error recovery.

Codex's cached aggregate owner should carry a small, safe refresh outcome separately from its retained data. Getters remain cache-only. Failed first refreshes show a clear read-failure message in existing local activity, insights, and trend states; later failed refreshes retain the original data/time with an inline failure note. Retrying must not briefly disguise a persistent failure as warming. Missing directories and successful empty scans remain no-activity states. Supported bounded partial scans and changing-file convergence are not fatal scan failures.

In `public/app.js`, error handling must take precedence over the existing null-time loading predicates. A last-good error note must remain visible when charts or activity tiles exist. `fetchTrends` currently schedules faster retry whenever `trendActivityNote` produces text; once error text is added, restrict that check explicitly to `warming` so an error note cannot create a new accelerated retry behavior. Keep enum lookups own-key and output escaped/fixed; do not display caught errors.

This is maintenance of existing surfaces. No design pass is needed because the correction uses existing markup/style and loading/error treatment. No ingestion changes, new surface, persistence, dependency, or account-limit behavior is required.

## Context and isolation

Read `pipeline/session-state.json`, `pipeline.config.json`, `PRODUCT_CONTEXT.md`, `CLAUDE.md`, the relevant `DECISIONS.md` entries, and preceding builds 3/4. Workspace `agents/evaluator.md` does not exist; full evaluator instructions and communication style were served successfully by Weft. The hands-off seed supplies authorization to scope without an interview or review gate.

The reproduction clears inherited `LLMDASH_*` before dynamic imports, uses disposable Claude/Codex/data fixtures, writes empty `hosts.conf`, disables auto-refresh, and pins both CLI commands to `/usr/bin/false`. It imports the actual server without main startup, starts no poller, and listens only on `127.0.0.1` with an ephemeral port. It closes the listener/database and removes fixtures. No live logs, peers, providers, physical devices, production checkout/service, source edits, git/state mutation, full suite, or user-facing preview was involved.
