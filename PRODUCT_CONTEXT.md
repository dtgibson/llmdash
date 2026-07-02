# Product Context — llmdash

## What It Is
A personal, self-hosted dashboard showing your remaining AI coding usage. It runs
on your own machine and is viewable on phone or laptop over Tailscale. It covers
Claude Code (Max) and Codex (ChatGPT Plus) side by side.

## Shipped Capabilities
- **Claude Code live dashboard** — the 5-hour and weekly limit windows (remaining
  %, reset countdowns, status colors), pacing predictors for **both** windows
  (on pace / at risk / limit reached, with status pills), and activity stats from
  local logs: tokens (5h / week / today), cache hit rate, estimated value, weekly
  token mix, cache savings, and today's value. Limit snapshots are logged to SQLite.
- **Codex usage** — Codex's 5-hour and weekly limits beside Claude Code, with a
  headroom cue (across both windows) that points you to the tool with room left
  when one is low or maxed. Codex token activity is read from its local session
  logs too (tokens, cache hit rate, estimated value, token mix); its cached tokens
  are a subset of input, so the totals stay honest. A maxed window reads "limit
  reached."
- **Usage trends** — a Trends section below the gauges charts usage over time per
  tool (limit burn, tokens per day, cache rate, estimated value) in vanilla SVG,
  with a 24h / 7d / 30d range switch.
- **Claude reading freshness & auto-refresh** — the Claude limit reading shows
  its age in the tool header (flagged "aging" past 5 minutes, "stale" past 10)
  and keeps itself fresh automatically: while Claude is active, an activity-gated
  probe scrapes a `/usage` pane into the reading file, so a desktop-app-only day
  no longer leaves the headline number permanently stale — no manual CLI ritual.
  It degrades honestly (a failing probe or a disabled one says so; gauges keep
  rendering the last capture) and costs no usage quota.
- **macOS menu-bar badge** — a glanceable badge in the menu bar (via SwiftBar/xbar)
  showing the most-constrained remaining % across Claude Code and Codex (both
  windows), with a dropdown carrying the full per-tool picture and a link to the
  dashboard. It is a pure consumer of `/api/state` (no second data path, no
  recomputed limits), honest about freshness and offline state (five honesty
  states mirroring the dashboard), and names the binding tool (C = Claude,
  X = Codex). The host is configurable so it can read a dashboard on any tailnet
  machine.

## How It Works
- Vanilla Node (`node:http` + `node:sqlite`), zero npm dependencies, plain
  HTML/CSS/JS, no build step. Requires Node 24+.
- Limit data comes from Claude Code's statusline: `scripts/statusline.js` writes
  the `rate_limits` block to `data/claude-ratelimits.json`, which the server
  reads. Readings also refresh on their own: when the reading goes stale and
  Claude has been active, the interval poller spawns a short-lived session, sends
  `/usage`, and scrapes that pane into the same reading file (the statusline
  render itself never carries limits for a desktop-app user). Activity stats are
  computed on demand from `~/.claude/projects/**/*.jsonl`.
- Codex limits come from `codex app-server` (polled on the interval, not per
  request) with a rollout-file fallback; Codex activity from
  `~/.codex/sessions`. Both tools flow through one source-aware path and the same
  UI components; each is a `source` value in `usage_snapshots`.
- Trends come from the same data (the snapshot series plus daily-bucketed log
  aggregation) via a separate `/api/trends?range=` endpoint, rendered as plain
  SVG. Static assets are served `no-store`; the CSP allows inline styles while
  scripts stay locked to `'self'`.
- Served on `0.0.0.0:8787`, reachable over the tailnet. Runs as a systemd user
  service (`llmdash.service`) with lingering enabled, so it survives reboots.
- The menu-bar badge is a zero-dependency Node plugin that only does a loopback
  `GET /api/state`. SwiftBar is a user-installed prerequisite (llmdash never
  installs it); `--setup-badge` wires it in by generating a wrapper in SwiftBar's
  plugin dir that runs the tracked plugin, so the checkout is never modified and
  the badge updates on pull (`--remove-badge` reverses it symmetrically).

## Data Sources & Honesty
- **Limits** are account-wide (Claude Code's own numbers). **Activity stats** are
  from this machine's logs only. The UI states this distinction.
- A gauge with no reading yet names the cause and the remedy (statusline not
  reporting yet, codex command not runnable) instead of silent dashes, and the
  startup log prints a data-source health readout naming anything missing.
- No history backfill: limit trends accrue from first run; token stats have full
  history from the logs.

## Deferred / Not yet built
- Nothing major queued. See `ROADMAP.md` → Up Next (limit alerts) and On the
  Horizon (multi-host badge, a tmux/terminal statusline emitter, strict
  tailnet-only binding, the auto-refresh teardown follow-up, the Fable per-model
  weekly meter).
- Kagi (Ultimate is unlimited; no meter to show).
- General ChatGPT chat caps (no machine-readable source).
- Limit alerts/notifications.
