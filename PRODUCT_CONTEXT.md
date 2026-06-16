# Product Context — llmdash

## What It Is
A personal, self-hosted dashboard showing your remaining AI coding usage. It runs
on your own machine and is viewable on phone or laptop over Tailscale. It covers
Claude Code (Max) and Codex (ChatGPT Plus) side by side.

## Shipped Capabilities
- **Claude Code live dashboard** — the 5-hour and weekly limit windows (remaining
  %, reset countdowns, status colors), a burn-rate projection to the 5-hour
  limit, and activity stats from local logs: tokens (5h / week / today), cache
  hit rate, estimated value, weekly token mix, cache savings, and today's value.
  Limit snapshots are logged to SQLite as the foundation for future trend charts.
- **Codex usage** — Codex's 5-hour and weekly limits and activity stats in their
  own block beside Claude Code, plus a headroom cue that points you to the tool
  with room left when one maxes out. Codex activity fills in as you use Codex.

## How It Works
- Vanilla Node (`node:http` + `node:sqlite`), zero npm dependencies, plain
  HTML/CSS/JS, no build step. Requires Node 24+.
- Limit data comes from Claude Code's statusline: `scripts/statusline.js` writes
  the `rate_limits` block to `data/claude-ratelimits.json`, which the server
  reads. Activity stats are computed on demand from `~/.claude/projects/**/*.jsonl`.
- Codex limits come from `codex app-server` (polled on the interval, not per
  request) with a rollout-file fallback; Codex activity from
  `~/.codex/sessions`. Both tools flow through one source-aware path and the same
  UI components; each is a `source` value in `usage_snapshots`.
- Served on `0.0.0.0:8787`, reachable over the tailnet. Runs as a systemd user
  service (`llmdash.service`) with lingering enabled, so it survives reboots.

## Data Sources & Honesty
- **Limits** are account-wide (Claude Code's own numbers). **Activity stats** are
  from this machine's logs only. The UI states this distinction.
- No history backfill: limit trends accrue from first run; token stats have full
  history from the logs.

## Deferred / Not yet built
- Usage trend charts — next feature (snapshot logging is already running for both tools).
- Kagi (Ultimate is unlimited; no meter to show).
- General ChatGPT chat caps (no machine-readable source).
- Limit alerts/notifications; a menu-bar badge.
