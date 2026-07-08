# PR Description — Menu-Bar Logo Side-By-Side

## Summary
- Shrinks the bundled single-logo template images from 26x26 to 16x16 canvases so
  they match the menu-bar text scale better.
- Adds paired 34x16 Claude/Codex and Codex/Claude template images for
  side-by-side tool mode.
- Updates the SwiftBar logo renderer so `toolMark=logo` emits a single-logo image
  for one tool cell and a paired image for two side-by-side tool cells, while
  keeping the `◆` / `▲` text floor.

## Implementation Notes
- SwiftBar has one image slot per title line, so side-by-side mode cannot render
  two independent inline custom PNGs. The paired image is the local, honest
  compromise.
- No new network fetch, dependency, API route, host polling, service-control, or
  display persistence behavior was added.
- README, asset license notes, and the Legend now explain the paired image.

## Verification
- `node --test tests/menubar-display.test.js tests/hosts-zerodep.test.js tests/hosts-disclosure.test.js tests/menubar-install.test.js`
- Direct render check: `▪ ◆12 ▲61 | color=#ff6b6b templateImage=<paired-png>` with a
  34x16 PNG and the `◆` / `▲` text fallback still present.
