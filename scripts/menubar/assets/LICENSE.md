# Menu-bar badge tool-mark assets

`claude-mark.png` and `codex-mark.png` are bundled monochrome 26x26 transparent
PNG template images for SwiftBar's `templateImage=` parameter. SwiftBar tints
template images to the menu-bar foreground color.

## Sources

- `claude-mark.png` is derived from **Claude AI symbol.svg** on Wikimedia Commons.
  The Commons page lists the source as Anthropic and marks the file CC0 1.0.
- `codex-mark.png` is derived from **OpenAI logo 2025 (symbol).svg** on Wikimedia
  Commons. Codex is an OpenAI product, so llmdash uses the OpenAI blossom mark for
  Codex. The Commons page identifies OpenAI as the author and describes the symbol
  as public-domain textlogo material with a trademark notice.

Source pages:

- https://commons.wikimedia.org/wiki/File:Claude_AI_symbol.svg
- https://commons.wikimedia.org/wiki/File:OpenAI_logo_2025_(symbol).svg

## Trademark posture

These marks are off by default and appear only when the user chooses **Tool marks
-> Logos** in the menu-bar Display submenu. The neutral text glyphs (`◆` for
Claude and `▲` for Codex) are always emitted too, so a logo is never the sole
carrier of a reading or tool identity.

The intended use is nominative: small, monochrome, local, opt-in, and not implying
endorsement by Anthropic or OpenAI. The logos may still be protected as trademarks
even where the underlying artwork is available under a permissive copyright
status.
