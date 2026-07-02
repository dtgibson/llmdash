# Strategic Brief — claude-auto-refresh

## What We're Building
Make the Claude limit reading refresh itself — at most ~5 minutes old whenever
the user is actively using Claude — without the manual open-a-CLI-session
ritual, via the cheapest mechanism that empirically works. This is a revival of
the spike-refuted auto-refresh, structured as a prioritized ladder of candidate
mechanisms that Stage 3 (the Architect) resolves with a decision spike before
any design is committed. The zero-cost rungs are the feature; the usage-burning
rung is explicitly not in this feature's shippable scope.

## Why Now
The user works almost exclusively in the Claude desktop app, which never
renders the statusline — so their Claude reading goes stale and stays stale.
The freshness layer that shipped 2026-07-01 made that staleness *visible*
(aging at 5 min, stale at 10), but for this user "stale" is now the permanent
state of the dashboard's headline number: honesty shipped, the fix didn't. The
user has now asked for the fix directly ("update at least every 5 minutes, in a
resource-friendly way"). The ground has also shifted since the refutation: the
spike killed exactly one mechanism (a prompt-free idle session receives no
`rate_limits`), the roadmap already names the untested `/status` avenue as the
sanctioned revival path, and the reserved diagnostic codes
(`auto-refresh-failing` / `auto-refresh-disabled`) were set aside for precisely
this feature. Finally, both Up Next roadmap items — the menu-bar badge and
limit alerts — inherit whatever freshness this feature achieves; a badge or
alert built on a permanently stale reading is worthless, so solving freshness
first strengthens rather than skips the roadmap.

## The User Problem
The dashboard's core promise is knowing how much Claude headroom is left right
now. The Claude reading arrives only when a real Claude Code CLI session
renders its statusline with a `rate_limits` payload — and this user's Claude
use happens in the desktop app, which produces no such render. Their gauges
show an hours- or days-old reading with an honest stale flag, and the only
remedy is the exact manual ritual (open a CLI session, send a message) the
dashboard exists to eliminate. During heavy desktop-app use — precisely when
headroom changes fastest and matters most — the number is at its least
trustworthy.

## Success Criteria
- On a desktop-app-only day of active Claude use, the Claude limit reading is
  at most ~5 minutes old (inside the shipped "aging" band) with no manual CLI
  ritual — the aging/stale flags become transient states, not the permanent
  condition.
- Resource-friendly by the user's own definition: no persistent idle CLI
  session parked at ~380 MB, bounded spawn frequency (if spawning is even
  needed), and zero usage-quota cost in the shipped default.
- Refresh effort is activity-gated: freshness is guaranteed while Claude is
  actually being used, and the dashboard does not burn spawns around the clock
  for a reading that cannot have changed. During inactivity, honest age labels
  (already shipped) carry the truth.
- The mechanism degrades honestly at runtime: a failing mechanism surfaces
  `auto-refresh-failing`, a disabled one `auto-refresh-disabled`, and the
  existing freshness cues keep rendering the last capture — never silent
  staleness, never fabricated freshness.
- The dashboard's own activity stats are not polluted by the mechanism, and
  the user's live Claude sessions are never touched or signaled.
- If every zero-cost avenue fails empirically, the feature still ends cleanly:
  findings recorded, roadmap and DECISIONS updated, no speculative
  half-mechanism shipped, and the dashboard no less honest than today.

## Scope
- A Stage-3 decision spike that works the candidate ladder **in priority
  order**, stopping at the first rung that empirically produces a fresh
  `rate_limits`-equivalent reading:
  1. **Passive local sources** (strictly best: zero cost, zero spawns,
     inherently activity-gated). Do the user's desktop-app sessions — which
     *do* write transcript JSONL under `~/.claude/projects` — carry
     rate-limit fields in any record? Does any other local Claude Code state
     file persist limit data? Also re-confirm the installed CLI has no
     machine-readable usage command (cheap to check, strictly best if one
     appeared).
  2. **Client-side-command probe in a spawned idle session** (zero usage
     cost, one short-lived spawn per refresh): does `/status` — or a related
     client-side command like `/usage`, which displays limit-window data
     without sending a message — populate `rate_limits` in the statusline
     payload? This is the roadmap's named revival avenue.
- Productionizing whichever zero-cost rung validates: reading at most ~5
  minutes old during active Claude use, refresh work on the interval poller
  (never the HTTP request path), activity-gated rather than 24/7, with
  failure backoff.
- Wiring the reserved diagnostic codes: `auto-refresh-failing` when the
  mechanism breaks at runtime, `auto-refresh-disabled` when switched off —
  both landing on the existing freshness-cue surface.
- Loud disclosure per convention: startup log states the mechanism, its
  cadence stance, and the off-switch (if the mechanism spawns anything); a
  `src/health.js` line covers any new data dependency; README updated.
- The honest reduced-scope ending if all zero-cost rungs fail: record the
  refutation evidence in DECISIONS.md, close or narrow the roadmap's revival
  avenue, adjust any UI/README copy the findings prove wrong, and surface the
  consent-gated last resort (below) as a named decision for the user — not a
  build.

## Out of Scope
- **The OAuth/usage-endpoint path — permanently banned** (DECISIONS.md
  2026-06-16, Anthropic Feb-2026 policy). Not a rung, not a fallback, never.
- **The minimal-real-prompt branch as a shippable default.** Burning usage to
  measure usage, and writing transcripts that contaminate llmdash's own
  activity stats, cuts against the product's identity of honest measurement.
  It may only ever exist as an explicit, off-by-default, user-consented
  opt-in with a stats-exclusion story — and that consent cannot be granted in
  this hands-off run, so this feature does not build it. If the zero-cost
  rungs fail, it is presented to the user as a question, not shipped as an
  answer.
- Fixing or working around the desktop app's statusline behavior itself.
- Any persistent background Claude session (the ~380 MB parked-idle model is
  ruled out by the user's own requirement).
- Codex: its limits already poll live via `codex app-server`.
- The menu-bar badge and limit alerts (separate roadmap items that inherit
  this feature's result).
- Any runtime dependency (node-pty explicitly out; zero-dep convention
  holds); pty via OS built-ins only, exactly as the prior spike validated.
- Redesigning the shipped freshness bands/cues — this feature feeds that
  surface, it does not rework it.
- Linux/systemd as the validation target: macOS/launchd is the deployment
  reality and v1 validates there (the design shouldn't preclude Linux).

## Key Decisions
- **Spike-first, ladder-ordered, no presupposition.** The prior spike proved
  assumptions here die on contact with the CLI. No design is committed until
  Stage 3 empirically settles which rung works; the brief deliberately does
  not assume any zero-cost mechanism succeeds, and defines the all-fail
  outcome (honest reduced scope + recorded findings + consent question
  deferred to the user) as a first-class ending, mirroring the prior
  feature's branch-B discipline.
- **Passive beats probe beats prompt.** Priority is strict: a passive local
  source refreshes exactly when the user actually uses Claude, costs nothing,
  and spawns nothing — if it works, the probe rung is skipped entirely. The
  prompt rung is excluded from shippable scope outright (see Out of Scope).
- **The prior spike's mechanics bind any spawn design.** Everything in
  `pipeline/statusline-auto-refresh/spike-report.md` is inherited law for
  rung 2: clean explicit env (never inherit the parent's `CLAUDECODE*` vars),
  `script(1)` stdin must not be a Node pipe (socketpair death), `node`
  prepended to the child PATH from `process.execPath`, kill script's process
  group and verify the pty-orphaned claude follows via SIGHUP, dedicated cwd.
- **The trust dialog is a Claude-config mutation and must be treated as one.**
  Accepting "do you trust this folder" writes to `~/.claude.json`. Any rung-2
  design uses a single persistent dedicated cwd (one trust entry, ever),
  discloses the mutation loudly, and gets it explicitly reviewed against the
  never-touch-Claude-configuration boundary — if that review fails, rung 2
  fails.
- **The spike's no-pollution findings must be re-verified under command
  input.** Q4/Q5 (no transcript, no stats movement) were proven only for
  sessions that received *zero* input; typing `/status` or `/usage` into a
  session is new territory, and the spike must confirm command-only sessions
  still write no transcript, consume no usage, and move no llmdash stat.
- **Freshness target is activity-scoped, not absolute.** "At most ~5 minutes
  old" (matching the shipped aging band and the single
  `LLMDASH_CLAUDE_MAX_AGE_MS` knob) is guaranteed during active Claude use —
  the only time the reading can materially change. Around-the-clock refresh
  is explicitly rejected as not resource-friendly; the exact activity signal
  (e.g. transcript mtimes, which passive rung 1 reads anyway) is
  Planner/Architect detail.
- **The reserved diagnostic codes get consumed, not reinvented.**
  `auto-refresh-failing` / `auto-refresh-disabled` were reserved for exactly
  this revival; using them means no wire-contract break, and the existing
  freshness cues are the degradation surface. Server supplies thresholds; the
  client never guesses — both conventions carry forward.
- **No dead knobs.** A passive source needs no switch (there is nothing to
  turn off). A spawn mechanism, if it ships, is on by default (opt-in would
  leave gauges stale on exactly the days the feature exists for — the prior
  brief's reasoning stands), disclosed in the startup log and README, and
  switchable off via an `LLMDASH_*` env var that maps to
  `auto-refresh-disabled`.
- **Conscious roadmap jump.** This feature moves ahead of the Up Next items
  (tray badge, limit alerts) deliberately: both are consumers of Claude
  reading freshness, and the roadmap itself notes they must respect the
  manual-refresh reality. Fixing freshness first is sequencing, not drift —
  and it sits squarely on the founding decision that "realtime means the
  latest snapshot, refreshed on tool activity or a short interval."
