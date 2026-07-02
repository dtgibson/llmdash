# PRD — Claude Auto-Refresh
**Feature:** claude-auto-refresh
**Date:** 2026-07-02
**Stage:** 2 — The Planner
**Source:** strategic-brief.md (approved)

---

## Feature Overview

llmdash keeps the Claude limit reading at most ~5 minutes old whenever Claude is
actually being used — with no manual open-a-CLI-session ritual — via the
cheapest mechanism that empirically works, resolved by a Stage-3 decision spike
over a strict two-rung ladder (passive local sources, then a client-side-command
probe in a spawned idle session). The captured reading feeds the freshness
layer that shipped 2026-07-01 unchanged; if every zero-cost rung fails, the
feature ends honestly with findings recorded and nothing speculative shipped.

### The three outcomes

The approved brief makes the spike a gate over a prioritized ladder, so this
PRD specifies all three outcomes as first-class deliverables. Exactly one
ships; the Stage-3 spike decides which:

- **[R1] — passive-source branch:** a local Claude Code file (transcript JSONL,
  another state file, or a machine-readable CLI usage command) carries limit
  data; llmdash reads it passively. Zero spawns, zero usage, inherently
  activity-gated. If rung 1 validates, rung 2 is skipped entirely.
- **[R2] — spawned-probe branch:** rung 1 fails, but typing a client-side
  command (`/status` or `/usage`) into a short-lived spawned idle session
  populates `rate_limits` in the statusline payload. Zero usage cost, one
  bounded spawn per refresh.
- **[F] — honest all-fail ending:** both zero-cost rungs fail empirically.
  Findings are recorded, the roadmap and copy are corrected, the consent-gated
  last resort is surfaced as a question for the user, and no mechanism ships.

**Tagging:** untagged requirements apply in every outcome (the spike itself and
its recording). **[R1+R2]** ships if any mechanism ships. **[R1]**, **[R2]**,
**[F]** are branch-specific. No requirement from a non-shipping branch is
built.

"Claude" throughout means the `claude-code` source only; Codex already polls
live and is untouched.

### Defaults at a glance (decided here)

| Knob / cap | Default | Env var | Justification |
|---|---|---|---|
| Refresh threshold (reading age that triggers refresh work) | 5 minutes | `LLMDASH_CLAUDE_MAX_AGE_MS` (existing, shipped) | One freshness knob, already shipped; this feature consumes it and adds no second one. |
| Activity window ("recent Claude use") | the stale band: 2× threshold (10 m), derived | none (derived) | Guarantees the ≤ threshold freshness during continuous use, plus one threshold of trailing grace after a burst ends; no new knob. |
| Spawn timeout [R2] | 30 seconds | `LLMDASH_CLAUDE_REFRESH_TIMEOUT_MS` | Prior spike: TUI up in ~3–5 s, statusline shortly after; 30 s is generous without letting a hung session linger. |
| Failure backoff [R2] | 5 min doubling to 60 min cap; surfaced after 3 consecutive failures | none (constants) | Prior PRD's schedule; never hammers a failing spawn, persistent failure visible within ~35 min. |
| Off-switch | [R2] on by default, `LLMDASH_CLAUDE_AUTOREFRESH=0` disables. [R1] **no switch ships** | `LLMDASH_CLAUDE_AUTOREFRESH` [R2 only] | No dead knobs: a passive read has nothing to turn off; a spawner must be disclosable and stoppable. Opt-in would leave gauges stale on exactly the days the feature exists for. |
| Claude binary [R2] | `claude` | `LLMDASH_CLAUDE_CMD` | Mirrors `LLMDASH_CODEX_CMD`; launchd's minimal PATH makes an absolute path necessary in practice. |
| Spike budget | rung 1: fs reads + help/version invocations only, zero sessions; rung 2: ≤ 10 session spawns, ~20 min wall target | n/a | Prior spike used 8 spawns / ~20 min; command input adds iterations but inherits solved mechanics. |

---

## User Stories

> **US-01** — As a desktop-app-only Claude user, I want the dashboard's Claude
> reading to be at most ~5 minutes old whenever I'm actively using Claude, so
> that the number I glance at reflects my headroom right now without me opening
> a CLI session.

