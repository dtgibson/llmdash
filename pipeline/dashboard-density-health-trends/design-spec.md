# Design Spec — Dashboard Density and Health Trends

## Outcome

Recompose the existing limits-first dashboard into one compact first-read region
named **Capacity now**. It answers, in order: how much primary quota remains,
which other account allowances are usable, whether each machine's local burn is
on pace, and whether that machine has sustained CPU, RAM, or disk pressure over
the latest hour. Activity, diagnostics, cost analysis, Codex insights, and
long-range provider trends remain available beneath that complete operational
read.

The visual direction remains llmdash: plain, fast, mono-numeric, evidence-first,
and library-free. This feature does not introduce a new visual system. It
recomposes existing account, allowance, pacing, host, and device-health patterns
and adds a quiet host-scoped SVG figure.

## Reading Order

The production DOM and visual order must match:

1. Header freshness and any existing cross-tool headroom warning.
2. **Capacity now** account block:
   - Claude Code 5-hour remaining;
   - Claude Code weekly remaining;
   - Codex 5-hour remaining;
   - Codex weekly remaining; then
   - canonical reset credits, model caps, and other provider allowances.
3. One operational summary per reachable host:
   - explicit host identity and evidence age;
   - Claude/Codex pacing from that host's local burn evidence; then
   - current CPU, RAM, and disk evidence plus that host's one-hour history.
4. Tool activity, diagnostics, Codex insights, longer provider trends, and cost
   analysis.
5. Scope/privacy footer.

The density improvement is a move, not a copy. Primary quota gauges,
supplementary allowances, pacing, and current health each retain exactly one
canonical rendered location. Promoting them must remove their former lower-page
duplicate.

## Capacity-Now Composition

### Account facts

The existing four fixed account-window slots remain the only elevated metric
layer. At desktop widths they form one four-column row. At compact widths they
become a stable two-column grid in semantic order; no carousel, tab, or
horizontal scroller hides a window.

Each gauge retains:

- tool glyph and name (`◆ Claude`, `▲ Codex`);
- explicit 5-hour or weekly window label;
- remaining percentage and status-colored remaining bar;
- duration-only reset line; and
- the current unavailable, stale, source-error, and missing-reset behavior.

Immediately below, one flat divided **Other global limits** band promotes reset
credits, model caps, and supported provider allowances. It is labeled
`same account · shown once`. Existing account-collapse rules still apply:
matching accounts render one allowance; genuinely different accounts receive
their own named account block. Expiration and evidence details remain visible;
an allowance must not reappear in a lower tool section.

### Operational host facts

An operational summary follows the account block for every reachable host. It
uses a soft surface with no gauge shadow and carries the host label at its top.
The host owns both its pacing and its health evidence, preventing an account
reading from implying that one machine's burn or pressure belongs to another.

On desktop, pacing and health history sit side by side. On phone, pacing stacks
before health. The hierarchy stays identical in single- and multi-host modes:

- single host: `Developer MacBook` + `This machine`;
- peer: escaped bounded label + `Tailnet host`;
- unreachable peer: the existing named unreachable callout, with no stale
  chart retained beneath it;
- monitoring station: existing dimmed/no-local-activity treatment;
- older reachable peer: current snapshot if reported, with the fixed history
  unavailable state.

Pacing retains the current projection semantics, source/reset evidence, and
text status (`on pace`, `at risk`, `limit reached`, or unavailable). It is
compactly expressed as one row per tool window. Same-account remaining quota is
not repeated inside the host, but a short value may appear as part of the
projection sentence only when required to explain that host's pacing. The row
states clearly that pacing combines local burn with account reset timing and is
not added quota.

## Health History Figure

Each reachable host receives one figure beneath its current CPU/RAM/disk strip.
Histories are never merged, averaged, compared as a composite score, or carried
across an unreachable host state.

### Current values

The current snapshot uses the shipped device-health meanings:

| Metric | Primary display | Supporting copy |
|---|---|---|
| CPU used | rounded percent | measurement interval / current evidence state |
| RAM used | rounded percent | active/wired context / current evidence state |
| Disk available | rounded percent | binary available capacity + `data volume` |

