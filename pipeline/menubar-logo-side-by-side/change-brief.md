# Change Brief — Menu-Bar Logo Side-By-Side

## What is changing
The existing menu-bar **Tool marks -> Logos** option will be refined so it no
longer feels oversized, and side-by-side tool mode will show a logo cue instead
of silently falling back to text-only marks. SwiftBar supports one image slot per
title line, so side-by-side will use a single paired logo template image in the
same Claude/Codex order as the text cells, with the `◆` / `▲` text floor still
present for fallback and readability.

## Why now
After the bundled logo assets shipped, the single logo rendered too large in the
menu bar and the side-by-side tool preset did not show logo art at all. Both make
the Logos option feel less predictable than the Display menu implies.

## User-facing impact
When **Tool marks -> Logos** is selected in SwiftBar, single-tool glyphs use
smaller 16x16 local template images, and side-by-side Claude/Codex glyphs include
a paired logo image. xbar and failed image renders still show the neutral text
marks. No API, polling, host watching, service-control, or display persistence
contract changes.

## Decisions touched
- `Menu-bar logo assets — bundled local Claude and OpenAI/Codex marks...` remains
  intact, but this run adds the SwiftBar one-image-per-line constraint and the
  paired-image compromise for side-by-side mode.
- `Badge display options... opt-in logos with a neutral floor` remains intact:
  the neutral text floor stays unconditional and logo reads remain local-only.

## What done looks like
The bundled logo PNGs are status-bar-sized template images, paired local assets
exist for Claude/Codex and Codex/Claude order, and tests prove side-by-side
`toolMark=logo` emits a template image without removing the `◆` / `▲` fallback.
Docs and the Legend explain the side-by-side paired-image behavior.
