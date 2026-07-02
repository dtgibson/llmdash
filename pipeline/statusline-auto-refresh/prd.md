# PRD — Statusline Auto-Refresh
**Feature:** statusline-auto-refresh
**Date:** 2026-07-01
**Stage:** 2 — The Planner
**Source:** strategic-brief.md (approved)

---

## Feature Overview

llmdash keeps its Claude limit gauges current on desktop-app-only days by
spawning a short-lived, prompt-free Claude Code CLI session in a pseudo-terminal
whenever the captured statusline reading goes stale — paired with a reading-age
cue on the Claude gauges so a stale reading is never mistaken for a current one.
The spawn mechanism ships only if the Stage 3 spike validates it from a
launchd/background context; the reading-age cue and an honest manual-refresh
nudge ship either way.

### The two branches

The approved brief makes the spike a gate, so this PRD specifies both outcomes
as first-class deliverables:

- **Branch A (spike passes):** everything in this document.
- **Branch B (spike fails):** everything in this document **except** the
  requirements tagged **[A]**. Branch B is a strict subset — the reading-age
  cue, the `stale-reading` diagnostic, the manual-refresh nudge, and the honest
  startup/README statements stand alone and are written below without any
  dependency on the spawn mechanism.

Every requirement is tagged **[A]** (ships only if the spike passes) or
**[A+B]** (ships in both branches). "Claude" throughout means the
`claude-code` source only; Codex is untouched (its limits already poll live).

### Defaults at a glance (decided here, tunable by env)

| Knob | Default | Env var | One-line justification |
|---|---|---|---|
| Refresh threshold (reading age that triggers a spawn) | 5 minutes | `LLMDASH_CLAUDE_MAX_AGE_MS` | User decision at design review: a heavy session can burn the 5-hour window in under an hour, so a reading more than minutes old is already suspect. |
| Stale band (UI flags the reading "stale") | 10 minutes (2× the refresh threshold, derived) | derived from `LLMDASH_CLAUDE_MAX_AGE_MS` | At heavy burn a 10-minute-old reading can be materially wrong; one knob keeps the cue and the mechanism consistent. |
| Spawn timeout | 30 seconds | `LLMDASH_CLAUDE_REFRESH_TIMEOUT_MS` | Live observation shows a reading lands within seconds; 30 s is generous without letting a hung session linger. |
| Failure backoff | 5 min doubling to a 60 min cap; surfaced after 3 consecutive failures | none (constants) | Never hammers a failing spawn; a persistent failure is visible within ~35 minutes. |
| Auto-refresh switch | On | `LLMDASH_CLAUDE_AUTOREFRESH=0` disables | On by default per the brief — opt-in would leave gauges stale on exactly the days the feature exists for. |
| Claude Code binary | `claude` | `LLMDASH_CLAUDE_CMD` | Mirrors the `LLMDASH_CODEX_CMD` precedent; launchd's minimal PATH makes an absolute path necessary in practice. |

---

## User Stories

> **US-01** — As a desktop-app-only Claude user, I want the dashboard's Claude
> gauges to stay current without me opening a CLI session, so that the number I
> glance at actually reflects my headroom right now.

> **US-02** — As a dashboard user, I want to see plainly how old the Claude
> limit reading is, so that I never make a pacing decision on stale data
> without knowing it.

> **US-03** — As the owner of this machine, I want auto-refresh on by default
> but loudly disclosed and switchable off with an env var, so that llmdash
> never silently runs my Claude Code binary in a way I can't see or stop.

> **US-04** — As a dashboard user whose auto-refresh is off or failing, I want
> the dashboard to say so and name the remedy ("open a Claude Code CLI session
> to refresh"), so that staleness is never silent.

> **US-05** — As a Claude Code user, I want the spawned refresh sessions to be
> invisible in effect — no prompt sent, no usage consumed, no distortion of my
> activity stats, no disturbance of my live sessions — so that the dashboard
> observes my usage without changing it.

> **US-06** — As a user on a setup where spawning can't work (spike failed, or
> a not-yet-validated platform), I want the reading-age cue and the manual
> nudge anyway, so that the feature still delivers honesty even without
> automation.

---

## Functional Requirements

### Refresh mechanism

> **FR-01 [A]** — When a refresh is due (per FR-07/FR-08), the app shall start
> exactly one short-lived Claude Code CLI session attached to a
> pseudo-terminal, using OS built-ins only (e.g. macOS `script(1)`), and shall
> send it no prompt and no input that submits a message.

