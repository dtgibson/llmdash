# Design Spec — LLM Cost Over Time

## Direction

Extend the established llmdash dashboard with one secondary **Cost analysis**
surface. Account limits remain the first and only elevated metric layer. Pacing
and supporting activity still follow those gauges; cost analysis begins only
after that operational story. The new surface uses the existing flat divided
bands, monospace figures, quiet SVG charts, and explicit scope/evidence copy. It
does not introduce a new dashboard shell, global token, layout hierarchy, card
system, or decorative motion.

The core design rule is separation: a configured fixed-access cost and two
counterfactual API valuations can be compared, but never blended into one
"total cost." Every visible value uses its full metric name nearby.

## Placement and Page Hierarchy

Production placement is after the account-limit comparison, tool pacing, and
supporting local activity, before the existing historical trend content. In the
current DOM this should be one standalone section after the relevant tool-detail
activity surfaces rather than inside either Claude or Codex's `.tool-group`.
That gives Combined, Claude, and Codex equal footing without creating a card
inside a card. In multi-host mode, render the section once for the binding
machine; do not repeat it under peer hosts.

Reading order:

1. Existing Account limits and freshness.
2. Existing per-tool pacing and supporting local activity.
3. Cost analysis header and independent range.
4. Combined four-metric summary.
5. Meaning/honesty line.
6. Combined, Claude, and Codex reconciliation rows.
7. Combined cumulative chart, then Claude and Codex cumulative charts.
8. Subscription, scan, pricing, and time provenance.
9. Existing operational trends and footer.

No cost value is added to the SwiftBar title, dropdown, peer payload, or primary
account-limit surface.

## Header and Range

The header is `Cost analysis` / `Configured spend and API-equivalent value` with
an inline `This machine` scope tag. Supporting copy says `Claude + Codex local
usage · fixed subscription access and two counterfactual API estimates stay
separate.`

The range uses the existing `.range` / pill-button interaction with exactly `7d
/ 30d / 90d`; `30d` is initially selected. It is independent of both global
operational Trends and Codex Insights ranges. Buttons use `aria-pressed`, retain
a visible focus ring, and update the whole cost surface atomically. While a new
range is loading, production keeps the prior surface and generation timestamp
visible, marks it `Updating…`, and rejects stale out-of-order responses by
request token.

Directly below the header, the metadata strip reads:

`This machine · Claude + Codex` · selected local-date interval through the
generation time · IANA timezone · generated age.

The current day is always phrased `through [time]`, never implied complete.

## Combined Summary

Use one flat, divided four-cell band, not four floating cards:

- `Configured subscription spend` — owner-confirmed fixed access.
- `API-equivalent · observed cache` — the comparable local records at the cache
  behavior actually observed.
- `API-equivalent · no cache` — the same comparable records with input-like
  cache tokens repriced at normal input.
- `Cache effect · no cache − observed` — signed and never clamped. Positive,
  zero, and negative signs remain visible. Do not rename it savings.

Each cell contains the formatted USD amount, an adjacent literal `complete`,
`partial`, or `unavailable` badge, and one short evidence note. A supported
amount under one cent renders `<$0.01` (or adequate additional precision), never
`$0.00`. A true complete zero renders `$0.00`; unavailable renders the word
`Unavailable` and no dollar zero.

The following full-width honesty line is always present:

`Subscription spend is configured access cost. API-equivalent values reprice
recorded local work; they are estimates, not charges or invoices.`

## Reconciled Breakdowns

Render three labeled rows in a single divided group: Combined, `◆ Claude`, and
`▲ Codex`. Each row repeats the four abbreviated column labels `Subscription`,
`Observed cache`, `No cache`, and `Cache effect`. The final combined value must
equal the two tool rows for every measure. Cache effect must equal displayed
no-cache minus displayed observed under the shared serialization/rounding rule.

At desktop widths, a 100px scope column precedes four metric cells. Below 620px,
the scope label occupies its own line and the four values use a two-by-two grid.
This avoids horizontal scrolling and preserves readable full figures at 320px.

## Cumulative Charts

The section contains one wide Combined chart followed by two equally weighted
Claude and Codex charts. All three start visibly at `$0` at the range boundary
and use direct final-value text from the same response as the summary.

Series semantics use both line treatment and existing colors:

- Configured subscription spend: `--faint`, long dashed line.
- API-equivalent · observed cache: `--accent`, solid line.
- API-equivalent · no cache: `--teal`, dotted line.

The visible legend uses the three full canonical labels. This pattern/line-style
encoding remains distinguishable without color. Do not draw cache effect as a
fourth cumulative line: it is the signed difference between the two API lines
and is already explicit in the summary/breakdown. Avoid area fills, tooltips,
hover-only values, smoothing, or animated path drawing.

Each SVG has `role="img"`, a unique `<title>` and `<desc>`, plus a compact
screen-reader text equivalent containing the selected range, final three
values, scope, and completeness. An incomplete daily or cumulative segment is
not silently connected as complete: split the path at that boundary and render
the affected segment dashed, with a textual `partial` status and an incomplete
marker. Unavailable days produce a break, not a zero point. The artifact's
partial-state preview applies a dashed treatment across the affected usage
series to make the treatment easy to inspect; production should segment using
per-point status.

## Evidence and Provenance

The quiet final band has three divided proof columns:

- Subscription coverage: owner-confirmed status, covered interval ratio, and a
  bounded gap summary.
