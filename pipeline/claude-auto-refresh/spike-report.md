# Spike Report — claude-auto-refresh
**Feature:** claude-auto-refresh
**Date:** 2026-07-02
**Stage:** 3 — The Architect
**Machine:** macOS (darwin 25.5.0), Claude Code CLI 2.1.198 at `/Users/developer/.local/bin/claude`
**Spike budget:** rung 1: zero sessions (fs reads + help invocations only, as capped). Rung 2: **5 claude spawns used (cap 10)**, rung-2 wall ~13 min from 06:37:01Z start including the parser proof (target ~20 min).
**Provenance note:** the spike itself ran to completion in one session; the write-up was reconstructed afterwards from the preserved evidence artifacts after the original session crashed before writing its report. Decisive evidence is therefore quoted inline (the raw artifacts lived in a session-temporary scratchpad); the two `/usage` pty captures are preserved as Engineer fixtures (see *Findings later stages must honor*, item 9).

---

## BRANCH DECISION: **[R2-scrape]** — a flagged, explicitly-decided variant pass (FR-04).

**SQ-2a as literally specified FAILS**: neither `/status` nor `/usage` ever populates
`rate_limits` in the statusline payload — the real `claude-ratelimits.json` never
advanced during any probe. The roadmap's named revival avenue ("does `/status`
populate `rate_limits`?") is now answered: **no**. But `/usage` **renders fresh,
both-window, account-wide limit data on screen** in a spawned, zero-usage,
transcript-free session, and that pane parses cleanly into a
`rate_limits`-equivalent reading whose reset instants match the authoritative
statusline epochs **exactly**. The shipping mechanism is therefore a **`/usage`
screen-scrape**: spawn → send `/usage` → capture the pty typescript → parse →
write the same reading file the statusline writes.

Why this variant pass is accepted rather than rejected: FR-02/FR-03's success
signal is "per-window used-percentage plus a usable capture timestamp,
cross-checked for agreement against the current statusline-captured reading."
The scrape delivers all three (both windows, capture-time stamp, exact reset
agreement). What it does *not* deliver is the statusline transport — which was
the *assumed* transport, not the requirement. Flagged per FR-04, decided here:
**[R2-scrape] proceeds; [R1] and [F] do not ship.**

---

## Rung 1 — passive local sources: **FAIL** (all three sub-questions NO)

### SQ-1a — rate-limit fields in transcript JSONL: **NO**
A field-level scan of the real corpus under `~/.claude/projects` (the machine's
actual desktop-app + CLI transcripts, including records written minutes before
the scan):

> scanned 98 files, 7378 records (0 unparseable lines)
> NO matching key paths anywhere in the corpus.

The scanner walked every key path in every record looking for
rate-limit-shaped names (`rate_limit*`, `used_percentage`, `resets_at`,
`five_hour`, `seven_day`, usage-limit variants). Transcripts carry
`message.usage` token counts but no limit-window data. Desktop-app sessions
produce the same shape.

### SQ-1b — any other local Claude Code state file: **NO**
Enumerated `~/.claude/` (backups, cache, downloads, history.jsonl,
mcp-needs-auth-cache.json, plugins, projects, session-env, sessions,
settings.json[.bak], shell-snapshots, telemetry) plus `~/.claude.json`, and
scanned every readable candidate file for limit-like keys
(`rate_limit|used_percent|resets_at|five_hour|seven_day|usage_limit`,
case-insensitive). One hit in `~/.claude.json`:

> "tengu_c4w_usage_limit_notifications_enabled": true

— a feature-flag *name*, not limit data. Every other candidate: no limit keys.
(Re-verified with a fresh scan at write-up time; same result.)

### SQ-1c — a machine-readable CLI usage command: **NO**
`claude --help` (2.1.198) lists no `usage`/`status` subcommand — the only
"usage" match in the help text is the `Usage: claude [options] [command]`
synopsis line. Plausible non-session surfaces checked via help/JSON output
only (e.g. `claude auth status` returns `{loggedIn, authMethod, apiProvider}` —
no usage data). `/usage` and `/usage-credits` exist only as in-TUI slash
commands, which require a session (that is rung 2).

**Rung-1 verdict: there is no passive local source. Rung 2 was required.**

---

## Rung 2 — client-side-command probe in a spawned idle session

### Method (inherited law honored)
All spawns ran through a runner implementing the prior spike's validated
mechanics (`pipeline/statusline-auto-refresh/spike-report.md`):

- **cwd:** `~/.llmdash/claude-refresh-cwd` — the intended **production**
  dedicated directory (FR-05: the one-trust-entry budget is spent on the real
  path). Deliberately install-independent (under `~/.llmdash/`, outside both
  the dev repo and `~/llmdash`), so dev and installed copies share one trust
  entry forever.
- **env:** `env -i` with explicit `PATH` (node's dir prepended, plus system
  dirs and `~/.local/bin`), `HOME`, `USER`, `LOGNAME`, `TERM=xterm-256color`,
  `LANG` — never inheriting the parent's `CLAUDECODE*`/`ANTHROPIC_*` vars.
