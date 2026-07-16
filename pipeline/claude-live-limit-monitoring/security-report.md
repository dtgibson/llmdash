# Security Review — Claude live limit monitoring

**Date:** 2026-07-16
**Feature:** `claude-live-limit-monitoring`
**Stack:** Frontend `vanilla (HTML/CSS/JS)`; backend `node http`
**Checklist:** Generic OWASP Top 10, trust-boundary review, and local-process-control review (no dedicated served checklist exists for either configured stack value)
**Outcome:** **PASSED WITH NOTES**
**Deployment status:** **Security blocker cleared.** No Critical, High, or Medium findings remain open.

---

## Summary

The deployment-blocking PID/PGID reuse finding is resolved. Teardown now captures full process identities while ancestry is intact, removes negative process-group signaling, and performs a fresh fail-closed identity check immediately before every individual TERM and KILL. Deterministic root, descendant, and PGID reuse cases pass, as does the independent-Claude exclusion case.

The remaining notes are local single-user residuals, not deployment blockers: macOS exposes `lstart` at one-second precision and Node has no atomic process handle; failing closed on an unavailable `ps` can leave an owned probe for later cleanup; and `stopPoller()` does not quiesce a startup cleanup already in progress. None permits a normal independent Claude CLI to be selected by command-name matching or by a reused numeric PID in the tested lifecycle.

---

## Findings

### 1. PID/PGID reuse could redirect teardown signals to an unrelated process

**Severity:** High
**Location:** `src/claude-refresh.js:198–318`; `tests/claude-monitor-lifecycle.test.js:31–119`
**Description:** The pre-remediation implementation stored bare PIDs, sent negative `-rootPid` signals, and used PID existence as its post-TERM check. A reused PID or PGID could therefore redirect a later signal to an unrelated same-user process, including an independent Claude CLI.
**Remediation:** The process table now records PID, PPID, PGID, session, and kernel-reported `lstart`. Initial ancestry capture stores the complete identity; subsequent PPID changes are allowed so a TERM-resistant child remains identifiable after reparenting. Every TERM and KILL performs a fresh targeted `ps` read and requires PID, `lstart`, PGID, and session to match. Missing, unreadable, or changed identity fails closed. All negative-PGID signaling was removed. Deterministic tests replace a descendant PID, root PID, and numeric PGID during the grace period and prove replacements receive no signal while still-owned reparented descendants remain eligible for KILL.
**Status:** **Resolved**

### 2. Process identity cannot be made fully atomic with macOS `ps` plus Node signals

**Severity:** Informational
**Location:** `src/claude-refresh.js:198–225`, `src/claude-refresh.js:244–251`, `src/claude-refresh.js:279–290`
**Description:** macOS `ps lstart` is displayed at one-second precision, and there is necessarily a small interval between the targeted `ps` result and the following `process.kill()` syscall. A theoretical false match would require the captured process to exit, the kernel PID space to wrap, and a replacement to acquire the same PID, PGID, session, and displayed birth second inside that adjacent interval. `sameProcessIdentity()` would accept that tuple because Node does not expose a portable pidfd-style handle.
**Remediation:** The implementation corroborates birth time with PGID and session, revalidates directly before each signal, never signals a process group, and fails closed on every ambiguity. A platform-specific atomic process handle would be stronger if Node/macOS exposes one in the future.
**Status:** Accepted — not a deployment blocker under this local, same-user macOS threat model; the required PID-space wrap and full tuple collision in the syscall-adjacent window are materially narrower than the original bare-PID design.

### 3. Fail-closed process-table outages can leave an owned probe for later cleanup

**Severity:** Informational
**Location:** `src/claude-refresh.js:218–239`, `src/claude-refresh.js:293–318`, `src/claude-refresh.js:331–350`, `src/claude-refresh.js:397–423`
**Description:** If `ps` cannot capture the spawned root identity, or cannot revalidate a captured identity at signal time, teardown intentionally sends no signal. This prevents an unsafe guess but can leave an owned probe running until its bounded runner exits or a later service generation recognizes its exact scratch marker. Startup cleanup also latches after its first process-table attempt, so a transient startup `ps` failure is not retried in that process.
**Remediation:** Safety-first behavior is correct. A future hardening pass could retain the cleanup task for a bounded retry and surface a local diagnostic when identity capture fails, without weakening fail-closed signaling.
**Status:** Accepted — availability/process-hygiene residual only; it cannot redirect a signal to an independent process.

### 4. Poller stop does not quiesce a startup preparation already in progress

