# Deployment Report — Deeper Codex Insights

**Date:** 2026-07-13
**Outcome:** LIVE
**Release commit:** `8546dfd` (`Add deeper Codex insights`)
**Previous production commit:** `eb3b56f`
**Target:** `/Users/developer/llmdash`, macOS LaunchAgent
`com.llmdash.dashboard`, served locally and over the user's tailnet

## Release Actions

- Committed the verified release and pushed `main` to
  `https://github.com/dtgibson/llmdash.git`.
- Fast-forwarded the clean production checkout from `eb3b56f` to `8546dfd`.
- Regenerated the production LaunchAgent with the installed absolute Node,
  Codex, and Claude executable paths.
- Loaded the agent in the current user's `gui/502` launchd domain.
- Performed live health, contract, privacy, range, and response-time checks.

There is no staging environment for this single-user, machine-local service.
The release went directly to the existing production checkout after the full
manual-local gate passed.

## Deployment Recovery Note

The installer's first reload attempt returned macOS `launchctl bootstrap` error
5 after it had already unloaded the prior process. Production was temporarily
stopped. Diagnosis confirmed that the generated plist was valid, enabled,
correctly owned, and referenced executable paths; launchd showed the old service
fully removed and no application crash. One direct bootstrap after removal
completed successfully. The recovered agent is running the new commit with one
start, no exit, and all health checks passing. No rollback was required.

## Production Health Check

| Check | Result | Evidence |
|---|---|---|
| LaunchAgent | Pass | `com.llmdash.dashboard` is `running`; current process has never exited |
| Installed revision | Pass | Clean `main` at `8546dfd`, aligned with `origin/main` |
| Dashboard document | Pass | `GET /` → 200 in 36 ms |
| Existing state API | Pass | `GET /api/state` → 200 in 28 ms |
| Existing multi-host API | Pass | `GET /api/hosts` → 200 in 36 ms |
| Codex insights API | Pass | `GET /api/codex-insights?range=30d` → 200 in 41 ms |
| Method contract | Pass | Insights `HEAD` → 200; `POST` → 405 |
| Cache/security headers | Pass | `no-store`, `nosniff`, and CSP present |
| Account facts | Pass | Live plan is `ChatGPT Pro`; credit status is explicit |
| Range support | Pass | 24h, 7d, and 30d each return the requested canonical range and live data |
| Metric support | Pass | Reasoning, turns, sessions, busiest day, models, effort, tools, context, compactions, total latency, and first-token latency are available |
| Daily evidence | Pass | 24h has 1 point, 7d has 5 points, and 30d has 6 points; thin-chart rules remain client-side |
| Aggregate privacy | Pass | Zero forbidden content/identifier keys and zero path-shaped values across all three live responses |
| Error monitoring | N/A | No external error-monitoring service is configured; launchd state and local logs are clean after recovery |

The Mac UI automation transport was unavailable for a fresh post-deploy browser
screenshot. This did not block the release: production serves the exact assets
that passed the earlier Chrome render inspection, 320/860 responsive contracts,
and client rendering suite; the live document and all range/API interactions were
rechecked against the running production process.

## Acceptance Criteria

| ID | Result | Production verification |
|---|---|---|
| QA-01 | Pass | The shipped document places the insights section after primary account-limit content. |
| QA-02 | Pass | Live 24h, 7d, and 30d requests return canonical matching ranges. |
| QA-03 | Pass | Range-specific responses change as a unit while account facts remain account-wide. |
| QA-04 | Pass | Every metric carries independent live availability. |
| QA-05 | Pass | The production contract retains `available` separately from numeric zero. |
| QA-06 | Pass | Shipped copy labels activity `This machine` and account facts `Account-wide`. |
| QA-07 | Pass | Live reasoning share and token counts are available. |
| QA-08 | Pass | Live recorded-turn count and average tokens per turn are available. |
| QA-09 | Pass | Live session count and average tokens per session are available without IDs. |
| QA-10 | Pass | Live busiest-day data is available and uses the tested deterministic tie rule. |
| QA-11 | Pass | Live bounded model mix is available. |
| QA-12 | Pass | Live allowlisted effort mix is available. |
| QA-13 | Pass | Live fixed-category tool breakdown is available; payload probes are clean. |
| QA-14 | Pass | Live explicit context pressure is available. |
| QA-15 | Pass | Live compaction count and affected-session aggregate are available. |
| QA-16 | Pass | Live explicit total and first-token latency aggregates are available. |
| QA-17 | Pass | Production renders the server-observed plan as `ChatGPT Pro`. |
| QA-18 | Pass | Production returns explicit account-wide credit status without invented units. |
| QA-19 | Pass | Multi-day ranges return sufficient daily evidence for the tested trend renderer. |
| QA-20 | Pass | Endpoint scope remains local-machine only and adds no peer fan-out. |
| QA-21 | Pass | The deployed client retains the verified concise no-data state. |
| QA-22 | Pass | Malformed-record isolation is covered in the exact deployed parser build. |
| QA-23 | Pass | Live responses contain no raw content, paths, email, session IDs, or turn IDs. |
| QA-24 | Pass | The deployed insight collector adds no new outbound request or subprocess. |
| QA-25 | Pass | The live HTTP handler serves the refreshed cache; scans stay off request paths. |
| QA-26 | Pass | Mixed-version capability isolation passed in the deployed 539-test build. |
| QA-27 | Pass | Live headers and aggregate probe are clean; hostile-input coverage passed. |
| QA-28 | Pass | Production remains zero-dependency with no build step or new store. |
| QA-29 | Pass | Existing `/api/state` and `/api/hosts` remain 200; menu files are unchanged. |
| QA-30 | Pass | Deployed controls retain keyboard, focus, pressed-state, and text-equivalent contracts. |
| QA-31 | Pass | Exact deployed assets passed 320/860 light/dark responsive contracts and prior Chrome inspection. |
| QA-32 | Pass | No database migration or insight snapshot write was deployed. |

## Release Gate Evidence

- Full regression: 539 tests total, 537 passed, 0 failed, 2 expected
  environment-conditional skips.
- Design lint: 0 findings.
- Source and staged diff checks: clean.
- Security, backend, frontend, and privacy re-audits: no release blocker.
- Hosted CI: intentionally absent for this machine-local service; `gh run list`
  is empty. The configured release gate is `manual-local` because hosted runners
  cannot validate the user LaunchAgent, local Codex data, or tailnet surface.
- No new environment variables, secrets, runtime dependencies, database changes,
  or menu-bar changes were required.

## Rollback

The immediate known-good runtime is `eb3b56f`. If rollback becomes necessary,
switch the installed checkout to that revision and reload the LaunchAgent, then
revert `8546dfd` on `main`. No database or data-file restoration is required.
