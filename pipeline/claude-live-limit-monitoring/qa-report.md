# QA Report — Claude live limit monitoring

**Date:** 2026-07-16
**Test Runner:** Node 24 `node:test` plus controlled process/server harnesses
**Result:** PASSED
**Needs-fix flags:** None

This report includes the post-audit remediation rerun for the High PID/PGID
reuse finding in `security-report.md` and the deployment-discovered nested
transcript activity remediation.

## Deployment-discovered activity remediation

The first deployment proved that lifecycle cleanup and single-monitor startup
worked, but both live `/usage` probes timed out and the reading remained stale.
Metadata-only inspection then showed the active Claude work advancing at
`<project>/<session>/subagents/workflows/<workflow>/*.jsonl` (file depth 6),
while the direct project transcript had aged. The direct-only activity scanner
therefore returned `idle` and could not open the intended normal-cadence retry.

The remediated scanner searches the direct and current nested layouts using
`lstat` and streamed directory entries only. It never reads transcript contents
or follows file/directory symlinks. Fixed ceilings bound each scan to depth 6,
512 directory attempts, 10,000 candidate JSONL metadata reads, and 20,000
directory entries. Missing, unreadable, or racing entries do not suppress a
valid transcript found elsewhere.

The deployment report is retained unchanged as the evidence for this discovery.
This remediation did not reload the service, signal a live Claude process,
change the production reading, or clean existing orphans.

## Test results

Every suite in this rerun used `LLMDASH_CLAUDE_AUTOREFRESH=0`, nonexistent
Claude/Codex roots, and `/usr/bin/false` provider commands. The focused commands
below omit that repeated environment prefix for readability; their tests use
scratch filesystem fixtures and injected attempts where enabled behavior is
required.

Focused refresh, lifecycle, state, and SwiftBar regression suite:

```sh
node --test tests/claude-refresh-gates.test.js \
  tests/claude-monitor-lifecycle.test.js \
  tests/claude-freshness.test.js \
  tests/state-diagnostics.test.js \
  tests/menubar.test.js \
  tests/menubar-multihost.test.js \
  tests/menubar-degradation.test.js
```

104 passing, 0 failing.

Focused nested activity and lifecycle remediation suite:

```sh
node --test tests/claude-activity-scan.test.js \
  tests/claude-refresh-gates.test.js \
  tests/claude-monitor-lifecycle.test.js
```

32 passing, 0 failing.

Focused API/dashboard/SwiftBar contract suite:

```sh
node --test tests/state-unchanged.test.js \
  tests/host-cache.test.js \
  tests/menubar-config.test.js \
  tests/menubar-parity.test.js \
  tests/dashboard-render.test.js
```

16 passing, 0 failing.

Full suite:

```sh
LLMDASH_CLAUDE_AUTOREFRESH=0 \
LLMDASH_CLAUDE_DIR=/tmp/llmdash-qa-no-claude-20260716 \
LLMDASH_CODEX_DIR=/tmp/llmdash-qa-no-codex-20260716 \
LLMDASH_CLAUDE_CMD=/usr/bin/false \
LLMDASH_CODEX_CMD=/usr/bin/false \
npm test
```

570 tests total: 568 passing, 0 failing, 2 skipped. The provider isolation keeps
the general poller regression from inspecting local provider stores or starting
a real probe while the user's Claude CLI is active. Focused gate and lifecycle
tests use explicit injected configurations and attempts.

Independent continuous-write cadence harness:

- A stale direct transcript and a depth-6 nested workflow transcript were placed
  in a scratch provider tree.
- The nested mtime advanced on every simulated minute for 11 minutes.
- Every injected probe attempt timed out.
- Attempts occurred only at minutes 0, 5, and 10; all intervening ticks returned
  `waiting`. The nested activity therefore opens one normal-cadence retry, never
  a per-write probe storm.

Whitespace check:

```sh
git diff --check
```

Passed.

## High-finding remediation verification

The deployment-blocking PID/PGID reuse finding is addressed in the remediated
implementation and its deterministic tests:

