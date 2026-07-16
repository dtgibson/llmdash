# Security Review — Claude live limit monitoring

**Date:** 2026-07-16  
**Feature:** `claude-live-limit-monitoring`  
**Stack:** Frontend `vanilla (HTML/CSS/JS)`; backend `node http`  
**Checklist:** Generic OWASP Top 10, filesystem trust-boundary review, and local-process-control review (no dedicated served checklist exists for either configured stack value)  
**Outcome:** **PASSED WITH NOTES**  
**Deployment status:** **No security blocker.** No Critical, High, or Medium finding remains open. The prior deployment's functional freshness failure remains subject to the unchanged deployment report and post-redeploy validation.

---

## Summary

The nested activity scanner is metadata-only and has effective hard ceilings: depth 6, 512 directory attempts, 10,000 candidate JSONL `lstat` calls, and 20,000 streamed directory entries. Static file and directory symlinks are skipped, unreadable/racing entries fail locally, transcript contents are never opened, and test-only overrides cannot expand production work.

One filesystem limitation must be stated honestly: the directory is checked with `lstatSync(path)` and then opened separately with `opendirSync(path)`. A same-user process can swap that pathname to a symlink between the two calls, causing the scanner to enumerate an external directory and observe external `.jsonl` metadata. A scratch-only deterministic probe reproduced this. It does not read transcript contents, disclose names or paths, or cross the service user's existing filesystem authority, so it is Informational—not a deployment blocker in this local single-user model—but the absolute “never follows symlinks” claim does not hold under an adversarial swap.

The previously resolved PID/PGID High remains resolved. Full identity revalidation is still performed immediately before each positive-PID signal, deterministic reuse cases remain green, and no negative process-group signal path has returned.

---

## Findings

### 1. PID/PGID reuse could redirect teardown signals to an unrelated process

**Severity:** High  
**Location:** `src/claude-refresh.js:258–378`; `tests/claude-monitor-lifecycle.test.js:31–119`  
**Description:** The pre-remediation implementation stored bare PIDs, sent negative `-rootPid` signals, and used PID existence as its post-TERM check. A reused PID or PGID could therefore redirect a later signal to an unrelated same-user process, including an independent Claude CLI.  
**Remediation:** The process table records PID, PPID, PGID, session, and kernel-reported `lstart`. Initial ancestry capture stores the complete identity; PPID may change after reparenting, but every TERM and KILL requires a fresh match on PID, `lstart`, PGID, and session. Missing, unreadable, or changed identity fails closed. All negative-PGID signaling was removed. Deterministic descendant-PID, root-PID, and PGID reuse tests prove replacements receive no signal while still-owned reparented descendants remain eligible for KILL.  
**Status:** **Resolved** — rechecked after the activity-scanner change; the process-control code and source guard remain intact.

### 2. Process identity cannot be made fully atomic with macOS `ps` plus Node signals

**Severity:** Informational  
**Location:** `src/claude-refresh.js:258–285`, `src/claude-refresh.js:304–311`, `src/claude-refresh.js:339–350`  
**Description:** macOS `ps lstart` is displayed at one-second precision, and there is necessarily a small interval between the targeted `ps` result and the following `process.kill()` syscall. A theoretical false match requires PID-space reuse plus the same PID, PGID, session, and displayed birth second inside that adjacent interval.  
**Remediation:** Birth time is corroborated with PGID and session, revalidation occurs directly before every signal, process groups are never signaled, and ambiguity fails closed. A platform-specific atomic process handle would be stronger if Node/macOS exposes one in the future.  
**Status:** Accepted — not a deployment blocker under the local same-user macOS threat model.

### 3. Fail-closed process-table outages can leave an owned probe for later cleanup

**Severity:** Informational  
**Location:** `src/claude-refresh.js:278–298`, `src/claude-refresh.js:353–378`, `src/claude-refresh.js:391–410`, `src/claude-refresh.js:457–483`  
**Description:** If `ps` cannot capture or revalidate an identity, teardown intentionally sends no signal. This prevents unsafe guessing but can leave an owned probe until its bounded runner exits or a later service generation recognizes the exact scratch marker. Startup cleanup also latches after its first process-table attempt.  
**Remediation:** A future hardening pass may add a bounded cleanup retry and local diagnostic without weakening fail-closed signaling.  
**Status:** Accepted — availability/process-hygiene residual only.

