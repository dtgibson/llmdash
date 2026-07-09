# Change Brief — Menu-Bar Logo Drop-In

## What is changing
The menu-bar **Tool marks -> Logos** option will behave as a drop-in replacement
for the neutral `◆` / `▲` tool glyphs. When Logos is enabled in SwiftBar, the
status-bar title should show logo imagery in the tool-mark positions instead of
also showing the text glyphs. The logos should follow the same status color as
the rest of the title, just like the glyphs did. Non-SwiftBar hosts and failed
image rendering still use the neutral glyphs.

## Why now
The bundled logo work made the assets available, and the side-by-side pass made
both tool logos visible, but the output still shows the neutral glyphs alongside
the logo image. That makes Logos additive instead of the drop-in replacement the
Display menu promises.

## User-facing impact
When **Tool marks -> Logos** is selected in SwiftBar, the menu-bar title swaps
the tool glyph text for a same-color logo mark. The dropdown Legend and fallback
behavior remain honest: xbar, no-SwiftBar, or unreadable assets still show the
neutral `◆` / `▲` marks. No API, polling, host watching, service-control, or
display persistence contract changes.

## Decisions touched
- `Badge display options... opt-in logos with a neutral floor`: modifies the
  logo interpretation so the neutral floor remains the fallback path, not a
  visible duplicate in successful SwiftBar logo mode.
- `Menu-bar logo side-by-side — paired SwiftBar image, 16x16 single marks`:
  supersedes the visible `◆` / `▲` floor requirement for successful SwiftBar logo
  mode; the floor still applies to fallback and non-SwiftBar paths.

## What done looks like
SwiftBar logo mode emits same-color template images and no visible `◆` / `▲`
tool glyphs in the title line. Side-by-side tool mode still shows both tool
identities as logos at the same scale as the glyphs they replace. Tests cover
SwiftBar logo replacement, xbar fallback glyphs, image dimensions, and docs.
