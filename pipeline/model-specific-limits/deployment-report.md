# Deployment Report: Model-Specific Limits

Date: 2026-07-10
Feature: `model-specific-limits`
Lane: `feature`
Runtime commit: `dfc0c1e Add model-specific limit display`

## Deployment

- Confirmed source checkout `/Users/developer/devwork/llmdash` at `dfc0c1e`.
- Confirmed `origin/main` at `dfc0c1e`.
- Confirmed installed checkout `/Users/developer/llmdash` at `dfc0c1e` and clean.
- Restarted `com.llmdash.dashboard` with `launchctl kickstart -k gui/502/com.llmdash.dashboard`.
- Relaunched SwiftBar with `open -a SwiftBar`.

## Live Checks

- `scripts/install-macos.sh --service status` reports `running`.
- `launchctl print gui/502/com.llmdash.dashboard` reports `state = running`, working directory `/Users/developer/llmdash`, PID `45693`.
- `GET http://127.0.0.1:8787/api/state` succeeds and returns `modelLimits` arrays for both tools.
- `GET http://127.0.0.1:8787/api/hosts` succeeds. Local host is reachable; the pre-existing `SRDev VM` remote remains unreachable with `getaddrinfo ENOTFOUND http:snowravendev-vm`.
- SwiftBar is running from `/Applications/SwiftBar.app/Contents/MacOS/SwiftBar` with PID `25217`.

## Notes

The current live Claude reading does not include a model-specific cap, so `modelLimits` is empty in live API output. The parser and renderer are deployed and will show Fable/Sonnet-style caps when the next Claude `/usage` capture includes them.