> **FR-02 [A]** — A refresh attempt shall count as successful only when a new
> statusline reading is captured — the captured reading's `capturedAt` (in
> `data/claude-ratelimits.json`) is newer than the attempt's start time. Any
> other outcome (spawn error, timeout, session exit without a new reading) is
> a failure.

> **FR-03 [A]** — The spawned session shall be terminated promptly once the
> reading is captured. A session that produces no reading within the timeout
> (default 30 s, `LLMDASH_CLAUDE_REFRESH_TIMEOUT_MS`) shall be terminated
> cleanly, including its entire process tree, and the attempt counted as a
> failure.

> **FR-04 [A]** — At most one refresh session shall exist at any time. A
> refresh falling due while one is in flight shall be skipped, not queued.

> **FR-05 [A]** — The Claude Code binary shall come from configuration
> (`LLMDASH_CLAUDE_CMD`, default `claude`) and be resolved with the same rules
> as the existing command resolver (`resolveCommand` in `src/health.js`). An
> unresolvable command shall produce a failure state and diagnostic — never a
> crash and never an unresolved blind spawn.

> **FR-06 [A]** — Spawned sessions shall be headless and identifiable: no
> visible window, no focus change, and any session artifacts they create shall
> be attributable to auto-refresh (e.g. by running in a dedicated working
> directory), so that their absence of usage is independently verifiable.

### Staleness gating

> **FR-07 [A]** — The staleness check shall run only on the interval poller
> tick. The app shall never spawn a session on the HTTP request path, and
> never on a timer independent of reading age.

> **FR-08 [A]** — A refresh shall be triggered only when no reading exists or
> the current reading's age (from `capturedAt`) exceeds the refresh threshold
> (default 5 minutes, `LLMDASH_CLAUDE_MAX_AGE_MS`). When healthy, the
> worst-case reading age is therefore the threshold plus one poll tick plus
> capture time.

> **FR-09 [A]** — Organic statusline activity shall suppress spawning: as long
> as real Claude Code sessions keep the reading younger than the threshold,
> zero refresh sessions are spawned.

> **FR-10 [A]** — Failed attempts shall back off: each consecutive failure
> doubles the wait before the next attempt, starting at 5 minutes and capped
> at 60 minutes; one success resets gating to normal. After 3 consecutive
> failures the failing state shall surface as a diagnostic (FR-21), and each
> distinct failure cause shall be logged to the console once — not once per
> attempt (matching the `src/codex-limits.js` once-per-cause convention).

### Config & surfacing

> **FR-11 [A]** — Auto-refresh shall be enabled by default and disabled when
> `LLMDASH_CLAUDE_AUTOREFRESH` is set to `0` or `false`. No other value shall
> disable it.

> **FR-12 [A+B]** — The startup log shall state the refresh mode in effect:
> - Branch A, enabled: that llmdash will spawn a brief Claude Code session
>   when the reading is older than the threshold (naming the threshold), and
>   the exact off-switch env var.
> - Branch A, disabled: that auto-refresh is off, how to re-enable it, and the
>   manual remedy.
> - Branch B: that Claude readings refresh only when a real Claude Code
>   session renders its statusline.

> **FR-13 [A+B]** — The startup data-source health readout (`healthLines` in
> `src/health.js`) shall include the Claude reading's age and the auto-refresh
> state (branch A) or the manual-refresh reality (branch B).

> **FR-14 [A+B]** — The README shall document the feature prominently, per the
> surface-defaults convention: that llmdash starts brief Claude Code sessions
> automatically (branch A — a surprise-factor behavior, stated loudly), the
> default state, the threshold/cadence, every env knob with its default, and
> the manual remedy. In branch B it documents the manual-refresh reality and
> the reading-age cue instead.

### UI reading-age cue

> **FR-15 [A+B]** — The Claude tool block shall display the reading's age in
> plain terms (e.g. "updated 12m ago") whenever a reading exists, derived from
> the existing `capturedAt` plumbing.

> **FR-16 [A+B]** — The age display shall have three bands:
> - **Fresh** (age ≤ refresh threshold, default ≤ 5 m): plain age, no flag.
> - **Aging** (threshold to 2× threshold, default 5–10 m): visually distinct
>   from fresh; does not say "stale".
> - **Stale** (> 2× threshold, default > 10 m): flagged with the word "stale"
>   in text plus distinct styling.