### 4. Poller stop does not quiesce a startup preparation already in progress

**Severity:** Informational  
**Location:** `src/poller.js:153–182`; `src/server.js:289–300`; `tests/claude-monitor-lifecycle.test.js:145–177`  
**Description:** `stopPoller()` clears the interval and awaits an already-registered active Claude probe, but it does not track the promise chain currently running `prepare().then(poll)`. A shutdown during the first asynchronous stale-process scan can let that chain continue after `stopPoller()` returns.  
**Remediation:** Track a stopping generation/current run promise, prevent `poll` from starting after stop, and add a delayed-prepare interleaving test.  
**Status:** Open — non-blocking local shutdown-hygiene note; active-probe teardown remains serialized and awaited.

### 5. Directory swap can bypass the scanner's static symlink check

**Severity:** Informational  
**Location:** `src/claude-refresh.js:190–219`; `tests/claude-activity-scan.test.js:161–177`  
**Description:** The scanner proves `current.dir` is a real directory with `lstatSync`, then opens the pathname in a separate `opendirSync` call. If a same-user process renames that directory and replaces the path with a symlink in between, `opendirSync` follows the new target. Subsequent `lstatSync(full)` calls also resolve the swapped intermediate component, so a regular external `.jsonl` file's mtime can become the activity signal. The existing test covers static symlinks, not this check-to-open swap. A scratch-only deterministic probe swapped the path inside the injected `opendirSync` seam and returned the external file's exact mtime.

No transcript or external-file contents are read: the scanner performs directory-entry reads and `lstat` only. The observed metadata is reduced to one timestamp, never logged or returned by an HTTP endpoint, and at worst opens a bounded `/usage` retry. Exploitation requires write authority over the same user's Claude projects tree; that actor can already create a fresh local `.jsonl` and trigger the same bounded retry. The security impact is therefore limited, but the absolute symlink-safety claim is inaccurate under an adversarial race.  
**Remediation:** If a race-free guarantee is required, traverse from directory descriptors with a platform primitive equivalent to `openat(..., O_NOFOLLOW)` and perform child metadata lookups relative to the held descriptor. Otherwise add the deterministic swap test and narrow documentation to “static symlinks are skipped; same-user path replacement is outside the trust boundary.” Canonical-path checks alone reduce accidental escapes but do not close the final check-to-open race.  
**Status:** Open — non-blocking under the documented local single-user/config-owner trust model.

### 6. Fixed scanner budgets bound work but can still cause synchronous latency or scan starvation

**Severity:** Informational  
**Location:** `src/claude-refresh.js:152–170`, `src/claude-refresh.js:178–225`  
**Description:** The ceilings are real and finite, but the scan uses synchronous directory and metadata calls in the same Node process that serves HTTP. A worst-case stale-reading tick can perform 20,000 streamed entry reads and 10,000 candidate file `lstat`s. There is no wall-clock budget, and depth-first/global budgeting means an early huge subtree can consume the limits before a later active project is visited, producing either temporary HTTP latency or a false `idle` result. This cannot be driven by an HTTP client; it requires a very large operator/provider-controlled Claude tree.
**Remediation:** If real-world telemetry approaches the ceilings, prefer known current layouts, newest project/session directories, per-directory quotas, or an asynchronous/time-sliced walk. Surface budget exhaustion diagnostically rather than making it indistinguishable from “no activity.”  
**Status:** Accepted — bounded local availability tradeoff, not a security deployment blocker.

---

## Scanner Checks Performed

