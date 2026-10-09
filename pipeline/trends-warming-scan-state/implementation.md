# Implementation — trends-warming-scan-state

Warming trend responses now reuse a fixed 2,000 ms cache per canonical range.
Ready responses retain their 60,000 ms TTL. `Object.hasOwn` normalization limits
the map to 24h, 7d and 30d, including all default/unknown/prototype-key requests.
Hits skip snapshot queries and daily aggregation.

Claude publication/reset already invalidates trend responses. Codex now owns a
stable, frozen scan-status object whose identity changes on successful publication,
failure transition or reset. Trends checks that identity before its cache lookup
and clears all three entries when it changes. This reveals mixed-tool publication,
failure, recovery and resets immediately, even when publication timestamps match;
no poller hook or time-only invalidation is needed.

Codex activity and insights getters add the fixed `scanState` enum:
`warming | ready | error`. Trends uses the same enum for `activityState` and adds
`activityGeneratedAt` for the retained Codex publication time, separately from the
response's `generatedAt`. Failure changes only the scan outcome; prior aggregates
and their publication time survive. Starting a retry leaves the error intact until
successful publication. Missing/empty roots publish ready no-activity evidence;
supported partial-budget and changing-file results remain publishable. The scanner
and ingestion algorithms are unchanged.

Existing activity, insight and trend markup renders one fixed log-read failure
sentence. Error takes precedence over cold loading. Retained tiles, metrics and
charts keep rendering with an inline note, and recovery clears it. The trend copy
table keeps its own-key guard. Accelerated retry remains 15 seconds for genuine
warming only; an already pending warming retry is canceled when warming ends.

## Verification

Node v24.18.0: **40/40 passed**, zero failures/skips:

```text
node --test tests/trends.test.js tests/codex-insights.test.js tests/codex-insights-client.test.js
```

The run cleared inherited `LLMDASH_*`, used temporary data/Claude/Codex roots,
empty `hosts.conf`, disabled auto-refresh and `/usr/bin/false` provider commands.
Focused coverage proves exact 1,999/2,000 ms warming and 59,999/60,000 ms ready
boundaries, snapshot/daily-work bypass, canonical key reuse, mixed readiness,
immediate publication/state/reset invalidation, retained values/time through retry,
safe enum rendering and warming-only scheduling.

`node pipeline/trends-warming-scan-state/verify.mjs` passed **9 phases / 27 real
loopback GETs** across `/api/state`, `/api/codex-insights` and `/api/trends` using
the actual scanner and app renderer. It covers cold warming, repeated cold
failure, a provably unfinished retry, missing-root and empty-tree success,
110-token publication, transient failure with retained data/time and recovery.
Renderer assertions verify actual activity tiles, insight metrics and SVG chart
markup, rather than only successful page retrieval. Evidence is in
`verification.json`; this is a VM DOM render check, not a browser screenshot.

Syntax checks passed for the three changed source files and smoke script.
`weft-design-lint check public/app.js` was clean: one file, zero findings.
Pre-change evaluation/reproduction artifacts remain unchanged.

The cumulative suite is reserved for the bundle flush. No current-corpus scan,
live provider/peer/device access, production operation, git/state transition or
preview modification occurred. No new infrastructure, dependency, configuration,
layout/style, account-limit behavior or peer/menu contract was introduced.

## Context note

The warm-up cache and failed-Codex-scan follow-ups from the 2026-10-01 readiness
decision are closed. The separate first-Codex-limit-reading delay remains outside
this build. Keep scan outcome separate from the observation time of retained data;
successful bounded partial scans still follow their existing convergence semantics.

## Review access

The coordinator owns the bundle preview at
`https://hephaestus-developer.giraffe-chuckwalla.ts.net:8982/` and will restart and
verify the final bundle before handoff. This stage does not claim the running
preview already contains these changes.
