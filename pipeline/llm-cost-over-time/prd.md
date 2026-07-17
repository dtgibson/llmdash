# PRD — LLM Cost Over Time
**Feature:** llm-cost-over-time
**Date:** 2026-07-16
**Stage:** 2 — The Planner
**Source:** strategic-brief.md (approved)

## Feature Overview
Add a secondary **Cost analysis** section that compares, without blending, three
USD measures for Claude Code and Codex usage recorded on this machine:

1. **Configured subscription spend** — owner-confirmed subscription amounts
   allocated across their stated coverage periods.
2. **API-equivalent value (observed cache)** — the recorded work repriced at the
   model rates and cache behavior effective when it occurred.
3. **API-equivalent value (no cache)** — the exact same comparable records
   repriced as if every input-like token paid the normal input rate.

The section defaults to 30 days, also supports 7 and 90 days, and shows a
selected-range summary plus cumulative combined and per-tool history. A signed
**cache effect** is always `no-cache − observed-cache`. Every amount carries its
scope, evidence status, and coverage so a configured fixed cost, a
counterfactual API value, an incomplete estimate, and a true zero cannot be
mistaken for one another.

## User Stories
> **US-01** — As the owner, I want to see my configured Claude and Codex
> subscription spend over a selected period, so that I can understand the fixed
> access cost I chose to pay.

> **US-02** — As the owner, I want to value my recorded local work at historical
> API prices with the cache behavior that actually occurred, so that I can
> compare unlike subscription plans on one explicit counterfactual basis.

> **US-03** — As the owner, I want to reprice those same records without caching,
> so that I can see the signed price effect of caching without changing the
> workload or output.

> **US-04** — As the owner, I want combined and per-tool 7-day, 30-day, and
> 90-day totals and histories to reconcile, so that I can trust every view of the
> same period.

> **US-05** — As the owner, I want missing configuration, unknown pricing, and
> incomplete log coverage named beside affected values, so that an unknown is
> never presented as zero or as a complete total.

> **US-06** — As a multi-host user, I want cost analysis explicitly limited to
> this machine, so that activity from other machines is not silently omitted or
> double-counted in a number labeled total.

> **US-07** — As a phone and keyboard user, I want the summaries, controls, and
> charts to remain readable and operable without depending on color, so that the
> analysis is usable wherever I open the dashboard.

## Functional Requirements

### Metric Vocabulary and Meaning
> **FR-01 — Three separate measures.** The app shall expose configured
> subscription spend, API-equivalent value with observed caching, and
> API-equivalent value without caching as three separate measures. It shall not
> add, net, or label them as one combined “cost.”

> **FR-02 — Subscription meaning.** Configured subscription spend shall mean
> only owner-confirmed USD amounts for explicit Claude or Codex coverage periods.
> A detected plan name, quota response, advertised price, prior period, or
> inferred tier shall never create or fill a subscription amount.

> **FR-03 — API-equivalent meaning.** Both API measures shall be labeled as
> estimates of the value of locally recorded subscription-tool usage at API
> rates. They shall never be described as an invoice, provider charge,
> pay-as-you-go usage, actual API spend, or subscription refund.

> **FR-04 — Signed cache effect.** Cache effect shall equal `no-cache −
> observed-cache`, calculated from the same comparable record set before display
> rounding. It shall retain its sign, including a negative result when observed
> cache-write premiums exceed cache-read effects, and shall not be clamped or
> generically labeled “savings.”

> **FR-05 — Stable cost vocabulary.** Every existing generic `Est. value`,
> `estimated value`, `today's value`, or `cache savings` presentation shall be
> consolidated into this cost vocabulary or relabeled to state the corresponding
> API-equivalent measure and cache assumption. The dashboard shall not present a
> second cost total with different wording or accounting.

### Selected Ranges and Time Boundaries
> **FR-06 — Supported ranges.** Cost analysis shall support trailing 7-day,
> 30-day, and 90-day ranges and default to 30 days. Its range control shall be
> independent from the existing operational-trend range control.

> **FR-07 — Range interval.** Each range shall contain the named number of local
> calendar dates: it begins at local midnight on the earliest included date and
> ends at the analysis generation instant. The current date is therefore a
> partial day and shall be identified as “through” the generation time rather
> than represented as a completed day.

