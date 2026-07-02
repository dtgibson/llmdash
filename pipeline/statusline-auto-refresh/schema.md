# Schema & Contract Design — statusline-auto-refresh (Branch B)
**Feature:** statusline-auto-refresh
**Date:** 2026-07-01
**Stage:** 3 — The Architect
**Branch:** **B** (spike failed — see `spike-report.md`). Everything tagged [A] in the
PRD is out; this document designs the [A+B] subset only, per FR-23 / QA-24: **zero [A]
machinery present.**

---

## Path: frontend-only / no data-layer change

No SQLite changes: no new tables, no new columns, no migrations, no change to
`usage_snapshots` or the trends derivation. The PRD lists snapshot/trends schema change
as Out of Scope, and branch B adds only: derived staleness state on the existing
`capturedAt` plumbing, one env knob, `/api/state` field extensions, startup-log/README
copy, and UI rendering. Nothing new is persisted. (Path declared and proceeded hands-off;
prior schemas from earlier features are untouched.)

---

## 1. `/api/state` contract additions

All changes are on the **`claude-code` tool object only**. Codex is untouched (no
three-band retrofit — PRD Out of Scope).

### 1a. `freshness` (new field, FR-15/FR-16)

```json
"freshness": {
  "capturedAt": "2026-07-01T23:05:13.626Z",   // = the tool's dataAt; null if no reading
  "freshForMs": 300000,                        // reading age ≤ this → "fresh"
  "staleAfterMs": 600000                       // reading age > this → "stale"; between → "aging"
}
```

- Present on the claude tool always (even with no reading — thresholds still apply to
  copy); `null` on the codex tool (not retrofitted; the client treats null as "no
  freshness treatment").
- `freshForMs` = configured threshold (§3). `staleAfterMs` = **2 × freshForMs, derived,
  never independently configurable** (FR-16 keeps one knob).
- **The client derives the band live** (`Date.now() − Date.parse(capturedAt)` each 1 s
  render tick, matching the existing ticker) using these server-supplied thresholds. This
  keeps the age display current between 60 s fetches while the server stays the single
  source of the thresholds. Negative age (clock skew) clamps to 0 ("just now" — existing
  `fmtAge` behavior).

### 1b. `limitsDiagnostic` extension (FR-19/FR-20/FR-22)

Reason codes the server may emit for claude in branch B — **exactly one, or null**:

| Condition (server-evaluated in `buildState`) | `limitsDiagnostic` |
|---|---|
| Reading exists, age ≤ `staleAfterMs` | `null` |
| No reading ever | `{ "reason": "no-statusline-reading" }` (existing, unchanged) |
| Reading exists, age > `staleAfterMs` | `{ "reason": "stale-reading", "capturedAt": "<ISO>", "ageMs": <int> }` |

- `ageMs` is computed at generation time for convenience; the client re-derives live age
  from `capturedAt` for display (so the copy's age doesn't freeze between fetches).
- **Precedence (FR-22):** full order is `auto-refresh-failing` > `auto-refresh-disabled` >
  `stale-reading` (reading present) / `no-statusline-reading` (no reading ever). Branch B
  implements only the last two, which are mutually exclusive by construction (reading
  present XOR absent). The two [A] codes are reserved names — do not reuse them for
  anything else — so a future branch-A revival slots in above without a contract break.
- **Contract shift the Engineer must not miss (QA-20):** today `limitsDiagnostic` is
  non-null only when `haveLimits` is false and the client renders `limitsNoteHtml` only
  then. With `stale-reading`, **the diagnostic is non-null while the gauges still render**
  (the stale reading stays visible — never blank a real reading). Client change:
  `limitsNoteHtml` renders whenever `limitsDiagnostic` is non-null, and its copy map gains
  `stale-reading`: state the reading's age and the remedy ("open a Claude Code CLI session
  to refresh the reading"). This diagnostic copy IS the FR-18 nudge — in branch B a stale
  or absent reading never has a working refresh path, so no separate nudge state exists.

### 1c. Where it's computed

In `buildState()`/`toolWrap()` on the request path — a cheap fs read that already happens
per request for claude (`readClaudeLimits()`). No subprocess, no poller state, no new
work on the HTTP path beyond a date subtraction (NFR-07 unaffected).

**Honesty fix required in `src/claude-limits.js`:** `readClaudeLimits()` currently
defaults a missing `capturedAt` to `new Date().toISOString()` — under a staleness feature
that makes a malformed file **eternally fresh** (re-read per request, re-stamped now).
Change the fallback to the file's `mtime` (`fs.statSync`, same source `dataSourceHealth`
already uses); only if both are unavailable treat the reading as having unknown age →
band "stale" copy variant "age unknown" is over-engineering; simply use mtime — it always
exists if the file was read.

## 2. Runtime state

**None persisted; none in-memory beyond what §1c computes per request.** Branch B has no
spawn machinery, so the PRD's poller-side state (last attempt, consecutive failures,
backoff, single-flight lock) does not exist in this build. Nothing to justify persisting.
The poller keeps its existing role (snapshots + stats cache) unchanged.

## 3. Env knobs

| Env var | Default | Parsing | Drives |
|---|---|---|---|
| `LLMDASH_CLAUDE_MAX_AGE_MS` | `300000` (5 m) | `Number(...)`; if not finite or ≤ 0, fall back to default (clamp convention for externally-sourced values) | `freshness.freshForMs`; `staleAfterMs` = 2×; the `stale-reading` trigger; startup-log copy |