> **FR-17 [A+B]** — A stale reading shall never render unmarked. The stale
> flag appears regardless of branch and regardless of why refresh isn't
> happening.

> **FR-18 [A+B]** — When the reading is stale or absent and no working
> auto-refresh path exists (disabled, failing, or branch B), the Claude block
> shall show a nudge naming the remedy: open a Claude Code CLI session to
> refresh the reading.

### Diagnostics & fallback

> **FR-19 [A+B]** — The `limitsDiagnostic` pattern shall extend to fire when a
> Claude reading exists but is stale (today it fires only when no reading
> exists). As now, the server determines the reason; the client only maps
> reason codes to copy.

> **FR-20 [A+B]** — New reason code **`stale-reading`**: reading present but
> older than the stale band with no working refresh path. Its copy states the
> reading's age and the manual remedy.

> **FR-21 [A]** — Two further reason codes:
> - **`auto-refresh-disabled`** — reading stale or absent while auto-refresh
>   is disabled by env; copy says it's off, how to re-enable, and the manual
>   remedy.
> - **`auto-refresh-failing`** — 3 or more consecutive refresh failures; the
>   diagnostic carries a cause category (`spawn-error`, `timeout`,
>   `no-reading-produced`) and its copy names the cause and the manual remedy.
>   The `no-reading-produced` copy points at statusline configuration
>   (`scripts/statusline.js`) as the likely cause.

> **FR-22 [A+B]** — Exactly one reason code shall be reported at a time, with
> precedence: `auto-refresh-failing` > `auto-refresh-disabled` >
> `stale-reading` (reading present) / `no-statusline-reading` (no reading
> ever, existing code, unchanged).

> **FR-23 [A+B]** — On platforms where the mechanism has not been validated
> (v1: anything other than the macOS/launchd target) and in branch B, the app
> shall behave as the fallback: no spawn code path active, reason codes
> limited to `no-statusline-reading` / `stale-reading`, nudge per FR-18. The
> design shall not preclude enabling the mechanism on Linux/systemd later.

---

## Non-Functional Requirements

> **NFR-01 — Resource footprint:** At defaults, the mechanism shall spawn at
> most one session at a time and no more than ~4–5 sessions per hour
> (worst-case fully-idle machine); timeout kills shall leave no orphaned
> processes; per-attempt artifacts shall be trivially small (message-free
> session files).

> **NFR-02 — Usage integrity:** Spawned sessions shall consume no plan usage:
> no prompt is sent, and the account's used percentage shall not increase as a
> result of refresh sessions.

> **NFR-03 — Stats integrity:** The dashboard's own Claude activity stats
> (tokens 5h/week/today, cache hit rate, estimated value, token mix, trends)
> shall be identical whether or not refresh-session artifacts exist in the
> logs. Never fabricate or interpolate readings between captures.

> **NFR-04 — Non-interference:** Refresh sessions shall not disturb the user's
> normal Claude Code use: no focus stealing or visible UI, no modification of
> `~/.claude/settings.json` or any Claude Code configuration, and no effect on
> a concurrently running interactive session's state, transcript, or
> responsiveness.

> **NFR-05 — Zero dependencies:** No new npm packages. The pseudo-terminal
> comes from OS built-ins (macOS `script(1)` for v1); everything else is Node
> builtins. `node-pty` is explicitly excluded.

> **NFR-06 — Security posture:** The spawn shall execute an
> absolutely-resolved binary path with an argument vector — never a shell
> string interpolated from configuration. Configuration comes only from local
> env vars (single-user threat model, consistent with `LLMDASH_CODEX_CMD`);
> no network-derived input shall reach the spawn's arguments or environment.
> Diagnostic detail exposed on `/api/state` stays within the accepted
> informational tailnet posture established by the Codex diagnostic.

> **NFR-07 — Request-path isolation:** `/api/state` latency shall be
> unaffected; no subprocess work runs per HTTP request (existing convention,
> restated because this feature adds a subprocess).

> **NFR-08 — Accessibility of the cue:** Staleness shall be conveyed in text
> (the word "stale"), never by color or styling alone.

---

## Out of Scope

- Fixing or working around the desktop app's statusline behavior itself.
- Modifying `~/.claude/settings.json` or any Claude Code configuration
  (including auto-configuring the statusline).
