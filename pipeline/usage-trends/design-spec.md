# Design Spec — Usage Trends

## Visual Direction
Extends the design system. New: a Trends section of SVG chart cards and a range
switch. Same tokens, type, and auto light/dark. No chart library.

## Screens / Views

### Trends section (inline, below the tool blocks)
- A header row: "Trends" label + a range switch (pills: 24h / 7d / 30d; 7d default).
- Per tool, a "charts" grid (two-up on desktop, stacked on phone) of chart cards:
  - **Limit remaining over time** — line, 5-hour + weekly (account-wide, from snapshots).
  - **Tokens per day** — stacked bars (cache / input / output, from local logs).
  - **Cache hit rate** — line.
  - **Estimated value per day** — line.
- Each card: title + source/scope note + responsive SVG.
- Any tool with too few points (e.g. Codex now): a dashed "not enough data yet"
  empty card instead.

Key decisions:
- Plain SVG, `width:100%` / `height:auto`, fixed viewBox (responsive).
- Burn line uses accent (5-hour) + teal (weekly); token bars use the mix colors;
  rate/value lines use good/accent.
- Minimal gridlines + small mono y-labels; no axis clutter.

## Component Usage
New: `.range` + `.pill` (range switch), `.card` (chart card), `.charts` grid,
`.empty` (empty state), inline `<svg>` with `.gridline` and `text`. Existing
tokens reused.

## Design Tokens Applied
Existing palette; added `--grid` for gridlines. Series colors map to existing
tokens (accent, teal, mix colors, good).

## Interaction Notes
- The range switch re-requests `/api/trends?range=` and re-renders the charts.
- v1 charts are static SVG (no hover/tooltips); the empty state replaces a card
  when its series is too thin.

## Content Notes
Each card states its source/scope. Plain titles. Empty state: "Not enough data
yet — fills in as you use it."
