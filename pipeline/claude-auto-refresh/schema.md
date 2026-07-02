# Schema / System Design — claude-auto-refresh
**Feature:** claude-auto-refresh
**Date:** 2026-07-02
**Stage:** 3 — The Architect
**Path:** Incremental (prior schemas exist; this feature adds no tables and no columns)
**Branch:** [R2-scrape] per `spike-report.md` — spawn → `/usage` → parse pane → same reading file

---

## Data layer verdict

**No database change.** The mechanism produces a reading in the exact shape the
statusline script already writes; `usage_snapshots`, dedup, trends, and the
freshness layer consume it unmodified (FR-07, OQ-06: no provenance column). The
"data layer" of this feature is one new file-shaped contract it *reuses*:

```
data/claude-ratelimits.json   (config.rateLimitsFile — unchanged shape)
{ "rate_limits": { "five_hour": { "used_percentage": <0-100>, "resets_at": <epoch-s|null> },
                   "seven_day": { "used_percentage": <0-100>, "resets_at": <epoch-s|null> } },
  "capturedAt": "<ISO-8601>" }
```

Writers: `scripts/statusline.js` (organic, unchanged) and the new refresher.
Reader: `readClaudeLimits()` (unchanged).

---

## Modules

| File | Change |
|---|---|
| `src/claude-refresh.js` | **New.** The whole mechanism: gates, spawn, capture, parse, write, failure state. |
| `src/poller.js` | +2 lines: `await maybeRefreshClaude()` at the top of `pollOnce()` (before the Claude snapshot, so a capture lands in the same tick's snapshot). |
| `src/server.js` | Diagnostic derivation gains the two reserved codes with FR-18 precedence, read from `getRefreshState()`. |
| `src/health.js` | `freshnessModeLine()` rewritten (its copy becomes false); `healthLines()` Claude line gains the mechanism's dependency (claude cmd resolution — reuse `resolveCommand`). Cheap fs checks only. |
| `config.js` | Three real knobs + one fixed path (below). |
| `public/app.js` | Map `auto-refresh-failing` / `auto-refresh-disabled` to copy (free-form fields escaped, per convention). |
| `README.md` | Mechanism section per FR-30. |
| `tests/fixtures/usage-pane-{1,2}.txt` | Real spike captures (already vendored, sanitized). Parser tests run against these. |

## Config (no dead knobs — each drives behavior)

| Key | Env var | Default |
|---|---|---|
| `claudeCmd` | `LLMDASH_CLAUDE_CMD` | `claude` (resolved via `resolveCommand`; launchd needs an absolute path — installer note, mirroring codex) |
| `claudeRefreshTimeoutMs` | `LLMDASH_CLAUDE_REFRESH_TIMEOUT_MS` | `30000`, clamped to sane bounds (≥5 s, ≤5 m) |
| `claudeAutoRefresh` | `LLMDASH_CLAUDE_AUTOREFRESH` | on; only `0`/`false` disable (FR-27) |
| `claudeRefreshCwd` | — (fixed constant, disclosed) | `~/.llmdash/claude-refresh-cwd` — install-independent so dev + installed copies share the **one** trust entry ever |

Reused, unchanged: `LLMDASH_CLAUDE_MAX_AGE_MS` (the refresh threshold IS the
aging band), `claudeStaleAfterMs` (2×, the activity window), `pollIntervalMs`.

---

## Control flow (every poller tick)

```
pollOnce()
└─ maybeRefreshClaude(now)                      [src/claude-refresh.js]
   1  disabled? ──────────────► record {disabled}, return   (zero spawns; FR-27)
   2  reading age < claudeMaxAgeMs? ──► return              (freshness suppression; FR-13 —
        age from readClaudeLimits().capturedAt;              organic statusline captures count)
   3  no Claude activity within claudeStaleAfterMs? ─► return   (activity gate; FR-12/OQ-02:
        newest transcript mtime under config.projectsDir — bounded metadata scan,
        dir-listing cached per tick, no content reads)
   4  in-flight, or now < nextAttemptAt? ──► return         (single-flight + spacing; FR-14 —
        spacing ≥ claudeMaxAgeMs; backoff only lengthens it; wall-clock arithmetic,
        so a sleep gap yields at most one attempt on the first wake tick)
   5  attemptRefresh():
        spawn ─► poll typescript for a parse hit every 500 ms ─► capturedAt = hit time
              ─► teardown immediately (FR-25) ─► convert + clamp + write-if-newer
        on any failure: failure(cause), backoff doubling 5m→60m (FR-15)
```

Runs only inside `pollOnce()` — never on the HTTP path (FR-11/NFR-07). The
await is bounded by the timeout; the 60 s tick tolerates it.

## Spawn (inherited law, NFR-06-safe)

One fixed `/bin/sh -c` script **constant** (no config interpolation — config
values enter as positional argv), replicating the spike's validated runner:

```
spawn("/bin/sh", ["-c", RUNNER_SRC, "sh", tsPath, claudeAbsPath], {
  cwd: claudeRefreshCwd,            // created if absent (0700)
  env: CLEAN_ENV,                   // explicit allowlist: PATH (node dir ⊕ system ⊕ claude dir),
  detached: true,                   //   HOME, USER, LOGNAME, TERM=xterm-256color, LANG
  stdio: "ignore",                  // script's stdin comes from the sh pipeline, never a Node pipe
})
```

`RUNNER_SRC` = `(sleep 6; printf '/usage'; sleep 1; printf '\r'; sleep <dwell>) | /usr/bin/script -q -t 0 "$1" "$2"`
— keystrokes via a real pipe (socketpair law), dwell sized so the pane renders
before EOF; the capture loop usually wins earlier. Teardown: `kill(-pgid, TERM)`,
2 s grace, verify the claude pid (found once via `ps` ppid-match after spawn)
exited via SIGHUP; escalate TERM→KILL on the pid directly. Timeout ⇒ same
teardown + `failure("timeout")`. Never `kill` anything not recorded at spawn
time (live sessions untouchable, NFR-04). Typescript files live under
`dataDir` and are unlinked after each attempt.

## Parse & write

`parseUsagePane(text)` (exported for tests; fixture-tested):
de-ANSI → anchor `Current session` / `Current week (all models)` →
tolerant `(\d{1,3})\s*%\s*used` + `Res\w*\s+<text>\s*\(<zone>)` → clamp 0–100.
The Fable meter and the "What's contributing" section are **never** scraped.
Both windows required; otherwise `failure("parse-failed")` (the pane changed —
version-brittle by design assumption).

`resetTextToEpoch(text, zone, now)`: IANA zone from the paren;
bare time ("12:20am") = next future occurrence in that zone; dated
("Jul 3 at 11pm") = that date in that zone (nearest-future year). Uses
`Intl.DateTimeFormat` zone math (no deps). On conversion failure:
`resets_at: null`, reading still ships, once-per-cause log (spike finding 5).

Write: build the statusline-shaped JSON, `capturedAt` = pane-capture moment
(FR-09); read the current file first and **skip the write unless newer**
(FR-10); write via temp-file + `rename` in `dataDir` (atomic vs the poller's
own read; the organic statusline writer stays untouched).

## Failure state & diagnostics

In-memory in `src/claude-refresh.js` (process-lifetime, like codex's):
`{ disabled, inFlight, lastAttemptAt, nextAttemptAt, consecutiveFailures,
lastFailureCause }` — exposed via `getRefreshState()`. Causes:
`spawn-error` (incl. unresolvable `claudeCmd`, FR-26) · `timeout` ·
`parse-failed` (distinct — names the "CLI update changed the screen" remedy) ·
`no-reading-produced`. Once-per-distinct-cause console logging (FR-20).

`src/server.js` diagnostic precedence (FR-16..19), replacing the current
two-way pick for claude only:

```
reading stale-or-absent AND consecutiveFailures ≥ 3 → { reason:"auto-refresh-failing", cause, capturedAt?, ageMs? }
else reading stale-or-absent AND disabled          → { reason:"auto-refresh-disabled", capturedAt?, ageMs? }
else                                                → existing: stale-reading / no-statusline-reading / null
```

Gauges keep rendering the last capture in every state (never blanked).
First-run honesty (FR-19) falls out: zero attempts ⇒ zero failures ⇒ existing
codes. Client copy: failing → "auto-refresh is failing (<cause>) — open a
Claude Code CLI session to refresh manually"; disabled → "auto-refresh is off
(LLMDASH_CLAUDE_AUTOREFRESH=0) — unset it to re-enable, or open a CLI session."

## Disclosure (FR-28..30)

- `freshnessModeLine()` → states the shipped truth: auto-refresh via a spawned
  `/usage` probe; activity-gated (threshold + derived stale band, knob named);
  off-switch env var; the dedicated cwd, its one-time trust entry, and the
  per-refresh `~/.claude/history.jsonl` append — loudly, at startup.
- `healthLines()` Claude line adds: claude cmd resolved/unresolvable (with the
  `LLMDASH_CLAUDE_CMD` remedy, mirroring codex's line).
- README: mechanism, cadence, all knobs + defaults, trust + history
  disclosure, manual remedy. Installer (`scripts/install-macos.sh`): resolve
  `claude` to an absolute path like it does codex (flagged for the Engineer;
  keep the change minimal).

## Test seams (Stage-6 QA table)

- `parseUsagePane` / `resetTextToEpoch`: pure, fixture-fed (QA-03 basis, QA-06).
- `maybeRefreshClaude({ now, spawnFn, readReading, activityMtime })` —
  injectable clock, spawn, and fs probes: gates (QA-09..13), backoff schedule
  (QA-14), single-flight/sleep (QA-13), never-regress via contrived
  out-of-order writes (QA-08), diagnostics (QA-15..19), off-switch (QA-16,
  QA-26), unresolvable binary (QA-25).
- Spawn-integration checks (QA-21..24, QA-31..33) run scripted against the real
  binary on this machine at Stage 6, reusing the spike's verification recipes
  (projects diff, history count, trust count, ps sweeps).

## Risks the Engineer inherits

1. **The parser is the fragile surface** — mitigations: fixtures from real
   captures, tolerant anchors, `parse-failed` as a loud first-class failure.
2. **Trust-dialog first run**: if the trust entry is ever removed by the user,
   the next spawn re-prompts; the runner must answer the dialog exactly as the
   spike did (Enter on "Yes") — or time out honestly. Keep the dialog-answer
   keystroke ahead of `/usage` harmless when no dialog appears (a bare `\r` on
   the ready TUI is a no-op — spike-validated).
3. **history.jsonl growth** is the accepted, disclosed residual (one line per
   refresh, activity-gated).
4. Deploy reality: the user's installed copy at `~/llmdash` only gets this
   when re-deployed (Stage 8 concern, recorded).