Added to `config.js` as `claudeMaxAgeMs` with a derived `claudeStaleAfterMs` getter
(`2 * claudeMaxAgeMs`).

**Not shipped (deliberately — QA-24 demands zero [A] machinery, and dead config knobs are
dishonest surface):** `LLMDASH_CLAUDE_AUTOREFRESH`, `LLMDASH_CLAUDE_REFRESH_TIMEOUT_MS`,
`LLMDASH_CLAUDE_CMD`.

## 4. Startup log & health readout (FR-12 B / FR-13)

- `healthLines()` Claude line gains the manual-refresh reality alongside the age it
  already prints, e.g.:
  `Claude limits: statusline reading present (updated 3m ago; marked stale after 10m) — <file>. Readings refresh only when a real Claude Code session renders its status line.`
  The no-reading variant keeps its existing honest copy (already names the remedy).
- Server startup prints the mode statement once (FR-12 branch-B wording): readings
  refresh only via real Claude Code CLI sessions; name `LLMDASH_CLAUDE_MAX_AGE_MS` and the
  10 m stale band so the surfaced default is complete (surface-defaults convention).

## 5. UI reading-age cue (FR-15–FR-18, NFR-08)

- Claude tool block shows the reading age ("updated 12m ago") whenever a reading exists —
  derived from `freshness.capturedAt`, re-rendered on the existing 1 s tick.
- Three bands from `freshness` thresholds: **fresh** (plain, no flag), **aging**
  (visually distinct, must NOT contain the word "stale"), **stale** (the literal word
  "stale" in rendered text + distinct styling — text first, styling second, per NFR-08;
  e.g. `stale — updated 1h ago`). Band classes reuse the design system's existing
  good/warn/crit vocabulary (Designer's call on exact treatment; the contract here is:
  band is client-derived, stale must be a word, aging must not say stale — QA-16/17/18).
- A stale reading still renders its gauges (FR-17: flagged, never unmarked; never blanked).
- Nudge: via the `stale-reading` / `no-statusline-reading` diagnostic copy (§1b) — both
  name "open a Claude Code CLI session to refresh the reading" (QA-19/QA-25).

## 6. README (FR-14 B)

Document: Claude readings refresh only when a real Claude Code session renders its
statusline (the desktop app does not); the reading-age cue and its bands; the
`LLMDASH_CLAUDE_MAX_AGE_MS` knob with default and the derived 2× stale band; the manual
remedy. No auto-spawn claims anywhere.

## 7. Spawn mechanism spec — NOT SHIPPED, findings preserved (FR-23)

Branch B ships identical behavior on all platforms; **no platform-gating code exists**
(nothing to gate). For a future revival (macOS or Linux), the spike's validated mechanics
and the blocker are in `spike-report.md`; the short version a reviver must honor:

1. The blocker to re-test first: idle sessions get no `rate_limits` in the statusline
   payload (2.1.198). A revival needs a CLI change or a validated no-usage trigger (e.g.
   whether `/status` — a client-side slash command, not a message — populates it:
   **untested**, deliberately left outside the shipped spec).
2. Clean explicit child env (never inherit — `CLAUDECODE`/`ANTHROPIC_BASE_URL` hazards);
   prepend `path.dirname(process.execPath)` to PATH for the statusline's `node`.
3. `script(1)` stdin: `'ignore'`, never a Node pipe (socketpair) or fifo — both fatal.
4. Fresh-cwd trust dialog blocks the statusline; acceptance is a config mutation needing
   explicit review.
5. Teardown: kill script's group, then verify the claude pid (own session leader) exited
   via pty SIGHUP; escalate on the claude pid directly if not.

## 8. Open-question verdicts (evidence in spike-report.md)

- **OQ-01: No.** Prompt-free sessions produce no `rate_limits` (48 s / 150 s watches;
  statusline confirmed executing). Branch B ships.
- **OQ-02: No clutter.** Message-free sessions write no transcript at all; moot in B.
- **OQ-03: superseded at design review — the user set 5 m / 10 m** (2× derived) for
  the UI bands; a heavy session can burn the 5-hour window in under an hour.
- **OQ-04: Confirmed no reads in v1** — moot in B (`no-reading-produced` doesn't ship).
- **OQ-05: Moot in B**; mid-render kills proven safe for any future revival.

## 9. Test hooks (for Stage 6/7)

- Fabricate any band: point `LLMDASH_DATA_DIR` at a temp dir and write a
  `claude-ratelimits.json` with a chosen `capturedAt`; `buildState()` is pure on `nowMs`.
- Knob parsing: `LLMDASH_CLAUDE_MAX_AGE_MS` garbage/zero/negative → default 300000.
- Precedence (QA-21): reading present + stale → exactly `stale-reading`; file absent →
  exactly `no-statusline-reading`; never both; fresh/aging → null diagnostic.
- QA-18 needs a real browser render (the word "stale" in rendered text), per the
  chart-regression lesson in CLAUDE.md.
- Applicable QA rows: QA-14–21, QA-24, QA-25, QA-27. QA-24's "zero spawns under any
  staleness" is satisfied vacuously but should still be asserted (no `spawn` call sites
  added; `package.json` still zero-dep for QA-27).
