# Architecture Decisions — Deeper Codex Insights
**Feature:** deeper-codex-insights
**Date:** 2026-07-12

## ADR-01 — Local-machine endpoint
Deeper activity insights ship from a new local, read-only endpoint with an
explicit `local-machine` scope. The existing `/api/state`, `/api/hosts`, peer
normalizers, and menu-bar contract remain unchanged. In multi-host mode the UI
labels this section `This machine`; remote insight fan-out is deferred so the
feature creates no new outbound request.

## ADR-02 — Explicit timing only
Current Codex rollout events expose `task_complete.duration_ms` and
`task_complete.time_to_first_token_ms`. Latency uses only those finite,
non-negative fields. Aborted turns and inferred timestamp pairs do not
participate; older logs degrade to unavailable per timing metric.

## ADR-03 — Credit facts without invented units
The live rate-limit response exposes `credits.balance`, `hasCredits`, and
`unlimited`, plus an available reset-credit count. It does not promise a unit.
The UI therefore reports a bounded status and optional verbatim balance/count,
never a currency, price, or pay-as-you-go interpretation.

## ADR-04 — One canonical token sample per call state
Codex can repeat identical `last_token_usage` snapshots. The scanner fingerprints
the per-call usage together with the cumulative `total_token_usage` tuple and
context-window value, then keeps each fingerprint once per explicit turn. This
removes duplicate notifications without collapsing two legitimate same-sized
model calls whose cumulative totals differ. A consecutive-fingerprint fallback
applies when a reliable turn or cumulative tuple is absent. Existing Codex
activity, trends, and new insights consume this same accepted stream so the
dashboard cannot show contradictory totals.

## ADR-05 — Canonical compaction event
A compaction can appear as both top-level `compacted` and
`event_msg.context_compacted`. The scanner counts the top-level event when it is
available and uses `context_compacted` only as a compatibility fallback within
the session, preventing double counting without exposing event content or IDs.

## ADR-06 — Bounded tool categories
Tool activity crosses the API only as one of `Shell`, `File edits`, `Search`,
`MCP`, `Subagents`, or `Other`. Names, arguments, output, commands, paths, and
identifiers are never returned. Invocation starts are counted once; matching
completion/output records are ignored.

## ADR-07 — One quiet dashboard section
Insights render once after the tool/host activity region and before global
Trends, never inside every Codex or host card. A dedicated range switch controls
only this section. A flat four-value summary leads, followed by two detail
columns and optional daily charts. This extends the established limits-first
hierarchy without changing the menu bar or elevating diagnostics into another
set of account-gauge cards.
