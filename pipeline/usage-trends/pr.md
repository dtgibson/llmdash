## Usage Trends

### What this does
Adds a Trends section to the dashboard with vanilla-SVG charts of usage over time
for both tools: limit-burn lines (from snapshots), tokens per day (stacked, from
logs), cache hit rate, and estimated value per day, with a 24h / 7d / 30d range
switch served by a new `/api/trends` endpoint. No schema change, no new
dependencies.

### How to test
1. `npm test` — 14 tests (adds daily-bucketing).
2. Restart the service and refresh; a Trends section appears below the gauges.
   Claude's charts populate from history; Codex shows the empty state until it has
   data; the range pills re-scope all charts.

### Notes for reviewer
- Trends are served on a separate `/api/trends?range=` endpoint to keep
  `/api/state` (the at-a-glance view) lean; cached per range (60s).
- Reuses `getSeries()` (snapshots) and the existing log readers/aggregators via a
  source-aware daily-bucketing function — no schema change.
- Graceful empties: a series with <2 points renders "not enough data yet"; Codex
  shows an empty card until it has logs.
- Charts are plain SVG; `package.json` dependencies are still empty.
