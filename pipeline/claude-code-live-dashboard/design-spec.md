# Design Spec — Claude Code Live Dashboard

## Visual Direction
Simple, functional, and fast: a library-light, plain-HTML page that reads like a
focused data readout. Monospace numerals for figures, system fonts for
everything else, intentional whitespace, automatic light/dark. Honest and
glanceable, with no decoration for its own sake.

## Screens / Views

### Dashboard (single page)
A single scrolling page, mobile-first, centered at ~720px max width.

- **Header:** wordmark `llmdash · Claude Code` and a live freshness indicator
  ("updated Ns ago") with a small green pulse dot.
- **Limits section:** two panels (5-hour, weekly), side by side on wider screens,
  stacked on mobile. Each shows a large remaining-% mono figure, a "remaining"
  label, a status-colored progress bar (fill width = remaining; green ≥50, amber
  20–49, red <20), a "% used" line, and the reset time plus a live countdown.
- **Activity section:** a featured burn-rate callout (tokens/hour plus a
  plain-English projection to the 5-hour limit relative to its reset), then a
  four-tile grid: Tokens · 5h (weekly underneath), Tokens · today (with session
  count), Cache hit rate, Est. value · week.
- **Footer:** the honesty line (limits are account-wide; activity is from local
  logs) and "served over Tailscale."

Key decisions:
- Remaining is the headline; used is shown small.
- Status color pulls the eye to anything running low.
- The burn projection is the most prominent activity stat because it is the most
  actionable.

## Component Usage
No component library. Plain semantic HTML with CSS classes: `.panel` (primary
metric cards), `.tile` (secondary stats), `.bar` / `.bar-fill` (status bars),
`.burn` (featured callout), `.section-label` (uppercase group headers).

## Design Tokens Applied
See `pipeline/design-system.md`. Figures in monospace with tabular-nums; status
palette green/amber/red; accent blue for the burn callout; neutral panels with
1px borders and 10–12px radius; auto light/dark via `prefers-color-scheme`.

## Interaction Notes
- Reset countdowns and the freshness age tick live (setInterval).
- Status colors and bar widths are derived from the remaining value at render.
- Auto-refresh (FR-09): the page re-pulls the latest data on an interval and
  updates figures in place, no manual reload.

## Content Notes
Plain, precise copy. Real numbers, never placeholders. Tabular-nums on all
figures. The honesty footer line stays.
