# Security Review — claude-auto-refresh

**Date:** 2026-07-02
**Feature:** claude-auto-refresh — the [R2-scrape] mechanism: activity-gated `/usage` probe sessions that keep the Claude limit reading fresh
**Stack:** Vanilla Node (node:http, node:sqlite), zero dependencies, plain HTML/CSS/JS
**Checklist:** Project conventions (CLAUDE.md / DECISIONS.md) + the prior feature reviews as house pattern + this feature's own security requirements (NFR-06, FR-22–FR-26) — no served checklist for this stack
**Outcome:** PASSED WITH NOTES (four findings, all Informational: one resolved in-stage and re-verified, two accepted with rationale, one open with a suggested remediation — nothing blocks deployment)

---

## Summary

This feature adds the project's second subprocess site: a spawned, pty-wrapped
Claude Code session that types `/usage`, scrapes the rendered pane, and writes
the statusline reading file. The review traced the semi-untrusted pane text
end-to-end (typescript → parser → reading file → `/api/state` → DOM → SQLite)
and confirmed no scraped string ever crosses the wire or reaches a render sink —
only clamped numbers and self-generated ISO timestamps ship. The spawn honors
NFR-06 exactly: a fixed `/bin/sh` runner constant with config entering only as
quoted positional argv, an explicit env allowlist, and ancestry-gated teardown
that structurally cannot target the user's live sessions. One Informational
finding (the client's cause→sentence lookup honored inherited Object keys,
bypassing the intended fallback) was fixed in-stage with an own-key guard and
re-verified with a VM probe against the real `public/app.js`, pre- and
post-fix; the suite stands at 123/123. The remaining notes are edge-case
residuals — a theoretical pid-reuse window in teardown escalation, a possible
single orphaned probe after an ungraceful llmdash exit, and a pathological
lower bound on attempt spacing — all local-machine, single-user-posture
concerns with no trust-boundary crossing.

---

## Findings

### Client cause→sentence lookup honored inherited Object keys, bypassing the fallback

**Severity:** Informational
**Location:** `public/app.js:186` (pre-fix: `(AUTOREFRESH_CAUSE_SENTENCES[d.cause] || AUTOREFRESH_FALLBACK_SENTENCE)(remedy)`)
**Description:** The failure-cause mapping used a plain bracket lookup with an
`||` fallback. For the server's closed enum that is correct, but the lookup
also hits keys inherited from `Object.prototype`: probed in a VM against the
real `public/app.js`, `d.cause = '__proto__'` or `'hasOwnProperty'` threw a
TypeError (breaking the whole tool render), `'toString'` rendered
`[object Undefined]`, and `'constructor'` produced wrong copy — the code's own
claim ("an unmapped value falls back to the generic sentence") was false for
those values. **Not exploitable today**: `state.lastFailureCause` is only ever
assigned one of four literals in `src/claude-refresh.js`, the server is the
sole writer of `/api/state`, and no value echoed raw in any variant (never
XSS). But the enum→copy table pattern is the project's standing convention for
diagnostics, and this latent divergence would bite the first time a future
server added a cause the client didn't know.
**Remediation:** Own-key lookup:
`Object.prototype.hasOwnProperty.call(AUTOREFRESH_CAUSE_SENTENCES, d.cause)`
gates the table; anything else takes the fallback.
**Status:** Resolved — `public/app.js:186–189` now applies the own-key guard;
the pattern-locking assertion updated (`tests/app-copy.test.js:78–83`) to lock
the safer form and reject the old one. Re-verified with the VM probe: all
hostile/unmapped causes (`__proto__`, `constructor`, `toString`,
`hasOwnProperty`, `<img src=x onerror=alert(1)>`, `null`, `undefined`) now
render the fixed fallback sentence with no raw echo and no object leak, while
the mapped `spawn-error` keeps its own sentence. Suite green: 123/123.

### Teardown's direct-pid escalation has a theoretical pid-reuse window

**Severity:** Informational
**Location:** `src/claude-refresh.js:206–214` (`teardown`), `:181–201` (`findClaudePid`), `:268–269` (pid recorded at +2 s/+6 s)
**Description:** The probe's claude pid is recorded from a `ps` snapshot,
matched **only** if its ppid-ancestry chain reaches our own spawn — the user's
live sessions are structurally unmatchable at record time, and `kill(-1)`/
`kill(0)` are unreachable (the group kill targets `-child.pid`, a detached
group leader whose pid is always > 0; an undefined pid becomes `NaN` and
throws inside the try/catch). The residual: the pid is recorded seconds into
the attempt but the direct TERM→KILL escalation can fire up to the timeout
(≤ 5 min at the ceiling) later, guarded only by `alive()` — an existence
check, not an identity check. If the probe's claude died on its own and macOS
wrapped the entire pid space within that window, the signal could land on an
unrelated process owned by the same user.
**Remediation:** None practical — after the group kill, the genuine orphaned
claude is reparented to launchd, so ancestry can't be re-verified without
breaking the legitimate escalation path; a command-string re-check would add a
subprocess to teardown for a vanishing risk.
**Status:** Accepted — the window requires full pid-space wraparound inside
one probe lifetime on a single-user machine, the group kill normally handles
the tree first (QA observed zero leftovers on both success and timeout paths),
and any misfire is confined to the machine owner's own processes.

