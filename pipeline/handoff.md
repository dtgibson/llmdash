# Handoff — Menu-Bar Logo Drop-In

Feature: `menubar-logo-drop-in`
Lane: `maintain`
Date: 2026-07-09

## What Changed
- SwiftBar Logos mode now replaces visible `◆` / `▲` tool glyphs with logo image data instead of adding logo art beside the glyphs.
- Logo PNGs are recolored to the current title color before emission, so the logo follows the same state color as the glyph it replaces.
- Single-tool logo mode emits a 16x16 image; side-by-side tool mode emits one paired 34x16 image in cell order.
- xbar, non-SwiftBar output, and image read/decode/encode failures keep the neutral text glyphs.
- README, asset notes, Legend copy, tests, and context files now describe the replacement/fallback split.

## Why
The user expected the Logos option to be a true drop-in for the tool glyphs. The prior implementation made Logos additive and left duplicate identity marks in the title. The new behavior keeps the recognizable logo cue without losing the honest text fallback.

## Verification
- Focused menu-bar suite passed: 83 passing, 0 failing, 2 skipped.
- Full `npm test` passed: 468 passing, 0 failing, 2 skipped.
- Deployment verified from `/Users/developer/llmdash` at commit `17d4ed3`.
- Installed SwiftBar output emitted `▪ 3 56 | color=#ff6b6b image=<base64>`.
- The installed title line contains `image=`, does not contain `templateImage=`, and does not contain visible `◆` / `▲` tool glyphs.
- The emitted paired image decoded as 34x16, and its first visible pixel matched the title color `#ff6b6b`.

## Deployment
- Pushed `17d4ed3` to `origin/main`.
- Fast-forwarded `/Users/developer/llmdash`.
- Restarted `com.llmdash.dashboard`.
- Relaunched SwiftBar.
- `/api/state` and `/api/hosts` returned successfully.
- Existing remote host `SRDev VM` remains unreachable; this is unrelated existing state.

## Context Updates
- `DECISIONS.md` logs the logo replacement behavior as an explicit modification of the earlier neutral-floor/paired-image decisions.
- `CLAUDE.md` records the convention: successful SwiftBar logo mode may hide text marks only after same-color local image generation succeeds; all other paths keep text fallback.
- `PRODUCT_CONTEXT.md` now describes opt-in logo marks as same-color SwiftBar replacements with neutral text fallback.
- `ROADMAP.md` shipped count is updated to 18 with this work as the latest shipped item.
