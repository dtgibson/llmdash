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
- **Claude reading freshness** — the Claude limit reading shows its age in the
  tool header, flagged "aging" past 5 minutes and "stale" past 10 with a note
  naming the CLI-session remedy, while stale gauges keep rendering the last
  capture.

## How It Works
- Vanilla Node (`node:http` + `node:sqlite`), zero npm dependencies, plain
  HTML/CSS/JS, no build step. Requires Node 24+.
- Limit data comes from Claude Code's statusline: `scripts/statusline.js` writes
  the `rate_limits` block to `data/claude-ratelimits.json`, which the server
  reads. Readings refresh only when a real Claude Code session renders its
  statusline (the desktop app doesn't). Activity stats are computed on demand
  from `~/.claude/projects/**/*.jsonl`.
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

## Data Sources & Honesty
- **Limits** are account-wide (Claude Code's own numbers). **Activity stats** are
  from this machine's logs only. The UI states this distinction.
- A gauge with no reading yet names the cause and the remedy (statusline not
  reporting yet, codex command not runnable) instead of silent dashes, and the
  startup log prints a data-source health readout naming anything missing.
- No history backfill: limit trends accrue from first run; token stats have full
  history from the logs.

## Deferred / Not yet built
- Nothing major queued. See `ROADMAP.md` → On the Horizon (menu-bar badge, limit
  alerts, strict tailnet-only binding).
- Auto-refreshing the Claude reading via a spawned headless CLI session —
  empirically refuted for now (an idle session receives no `rate_limits`); see
  DECISIONS.md 2026-07-01.
- Kagi (Ultimate is unlimited; no meter to show).
- General ChatGPT chat caps (no machine-readable source).
- Limit alerts/notifications; a menu-bar badge.