- Any OAuth-token or usage-endpoint use — permanently banned (DECISIONS.md,
  2026-06-16). The statusline remains the only sanctioned tap.
- Codex: its limits poll live via `codex app-server`; no auto-refresh, and no
  retrofit of the three-band staleness treatment to Codex in this feature.
- Any runtime dependency (`node-pty` explicitly out).
- Limit alerts and the menu-bar/tray badge (separate roadmap items this
  feature feeds).
- Linux/systemd validation of the spawn mechanism (v1 validates macOS/launchd
  only; Linux gets branch-B behavior until separately validated).
- Interpolating, estimating, or backfilling readings between captures; any
  snapshot-schema or trends-schema change.
- Cleanup/deletion of Claude Code's own session files (llmdash never deletes
  another tool's data).

---

## Open Questions

> **OQ-01** — Does a prompt-free CLI session under a pty render the statusline
> (with `rate_limits`) from a launchd/background context — keychain access,
> render timing, clean exit? This is the spike's core question.
> **Default assumption:** yes, within seconds (matches the live observation
> from an interactive terminal). If no, branch B ships as specified.

> **OQ-02** — Do message-free refresh sessions clutter the user's session
> pickers (e.g. `claude --resume`), and is that acceptable?
> **Default assumption:** acceptable for v1 provided sessions are message-free
> and contained in a dedicated working directory (FR-06). The spike checks;
> if the clutter is material, the Architect adds a mitigation to the design.

> **OQ-03** — Are the refresh / stale-band defaults right?
> **Resolved at design review (2026-07-01):** the user set 5 m (aging) / 10 m
> (stale, 2× derived) — a heavy session can burn the 5-hour window in under
> an hour, so the original 15 m / 60 m read too generous.

> **OQ-04** — May the `no-reading-produced` diagnostic inspect
> `~/.claude/settings.json` read-only to say specifically "statusline not
> configured"?
> **Default assumption:** no reads in v1 — the generic copy names statusline
> configuration as the likely cause (FR-21). A read-only check is Architect's
> discretion if the spike makes it trivial and safe.

> **OQ-05** — Termination method: graceful exit sequence to the pty, SIGTERM
> to the wrapper, or hard kill of the tree?
> **Default assumption:** attempt graceful termination first, escalate to kill
> on a short grace timeout. The spike must confirm that killing a session
> mid-render leaves no corrupted Claude Code state.

---

## Success Metrics

Branch column: which build the check applies to (A = spike passed, B =
fallback, A+B = both). Branch B passing = every A+B row green with zero [A]
machinery present.

