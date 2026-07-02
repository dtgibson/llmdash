# PR — claude-auto-refresh

## Claude Auto-Refresh

### What this does
The Claude limit reading now refreshes itself. When the reading is older than
5 minutes while Claude has been active in the last 10 (newest transcript mtime
under `~/.claude/projects`), the poller spawns a short-lived Claude Code
session in a dedicated cwd (`~/.llmdash/claude-refresh-cwd`), types `/usage`,
scrapes the rendered pane from the pty typescript, and writes the same
`data/claude-ratelimits.json` the statusline script writes — newest capture
wins, so a probe never overwrites a fresher organic reading. No message is
ever sent, no plan usage is consumed, no transcript is written. The two
reserved diagnostic codes are now consumed: `auto-refresh-failing` (stale or
absent reading + 3 consecutive probe failures, with a cause enum) and
`auto-refresh-disabled` (stale or absent reading while
`LLMDASH_CLAUDE_AUTOREFRESH=0`), both rendered by the client with the
approved verbatim copy on the existing `.stale-note` surface.

### How to test
1. `npm test` — 123 tests, all green (parser runs against the two real spike
   pty captures in `tests/fixtures/`).
2. See `pipeline/claude-auto-refresh/how-to-see-it.md` for the local
   walkthrough (start command, what the startup log discloses, how to watch
   `capturedAt` advance during real Claude use, and how to force the disabled
   state via env).
3. Real-spawn integration (Stage 6): with a stale reading and recent Claude
   activity, one poller tick should produce a probe that lives a few seconds,
   advance `data/claude-ratelimits.json`, leave zero `script`/`claude`
   leftovers, add no transcript, and append exactly one
   `~/.claude/history.jsonl` line.

### Notes for reviewer
- **Gate order is the contract** (`src/claude-refresh.js` →
  `maybeRefreshClaude`): off-switch → freshness suppression → activity gate →
  single-flight/spacing/backoff → attempt. Backoff doubles 5m→60m; success
  resets; all arithmetic is wall-clock (sleep gaps fire at most one attempt).
- **The spawn is the inherited-law runner**: fixed `/bin/sh -c` constant, no
  config interpolation (paths enter as positional argv), allowlist env (never
  `CLAUDECODE*`/`ANTHROPIC_*`), keystrokes through a real shell pipe, group
  kill + verified claude-pid teardown. The claude pid is found by walking a
  `ps` snapshot's ppid links back to our own spawn — live sessions are
  structurally unkillable by this code.
- **The parser is the fragile surface** (by design assumption): anchored on
  `Current session` / `Current week (all models)`, tolerant of pty-dropped
  characters, never scrapes the Fable/promo meter or the "What's
  contributing" section. Both windows required, else `parse-failed` — a loud
  first-class failure, never a partial reading.
- **Boundary exceptions ratified 2026-07-02** (decisions.md): the one-time
  trust entry for the dedicated cwd and the per-refresh history.jsonl append,
  both performed by Claude Code itself and disclosed in the startup log +
  README.
- `tests/branch-b-guard.test.js` (which locked the prior feature's *refuted*
  no-auto-refresh state) is superseded by `tests/autorefresh-guard.test.js`,
  which locks the new invariants instead (zero deps, spawn-surface budget,
  fixed runner constant, no dead knobs, README truth).
- Known limitation: if the user ever deletes the trust entry, the first probe
  answers the trust dialog implicitly (its trailing Enter) and times out
  honestly; the next probe succeeds. Recorded in schema.md risk 2.
