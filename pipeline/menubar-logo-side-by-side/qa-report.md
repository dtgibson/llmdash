# QA Report — Menu-Bar Logo Side-By-Side

Date: 2026-07-08

## Result
Passed.

## Verification Run
- `node --test tests/menubar-display.test.js tests/hosts-zerodep.test.js tests/hosts-disclosure.test.js tests/menubar-install.test.js`
  - 85 tests total
  - 83 passing
  - 0 failing
  - 2 skipped
- `npm test`
  - 470 tests total
  - 468 passing
  - 0 failing
  - 2 skipped
- Direct render check:
  - Rendered a side-by-side tool badge with `toolMark=logo` and SwiftBar env.
  - Confirmed the line includes a `templateImage`.
  - Confirmed the decoded image is 34x16.
  - Confirmed the visible text still includes the `◆` / `▲` fallback floor.

## Acceptance Criteria
- Single-tool logo assets are status-bar-sized.
  - Passed. `claude-mark.png` and `codex-mark.png` are 16x16 PNG template assets.
- Side-by-side tool logo mode shows a logo cue.
  - Passed. Claude/Codex and Codex/Claude paired 34x16 PNG template assets are bundled and used when two tool cells render in SwiftBar logo mode.
- The neutral text floor remains present.
  - Passed. Side-by-side output still includes `◆` and `▲` text cells, and xbar or non-SwiftBar output remains text-only.
- Docs and Legend explain the symbols.
  - Passed. README, asset notes, and the menu legend describe the bundled logo marks and the paired-image behavior.
- Existing app contracts are unchanged.
  - Passed. No API, polling, host watching, service-control, persistence, dependency, or network-fetch behavior was added.

## Known Limitation
SwiftBar exposes one image slot for a title line. Because of that, side-by-side logo mode uses one paired local template image that matches the text-cell order instead of rendering two independent inline custom images.