| ID | What's Being Verified | Pass Condition |
|---|---|---|
| QA-01 | [A] Staleness-gated refresh end to end (FR-01, FR-02, FR-08) | With auto-refresh on and the reading absent or older than 5 m, the next poller tick starts exactly one Claude session; `data/claude-ratelimits.json` gains a `capturedAt` newer than the attempt start within 30 s; the dashboard shows the new reading on its next refresh. |
| QA-02 | [A] Session teardown after success (FR-03) | After the reading is captured, the spawned session and its whole process tree are gone within a few seconds — no `claude` or wrapper processes from the attempt remain. |
| QA-03 | [A] No prompt sent (FR-01) | The spawned session's transcript/log contains zero user messages and zero assistant messages. |
| QA-04 | [A] Timeout kill (FR-03) | With capture prevented (test env without a statusline), the session is terminated at 30 s, no processes remain, and the attempt is recorded as a failure with cause `no-reading-produced`. |
| QA-05 | [A] Single flight (FR-04) | While one refresh session is in flight, a due tick starts no second session; at no point do two refresh sessions coexist. |
| QA-06 | [A] Unresolvable command (FR-05) | With `LLMDASH_CLAUDE_CMD` pointing at a nonexistent path, the server keeps running, nothing spawns, and the failing diagnostic surfaces with cause `spawn-error` (per QA-12). |
| QA-07 | [A] Headless and identifiable (FR-06) | A refresh spawn causes no visible window or focus change, and all session artifacts it creates are attributable to auto-refresh (e.g. land under the dedicated working directory). |
| QA-08 | [A] Poller-only trigger (FR-07) | With a stale reading and auto-refresh on, repeated `/api/state` requests spawn nothing; the spawn occurs only on a poller tick. |
| QA-09 | [A] Organic activity suppresses spawning (FR-08, FR-09) | With organic statusline writes keeping the reading younger than 5 m across an hour of ticks, the spawn count is exactly 0. |
| QA-10 | [A] Backoff schedule (FR-10) | Under forced consecutive failures, attempt spacing follows 5, 10, 20, 40, 60, 60… minutes; a single success returns gating to normal threshold behavior. |
| QA-11 | [A] Off-switch (FR-11, FR-21) | With `LLMDASH_CLAUDE_AUTOREFRESH=0`: zero spawns under any staleness; the startup log states it's off and how to re-enable; a stale reading carries reason `auto-refresh-disabled` with the manual remedy in the UI copy. |
| QA-12 | [A] Failing diagnostic (FR-10, FR-21) | After 3 consecutive failures, `/api/state`'s Claude `limitsDiagnostic.reason` is `auto-refresh-failing` with a cause category; the rendered UI names the cause and the "open a Claude Code CLI session" remedy; the console logged that cause once, not once per attempt. |
| QA-13 | [A] Startup log, enabled mode (FR-11, FR-12) | A default start prints: auto-refresh on, the 5 m threshold, and the exact off-switch env var name. |
| QA-14 | [A+B] Health readout (FR-13) | `healthLines` output includes the Claude reading's age and the refresh state — auto-refresh mode in branch A, the manual-refresh reality in branch B. |
| QA-15 | [A+B] README (FR-14) | The README prominently documents the behavior for the shipped branch: branch A — auto-spawning stated loudly, default on, threshold, every env knob with default, manual remedy; branch B — manual-refresh reality and the reading-age cue. |
| QA-16 | [A+B] Fresh band (FR-15, FR-16) | With a reading aged ≤ 5 m, the Claude block shows a plain "…m ago" age with no stale flag and no warning styling. |
| QA-17 | [A+B] Aging band (FR-16) | With a reading aged between 5 m and 10 m, the age display is visibly distinct from the fresh state and does not contain the word "stale". |
| QA-18 | [A+B] Stale band (FR-16, FR-17) | With a reading aged over 10 m, the word "stale" appears in the Claude block's rendered text plus distinct styling — verified in a real browser render, not just the API payload. |
| QA-19 | [A+B] Nudge when no refresh path (FR-18) | A stale or absent reading with refresh disabled, failing, or absent (branch B) renders copy naming the remedy: open a Claude Code CLI session to refresh. |
| QA-20 | [A+B] `stale-reading` code (FR-19, FR-20) | With a reading > 10 m old and no A-branch code taking precedence, `/api/state` carries reason `stale-reading` and the UI copy states the age and the remedy. |
| QA-21 | [A+B] Code precedence (FR-22) | Exactly one reason code is reported at a time; contrived overlaps resolve as failing > disabled > stale-reading / no-statusline-reading. |
| QA-22 | [A] No usage consumed (NFR-02) | After at least 3 refresh cycles on an otherwise idle account, the captured `used_percentage` for both windows has not increased versus before the cycles (decreases from window drainage allowed). |
| QA-23 | [A] No stats pollution (NFR-03) | Claude activity numbers (tokens 5h/week/today, cache rate, estimated value, token mix) are identical computed with and without the refresh sessions' artifacts present, and spawned transcripts contain zero token-usage entries. |
| QA-24 | [B] Fallback ships standalone (FR-23) | Built on branch B: zero Claude spawns occur under any staleness; the startup log states readings refresh only via real CLI sessions; QA-14 through QA-21 all pass unchanged. |
| QA-25 | [B] Fresh-install honesty preserved (FR-23) | With no reading ever captured, branch B shows the existing `no-statusline-reading` empty state with the nudge; no fabricated age or reading appears. |
| QA-26 | [A] Non-interference with a live session (NFR-04) | With an interactive Claude Code session open, a refresh spawn completes without altering that session's transcript or state files, without stealing focus, and the interactive session keeps accepting input normally. |
| QA-27 | [A+B] Zero dependencies (NFR-05) | `package.json` still declares zero runtime dependencies; the pty mechanism uses OS built-ins only. |
| QA-28 | [A] Spawn safety (NFR-06) | The spawn is an argument-vector exec of an absolutely-resolved path; no config value is interpolated into a shell string — verified by inspection and by a test with a binary path containing spaces and shell metacharacters. |
