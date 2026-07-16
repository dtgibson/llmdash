# Fix: Claude live limit monitoring

## What this does

This fixes the shared Claude limit producer behind both the dashboard and the
SwiftBar dropdown. The two surfaces already agreed because they consume the same
API state; the bad `weekly 0% remaining` value came from a stale
`claude-ratelimits.json` that the `/usage` probe was no longer refreshing
reliably.

The fix makes that producer recover and shut down cleanly:

- A timed-out probe still keeps the last-known-good limit reading, but newly
  advancing Claude transcript activity can trigger a bounded retry at the normal
  five-minute cadence instead of being hidden behind an hour-long failure
  backoff. When activity has not advanced, the existing exponential backoff
  remains in place.
- Probe teardown now snapshots the complete descendant ancestry as stable
  identities: PID, kernel-reported birth time, PGID, and session. It reacquires
  process information immediately before every individual TERM/KILL and fails
  closed if that identity changed. No negative-PGID signal is used, so a reused
  numeric process group cannot reach an independent user CLI.
- Startup removes scratch captures and reaps older orphan probe trees only when
  their command contains the exact generated probe-file marker under this
  instance's data directory. The last-known-good `claude-ratelimits.json` is
  never part of cleanup.
- `SIGTERM`/`SIGINT` now stop the monitor and await probe teardown before the
  server exits. A teardown already in progress is shared with shutdown, closing
  the timeout-versus-reload race.
- Poller startup is idempotent and owns a tracked interval handle, so repeated
  startup calls cannot stack monitor loops.

No dashboard, `/api/state`, `/api/hosts`, or SwiftBar presentation contract was
changed. Once the producer captures a fresh reading, both surfaces continue to
receive the same current percentages through their existing shared path.

## How to test

1. Run the focused monitoring tests:

   ```sh
   node --test tests/claude-refresh-gates.test.js tests/claude-refresh-parse.test.js tests/claude-monitor-lifecycle.test.js tests/autorefresh-guard.test.js tests/server.test.js
   ```

2. Run the full suite:

   ```sh
   npm test
   ```

   Engineer result: 564 tests, 562 passed, 0 failed, 2 environment-dependent
   skips.

3. Follow `pipeline/claude-live-limit-monitoring/how-to-see.md` for the
   plain-English local and post-deploy checks.

## Notes for reviewer

- The cleanup boundary is deliberately structural: initial ownership requires
  probe-root ancestry or the exact generated scratch marker for this data
  directory. Every later signal requires that the current PID still has the
  captured kernel birth time, PGID, and session. PPID may change so a legitimately
  reparented owned child can still be cleaned up; PID/PGID replacements fail
  closed. Command-name matching alone never authorizes a kill.
- The normal five-minute spacing floor still applies to activity-driven recovery,
  so a transcript that writes continuously cannot create a probe storm.
- Unchanged activity keeps the established 5→10→20→40→60 minute backoff. A
  successful retry resets the failure state as before.
- Production service restart and live provider capture are intentionally left to
  the deploy/test stages; this engineering stage did not reload LaunchAgent,
  kill the currently installed service, or alter its reading file.