> **US-02** — As the owner of this machine, I want refresh effort strictly
> activity-gated — no spawns, scans, or subprocess work around the clock for a
> reading that cannot have changed — so that the dashboard is resource-friendly
> by my own definition.

> **US-03** — As the owner of this machine, I want any refresh mechanism loudly
> disclosed at startup and in the README — and, if it spawns anything,
> switchable off with an env var — so that llmdash never silently runs my
> Claude binary or mutates Claude's configuration behind my back.

> **US-04** — As a dashboard user whose refresh mechanism is failing or
> switched off, I want the dashboard to say so through the existing freshness
> cues (`auto-refresh-failing` / `auto-refresh-disabled`) while the gauges keep
> rendering the last capture, so that staleness is never silent and freshness
> is never fabricated.

> **US-05** — As a Claude Code user, I want the mechanism to observe my usage
> without changing it: my live sessions never touched or signaled, no usage
> quota consumed, and llmdash's own activity stats never polluted by refresh
> artifacts.

> **US-06** — As the product owner, if every zero-cost avenue fails
> empirically, I want a clean ending — evidence recorded, roadmap corrected,
> the consent-gated usage-burning option put to me as a question rather than
> shipped as an answer — so the dashboard stays exactly as honest as it is
> today.

---

## Functional Requirements

### The decision spike (Stage 3) — every outcome

> **FR-01** — Stage 3 shall resolve the mechanism with a decision spike
> **before any design is committed**, working the ladder in strict priority
> order — rung 1 (passive local sources), then rung 2 (client-side-command
> probe) only if rung 1 fails — stopping at the first rung that empirically
> produces a fresh `rate_limits`-equivalent reading. Exactly one branch
> ([R1], [R2], or [F]) proceeds; requirements of non-shipping branches are
> not built.

> **FR-02** — The rung-1 spike shall answer, with cited evidence, each of:
> - **SQ-1a** — Do transcript JSONL records under `~/.claude/projects` carry
>   rate-limit data? Checked against a **fresh record from a real, recent
>   session** (desktop-app and CLI both, if both exist), at field level — not
>   against docs or memory.
> - **SQ-1b** — Does any other local Claude Code state file persist limit data
>   (candidates enumerated in the report, e.g. `~/.claude.json`, cache/state
>   files under `~/.claude/`)?
> - **SQ-1c** — Does the installed CLI now expose a machine-readable usage
>   command (checkable via help/version output and a non-session invocation —
>   no interactive session, no message)?
>
> The success signal for any sub-question: per-window used-percentage (both
> windows where present) **plus a usable capture timestamp**, cross-checked
> for agreement against the current statusline-captured reading.

> **FR-03** — If rung 1 fails, the rung-2 spike shall answer, with cited
> evidence, each of:
> - **SQ-2a** — Does typing `/status` (and/or `/usage`) into a spawned idle
>   session populate `rate_limits` in the statusline payload? Success signal:
>   `capturedAt` in the real `data/claude-ratelimits.json` advancing past
>   spawn start (the statusline is configured user-globally, so a populated
>   payload writes the real file).
> - **SQ-2b** — **Q4/Q5 re-verification under command input:** the prior
>   spike's no-transcript / no-stats-movement findings were proven only for
>   zero-input sessions; typing a command is new territory. A command-only
>   session shall be shown to write no transcript (before/after
>   `~/.claude/projects` diff empty), move no llmdash activity stat, and
>   consume no usage quota (used-percentage not increased on an otherwise
>   idle account).
> - **SQ-2c** — **Trust-boundary review:** the design uses a single persistent
>   dedicated cwd, producing at most one `~/.claude.json` trust entry ever,
>   loudly disclosed. The review weighs that mutation against the
>   never-touch-Claude-configuration boundary; **if the review fails, rung 2
>   fails** regardless of SQ-2a.

> **FR-04** — Spike evidence standards: every verdict shall cite its artifact
> (file path and field, typescript output, before/after diff, command output)
> from real files and real sessions on the target machine. A source that
> yields used-percentage without a truthful capture timestamp, or only one
> window, is a **partial pass to be flagged and decided explicitly** — never
> silently accepted as a full pass.

