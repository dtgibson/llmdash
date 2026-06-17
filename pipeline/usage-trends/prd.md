# PRD — Usage Trends
**Feature:** usage-trends
**Date:** 2026-06-16
**Stage:** 2 — The Planner
**Source:** strategic-brief.md (approved)

## Feature Overview
Add an inline **Trends** section to the dashboard page with vanilla-SVG charts of
usage over time for both tools: limit-burn (remaining % per window), tokens per
day by type, estimated value over time, and cache hit rate over time, with a
24h / 7d / 30d range switch.

## User Stories
> **US-01** — As the owner, I want each window's remaining % over time per tool, so I can see my burn curve and when windows reset.
> **US-02** — As the owner, I want tokens per day (by type) per tool, so I can see how heavy each day was and the cache share.
> **US-03** — As the owner, I want estimated value over time, so I can see the dollar-equivalent trend.
> **US-04** — As the owner, I want cache hit rate over time, so I can tell if efficiency is drifting.
> **US-05** — As the owner, I want a range switch (24h / 7d / 30d), so I can zoom the trends.
> **US-06** — As the owner, I want charts that read clearly on my phone and handle thin/empty data without breaking.

## Functional Requirements

*Data series*
> **FR-01** — Expose a limit-burn series per (tool, window): remaining % over the range, from `usage_snapshots`.
> **FR-02** — Expose a tokens-per-day series per tool, split input / output / cache, from each tool's logs over the range.
> **FR-03** — Expose an estimated-value-per-day series per tool, using each tool's pricing.
> **FR-04** — Expose a cache-hit-rate-per-day series per tool.
> **FR-05** — Day-level series shall be aggregated and cached so a chart request doesn't re-scan all logs every time.

*Charts (vanilla SVG)*
> **FR-06** — Render each series as plain SVG (line for burn/rate, bars for tokens/value), no chart library.
> **FR-07** — Charts live in a new Trends section inline below the tool blocks, grouped per tool.
> **FR-08** — Charts use design-system tokens and are readable on a phone (responsive width).
> **FR-09** — Each chart labels its metric/units and states its source/scope (account-wide vs local logs).

*Range switch*
> **FR-10** — A range control (24h / 7d / 30d) re-scopes all trend charts.
> **FR-11** — Default range is 7d.

*Empty / thin data*
> **FR-12** — A series with too few points shows a clear "not enough data yet" state, not a broken axis.
> **FR-13** — Existing gauges and activity behavior is unchanged.

## Non-Functional Requirements
> **NFR-01 — Performance:** 30d aggregation is bounded (mtime-filtered reads, cached) so the page stays responsive.
> **NFR-02 — Consistency:** charts reuse design-system tokens; no new dependencies.
> **NFR-03 — Security:** trend data exposes only aggregates/timestamps (no tokens/PII); existing headers/posture apply.
> **NFR-04 — Reliability:** a failure building one series doesn't break the page or other charts.
> **NFR-05 — Compatibility:** SVG charts render on current mobile and desktop browsers.

## Out of Scope
- A separate Trends page; a chart library; CSV/export; alerts; Kagi; ChatGPT chat caps.
- Backfilling limit-burn history from before logging began.

## Open Questions
> **OQ-01** — Trend data transport: extend `/api/state` vs a separate `/api/trends?range=`. *Default:* a separate `/api/trends` endpoint, loaded after the gauges, to keep the at-a-glance state lean.
> **OQ-02** — Day boundary/timezone. *Default:* local time (matches "today").
> **OQ-03** — Burn-chart granularity. *Default:* plot raw snapshot points over the range; the sawtooth shows resets.
> **OQ-04** — "Enough to plot" threshold. *Default:* ≥2 points for a line, else the empty state.

## Success Metrics
| ID | What's Being Verified | Pass Condition |
|---|---|---|
| QA-01 | Limit-burn chart | Remaining-% line per window per tool from snapshots over the range |
| QA-02 | Tokens/day chart | Tokens per day split by type per tool from logs |
| QA-03 | Value-over-time | Estimated value per day per tool |
| QA-04 | Cache-rate chart | Cache hit rate per day per tool |
| QA-05 | Range switch | 24h/7d/30d re-scopes all charts |
| QA-06 | Vanilla SVG, no deps | Charts are SVG; package.json deps still empty |
| QA-07 | Mobile readable | Charts legible at phone width |
| QA-08 | Empty/thin state | Sparse series shows "not enough data yet", not a broken chart |
| QA-09 | Source labeling | Each chart labels source/scope; right tool attribution |
| QA-10 | Performance | 30d loads without rescanning all logs each request |
| QA-11 | No leakage | Trend responses are aggregates/timestamps only |
| QA-12 | Existing unaffected | Gauges and activity behave exactly as before |
