# Change Brief — Claude trends background cache

## What is changing
Move Claude's existing 24h / 7d / 30d trend aggregation from HTTP requests to bounded, cooperative background refresh on the poller. Publish all supported Claude ranges atomically in memory after successful refresh; requests read published aggregates only. Retain the last good result after transient failures and report `warming` before the first publish.
Scope: `src/trends.js`, `src/poller.js`, a supporting Claude scan/cache module if needed, focused trends/scanner tests, and the documentation of the request-scan exception. Reuse existing aggregation helpers without changing their accounting.
Leave chart layout, range choices, snapshot schema/history, Claude activity-card behavior, pricing, account limits, peer/menu contracts, and Codex ingestion unchanged. The prototype-key range guard and warming-answer cache/Codex error-state work belong to separate builds 4 and 5.
This is maintenance of an existing capability; no new screen, flow, persisted model, or dependency is needed.

## Why now
The Claude half of `/api/trends` still synchronously traverses and reads transcripts on an uncached request, including when Codex is warming. The supplied observation is roughly one second for 30d. This is the recorded exception to the dashboard's cache-served analytics and corpus-independent request-latency rules.

## User-facing impact
Existing charts, totals, local-day bucketing, rolling range cutoffs, and token/cache/cost calculations stay the same. Data refreshes in the background. Before the first complete Claude publish, the existing trend loading presentation reports warming rather than implying no activity; subsequent transient refresh failures retain published data.

## Design pass
Not needed — no visual change. Reuse the existing trend warming presentation.

## Decisions touched
- “Available API credits — one canonical credit home, honest Claude absence, listen-first readiness” (2026-10-01): close only the Claude request-path transcript-scan follow-up; preserve listen-first cooperative priming.
- “LLM usage coverage gaps — retained cap evidence and convergent log coverage” (2026-08-27): preserve bounded I/O/memory and last-good publication; apply current-corpus convergence checks if ingestion changes.
- “Deeper Codex insights — local aggregate diagnostics, explicit availability, account-wide facts” (2026-07-13): extend aggregate-only, bounded, cache-served discipline to existing Claude trends; keep Codex behavior unchanged.
- “Self-logged history, no backfill” and “Vanilla, zero-dependency stack” (2026-06-16): preserve snapshot history and the built-in-only stack.
No recorded decision is reversed.

## What done looks like
Focused tests prove cold and warm trend requests invoke no Claude transcript scan or daily aggregation, and all three ranges match prior calculations, bucket boundaries, ordering, and totals on fixed fixtures.
Tests prove cooperative refresh with explicit finite traversal/byte/event/result/cache ceilings, atomic publication across ranges, honest cold state, and last-good retention on transient failures; startup still binds before priming.
If ingestion changes, run a fresh-process development-Mac corpus check through bounded convergence, verify readiness during refresh, and measure forced-GC cache/heap occupancy against explicit proportional ceilings. No cumulative suite or device/peer access is part of this evaluation.
