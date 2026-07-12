# QA Report — Menu Model Limits

**Date:** 2026-07-11
**Test Runner:** node:test via `npm test`
**Result:** PASSED

## Test Suite Results
482 tests passing, 0 failing, 2 skipped.

Full command run:
`npm test`

Focused commands also run during implementation:
- `node --test tests/menubar.test.js`
- `node --test tests/menubar-multihost.test.js`
- `node --test tests/menubar-display.test.js`

## Acceptance Criteria Verification

| Criterion | Result | Notes |
|---|---|---|
| Fable/Sonnet-style limits appear under Claude in the dropdown when `modelLimits` are present. | Pass | Verified by single-host and multi-host tests plus a rendered sample dropdown. |
| Model rows include remaining percent and reset countdown copy. | Pass | Rows render as `Fable:  84% · resets ...` / `Sonnet 4.5:  34% · resets ...`. |
| Model rows are readable and use existing dropdown styling/actions. | Pass | Rows use `font=Menlo`, existing status colors, and the fixed no-op SwiftBar action so they are not disabled-gray. |
| Existing title glyph output is unchanged. | Pass | Tests assert no model copy appears in the title, and display/logo title tests pass. |
| Existing dropdown states, legend, and display presets continue to work. | Pass | Full suite passed, including `tests/menubar-display.test.js` and legend/display coverage. |
| Model block is omitted when there are no model limits. | Pass | Existing fixtures without `modelLimits` retain the original four account-window rows and do not render `Model limits`. |

## Edge Cases Tested
- Single-host dropdown with Fable and Sonnet model rows.
- Multi-host dropdown with model rows inside the binding host's Claude section.
- Good, warn, and crit status colors on model rows.
- Malformed model reset timestamp degrades to `—`.
- Title glyph remains model-free even when model limits exist.
- Full repository regression suite.

## Known Limitations
The dropdown only shows model-specific rows when Claude has reported `modelLimits` in the existing state payload. If Claude is not currently reporting a model cap, the block is intentionally hidden.
