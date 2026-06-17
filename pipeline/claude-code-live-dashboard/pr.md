## Claude Code Live Dashboard

### What this does
Stands up a local, zero-dependency Node web app that shows your Claude Code (Max)
5-hour and weekly usage limits — remaining %, reset countdowns, status colors —
plus an Activity section computed from your local session logs (tokens for 5h /
week / today, cache hit rate, estimated API-rate value, and a burn-rate
projection to the 5-hour limit). It serves over Tailscale for phone/laptop access
and logs limit snapshots to SQLite so the later charts feature has history.

### How to test
1. `npm test` — unit tests for the stats math and snapshot de-duplication.
2. `npm start`, then open <http://localhost:8787>. The Activity stats populate
   immediately from your real logs.
3. Add the statusline (see README), trigger a Claude Code render, and the limit
   gauges populate with the authoritative 5-hour / weekly numbers.

### Notes for reviewer
- **Data sources, deliberately distinct:** limits come from Claude Code's
  sanctioned statusline output (captured to `data/claude-ratelimits.json`);
  activity comes from `~/.claude/projects/**/*.jsonl`. The UI says so in the
  footer. We do **not** reuse the OAuth token to call the usage endpoint (avoids
  the Feb-2026 credential-use policy issue).
- **No backfill:** limit history starts when the app starts (snapshots). Token
  stats have natural history from the logs.
- **Stack:** vanilla per the design decision — `node:http` + `node:sqlite`, plain
  HTML/CSS/JS, no framework, no build step.
- Known limitation: the statusline emits rate limits only when Claude Code runs
  (and on some Max tiers/versions the field can be absent — issue #40094). The
  app shows "waiting…" gracefully until a reading arrives, and serves the last
  stored snapshot if a live read is unavailable.
