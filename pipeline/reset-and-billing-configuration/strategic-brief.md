# Strategic Brief — Reset and Billing Configuration

## What We're Building
Add an owner-controlled account configuration surface for two durable facts that
the live usage feeds cannot always supply: Claude's weekly reset schedule and
recurring monthly Claude/Codex subscription charges. The dashboard will keep the
next reset and cost analysis useful when a provider reading is stale or absent,
while showing exactly which values are live, configured, or estimated.

## Why Now
The user is currently out of Claude tokens until Friday at 11 p.m., yet the
dashboard leaves the weekly reset blank because Claude has not rendered a recent
statusline. The installed reading confirms the gap: the account weekly window is
100% used with `resets_at: null`, while an active provider-reported Fable weekly
cap carries a reset of Friday, July 24 at 11 p.m. PDT, matching the owner's stated
schedule. Cost analysis has the same continuity problem: its owner-confirmed
subscription data requires a new fixed period every month, so a shipped feature
becomes partial unless the user repeatedly edits JSON by hand. This work takes
priority over roadmap alerts because alerts and planning cues are only useful
when their reset timing is trustworthy, and it completes the configuration loop
for the recently shipped cost analysis.

## The User Problem
The product is for one person who checks Claude and Codex from whatever device is
nearby, often over Tailscale. Today they cannot rely on llmdash to name a known
weekly reset while Claude is exhausted or quiet, and they must maintain a series
of one-off subscription periods to keep monthly spend current. The relevant
files also live on the host with no convenient, bounded way to inspect or manage
them from the dashboard.

## Success Criteria
- With Claude's weekly schedule configured as Friday at 11 p.m. in an explicit
  IANA time zone, the dashboard always shows the next concrete reset date, time,
  and zone even when the statusline reading is stale, blank, or exhausted.
- A live provider reset remains the highest-authority value. A configured
  fallback is labeled as configured and never makes a stale usage percentage
  look fresh or provider-confirmed.
- The owner can define a recurring monthly Claude or Codex subscription once;
  subsequent billing periods appear automatically in 7d/30d/90d cost analysis
  without another monthly file edit.
- Plan amount changes and cancellations can be effective-dated so future months
  update without silently rewriting already covered history. Existing valid
  fixed subscription periods continue to work.
- The dashboard provides a responsive configuration workflow over the existing
  Tailscale-served UI, plus read-only view/download links and the exact backing
  file locations for manual recovery or advanced editing.
- Invalid, oversized, overlapping, cross-origin, or interrupted edits are
  rejected without corrupting or replacing the last valid configuration.
- No provider credential, billing portal, invoice, prompt, session identifier,
  or runtime pricing request is introduced.

## Scope
- Add a Claude weekly reset fallback with weekday, local wall-clock time, and
  IANA time zone supplied explicitly by the owner; compute the next occurrence
  with calendar/DST-aware behavior.
- Preserve source precedence and provenance: future live provider timestamp,
  then explicit owner schedule. A provider model-cap reset may corroborate that
  schedule when it agrees, but is not silently relabeled as the account reset;
  expired snapshots are not extrapolated into authoritative provider data.
- Extend owner subscription configuration with recurring monthly plans for
  Claude and Codex: USD amount, effective start, billing anchor, and optional
  end/change boundary, expanded deterministically only for the analysis period.
- Keep current schema-v1 fixed periods readable and define a lossless migration
  or additive compatibility path rather than forcing the user to recreate them.
- Add a focused configuration area to the existing dashboard for reset schedule
  and subscription-plan fields, with clear saved/error states and mobile use.
- Add narrowly allowlisted configuration reads and writes for llmdash-owned
  files under `LLMDASH_DATA_DIR`: bounded bodies, strict schemas, regular-file
  and symlink checks, same-origin mutation rules, atomic replacement, restrictive
  permissions, and no CORS or arbitrary path input.
- Provide Tailscale-accessible read-only view/download links for the active
  subscription configuration and reviewed API rate card, while clearly marking
  the rate card as tracked reference data rather than owner billing data.
- Keep reset provenance and subscription coverage visible in dashboard copy,
  diagnostics, tests, startup/README guidance, and any affected menu-bar reset
  display that already consumes the shared state contract.

## Out of Scope
- Inferring a reset schedule from an expired snapshot, guessing a time zone, or
  presenting configured timing as a fresh provider observation.
- Refreshing or fabricating Claude usage percentages when Claude cannot report
  them; this feature supplies reset timing, not replacement quota telemetry.
- Provider billing integrations, invoice scraping, OAuth/API-key reuse, plan-
  label price inference, taxes, receipts, currency conversion, or actual
  pay-as-you-go API spend tracking.
- Automatic discovery of price changes. “Automatic monthly” means recurrence of
  an owner-confirmed amount; amount changes remain explicit and effective-dated.
- A general-purpose web file manager, arbitrary-path editor, shell access, or
  in-app editing of the reviewed tracked `config/api-rates.json` rate card.
- Public-internet exposure, a new account/login system, multi-user permissions,
  peer-machine configuration writes, or cross-host cost-history aggregation.
- Changing alert behavior or building notifications in this feature.

## Key Decisions
- Treat both requested improvements as durable, owner-confirmed account facts:
  reset cadence and subscription cadence remain useful across gaps in volatile
  provider readings without pretending to be provider data.
- Live provider reset timestamps win whenever usable. The configured schedule is
  a separately labeled fallback and never changes the freshness state of the
  associated quota reading.
- A model-specific weekly reset can be shown as corroborating provider evidence
  when it matches the configured schedule, as the current Fable reading does; it
  must not be blindly substituted for a missing account-window timestamp.
- Store reset time as weekday + wall-clock time + IANA zone, not a recurring UTC
  offset, so “Friday at 11 p.m.” survives daylight-saving transitions.
- Monthly subscription recurrence is local deterministic calendar expansion,
  not an external billing sync. Historical meaning is protected by effective
  dates and backward compatibility with explicit fixed periods.
- Prefer a semantic settings form over a raw JSON editor. It may mutate only the
  exact allowlisted llmdash configuration schemas; read-only file links preserve
  transparency and an escape hatch without creating arbitrary filesystem access.
- This feature intentionally adds a tightly bounded HTTP mutation capability to
  a server that is currently GET/HEAD-only. The Planner, Architect, and Auditor
  must preserve the tailnet-only product posture with same-origin anti-CSRF
  controls, no CORS, atomic writes, strict size/type validation, and honest
  failure states; a generic path-based endpoint is prohibited.
- The tracked API rate card stays reviewed, effective-dated, and read-only in the
  app. Owner subscription data can be managed; public pricing evidence cannot be
  silently rewritten through the dashboard.
- The feature remains local-machine scoped and does not alter peer APIs or turn
  one host into a remote configuration controller for another.
