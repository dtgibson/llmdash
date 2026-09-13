# Change Brief — Recognizable Favicon and PWA Icon

## What is changing
Create a distinctive, project-owned llmdash icon system for the existing web
dashboard, derived from its square, monospace, and headroom visual vocabulary
rather than from the Claude or OpenAI marks. Add the local favicon, touch/PWA
sizes, manifest metadata, and head references needed by both dashboard pages;
serve them through the existing static path with focused route/markup tests.

## Why now
llmdash currently supplies no favicon, touch icon, or web-app manifest, so saved
favorites and installed shortcuts fall back to generic browser artwork. The user
wants the dashboard to be immediately recognizable in those compact contexts.

## User-facing impact
Tabs, favorites, bookmarks, home-screen shortcuts, and PWA-capable launchers gain
a consistent llmdash identity that remains clear from favicon scale through app
icon scale. No dashboard flow, data display, API, persistence, service worker,
offline behavior, install prompt, or menu-bar tool-mark behavior changes.

## Design pass
Needed — refine the existing dashboard's browser and installed-shortcut identity.
The mark must feel native to llmdash, read at 16–32 px, scale cleanly to touch and
192/512 px PWA uses, survive common light/dark chrome, and respect maskable-icon
safe areas without confusing the product with either provider it monitors.

## Decisions touched
- `Vanilla, zero-dependency stack` remains intact: bundled assets and metadata add no build step or runtime dependency.
- `Inline-style CSP + no-store static assets` extends to the new local icon/manifest routes with the same security and freshness posture.
- `Badge display options` remains intact: the existing `▪` product cue and `◆`/`▲` tool cues may inform the family, but its menu behavior does not change.
- `Menu-bar logo assets` remains intact: Claude/OpenAI artwork stays provider-specific, opt-in, local-only, and is not reused as llmdash's product icon.

## What done looks like
Both HTML surfaces reference one coherent local icon family; declared favicon,
touch, manifest, standard PWA, and maskable assets resolve with correct MIME types
and no console/network errors. Visual checks prove recognition at 16/32 px and
clean rendering at 180/192/512 px in light, dark, and masked previews.
