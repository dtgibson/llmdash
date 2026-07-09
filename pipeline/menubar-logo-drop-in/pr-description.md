# PR Description — Menu-Bar Logo Drop-In

## Summary
- Changes SwiftBar Logos mode from additive logo art to a true visible replacement
  for the `◆` / `▲` tool glyphs.
- Recolors bundled monochrome logo PNGs to the current title color and emits them
  through SwiftBar's `image=` parameter.
- Keeps neutral text glyphs as the fallback for xbar, non-SwiftBar output, or a
  failed image read/encode.
- Updates README, asset notes, Legend copy, and tests to match the replacement
  behavior.

## Implementation Notes
- The renderer now generates the logo image before composing title text. Only
  after that succeeds does it strip the visible tool mark from each tool cell.
- Single-tool logo mode uses a 16x16 recolored image; side-by-side tool logo mode
  uses the existing paired 34x16 image in the same cell order.
- No dependency, API, polling, persistence, host watching, service-control, or
  network fetch behavior was added.

## Verification
- `node --test tests/menubar-display.test.js tests/hosts-zerodep.test.js tests/hosts-disclosure.test.js tests/menubar-install.test.js`
- Direct render check: `▪ 12 61 | color=#ff6b6b image=<base64>`, no visible
  `◆` / `▲`, decoded image dimensions 34x16.