> **FR-05** — Spike budget and safety caps: rung 1 is read-only (fs reads;
> CLI help/version-style invocations permitted; zero sessions spawned). Rung 2
> is capped at **10 session spawns** and a **~20-minute wall-clock target**;
> the user's live Claude sessions shall be enumerated up front and never
> touched or signaled; spike spawns shall use the intended **production**
> dedicated cwd so at most one trust entry is ever created and it is the
> production one; the prior spike's mechanics (`pipeline/statusline-auto-refresh/spike-report.md`)
> are binding for all spawns; the report shall include a cleanup-verification
> section (no leftover processes, no LaunchAgents, no transcript residue).

> **FR-06** — The spike shall produce
> `pipeline/claude-auto-refresh/spike-report.md` with per-rung verdicts in
> ladder order, cited evidence, the explicit branch decision, and any finding
> later stages must honor. If rung 1 passes, the report shall contain no
> rung-2 spawn activity.

### Reading ingest & integrity — [R1+R2]

> **FR-07 [R1+R2]** — A mechanism-captured reading shall land in the same
> flow the statusline capture uses — the reading `readClaudeLimits()`
> consumes (`rate_limits` shape plus `capturedAt`) — so that gauges, the
> freshness bands, the `stale-reading` diagnostic, snapshot logging, and
> trends all work **unmodified**. This feature feeds the shipped freshness
> surface; it shall not rework it.

> **FR-08 [R1+R2]** — Ingest hygiene per convention: timestamps normalized to
> canonical ISO at ingest; used-percentages clamped to 0–100; malformed or
> partial source data skipped — never a crash, never a fabricated reading,
> never a missing timestamp defaulted to "now".

> **FR-09 [R1+R2]** — A captured reading's `capturedAt` shall be the time the
> underlying evidence was produced (the record's own timestamp, or the
> statusline render time), never the scan/processing time. Old data shall
> never be stamped fresh.

> **FR-10 [R1+R2]** — Newest-`capturedAt`-wins: the mechanism shall never
> replace the current reading with an older one, regardless of write order
> between organic statusline captures and mechanism captures. The reading
> exposed on `/api/state` never moves backwards in `capturedAt` as a result
> of mechanism activity.

### Scheduling & activity gating — [R1+R2]

> **FR-11 [R1+R2]** — Refresh work shall run only on interval-poller ticks —
> never on the HTTP request path, and never on a timer independent of the
> poller.

> **FR-12 [R1+R2]** — Refresh work shall be activity-gated: it runs only when
> there is recent Claude activity (default window: the stale band, 2× the
> refresh threshold; the signal itself is an Architect detail — see OQ-02).
> Observable behavior: while Claude is idle beyond the window, the dashboard
> does **zero** refresh work ([R2]: zero spawns; [R1]: at most constant-time
> staleness/activity checks per tick); while Claude is actively used, the
> worst-case reading age is the refresh threshold plus one poll tick plus
> capture time.

> **FR-13 [R1+R2]** — A reading younger than the refresh threshold shall
> suppress refresh work entirely; organic statusline captures count. As long
> as real sessions keep the reading fresh, the mechanism does nothing.

> **FR-14 [R1+R2]** — At most one refresh attempt shall be in flight at any
> time; a trigger falling due mid-flight is skipped, not queued. Attempt
> starts shall be spaced no closer than the refresh threshold (failure
> backoff lengthens, never shortens, the spacing). A tick after system sleep
> shall trigger at most one attempt — never a catch-up burst — and all age
> arithmetic is wall-clock, so a sleep-spanning reading shows its honest age.

### Failure handling & diagnostics

> **FR-15 [R2]** — Failed refresh attempts shall back off: each consecutive
> failure doubles the wait before the next attempt, from 5 minutes to a
> 60-minute cap; one success resets gating to normal.

> **FR-16 [R1+R2]** — The reserved reason code **`auto-refresh-failing`**
> shall be consumed (not reinvented) on the existing `limitsDiagnostic`
> surface. It fires while the reading is stale or absent **and** the
> mechanism is demonstrably failing:
> - [R2]: 3 or more consecutive refresh failures, carrying a cause category
>   (`spawn-error`, `timeout`, `no-reading-produced`).
> - [R1]: the activity signal shows recent Claude use, yet the mechanism has
>   produced no reading younger than the stale band (the passive source has
>   stopped carrying limit data).
>
> The server determines the reason; the diagnostic coexists with rendered
> gauges (the last capture keeps rendering — flagged, never blanked); the
> copy names the cause and the manual remedy (open a Claude Code CLI
> session).

