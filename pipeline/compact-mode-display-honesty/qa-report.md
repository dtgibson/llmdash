# QA Report - Compact Mode Display Honesty

**Date:** 2026-07-08
**Test Runner:** node:test via `npm test`
**Result:** PASSED

## Test Suite Results
467 tests passing, 0 failing, 2 skipped.

Command run:

```sh
npm test
```

Focused checks also passed:

```sh
node --test tests/menubar.test.js
node --test tests/menubar-multihost.test.js
node --test tests/menubar-display.test.js
node --test tests/hosts-disclosure.test.js
node --test tests/qa-badge-display.test.js
node --test tests/menubar*.test.js tests/hosts-disclosure.test.js tests/host-config-display.test.js tests/menubar-display-action.test.js tests/qa-badge-display.test.js
```

## Acceptance Criteria Verification

| Criterion | Result | Notes |
|---|---|---|
| SwiftBar/xbar output has exactly one line before the first `---` separator across single-host, multi-host, and non-default display modes. | Pass | New separator-contract tests cover `emit`, `emitMulti`, and `emitDisplay`. |
| Compact side-by-side/alternating/single glyphs stay bounded and never include the watching summary. | Pass | Compact display with an offline remote keeps the first line to compact cells only; watching/unreachable copy appears after the separator. |
| Display settings clearly describe what is shown. | Pass | The submenu now labels these as `Glyph layout` and `Glyph density`, with `Wide (text glyph)` / `Compact (tight glyph)` copy. README and health disclosure state that the dropdown remains full. |
| Existing monitoring, polling, persistence, and API contracts remain unchanged. | Pass | Full suite passed; display changes are presentation-only and existing `/api/hosts` / display-config tests still pass. |

## Edge Cases Tested
- A selected offline remote remains represented in compact glyphs as `⊘`, never a number.
- The first pre-separator area excludes `Watching`, `not reachable`, `unreachable`, and title-echo `remaining` copy.
- Display submenu preset active-marking still works after the label rename.
- `hosts.conf` display disclosure still reports bad directives and valid directive syntax.
- Direct compact/offline preview produced a compact first line, then `---`, then the watching/unreachable dropdown copy.

## Known Limitations
No blockers. Compact mode controls only the menu-bar glyph density; the dropdown intentionally remains the full detail view.

## Convention Flags
- SwiftBar/xbar plugin output should have exactly one status-bar title line before the first `---` separator; all explanatory, diagnostic, and scope copy belongs below that separator.