**Severity:** Informational
**Location:** `src/poller.js:153–182`; `src/server.js:289–300`; `tests/claude-monitor-lifecycle.test.js:145–177`
**Description:** `stopPoller()` clears the interval and awaits an already-registered active Claude probe, but it does not track or await the promise chain currently running `prepare().then(poll)`. If shutdown lands during the first asynchronous stale-process scan, that chain can continue after `stopPoller()` returns. Normally `server.close()` or the four-second forced exit ends the process before new detached work begins, but the poller API itself is not fully quiescent and the current tests cover interval idempotence and shutdown ordering rather than this interleaving.
**Remediation:** Track a stopping generation or the current run promise; prevent `poll` from starting after stop and, on shutdown, await the preparation-to-Claude-refresh portion that can create detached work. Add a delayed-prepare test that stops before release and asserts `poll` never begins afterward.
**Status:** Open — non-blocking local shutdown-hygiene note; the active-probe teardown path itself remains serialized and awaited.

---

## Checks Performed

| Check | Result |
|---|---|
| Stack checklist mapping | Pass — no dedicated `vanilla` or `node http` checklist; generic OWASP/trust-boundary/process-control review used |
| Process-table parser captures PID, PPID, PGID, session, and 24-character kernel `lstart` | Pass |
| Root identity is captured only after the child emits `spawn`; no fabricated PID-only identity | Pass with fail-closed note — Finding 3 |
| Initial descendant ownership is established by PPID ancestry from the captured root | Pass |
| Captured descendant identity survives legitimate reparenting because PPID is not treated as immutable | Pass |
| PID, birth time, PGID, and session are freshly revalidated immediately before every TERM | Pass |
| PID, birth time, PGID, and session are freshly revalidated immediately before every KILL | Pass |
| Missing row, changed identity, or `ps` failure sends no signal | Pass |
| Negative PID/PGID signaling is absent in behavior and source guard | Pass |
| Descendant PID reuse during the grace interval | Pass — replacement receives no KILL; owned reparented child does |
| Root PID reuse during the grace interval | Pass — replacement receives no KILL; captured descendants remain independently checked |
| Numeric PGID reuse during the grace interval | Pass — no group signal exists and the unrelated group owner is untouched |
| Independent Claude CLI in normal and reuse scenarios | Pass — excluded from every signal list |
| One-second `lstart` precision and revalidation-to-signal gap | Informational residual — Finding 2 |
| Exact startup marker | Pass for this threat model — escaped configured path, exact `claude-usage-probe-<pid>-<time>.typescript` token, and near-match exclusion |
| Marker authorization limit | Accepted — the marker is a local syntactic ownership token, not an unforgeable capability; an operator-owned process deliberately carrying the exact token is in the same-user trust domain |
| Scratch deletion basename | Pass — exact generated basename only; `claude-ratelimits.json` is not selectable |
| Path/symlink boundary | Pass for configured local storage; leaf unlink removes the named entry, while replacing the configured data-directory symlink requires same-user filesystem authority |
| Startup cleanup process-table outage | Safe but may defer cleanup — Finding 3 |
| Shared timeout/cancel teardown promise | Pass — concurrent completion and shutdown await the same teardown |
| SIGTERM/SIGINT ordering | Pass — monitor stop is awaited before server close |
| Poller stop during pending startup preparation | Informational open note — Finding 4 |
| Probe command construction | Pass — fixed runner; dynamic values enter as positional argv, not interpolated shell source |
| Probe environment | Pass — explicit allowlist; no inherited `CLAUDECODE*`, `ANTHROPIC_*`, or `LLMDASH_*` values |
| Transcript trust boundary | Pass — activity scan uses metadata only and never reads transcript contents |
| Last-known-good reading on failure | Pass based on QA evidence; scratch cleanup cannot select the reading filename |
| Recovery attempt denial-of-service bound | Pass — single flight and normal five-minute cadence floor prevent probe storms |
| HTTP attack surface / OWASP access control | Pass — no new endpoint or mutation method; existing GET/HEAD-only boundary remains |
| Injection | Pass — no request data reaches process spawning or cleanup authorization |
| Secrets / sensitive data exposure | Pass — no credential or transcript payload is added to APIs or logs |
| Security headers and browser rendering | Pass — presentation contracts and first-party CSP path are unchanged |
| Dependency/vulnerability surface | Pass — zero new runtime dependencies |
| Focused re-review test | Pass — `node --test tests/claude-monitor-lifecycle.test.js`: 10 passed, 0 failed |
| Full regression evidence | Pass based on updated QA report: full suite passed; production service and live Claude process intentionally untouched |

---

## Convention Flags

- Destructive local process control must bind signals to a freshly revalidated process identity, not a numeric PID or PGID alone. Capture ancestry while intact, retain birth/group/session identity across reparenting, fail closed on ambiguity, and never use negative-PGID signaling when group membership cannot be atomically proven.
