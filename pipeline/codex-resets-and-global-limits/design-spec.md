# Design Spec — Codex Resets and Global Limits

## Visual Direction

Extend llmdash's established limits-first visual system without changing its
look. The four standard 5-hour and weekly gauges remain the only strongly
elevated layer; reset credits and model caps form a flat, account-scoped band
immediately beneath them. The treatment stays compact, monospace-led,
light/dark automatic, mobile-first, and explicit about evidence quality.

The interactive controls above the mockup are review tools only. They do not
ship in the dashboard.

## Screens / Views

### Top Account Limits — One Account

Keep the existing Account limits heading, account-wide scope copy, Claude lane,
Codex lane, and two fixed window cards per lane.

- Desktop keeps Claude and Codex side by side.
- Phone stacks the two tool lanes, while each lane retains its two-column
  5-hour/weekly grid.
- Primary gauge values, resets, status colors, shadows, and binding semantics
  do not change.
- A small account-identity row sits above the lanes. It says that this account
  is shown once and names the host membership when readings collapse.

Directly after both primary lanes, add an Other global limits section. It is
inside the same account surface but separated from the primary gauges by one
quiet divider.

- The section uses a flat two-column divided band on desktop, not more elevated
  cards.
- Claude model caps occupy the Claude column.
- Codex reset credits occupy the Codex column.
- On phone the columns stack in the same semantic order, after all four primary
  gauge slots and before any pacing or machine-local content.
- A final honesty line states that everything in the block belongs to one
  account and machine-local usage begins below.

### Codex Reset Credits

The group header uses the existing Codex triangle mark and the label
Codex reset credits. A compact figure on the right shows the authoritative
count as N available.

When resets are available:

- List every known expiration in an ordered list, soonest first.
- Each row has a quiet numbered marker, a localized medium date, local time,
  and timezone abbreviation.
- Preserve the canonical provider instant in a semantic time element.
- Show a short relative phrase only as secondary context. The absolute
  date/time remains the authoritative visible value.
- Identical expiration instants may collapse to one row only when that row
  states the exact quantity represented.

Evidence states:

- **Full:** show the authoritative count and every expiration.
- **Zero:** show 0 available, no expiration rows, and explain that there are no
  dates because no resets are currently available.
- **Partial:** preserve the authoritative count, show every valid expiration,
  add a partial text pill, and state the exact number of unavailable expiration
  dates.
- **Malformed:** show Count unavailable, add a malformed text pill, and say
  that no count or date was guessed.
- **Unsupported/unavailable:** show Unavailable, add an unsupported text pill,
  and explain that the standard Codex windows remain unaffected.
- **Stale:** keep the last-good count and dates, add a stale plus age text pill,
  and state that the original capture is old and may have changed.
- **Source error with last-good evidence:** retain the last-good count and
  dates, add a source error text pill, and use the critical-tinted note to name
  the failed latest read and age of the evidence.
- No state relies on color alone, hover, a tooltip, or a secondary page.

### Claude and Future Model Caps

Reuse the generic modelLimits content and existing provider-facing labels.
Each row shows:

- Model or cap name.
- Provider window or scope.
- Remaining percentage.
- Reset evidence when valid.
- A thin status bar using existing good, warn, and critical thresholds.

Fable and Sonnet are examples, not a closed list. Unknown future bounded model
caps use the same row without special-case visual treatment. Do not keep an
exact duplicate of these rows in the lower Claude detail group.

### Multiple Accounts

Render one complete account block per distinct account. Each block owns its
primary windows, model caps, and reset credits.

- Same-account readings from several hosts collapse once and name their host
  membership.
- Different accounts remain separated by a strong section divider and an
  account label.
- Never merge reset counts, expiration lists, or model caps across accounts.
- Select the newest valid same-account evidence, but retain its original
  freshness state.

### Lower Tool Details

Pacing, machine-local activity, diagnostics, insights, and trends keep their
existing position and hierarchy below the complete account story.

