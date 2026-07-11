# Deployment Report: Model-Specific Limits

Date: 2026-07-10
Feature: `model-specific-limits`
Lane: `feature`
Runtime commit: `dfc0c1e Add model-specific limit display`
Closeout commit: `84df2fc Document model-specific limit deployment`

## Deployment

- Confirmed source checkout `/Users/developer/devwork/llmdash` at `dfc0c1e`.
- Confirmed `origin/main` at `dfc0c1e`.
- Confirmed installed checkout `/Users/developer/llmdash` at `dfc0c1e`, then fast-forwarded it to closeout commit `84df2fc`.
- Restarted `com.llmdash.dashboard` with `launchctl kickstart -k gui/502/com.llmdash.dashboard`.
- Relaunched SwiftBar with `open -a SwiftBar`.
- Restarted `com.llmdash.dashboard` again after the closeout fast-forward so the running process matches the final installed checkout.

## Live Checks

- `scripts/install-macos.sh --service status` reports `running`.
- `launchctl print gui/502/com.llmdash.dashboard` reports `state = running`, working directory `/Users/developer/llmdash`, PID `49507`.
- `GET http://127.0.0.1:8787/api/state` succeeds and returns `modelLimits` arrays for both tools.
- Live Claude model cap verification: `claude-code` reports `Fable`, weekly window, `96%` used / `4%` remaining, reset `2026-07-11T05:59:00.000Z`.
- `GET http://127.0.0.1:8787/api/hosts` succeeds. Local host is reachable; the pre-existing `SRDev VM` remote remains unreachable with `getaddrinfo ENOTFOUND http:snowravendev-vm`.
- SwiftBar is running from `/Applications/SwiftBar.app/Contents/MacOS/SwiftBar` with PID `25217`.

## Notes

The final live reading includes a Fable cap, so the deployed parser and API path were verified against current runtime data, not only fixtures.
