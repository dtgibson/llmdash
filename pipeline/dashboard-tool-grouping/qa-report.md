# QA Report — Dashboard Tool Grouping

**Date:** 2026-07-13
**Test Runner:** `node:test` via `npm test`
**Result:** PASSED

## Test Suite Results

552 tests discovered: 550 passed, 0 failed, 2 skipped because the host has a
system-wide Node binary and therefore cannot exercise the intended
"Node completely unavailable" installer branches. No test was cancelled or
left pending.

Focused dashboard/client verification: 47 passed, 0 failed.

Design lint scanned all 3 files under `public/` with 0 findings. `git diff
--check` is clean.

## Acceptance Criteria Verification

| Criterion | Result | Notes |
|---|---|---|
| Claude and Codex account windows precede activity, insights, and trends in semantic order. | ✓ Pass | `#single-limits` and all four fixed slots precede diagnostics and `Tool details`; DOM-order and browser checks confirm it. |
| The leading comparison remains readable without horizontal scrolling at 320px. | ✓ Pass | Exact CDP emulation reported `innerWidth`, document client/scroll width, and body scroll width all 320px. Each tool grid is 265px wide with two 128.5px cards and no internal overflow. |
| A 10,080-minute positional Codex window maps to weekly. | ✓ Pass | Live app-server proof and `codex-window-identity.test.js` both place it under `limits.seven_day`. |
| A missing 300-minute Codex window remains unavailable. | ✓ Pass | Live `/api/state` returns `five_hour: null`; the UI renders `Unavailable`, no percentage, forecast, or filled meter. |
| Obsolete stored Codex windows cannot reappear as current. | ✓ Pass | Codex current gauges never fall back to independent DB rows, including before the first poll after relaunch. Cold-start and complete-empty response tests pass. |
| Claude supporting statistics and charts form one tool group. | ✓ Pass | Pacing, local activity, model caps, and Claude Trends are inside the Claude group. |
| Codex activity, deeper insights, and charts form one tool group. | ✓ Pass | Pacing, local activity, Codex insights, and Codex Trends are inside the Codex group; insight and trend containers survive one-second rerenders. |
| Shared Trends range and independent Codex-insights range retain their behavior. | ✓ Pass | Range controls preserve `aria-pressed` truth; focused async/race tests pass. All controls measure 32px high at 320px. |
| Multi-host scope and honesty remain intact. | ✓ Pass | Same-account collapse, distinct-account labeling, host-first activity, offline/no-zero states, local-only insights, ordering, and peer-string escaping pass focused tests. |
| Accessibility, themes, reduced motion, and menu-bar behavior remain intact. | ✓ Pass | Resolved `aria-labelledby` targets, non-duplicative heading/card announcements, visible text status, light/dark/reduced-motion rules, and unchanged menu-bar source are verified. Full menu-bar regression suite passes. |
| Endpoint shape, schema, and polling cadence remain unchanged. | ✓ Pass | State contract/golden tests pass; no endpoint, payload key set, DB schema, or interval changed. |

## Live Verification

An isolated development server was run against the real local Codex app-server.
`/api/state` reported:

- plan: `ChatGPT Pro`
- Codex 5-hour: `null`
- Codex weekly: 44% used, 56% remaining
- weekly reset: July 20, 2026

The page rendered those facts without relabeling the weekly reading as 5-hour.
Desktop visual inspection confirmed the limits-first comparison and complete
Claude/Codex tool groups. Exact 320px emulation confirmed that all four cards
end before the first diagnostic begins.

## Edge Cases Tested

- 300-minute and 10,080-minute duration-bearing positional responses.
- Unknown explicit duration, including `null`, remains unidentified.
- Legacy positional responses without duration metadata remain compatible.
- Explicitly named legacy fields retain their named identity even when attached
  duration metadata conflicts.
- Wrapped complete responses with no recognized windows are authoritative and
  suppress historical gauges.
- Untimestamped rollout records cannot supersede newer live data; genuinely
  newer timestamped rollout data can.
- Cold start with an obsolete 5-hour DB row.
- Missing Codex short window, stale Claude diagnostic, maxed limits, and empty
  activity/trend states.
- Same-account and different-account multi-host readings, offline peers, and
  hostile peer/model labels.
- One-second countdown rerenders preserve independently fetched insight and
  trend content.
- Narrow desktop reset wrapping, exact 320px layout, focus targets, and reduced
  motion.

## Known Limitations

- Existing historical rows captured under the old Codex positional mapping are
  retained and may remain visible in the selected Trends range until they age
  out. They cannot populate current gauges.
- Codex retains its pre-existing last-known-reading policy when polling later
  fails; unlike Claude, it still has no separate freshness band. The visible
  capture age remains available, and this change does not make that behavior
  less accurate.

## Convention Flags

- Treat a provider's explicit window duration as identity evidence; a complete
  response that omits a window must suppress historical per-window fallback.
- Responsive QA for limits-first surfaces should verify DOM order and measured
  geometry, including that diagnostics cannot split the primary comparison.
