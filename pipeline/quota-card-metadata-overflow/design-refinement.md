# Design Refinement — Quota Card Metadata Overflow

## Visual Direction

Keep llmdash's established limits-first hierarchy and remove one source of visual
instability: reset evidence no longer competes with the remaining-quota figure
inside a primary gauge. Each gauge becomes a fixed reading stack — window label,
remaining figure, used state, meter, then a bounded countdown — while full reset
provenance stays in the existing, quieter pacing layer for that tool and window.

This is an extension of the established design system, not a visual evolution.
All tokens, typography, tool marks, status thresholds, radii, elevation, and
light/dark behavior remain unchanged.

## Screens / Views

### Account Limits — Refined Gauge

The four fixed account-window slots keep their current order and grouping. Every
available gauge uses the same vertical rows:

1. Window label: `5-hour` or `Weekly`; no reset copy shares this header row.
2. Remaining figure: the existing large tabular mono percentage.
3. Usage state: `remaining · 28% used` or the existing `limit reached` state.
4. Status meter: existing threshold color and fill semantics.
5. Compact reset: uppercase label plus a bounded value, e.g. `RESET · 3h 42m`.

The compact reset row is generated from duration data only. It never receives a
provider label, formatted date, schedule, timezone, freshness string, host name,
or arbitrary source text. Its complete grammar is:

| State | In-card copy |
| --- | --- |
| Future reset | `RESET · 3h 42m`, `RESET · 2d 4h`, or `RESET · now` |
| Reset missing/expired | `RESET · —` |
| Window unavailable | `RESET · —` |

Do not truncate, clamp, fade, tooltip, or ellipsize long evidence in a gauge.
Long evidence is structurally absent from this slot, so the compact line can be
`white-space: nowrap` without hiding information.

Use explicit grid rows or equivalent reserved value geometry so every available
percentage starts on the same baseline. The unavailable treatment occupies the
same card height and row sequence: label, `Unavailable`, source-specific note,
dashed meter, and `RESET · —`. It never fabricates a percentage.

### Pacing — Reset Evidence Home

The existing pacing band remains the supporting location for full reset evidence;
do not add another elevated card, disclosure, or new product control. Each pacing
row is already bound to one named tool and one named window, so it can wrap freely
without moving any quota figure.

- Live/provider evidence: name the source in the quiet `.burn-cap` line and keep
  the countdown, e.g. `Live provider reading · resets in 3h 42m`.
- Configured fallback: retain the exact next occurrence and timezone, e.g.
  `Configured · Fri, Aug 14 at 11:00 PM PDT / America/Los_Angeles · before it
  resets in 2d 4h — at risk`.
- Reset missing: say `Reset time not reported · pacing unavailable`.
- Window unavailable: retain the existing honest no-reading explanation and no
  pacing pill or projected value.
- Freshness and stale-reading diagnostics stay in their existing age pill and
  limit-note locations. A configured reset never makes a usage reading fresh.

Provenance appears once in the pacing row, not once in the gauge and again in
pacing. Current provider-over-configured precedence and all underlying values are
unchanged.

### Current-vs-Refined Review

The mockup deliberately shows the current failure beside the refined treatment.
The current Claude Weekly header contains the full configured occurrence and
IANA timezone, demonstrating how its wrapped header displaces the figure. The
refined example keeps both figures aligned and shows the same long evidence in
the pacing band below.

### Responsive States

- Desktop: tool lanes remain side by side; each lane keeps its two-window grid.
- At `620px` and below: tool lanes stack, while each lane still keeps two window
  cells. No carousel, horizontal scroller, tab, or disclosure is introduced.
- At `390px` and `320px`: retain 11px page gutters and the existing compact card
  padding. The bounded reset line stays on one line; detailed pacing evidence may
  wrap naturally below the complete four-slot comparison.
- Card height and figure baseline do not depend on reset state, source, locale,
  timezone length, or evidence copy.
- Document and component scroll width must not exceed the viewport at 320px.

## Component Usage

- Reuse `.limits-overview`, `.limit-tools`, `.limit-tool`, `.window-grid`,
  `.panel`, `.limit-card`, `.remaining`, `.sub`, `.bar`, `.bar-fill`, `.burn`,
  `.burn-line`, and `.burn-cap`.