### An ungraceful llmdash exit mid-probe can orphan one probe session

**Severity:** Informational
**Location:** `src/claude-refresh.js:234–239` (detached spawn), `:158` (the 300 s pipeline dwell); no SIGTERM/exit teardown hook exists in `src/server.js`
**Description:** The probe group is deliberately `detached` (its own pgid for
the one-shot group kill), so it survives its parent. If llmdash is SIGKILLed —
or SIGTERMed, since no signal handler runs teardown — during the ≤ 30 s
(default) probe window, the in-flight attempt's `finish()` never runs: the sh
pipeline self-terminates at ~307 s, but the claude TUI on the pty is not
guaranteed to exit on the pipe EOF and may linger (idle, no plan usage, no
transcript), and the typescript file in `dataDir` is left behind. Bounded to
at most one orphan per hard stop (single-flight), and a restarted llmdash's
probes tear down normally.
**Remediation:** A best-effort synchronous `process.kill(-child.pid,
'SIGTERM')` from a `process.on('exit')` + SIGTERM/SIGINT handler tracking the
current in-flight child; and/or sweeping stale `claude-usage-probe-*.typescript`
files at startup. Deliberately not applied in-stage: installing process-signal
handlers changes the service's shutdown semantics, which is beyond a minimal
obviously-correct fix and should be a deliberate engineering change.
**Status:** Open — recommended as a small follow-up; not blocking (rare
trigger, bounded impact, no trust boundary crossed).

### Attempt-spacing floor inherits the freshness knob's absent lower clamp

**Severity:** Informational
**Location:** `config.js:14–17` (`LLMDASH_CLAUDE_MAX_AGE_MS` accepts any finite value > 0), `src/claude-refresh.js:109` (spacing floor `now + cfg.claudeMaxAgeMs`), `:63–65` (failure spacing `max(backoff, maxAge)`)
**Description:** Successful-attempt spacing floors at `claudeMaxAgeMs`, which
clamps upward (7-day ceiling, prior review) but only requires `> 0` downward.
A deliberately tiny value (e.g. `LLMDASH_CLAUDE_MAX_AGE_MS=1`) makes every
reading instantly stale, collapsing the spacing floor so a probe can start on
every poll tick (`LLMDASH_POLL_MS` is likewise unclamped) while Claude is
active. Bounds that still hold under every input: single-flight caps
concurrency at exactly 1, **failure** spacing never drops below the 5-minute
backoff base, a backwards clock jump only lengthens the wait
(`now < nextAttemptAt` → `waiting`), and a sleep gap yields one attempt. The
degenerate case is therefore a sustained ~6–8 spawns/minute self-DoS
requiring a deliberately absurd local env value.
**Remediation:** Optionally floor-clamp the knob (e.g. 60 s). Not applied:
the knob's `> 0` semantics shipped with the prior feature (its review capped
only the upper bound), tests legitimately drive small values, and changing a
shipped knob's range is out of this feature's scope.
**Status:** Accepted — local-env-owner-only, concurrency stays 1, and the
threat model (CLAUDE.md, prior reviews) treats local env as the operator's own
authority.

---

## Checks Performed

