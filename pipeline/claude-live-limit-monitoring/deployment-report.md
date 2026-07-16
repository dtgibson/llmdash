# Deployment Report — Claude live limit monitoring

**Date:** 2026-07-16
**Outcome:** ROLLED BACK
**Release commit:** `5e6064e8e30af66104d220e5f06f2c635d883716`
**Source rollback commit:** `5dac9b5f56398917e68900bbfc12fa95be055f32`
**Production rollback target:** `668569095186dcb83a109be7fe74af4cb7723f3b`
**Environment:** `/Users/developer/llmdash`, macOS LaunchAgent `com.llmdash.dashboard`

## Summary

The verified release was committed, pushed, fast-forwarded into the clean
installed checkout, and restarted twice with `launchctl kickstart -k`. The
process-lifecycle portion behaved correctly in production: startup removed the
exact-marker July 2 production orphan, both bounded probes cleaned up their
complete process trees after timeout, the second restart did not stack a
monitor, and the user's independent Claude processes retained their original
identities throughout.

The freshness acceptance criterion did not pass. Both immediate probes timed
out without advancing `claude-ratelimits.json`. At the five-minute recovery
point, actively changing Claude subagent transcripts were not considered by
the activity gate because `newestTranscriptMtimeMs()` scans only the direct
`.jsonl` children of each project directory. The newest direct transcript was
14:25:20 PT while nested subagent transcripts advanced through 14:36:01 PT.
The service therefore classified the active work as idle once the direct file
aged beyond ten minutes and did not open the recovery retry.

Production was immediately detached back to `6685690` and restarted. The
application/test changes were then reverted from `main` by `5dac9b5`; the
investigation evidence was retained for the next engineering pass.

## Release and live evidence

| Check | Result | Evidence |
|---|---|---|
| Release boundary | Pass | Ten intended fix/test/evidence files were committed; `pipeline/session-state.json` and `pipeline/handoff.md` were excluded. |
| Push and install | Pass | `5e6064e` reached `origin/main`; the clean installed checkout fast-forwarded from `6685690` to the release. |
| First restart | Pass | `launchctl kickstart -k` started PID 3550; `/`, `/api/state`, and `/api/hosts` returned 200. |
| Production stale-orphan cleanup | Pass | The exact-marker July 2 tree under `/Users/developer/llmdash/data` disappeared on startup. No unrelated command-name match was used. |
| Independent Claude isolation | Pass | Independent Claude PIDs 49629 and 52796 kept the same PID, birth time, PGID, and session through both release restarts and rollback. Neither was signaled. |
| First probe teardown | Pass | The new marker-owned probe timed out, preserved the last-good reading, and left no process or scratch file. |
| Second restart | Pass | The approved second kickstart started PID 5850 with `runs = 4` and `last exit code = 0`; endpoints stayed healthy and no duplicate poller/orphan accumulated. |
| Second probe teardown | Pass | The second bounded probe also timed out and left no production marker process or scratch file. |
| Fresh capture | **Fail** | `capturedAt` remained `2026-07-14T02:31:13.698Z`; Claude weekly remained 100% used / 0% remaining. |
| Activity-driven recovery | **Fail** | Nested subagent transcripts advanced, but the one-level activity scan saw only the aging direct transcript and returned idle before the recovery retry. |
| API parity | Pass, stale | `/api/state` and local `/api/hosts` returned the same Claude weekly 100% used / 0% remaining and the same capture timestamp. |
| Dashboard/SwiftBar parity | Pass, stale | The browser continued to consume the same state contract; the installed SwiftBar renderer showed `0% remaining — Claude Code · Weekly · stale` and `Weekly: limit reached`. |
| Rollback | Pass | Installed checkout detached to `6685690`; LaunchAgent PID 18477 reported running with `runs = 5`, `last exit code = 0`; all three live endpoints returned 200. |
| Source rollback | Pass | `origin/main` is `5dac9b5`; application and test paths are byte-equivalent to `6685690`. |

## Rollback state

- Production is running from detached revision `6685690`.
- The source branch is at `5dac9b5`; only the pipeline evidence from the failed
  release remains relative to `6685690`.
- No schema, dependency, configuration, or persisted-data migration occurred,
  so no data restoration was required.
- `claude-ratelimits.json` remains the preserved July 14 last-good file.

## Remaining blocker and limitation

The fix is not ready to deploy again until live activity discovery includes the
bounded nested transcript locations used by current Claude subagents and a live
recovery attempt produces a new capture. The probe's two production timeouts
also need to remain part of the next validation; recursive activity detection
alone guarantees retries, not a successful `/usage` capture.

A separate pre-existing exact-marker tree under
`/Users/developer/devwork/llmdash/data` remains outside the installed production
instance's cleanup boundary. It was intentionally observed but not signaled or
removed. Production's `/Users/developer/llmdash/data` marker tree is clear.