- Usage/pricing coverage: comparable/recognized record counts and token counts
  when the denominator is known, plus deduplicated count when useful.
- Effective pricing: reviewed Anthropic/OpenAI source labels, rate-card review
  date, and effective-date range actually used.

The section also states the local timezone and generation instant above. Labels
returned from the reviewed rate card must be escaped. Never expose raw config,
paths, parser exceptions, prompts, responses, session/account identifiers, or
unknown reason strings.

The blue setup explanation under provenance is educational and may remain in a
compact disclosure/help treatment in production: subscription values are never
inferred; the owner must confirm periods locally; no billing portal or API key
is read. The actual configured data path should be assembled from trusted local
configuration for documentation/setup copy, not returned by the endpoint.

## Evidence States

### Complete

Show numeric values plus literal `complete` badges. Complete subscription means
the full interval is covered by confirmed periods. Complete API values require a
complete supported scan and all recognized records comparable. A readable,
fully scanned source with no in-range usage may show a true `$0.00`.

### Partial

Keep the known amount only with an adjacent `partial` badge and a warning-tinted
diagnostic naming the omitted category, tool, and bounded coverage. Example:
`1,174 of 1,214 recognized records were comparable; 40 Claude records use a
model without an effective rate.` Unknown denominators show included counts and
`additional usage may be omitted`; do not invent a percentage. Charts break or
dash incomplete segments and carry the same textual state.

### Subscription setup / invalid configuration

Set only the subscription amount to `Unavailable`; keep both API-equivalent
values and signed cache effect available when their evidence is valid. Show:
`No owner-confirmed coverage is configured for this range. Add explicit Claude
and Codex periods locally; API-equivalent analysis remains available.` Invalid,
unconfirmed, overlapping, and gapped coverage receive distinct bounded fixed
copy. Never infer an amount from detected plan labels.

### Usage or pricing unavailable

Set observed cache, no cache, and cache effect together to `Unavailable` because
they share one comparison set. Preserve configured subscription spend. Name the
bounded cause (`Local usage roots could not be read`, `No effective rate for
recognized models`, or `Cost analysis is still warming`) without rendering raw
errors. Do not plot unavailable API lines or turn their points into zero.

### Stale refresh

Keep the last immutable values, interval end, chart, and original generated-at
time. Add `Last refresh failed · showing generated [time]` with the warning
treatment. Other dashboard sections and range controls remain operational.

### Mockup-only state control

`design.html` includes a labeled evidence-state switch beneath the section so
the Engineer and QA can inspect complete, partial, setup, and unavailable
treatments. It is explicitly marked `not part of the shipped dashboard` and
must not be implemented as a production user control.

## Responsive and Accessibility Acceptance

- At 720px the four-metric summary becomes two columns and the provenance band
  stacks.
- At 620px the tool charts stack, breakdown rows become two-by-two metric grids,
  and the cost header/range stack.
- At 430px the page uses the existing 11px gutters, metadata bullets become
  simple wrapping items, legend items stack, and summary typography reduces
  without clipping.
- At 320px there is no document or component horizontal scroll. Range controls
  stay visible, breakdown figures wrap only by row (never within a dollar
  amount), and all account-limit slots finish before Cost analysis.
- Range buttons and any disclosure/control have visible `:focus-visible` state,
  semantic button roles, `aria-pressed`, and a minimum practical touch target.
- Full metric names and literal status words carry meaning; color never does so
  alone.
- Every chart has an accessible name, description, and textual final-value
  equivalent. SVG text is supplemental and never the only value source.
- Automatic light/dark themes use only established design-system tokens.

## Motion

- Range-state color/background: 160ms ease-out.
- Focus ring: 120ms-equivalent control transition.
- Existing bar widths: 220ms `cubic-bezier(.2,.8,.2,1)`.
- No entrance animation, number count-up, path drawing, hover scale, stagger,
  bounce, pulse, or decorative continuous motion.
- `prefers-reduced-motion: reduce` makes all effective transitions immediate.

## Engineer Handoff Flags

- Remove or canonically rename existing `Est. value · wk`, `Est. value · today`,
  `Cache saved · wk`, and generic value trend copy. The new section must be the
  single cost vocabulary; compatibility endpoint fields may remain hidden.
- Render money from integer `amountMicros`. Do not re-sum rounded display values
  or derive cache effect in the browser.
- Use the cost endpoint's Combined/Claude/Codex summary and cumulative data
  directly. Final chart points and visible summary values must reconcile.
- Keep observed-cache and no-cache on the exact same comparison record set and
  status. If one is unavailable, cache effect is unavailable too.
- The mockup uses representative fixed paths; production creates plain SVG from
  response series, splits incomplete segments, and emits a text equivalent.
- Give cost range requests a monotonically increasing request ID so a late 90d
  response cannot replace a newer 7d choice. Keep prior content during refresh.
- Scope is always the local binding machine, including in multi-host mode. Do
  not call peer history endpoints or add costs to native menu output.
- All reason codes map through a fixed owned-key copy table. Escape every
  reviewed source label; never print raw reasons or local file/log content.
- Failure isolation is metric-specific: subscription failure leaves API values;
  one tool failure may leave a named partial Combined known amount; endpoint
  failure leaves limits and all unrelated dashboard content untouched.
- The artifact uses only current tokens and patterns. Do not copy its style block
  into production wholesale; extend `public/styles.css` with scoped classes and
  keep the established page hierarchy.