| Required remediation | Result | Evidence |
|---|---|---|
| Capture stable process identity fields from real macOS process data. | Pass | A targeted read using the production `/bin/ps -p <pid> -o pid=,ppid=,pgid=,sess=,lstart=,command=` shape parsed a real QA process into PID, PPID, PGID, session, and kernel-reported `lstart`. A separate controlled tree captured three real macOS rows through the same parser. |
| Revalidate identity immediately before every TERM and KILL. | Pass | The deterministic five-process tree requires exactly 10 fresh identity reads: one immediately before each of five TERM and five KILL operations. Signals are sent only after PID, `lstart`, PGID, and session all match. |
| Fail closed when identity is absent or changed. | Pass | Root and descendant replacement scenarios change the birth/group identity during the grace interval. The replacement receives no KILL. A missing or mismatched targeted `ps` row produces no signal. |
| Remove unsafe negative-PGID signaling. | Pass | Teardown sends only positive captured PIDs. Both behavioral assertions and a source guard find no negative PID/PGID signal path. |
| Never signal a descendant PID replacement. | Pass | A descendant is replaced during the TERM-to-KILL grace interval with the same PID but a new `lstart`, PGID, and session; the replacement receives no signal. |
| Never signal a root PID replacement. | Pass | A root replacement with the same numeric PID but a new birth identity receives no KILL, while surviving originally captured descendants remain independently eligible for identity-checked cleanup. |
| Never signal a PGID reuse replacement. | Pass | A new unrelated process is introduced with the former root's numeric PGID. It receives no signal because teardown does not use group signaling or authorize uncaptured members. |
| Keep an independent Claude CLI unreachable. | Pass | The modeled independent Claude PID is excluded from every signal list across normal, root-reuse, descendant-reuse, and PGID-reuse cases. A real unrelated controlled process also survived teardown. The user's actual live Claude CLI was not read or signaled. |
| KILL a still-owned TERM-resistant descendant after it reparents. | Pass | PPID is used only for initial ancestry capture, not stable identity comparison. Both the deterministic reparenting case and a real macOS controlled process tree proved that the reparented resistant child retained its birth/group/session identity and received SIGKILL. |

The real controlled-process run produced this outcome: the owned root terminated,
the TERM/SIGHUP-resistant child reparented and was then killed, the unrelated
controlled process survived, and zero negative-PGID signals were emitted.

## Bug reproduction and recovery

The failure described in `bug-brief.md` was reproduced with controlled data: an
old Claude reading at 100% used / 0% remaining was retained through a simulated
probe timeout. A later transcript-activity advance opened one bounded retry at
the normal five-minute cadence, and a successful retry replaced the old reading
with a new 6% used / 94% remaining capture.

No production data or processes were used. The user's live Claude CLI, installed
service, production `claude-ratelimits.json`, and existing orphan processes were
not read, signaled, changed, or removed by QA.

## Acceptance criteria

| Criterion | Result | Evidence |
|---|---|---|
| An active Claude session can recover monitoring within the normal refresh interval after a timeout. | Pass | `advancing depth-6 subagent activity recovers after timeout without duplicate probes` uses the real bounded scanner, advances a nested workflow transcript after a timeout, opens one retry at five minutes, succeeds, and keeps the following tick waiting. Existing unchanged-activity tests separately preserve exponential backoff. |
| Activity discovery is bounded, metadata-only, and symlink-safe. | Pass | Dedicated tests cover the current depth-6 layout, exclude depth 7, exercise directory/file/streamed-entry budgets, skip external file and directory symlinks, tolerate unreadable/racing paths, and confirm stale direct plus nested activity spawns nothing. |
| A timed-out probe preserves the last-known-good reading. | Pass | `a timed-out refresh preserves last-known-good, then a later active retry replaces it` verifies the old file byte-for-byte after failure and confirms only the successful later capture advances it. Startup scratch cleanup also leaves `claude-ratelimits.json` unchanged. |
| A fresh capture reaches `/api/state` and `/api/hosts` with internally consistent weekly percentages. | Pass | A live scratch server served a synthetic fresh reading as `usedPct: 6`, `remainingPct: 94`, with identical `capturedAt` through both endpoints. Existing host-cache and state-contract suites remain green. |
| Dashboard and SwiftBar keep consuming the same current shared state without contract changes. | Pass | The scratch server returned 200 for `/` and `/app.js`; the real SwiftBar script fetched `/api/hosts` and rendered `94% remaining — Claude Code · Weekly` plus the matching `Weekly: 94%` row. `public/*` and the SwiftBar implementation are unchanged. Dashboard/SwiftBar parity tests pass. |
| Timeout, reload, and exit terminate the complete ancestry-owned probe tree with TERM then KILL escalation. | Pass | Lifecycle tests require freshly revalidated TERM and KILL for the root and every still-matching descendant, including the modeled pty-separated Claude branch. A real controlled root and reparented resistant child were also terminated successfully. |
| Cleanup cannot reach an unrelated live Claude CLI. | Pass | Synthetic PID/PGID reuse tests and a real controlled-process test prove the unrelated process is excluded from the signal set and remains alive after owned-tree teardown. Ownership is derived from captured ancestry plus birth/group/session identity, never a broad `claude` command-name match. |
| Startup cleans only exact generated probe-marker orphans and scratch captures. | Pass | Exact `claude-usage-probe-<pid>-<time>.typescript` markers are recognized; a `.typescript.bak` near-match is excluded. The owned root is selected, its nested owned process is not double-selected, scratch is deleted, and the last-good reading is preserved. |
| Poller startup is idempotent and maintains one interval. | Pass | Two same-process `startPoller()` calls return the same stop function, schedule one interval, perform one immediate poll, and clear the interval once. Existing single-flight behavior remains green. |
| SIGTERM and SIGINT shut down gracefully. | Pass | Controlled isolated server processes were started for each signal. Both reached listen state, received the signal, awaited monitor shutdown, and exited with code 0. Static ordering also confirms `stopPoller()` is awaited before `server.close()`. |
| `/api/state`, `/api/hosts`, dashboard, and SwiftBar response/render contracts remain unchanged. | Pass | Exact `/api/state` top-level/tool/window key-set guards pass; `/api/hosts` cache tests pass; dashboard assets and SwiftBar source have no implementation diff; focused presentation and parity suites pass; full regression suite passes. |
| No repeated orphan accumulation or stale-reading regression in production. | Deferred to deployment | The implementation and controlled lifecycle tests pass. Live validation is intentionally deferred because QA was explicitly barred from reloading the installed service, signaling existing orphans, modifying the production reading, or interfering with the user's active Claude CLI. Deployment should verify this criterion after the approved reload. |