> **FR-17 [R2]** — The reserved reason code **`auto-refresh-disabled`** shall
> fire when the reading is stale or absent while the off-switch has disabled
> the mechanism. Its copy states that auto-refresh is off, how to re-enable
> it, and the manual remedy. ([R1] ships no switch, so this code remains
> reserved and unused — see FR-27.)

> **FR-18 [R1+R2]** — Exactly one reason code shall be reported at a time,
> with precedence: `auto-refresh-failing` > `auto-refresh-disabled` >
> `stale-reading` (reading present) / `no-statusline-reading` (no reading
> ever — both existing, unchanged). The client maps codes to copy and
> escapes any free-form fields; it never guesses causes.

> **FR-19 [R1+R2]** — First-run honesty: neither `auto-refresh-failing` nor
> `auto-refresh-disabled` shall appear before its condition is actually met.
> Before any mechanism attempt, a fresh install shows the existing
> `no-statusline-reading` state (or no diagnostic while the reading is
> fresh/aging) — never a failure claim about attempts that haven't happened.

> **FR-20 [R1+R2]** — Each distinct failure cause shall be logged to the
> console once — not once per attempt (the existing once-per-cause
> convention).

### Mechanism specifics

> **FR-21 [R1]** — The passive mechanism shall open Claude-owned files
> strictly read-only — never writing, modifying, or deleting anything under
> `~/.claude/` (or wherever the validated source lives) — and its per-tick
> scan shall be incremental (e.g. mtime-gated): unchanged files are not
> re-parsed, and no full transcript-corpus rescan happens per tick.

> **FR-22 [R2]** — The spawn design shall honor the prior spike's mechanics
> as inherited law: clean explicit child env (never inherit
> `CLAUDECODE*`/`ANTHROPIC_*` vars); `node`'s directory from
> `process.execPath` prepended to the child PATH; pty via OS built-ins
> (`script(1)` on macOS) with stdin never a Node pipe or fifo; teardown kills
> `script`'s process group, then verifies the pty-orphaned `claude` process
> exited via SIGHUP, escalating on the claude pid directly if not.

> **FR-23 [R2]** — The only input ever sent to a spawned session shall be the
> spike-validated client-side command keystrokes (`/status` or `/usage`, per
> SQ-2a) and any TUI selection required to issue it. No message shall ever be
> submitted; a mechanism that requires submitting a message shall not ship
> (that is the excluded consent-gated branch).

> **FR-24 [R2]** — All refresh sessions shall run in one fixed, persistent,
> dedicated working directory, producing exactly one `~/.claude.json` trust
> entry ever; the directory and the trust entry shall be disclosed in the
> startup log and README.

> **FR-25 [R2]** — A spawned session shall be terminated promptly once the
> reading is captured. A session producing no reading within the timeout
> (default 30 s, `LLMDASH_CLAUDE_REFRESH_TIMEOUT_MS`) shall be terminated
> cleanly, entire process tree included, and the attempt counted a failure.

> **FR-26 [R2]** — The Claude binary shall come from configuration
> (`LLMDASH_CLAUDE_CMD`, default `claude`), resolved with the existing
> `resolveCommand` rules. An unresolvable command shall produce a failure
> state and diagnostic — never a crash, never an unresolved blind spawn.

> **FR-27** — Off-switch, branch-conditional (no dead knobs):
> - [R2]: enabled by default; `LLMDASH_CLAUDE_AUTOREFRESH` set to `0` or
>   `false` disables it (no other value does). Disabled means zero spawns
>   under any staleness, plus the FR-17 diagnostic when stale.
> - [R1]: **no switch shall ship** — a passive read has nothing to turn off,
>   and an env var that drives nothing is dishonest surface. The
>   `auto-refresh-disabled` code stays reserved.

### Disclosure, health & docs — [R1+R2]

