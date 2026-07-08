# QA Report - Menu-Bar Dropdown Legibility And Legend

**Date:** 2026-07-08
**Test Runner:** node:test via `npm test`
**Result:** PASSED

## Test Suite Results

- Focused menu-bar suites passed:
  - `node --test tests/menubar.test.js` - 28 passing, 0 failing.
  - `node --test tests/menubar-multihost.test.js` - 21 passing, 0 failing.
  - `node --test tests/menubar-display.test.js` - 40 passing, 0 failing.
  - `node --test tests/qa-badge-display.test.js` - 17 passing, 0 failing.
- Full suite passed: `npm test` - 467 passing, 0 failing, 2 skipped.
- `git diff --check` passed.

## Acceptance Criteria Verification

| Criterion | Result | Notes |
|---|---|---|
| Normal dropdown text is dark and readable. | Pass | Direct plugin output showed top summary, scope, host/tool headers, per-window rows, Display labels, and Legend labels using `#111111`, `#1f1f1f`, or `#333333`. |
| Light gray is reserved for the status-bar glyph, not the dropdown. | Pass | Legend samples now use darker dropdown-specific colors such as `#4a4a4a`, `#3f4754`, and `#444444`; tests assert the legend does not emit `#a0a0a0`. |
| Every visible badge/menu symbol is explained. | Pass | The legend now covers `▪`, `·`, `▸ binding`, `◆`, `▲`, `◷`, `⚠`, `—`, `⊘`, `St12`, `+2`, `✓`, `＋`, `－`, `☰`, `🖥`, `🛈`, and `▬`. |
| Existing badge behavior is unchanged. | Pass | The status-bar glyph still has exactly one line before `---`, existing API contracts are untouched, and action rows still point to the same helpers. |
| Documentation matches the live glyph grammar. | Pass | README now describes `◷` aging and the expanded legend coverage. |

## Edge Cases Tested

- No-reading and offline states still carry no digit in compact and wide glyph forms.
- Stale and aging markers remain distinct.
- Multi-host side-by-side and alternating glyphs still preserve host cues and overflow.
- The legend remains static and deterministic across calls.
- Host labels and diagnostics remain sanitized for SwiftBar/xbar line grammar.

## Known Limitations

None.