## Edge cases verified

- Fresh readings still suppress probes, and idle Claude activity still performs no
  refresh work.
- Current depth-6 subagent workflow transcripts count as activity; depth-7 files
  are outside the explicit discovery boundary.
- Directory, JSONL-stat, and streamed-entry budgets stop work at fixed ceilings.
- File and directory symlinks are skipped, transcript contents are never opened,
  and unreadable/racing entries are isolated.
- Continuously advancing activity cannot bypass the normal cadence floor.
- Eleven consecutive minute-by-minute nested writes produced attempts only at
  minutes 0, 5, and 10 when every attempt timed out.
- Unchanged activity follows the existing 5/10/20/40/60-minute capped backoff.
- Sleep-spanning time gaps yield at most one attempt on the first wake tick.
- A refresh cancelled during service shutdown is not recorded as another failure.
- Concurrent refresh triggers remain single-flight.
- Exact process ancestry includes deep helper descendants and the pty child branch,
  while an independent process named `claude` remains structurally unreachable.
- Stable identity comparison tolerates PPID changes caused by reparenting but
  rejects changed birth time, PGID, or session values.
- Every TERM and KILL performs a fresh targeted identity read; an unreadable,
  absent, or mismatched row fails closed without signaling.
- Root PID, descendant PID, and numeric PGID reuse replacements receive no signal.
- TERM/SIGHUP-resistant owned descendants receive KILL escalation after
  reparenting; unrelated controlled processes survive.
- No negative process-group signal remains in the teardown path.
- Startup cleanup selects the top owned marker root once, not every marked child.
- Marker-shaped filename near-matches are not treated as owned probes.
- Probe scratch deletion cannot delete the differently named last-good reading.
- Repeated poller starts do not stack intervals; stop is safe after the single start.
- Both direct-execution signals are registered once and take the same shutdown path.
- Fresh weekly values stay `usedPct + remainingPct = 100` through both API surfaces
  and through the SwiftBar consumer.
- Dashboard and SwiftBar freshness, diagnostic, no-reading, stale, and maxed-state
  behavior remain covered by the full passing regression suite.

## Deployment validation checklist

After the approved service reload, verify without terminating the user's normal
Claude session:

1. The current active transcript causes `claude-ratelimits.json` to advance within
   the normal refresh interval.
2. `/api/state` and `/api/hosts` report the same new Claude weekly capture.
3. Dashboard and SwiftBar show the matching current weekly remaining value.
4. No new `claude-usage-probe-*.typescript` process tree remains after a completed
   probe, timeout, reload, or stop.
5. A second reload does not create a second poll interval or accumulate another
   orphan tree.

## Remaining limitations

- PID and PGID reuse are validated deterministically with injected process-table
  transitions. QA did not try to force real kernel PID reuse, which would require
  unsafe process churn. The real-process harness instead validates the production
  macOS `ps` shape, reparenting, TERM resistance, KILL escalation, and unrelated
  process isolation.
- macOS `ps lstart` exposes birth time at one-second display precision. The
  implementation corroborates it with PID, PGID, and session and fails closed on
  any mismatch; Node does not expose a portable stable process handle.
- If `ps` cannot capture or later re-prove an identity, teardown intentionally
  sends no signal. This preserves the safety boundary but can leave a probe for
  startup cleanup or deployment diagnostics to handle later.
- Production orphan accumulation and live freshness remain deferred to the
  deployment checklist because this rerun did not touch the installed service,
  production reading, existing orphan trees, or the user's active Claude CLI.
- The nested-activity remediation is proven in provider-isolated fixtures but has
  not yet been redeployed after the rollback recorded in `deployment-report.md`.
