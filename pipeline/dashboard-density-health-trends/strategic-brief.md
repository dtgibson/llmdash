# Strategic Brief — Dashboard Density and Health Trends

## What We're Building
Recompose the existing dashboard so quota headroom, reset entitlements, pacing,
and per-machine health form a compact first-read summary. Add a small chart that
shows each machine's once-per-minute CPU, RAM, and available-disk samples across
the latest hour.

## Why Now
llmdash already has the evidence needed to answer the owner's most urgent
questions, but the current page makes them scroll through lower-priority detail
before they can assemble the full picture. Device-health sampling also shipped
without history, leaving short spikes and sustained pressure indistinguishable.
This is the natural follow-on to the current snapshot and the dashboard's
existing pacing work.

## The User Problem
The owner checks llmdash to decide whether there is enough quota and machine
capacity for the work ahead. They need remaining percentages, usable resets and
other quotas, pacing, and machine pressure visible together, while still being
able to scroll into diagnostic detail. A current health number alone cannot show
whether pressure is momentary or has persisted through the last hour.

## Success Criteria
- The first viewport prioritizes remaining quota, extra allowances/resets,
  pacing, and host-scoped machine health without hiding evidence state.
- Lower-urgency account, activity, cost, and diagnostic detail remains available
  below the summary rather than competing with it.
- Each reachable host can show up to 60 once-per-minute CPU, RAM, and disk-
  available observations for the preceding hour in a compact, readable chart.
- Missing, measuring, stale, failed, and older-peer health evidence remains
  explicit; gaps are not interpolated and unavailable values are not plotted as
  zero.
- The single-host and multi-host views preserve host identity and never combine
  machine-health histories.
- The denser composition remains legible on phone and desktop and respects
  reduced-motion preferences.

## Scope
- Reorder and compact the existing dashboard hierarchy around urgent signals.
- Add a bounded per-host, per-process one-hour health sample ring maintained by
  the existing minute poller.
- Extend the read-only local and peer state contracts with optional bounded
  health history.
- Strictly normalize peer history, including finite values, canonical times,
  bounds, and host isolation.
- Add accessible SVG trend rendering for CPU used, RAM used, and disk available.
- Cover sampling, bounds, degraded states, peer normalization, layout, and
  rendering with deterministic tests.

## Out of Scope
- Long-term machine-health persistence, backfill, forecasting, or alerts.
- Combining health across machines or inventing aggregate device-health scores.
- Per-process resource attribution, process lists, temperature, battery, or
  network telemetry.
- Changes to how AI quota snapshots, cost history, or activity logs are
  collected.
- New mutation routes, public hosting, or a broader authentication model.

## Key Decisions
- Treat the chart as a New Feature because it adds a visible capability and a
  new bounded history model; keep the density refinement in the same coherent
  build.
- Keep health history process-lifetime and bounded to 60 samples per host; do
  not place it in the irreplaceable usage-history database.
- Let the existing minute poller own sampling. HTTP handlers only read detached
  cached data and never trigger probes.
- Chart gaps honestly and keep CPU/RAM used semantics distinct from disk-
  available semantics.
- Preserve one canonical home for global quotas and reset entitlements while
  promoting their summary rather than duplicating the same allowance.
- Keep exact health history attached to the machine that produced it, including
  across peer normalization and rendering.