| Check | Result |
|---|---|
| Transcript contents | Pass — scanner contains no `readFile`, stream-open, or content parse; only directory entries and `lstat` metadata are used |
| Data emitted | Pass — filenames and paths stay local; only the maximum finite `mtimeMs` is returned to the activity gate |
| Static projects-root symlink | Pass — root `lstat` rejects a symlink before enumeration |
| Static nested directory symlink | Pass — `Dirent.isSymbolicLink()` skips it; dedicated scratch test remains green |
| Static `.jsonl` file symlink | Pass — dirent and leaf `lstat` checks skip it; dedicated scratch test remains green |
| Leaf file replacement before `lstat` | Pass/fail-closed — a replacement symlink is rejected by leaf `lstat`; missing/unreadable files are skipped |
| Directory replacement between `lstat` and `opendir` | Finding — external metadata can be observed; see Finding 5 |
| Intermediate-parent replacement before leaf `lstat` | Finding — leaf pathname can resolve through the swapped parent; covered by Finding 5 |
| Path construction | Pass — names come from filesystem directory entries; `path.join` adds one child component and no user/request string is appended |
| Depth semantics | Pass — projects root is depth 0; the current `<project>/<session>/subagents/workflows/<workflow>/*.jsonl` file is depth 6; depth 7 is excluded |
| Directory budget | Pass — at most 512 directory attempts, including missing, unreadable, or rejected entries |
| Candidate-file budget | Pass — at most 10,000 `.jsonl` leaf metadata attempts |
| Streamed-entry budget | Pass — at most 20,000 returned directory entries across the scan |
| Pending-queue memory | Pass — queued directories are derived only from already-budgeted entries, bounding queue growth by the 20,000-entry ceiling |
| Test override expansion | Pass — overrides are floored at zero and capped at immutable production ceilings |
| Huge-directory event-loop impact | Informational bounded residual — Finding 6 |
| Budget exhaustion semantics | Informational bounded residual — can return a partial maximum/false idle; Finding 6 |
| Unreadable directories | Pass — `lstat`/`opendir` failures skip that directory and continue |
| Racing/deleted entries | Pass — `readSync`/leaf `lstat` failures are isolated; handles close in `finally` |
| Non-file `.jsonl` entries | Pass — only dirent-file plus leaf-`lstat` regular files count as activity |
| Non-finite mtimes | Pass — ignored |
| Config root trust | Accepted — `LLMDASH_CLAUDE_DIR` is local operator/LaunchAgent configuration, never request-derived; deliberately pointing it elsewhere deliberately changes the scan boundary |
| Arbitrary external metadata without config change | Static symlinks: No. Adversarial same-user directory swap: Yes, metadata only — Finding 5 |
| Activity-to-probe amplification | Pass — scanner result still passes through single-flight and the normal five-minute cadence floor |
| Request-path exposure | Pass with latency note — scanner is invoked by the poller only, though synchronous filesystem work shares the server event loop |

---

## Other Security Checks

| Check | Result |
|---|---|
| Process identity fields and per-signal revalidation | Pass — prior High remains Resolved |
| Negative PID/PGID signaling | Pass — behavioral and source tests remain green |
| Independent Claude CLI exclusion | Pass in normal and deterministic reuse scenarios |
| Exact startup probe marker and scratch basename | Pass for the local trust model; last-known-good filename remains unselectable |
| Probe command construction | Pass — fixed runner; dynamic values enter as positional argv |
| Probe environment | Pass — explicit allowlist; provider/LLMDASH secrets are not inherited |
| Last-known-good reading on failure | Pass based on QA evidence |
| HTTP/OWASP access-control surface | Pass — no new endpoint or mutation method |
| Injection | Pass — no request data reaches traversal or subprocess construction |
| Secrets / sensitive output | Pass — no transcript contents, credentials, paths, or filenames are added to APIs/logs |
| Dependencies | Pass — no new runtime dependency |
| Focused provider-isolated tests | Pass — activity scan plus lifecycle: 16 passed, 0 failed |
| Scratch TOCTOU probe | Reproduced Finding 5 without touching provider data, services, readings, or processes |
| Full regression evidence | Pass based on updated QA report: 568 passed, 0 failed, 2 environment-dependent skips |

---

## Convention Flags

- Destructive local process control must bind signals to a freshly revalidated process identity, not a numeric PID or PGID alone. Capture ancestry while intact, retain birth/group/session identity across reparenting, fail closed on ambiguity, and never use negative-PGID signaling when group membership cannot be atomically proven.
- A pathname `lstat` followed by a separate pathname `open` is not a race-free symlink guarantee. When same-user path replacement is in scope, use descriptor-relative no-follow traversal or state the narrower static-symlink boundary explicitly.
