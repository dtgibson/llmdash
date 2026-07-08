# QA Report - Dropdown Legibility And Aging Symbols

**Date:** 2026-07-08
**Test Runner:** node:test
**Result:** PASSED

## Test Suite Results
467 tests passing, 0 failing, 2 skipped.

Focused menu-bar suites also passed before the full run:
- `tests/menubar.test.js`: 28 passing
- `tests/menubar-display.test.js`: 40 passing
- `tests/menubar-multihost.test.js`: 21 passing
- `tests/qa-badge-display.test.js`: 17 passing

## Acceptance Criteria Verification

| Criterion | Result | Notes |
|---|---|---|
| The top dropdown summary and section/header rows use darker, more readable text. | Pass | Direct render check shows the summary at `color=#222222` and tool headers at `color=#333333`; scope/count and section labels use `#555555` instead of the older light grays. |
| Aging readings use a clearer symbol than the trailing dot. | Pass | Aging renders with `◷` in single, multi-host, compact, and legend paths. Stale remains `⚠`. |
| Existing badge behavior does not regress. | Pass | `/api` contracts, display preferences, action rows, host selection, no-reading/offline no-digit rules, and one-title-line compact behavior remain covered by the passing suite. |
| Documentation and pinned examples match the shipped glyph grammar. | Pass | README and focused tests now pin `◷46` for aging and `⚠12` for stale. |

## Edge Cases Tested
- Aging single-host title render: `▪ ◆ 66% ◷`.
- Multi-host aging title render keeps the host/tool cue and the clock marker.
- Compact cells still preserve all five states: fresh, aging, stale, no-reading, offline.
- Legend remains static and complete with the new aging marker.
- Host/action rows still sanitize SwiftBar/xbar grammar characters and do not add new action surfaces.

## Known Limitations
None.
