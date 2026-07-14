# Design Refinement — Dashboard Tool Grouping

## Outcome

Rebuild the dashboard hierarchy around one limits-first comparison followed by
two complete tool stories. The first meaningful region shows Claude Code and
Codex together, with dedicated 5-hour and weekly account-window slots visible
before any activity, pacing evidence, model cap, insight, or trend. A source may
leave a slot honestly unavailable; another window is never relabeled to fill it.
Everything below that
point belongs to either Claude Code or Codex; there are no detached Codex
insights or cross-tool chart piles.

This combines a narrow source-correctness fix with a presentation and DOM-order
change. It preserves ranges, refresh cadence, API contracts, and honesty states,
while correcting which Codex window a provider reading represents.

## Reading Order

1. Header freshness and optional cross-tool headroom warning.
2. **Account limits** — Claude Code 5-hour + weekly, then Codex 5-hour + weekly.
3. Tool-detail range control for the existing shared Trends range.
4. **Claude Code** — pacing, local activity, supplemental model caps, trends.
5. **Codex** — pacing, local activity, deeper insights, trends.
6. Scope footer.

The document order and visual order are identical. CSS must never use `order`
to move a supporting statistic ahead of the four primary account gauges.

## Limits-First Comparison

### Desktop

- Use one `Account limits` surface with an explicit `account-wide` scope line.
- Place Claude Code and Codex in two equal lanes. Each lane has a tool mark,
  plan/freshness line, and two equal gauge cells.
- At the 860px content width, the lanes form a simultaneous four-gauge scan:
  `Claude 5-hour | Claude weekly | Codex 5-hour | Codex weekly`.
- Keep tool identity on the lane rather than repeating a full card header inside
  every gauge. The `◆` / `▲` silhouettes and slim Claude/accent rails remain the
  monochrome-safe identity floor.
- Primary gauges retain the existing elevation, mono figure, semantic status
  color, remaining bar, reset countdown, and used-percent copy.
- When a sanctioned source does not report one window, retain that window's cell
  in the comparison and render `Unavailable` + `not reported by Codex` (or the
  mapped tool diagnostic). Do not show a percentage, reset, pacing status, or
  meter fill for the missing window. In particular, a 7-day primary window must
  never be presented as Codex's 5-hour allowance.

### Mobile (including 320px)

- Stack the two tool lanes while retaining a two-column window grid inside each
  lane. The result is a compact 2×2 gauge region: two Claude windows followed by
  two Codex windows.
- With 11px page gutters and an 8px cell gap, each 320px viewport leaves roughly
  141px per gauge. Reset copy may wrap; figures, labels, and bars may not clip.
- Reduce gauge padding and figure scale only in this compact treatment. Do not
  collapse the gauges into a carousel, horizontal scroller, tab, or disclosure.
- `min-width: 0`, wrapping reset text, and bounded mono figures are required.
  The page must have no horizontal overflow at 320px.
- The unavailable treatment occupies the same compact cell geometry, so a
  missing window cannot collapse the 2×2 comparison or move supporting stats up
  between the remaining gauges.

## Tool Groups

Each `.tool-group` is the principal supporting surface. It carries one tool rail
and one tool header, then uses flat dividers and soft bands inside it rather than
nesting equal-weight cards.

### Claude Code

- **Pacing** immediately follows the group header. Each window remains a distinct
  row with its existing sentence and structural status pill. A missing reading
  keeps its row but says `limit data not available yet` and carries no status
  pill or projection.
- **Activity** contains the existing token, session, cache, estimated-value, and
  token-mix readings. Label it `this machine · local session logs`.
- **Model-specific caps** remain supplemental and account-wide. They appear after
  activity, use the existing compact model-limit rows, and explicitly state that
  they do not add account budget.
- **Trends** closes the group. Preserve existing limit history, token/day, cache,
  and value charts, including honest empty states.

### Codex

- **Pacing** and **Activity** use the same structure as Claude Code.
- **Codex insights** moves inside this group after activity. Keep its independent
  24h / 7d / 30d selector and all existing summary, work-mix, context, timing,
  and daily insight content.
- Keep the account strip inside Codex insights because plan and credit facts are
  account-wide. Label the rest `this machine · structured local Codex metadata`.
