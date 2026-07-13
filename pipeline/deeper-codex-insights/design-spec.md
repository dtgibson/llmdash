# Design Spec — Deeper Codex Insights

## Visual Direction
Extend llmdash’s calm technical readout with a quieter diagnostic layer beneath
the existing tool and host sections. Account limits remain the focal point;
Codex insights use flat divided bands, restrained bars, and precise scope copy so
they feel explanatory rather than competitive.

## Screens / Views

### Dashboard — Codex Insights
Place one standalone `▲ Codex insights` section after `#tools` / `#hosts` and
before global Trends. The header carries `This machine · structured local Codex
metadata` on the left and an independent 24h / 7d / 30d range switch on the
right. This location and scope remain the same in single- and multi-host views;
the section never implies it contains remote-machine activity.

Immediately below the header, show one quiet account-facts strip:
`Account-wide · ChatGPT Pro · Credits available · 2 reset credits`. Account
facts do not change when the range changes and may remain visible when local
activity is empty.

The activity body has three layers:

- A flat four-cell summary band: reasoning share with counts, average tokens per
  turn with turn count, sessions with average tokens/session, and busiest UTC day
  with token total.
- A desktop two-column detail band, stacked on narrow screens. `Work mix` shows
  bounded model, effort, and tool-category rows with short horizontal shares.
  `Context & timing` uses aligned definition rows for peak context pressure,
  turns at or above 80%, compactions and affected sessions, total-duration
  median/p95, and first-token median/p95.
- When at least two supported daily points exist, a quiet two-chart row for
  reasoning share and average tokens/turn. Omit the whole row when thin.

Do not create cards inside cards. The section has one soft outer surface; summary
cells and detail columns are separated by borders and whitespace rather than
shadow. All figures remain textually labeled and color only reinforces share or
status.

### Loading, Empty, Partial, and Error States
- Initial loading: one dashed full-width state, `Reading local Codex session
  metadata…`.
- Empty range: keep account facts and show one message, `No supported Codex
  activity was recorded in the last 7 days on this machine.` Do not render empty
  tiles or charts.
- Partial support: preserve the metric’s location and render the literal
  `Unavailable` plus a short fixed explanation such as `Completed-task timing
  wasn’t recorded by this Codex version.` A supported zero renders `0`.
- Endpoint error: `Codex insights are unavailable right now — account limits
  above are unaffected.` Existing limits, tools, hosts, and Trends continue to
  render.
- Updating an already-rendered range keeps the prior values visible with a quiet
  `Updating…` status; stale responses never replace a newer selection.

## Component Usage
Use the existing vanilla components and vocabulary: `.section-label`, `.range`
/ `.pill`, `.stat-grid` / `.tile`, `.bar`, `.empty`, plain SVG chart primitives,
mono figures, and the Codex `▲` mark. Add feature-specific wrappers for the
account strip, work-mix rows, context/timing definition rows, and two-chart band.
No component, icon, chart, or motion library is added.

## Design Tokens Applied
Use the established `pipeline/design-system.md` tokens unchanged: automatic
light/dark themes; `--panel-soft` for the single insight surface; `--border` for
dividers; `--accent` / `--accent-bg` for Codex identity, active range, and the
primary series; `--teal` for the second series; `--text`, `--muted`, and
`--faint` for hierarchy. Figures use `--mono`; supporting copy uses `--sans`.
The section stays within the 860px reading width and uses the existing 10–16px
radius and spacing scale. No new shadow or elevation token is introduced.

## Interaction Notes
- The insight range is independent from the existing Trends range. Buttons expose
  `aria-pressed`, visible hover/focus states, and a textual active range.
- Range changes update every activity-dependent value atomically. Account facts
  stay fixed. The previous view remains visible while updating.
- Each chart has an accessible title/description and a compact hidden textual
  equivalent. Mix bars repeat their values in visible text.
- At 620px the detail and chart bands stack; at 430px the header/range stack. The
  four-cell summary becomes two columns and stays free of horizontal scrolling
  at 320 CSS pixels.

## Motion Spec
- Range-control state: ease-out, 160ms, control center, instant under reduced
  motion, CSS.
- Share/context bar value change: `cubic-bezier(.2,.8,.2,1)`, 220ms, left center,
  instant under reduced motion, CSS.
- Focus ring: ease-out, 120ms, control center, no transition under reduced
  motion, CSS.
- Updating values use no entrance animation, pulse, stagger, scale, or bounce.

## Content Notes
Copy is compact, factual, and diagnostic. Always distinguish `This machine` from
`Account-wide`, call UTC day bucketing by name, and use `recorded` where local
logs may be incomplete. Never claim productivity, prescribe behavior, or expose
prompt/response/tool content. Use `Unavailable` for unsupported fields, not a
dash when a dash could be mistaken for zero.
