# Design Spec — Weekly Limit Predictor & Codex Stats
**Feature:** weekly-limit-predictor-and-codex-stats
**Stage:** 4 — The Designer
**Source:** prd.md + schema.md (approved); design.html (approved direction)
**Mode:** extend the locked `pipeline/design-system.md` (one deliberate evolution, see `decisions.md`)

## Visual Direction
The same mobile-first, monospace data readout. Two tools (Claude Code, Codex)
each sit under their own header with 5-hour and Weekly gauges plus a structured
pacing callout. Glanceable, honest about every number's source, light and dark
via `prefers-color-scheme`. Reference mockup: `design.html`.

## Screens / Views

### Dashboard (single view)
- **Headroom strip** (top, `.headroom`, warn-tinted, left accent border): shown
  only when a tool is low or maxed; names the depleted tool and points to the one
  with the most remaining headroom. Considers both windows (already does today).
- **Per-tool block** (`.tool` + `.tool-head`): tool header, two gauges (5-hour +
  Weekly), then the pacing callout, then the activity block and trends.
- **Pacing callout** (`.burn`) — the signature new element. A per-window grid,
  one row per window:
  - left: window-label column (`5-HOUR` / `WEEKLY`, uppercase mono);
  - middle: a plain-language pacing sentence + reset/ETA caption;
  - right: a status pill — `ON PACE` (good), `AT RISK` (warn), `LIMIT REACHED`
    (crit).
  Both windows render at once and are computed independently (FR-06/07/08): a
  maxed window reads "limit reached" on its own row and never suppresses the
  other row. The token-rate figure sits above the two rows. Honest fallback:
  "limit data not available yet" when a window has no reading (NFR-01) — never a
  fabricated ETA or 0%.
- **Activity block** — Codex is now **expanded** (was "not available"): token
  tiles, a token-mix bar, and trends (four charts, for parity with Claude). An
  honesty note states that for Codex, cached tokens are a subset of input, so
  total = input + output and cache hit rate = cached/input.

### States demonstrated in the mockup
- Claude 5-hour 36% remaining (on pace); Claude Weekly 19% remaining (at risk,
  projected to hit before reset).
- Codex 5-hour 53% remaining (on pace) shown beside Codex Weekly 0% remaining
  (limit reached) — proves per-window independence (FR-04).
- Both activity blocks populated; honest cache-subset semantics on Codex.

## Component Usage
- **Reused (locked):** `.tool`/`.tool-head`, `.panel`, gauges, `.bar`/`.bar-fill`
  (fill width = remaining; a maxed window is a full-width crit bar, not blank),
  `.burn`, `.tile`/stat grid, `.mix` token-mix bar, `.section-label`,
  `.headroom`, chart `.card`/`.range`/`.pill`, freshness pulse dot, footer
  honesty line. Plain SVG charts, no chart library.
- **New (deliberate evolution — see `decisions.md`):** a status-pill component
  (`.burn-pill` with `.pill-good`/`.pill-warn`/`.pill-crit`) plus two background
  tokens (`--good-bg` / `--crit-bg`, light + dark); `.burn` restructured from a
  horizontal flex row to `flex-direction: column` to stack the rate above the
  per-window rows.

## Design Tokens Applied
- Existing tokens: accent, status good `#16a34a` / warn `#d97706` / crit
  `#dc2626`, track, panel/border/text/muted, etc.
- New: `--good-bg` / `--crit-bg` for the status-tinted pill backgrounds (defined
  for both light and dark). Status by **remaining %** thresholds: ≥50 good, 20–49
  warn, <20 crit.

## Interaction Notes
- Static, glanceable; theme is automatic via `prefers-color-scheme`. No new JS
  interaction beyond what exists today.
- Pill color and pacing sentence derive from the per-window pacing verdict
  (on pace / at risk / limit reached / not available). The Engineer drives these
  off the `projection.{five_hour, seven_day}` payload and `remainingPct` per
  `schema.md` — render both rows, maxed precedence per row.

## Content Notes
- Plain-language pacing copy: "on pace", "at risk — projected to hit the limit
  before reset", "limit reached". Keep the existing 5-hour wording verbatim
  (FR-08).
- Honesty: the Codex cached-subset note; a footer line noting limits are read
  live off the poller and Codex per-day buckets use UTC timestamps. No fabricated
  zeros anywhere — absent values read as "not available", not "0".
