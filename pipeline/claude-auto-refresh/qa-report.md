# QA Report — Claude Auto-Refresh

**Date:** 2026-07-02
**Test Runner:** node:test (`npm test`)
**Result:** PASSED WITH NOTES
**Shipping branch:** [R2-scrape] — [R1]-only rows are N/A-by-branch, [F] rows N/A; [R1+R2] rows verified in their [R2] form.

## Test Suite Results

**123 tests passing, 0 failing** (run twice: before and after the live QA phase — identical). No retry rounds were needed; no fixes were applied by QA.

## Live integration summary (real machine, macOS)

Real claude probe spawns used: **3 of the 5 budgeted** (one end-to-end success
through the running server's poller, one forced 5-second timeout, one recovery
success), plus one fake-binary spawn (spaces/metacharacters path — never runs
claude) and three probe-free server boots. All servers/pollers ran against
scratch `LLMDASH_DATA_DIR`s; the user's installed copy at `~/llmdash` was read
once, read-only, for the cross-check. Live claude CLI sessions enumerated up
front: **zero existed** (only desktop-app helper processes); nothing was ever
signaled except pids recorded from QA's own spawn trees, by the mechanism's own
teardown.

Decisive numbers:

- **End-to-end capture:** server boot 16:50:10Z → probe → reading written
  `capturedAt 2026-07-02T16:50:17.096Z` (~7 s, one tick + capture). Shape is the
  exact statusline contract. Same-tick rows in scratch `usage_snapshots`
  (five_hour 63%, seven_day 39%). `/api/state` served it; diagnostic `null`.
- **The cross-check:** scraped `seven_day.resets_at = 1783144800` — **exactly**
  the installed copy's authoritative statusline epoch (stale reading from
  04:24Z). Reproduced on the second success (16:53:41Z: 72%/41%, same epochs).
  Used% deltas vs the 12-hour-old reading (10%→39-41% weekly) are coherent with
  the heavy organic use in between (informational, as specified).
- **Pane evidence:** the captured typescript carries
  `Usage: 0 input, 0 output, 0 cache read, 0 cache write` (the probe session's
  own meter), both contract windows, and the Fable promo meter (78%) —
  **present on screen, absent from the reading** (structural exclusion held).
- **Pollution triple:** `~/.claude/history.jsonl` 11 → 12 → 12 → 13 (+1 per
  `/usage` send; the timeout run was killed before typing and added 0).
  `~/.claude.json` trust entries **9 → 9** (still exactly one llmdash entry,
  `~/.llmdash/claude-refresh-cwd`). Zero probe files under `~/.claude/projects`
  — no project dir for the probe cwd exists at all. (30 new files appeared
  during the window from an unrelated organic workflow session under the
  `snowraven` project — none on any probe path.)
- **Stats integrity:** real-config `computeActivity()` before vs after the
  probe cycle: **byte-identical** (`last5h 49,297,935 / week 414,336,564 /
  today 54,581,966` tokens, cache rate 0.9622).
- **Child env (pid 27835):** exactly the allowlist —
  `TERM USER PATH PWD LANG SHLVL HOME LOGNAME _ SCRIPT`; **no `CLAUDECODE*`,
  no `ANTHROPIC_*`**; `PATH` starts with the node dir
  (`~/.nvm/versions/node/v24.18.0/bin`); `PWD=~/.llmdash/claude-refresh-cwd`.
  Process tree observed: `sh → (pipeline | script) → claude`.
- **Teardown:** timeout run tore down in 7.0 s (5 s timeout + 2 s grace),
  typescript unlinked, no reading fabricated; every post-run `ps` sweep found
  **zero** leftover `script`/`claude` processes.

## Acceptance Criteria Verification

