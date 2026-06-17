# Data Layer Design — Claude Code Live Dashboard
**Feature:** claude-code-live-dashboard
**Stage:** 3 — The Architect
**Path:** Greenfield
**Source:** prd.md (approved)
**Store:** SQLite (single local file)

## Overview
The only thing this feature persists is a time series of usage snapshots, the
readings that FR-14/FR-15/FR-16 require so the later trend charts (feature 3)
have history. The live numbers shown on the page are just the most recent
snapshot, so there is no separate "current state" table; the latest row per
window is the live value. One table covers it, shaped from the start to extend
to Codex and extra windows without a schema change.

## Table: `usage_snapshots`

| Column | Type | Null | Description |
|---|---|---|---|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | no | Row id |
| `captured_at` | TEXT (ISO-8601 UTC) | no | When the dashboard recorded this reading |
| `source` | TEXT | no | Which tool: `claude-code` (future: `codex`) |
| `window` | TEXT | no | Which limit window: `five_hour` or `seven_day` |
| `used_pct` | REAL (0–100) | no | Percent of the window used at capture; remaining = 100 − used_pct |
| `resets_at` | TEXT (ISO-8601 UTC) | yes | When that window resets (nullable if the source omits it) |

**Index:** `idx_usage_source_window_time` on `(source, window, captured_at)` —
covers both "latest reading per window" and "this window's series over time."

## Key design decisions
- **Long/normalized shape**, one row per window per capture, not a wide row.
  Adding Codex or per-model windows (Opus/Sonnet) later is just new `source` /
  `window` values, with no migration.
- **Store `used_pct` as the source reports it**; derive `remaining` (100 −
  used_pct) in the UI. Keeps storage faithful to the source.
- **Normalize all timestamps to ISO-8601 UTC on write.** The statusline source
  reports `resets_at` as epoch seconds; convert on ingest.
- **Latest value = most recent row per `(source, window)`.** No separate
  current-state table.
- **De-duplication is an ingest-time concern, not schema** (OQ-03): only write a
  new snapshot when the latest for that `(source, window)` is older than a few
  minutes or its `used_pct` changed. Keeps the series meaningful and the file
  small.
- **Single SQLite file on disk** satisfies FR-16 (survives restarts). Ample for
  a single-user local tool; retention/downsampling can come later if the file
  ever grows large.

## Migration
One migration creating `usage_snapshots` and its index, applied at startup if
the table is absent (via better-sqlite3). No other structural changes.

## What the Engineer builds against this
- A writer that records a snapshot per successful reading, deduplicated as above.
- A reader for the latest snapshot per window (the live view) and for a window's
  full series (the foundation for feature 3's charts).

## Activity stats — no storage change
The activity stats (token usage, cache hit rate, estimated value, burn rate /
projection) are derived **on demand** from Claude Code's local transcript logs
(`~/.claude/projects/**/*.jsonl`, `message.usage.*`). Those logs are append-only
and already retain full history, so token stats need **no additional storage and
have natural backfill** — unlike the limit windows, which have no history and so
must be snapshotted. The `usage_snapshots` table is therefore unchanged; the
Engineer computes activity stats by reading and aggregating the logs at request
time (with light caching as needed for performance).