> **FR-08 — Daily buckets.** Usage shall belong to the local calendar date of its
> recorded event timestamp. Subscription allocation shall use the actual elapsed
> overlap between each local-day interval, the selected range, and its coverage
> period, so daylight-saving transitions and the partial current day neither add
> nor lose allocation.

> **FR-09 — Timestamp requirement.** A usage record without a valid event
> timestamp shall not be assigned to a day or pricing period. It shall weaken
> completeness visibly rather than being assigned to the scan time, file time,
> or current date.

### Subscription Inputs and Allocation
> **FR-10 — Required subscription facts.** Each accepted subscription entry
> shall identify one supported tool, a finite nonnegative USD amount, an
> inclusive local start date, an inclusive local end date on or after the start,
> and explicit owner confirmation. Entries in another currency or without any
> required fact shall be invalid.

> **FR-11 — Coverage interval.** A subscription entry shall cover from local
> midnight at the start date through local midnight after the end date. Its full
> configured amount shall be allocated uniformly by actual elapsed time across
> that interval; any selected subrange receives exactly its proportional overlap.

> **FR-12 — Zero subscription amount.** A confirmed `$0` entry is valid evidence
> of zero configured subscription spend for its coverage interval. Missing,
> unconfirmed, or invalid configuration shall be unavailable or partial and
> shall never be converted to `$0`.

> **FR-13 — Adjacent and overlapping periods.** Adjacent periods for the same
> tool are valid. If two entries for the same tool overlap by any instant, every
> entry participating in that overlap shall be rejected in full; the app shall
> not add them, choose one, split them, or infer precedence. Periods for different
> tools may overlap.

> **FR-14 — Gaps and malformed configuration.** A syntactically unreadable
> subscription source shall make subscription spend unavailable for both tools.
> A record-level error shall invalidate only that record and any overlap group it
> creates; other unambiguous records remain usable. Any uncovered part of the
> selected range shall make the affected tool's subscription result partial, with
> the uncovered dates named or summarized.

> **FR-15 — Subscription changes over time.** Changing a future or later
> subscription period shall not alter allocation outside that period. Historical
> periods remain valued from their own confirmed amounts; no current amount shall
> be projected backward or forward across an uncovered interval.

### Effective-Dated API Pricing
> **FR-16 — Rate identity and provenance.** Every accepted API rate interval
> shall identify the supported tool, exact model identity, applicable token
> channel rates in USD, inclusive effective instant, exclusive ending instant or
> an unambiguous next-effective boundary, and human-readable provenance/as-of
> metadata. All rates shall be finite and nonnegative.

> **FR-17 — Historical rate selection.** Each usage record shall be priced only
> by the exact model and rate interval effective at its event timestamp. A current
> rate shall not rewrite earlier usage, and a model-family resemblance, plan
> label, latest known rate, or generic fallback shall not fill an unknown model or
> date.

> **FR-18 — Rate changes within a day.** When a rate changes inside a daily
> bucket, records before and after the boundary shall use their respective rates;
> the daily value shall be the sum of those record-level valuations.

> **FR-19 — Invalid and overlapping rates.** A missing required channel,
> malformed interval, non-finite or negative rate, or same-tool/model interval
> overlap shall invalidate every participating rate entry in full. Other valid
> model and date intervals remain usable. The app shall not resolve an overlap by
> order, by choosing the newest entry, or by averaging rates.

> **FR-20 — Relevant-channel rule.** A missing channel rate shall make a record
> unpriceable only when that record has a nonzero token count requiring the
> channel in either API measure. A zero token count shall not require a rate solely
> to prove that its contribution is zero.

### Usage and Cache Accounting
> **FR-21 — Deduplicated usage.** Each logical supported usage record shall
> contribute at most once even when equivalent events appear in multiple local
> log shapes. Duplicate removal shall happen before counts, coverage, and values
> are computed.

> **FR-22 — Claude observed-cache accounting.** A comparable Claude record shall
> value normal input, output, cache-write, and cache-read token channels at their
> distinct effective rates.

> **FR-23 — Claude no-cache accounting.** The no-cache value of that same Claude
> record shall keep output tokens and their output price unchanged and value its
> normal-input, cache-write, and cache-read tokens at the effective normal-input
> rate. It shall not change token volumes or simulate a different request.

