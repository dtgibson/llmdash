# Handoff — Menu-Bar Logo Side-By-Side

Feature: `menubar-logo-side-by-side`
Lane: `maintain`
Date: 2026-07-08

## What Changed
- Single-tool logo assets were resized to 16x16 transparent PNG template images.
- Side-by-side tool logo mode now uses paired 34x16 Claude/Codex and Codex/Claude template images.
- The SwiftBar renderer emits the paired image when `toolMark=logo`, the host is SwiftBar, and the tool view has two side-by-side cells.
- The neutral `◆` / `▲` text floor remains visible in all cases.
- README, the asset license note, and the menu Legend explain the paired-image behavior.

## Why
SwiftBar provides one image slot per title line, so true inline side-by-side custom logos are not available. A paired local template image gives the user-visible logo cue without making the mark oversized or adding network fetch behavior.

## Verification
- Focused menu-bar suite passed: 83 passing, 0 failing, 2 skipped.
- Full `npm test` passed: 468 passing, 0 failing, 2 skipped.
- Deployment verified from `/Users/developer/llmdash` at commit `004c72d`.
- The installed SwiftBar output emitted a 34x16 paired `templateImage=` and kept both `◆` and `▲` in the title line.

## Deployment
- Pushed `004c72d` to `origin/main`.
- Fast-forwarded `/Users/developer/llmdash`.
- Restarted `com.llmdash.dashboard`.
- Relaunched SwiftBar.
- `/api/state` and `/api/hosts` returned successfully.
- Existing remote host `SRDev VM` remains unreachable; this is unrelated existing state.

## Context Updates
- `DECISIONS.md` logs the paired-image decision as an explicit modification of the prior side-by-side text-only implication.
- `CLAUDE.md` extends the brand-asset convention with status-bar sizing and paired local images for SwiftBar side-by-side title lines.
- `PRODUCT_CONTEXT.md` now describes opt-in logo marks as status-bar-sized and paired in side-by-side.
- `ROADMAP.md` shipped count is updated to 17 with this work as the latest shipped item.
