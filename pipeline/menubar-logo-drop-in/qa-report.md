# QA Report — Menu-Bar Logo Drop-In

**Date:** 2026-07-09
**Test Runner:** `node --test`
**Result:** PASSED

## Test Suite Results
- Focused suite:
  - Command: `node --test tests/menubar-display.test.js tests/hosts-zerodep.test.js tests/hosts-disclosure.test.js tests/menubar-install.test.js`
  - 85 tests total
  - 83 passing
  - 0 failing
  - 2 skipped
- Full suite:
  - Command: `npm test`
  - 470 tests total
  - 468 passing
  - 0 failing
  - 2 skipped

## Acceptance Criteria Verification

| Criterion | Result | Notes |
|---|---|---|
| SwiftBar Logos mode emits logo imagery instead of visible `◆` / `▲` glyphs | Pass | Direct render output was `▪ 12 61 | color=#ff6b6b image=<base64>` with no `◆` or `▲`. |
| Logo imagery matches the title state color | Pass | Tests decode the generated PNG and verify the first visible pixel is `#ff6b6b` for a critical-state title. |
| Side-by-side tool mode still shows both tool identities as logos | Pass | The generated paired image decodes as 34x16, matching the paired Claude/Codex asset dimensions. |
| Single-tool logo mode stays at glyph scale | Pass | The generated single logo image decodes as 16x16. |
| xbar, no-SwiftBar, or failed image paths keep neutral text glyphs | Pass | Tests verify no-SwiftBar output contains `◆` and no image parameter. |
| No data, API, polling, persistence, host watching, or service-control contract changes | Pass | Full suite and targeted zero-dependency tests passed; implementation is isolated to menu-bar presentation and docs. |

## Edge Cases Tested
- Neutral tool-mark mode reads no logo image and emits no image parameter.
- Generated logo image is not the original monochrome source base64; it is recolored for the current title state.
- README disclosure covers replacement behavior, paired side-by-side image behavior, no first-use fetch, and fallback glyphs.
- Asset license notes keep trademark/source disclosure while updating the runtime behavior from `templateImage=` to colored `image=`.

## Known Limitations
SwiftBar provides one image slot per title line, so side-by-side Logos mode uses one paired local image rather than two independent inline image attachments. The visible `◆` / `▲` glyphs are suppressed in successful SwiftBar logo mode, and the text fallback remains available for hosts or image failures.
