# Deployment Report - Compact Mode Display Honesty

**Date:** 2026-07-08
**Commit:** `1ee31db`
**Environment:** local launchd service, installed checkout at `/Users/developer/llmdash`
**Result:** PASSED

## Deployment

- Pushed `1ee31db` to `origin/main`.
- Fast-forwarded the installed checkout from `78ee191` to `1ee31db`.
- Restarted the local launchd agent `com.llmdash.dashboard`.

## Health Checks

- `GET /api/state` returned 200.
- `GET /api/hosts` returned 200.
- `launchctl print gui/502/com.llmdash.dashboard` reported `state = running`, with working directory `/Users/developer/llmdash`.
- Installed checkout was clean at `1ee31db`.
- The installed SwiftBar wrapper emitted exactly one status-bar line before the first separator; live output placed `Watching 2 machines · 1 not reachable` below `---`.
- A forced installed compact side-by-side render emitted `▪ S12 T80 D⊘` as the only title line, followed by `---` and the dropdown copy `Watching 3 machines · 1 not reachable`.

## Notes

The installer hook `scripts/install-macos.sh --service install /Users/developer/llmdash` unloaded the old job and then returned launchd `Bootstrap failed: 5: Input/output error`. The plist passed `plutil -lint`; a direct `launchctl bootstrap gui/502 /Users/developer/Library/LaunchAgents/com.llmdash.dashboard.plist` succeeded. No rollback was needed.