- **pty:** `/usr/bin/script -q -t 0 <typescript> <abs-claude-path>`, keystrokes
  delivered through a **real shell pipeline** (printf/sleep fragments), never a
  Node stdio pipe or fifo (the macOS socketpair failure mode).
- **teardown:** TERM to the pipeline's own process group (`set -m`), 2 s grace,
  then verify the pty-orphaned `claude` pid followed via SIGHUP, with direct
  TERM→KILL escalation armed. Each spawn's teardown echoed
  `leftover-script='' leftover-claude=''`.

Five spawns: `trust` (accept the one-time workspace-trust dialog),
`status1` + `usagetab` (the `/status` → Usage-tab attempt), `usagecmd` +
`usagefull` (the `/usage` command, captured twice independently).

### SQ-2a strict (statusline payload) — **NO**, for both commands
A watcher polled the real installed reading file
(`/Users/developer/llmdash/data/claude-ratelimits.json`) every 2 s during every
probe. Its mtime stayed pinned at `Jul 1 21:24:22 2026` (= the stale capture
`2026-07-02T04:24:22.238Z`) across the `/status` window (06:40:56–06:41:35Z)
and the `/usage` window (06:42:22–06:43:05Z). `capturedAt` never advanced ⇒
client-side commands do **not** cause a statusline `rate_limits` render.
(Secondary dead end, for the record: `/status`'s Usage tab could not even be
reached reliably by arrow-key navigation — the arrows landed in the Config
pane.)

### SQ-2a variant (on-screen render) — **YES**: `/usage` renders both windows, and they parse
The `/usage` pane (de-ANSI'd from the raw typescript; the pty rendering drops
characters under cursor-positioned layout, e.g. "Resets" → "Rests"):

> Current session  ██████████████▌ **77% used**   Resets **12:20am** (America/Los_Angeles)
> Current week (all models) ████▌ **25% used**   Resets **Jul 3 at 11pm** (America/Los_Angeles)
> Current week (Fable) ████████▌ **49% used**   Rests **Jul 3 at 11pm** (America/Los_Angeles)
> Usage: 0 input, 0 output, 0 cache read, 0 cache write   ← the probe session's own token count

A ~40-line proof-of-concept parser (de-ANSI → label-anchored tolerant regex →
clamp) extracted both windows from **both independent captures**:
`{five_hour: 77% "12:20am", seven_day: 25% "Jul 3 at 11pm"}` and
`{five_hour: 76%, seven_day: 25%}` — `parse ok: true` on each (the 77→76 delta
is the live window draining between captures).

**The decisive cross-check.** The stale statusline reading held
`five_hour.resets_at = 1782976800` and `seven_day.resets_at = 1783144800`:

| Window | Statusline epoch | = UTC | = America/Los_Angeles | /usage pane says |
|---|---|---|---|---|
| five_hour | 1782976800 | 2026-07-02T07:20Z | 12:20am | "Resets 12:20am" ✓ |
| seven_day | 1783144800 | 2026-07-04T06:00Z | Jul 3, 11:00pm | "Resets Jul 3 at 11pm" ✓ |

Exact agreement on both reset instants ⇒ the scraped meters are the **same
account-wide data** the statusline reports. Only used% differs (77% live vs 3%
stale; 25% vs 10%) — which is precisely the freshness gap this feature exists
to close.