| ID | Result | Evidence |
|---|---|---|
| QA-01 | ✓ Pass | `spike-report.md` exists; rung 1 → rung 2 in priority order; exactly one explicit branch decision (**[R2-scrape]**, flagged and decided per FR-04). Rung 1 failed, so rung-2 spawn activity is legitimately present. |
| QA-02 | ✓ Pass | SQ-1a/1b/1c each an explicit **NO** with artifacts (98-file/7378-record field-level corpus scan; `~/.claude` enumeration with the single feature-flag hit quoted; `--help` output for 2.1.198). No rung-1 "yes" existed to cross-check; the rung-2 variant pass is flagged, not silently accepted. |
| QA-03 | ✓ Pass | SQ-2a strict NO cited via the real reading file's mtime pinned at `Jul 1 21:24:22` across both probe windows; variant YES with both windows parsed from two independent captures and the reset-epoch cross-check table (exact agreement). SQ-2b: empty projects diff, stats by construction, usage worded honestly (0-token pane; the idle-account confound named, per FR-04). SQ-2c: trust entries 8→9, single production entry, review verdict recorded with the two disclosed mutations. |
| QA-04 | ✓ Pass | 5/10 spawns, ~13 min rung-2 wall vs ~20 target; rung 1 zero sessions; live pids enumerated up front and untouched; cleanup-verification section (no processes, no LaunchAgents, no transcript residue); the trust entry is the production cwd's. |
| QA-05 | ✓ Pass | Live: probe reading in the exact statusline shape → gauges + freshness + null diagnostic through the **unchanged** freshness layer (existing freshness tests pass untouched); same-tick dedup'd `usage_snapshots` rows (capturedAt 16:50:17.096Z). |
| QA-06 | ✓ Pass | Unit: malformed/partial panes never crash or fabricate (`claude-refresh-parse.test.js`); unparseable `capturedAt` is never written; both-windows-required enforced. |
| QA-07 | ✓ Pass | Unit: payload `capturedAt` = the given evidence moment in canonical ISO (FR-09 test); live captures stamped at pane-capture time. |
| QA-08 | ✓ Pass | Unit: newest-`capturedAt`-wins incl. contrived out-of-order writes (FR-10/QA-08 test). |
| QA-09 | ✓ Pass | Structural: `maybeRefreshClaude`'s only call site is `pollOnce()` (`src/poller.js:24`); the HTTP handler does no refresh work. Live: `/api/state` fetches during stale-reading boots triggered zero spawns (watcher: 0 typescripts, 0 probe processes). |
| QA-10 | ✓ Pass (unit) | Idle ⇒ zero work covered by gate tests; the hour-long real-time observation was **not** run (stated honestly). The gate closing was also observed live: with the activity signal aged past 10 m the verdict was `idle`, zero work. |
| QA-11 | ✓ Pass | Live: stale→fresh in ~7 s (one boot tick + capture). Hour-scale worst-case bound is enforced by the unit-tested gates/spacing rather than observed in real time. |
| QA-12 | ✓ Pass | Live boot with a fresh reading: zero probe work; unit: organic captures suppress attempts. |
| QA-13 | ✓ Pass (unit) | Single-flight, ≥ threshold spacing, sleep-gap-single-attempt tests; `waiting` verdict also observed live inside backoff. |
| QA-14 | ✓ Pass (unit) | 5/10/20/40/60/60-minute schedule test; success-resets observed live (spawn 3 zeroed the failure state). |
| QA-15 | ✓ Pass | Live: 3 **real** failed attempts (real attempt path; unresolvable binary so nothing can spawn; only the clock synthetic to cross backoff spacing) → real `buildState()` → `{reason:"auto-refresh-failing", cause:"spawn-error"}` with age fields, `haveLimits` still true. Render (state B): gauges still filled, stale pill, verbatim cause sentence. [R1] leg N/A-by-branch. |
| QA-16 | ✓ Pass | Live boot: `LLMDASH_CLAUDE_AUTOREFRESH=0` + 47 m-old reading → zero spawns (watched), `auto-refresh-disabled` with ageMs 2823768, verbatim off-note, gauges kept rendering. |
| QA-17 | ✓ Pass (unit) | Precedence failing > disabled > stale/no-reading, exactly one code (`autorefresh-diagnostics.test.js`); every live state observed carried exactly one code; cause crosses as enum, never rendered raw. |
| QA-18 | ✓ Pass | Live state D through the **live default** refresh state: empty data dir + zero attempts → `no-statusline-reading`, no premature failure/disabled codes, no fabricated age. |
| QA-19 | ✓ Pass | Live: `spawn-error` logged exactly **once** across 3 failing attempts; `timeout` once in its run; unit test locks the convention. |
| QA-20 | N/A-by-branch | [R1] only. |
| QA-21 | ✓ Pass | Live env capture of the spawned claude child (above): allowlist only, PATH starts with the node dir; `script(1)` stdin is the sh pipeline (code + `stdio:'ignore'`, tree observed); zero leftover `script`/`claude` after both the success and the forced-timeout runs. |
| QA-22 | ✓ Pass | History +1 per `/usage` send (11→13 across two sends; timeout run +0); zero user/assistant messages (no transcript exists to hold any); `~/.claude/projects` gained no probe files across all cycles. |
| QA-23 | ✓ Pass | All spawns ran in `~/.llmdash/claude-refresh-cwd` (`PWD` evidence); trust entries 9→9 across every run — only the one disclosed entry, ever. |
| QA-24 | ✓ Pass | Timeout at the 5 s clamp floor: attempt recorded `failed`/`timeout`, tree gone in 7.0 s, typescript unlinked; the following normal-timeout attempt succeeded (9.6 s) and reset the failure state. |
| QA-25 | ✓ Pass | Live boot with `LLMDASH_CLAUDE_CMD=/nonexistent/claude`: server stayed up and served, health line named the fix at boot, nothing spawned. Threshold reached via 3 real attempts (method stated in QA-15) → `auto-refresh-failing` cause `spawn-error`. |
| QA-26 | ✓ Pass | [R2]: default boots enabled (startup logs); `=0` disables with zero spawns (live + unit); no-dead-knobs guard test enumerates every shipped env var. |
| QA-27 | ✓ Pass | Startup log states mechanism, activity-gated cadence with thresholds, off-switch, dedicated cwd + trust entry + history.jsonl disclosures; the old manual-only line no longer prints (guard test + observed logs in all three boot variants). |
| QA-28 | ✓ Pass | `healthLines()` Claude-refresh line observed live in all three variants: OK (resolved path printed), disabled, and not-found with the `LLMDASH_CLAUDE_CMD` remedy; cheap fs checks only (`resolveCommand`). |
| QA-29 | ✓ Pass | README documents the mechanism, cadence, all four knobs with defaults, the trust + history disclosures, and the manual remedy; no unshipped-mechanism copy (guard test locks the claims). |
| QA-30 | N/A | [F] did not ship. |
| QA-31 | ✓ Pass (worded as the spike) | No message is ever submitted (by construction; keystrokes are `/usage` + Enter only), and each captured pane shows the probe session's own **0-token** usage line. Account-level used% deltas are **not** claimed as evidence: the account was heavily in organic use throughout QA (five_hour 63%→72% across 3 minutes was organic drain). |
| QA-32 | ✓ Pass | Real-config activity stats byte-identical before/after the probe cycle (numbers above); structurally guaranteed by zero probe files under `~/.claude/projects`, the sole stats source. No interpolated readings exist (file holds only genuine captures). |
| QA-33 | ✓ Pass | Zero live claude CLI sessions existed to disturb (enumerated; noted); the desktop-app-driven session running this QA continued uninterrupted throughout all probes; teardown signals only spawn-recorded pids; no Claude config changes (trust 9→9, settings untouched). |
| QA-34 | ✓ Pass | `package.json` declares **no dependencies key at all**; pty via `/usr/bin/script`; guard test enforces both. |
| QA-35 | ✓ Pass | `RUNNER_SRC` is a fixed constant with config entering as positional argv (code + guard test). Live: a binary at `…/space dir/we ird & (name)/claude` spawned, parsed, and tore down cleanly (2.5 s). |

