# Deployment Report — Dashboard Tool Grouping

**Date:** 2026-07-13
**Outcome:** LIVE
**Release commit:** `044a50a` (`Reorganize dashboard by tool and fix Codex windows`)
**Previous production commit:** `ba33302`
**Target:** `/Users/developer/llmdash`, macOS LaunchAgent
`com.llmdash.dashboard`, served locally and over the user's tailnet

## Release Actions

- Committed the verified release and pushed `main` to
  `https://github.com/dtgibson/llmdash.git`.
- Fast-forwarded the clean production checkout from `ba33302` to `044a50a`.
- Reloaded `com.llmdash.dashboard` and verified the installed revision, live
  response contracts, Codex window identity, dashboard document, and menu-bar
  compatibility.

There is no staging environment for this single-user local service. The release
went directly to the existing production checkout after the complete
manual-local test, design, and security gates passed.

## Deployment Recovery Note

The installer's first reload hit macOS `launchctl bootstrap` error 5 after it
had already unloaded the prior job. Production was immediately returned to
`ba33302`; a fresh service install restored the previous revision and all health
endpoints before deployment work continued.

Diagnosis confirmed the generated plist was valid, correctly owned, and used
the expected absolute paths. The successful clean bootstrap after rollback
isolated the failure to the installer's immediate `bootout`→`bootstrap` handoff,
a launchd timing issue also observed on earlier releases. Because this release
changed no service path or environment value, production was then switched to
`044a50a` and restarted with `launchctl kickstart -k`, retaining the freshly
generated service definition. The new process started cleanly and every health
check passed. No application or data rollback remains in effect.

## Production Health Check

| Check | Result | Evidence |
|---|---|---|
| Installed revision | Pass | Clean `main` at `044a50a`, aligned with `origin/main` |
| LaunchAgent | Pass | `com.llmdash.dashboard` is running from `/Users/developer/llmdash`; PID `88655` |
| Dashboard document | Pass | `GET /` → 200 in 138 ms and serves the limits-first/detail-group shells |
| State API | Pass | `GET /api/state` → 200 with both Claude and Codex tools |
| Multi-host API | Pass | `GET /api/hosts` → 200 in 98 ms |
| Codex insights API | Pass | 24h, 7d, and 30d return their requested canonical range with live summaries |
| Method contract | Pass | Codex insights `HEAD` → 200; `POST` → 405 |
| Security/cache headers | Pass | `no-store`, `nosniff`, no-referrer, and the existing CSP are present |
| Codex plan | Pass | Live plan is `ChatGPT Pro` |
| Codex 5-hour | Pass | `null` in the API and `not available` in the menu-bar dropdown; no fabricated percentage |
| Codex weekly | Pass | 46% used / 54% remaining, resetting July 20, 2026; the sole 10,080-minute reading is no longer mislabeled as 5-hour |
| Menu-bar compatibility | Pass | Installed script renders Codex `5-hour: not available` and `Weekly: 54%` without changing menu-bar source |
| Error monitoring | N/A | No external error-monitoring service is configured; the new launchd process and endpoints are healthy |

## Acceptance Outcome

- The deployed page leads with the fixed Claude/Codex account-limit comparison.
- Claude and Codex supporting statistics are grouped under their respective
  tool headings.
- The exact deployed assets are the build that passed desktop inspection,
  accessibility checks, and 320px no-overflow emulation.
- Missing current Codex windows cannot be revived from historical database
  rows; historical snapshots remain available to Trends only.

## Release Gate Evidence

- Full regression: 552 tests total, 550 passed, 0 failed, 2 expected
  environment-dependent skips.
- Focused dashboard/client suite: 47 passed, 0 failed.
- Independent security boundary suite: 117 passed.
- Design lint and whitespace checks: clean.
- Hosted CI is intentionally absent (`gh run list` is empty); this project uses
  the configured manual-local release gate because hosted runners cannot verify
  the user's LaunchAgent, local provider data, or tailnet surface.
- No new environment variable, secret, dependency, schema, migration, or
  menu-bar source change was deployed.

## Rollback

The immediate known-good revision is `ba33302`. If a later issue requires
rollback, detach the installed checkout at that revision and reload
`com.llmdash.dashboard`. This release has no migration or new persisted value,
so no data restoration is needed.
