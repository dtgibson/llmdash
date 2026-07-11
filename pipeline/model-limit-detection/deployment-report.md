# Deployment Report — Model Limit Detection

**Date:** 2026-07-11
**Commit:** `66507d9`
**Environment:** local launchd service, installed checkout at `/Users/developer/llmdash`
**Result:** PASSED

## Deployment

- Pushed `66507d9` to `origin/main`.
- Fast-forwarded the installed checkout `/Users/developer/llmdash` from `bc639f2` to `66507d9`.
- Restarted `com.llmdash.dashboard` with `launchctl kickstart -k gui/502/com.llmdash.dashboard`.
- Relaunched SwiftBar with `open -a SwiftBar`.

## Health Checks

- Installed checkout is clean at `66507d9`.
- `scripts/install-macos.sh --service status` reports `running`.
- `launchctl print gui/502/com.llmdash.dashboard` reports `state = running`, working directory `/Users/developer/llmdash`, PID `99434`.
- `GET http://127.0.0.1:8787/api/state` succeeds.
- Live Claude model cap verification: `claude-code` reports `Fable`, weekly window, `16%` used / `84%` remaining, reset `2026-07-18T06:00:00.000Z`.
- `GET http://127.0.0.1:8787/api/hosts` succeeds. Local host is reachable; the pre-existing `SRDev VM` remote remains unreachable with `getaddrinfo ENOTFOUND http:snowravendev-vm`.
- SwiftBar is running from `/Applications/SwiftBar.app/Contents/MacOS/SwiftBar` with PID `25217`.
- The installed SwiftBar plugin renders successfully from `/Users/developer/llmdash/scripts/menubar/llmdash.5s.js`.

## Notes

The deployed runtime now uses the shared guarded Claude reading writer for both auto-refresh and organic statusline captures. The live check verified that the model-cap API path remains populated after the service restart.