## Edge Cases Tested

- **Bare-time reset rollover, live:** a pane whose "12:20am" had already passed
  today converted to the *next-day* occurrence (1783063200 = Jul 3 07:20Z) —
  correct next-future semantics.
- **Dropped-character rendering, live:** the real pane rendered "Res ts" (the
  spike saw "Rests"); the tolerant `Res[a-z]*` stem held. (Note: the drop
  landed on the *excluded* Fable line in this capture; both contract lines
  rendered clean.)
- **Fable promo meter live-excluded:** 78% on screen, absent from the reading.
- **Activity gate closing honestly:** with the newest top-level transcript
  aged past 10 m, verdicts went `idle` and zero work happened — observed live.
- **Mechanism parser re-run on the captured typescript** agreed exactly with
  what the probe wrote (same windows, same reset text/zone).

## Known Limitations

1. **Real-browser render pass pending.** All four design states (healthy,
   failing, disabled, first-run) were verified at DOM-string level by running
   the real `public/app.js` in a node VM against real `buildState`/`/api/state`
   payloads — gauge bar widths, pills, and verbatim notes all confirmed. A real
   browser pass (per the chart-regression convention) should follow post-handback.
2. **Hour-scale rows (QA-10/11/12) verified by unit-tested gates, not
   hour-long observation** — single-cycle live behavior confirmed each gate's
   real-world form.
