# QA Report — Weekly Limit Predictor & Codex Stats

**Date:** 2026-06-17
**Test Runner:** node:test (`npm test`)
**Result:** PASSED

## Test Suite Results
20 tests passing, 0 failing. Includes new guards: `projectWindow` weekly (168h)
+ null-on-no-reset, the per-window `projection.{five_hour, seven_day}` shape
(`tests/server.test.js`), the real `payload.info.last_token_usage` parse, and the
Codex subset-aware total/cost (`tests/codex-stats.test.js`).

## Acceptance Criteria Verification

| ID | Result | Notes |
|---|---|---|
| QA-01 | ✓ Pass | 5-hour pacing row + gauge render for both tools (live `/api/state` + render harness). Not suppressed when the weekly window is maxed. |
| QA-02 | ✓ Pass | Weekly pacing row renders for both tools; `projection.seven_day` present live. |
| QA-03 | ✓ Pass | `burnHtml` emits both the 5-hour and weekly rows unconditionally — 4 rows across the 2 tools, shown at once. |
| QA-04 | ✓ Pass | A weekly window at 0% remaining reads "Weekly limit reached" (crit pill) on its own row while the 5-hour row independently still reads "on pace". Gauge bar fixed to render full red (was empty) — see Fixes. |
| QA-05 | ✓ Pass | A window with no reading / no reset time → null projection → "limit data not available yet" with no fabricated ETA or 0%. A fresh 0%-used window reads "on pace" (fixed wording). |
| QA-06 | ✓ Pass | `computeHeadroom` unchanged; spans both windows and fires on a low/maxed window (covered by `headroom.test.js` + render harness with a maxed weekly). |
| QA-07 | ✓ Pass | Codex's `hasData` gate preserved; a tool with no activity shows the honest "isn't available" note, never fabricated zeros. |
| QA-08 | ✓ Pass | Codex stats expanded from real local logs: 23.40M tokens/week, 95.2% cache hit (cached/input), ~$4.98. Independently re-derived from raw rollout JSONL (two methods) and matched the code to floating-point precision. Token mix sums to input+output (cached is a subset of input) — no double-count; the pre-fix buggy ~45.6M/$32.72/0.488 figures are absent. |

## Edge Cases Tested
- Maxed weekly window beside an on-pace 5-hour window (per-window independence, FR-04/FR-08).
- Window with a reading but no reset time, and a window with no reading at all (honest "not available").
- Fresh window (0% used) — reads "on pace", not "not available".
- Cross-tool headroom firing on a maxed window and pointing to the tool with room.
- Codex with reliable data (expanded) and the unavailable path (honest empty note).
- Independent re-derivation of Codex week totals / cache rate / cost from raw logs.

## Issues Found and Fixed (one QA fix-round)
1. **Maxed gauge bar (medium):** a maxed window rendered the gauge bar at `width:0%`
   (an empty bar) — the blank-bar anti-pattern, and a mismatch with the approved
   design's full-red bar. Fixed in `gaugeHtml` (`public/app.js`): a maxed window
   renders `fill-crit` at 100%.
2. **Pacing wording for an unused window (low):** a window with a reading but 0%
   used read "limit data not available yet" while its gauge showed a real
   percentage. Fixed in `pacingLine` (`public/app.js`): a window with a reading +
   reset time reads "on pace" (the "not available" copy is now reserved for a
   genuinely missing window).

Both fixes re-verified by re-rendering the affected states; `npm test` remained 20/20.

## Known Limitations
- A window that has a usage reading but no reset time cannot be paced (pacing needs
  the reset anchor) and reads "limit data not available yet". This is a rare, honest
  fallback, not a fabrication.

## Convention Flags
None beyond those The Engineer already flagged (Codex subset accounting, Codex UTC
day-bucketing, and the status-pill design-system addition).