- **Trends** closes the Codex group and uses the existing shared Trends range.

The shared Trends selector remains one control and one state. It sits above the
tool groups and updates the charts in both groups; each Trends header repeats the
active range as quiet read-only context. The Codex insights selector remains
independent, matching current behavior.

## Responsive Behavior

- Page max width remains 860px with 16px desktop and 11px phone gutters.
- Primary limits: two tool lanes on desktop; one lane per row under 620px; two
  window cells inside every lane at all supported widths.
- Activity and insight summaries: four columns when space permits, two columns
  on compact widths.
- Charts: two columns only when the reading width supports them; one column on
  compact widths.
- Tool headers, section headers, account strips, and footers may wrap naturally.
  Controls stay at least 32px high and expose visible focus.

## Multi-Host Mapping

- Collect every unique reachable account-limit identity into the primary limits
  region before any per-machine activity. Matching reset epochs still collapse
  to one account reading and name the member hosts once.
- Different-account readings become additional labeled account rows in that same
  limits region; they are not interleaved with activity.
- Below the limits region, retain host-first grouping. Within each host, render
  Claude Code details and then Codex details, with activity explicitly labeled
  for that machine.
- Monitoring stations with no local readings remain dimmed and last. Offline or
  invalid hosts render the existing named diagnostic callout, never zero gauges.
- The single-host view does not gain host chrome.

## Components and Tokens

- Reuse the established `.panel`, `.bar`, `.burn`, `.stat-grid`, `.mix`,
  `.model-limits`, `.insight-surface`, `.charts`, `.range`, and status-pill
  primitives.
- Add only layout wrappers needed to separate the account-limit comparison from
  `.tool-group` detail surfaces.
- Preserve every light/dark token from `pipeline/design-system.md`; Claude uses
  `--claude`, Codex uses `--accent`/`--codex`, and status thresholds stay
  ≥50 good, 20–49 warn, <20 critical.
- Reserve `--gauge-shadow` for the four primary gauges. Supporting surfaces stay
  flat or softly divided.
- Figures remain tabular mono; labels remain compact uppercase mono; explanatory
  text remains system sans.

## Interaction and Motion

- No new product control is introduced. The prototype's Desktop/Mobile switch is
  review-only and must not ship.
- Existing Trends and Codex-insights range buttons preserve hover, active,
  pressed, and `:focus-visible` states plus `aria-pressed` truth.
- Meter and segment widths may transition for 220ms with
  `cubic-bezier(.2,.8,.2,1)`; range state may transition for 160ms ease-out.
- Under `prefers-reduced-motion`, effective transitions are disabled. No entrance,
  stagger, bounce, scale, or continuous animation is added.

## Accessibility and Honesty

- Use headings and landmark sections so a screen-reader pass encounters all four
  account windows before supporting statistics.
- Status meaning is always carried by text (`on pace`, `at risk`, `stale`,
  `limit reached`, `unavailable`) in addition to color.
- SVG plots retain titles/descriptions or equivalent text; empty charts retain
  their existing explicit empty state.
- Account-wide facts and this-machine facts are labeled at the nearest useful
  group, not only in the footer.
- Dynamic tool, plan, host, diagnostic, and metadata strings continue through
  existing escaping and validation paths.

## Implementation Invariants

- No endpoint, payload shape, database schema, polling interval, account scope,
  or menu-bar contract changes.
- Codex windows with explicit durations map by evidence: 300 minutes to 5-hour
  and 10,080 minutes to weekly. Explicitly named legacy fields keep their named
  meaning; positional fallback is allowed only when no duration is supplied.
- An unknown explicit duration is unavailable rather than guessed.
- The latest complete Codex reading is authoritative for which live windows
  exist. A missing window does not fall back to an obsolete snapshot from a
  prior response shape or plan.
- Newly captured history uses the corrected window identity. Existing snapshot
  rows remain stored, but cannot repopulate an explicitly absent live gauge.
- No percentage is recalculated or duplicated as a second budget.
- No menu-bar dropdown behavior or output changes in this dashboard-only pass.
- Existing stale, aging, no-reading, auto-refresh failure, model-cap, multi-host,
  and Codex-insight unavailable states move with the content they qualify.
