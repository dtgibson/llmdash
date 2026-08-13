# Design Spec — Device Health Snapshot

## Visual Direction

Extend llmdash's established limits-first system without changing its visual
language. The four account-window gauges remain the only elevated metric layer;
device health follows as one quiet, host-scoped, flat divided band that makes
CPU, RAM, and disk legible in a single scan without suggesting realtime
monitoring or an overall health verdict.

The canonical `pipeline/design-system.md` applies unchanged. No new token,
font, component library, icon set, or visual direction is introduced.

## Screens / Views

### Single-Host Dashboard

Keep the complete existing account-limits surface first. Place Device health
immediately after it and before Tool details, activity, diagnostics, cost
analysis, and trends.

- The outer health surface uses the existing soft panel, border, and 12px
  supporting radius. It has no gauge shadow.
- The heading is `Device health`, paired with a small `This machine` scope pill.
- Supporting copy reads `A minute-sampled snapshot — quiet context, not realtime
  monitoring.`
- A sample-age string sits opposite the heading on wider screens and wraps
  beneath it on phones.
- CPU, RAM, and Disk share one flat band in that semantic order. Thin dividers,
  not nested cards, separate the metrics.
- A quiet footer reads `Next sample in about a minute · llmdash data volume`.
  It describes cadence and disk target without exposing a path.

The health surface is visually subordinate to account limits by construction:
smaller figures, no elevation, muted labels, four-pixel supplemental bars, and
soft rather than white panel fill.

### Multiple-Host Dashboard

Account limits remain collapsed once at the top using the existing membership
copy. Below them, each reachable host section owns its own Device health band
before that host's machine-local tool activity.

- The host header continues to carry the escaped host label, `you`/tailnet
  context, and freshness.
- The same health component is reused inside the host. Its scope pill changes
  to the host label (`Studio Mac`, `Travel MacBook`).
- There is no combined CPU, RAM, disk, or overall health score.
- An unreachable host keeps the existing named offline callout and renders no
  health values.
- A reachable legacy host renders `Device health unavailable · not reported by
  this host` in the health position without becoming an offline host.

### Available Metric

Each metric cell contains four text-first layers:

1. uppercase metric label and a visible `current` state;
2. the primary numeric value in the established mono figure face;
3. one compact semantic note; and
4. a four-pixel supplemental meter.

CPU and RAM show a rounded whole percentage. Disk shows available binary
capacity as the primary figure plus the available percentage in its note. The
disk label is `Disk available`; the note ends with `data volume`.

The mockup uses plausible content:

- CPU: `42%` · `Non-idle over the last 60s`
- RAM: `68%` · `Active, wired, and compressed`
- Disk: `247 GiB` · `24% available · data volume`

No threshold is labeled healthy, safe, or overloaded. The existing good/warn/
critical hues help scanning but do not make a diagnosis.

### Measuring, Unsupported, and Unavailable

When there is no valid value, the metric keeps its cell in the band but removes
the figure and meter.

- CPU first sample: `measuring` + `Measuring…` + `A second minute sample
  establishes usage.`
- Unsupported platform metric: `unsupported` + `Unsupported` + a fixed,
  platform-neutral explanation.
- Failed metric with no last-good value: `unavailable` + `Unavailable` +
  `The latest sample could not be read.`
- Legacy host: one full-band `Device health unavailable · not reported by this
  host` state rather than three invented unavailable cells.

These states use text and accessible names; no empty meter, zero, animation, or
current timestamp substitutes for missing evidence.

### Update Failure With Last-Good Evidence

Retain the last-good value in its normal position. Replace `current` with the
visible `update failed` state, use a critical supplemental bar, and state
`Last update failed · value sampled 4m ago`. The last-good capture age remains
authoritative and continues through current, aging, and stale bands; the failed
attempt never refreshes it.

### Responsive Layout

- At wider widths, the band is three equal columns with vertical dividers.
- At phone widths, it becomes one vertical sequence with horizontal dividers.
  It does not become three independent cards.
- Host and device headings wrap naturally rather than truncate.
- CPU/RAM/Disk DOM order never changes.
- At 320px, no component or document horizontal scroll is allowed.

