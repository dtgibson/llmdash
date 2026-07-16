# Fix: Claude live limit monitoring

## What this does

This fixes the shared Claude limit producer behind both the dashboard and the
SwiftBar dropdown. The two surfaces already agreed because they consume the same
API state; the bad `weekly 0% remaining` value came from a stale
`claude-ratelimits.json` that the `/usage` probe was no longer refreshing
reliably. Deployment exposed a second part of the failure: the activity gate
looked only at direct project transcripts while the active Claude subagent was
writing at nested workflow depth six, so the monitor returned `idle` after a
timeout even though the CLI remained active.

The fix makes that producer recover and shut down cleanly:

- A timed-out probe still keeps the last-known-good limit reading, but newly
  advancing Claude transcript activity can trigger a bounded retry at the normal
  five-minute cadence instead of being hidden behind an hour-long failure
  backoff. When activity has not advanced, the existing exponential backoff
  remains in place.
- Transcript activity discovery now covers direct transcripts and the current
  nested subagent workflow layout. It is a metadata-only, symlink-skipping walk
  with hard ceilings of depth 6, 512 directories, 10,000 candidate JSONL files,
  and 20,000 streamed entries. Unreadable or racing entries are isolated rather
  than failing the entire activity check.
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
   node --test tests/claude-activity-scan.test.js tests/claude-refresh-gates.test.js tests/claude-refresh-parse.test.js tests/claude-monitor-lifecycle.test.js tests/autorefresh-guard.test.js tests/server.test.js
   ```

2. Run the full suite:

   ```sh
   LLMDASH_CLAUDE_AUTOREFRESH=0 \
   LLMDASH_CLAUDE_DIR=/tmp/llmdash-full-suite-no-claude \
   LLMDASH_CODEX_DIR=/tmp/llmdash-full-suite-no-codex \
   LLMDASH_CODEX_CMD=/usr/bin/false \
   npm test
   ```

   Engineer result: 570 tests, 568 passed, 0 failed, 2 environment-dependent
   skips. Provider inputs were isolated and Claude auto-refresh was disabled for
   this run so the active user CLI could not be probed; the focused suites above
   exercise the refresh gates explicitly.

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
- Transcript contents are never opened. The activity walk uses `lstat` and
  streamed directory metadata, does not follow file or directory symlinks, and
  stops at its fixed work budgets.
- Unchanged activity keeps the established 5→10→20→40→60 minute backoff. A
  successful retry resets the failure state as before.
- The deployment report that revealed the nested-layout issue is retained as
  evidence. This remediation did not reload LaunchAgent, kill the installed
  service or active Claude CLI, or alter the production reading file.