3. **Activity signal granularity:** the gate reads top-level project
   transcripts (`projects/*/*.jsonl`). SDK-driven sessions that write mainly to
   `subagents/` subpaths can look idle sooner than they are (observed during
   QA). Desktop-app and CLI sessions — the feature's target — write top-level
   transcripts continuously, so the shipped behavior is correct for its
   audience; recorded as an observation, not a defect.
4. **Accepted, disclosed residuals:** one `~/.claude/history.jsonl` line per
   refresh; the one-time trust entry.
5. **First-run copy deviation (deliberate):** the `no-statusline-reading` note
   gained the one-clause auto-refresh truth update — design-spec open flag 2
   applied rather than the literal "unchanged" guard; test-locked as "the
   deferred one-clause truth update". Flagged for the Auditor's awareness.
6. **ROADMAP.md / DECISIONS.md not yet updated** for this feature's findings
   (see Convention Flags) — close-out-stage work in this repo's pattern, but it
   must not be dropped: ROADMAP still says auto-refresh "was refuted" and
   carries the now-answered `/status` revival question.

## Convention Flags

- **Spawn-feature QA recipe:** for any feature that spawns another tool, the
  before/after triple (projects listing diff, history.jsonl line count,
  trust-entry count) plus ps ancestry sweeps proved decisive and cheap —
  worth a standing convention.
- **Synthetic clocks vs real mtimes:** driving time-gated code with a fake
  clock while a gate reads real fs mtimes silently flips the gate (observed
  here as spurious `idle`). Convention: when injecting a clock, pin every
  time-derived input to the same clock.
- **Close-out obligations from the spike must land:** answer the roadmap's
  `/status` question (NO, with evidence), correct ROADMAP's "auto-refresh was
  refuted" copy, and record in DECISIONS.md the [R2-scrape] decision, the two
  ratified Claude-file mutations, and the Fable third-meter finding as a
  possible future source-aware addition.

---

## Addendum — real-browser render pass (Orchestrator, 2026-07-02)

The pending real-browser check is closed. A dev server (port 8899, dev data
dir, mechanism enabled) was driven in a real browser:

- On first tick with no reading present, the probe fired and a live capture
  landed in `data/claude-ratelimits.json` within ~10 s of server start
  (5h 84% used / weekly 43%, resets 1783012800 / 1783144800).
- The page rendered the mechanism-captured reading through the unmodified
  surface: "updated 43s ago" freshness age, both gauges with bars and reset
  countdowns ("resets in 19m" / "1d 12h"), both pacing predictors, and the
  cross-tool headroom strip ("Claude Code is low on its 5-hour (16%) → switch
  to Codex") — all from the scraped reading. No aging/stale pill and no
  diagnostic note (fresh reading: silence is health, State A verified live).
- Zero browser console warnings or errors. Startup log carried the full
  FR-28 disclosure (mechanism, cadence, off-switch, trust + history notes).

RESULT stands: **PASSED WITH NOTES** — the render note is now resolved; the
remaining notes are the close-out items for the Chronicler and the launchd
probe after deploy.
