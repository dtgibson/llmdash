# Strategic Brief — Usage Trends

## What We're Building
Charts added to the existing dashboard page (below the current gauges and
activity) showing usage over time for both tools, all in vanilla SVG: limit-burn
lines, tokens per day by type, estimated value over time, and cache hit rate over
time, with a 24h / 7d / 30d range switch.

## Why Now
The dashboard already logs limit snapshots, and the logs hold token history, so
the data exists. Trends turn the at-a-glance gauges into understanding: how fast
you really burn, what your patterns are, when you tend to hit walls.

## The User Problem
The gauges tell you "now." They don't tell you "how did I get here" or "what's my
pattern" — whether today is unusually heavy, how your burn curve looks across a
week, or whether your cache efficiency is drifting.

## Success Criteria
- Below the live gauges, for each tool: a limit-burn line (remaining % over time,
  per window), tokens per day (by type), estimated value over time, and cache hit
  rate over time.
- A range switch (24h / 7d / 30d) re-scopes the charts.
- Plain, readable SVG, no chart library, consistent with the design system, fine
  on a phone.
- Graceful with thin/empty data (Claude limits recent, Codex empty) — no broken
  axes, a clear "not enough data yet" state.
- Honesty preserved: limit history (account-wide snapshots) vs token charts
  (local logs), labeled.

## Scope
- Limit-burn charts from the `usage_snapshots` series (per source, window).
- Token / value / cache charts from each tool's logs, aggregated per day.
- Vanilla SVG line + bar charts, a range selector, inline below the existing
  sections, with empty states.

## Out of Scope
- A separate Trends page (you chose one page); a chart library; alerts; CSV
  export; Kagi; ChatGPT chat caps.

## Key Decisions
- All on one long page — it's a personal status page.
- Vanilla SVG, zero new dependencies.
- Token series have deep history (Claude) with full log backfill; limit-burn
  series start from when logging began (no backfill), Codex fills in as used —
  charts degrade gracefully.
- Day-level aggregation (cached) for the token/value/cache charts; stored
  snapshots for limit-burn.
