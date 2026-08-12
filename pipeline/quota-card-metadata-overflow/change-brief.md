# Change Brief — Quota Card Metadata Overflow

## What is changing
Refine the four primary account-window cards so the remaining-quota figure stays
aligned and dominant regardless of reset metadata length. Keep only concise reset
context that fits the card; move source labels, exact configured schedules,
timezones, and other longer evidence to an adjacent quieter layer without losing
it. This stays in Improve territory: presentation changes only, with no new
capability, data source, API, or quota calculation.

## Why now
Claude's Weekly card can render `Configured · <date/time> ·
America/Los_Angeles · resets in <duration>` inside `.win-reset`. The card allows
that string to wrap but does not bound or equalize the header, so it grows and
pushes the percentage below neighboring values, especially in narrow layouts.
The same detailed reset context already appears in the pacing layer, making the
primary card both visually unstable and unnecessarily repetitive.

## User-facing impact
The leading quota boxes remain uniform and glanceable on phone and desktop, with
their large remaining percentages aligned. Reset timing, provenance, configured
schedule detail, and timezone remain visible in a clearly associated supporting
location. Live-over-configured precedence, freshness and stale states, unavailable
windows, multi-host account grouping, and every underlying value stay unchanged.

## Design pass
Needed — this is a responsive layout and hierarchy refinement of the product's
most prominent metric surface. The Designer should define the compact in-card
reset grammar and the nearby home for overflow-prone evidence, covering live,
provider-reading, configured, missing, and unavailable states in both themes and
at the minimum supported width. Moving detail must not become silent truncation.

## Decisions touched
- Cross-surface reading hierarchy — account gauges stay first and dominant;
  pacing and provenance remain quieter supporting layers.
- Reset and billing configuration — current provider evidence still wins, a
  configured fallback stays explicitly labeled, and usage freshness is separate.
- Codex window identity and limits-first grouping — fixed account-window slots
  remain honest and unavailable windows are never filled from other evidence.
- `pipeline/design-system.md` account-limit comparison and primary-panel patterns.

## What done looks like
Every primary window card keeps stable geometry and an aligned quota figure when
reset copy is short, missing, or as long as a configured IANA-zone occurrence.
At desktop and 320–390px widths, long metadata neither increases one card's header
nor pushes its figure below siblings; unavailable slots remain geometrically
coherent. Full reset source/schedule context is still visible and associated with
the correct tool and window. Focused render/layout tests and the full suite pass.
