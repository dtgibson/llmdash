# Spike Report — statusline-auto-refresh
**Feature:** statusline-auto-refresh
**Date:** 2026-07-01
**Stage:** 3 — The Architect
**Machine:** macOS (darwin 25.5.0), Claude Code CLI 2.1.198 at `/Users/developer/.local/bin/claude`
**Spike budget:** 8 claude spawns used (cap 8), ~20 min wall (over the ~10 min target — the
socketpair failure mode cost three silent-death spawns before it was diagnosed).

---

## BRANCH DECISION: **B** — the spike fails on its core question. A prompt-free Claude Code session never receives `rate_limits` in its statusline payload (statusline confirmed executing; 48 s and 150 s watches both empty), so the spawn mechanism cannot produce a reading without sending a message — which FR-01/NFR-02 forbid.

Everything tagged **[A]** in the PRD is dropped. The reading-age cue, `stale-reading`
diagnostic, manual-refresh nudge, and honest startup/README statements ship as
specified (see `schema.md`).

---

## Method common to all tests

- Success signal: `capturedAt` in the **real** installed file
  `/Users/developer/llmdash/data/claude-ratelimits.json` advancing past spawn start.
  Pre-spike value: `2026-07-01T23:05:13.626Z`. The statusline is configured
  **user-globally** in `~/.claude/settings.json` (`node /Users/developer/llmdash/scripts/statusline.js`),
  so any cwd fires it.
- All spawns ran in dedicated scratch dirs under the session scratchpad
  (`.../scratchpad/llmdash-refresh-cwd`, `refresh-cwd-2`, `refresh-cwd-3`), pty via
  `/usr/bin/script`, from non-interactive parents.
- The user's live interactive session (PID 69173, started ~23:02, foreground of its own
  terminal) was identified up front and never signaled.

## Q1 — Does a prompt-free, no-input session render the statusline under `script(1)`?

**Method:** `script -q -t 0 <typescript> claude`, stdin `/dev/null`, dedicated trusted cwd,
launchd-like env plus node on PATH; watch the ratelimits file (t7: 45 s, t8: 150 s).

**Evidence:**
- The TUI loads fully in ~3–5 s ("Welcome back Dave!", "Opus 4.8 (1M context) · Claude Max",
  input prompt) — auth works, no prompt is ever sent.
- The typescript's last line is **our own statusline script's output**:
  `Opus 4.8 (1M context) · refresh-cwd-3` — i.e. `scripts/statusline.js` **ran** and
  printed `${model} · ${dir}` with **no usage suffix**, which by its code
  (`if (data && data.rate_limits)`) means the JSON payload piped to it **contained no
  `rate_limits` block**. No file write occurred.
- t8 held the session alive 150 s (claude PID 72317, ~380 MB RSS): still no `rate_limits`,
  no write.
- Corroboration: the user's live session started ~23:02:10 (etime arithmetic) and the real
  file's `capturedAt` is 23:05:13 — the reading appeared ~3 minutes into that session,
  consistent with `rate_limits` being populated by actual API traffic (the first submitted
  prompt), not by session startup. The strategic brief's "fresh reading within seconds of
  opening a CLI session" observation is consistent with a session where a prompt was typed
  immediately; it does not hold for an idle session.

**Verdict: NO.** The statusline renders and our script executes, but Claude Code 2.1.198
does not supply `rate_limits` in the payload of a session that has made no API request.
This kills branch A regardless of launchd context. (OQ-01 default assumption refuted.)

## Q2 — Launchd-approximate context

**Method:** all successful runs (t6–t8) used `env -i PATH=… HOME USER LOGNAME TERM LANG`
(system PATH + node dir prepended), non-interactive parent, no TTY inheritance.

**Evidence & findings that would matter if A is ever revived:**
1. **Never inherit the parent env.** This spike's own shell is a Claude Code session;
   inherited `CLAUDECODE`/`CLAUDE_CODE_*`/`ANTHROPIC_BASE_URL` vars made the spawned TUI
   exit instantly with zero output (t1). A clean explicit env fixed it.
2. **`script(1)` stdin must not be a Node `'pipe'`** — Node stdio pipes are socketpairs on
   macOS and `script` dies with `tcgetattr/ioctl: Operation not supported on socket`
   (t4/t5, bisected with `/bin/echo` probes). Fifos fail identically (both open modes).
   A real pipe(2) (shell pipeline) and `/dev/null`/`'ignore'` both work. `script` sends one
   `^D` to the pty on stdin EOF; the session survives it (t3, 30 s+).
3. **The statusline command needs `node` on the child PATH.** `node` lives in
   `~/.nvm/.../bin` / `/opt/homebrew/bin` here — absent from launchd's system PATH. With it
   absent the statusline command can't run at all (t6); a reviver must prepend
   `path.dirname(process.execPath)` (llmdash's own node) to the child PATH.
4. Auth/keychain: fine — the TUI reached the authenticated welcome screen under the
   minimal env every time.

**Verdict: the background context itself is workable (TUI + auth + statusline execution
all confirmed under a launchd-like env); the blocker is Q1, not the context.**

## Q3 — True launchd one-shot agent

**Skipped, deliberately.** Q1's failure is independent of launchd (it reproduces in the
friendlier approximation), so a real LaunchAgent could only re-confirm a moot point for
extra risk and budget. No agent was ever created: `ls ~/Library/LaunchAgents | grep -i
spike` → none.