> **FR-24 — Codex observed-cache accounting.** A comparable Codex record shall
> treat cached input as a subset of total input: uncached input is `total input −
> cached input`, cached input uses its effective cached-input rate, and output
> uses its effective output rate. Cached input shall never be added to total input
> a second time.

> **FR-25 — Codex no-cache accounting.** The no-cache value of that same Codex
> record shall price all total input at the effective normal-input rate and keep
> output and its output price unchanged. A negative uncached-input result or
> cached input greater than total input shall make the record malformed, not
> silently clamp it.

> **FR-26 — Same comparison record set.** A usage record shall contribute to
> both API values and cache effect only if its tool, model, timestamp, token
> channels, and every nonzero channel rate needed by both calculations are valid.
> If either calculation cannot price the record, the record shall be excluded
> from both amounts and identified in shared pricing coverage. Observed-cache and
> no-cache totals shall therefore always describe the exact same record set.

### Completeness, Coverage, and Zero Semantics
> **FR-27 — Independent evidence states.** Each metric, tool, day, and selected
> range shall expose one of `complete`, `partial`, or `unavailable`, plus bounded
> reason codes and safe explanatory copy. Subscription coverage and usage/pricing
> coverage shall remain independent because one cannot validate the other.

> **FR-28 — Source-scan completeness.** Usage evidence shall be complete only
> when every supported local source in the selected range was traversed within
> its bounds and all candidate records were readable and understood. An unreadable
> file, unsupported candidate record, invalid timestamp, traversal error, or
> exhausted directory/file/record/time budget shall make the affected result
> partial or unavailable and shall name the category of omitted evidence.

> **FR-29 — Pricing coverage.** For each tool and combined result, the app shall
> report comparable-record count and recognized-record count, and comparable-token
> count and recognized-token count when the denominator is known. Unknown models,
> missing effective rates, malformed token relationships, and invalid rate
> intervals shall reduce coverage and identify their bounded categories without
> exposing log content or paths.

> **FR-30 — Unknown denominator.** When scan bounds or read failures mean the
> full denominator is unknown, the app shall provide known included counts but
> shall not calculate a misleading percentage. The UI shall state that additional
> usage may be omitted.

> **FR-31 — Partial known values.** When at least one valid subscription segment
> or comparable usage record exists but relevant evidence is incomplete, its
> known amount may be shown only with an adjacent `partial` label and the missing
> scope. When no amount can be supported, the value shall be unavailable rather
> than numeric.

> **FR-32 — True zero.** An API value may render as zero only when a complete
> supported scan finds no recognized usage in the selected scope. Subscription
> spend may render as zero only when explicit confirmed `$0` coverage spans the
> entire selected scope. A positive amount smaller than one display cent shall be
> shown with sufficient precision or as `<$0.01`, never as `$0.00`.

> **FR-33 — Missing source roots.** A missing or inaccessible expected usage
> source shall be unavailable rather than treated as a completed empty scan. A
> present, readable supported source with no records in range may establish a
> true usage zero.

> **FR-34 — Combined-state inheritance.** Combined means the union of Claude and
> Codex evidence on this machine. It is complete only when both tool results are
> complete, partial when at least one known amount exists and any tool is partial
> or unavailable, and unavailable when neither tool supports an amount. A combined
> partial value shall name the affected tool or evidence category.

### Summaries, Charts, and Reconciliation
> **FR-35 — Selected-range summary.** The selected range shall show configured
> subscription spend, observed-cache API-equivalent value, no-cache API-equivalent
> value, and signed cache effect for Claude + Codex, with per-tool breakdowns
> available in the same section.

> **FR-36 — Cumulative histories.** Cost analysis shall show one combined
> cumulative history comparing the three measures and a corresponding cumulative
> history for each tool. Each series shall begin from zero at the range boundary
> and accumulate the daily contributions through the generation instant.

> **FR-37 — Exact reconciliation.** For every range and measure, the final
> cumulative point shall equal its selected-range summary from the same
> unrounded values; the combined value shall equal the Claude and Codex values;
> and displayed cache effect shall equal displayed no-cache minus observed-cache
> under one consistent rounding rule. Rounding shall occur only after aggregation.