> **FR-28 [R1+R2]** — The startup log shall state the shipped mechanism, its
> cadence stance (activity-gated, naming the threshold), and:
> - [R2]: the exact off-switch env var, plus the dedicated-cwd/trust-entry
>   disclosure.
> - [R1]: that the mechanism is passive and read-only with nothing to switch
>   off.
>
> The existing "readings refresh only when a real Claude Code session renders
> its status line" statement (`freshnessModeLine`) shall be updated to the
> shipped truth — it must not keep printing copy the mechanism has made
> false.

> **FR-29 [R1+R2]** — The startup data-source health readout (`healthLines()`
> in `src/health.js`) shall gain or update a line naming the mechanism's data
> dependency: what it reads (or runs), what's missing when it's missing, why
> that matters, and the fix. Health probes stay cheap fs checks — no
> subprocess, never on the request path.

> **FR-30 [R1+R2]** — The README shall document the shipped mechanism
> prominently, per the surface-defaults convention: what it does, the
> activity-gated cadence and threshold, every env knob with its default
> ([R2]: including the off-switch, binary, timeout, and the trust-entry
> disclosure), and the manual remedy that remains available. No copy shall
> claim a mechanism that didn't ship.

### The honest ending — [F]

> **FR-31 [F]** — DECISIONS.md shall record the refutation with per-rung
> evidence: what was tested, what was observed, and why each rung fails —
> precise enough that a future revival knows exactly what changed conditions
> to look for.

> **FR-32 [F]** — The roadmap's revival avenue shall be closed or narrowed to
> match the findings, and any UI, README, or startup copy the findings prove
> wrong shall be corrected. The dashboard's behavior otherwise stays exactly
> as it is today — no less honest, no more.

> **FR-33 [F]** — The consent-gated minimal-real-prompt option shall be
> surfaced to the user as a named open decision (its usage cost and
> stats-contamination consequences stated), not built, not defaulted, not
> scaffolded.

> **FR-34 [F]** — No mechanism code shall ship: zero new spawn call sites,
> zero new env knobs, and the reserved reason codes remain reserved and
> unused.

---

## Non-Functional Requirements

> **NFR-01 — Resource footprint:** [R1] per-tick work is bounded: cheap fs
> metadata checks, with content parsing only for new or changed files; no
> subprocess. [R2] at most one session at a time; zero spawns per hour while
> idle and at most one per refresh-threshold interval during continuous
> active use (≤ ~12/hour at defaults); no orphaned processes; no persistent
> parked session; per-attempt artifacts trivially small.

> **NFR-02 — Usage integrity [R2]:** Spawned command-probe sessions shall
> consume no plan usage: the account's used-percentage shall not increase as
> a result of refresh sessions (window drainage decreases allowed).

> **NFR-03 — Stats integrity [R1+R2]:** llmdash's Claude activity stats
> (tokens 5h/week/today, cache rate, estimated value, token mix, trends)
> shall be identical with and without the mechanism's artifacts present.
> Readings are never fabricated or interpolated between captures.

> **NFR-04 — Non-interference [R1+R2]:** The user's live Claude sessions are
> never touched or signaled; no focus stealing or visible UI; no modification
> of any Claude Code configuration or data file — with the single [R2]
> exception of the one disclosed trust entry (FR-24). [R1] is strictly
> read-only on Claude-owned files.

> **NFR-05 — Zero dependencies:** No new npm packages in any branch. Pty (if
> any) comes from OS built-ins; everything else is Node builtins. `node-pty`
> is explicitly excluded.

> **NFR-06 — Security posture [R2]:** The spawn is an argument-vector exec of
> an absolutely resolved binary path — never a shell string interpolated from
> configuration. Configuration comes only from local env vars; no
> network-derived input reaches the spawn's arguments or environment.
> Diagnostic detail on `/api/state` stays within the accepted informational
> tailnet posture, and free-form diagnostic fields are escaped client-side.

> **NFR-07 — Request-path isolation [R1+R2]:** `/api/state` latency is
> unaffected: no subprocess and no transcript-content scanning runs per HTTP
> request.

