# Deployment Report: Menu-bar Logo Drop-in

Date: 2026-07-09
Feature: `menubar-logo-drop-in`
Lane: `maintain`
Commit: `17d4ed3 Make menu-bar logos replace tool glyphs`

## Deployment

- Pushed `17d4ed3` to `origin/main`.
- Fast-forwarded the installed checkout at `/Users/developer/llmdash` to `17d4ed3`.
- Restarted `com.llmdash.dashboard` with `launchctl kickstart -k gui/502/com.llmdash.dashboard`.
- Relaunched SwiftBar with `open -a SwiftBar`.

## Live Checks

- LaunchAgent is running from `/Users/developer/llmdash` with PID `7079`.
- SwiftBar is running from `/Applications/SwiftBar.app/Contents/MacOS/SwiftBar` with PID `7427`.
- `GET http://127.0.0.1:8787/api/state` succeeds and returns current Claude Code and Codex limits.
- `GET http://127.0.0.1:8787/api/hosts` succeeds. The local host is reachable; the pre-existing `SRDev VM` remote remains unreachable with `getaddrinfo ENOTFOUND http:snowravendev-vm`.
- Installed checkout reports `17d4ed3`.

## Render Verification

Forced the installed renderer to SwiftBar Logos mode with:

- group: `tool`
- hosts: `all`
- layout: `side-by-side`
- density: `compact`
- window: `lowest`
- toolMark: `logo`

Observed title line:

```text
▪ 3 56 | color=#ff6b6b image=<base64>
```

Assertions:

- `image=` is present.
- `templateImage=` is absent.
- Text tool glyphs `◆` and `▲` are absent from the title.
- The emitted image is `34x16`, matching paired side-by-side logo mode.
- The first visible image pixel is `rgba(255, 107, 107, 6)`, confirming the logo artwork is tinted with the title color `#ff6b6b`.

The installed SwiftBar plugin output also starts with the same `image=` title and dark dropdown text.