## Q4 — No prompt / no usage by construction

**Method:** diffed `~/.claude/projects/` listings before/after all spawns; inspected for
new slugs.

**Evidence:** zero new project directories, zero transcript files. A session that never
receives a message writes **no transcript at all** (`projects-before.txt` ≡
`projects-after.txt`). Nothing was sent: the only input in the entire spike was a single
`\r` to the workspace-trust dialog (t6), which is a TUI selection, not a message.

**Verdict: PASS by construction and by artifact absence.**

## Q5 — Stats pollution (NFR-03)

**Method:** artifact inspection (Q4) plus code reading of `src/stats.js`.

**Evidence:** message-free sessions leave no transcript files, so there is nothing for
`readUsageRecords()` to read. Independently, `computeActivity()` counts only records with
`o.message.usage`, and `sessionsToday` counts session IDs **only from usage records**
(`aggregate()`), so even a hypothetical empty transcript would move no stat.

**Verdict: no pollution — no mitigation needed.** (The dedicated-cwd exclusion mitigation
sketched in the PRD is unnecessary; recorded here so the Engineer doesn't build it.)

## Q6 — Resume clutter (OQ-02)

**Evidence:** no transcripts → nothing to appear in any session picker. The scratch dirs'
project slugs were never created.

**Verdict: none — moot in branch B anyway.**

## Q7 — Kill safety (OQ-05)

**Method:** t6/t7/t8 were all terminated mid-session (SIGTERM to `script`'s process group,
2 s grace, SIGKILL escalation path armed); each subsequent spawn started cleanly.

**Evidence:**
- Important topology finding: **`script` makes its child a session leader on the pty, so
  `claude` is NOT in `script`'s process group** (t7: script pgid 72038, claude pgid 72041).
  Killing script's group kills script; claude then exits via SIGHUP when the pty master
  closes. Post-kill checks after every test found zero leftover `script`/`claude`
  processes (only the user's live PID 69173, untouched).
- t6 killed the session seconds after trust acceptance mid-TUI; t7 then started in the
  same cwd with no dialog, no lock errors, clean TUI. t8 likewise after t7's kill.
- The ratelimits file is byte-identical to its pre-spike copy (`diff` clean) — no
  corruption.

**Verdict: killing mid-render is safe**, but any reviver must kill script's group AND
verify the orphaned-by-pgid claude follows via SIGHUP (it did, every time), with a
belt-and-braces check on the claude pid itself.

## Q8 — Per-spawn cost (OQ-03) and the exact invocation

**Evidence:** TUI fully up in ~3–5 s; statusline executes shortly after; `claude` idles at
~376–380 MB RSS, ~0 %CPU once loaded. The validated-but-insufficient invocation was
`/usr/bin/script -q -t 0 <file> <абs-claude-path>`, stdin `/dev/null`, clean env,
dedicated cwd. **No invocation of the CLI was found that produces a reading without a
message**, so there is no production spawn spec to ship. The 15 m / 60 m defaults are
confirmed for the UI bands (nothing observed argues for longer).

## Trust dialog (discovered, material to any future revival)

A fresh cwd triggers the "Do you trust this folder?" dialog **before** any statusline
render; it blocks indefinitely (t3: 30 s+, t6: dialog at ~2 s, no reading while up). One
`\r` (sent through a real pipe via a fixed `sh -c` pipeline — see Q2 finding 2) selects
"Yes, I trust this folder"; trust persists in `~/.claude.json` and subsequent spawns in
that cwd skip the dialog (t7/t8). Note: that acceptance **is** a Claude Code config
mutation performed through Claude's own UI — a future branch-A design must surface this
loudly and get it reviewed against the "never touch Claude Code configuration" boundary.

## Cleanup verification

- Processes: `ps ax | grep -E 'local/bin/claude|usr/bin/script'` → only the user's live
  session (PID 69173, running throughout, never signaled; still accepting input — its
  etime advanced normally across the spike). **No spike processes remain.**
- LaunchAgents: none created, none present.
- `~/.claude/projects/`: unchanged (no transcripts created).
- `/Users/developer/llmdash/data/claude-ratelimits.json`: byte-identical to pre-spike.
- Scratch files (runners, typescripts, probe outputs, spawn cwds): all contained in the
  session scratchpad, per rules.
- **Known residue (flagged, not removable within rules):** one trust entry for
  `…/scratchpad/refresh-cwd-3` in `~/.claude.json`, written by Claude Code itself when the
  spike accepted its dialog. Inert (empty scratch dir, deleted with the scratchpad); removing
  it would require editing `~/.claude.json`, which is out of bounds.
