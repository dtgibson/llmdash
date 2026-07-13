# Deployment Record — Cross-Surface Visual Refinement

**Date:** 2026-07-12
**Outcome:** DEPLOYED AND HEALTHY
**Release commit:** `2925489` (`Improve dashboard and menu visual hierarchy`)

## Target

- Repository: `origin/main` (`https://github.com/dtgibson/llmdash.git`)
- Installed checkout: `/Users/developer/llmdash`
- Runtime: launchd agent `com.llmdash.dashboard`
- Dashboard: `http://127.0.0.1:8787`
- Native surface: marker-gated SwiftBar wrapper at `~/Library/Application Support/SwiftBar/Plugins/llmdash.5s.js`

This is a local-first application with no cloud deployment environment or CI workflow. The configured local test suite, QA report, security report, and production health checks are the release gates.

## Pre-Deploy Evidence

- Full suite: 488 total, 486 passed, 0 failed, 2 environment-dependent skips.
- QA: passed every acceptance criterion and regression check.
- Security: passed with zero findings at every severity.
- Source and installed checkouts were cleanly aligned at `965ba02`; `origin/main` was synchronized and there were no conflicts.
- The existing launchd service and dashboard were healthy before deployment.

## Actions Performed

1. Committed the verified change as `2925489` and pushed `main` to `origin`.
2. Fast-forwarded `/Users/developer/llmdash` from `965ba02` to `2925489`.
3. Regenerated and reloaded the existing launchd service with its absolute Node, Claude, and Codex command paths.
4. Regenerated the marker-gated SwiftBar wrapper so it executes the tracked plugin from `/Users/developer/llmdash`.

## Deployment Note

The first launchd reload returned macOS bootstrap error 5. The launchd event log identified a transient `Operation already in progress` race between the installer's idempotent bootout and immediate bootstrap; the generated plist and all binary paths were valid. After confirming the service was stopped and the transition had settled, one clean reload succeeded. No code rollback or manual plist edit was needed.

## Post-Deploy Verification

- Installed checkout is clean at `2925489`.
- `com.llmdash.dashboard` reports `state = running` with `/Users/developer/llmdash` as its working directory.
- `/` returns HTTP 200 with the expected CSP, `nosniff`, `no-referrer`, and `no-store` headers and serves the refined page shell.
- `/api/state` returns two tool records with a current generation timestamp.
- `/api/hosts` returns both configured hosts with a current generation timestamp.
- The installed SwiftBar wrapper runs successfully and emits the new `◆ Claude Code` / `▲ Codex` hierarchy, indented semantic window rows, attached diagnostics, and quiet action region using production paths.
- The production dashboard was inspected in Chrome at `127.0.0.1:8787`; the host hierarchy, account gauges, warning/critical states, pacing, model limits, and responsive composition render cleanly.

Existing runtime conditions remain honest and non-blocking: the configured remote VM is currently unreachable, the last Claude reading is stale, and prior Claude auto-refresh timeout messages remain in the historical error log. Healthy local/Codex data continues rendering and these conditions predate the visual release.

## Rollback

If rollback is required, create and push a revert of `2925489`, fast-forward `/Users/developer/llmdash`, then rerun the existing service-install and badge-setup commands. The release changed no API, storage schema, persistence, dependency, or data-retention contract, so no data migration or destructive recovery step is required.
