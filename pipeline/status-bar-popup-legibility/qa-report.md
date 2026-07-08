# QA Report - Status Bar Popup Legibility

**Date:** 2026-07-08
**Test Runner:** node:test via `npm test`
**Result:** PASSED

## Test Suite Results
463 tests passing, 0 failing, 2 skipped.

Command run:

```sh
npm test
```

Focused checks also passed:

```sh
node --test tests/menubar.test.js
node --test tests/menubar-degradation.test.js
node --test tests/menubar-multihost.test.js
node --test tests/menubar-display.test.js
```

## Acceptance Criteria Verification

| Criterion | Result | Notes |
|---|---|---|
| Unavailable local-dashboard and remote-host messages render as bounded, readable dropdown text instead of one very wide line. | Pass | `wrapMenuText` is covered directly, stale/Codex diagnostic wrapping is covered, and a long offline host preview passed the bounded-row check. |
| Normal single-host, multi-host, and display-option badge glyphs stay compatible with the existing output contract. | Pass | Existing glyph, no-reading/offline, display-axis, multi-host, and real symlink invocation tests passed. |
| Focused menu-bar tests cover long unavailable-server copy and the real plugin invocation still emits valid SwiftBar lines. | Pass | `tests/menubar.test.js`, `tests/menubar-degradation.test.js`, `tests/menubar-multihost.test.js`, and `tests/menubar-display.test.js` passed. |

## Edge Cases Tested
- Long unavailable-dashboard host values wrap into bounded rows.
- Long single tokens are split, so one unbroken host-like value cannot force the menu width.
- Wrapped diagnostic rows preserve the SwiftBar grammar: one `|` delimiter per row, no injected action params.
- Offline glyphs still show no percentage and still offer Open dashboard and Refresh.
- Single-host and multi-host glyphs keep their established tool/host cues.

## Known Limitations
No blockers. The visible wrap is implemented as multiple SwiftBar menu rows rather than native text wrapping inside one row, which is the practical way to control width in this host format.
