# Change Brief — Trends warming and Codex scan state

## What is changing
Briefly cache existing warming trend replies for a fixed 2,000 ms per canonical range; keep the existing 60,000 ms ready-response TTL and a maximum of three cached ranges. A cache hit must skip snapshot queries and daily aggregation. Invalidate on Claude publication, Codex publication or scan-state transition, and explicit cache reset, so the next request immediately sees success, failure, or recovery even inside the warming TTL.
Represent failed Codex analytics refreshes distinctly from a genuine cold first scan. Expose only bounded, allowlisted state in existing local activity/insights/trends payloads; never return thrown messages, paths, session IDs, or raw logs. Reuse existing empty/error presentations to say Codex logs could not be read. A retry in flight retains that failure until a successful publication rather than reverting to “Reading…”.
After a failed refresh with prior data, retain the last-good aggregates and original publication time and show an existing inline failure note; successful recovery clears the failure and publishes normally. Missing/empty session trees remain successful no-activity evidence. Preserve supported partial/budget-converging scans and changing-file handling rather than labeling every incomplete pass a fatal failure.
Scope: `src/trends.js`, `src/codex-stats.js`, existing render/retry functions in `public/app.js`, focused existing trends/Codex/UI tests, and relevant context notes. A minimal poller invalidation hook is acceptable if necessary. Preserve build 3's background-only Claude scanning/atomic last-good publication and build 4's own-key range normalization. No parser/ingestion, chart layout/style, ranges, account-limit/probe logic, pricing, snapshot schema/history, peer/menu contract, persistence, dependency, or new surface/flow changes.
This refines existing maintenance behavior; the saved improvement seed provides scope without another interview.

## Why now
The saved observation is repeated slow chart reads shortly after restart plus persistent Codex log failures that look like indefinite loading. Isolated reproduction confirms each warming request reruns four snapshot queries and each failed first Codex scan leaves `generatedAt: null`, which the current UI still renders as “Reading local Codex session metadata…”. The former Claude request-path log scan was already removed in build 3; this build closes only the warming-cache and failed-scan follow-ups.

## User-facing impact
Existing trend requests reuse their answer briefly during warm-up. Genuine first scans retain existing loading copy; failed scans say the machine's Codex logs could not be read, without implying no activity or an account-limit failure. Published data remains visible through transient failure, with a concise failure note, and recovers on the next successful background refresh. Use existing markup/styles; accelerated trend retries remain restricted to genuine `warming`, with no new retry loop or cadence.

## Design pass
Not needed — no visual change. This is cache/state logic and failure copy in existing activity, Codex insights, and trend empty/error treatments; no new layout, component, color, motion, hierarchy, or interaction is required.

## Decisions touched
- “Available API credits — one canonical credit home, honest Claude absence, listen-first readiness” (2026-10-01): close the uncached-warming and permanent-Codex-warming follow-ups; preserve listen-first cooperative priming. The separate first-limit-reading delay stays out of scope.
- “Deeper Codex insights — local aggregate diagnostics, explicit availability, account-wide facts” (2026-07-13): preserve bounded cache-only getters, aggregate-only disclosure, and unavailable-versus-zero honesty.
- “LLM usage coverage gaps — retained cap evidence and convergent log coverage” (2026-08-27): preserve scanner budgets, supported partial convergence, and last-good parses; no usage-ingestion change is required.
- “Self-logged history, no backfill” and “Vanilla, zero-dependency stack” (2026-06-16): preserve snapshot history and built-in-only implementation.
No decision is reversed. Preserve the preceding Claude-background-cache and trends-range-guard implementation contracts.

## What done looks like
Focused tests prove warm-up replies reuse work until exactly 2,000 ms, supported/default/prototype-key ranges stay canonical, and each state/publication/reset transition becomes visible on the next request inside the TTL, including mixed-tool readiness. Requests remain scan-free and ready caching retains its 60-second contract.
Tests and an isolated loopback/render check distinguish genuine cold warming, persistent cold failure, authoritative empty success, last-good transient failure, and recovery across activity/insights/trends; preserve values and their observation time, fixed safe error copy, existing panels, and warming-only retry scheduling.
Use cleared inherited `LLMDASH_*`, disposable log/data trees, empty `hosts.conf`, disabled auto-refresh, and `/usr/bin/false` CLI commands. No live providers/peers/devices, production service, current-corpus scan, or cumulative suite is needed if parsing/ingestion stays untouched.