> **FR-38 — Continuous dates and partial series.** Histories shall retain every
> local date in the selected range. A complete date with no usage may contribute
> zero; an incomplete date shall remain visibly partial or unavailable and shall
> not be converted to a zero point or silently connected as complete.

> **FR-39 — Clear visual semantics.** Charts and legends shall use the full
> labels `Configured subscription spend`, `API-equivalent · observed cache`, and
> `API-equivalent · no cache`. Styling shall keep fixed subscription allocation
> distinct from both usage-derived counterfactuals and shall identify incomplete
> portions without relying on color alone.

> **FR-40 — Scope and provenance beside results.** The section shall state
> `This machine · Claude + Codex`, the selected interval and generation time, the
> local timezone, owner-confirmed subscription coverage, effective pricing dates
> and provenance, scan completeness, and priced-record coverage adjacent to or
> directly reachable from affected summaries and charts.

> **FR-41 — Limits-first placement.** Account-limit gauges and pacing shall
> remain the dashboard's leading hierarchy. Cost analysis shall remain secondary
> activity/trend content and shall not add cost data to the SwiftBar badge,
> dropdown, account-limit response, or peer-host aggregate.

### Machine-Readable and UI Degraded-State Semantics
> **FR-42 — Additive cost-analysis contract.** The client-facing cost-analysis
> response shall be additive and shall identify schema version, selected range,
> interval boundaries, generation instant, timezone, `local-machine` scope,
> combined and per-tool summaries, daily and cumulative points, evidence states,
> coverage counts, safe reason codes, and pricing/subscription provenance.

> **FR-43 — Numeric availability.** Every money field shall be a finite USD
> amount when supported and `null` when unavailable; `0` shall carry the proof
> conditions in FR-32. Status shall be represented separately from the numeric
> value, so clients never infer availability from truthiness or display text.

> **FR-44 — Safe diagnostics.** Client responses may identify bounded categories
> such as `subscription_missing`, `subscription_overlap`, `rate_missing`,
> `unknown_model`, `source_unreadable`, or `scan_budget_exhausted`. They shall not
> return raw configuration, arbitrary parser errors, log records, prompts,
> responses, session identifiers, account identifiers, or filesystem paths.

> **FR-45 — Setup and remediation states.** Missing or invalid subscription
> configuration shall produce a concise setup diagnostic explaining that owner
> confirmation is required and how to correct the local configuration. Unknown
> pricing or incomplete scans shall name the distinct remedy or limitation. None
> of these states shall prevent account limits or unaffected dashboard sections
> from rendering.

> **FR-46 — No billing or network import.** The feature shall not request API
> keys, read invoices or billing accounts, scrape provider pricing at runtime,
> or make a network request to discover subscription amounts, usage, or rates.

## Non-Functional Requirements
> **NFR-01 — Performance:** Log traversal shall be bounded by explicit
> directory, file, record, and elapsed-time budgets; results shall be cached and
> refreshed outside the HTTP request path. Serving a cached 90-day response shall
> not initiate an unbounded filesystem scan or block the rest of the dashboard.

> **NFR-02 — Cache freshness:** A cache shall detect relevant local-log,
> subscription-configuration, and rate-card changes at a bounded cadence. Until a
> refresh completes, the response shall retain its generation time rather than
> presenting cached evidence as newly computed.

> **NFR-03 — Failure isolation:** A Claude parse failure, Codex parse failure,
> malformed subscription entry, invalid price interval, or one failed range shall
> not break the other tool, other metric, account limits, multi-host view, menu
> bar, or unrelated dashboard content.

> **NFR-04 — Security:** Configuration size, record count, string length,
> nesting, dates, amounts, and rates shall be bounded and validated before use.
> Non-finite numbers, prototype-like keys, hostile labels, and malformed Unicode
> shall remain inert and shall not reach executable or unescaped render contexts.

> **NFR-05 — Privacy:** All aggregation shall remain local and expose only
> normalized aggregate facts. The feature shall add no telemetry, external
> processing, public endpoint, or peer-history fan-out.

> **NFR-06 — Architecture:** The feature shall preserve the zero-runtime-
> dependency Node and vanilla-SVG stack, add no build step, and avoid a second
> history database for values that can be deterministically re-derived.

