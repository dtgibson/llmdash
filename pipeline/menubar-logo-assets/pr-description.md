# PR Description — Menu-Bar Logo Assets

## Summary
- Replaces the existing placeholder menu-bar logo assets with bundled local Claude
  and Codex marks.
- Keeps the existing neutral `◆` / `▲` glyph floor, SwiftBar-only `templateImage=`
  layering, and xbar/no-image fallback behavior.
- Documents source pages, trademark posture, and the choice to use the OpenAI
  blossom mark for Codex.

## Implementation Notes
- `scripts/menubar/assets/claude-mark.png` is now a 26x26 transparent monochrome
  PNG derived from the Claude symbol.
- `scripts/menubar/assets/codex-mark.png` is now a 26x26 transparent monochrome
  PNG derived from the OpenAI symbol because Codex is an OpenAI product.
- The badge still performs no first-use logo fetch. Images are local files and are
  read only when the user selects **Tool marks -> Logos**.
- No API, polling, service-control, host-list, or menu action contract changed.

## Verification
- `node --test tests/menubar-display.test.js tests/hosts-zerodep.test.js tests/hosts-disclosure.test.js tests/menubar-install.test.js`
- `file scripts/menubar/assets/claude-mark.png scripts/menubar/assets/codex-mark.png`