The `Hosts`, `Evidence`, `Viewport`, and `Theme` controls in `design.html` are
prototype review tools only. Do not copy them into production.

## Component Usage

The project has no component library. Implement with existing vanilla HTML,
CSS, and JavaScript patterns:

- Reuse `.limits-overview`, account identity, tool lanes, primary limit cards,
  bars, host groups, scope copy, mono figures, and text status conventions.
- Add one shared health renderer for single- and multi-host composition rather
  than separate markup paths.
- Add a soft `device-section`, a flat `health-band`, and three divided
  `health-metric` cells. These are supporting structures, not elevated cards.
- Reuse current escaping, bounded host labels, per-host state, and the existing
  one-second render pass for age-copy updates.
- Add no framework, package, webfont, icon dependency, or build step.

## Design Tokens Applied

Use the canonical tokens without changes:

- Background: `bg` with existing accent/good atmospheric glows.
- Surfaces: `panel-soft` for health; `panel-glass` and `panel` remain reserved
  for the established account and tool layers.
- Dividers: `border`; do not use `border-strong` around individual health cells.
- Text: `text`, `muted`, and `faint`.
- State: `good`, `warn`, `crit` plus their existing backgrounds where a larger
  evidence note needs tint.
- Scope accent: `accent` on `accent-bg`.
- Typography: the established system monospace for figures/labels and system
  sans for body copy. The project design system deliberately wins over the
  general doctrine's display-font recommendation; no new font download is
  appropriate for this zero-dependency extension.
- Shape: 12px health surface, 999px scope pill and bars.
- Depth: no shadow on device health; `gauge-shadow` stays exclusive to primary
  account-window gauges.

## Interaction Notes

- Values replace in place when the existing poller publishes a new snapshot.
  No render or interaction requests a measurement.
- Derive current/aging/stale live from each retained `capturedAt` and the
  reported poll interval. Change only age/state copy between samples.
- Exact boundaries: current through two intervals, aging after two through five,
  stale after five.
- Update failure is additive to the age state; it does not discard the value or
  change capture time.
- Bars express CPU/RAM usage and disk availability, matching the visible words.
  Disk is intentionally availability rather than used space.
- All status and measurement information is visible without hover. Accessible
  names include the metric, number/unit, semantic note, and failure state.
- Prototype segmented controls are keyboard-focusable and update
  `aria-pressed`; production health has no controls.

## Motion Spec

- Metric bar updates: `cubic-bezier(.2,.8,.2,1)`, 220ms, left-center origin,
  immediate width replacement under reduced motion, CSS.
- Prototype review controls: `ease-out`, 160ms, control surface origin,
  immediate state replacement under reduced motion, CSS; review-only.
- Focus ring: `ease-out`, 120–160ms where an existing control already uses a
  transition, control origin, immediate under reduced motion, CSS.
- Device values and evidence copy: no interpolation, entrance, stagger, pulse,
  bounce, hover scale, or motion-on-mount.
- Global reduced-motion rule: every transition is reduced to effectively
  instant under `prefers-reduced-motion: reduce`.

## Content Notes

- Use `Device health` as the section heading.
- Use explicit host scope: `This machine` or the existing bounded host label.
- Use `CPU usage`, `RAM usage`, and `Disk available` in that order.
- Use `current`, `aging`, `stale`, `measuring`, `unsupported`, `unavailable`, and
  `update failed` as visible evidence terms; never expose raw diagnostic enums.
- Say `sampled`, not `live` or `realtime`.
- Use `llmdash data volume` or `data volume`, never a directory or mount path.
- Never state a health verdict. The feature presents evidence so the owner can
  decide whether the machine looks overtaxed.

## Design-System Status

The established `pipeline/design-system.md` applies unchanged. This feature
adds a feature-local composition of existing soft-band, divider, scope, figure,
bar, and evidence patterns; it does not evolve the canonical visual system.

## Design-Lint Notes

`weft-design-lint` reports clean: 1 file scanned, 0 findings. No deliberate
warning or note exceptions remain.
