# QA Report — Menu-Bar Logo Assets

**Date:** 2026-07-08
**Test Runner:** `npm test` (`node --test`)
**Result:** PASSED

## Test Suite Results

469 tests total: 467 passing, 0 failing, 2 skipped.

Focused verification also passed:

```sh
node --test tests/menubar-display.test.js tests/hosts-zerodep.test.js tests/hosts-disclosure.test.js tests/menubar-install.test.js
```

84 tests total: 82 passing, 0 failing, 2 skipped.

## Acceptance Criteria Verification

| Criterion | Result | Notes |
|---|---|---|
| Claude and Codex logo mode ships recognizable local template images, replacing the old placeholders. | Pass | `file` confirms both bundled assets are 26x26 RGBA PNGs; asset tests confirm small tracked PNG sources. |
| The neutral `◆` / `▲` text floor remains visible and remains the fallback carrier. | Pass | `toolMark=logo` test confirms `◆` remains emitted while SwiftBar gets `templateImage=`; xbar/no-SwiftBar emits no image and keeps the glyph only. |
| No first-use fetch, polling, API, host watching, display preference, service-control, or menu action contract changes. | Pass | Zero-dependency tests assert local `node:fs` asset reads, no logo URL fetch path, and no new HTTP/display mutation surface. |
| Source, license, trademark posture, and Codex-as-OpenAI-mark choice are documented. | Pass | README and `scripts/menubar/assets/LICENSE.md` checks cover source pages, trademark posture, and OpenAI/Codex wording. |
| Existing badge install and menu-bar behavior do not regress. | Pass | Full `npm test` passed, including badge install, service/uninstall, display, multi-host, and host config suites. |

## Edge Cases Tested

- SwiftBar logo path: local base64 template image layered over the neutral floor.
- xbar/no-SwiftBar path: no `templateImage=`, neutral glyph remains readable.
- Default/neutral path: logo asset read is not triggered.
- Wrapper/symlink path: asset resolution via `import.meta.url` still works.
- Attribution docs: source pages and trademark posture travel with the bundled PNGs.

## Known Limitations

SwiftBar supports one `templateImage=` per menu-bar title line, so logo layering is
only used when the rendered badge line has a single tool glyph. Multi-cell
side-by-side views continue to use the neutral `◆` / `▲` text glyphs.