> **NFR-07 — Accessibility:** Range controls shall be keyboard-operable with
> visible focus and an exposed selected state. Every chart shall have an
> accessible name and a text equivalent containing its final value, range, and
> completeness; metric identity, sign, and partial state shall not depend on
> color alone.

> **NFR-08 — Responsive design:** The section shall preserve the dashboard's
> 860-pixel reading width and shall reflow summaries, controls, legends, and
> charts without clipped text or horizontal page scrolling at 320 CSS pixels in
> both light and dark themes.

> **NFR-09 — Compatibility:** Existing account-limit, activity, trends,
> multi-host, service, and menu-bar response fields and meanings shall remain
> backward-compatible. Cost-analysis additions shall not change peer polling or
> native-menu output.

> **NFR-10 — Determinism:** Given the same source records, timezone, owner
> configuration, rate card, range boundary, and generation instant, aggregation,
> evidence status, coverage, and display rounding shall be deterministic.

## Out of Scope
- Provider invoices, billing portals, credit-card charges, receipts, taxes,
  discounts not explicitly represented in confirmed coverage amounts, or payment
  reconciliation.
- Pay-as-you-go API-key usage, general ChatGPT chat usage, or any provider usage
  absent from Claude Code and Codex local logs.
- Inferring subscription prices from plan names, quota limits, public list
  prices, prior periods, or detected account metadata.
- Generic fallback rates, model-family guesses, runtime price discovery, web
  scraping, or retroactive repricing with today's rate.
- Cross-host historical aggregation, peer-history requests, or claiming that
  this-machine activity is account-wide usage.
- Forecasts, renewal projections, budgets, alerts, recommendations, exports,
  ROI, “money saved,” or optimization claims.
- Currency conversion or non-USD configuration in v1.
- Reconstructing deleted logs, backfilling absent evidence, estimating tokens
  from quota percentages, or scanning unbounded all-time history.
- Cost values in the SwiftBar badge or dropdown.

## Open Questions
None. Product-level semantics are resolved above. Configuration format, cache
layout, endpoint placement, traversal budgets, and chart composition remain
implementation/design decisions so long as they satisfy this contract.