> **NFR-08 — Platform:** macOS is the validation target for everything in
> this PRD ([R2]'s launchd-context findings inherited from the prior spike).
> The design shall not preclude Linux/systemd later, but Linux validation is
> out of scope.

---

## Out of Scope

- **The OAuth/usage-endpoint path — permanently banned** (DECISIONS.md
  2026-06-16). Not a rung, not a fallback, never.
- **The minimal-real-prompt branch as anything shippable.** It exists in [F]
  only as a named consent question for the user; this feature never builds
  it, defaults it, or scaffolds for it.
- Fixing or working around the desktop app's statusline behavior itself.
- Any persistent background Claude session (the ~380 MB parked-idle model is
  ruled out by the user's own requirement).
- Modifying `~/.claude/settings.json` or any Claude Code configuration —
  except the single disclosed [R2] trust entry written by Claude's own trust
  dialog (FR-24), which is the explicitly reviewed boundary exception.
- Codex: its limits already poll live via `codex app-server`.
- The menu-bar badge and limit alerts (separate roadmap items that inherit
  this feature's result).
- Any runtime dependency (`node-pty` explicitly out).
- Redesigning the shipped freshness bands, thresholds, or cues — this
  feature feeds that surface, it does not rework it. No change to
  `LLMDASH_CLAUDE_MAX_AGE_MS` semantics.
- Snapshot/trends schema changes; any new persistence beyond what the
  existing snapshot path already records.
- Linux/systemd validation (design must not preclude it; v1 validates macOS).
- Cleanup or deletion of Claude Code's own files (llmdash never deletes
  another tool's data).

---

## Open Questions

> **OQ-01** — Which rung validates?
> **Default assumption:** none presupposed — the prior spike proved
> assumptions here die on contact with the CLI. The ladder runs in order;
> the first validated rung ships; if both fail, [F] ships as specified. The
> PRD is complete for every outcome, so no re-planning is needed whichever
> way the spike lands.

> **OQ-02** — What is the activity signal for FR-12?
> **Default assumption:** most-recent mtime under `~/.claude/projects`
> (which rung 1 reads anyway), with "recent" = within the stale band
> (2× threshold, 10 m at defaults). The Architect may substitute a cheaper
> or more truthful signal the spike reveals; FR-12's observable behavior
> (zero work when idle, ≤ threshold + tick + capture when active) governs
> regardless.

> **OQ-03 [R2]** — `/status` or `/usage`?
> **Default assumption:** the spike tests `/status` first (the roadmap's
> named avenue), then `/usage`; ship whichever populates `rate_limits` with
> the fewest keystrokes and side effects. If both work, prefer the one whose
> output the statusline captures fastest.

> **OQ-04 [R2]** — Where does the dedicated cwd live?
> **Default assumption:** a clearly named directory under llmdash's own data
> directory (config-derived, created if absent), so the trust entry
> self-documents its owner. Exact path is the Architect's call; FR-24's
> one-entry-ever and disclosure requirements govern.

> **OQ-05 [R1]** — How long after "activity fresh but no new reading" before
> `auto-refresh-failing` fires?
> **Default assumption:** the stale band itself is the grace period — the
> code fires when the reading age exceeds the stale band while activity is
> recent (FR-16), with no additional timer or counter. Simple, and it can
> never fire while the shipped cues still call the reading fresh or aging.

> **OQ-06** — Should mechanism-captured readings be distinguishable from
> statusline captures in stored data?
> **Default assumption:** no — same `claude-code` source, same flow. The
> reading is equally real regardless of which path captured it, and a
> provenance column is schema change (out of scope). If the Architect finds
> a zero-schema way to note provenance in the reading file itself, that is
> permitted but not required.

---

## Success Metrics

Branch column: which build the check applies to. [F] passing = every
untagged row green with zero mechanism machinery present. All rows are
verified on macOS (NFR-08).

| ID | What's Being Verified | Pass Condition |
|---|---|---|
| QA-01 | Spike ladder discipline (FR-01, FR-06) | `pipeline/claude-auto-refresh/spike-report.md` exists with per-rung verdicts in priority order and exactly one explicit branch decision (R1/R2/F); if rung 1 passed, the report contains zero rung-2 spawn activity. |
| QA-02 | Rung-1 evidence (FR-02, FR-04) | Each of SQ-1a/1b/1c has an explicit yes/no citing a concrete artifact (file path + field, or command output); any "yes" shows per-window used% plus a capture timestamp cross-checked against the live statusline reading; partial passes are flagged, not silently accepted. |
| QA-03 | Rung-2 evidence (FR-03, FR-04) | SQ-2a verdict cites `data/claude-ratelimits.json` `capturedAt` advancing past spawn start (pass) or typescript evidence of absence (fail); SQ-2b shows an empty before/after `~/.claude/projects` diff, identical llmdash activity stats, and no used% increase; SQ-2c records the boundary review verdict and at most one trust entry. |
| QA-04 | Spike budget & safety (FR-05) | The report records: rung 1 spawned zero sessions; rung 2 ≤ 10 spawns and wall time vs the ~20 min target; live session PIDs enumerated up front and untouched; cleanup verification (no leftover processes, no LaunchAgents, no transcript residue); any trust entry is the production cwd's. |
| QA-05 | [R1+R2] Feeds the existing surface (FR-07) | A mechanism-captured reading renders through the existing gauges, freshness band, and diagnostics with **no modification** to the freshness layer, and the poller logs it to `usage_snapshots` (deduped) so trends accrue. |
| QA-06 | [R1+R2] Ingest hygiene (FR-08) | Fed malformed/partial source data (garbage record, missing fields, unparseable timestamp): no crash, no reading change, no "now"-stamped timestamp; the prior reading and the server survive intact. |
| QA-07 | [R1+R2] Truthful capture time (FR-09) | A capture whose underlying evidence was produced at time T persists `capturedAt` = T in canonical ISO — not the scan/processing time — verified with a deliberately old source record. |
| QA-08 | [R1+R2] Never regress (FR-10) | With the current reading captured at T2, a mechanism pass over older evidence (T1 < T2) leaves `/api/state`'s `capturedAt` at T2; contrived out-of-order writes never move it backwards. |
| QA-09 | [R1+R2] Poller-only (FR-11, NFR-07) | With a stale reading and the mechanism active, repeated `/api/state` requests trigger zero refresh work (no spawns, no content scans) and latency is unaffected; refresh happens only on poller ticks. |
| QA-10 | [R1+R2] Idle = zero work (FR-12, NFR-01) | With no Claude activity beyond the activity window, an hour of poller ticks performs zero refresh work: [R2] spawn count exactly 0; [R1] no transcript content reads beyond constant-time metadata checks. |
| QA-11 | [R1+R2] Active = fresh (FR-12) | With continuous Claude activity and a stale reading, the reading returns to ≤ threshold age within one tick + capture; across an active hour the observed age never exceeds threshold + one tick + capture time. |
| QA-12 | [R1+R2] Freshness suppression (FR-13) | With organic statusline captures keeping the reading younger than the threshold across an hour of ticks, the mechanism performs zero refresh attempts. |
| QA-13 | [R1+R2] Single flight & spacing (FR-14, NFR-01) | A due trigger during an in-flight attempt starts no second attempt; forced rapid triggers yield attempt starts spaced ≥ the threshold; a simulated sleep-spanning gap fires at most one attempt on the first tick after wake. |
| QA-14 | [R2] Backoff schedule (FR-15) | Under forced consecutive failures, attempt spacing follows 5, 10, 20, 40, 60, 60… minutes; one success returns gating to normal. |
| QA-15 | [R1+R2] Failing diagnostic (FR-16) | [R2]: after 3 consecutive failures with a stale reading, the claude `limitsDiagnostic.reason` is `auto-refresh-failing` with a cause category. [R1]: recent activity + no reading younger than the stale band produces the same code. Both: gauges keep rendering the last capture, and the UI copy names the cause and the manual remedy. |
| QA-16 | [R2] Disabled diagnostic (FR-17, FR-27) | With `LLMDASH_CLAUDE_AUTOREFRESH=0` and a stale reading: zero spawns under any staleness, and `limitsDiagnostic.reason` is `auto-refresh-disabled` with copy naming re-enable and the manual remedy. |
| QA-17 | [R1+R2] Code precedence (FR-18) | Contrived overlaps resolve to exactly one reason code, in order failing > disabled > stale-reading / no-statusline-reading; free-form diagnostic fields render escaped. |
| QA-18 | [R1+R2] First-run honesty (FR-19) | On a fresh install before any attempt or failure condition, the diagnostic is `no-statusline-reading` (or null once a fresh reading exists) — `auto-refresh-failing`/`-disabled` never appear prematurely. |
| QA-19 | [R1+R2] Once-per-cause logging (FR-20) | A persistent failure cause appears in the console exactly once across many failing attempts, not once per attempt. |
| QA-20 | [R1] Read-only, incremental (FR-21) | Inspection finds no write/delete call sites on Claude-owned paths; a test proves unchanged transcript files are not re-parsed on subsequent ticks (parse work observed only for new/changed files). |
| QA-21 | [R2] Inherited spawn mechanics (FR-22) | The spawned child's env contains no inherited `CLAUDECODE*`/`ANTHROPIC_*` vars; its PATH starts with `process.execPath`'s dir; `script(1)` stdin is not a Node pipe; after both success and timeout kills, zero `script`/`claude` processes from the attempt remain. |
| QA-22 | [R2] Command-only input (FR-23) | Session artifacts show only the validated command keystrokes were sent; zero user/assistant messages exist; `~/.claude/projects` is unchanged after refresh cycles. |
| QA-23 | [R2] One cwd, one trust entry (FR-24) | Across many refresh cycles, all sessions run in the single fixed cwd and `~/.claude.json` holds no trust entries beyond the one disclosed entry. |
| QA-24 | [R2] Timeout & teardown (FR-25) | With capture prevented, the session tree is terminated at the timeout and the attempt recorded a failure with its cause; after a success, the tree is gone within a few seconds. |
| QA-25 | [R2] Unresolvable binary (FR-26) | With `LLMDASH_CLAUDE_CMD` pointing at a nonexistent path: the server keeps running, nothing spawns, and the failing diagnostic surfaces with cause `spawn-error`. |
| QA-26 | Off-switch honesty (FR-27) | [R2]: a default start is enabled; `=0` disables with zero spawns. [R1]: `LLMDASH_CLAUDE_AUTOREFRESH` appears nowhere in code or docs (grep clean) — no dead knob ships. |
| QA-27 | [R1+R2] Startup disclosure (FR-28) | The startup log states the mechanism and its activity-gated cadence with the threshold; [R2] also prints the off-switch env var and the cwd/trust-entry disclosure; the old "refresh only when a real session renders its status line" line no longer prints. |
| QA-28 | [R1+R2] Health line (FR-29) | `healthLines()` output includes the mechanism's data dependency with honest present/missing variants naming what's missing, why it matters, and the fix — via cheap fs checks only. |
| QA-29 | [R1+R2] README (FR-30) | The README documents the shipped mechanism, cadence, every env knob with its default, [R2] the trust-entry disclosure, and the manual remedy; no copy claims an unshipped mechanism. |
| QA-30 | [F] Honest ending (FR-31–FR-34) | DECISIONS.md carries the per-rung refutation evidence; the roadmap avenue is closed/narrowed; proven-wrong copy is corrected; the consent-gated option is recorded as a named open decision (not built); grep shows zero new spawn call sites and zero new env knobs; reserved codes remain unused; existing behavior is otherwise unchanged. |
| QA-31 | [R2] No usage consumed (NFR-02) | After ≥ 3 refresh cycles on an otherwise idle account, captured used% for both windows has not increased versus before (drainage decreases allowed). |
| QA-32 | [R1+R2] No stats pollution (NFR-03) | Claude activity stats (tokens 5h/week/today, cache rate, estimated value, token mix, trends) are identical computed with and without the mechanism's artifacts present; no interpolated readings exist between captures. |
| QA-33 | [R1+R2] Live sessions untouched (NFR-04) | With an interactive Claude session open, refresh cycles complete without altering its transcript or state, without focus changes, and it keeps accepting input; no Claude config file changes except [R2]'s single disclosed trust entry. |
| QA-34 | Zero dependencies (NFR-05) | `package.json` declares zero runtime dependencies in the shipped branch; any pty comes from OS built-ins. |
| QA-35 | [R2] Spawn safety (NFR-06) | The spawn is an argument-vector exec of an absolutely resolved path; a binary path containing spaces and shell metacharacters works; no config value is interpolated into a shell string. |