- Remove the lower Claude model-cap block after its canonical move to the top.
- Remove the lower Codex reset-credit count from account insight copy.
- Update lower summary copy so it no longer promises model caps there.
- The menu-bar surface is unchanged.

### Responsive and Accessible States

- Preserve semantic DOM order: page heading, account identity, primary gauges,
  other global limits, evidence notes, then local details.
- At 320px and wider, page and component scroll widths must fit the viewport.
- Keep all dates visible without horizontal scrolling.
- Use headings for account and supplementary sections, ordered lists for
  expirations, and text equivalents for every status color.
- Keep keyboard focus treatment on any existing interactive controls.
- The production global-limit band itself contains no buttons or hidden
  hover-only content.

## Component Usage

This project has no component library. Build with the existing vanilla HTML,
CSS, and JavaScript renderer:

- Reuse the limits overview, limit tools, tool lanes, window grid, limit cards,
  bars, tool marks, pills, and evidence-note grammar.
- Add one flat supplementary account band, two tool-aligned limit groups,
  generic model-limit rows, the reset-count figure, and the ordered expiration
  list.
- Reuse existing escaping, freshness, status-color, and account-collapse
  helpers rather than creating a separate rendering path.
- Do not add a framework, package, font download, icon dependency, or chart
  library.

## Design Tokens Applied

Use the existing tokens in pipeline/design-system.md and public/styles.css:

- Surface: panel glass, panel soft, and panel.
- Dividers: border and border strong.
- Text: text, muted, and faint.
- Identity: Claude and Codex.
- Status: good, warn, crit, and their matching background tokens.
- Accent: accent and accent background.
- Type: existing monospace figures and labels with sans body copy.
- Shape: 16px account surface, 13px gauges, 8–10px supporting notes, 999px
  pills and bars.
- Depth: the gauge shadow remains exclusive to the primary window cards.
  Supplementary global limits are flat.
- Theme: existing automatic prefers-color-scheme behavior.

No new visual token is required.

## Interaction Notes

- Render from the poller-owned cached account data. Requests and render ticks do
  not trigger a provider read.
- Re-evaluate expiry availability against the current render time so a freshly
  expired credit stops appearing as available.
- Sort valid expiration instants ascending before rendering.
- Group exact duplicate instants losslessly with an explicit quantity.
- Preserve explicit zero separately from missing, malformed, unsupported,
  stale, and error states.
- Derive date/time display in the browser's locale while keeping enough time
  and timezone context to avoid a misleading calendar day.
- The Evidence, Accounts, Viewport, and Theme switches in design.html are
  prototype controls only and must not be copied into public/index.html.

## Motion Spec

- Primary and model bar-width updates: cubic-bezier(.2,.8,.2,1), 220ms,
  left-center origin, jump directly under reduced motion, CSS.
- Existing range and focus state: ease-out, 120–160ms, control origin,
  immediate under reduced motion, CSS.
- Account and global-limit content: no entrance animation, no stagger, no
  pulsing, no hover scaling, and no continuous decoration.
- Evidence updates: replace content in place; status text changes immediately.
  Only existing bar-width motion is retained.

## Content Notes

- Use Other global limits for the supplementary heading.
- Use Codex reset credits and N available for the reset summary.
- Use Claude model caps for the generic model-limit group.
- Use Shown once in account membership copy to reinforce deduplication.
- Use direct, fixed evidence copy. Never render raw provider enums, IDs, titles,
  descriptions, or diagnostics.
- Keep the account/local distinction explicit: all readings in this block
  belong to one account; machine-local usage begins below.
- Dates are normal visible content, never title attributes or tooltip-only
  details.

## Design-System Status

The approved design extends the established llmdash system without visual
evolution or token changes. The reusable addition is a flat supplementary
account-limit band beneath the elevated primary gauges, with generic
tool-aligned rows and lossless evidence-state copy.