| Check | Result |
|---|---|
| **Process spawning (NFR-06, FR-22/23/26)** | |
| `RUNNER_SRC` is a fixed constant; config enters only as quoted positional argv (`"$1"` typescript path, `"$2"` resolved claude path); no template interpolation exists (guard test `tests/autorefresh-guard.test.js:38–52` + source read) | Pass |
| `/bin/sh` and `/usr/bin/script` invoked by absolute path; the only PATH-resolved word in the runner is `sleep` (plus the `printf` builtin), resolved from node-dir/system dirs which all precede the claude dir (appended last — a malicious `LLMDASH_CLAUDE_CMD` cannot shadow runner tools) | Pass |
| `LLMDASH_CLAUDE_CMD` abuse ceiling: resolved via `resolveCommand` (pure fs `X_OK`, no subprocess), spawned only as the resolved absolute path in argv; a hostile value (spaces, metacharacters, colons) at worst runs a binary or names PATH dirs the env owner already controls — no escalation across any trust boundary (QA-35 live-verified metachar path) | Pass |
| Child env is an explicit allowlist (`PATH,HOME,USER,LOGNAME,TERM,LANG`); `CLAUDECODE*`/`ANTHROPIC_*`/`LLMDASH_*` structurally excluded; nothing sensitive enters the child (HOME is required — the probe must run as the authenticated user by design); QA live-captured the child env matching | Pass |
| No blind spawn: unresolvable command → `spawn-error` before any spawn (FR-26); both the synchronous spawn-throw and async `error` paths return `spawn-error` and unlink the typescript | Pass |
| Probe cwd is the fixed, non-configurable `~/.llmdash/claude-refresh-cwd`, created `mode 0o700` under `$HOME`; only input ever typed is `/usage` + Enter (two printf fragments, count-locked by the guard test — FR-23) | Pass |
| **Signal/teardown safety** | |
| Group kill targets `-child.pid` where the detached child is its own group leader (pid > 0 always); `kill(-1)`/`kill(0)`/`kill(-0)` unreachable; an undefined pid becomes NaN and throws inside try/catch | Pass |
| `findClaudePid`: one ps snapshot; a candidate must both name the claude path/basename **and** walk a ppid chain (≤12 hops) back to our spawn — the user's live sessions are structurally unmatchable; ps failure resolves null (fail-closed, group kill still runs) | Pass |
| Pid-reuse window between pid record and TERM→KILL escalation | Finding — Informational, Accepted |
| Timeout/exit/error paths: `settled` guard, all timers cleared, teardown awaited, typescript unlinked on every settle path; QA observed 7.0 s teardown at the clamp floor and zero leftover processes | Pass |
| Ungraceful llmdash exit mid-probe (no signal-handler teardown; detached group survives) | Finding — Informational, Open |
| **Scraped-data trust chain (pane → file → wire → DOM → DB)** | |
| The reading file receives only clamped numbers and self-generated values: `used_percentage` clamped 0–100 (`parseWindowSeg` and again in `buildReadingPayload`), `resets_at` an epoch number or null, `capturedAt` a self-generated ISO from the capture moment — **no scraped string is ever written** (`buildReadingPayload` read line-by-line) | Pass |
| Ingest re-clamps and re-canonicalizes independently (`src/claude-limits.js:37–53`): used% clamped, timestamps `Date.parse → toISOString`, mtime fallback — probe payloads get no special trust | Pass |
| Scraped reset text/zone are regex-constrained (`[^()\n]+?` / IANA charset class) and consumed only by `resetTextToEpoch` (returns number or null); the once-per-process conversion-failure log line is the only surface scraped text reaches — single-line by construction (deAnsi strips control bytes 0x00–0x1F/0x7F; the regex excludes newlines and parens), local console only, never the wire or DOM | Pass |
| `capturedAt` = pane-capture moment (FR-09), never parse time, never scraped text; newest-capturedAt-wins (`writeReadingIfNewer`) can never regress the reading; the ms-scale read/rename race against a simultaneous organic capture leaves two near-identical fresh readings — honest either way, and organic captures are never blocked | Pass |
| Failure causes are a closed 4-literal set assigned only in `src/claude-refresh.js`; they cross the wire as the enum (test-locked: `tests/autorefresh-diagnostics.test.js:121–124` asserts no free-form failure text on `/api/state`); the client maps them to fixed sentences via an own-key lookup with fallback | Finding — Informational, Resolved (see above); Pass post-fix |
| Both-windows-required: a pane missing either contract window → `parse-failed` (`sawPane` distinguishes it from timeout); never a partial or fabricated reading; the Fable promo meter and the analysis section are structurally excluded by stop anchors | Pass |
| Malformed/hostile pane fixtures: parser never throws, never fabricates (`tests/claude-refresh-parse.test.js`, real spike captures with account strings sanitized — grep confirms no real email/org in fixtures) | Pass |
| **File writes** | |
| Reading write is temp+rename atomic in `dataDir` (`.tmp-<pid>` → `renameSync`) | Pass |
| Typescript file lives in `dataDir` with a per-attempt unique name, unlinked on every settle path; predictable-name/symlink exposure requires same-user write access to llmdash's own data dir — within the single-user posture (crash leftovers covered by the orphan finding) | Pass |
| llmdash never writes a Claude-owned path: `src/claude-refresh.js` touches `projectsDir` with readdir/stat only; the two ratified mutations (one-time `~/.claude.json` trust entry, one `history.jsonl` line per refresh) are performed by Claude Code itself, exactly as the user ratified (decisions.md 2026-07-02), and both are disclosed in startup log + README | Pass |
| Only two mkdir surfaces: `claudeRefreshCwd` (0700) and `dataDir`; no other fs writes added anywhere in the feature | Pass |
| **Web surface** | |
| `/api/state` additions carry only `reason`/`cause`/`capturedAt`/`ageMs`; of the refresh state, only `disabled`, `consecutiveFailures ≥ 3`, and `lastFailureCause` influence the wire — no paths, pids, timings, or typescript detail cross the tailnet (within the accepted informational posture, and strictly less than what the startup log prints locally) | Pass |
| Exactly one reason code or null, precedence failing > disabled > stale-reading/no-statusline-reading (FR-18, unit-locked); first-run honesty holds structurally — zero attempts means zero failures, so `auto-refresh-failing` cannot fire prematurely (FR-19) | Pass |
| Security headers and CSP byte-identical (`default-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'`, nosniff, no-referrer, 405 non-GET/HEAD, no-store) — `src/server.js:26–33` unchanged by the feature | Pass |
| Client rendering: both new notes build exclusively from fixed literals plus `fmtAge()` output (numeric-derived from canonical-ISO `capturedAt`); no new inline styles or event handlers; hostile-cause VM probe (incl. `<img onerror>` as a cause) renders nothing raw | Pass |
| The reserved code names are consumed exactly as reserved (`auto-refresh-failing`/`auto-refresh-disabled`) — not reinvented, and the CLAUDE.md reservation is now honored by the shipped mechanism | Pass |
| **Installer / plist** | |
| `resolve_claude` mirrors the codex resolver (quoting correct, `command -v` + fixed dir list); a missing claude is warned loudly and surfaced by health/UI rather than baked silently dead | Pass |
| sed/plist metachar fragility: the new `CLAUDE_PATH` substitution is the same class and pattern as the standing acceptance (DECISIONS.md 2026-07-01: "pre-existing sed/plist metachar fragility stands") — verified not worsened; not re-flagged | Pass |
| Plist bakes `LLMDASH_CLAUDE_CMD` only — no secrets, no new env surface beyond the documented knob | Pass |
| **Secrets / config** | |
| No secrets, tokens, or credentials in any changed file; fixtures sanitized (`user@example.com`; grep for the real account strings comes back clean) | Pass |
| Knob clamps: `LLMDASH_CLAUDE_REFRESH_TIMEOUT_MS` clamped both ways (5 s–5 m); `LLMDASH_CLAUDE_MAX_AGE_MS` keeps its shipped `>0` + 7-day-ceiling clamp; `LLMDASH_CLAUDE_AUTOREFRESH` disables only on `'0'`/`'false'` (documented) | Pass |
| Spacing floor inherits the freshness knob's absent lower clamp | Finding — Informational, Accepted |
| No dead knobs: all four env vars drive behavior (guard test `tests/autorefresh-guard.test.js:54–66` + source read); README documents every knob with its default and both disclosures (guard-test-locked) | Pass |
| `.claude/launch.json` (orchestration artifact): dev-only config binding `127.0.0.1:8899` — benign, no production effect | Pass |
| **DoS / resource** | |
| Spawn rate bounds: single-flight caps concurrency at 1; attempt starts spaced ≥ `claudeMaxAgeMs`; failures spaced ≥ max(backoff, threshold) with 5 m→60 m doubling; backwards clock → `waiting` (never a burst); sleep gap → at most one attempt (unit suites `tests/claude-refresh-gates.test.js`) | Pass |
| The 500 ms typescript poll loop always terminates: the timeout timer (≤ 300 s ceiling) fires before the 307 s pipeline dwell can drain, and `finish()` clears every timer on all paths | Pass |
| Activity scan is bounded metadata work (readdir + stat, one level), runs only after the cheaper freshness gate passes, and only on poller ticks — never on the HTTP request path (structural: `maybeRefreshClaude`'s sole call site is `pollOnce`, `src/poller.js:24`) | Pass |
| `ps` snapshot capped at 4 MB maxBuffer; at most two pid-lookup execFiles per attempt; typescript growth bounded by probe lifetime | Pass |
| **Regression** | |
| Full suite green before and after the in-stage fix: 123/123 both runs; fix scope confined to `public/app.js` (one guarded lookup) + `tests/app-copy.test.js` (pattern lock updated) | Pass |

---

## Convention Flags

- **Client enum→copy tables must use own-key lookups.** A plain
  `TABLE[code] || fallback` also hits keys inherited from `Object.prototype`
  (`constructor`, `toString`, `__proto__`), so an unexpected code can bypass
  the fallback, throw mid-render, or leak `[object …]` into copy. Gate every
  such table with `Object.prototype.hasOwnProperty.call(TABLE, code)` (or use
  a null-prototype object). This complements the existing "the client maps
  codes to copy and never guesses" convention.
