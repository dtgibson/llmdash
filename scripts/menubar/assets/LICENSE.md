# Menu-bar badge tool-mark assets

`claude-mark.png` and `codex-mark.png` are bundled monochrome 16x16 transparent
PNG template images. The badge recolors them to the current title color and emits
the result with SwiftBar's `image=` parameter.

SwiftBar provides one image slot per menu item line. In the Claude-vs-Codex
side-by-side logo preset, the badge composes one title image at render time from
the local marks plus the current 5-hour/weekly numbers so the visible order stays
`▪`, Claude logo, Claude numbers, Codex logo, Codex numbers.

`claude-codex-mark.png` and `codex-claude-mark.png` are paired 34x16 template
images built from the same two marks and retained with the source set for compact
paired-logo uses.

## Sources

- `claude-mark.png` is derived from **Claude AI symbol.svg** on Wikimedia Commons.
  The Commons page lists the source as Anthropic and marks the file CC0 1.0.
- `codex-mark.png` is derived from **OpenAI logo 2025 (symbol).svg** on Wikimedia
  Commons. Codex is an OpenAI product, so llmdash uses the OpenAI blossom mark for
  Codex. The Commons page identifies OpenAI as the author and describes the symbol
  as public-domain textlogo material with a trademark notice.
- `claude-codex-mark.png` and `codex-claude-mark.png` are local composites of the
  two derived marks above.

Source pages:

- https://commons.wikimedia.org/wiki/File:Claude_AI_symbol.svg
- https://commons.wikimedia.org/wiki/File:OpenAI_logo_2025_(symbol).svg

## Trademark posture

These marks are off by default and appear only when the user chooses **Tool marks
-> Logos** in the menu-bar Display submenu. The neutral text glyphs (`◆` for
Claude and `▲` for Codex) remain the fallback for xbar, non-SwiftBar hosts, or an
image-render failure, so a logo is never the only available carrier of a reading
or tool identity.

The intended use is nominative: small, monochrome, local, opt-in, and not implying
endorsement by Anthropic or OpenAI. The logos may still be protected as trademarks
even where the underlying artwork is available under a permissive copyright
status.
