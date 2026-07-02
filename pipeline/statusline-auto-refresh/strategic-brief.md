# Strategic Brief — statusline-auto-refresh

## What We're Building
Keep the Claude limit gauges current even when the user never opens a CLI
session: llmdash periodically spawns a short-lived Claude Code CLI session in a
pty (no prompt sent) so the statusline renders and refreshes
`data/claude-ratelimits.json` — paired with a reading-age cue in the UI so a
stale reading is never mistaken for a current one.

## Why Now
The user works primarily from the Claude Code desktop app, which never renders
the statusline, so the Claude gauges sit empty or stale — verified live today,
and opening a CLI session produced a fresh reading within seconds. The
just-shipped fresh-install fix built exactly the plumbing this needs
(`capturedAt` timestamps, per-tool `limitsDiagnostic` codes, the startup health
readout): that fix made staleness *visible*; this feature makes it *fixable*.
It also unblocks the roadmap's Up Next items — a tray badge or limit alerts
built on stale readings would be worthless.

## The User Problem
The dashboard's core promise is knowing how much Claude headroom is left right
now, but for a desktop-app user the Claude reading only updates when they
remember to open a CLI session — the exact manual ritual the dashboard exists
to eliminate. On desktop-app-only days the gauges are old or blank, and nothing
distinguishes an hours-old reading from a current one.

## Success Criteria
- On a day of desktop-app-only Claude use, the dashboard shows recent Claude
  limit readings without the user opening a CLI session or touching anything.
- The UI states how old the Claude limit reading is; a stale reading is visibly
  flagged rather than passing as current.
- When auto-refresh isn't running (disabled, spawn failing, or spike-failed
  fallback), the dashboard says so honestly and names the remedy ("open a
  Claude Code CLI session to refresh") — never silent staleness.
- The startup log states the auto-refresh default, its cadence stance, and the
  off-switch, per the surface-defaults convention.
- The spawned sessions are invisible in effect: no prompt sent, no usage
  consumed, no distortion of the dashboard's own activity stats, no
  interference with the user's normal Claude Code use.

## Scope
- Staleness-gated auto-refresh on the interval poller: spawn a short-lived
  Claude Code CLI session in a pty using OS built-ins (e.g. macOS `script`),
  no prompt sent, clean exit once the statusline has rendered.
- A reading-age cue on the Claude limit gauges, built on the existing
  `capturedAt` / `limitsDiagnostic` plumbing.
- Startup log + README statement of the default behavior and the `LLMDASH_*`
  off-switch.
- The named fallback if the spike fails: ship the reading-age cue plus an
  honest "open a CLI session to refresh" nudge — standalone value on its own.
- Primary target is the macOS/launchd install (where desktop-app usage
  happens); the design shouldn't preclude the Linux/systemd path but v1
  validates macOS.

## Out of Scope
- Fixing or working around desktop-app statusline behavior itself.
- Touching `~/.claude/settings.json` or any Claude Code configuration.
- Any OAuth-token or usage-endpoint use — permanently banned (DECISIONS.md,
  2026-06-16); the statusline remains the only sanctioned tap, and CLI 2.1.198
  has no machine-readable usage command.
- Codex: its limits already poll live via `codex app-server`; it needs none of
  this.
- Any runtime dependency (node-pty is explicitly out; zero-dep convention
  holds).
- Limit alerts and the tray badge (separate roadmap items this feature feeds).

## Key Decisions
- **Spike first, before design is finalized.** Whether a freshly spawned CLI
  session fires the statusline with `rate_limits` from a launchd/background
  context (keychain/auth access, render timing, clean exit) is verified only
  from an interactive terminal. The Architect must validate this empirically
  in Stage 3 before committing the design. The spike must also confirm the
  spawned session sends no prompt, consumes no usage, and leaves no token
  activity that would pollute the dashboard's own stats.
- **Named fallback if the spike fails:** pivot to the reading-age cue plus a
  prominent "open a CLI session to refresh" nudge. No speculative
  half-mechanism ships.
- **On by default, staleness-gated, with an off-switch.** Auto-refresh ships
  enabled — opt-in would leave gauges stale on exactly the days the feature
  exists for, against the product's core promise. It only spawns when the
  current reading is actually stale (piggybacking on organic CLI activity),
  never on a blind timer. An `LLMDASH_*` env var disables it, and the startup
  log states whichever mode is active. Spawning the user's own Claude Code on
  a schedule is a surprise-factor behavior, so it is surfaced loudly in README
  and startup log, per convention.
- **Cadence stance:** fresh enough to trust without churning sessions — a
  reading should be at most a small fraction of the 5-hour window old. Exact
  thresholds and intervals are Planner/Architect detail.
- **Sanctioned path affirmed:** Claude Code itself produces the data via its
  own statusline; automating a render stays inside the 2026-06-16 decision.
  No OAuth reuse, ever.
- **Existing conventions bind the design:** subprocess work stays on the
  interval poller (never the HTTP request path); zero runtime dependencies
  (pty via OS built-ins only); the reading-age cue states source and age
  honestly.
