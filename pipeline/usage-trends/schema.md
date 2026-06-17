# Data Layer Design — Usage Trends
**Feature:** usage-trends
**Stage:** 3 — The Architect
**Path:** Incremental
**Source:** prd.md (approved)
**Store:** existing SQLite (no change)

## Summary
No schema change. Every trend series comes from data already captured:
- **Limit-burn:** the existing `usage_snapshots` table via `getSeries(source,
  window, sinceIso)` (built in feature 1).
- **Token / value / cache daily series:** aggregated on demand from each tool's
  logs (`~/.claude/projects`, `~/.codex/sessions`), bucketed by local day over
  the selected range, cached per range.

## Existing pieces reused
- `usage_snapshots(id, captured_at, source, window, used_pct, resets_at)` +
  `getSeries()` — limit-burn history, unchanged.
- The Claude log reader (`src/stats.js` readUsageRecords) and Codex reader
  (`src/codex-stats.js` readUsageRecords), plus their per-record cost/cache
  helpers and pricing tables.

## New (read/compute only)
- A **daily-bucketing aggregation** per tool: for a range (24h / 7d / 30d), group
  usage records by local day → `{ day, tokensByType, cost, cacheHitRate }`,
  reusing the existing per-record cost/cache helpers.
- A **trends assembler** returning, per tool: the limit-burn series (per window,
  from snapshots) and the daily token / value / cache series.
- A **`/api/trends?range=`** endpoint (read-only GET) serving the assembled
  series, cached per range (TTL) so 30d doesn't rescan logs each request. Carries
  only aggregates and timestamps.

## Decisions
- Make the daily aggregation **source-aware** (Claude and Codex share the
  bucketing; each uses its own reader + pricing).
- Burn series = raw snapshot points over the range (the sawtooth shows resets);
  no resampling.
- Trends served on a **separate endpoint**, not `/api/state`, so the gauges stay
  instant; loaded after them.
- Empty/thin handled in the data layer: a series with <2 points returns a flag
  the UI renders as "not enough data yet."
- No new storage; mtime-filtered, cached reads keep the 30d range bounded.
