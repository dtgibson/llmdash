# Claude live limit monitoring

## What is broken
- Claude monitoring serves a snapshot captured 2026-07-14, now more than 65 hours old.
- `/api/state` and `/api/hosts` report weekly `usedPct: 100` / `remainingPct: 0` from that snapshot.
- Both the dashboard and SwiftBar dropdown render the same stale payload while a Claude CLI transcript is actively updating.
- `claude-ratelimits.json` is not advancing; auto-refresh times out on repeated 30-second `/usage` probes.
- After a timeout, activity detection checks only direct project `.jsonl` files.
  Current Claude subagents write active transcripts beneath
  `<project>/<session>/subagents/workflows/<workflow>/*.jsonl`, so the monitor
  can incorrectly return `idle` while the CLI is active and leave its failure
  backoff in place.
- Detached probe process trees remain after reload/exit, consistent with teardown gaps present since July 2.

## Steps to reproduce
1. Run a Claude CLI session whose current work is written by a nested subagent
   and confirm the nested transcript mtime continues to update.
2. Observe that `claude-ratelimits.json` does not receive a corresponding fresh reading.
3. Read `/api/state` and `/api/hosts`; both return the 2026-07-14 Claude snapshot.
4. Open the dashboard and SwiftBar dropdown; both show weekly 0% remaining from that shared payload.
5. Observe auto-refresh timeout reports, repeated 30-second `/usage` timeouts, and orphaned probe descendants after reload/exit.

## Expected behavior
- Active Claude usage produces a recent limit reading without requiring a manual service restart.
- Activity discovery recognizes direct and current nested subagent transcripts
  using only bounded filesystem metadata, without following symlinks or reading
  transcript contents.
- `/api/state` and `/api/hosts` expose the same fresh, internally consistent weekly percentages.
- The dashboard and SwiftBar dropdown keep updating from that current shared state.
- A timed-out probe preserves the last known good reading and allows later refreshes to recover.
- Reload and exit terminate the complete probe process tree before monitoring resumes or stops.

## Blast radius
- Every Claude user of the dashboard and SwiftBar dropdown can see outdated weekly-limit status.
- Both presentation surfaces are affected because they consume the same stale API payload.
- Automatic recovery is impaired while `/usage` probes repeatedly occupy their 30-second timeout window.
- Reloads and exits can accumulate detached probe descendants, degrading long-running monitor reliability.

## What done looks like
- An updating Claude CLI session causes a newly captured limit reading within the normal refresh interval.
- A nested transcript advance after a timeout opens exactly one normal-cadence
  recovery attempt; stale transcripts remain idle and continuous writes cannot
  create duplicate probes.
- Both APIs return that fresh reading, and dashboard and SwiftBar display matching weekly status.
- Probe timeout tests verify last-known-good retention and a successful subsequent refresh.
- Reload/exit tests verify all probe descendants terminate and only one monitoring loop remains.
- Production validation shows no repeated orphan accumulation and no stale-reading regression.
