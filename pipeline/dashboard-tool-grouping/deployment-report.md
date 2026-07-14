# Deployment Report — Dashboard Tool Grouping

**Date:** 2026-07-13
**Status:** READY — awaiting explicit production approval
**Target:** `/Users/developer/llmdash`, macOS LaunchAgent
`com.llmdash.dashboard`
**Known-good production revision:** `ba33302`

## Release Readiness

| Check | Result | Evidence |
|---|---|---|
| Intended outcome | Pass | The change brief requires limits-first Claude/Codex comparison, tool-grouped detail, and duration-backed Codex window identity. |
| Tester | Pass | 552 tests discovered; 550 passed, 0 failed, 2 environment-dependent skips. Focused frontend suite is 47/47. |
| Auditor | Pass | No security or privacy findings; 117 focused boundary tests passed. |
| Design QA | Pass | Design lint is clean and exact 320px browser emulation has no overflow. |
| Branch and conflicts | Pass | Development checkout is on `main`, based on `origin/main` at `ba33302`, with no unresolved conflicts. The verified release changes are ready to commit. |
| CI/CD | Pass / manual-local | Hosted CI is intentionally absent (`gh run list` is empty). The configured release gate is the passing local test, audit, and live-health workflow. |
| Environment | Pass | No new environment variable, secret, dependency, schema, or migration is required. |
| Production checkout | Pass | `/Users/developer/llmdash` is clean on `main` at `ba33302`, aligned with `origin/main`. |
| Current service | Pass | `com.llmdash.dashboard` is running from the production checkout and has never exited; existing state, hosts, and Codex-insights endpoints respond. |

There is no staging environment for this single-user local service. After
approval, the verified release will be committed and pushed to `main`, the
production checkout will be fast-forwarded, and the existing installer will
regenerate and reload the LaunchAgent.

## Planned Production Verification

- Confirm the installed checkout is clean and aligned with the release commit.
- Confirm the LaunchAgent is running from `/Users/developer/llmdash` with no
  failed exit.
- Verify `/`, `/api/state`, `/api/hosts`, and all three Codex-insights ranges.
- Confirm production reports the live Codex 10,080-minute window as weekly and
  leaves a missing 300-minute window unavailable.
- Verify response security/cache headers and HEAD/POST method contracts.
- Confirm the served document contains the limits-first, tool-grouped shells.
- Re-run the installed menu-bar script to ensure missing-window compatibility.

## Rollback

If production health fails, immediately return the installed checkout to
`ba33302` and reload `com.llmdash.dashboard`. This release has no data migration,
schema change, or new persisted value, so rollback requires no data repair.
