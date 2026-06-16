# Product Context — llmdash

## What It Is
A personal, self-hosted dashboard showing your remaining AI coding usage. It runs
on your own machine and is viewable on phone or laptop over Tailscale. v1 covers
Claude Code (Max).

## Shipped Capabilities
- **Claude Code live dashboard** — the 5-hour and weekly limit windows (remaining
  %, reset countdowns, status colors), a burn-rate projection to the 5-hour
  limit, and activity stats from local logs: tokens (5h / week / today), cache
  hit rate, estimated value, weekly token mix, cache savings, and today's value.
  Limit snapshots are logged to SQLite as the foundation for future trend charts.

## How It Works
- Vanilla Node (`node:http` + `node:sqlite`), zero npm dependencies, plain
  HTML/CSS/JS, no build step. Requires Node 24+.
- Limit data comes from Claude Code's statusline: `scripts/statusline.js` writes
  the `rate_limits` block to `data/claude-ratelimits.json`, which the server
  reads. Activity stats are computed on demand from `~/.claude/projects/**/*.jsonl`.
- Served on `0.0.0.0:8787`, reachable over the tailnet. Runs as a systemd user
  service (`llmdash.service`) with lingering enabled, so it survives reboots.

## Data Sources & Honesty
- **Limits** are account-wide (Claude Code's own numbers). **Activity stats** are
  from this machine's logs only. The UI states this distinction.
- No history backfill: limit trends accrue from first run; token stats have full
  history from the logs.

## Deferred / Not in v1
- Codex (ChatGPT Plus) usage — next feature.
- Usage trend charts — the feature after that (snapshot logging is already in place).
- Kagi (Ultimate is unlimited; no meter to show).
- General ChatGPT chat caps (no machine-readable source).
- Limit alerts/notifications; a menu-bar badge.