Current, aging, stale, measuring, unsupported, unavailable, and update-failed
language remains text-visible. If a current refresh fails, retain the last-good
value and its original sampled age; do not move it to the failed-attempt time.
The prototype's `Gaps` state demonstrates this with `RAM update failed · sampled
3m ago` while earlier RAM history remains intact.

### Plot semantics

Use one plain responsive SVG per host with a fixed `0..100%` y-domain and the
expected latest-hour x-domain at the normal minute cadence:

| Series | Semantic name | Non-color treatment | Token |
|---|---|---|---|
| `cpuUsedPct` | CPU used | solid line + circle markers | `--accent` |
| `ramUsedPct` | RAM used | dashed line + square markers | `--teal` |
| `diskAvailablePct` | Disk available | dotted line + diamond markers | `--warn` |

The visible legend repeats the full semantic names. In particular, disk is
always **available**, while CPU and RAM are **used**. Color never carries series
identity by itself.

Null metrics break only their own line. Timestamp separations greater than
twice the reported poll interval also break continuity. Never convert missing
data to zero, interpolate across it, extend a last-known point to now, or bridge
through sleep/offline time. Zero is plotted only when it is an actual finite
observation.

Visible figure copy includes:

- sample count;
- actual oldest/newest local-time coverage;
- `no gaps`, `N gaps shown`, `collecting`, or an explicit failure/empty state;
- `Last hour` only at the normal 60-second cadence; otherwise `Latest 60
  samples`; and
- a current metric failure independently of the historical coverage statement.

Every SVG has a host-specific `<title>` and `<desc>` using safe generated IDs,
not peer labels. A screen-reader-only table carries the exact bounded history
with columns `Time`, `CPU used`, `RAM used`, and `Disk available`; null cells say
`Not measured`. The production table may contain at most the normalized 60 rows.
The prototype abbreviates this to three representative rows because it is a
static visual artifact, not the state renderer.

### Empty and degraded states

- `history: null` or omitted: `History unavailable · not reported by this host`.
  Keep any current snapshot visible.
- `history: []`: `Collecting health history · no observations yet`.
- all-null attempts: state the covered attempted range and `No successful health
  readings in this range`; render no fake baseline.
- one finite series point: render its named marker and `trend still collecting`.
- missing samples: segmented paths plus `N gaps shown`.
- unreachable peer: use only the existing host unreachable treatment.

## Responsive Layout

The supported desktop content width remains 860px with 16px outer gutters. The
minimum phone treatment uses 11px gutters and must fit within 320px without page
or component overflow.

- Four primary gauges: four columns at wide widths; two columns on compact
  widths.
- Allowances: label + three divided facts at wide widths; stacked rows at narrow
  phone width. Their semantic order does not change.
- Operational host: pacing beside health when reading width permits; stacked at
  compact widths.
- Current health metrics: three columns at wide widths; three aligned rows at
  narrow phone width. They remain one divided band, not three elevated cards.
- SVG: `width: 100%`, fixed viewBox, no minimum pixel width, canvas, pan, zoom, or
  horizontal scrolling.
- Legends and coverage copy wrap below the plot on phone.
- Long host names, reset evidence, account labels, and status text wrap rather
  than ellipsize. No load-bearing evidence is hover-only.

The prototype toolbar can preview Desktop/Phone, one/two hosts, current/gapped/
collecting/older-peer history, and theme. These controls are for design review
only and must not ship. Production introduces no health-history control.

## Interaction and Refresh

- The existing browser state refresh replaces values and paths in place. It
  does not add a timer, request a probe, or trigger collection.
- The existing minute poller remains the only health sampler.
- Charts are read-only and require no pointer or keyboard interaction.
- Existing Trends, Codex insights, cost range, and settings controls remain
  where their detailed sections live; their behavior and state are unchanged.
- Existing focus-visible rings, button hit targets, and pressed-state truth
  remain unchanged.
- No tooltip is required. All status, coverage, gap, and latest-value evidence
  is present as text without hover.

## Motion

- Primary bars and current health bars may replace width over 220ms using
  `cubic-bezier(.2,.8,.2,1)` from the left-center origin.
- Existing range controls may transition color/background over 160ms ease-out;
  focus response may use 120ms ease-out.
- SVG paths and points replace immediately. Do not animate line drawing, morph
  path geometry, tween missing points, or use entrance/stagger/continuous
  motion.
- Under `prefers-reduced-motion: reduce`, effective transition durations become
  immediate while every number, line, point, legend, and state remains present.

## Accessibility and Evidence Honesty

- The first-read wrapper is a labeled section and uses real headings in DOM
  order. Account facts precede host facts; all urgent facts precede details.
- Remaining state, pacing state, current metric state, chart semantics, and gaps
  are stated in text; no conclusion depends on hue.
- Each chart exposes the host, time coverage, metric direction, sample count,
  and gap statement through visible copy plus title/description.
- Series have different dash and marker patterns in addition to color.
- Dynamic host/tool/account strings continue through the existing escaping and
  strict normalization paths. SVG coordinates come only from clamped finite
  numbers.
- Current snapshot failures and history gaps are independent. A retained
  last-good current value never becomes a new historical point.
- `0%` is a legitimate plotted value; `null`/invalid/failed/unsupported is a
  gap, never `0%`.
- Health history is explicitly `process lifetime · up to 60 samples` in the
  scope footer. It is not described as persisted telemetry or long-term history.

## Component and Token Usage

Reuse the canonical llmdash tokens and patterns from
`pipeline/design-system.md`:

- account comparison and quota-card elevation;
- supplementary global-limit divided band;
- host headers and scope pills;
- compact pacing rows/status pills;
- current device-health divided band;
- plain SVG grid/legend patterns;
- `bg`, `panel`, `panel-soft`, border, text, muted/faint, track/grid, status,
  accent, Claude, Codex, teal, focus, and shadow tokens; and
- mono figures/labels with system-sans body copy.

`--gauge-shadow` remains exclusive to primary account quota cards. Operational
hosts, pacing, current health, and charts are flat supporting layers. No new
font, icon, chart library, framework, runtime dependency, network asset, or
build step is required.

## Implementation Boundaries

- Move the existing pacing renderer into the first-read operational summary and
  remove it from lower tool-detail rendering.
- Extend the existing shared device-health renderer for both single-host and
  multi-host composition. Do not create separate local/peer chart codepaths.
- Keep canonical allowances in the existing account renderer; do not reproduce
  them in host/tool detail.
- Preserve account grouping, monitoring-station ordering, host reachability,
  existing `/api/hosts` refresh, and every current evidence state.
- Accept only normalized bounded host histories and defend again at the browser
  renderer boundary. No peer-provided string becomes markup or an SVG ID.
- Do not add database persistence, settings, routes, probes, browser polling,
  menu-bar changes, write surfaces, or analytics.

## Design-System Status

The established `pipeline/design-system.md` remains authoritative. The reusable
addition is the **compact operational host summary**: host-scoped pacing beside
current device health and a small bounded history figure. If adopted, document
this pattern in the canonical design system during implementation; no token or
broader visual-direction change is needed.

## Design-Lint Notes

`~/.weft/bin/weft-design-lint check
pipeline/dashboard-density-health-trends/design.html` reports clean: 1 file
scanned, 0 findings. There are no warning or note exceptions to carry into
implementation.