- Simplify `.limit-card-head` to the window label only; remove `.win-reset` from
  the header rather than trying to equalize an unbounded text region.
- Add one small semantic reset footer inside each card (for example,
  `.limit-reset-compact` with separate label/value spans). It is presentation of
  existing reset data, not a new component surface.
- Keep `◆` Claude and `▲` Codex lane identity, the thin tool rail, and the four
  primary gauges as the only strongly elevated metric layer.
- Keep long reset evidence in the existing pacing rows. No reset-detail card or
  duplicate account band is added.

## Design Tokens Applied

- Colors, automatic light/dark themes, and threshold semantics come unchanged
  from `pipeline/design-system.md`.
- Primary gauge surfaces continue to use `--panel`, `--border-strong`, and
  `--gauge-shadow`; the reset footer uses `--faint` with its value promoted to
  `--muted` for legibility.
- Remaining figures stay tabular mono at the existing desktop and phone scales.
  Window and reset labels use the existing compact uppercase mono role.
- Existing spacing and radius values remain: 13px desktop gauges, 11px compact
  gauges, and the current 8–10px window gaps.
- No new colors, fonts, icon library, shadows, or dependencies.

## Interaction Notes

- There is no new product interaction. The mockup's theme buttons are review-only
  and must not ship; production continues to follow `prefers-color-scheme`.
- Countdown updates continue on the existing one-second render tick. The reserved
  footer width and tabular numerals prevent layout jitter as values change.
- Provider/configured precedence, reset-boundary refetch, freshness, account
  grouping, multi-host collapse, and settings behavior do not change.
- The full pacing sentence remains normal readable DOM text and may wrap. Do not
  hide evidence behind hover, title text, or a pointer-only affordance.

## Motion Spec

- Gauge meter value change: `cubic-bezier(.2,.8,.2,1)`, 220ms, left center,
  effectively instant under reduced motion, CSS.
- Review-only theme control: ease-out, 160ms, control center, no transition under
  reduced motion, CSS; not part of production implementation.
- Focus ring: ease-out, 120ms, control center, no transition under reduced motion,
  CSS.
- Quota figures and reset countdown text do not animate on tick. No entrance,
  stagger, pulse, bounce, blur, or hover-scale motion.

## Content Notes

- The focal copy is the percentage remaining. Avoid adding explanatory prose to
  the gauge.
- Use `RESET` as the compact footer label and an em dash for unavailable timing.
- Preserve the existing `remaining · N% used`, `limit reached`, `Unavailable`,
  and source-specific unavailable explanations.
- Full evidence copy stays specific and honest: source label, exact configured
  occurrence, timezone, countdown, and pacing consequence where known.
- Dynamic provider, schedule, timezone, plan, host, and diagnostic strings must
  continue through the existing escaping and validation paths.

## Accessibility and Honesty

- Semantic order remains all four account-window slots before pacing or other
  diagnostics.
- Status remains text-first as well as color-coded. An unavailable window has no
  percentage or filled meter.
- The compact footer is visible text; do not duplicate it through a generic card
  `aria-label`.
- Detailed evidence remains keyboard- and screen-reader-readable without an
  interaction. Its tool and window association must be explicit in nearby
  headings/labels.
- Light and dark modes must preserve WCAG AA text contrast at both desktop and
  minimum-width layouts.

## Engineer Acceptance Decisions

1. Split compact countdown formatting from detailed reset evidence formatting;
   do not pass a `showProvenance` flag into the gauge formatter.
2. Render only the bounded reset duration in the gauge footer.
3. Render source/date/timezone evidence once in the corresponding pacing row.
4. Reserve deterministic card rows so the figure baseline is identical for live,
   provider-reading, configured, missing-reset, maxed, and unavailable states.
5. Preserve raw provider payloads, reset selection precedence, account keys,
   polling, API contracts, history, and menu-bar output.
6. Add focused DOM/copy and measured-layout coverage at desktop, 390px, and 320px;
   assert equal figure top/baseline positions, equal card heights, no horizontal
   overflow, bounded in-card grammar, and full evidence still present in pacing.

## Design-System Status

Established and unchanged. This refinement clarifies how the existing primary
metric panel and pacing patterns divide compact status from detailed evidence;
it does not require an update to `pipeline/design-system.md`.