## Success Metrics
| ID | What's Being Verified | Pass Condition |
|---|---|---|
| QA-01 | Three-measure separation | The selected range shows the three full metric names separately; no UI or response adds subscription spend to either API equivalent. |
| QA-02 | Default and supported ranges | Cost analysis defaults to 30d and switches coherently among 7d, 30d, and 90d without changing the operational-trends control. |
| QA-03 | Partial current day | A fixed-time fixture ends at that instant, labels the current date partial, and allocates only elapsed overlap. |
| QA-04 | Local-day and DST boundaries | Fixtures crossing midnight and both DST transitions assign usage by local date and preserve the exact subscription amount across full coverage. |
| QA-05 | Subscription allocation | A known amount over a known period produces exact full-range, partial-range, and per-day proportional allocations whose cumulative total reconciles. |
| QA-06 | Confirmed zero versus missing | Full confirmed `$0` coverage renders `$0`; missing or unconfirmed coverage renders unavailable/partial and never `$0`. |
| QA-07 | Subscription gaps | A range with one uncovered interval shows only the supported known amount as partial and identifies the gap. |
| QA-08 | Subscription overlap and invalid records | Same-tool overlaps reject every participating entry; adjacent and other-tool entries remain valid; malformed syntax safely makes the subscription metric unavailable. |
| QA-09 | Effective-dated prices | Records immediately before and at a rate boundary use the prior and new rate respectively, including two rates inside one day. |
| QA-10 | No price fallback | Unknown model/date/channel fixtures remain unpriced and lower coverage; no generic, latest, or family rate appears. |
| QA-11 | Invalid rate intervals | Negative, non-finite, missing-required-channel, reversed, and overlapping rate entries are rejected without poisoning unrelated valid models/dates. |
| QA-12 | Claude observed-cache formula | A fixture with all four Claude channels produces the exact observed-cache value at their distinct effective rates. |
| QA-13 | Claude no-cache formula | The same fixture prices input + cache write + cache read at normal input and leaves output unchanged. |
| QA-14 | Codex observed-cache formula | A fixture prices `(input − cached input)` normally, cached input once at its cached rate, and output once. |
| QA-15 | Codex no-cache formula | The same fixture prices all total input normally, leaves output unchanged, and does not double-count cached input. |
| QA-16 | Malformed Codex subset | Cached input greater than total input excludes the record from both API totals and reduces shared coverage without clamping. |
| QA-17 | Same record set | Removing any rate needed by either API calculation excludes that record from both totals; observed, no-cache, and cache effect report identical coverage. |
| QA-18 | Signed cache effect | Positive, zero, and negative fixtures equal `no-cache − observed` before rounding; negative output stays negative and no result is generically called savings. |
| QA-19 | Deduplication | Equivalent repeated Claude and Codex events contribute exactly once to usage counts, coverage, and all monetary values. |
| QA-20 | Coverage disclosure | Complete, unknown-model, unreadable-file, unsupported-record, and exhausted-budget fixtures produce the expected state, safe reason, and record/token coverage. |
| QA-21 | Unknown denominator | Scan-budget and unreadable-source fixtures expose included counts but no percentage whose denominator cannot be known. |
| QA-22 | True zero versus unavailable | A complete readable empty source renders API `$0`; missing/inaccessible roots and wholly unpriceable nonempty usage render unavailable, not `$0`. |
| QA-23 | Sub-cent value | A positive amount below one cent remains visibly nonzero and is never formatted `$0.00`. |
| QA-24 | Combined completeness | Complete tools combine completely; one partial/unavailable tool yields a named partial combined value; two unavailable tools yield no numeric combined value. |
| QA-25 | Range reconciliation | For every measure and range, final cumulative = summary, combined = Claude + Codex, and cache effect = no-cache − observed under the documented rounding rule. |
| QA-26 | Complete date series | Every date appears; complete no-usage dates contribute zero, while incomplete dates are marked and not silently connected as complete. |
| QA-27 | API semantics | Contract tests verify finite amount-or-null fields, explicit statuses, local-machine scope, interval/timezone, combined and tool series, coverage, provenance, and bounded reason codes. |
| QA-28 | Diagnostic privacy | Responses and rendered output contain no raw config, parser text, log content, prompts, responses, paths, account IDs, or session IDs. |
| QA-29 | Subscription setup state | Missing/invalid config shows an actionable owner-confirmation diagnostic while account limits and unaffected sections continue rendering. |
| QA-30 | Pricing provenance | The UI identifies the effective pricing dates/provenance used and visibly flags missing rate coverage. |
| QA-31 | Local-machine scope | Single- and multi-host views both label cost analysis `This machine · Claude + Codex`; no peer history is requested or added. |
| QA-32 | Vocabulary consolidation | No generic `Est. value`, ambiguous `today's value`, or unsigned `cache savings` remains; any retained historic value uses the canonical observed-cache label and accounting. |
| QA-33 | Limits-first/menu unchanged | Account limits remain first, and existing API, peer, service, menu-bar, and native-dropdown golden tests remain unchanged. |
| QA-34 | Bounded cached scans | A 90d request reads a bounded cached result without filesystem traversal on the request path; budget exhaustion returns partial evidence and the rest of the dashboard remains responsive. |
| QA-35 | Config hardening | Oversized/deep config, excessive entries, extreme dates, hostile keys/strings, invalid Unicode, and non-finite amounts/rates are bounded, inert, and diagnostically honest. |
| QA-36 | No billing/network import | Network, filesystem, and process spies observe no billing access, API-key read, price scraping, or new outbound request for this feature. |
| QA-37 | Accessibility | Keyboard and assistive-technology checks expose range selection, chart names/text equivalents, signed cache effect, and every partial/unavailable state without color dependence. |
| QA-38 | Responsive themes | At 320px and 860px, summaries, legends, charts, and diagnostics fit without horizontal page scroll or clipped content in light and dark themes. |
| QA-39 | Failure isolation | Each tool/config/rate failure fixture leaves the other tool, account limits, unrelated activity/trends, and menu output functional. |
| QA-40 | Deterministic re-run | Repeating aggregation with frozen inputs and generation time produces byte-equivalent semantic values, status, coverage, and day ordering. |