**Three-window discovery.** `/usage` shows a third meter — *Current week
(Fable)*, 49% — a per-model promotional weekly cap that does not exist in the
statusline `rate_limits` shape. Mapping rule for the mechanism:
`five_hour` ← "Current session"; `seven_day` ← "Current week (all models)"
(same reset instant as the statusline's `seven_day`; the plan-wide meter). The
Fable meter is **not** part of the reading (the dashboard's Claude source is a
two-window contract); recorded as a roadmap-worthy finding, not silently
scraped. The pane also contains a "What's contributing to your limits usage?"
local-analysis section — deliberately not scraped (the 2026-06-16 "don't
reproduce /usage's insights" decision stands).

### SQ-2b (pollution re-verification under command input) — **PASS**, with one new side effect
- **No transcript:** the before/after listing of `~/.claude/projects`
  (mtime + path for every file) shows **zero new files and zero new
  directories** across all five spawns. The only diff lines are mtime advances
  on two *pre-existing* transcripts belonging to live sessions doing organic
  work at the time. A command-only session, like a zero-input session, writes
  no transcript.
- **No stats movement:** llmdash's `src/stats.js` derives activity exclusively
  from `~/.claude/projects/**/*.jsonl` records carrying `message.usage`; no new
  transcripts ⇒ provably zero stat movement (NFR-03 holds).
- **No usage consumed:** the probe session's own usage meter read
  **"0 input, 0 output, 0 cache read, 0 cache write"** in the captured pane,
  and no message was ever submitted (slash commands are client-side). The
  PRD's idle-account used% check was confounded — the account was actively in
  use by the user's real sessions throughout the spike — so the honest evidence
  is the by-construction argument plus the session's own zero token count,
  stated here explicitly rather than over-claimed.
- **NEW side effect the prior spike never saw:** typing a slash command appends
  to `~/.claude/history.jsonl` — 7 lines before the spike, 11 after (4 appends
  across the command-sending spawns). llmdash never reads that file and it
  moves no stat, but it is a **second Claude-owned-file mutation** beyond the
  trust entry, and in production it accrues ~1 line per refresh (bounded by the
  activity gate, but unbounded over months). It joins the trust entry in the
  disclosure surface and the boundary review below.

### SQ-2c (trust-boundary review) — **PASS with disclosure obligations**
Evidence: `~/.claude.json` project (trust) entries went **8 → 9**; the single
addition is `/Users/developer/.llmdash/claude-refresh-cwd`, created by Claude
Code's own dialog after the runner answered it once:

> Accessing workspace: /Users/developer/.llmdash/claude-refresh-cwd
> ❯ 1. Yes, I trust this folder … Yes, I trust this folder ✔

Subsequent spawns in that cwd hit no dialog (trust persists). **One entry,
ever, on the production path** — exactly the FR-24 budget.

Review reasoning, for the user to ratify: the mechanism mutates nothing
directly — both mutations (the one-time trust entry, the per-refresh
history.jsonl append) are performed **by Claude Code itself** in response to
input llmdash sends, both are named in the startup log and README, the trust
acceptance happens once on a directory that exists solely for this purpose, and
the off-switch stops all of it. Weighed against the
never-touch-Claude-configuration boundary, these are accepted as the two
disclosed exceptions. **Rung 2 stands.** (If the user rejects this at their
check-in, rung 2 fails by SQ-2c and the feature falls to the [F] ending — the
PRD already specifies it.)

---

## Budget & cleanup verification (FR-05)

- **Spawns:** 5 of 10 (trust, status1, usagetab, usagecmd, usagefull). Rung 1
  spawned zero sessions.
- **Live sessions:** enumerated up front (`ps` snapshot preserved); the user's
  real sessions ran throughout and were never signaled — the teardown targeted
  only pgids/pids recorded at spawn time.
- **Processes:** per-spawn teardown verified empty; an independent `ps` sweep
  at write-up time found **zero** leftover `script`/`claude` spike processes.
- **LaunchAgents:** none created, none present.
- **Transcript residue:** none (projects diff empty of new paths).
- **Known residue (deliberate):** the production trust entry for
  `~/.llmdash/claude-refresh-cwd` (it *is* the mechanism's, kept by design);
  4 history.jsonl lines (inert); the empty `~/.llmdash/claude-refresh-cwd`
  directory (production-intended). Spike scratch artifacts lived in the
  session-temporary scratchpad and vanish with it.

---

## Findings later stages must honor

1. **The statusline-payload avenue is dead** (2.1.198): no client-side command
   populates `rate_limits`. Close the roadmap's `/status` question with this
   evidence. Readings via the payload arrive only with API traffic (prior
   spike, still true).
2. **The working sequence:** spawn under the inherited-law env/pty rules in
   `~/.llmdash/claude-refresh-cwd`; wait for the TUI (~3–5 s to ready); send
   `/usage` + Enter via the real-pipe keystroke fragment; the pane renders
   within a few seconds; capture the typescript; teardown. Total spawn
   lifetime comfortably under a 30 s timeout. (`/status` navigation is NOT the
   path — don't revive it.)
3. **Parse contract:** de-ANSI the typescript; anchor on the literal labels
   `Current session` and `Current week (all models)`; tolerate dropped
   characters (observed: "Resets" → "Rests") with loose patterns; extract
   `NN% used` + the `Resets …` clause up to the timezone paren; clamp 0–100.
   The weekly regex broke once during the POC on an escaping bug — treat the
   parser as the fragile surface it is.
4. **Parse failure is a first-class runtime failure mode** (screen layouts
   change between CLI versions): it must feed `auto-refresh-failing` with its
   own cause, never crash, never emit a partial/fabricated reading.
5. **Reset conversion:** the pane gives local-time text plus an IANA zone in
   parens (`America/Los_Angeles`). "12:20am" (no date) = next future
   occurrence; "Jul 3 at 11pm" = that calendar date in that zone. The
   cross-check above proves the conversion target. On conversion failure, keep
   the used% reading with a null reset rather than dropping it — but log once.
6. **`capturedAt` = the moment the pane was captured** (it renders live data —
   that IS evidence time, satisfying FR-09), never the parse/processing time,
   and newest-`capturedAt`-wins against organic statusline writes (FR-10).
7. **The Fable/third-meter rule** (mapping above): scrape only the two
   contract windows; note the promo meter's existence in DECISIONS as a
   possible future source-aware addition.
8. **Disclosure set:** dedicated cwd path, the single trust entry, and the
   per-refresh history.jsonl append — startup log + README, plus the
   `freshnessModeLine` rewrite (its current copy becomes false the moment this
   ships).
9. **Fixtures:** the two real `/usage` typescripts are preserved for the
   Engineer at `tests/fixtures/usage-pane-1.txt` / `usage-pane-2.txt`
   (vendored from the spike captures; sanitize the account email/org strings
   when copying). The parser's unit tests run against these real captures, not
   synthetic panes.
