# Strategic Brief — LLM Cost Over Time

## What We're Building
Add a cost-analysis section that compares three deliberately separate measures
for Claude Code and Codex, combined and per tool:

1. **Configured subscription spend** — owner-supplied subscription amounts,
   allocated across their stated coverage periods.
2. **API-equivalent value with observed caching** — recorded local usage priced
   with the cache behavior actually present in the logs.
3. **API-equivalent value without caching** — the same records repriced as if all
   input-like tokens paid the normal input rate.

Selected-range summary stats will reconcile with cumulative history charts. A
signed cache-effect stat will compare the two API estimates. Each number will
state its scope, evidence, pricing coverage, and assumptions.

## Why Now
llmdash already parses local token activity for both tools, distinguishes their
cache-accounting models, applies API rates, and renders daily estimated value.
What is missing is one coherent answer to: “What have my subscriptions cost,
what would this observed work cost at API rates, and what difference did caching
make?” This feature organizes existing evidence into that comparison and fixes
the risk that today’s “estimated value” copy could be mistaken for actual spend.

## Product Alignment
This remains a local activity estimate for the two subscription tools already in
scope. It does **not** reverse the product brief’s exclusion of pay-as-you-go API
spend tracking:

- No billing API, API key, invoice, or developer-account spend is read.
- API prices only value usage recorded by Claude Code and Codex local logs.
- “Actual” means subscription amounts explicitly confirmed by the owner, never a
  price inferred from a plan label or quota response.
- Subscription spend is fixed access cost, not provider usage cost; API
  equivalent is a counterfactual value, not a bill.

No founding-brief change is required.

## Settled Metric Semantics
- **Subscription spend:** owner-configured USD coverage periods with tool,
  amount, start, and end. The amount is allocated proportionally for partial
  chart ranges. Missing configuration is unavailable, not `$0`.
- **Observed-cache API equivalent:** price each record at the model/rate effective
  at its timestamp. Claude keeps distinct input, output, cache-write, and
  cache-read channels. Codex keeps cached input as a subset of input, so it is
  never counted twice.
- **No-cache API equivalent:** keep the exact same usage and output, but price
  Claude cache-write/cache-read tokens and Codex’s cached-input subset at normal
  input rates.
- **Cache effect:** `no-cache − observed-cache` for the same complete record set.
  It is signed and may be negative when cache-write premiums exceed read savings;
  do not clamp it or automatically call it savings.
- **Completeness:** unknown models/rates, unsupported or unreadable logs, or
  missing subscription periods produce partial/unavailable states. A generic
  fallback rate must not silently complete a total.

## Success Criteria
- The selected range shows configured subscription spend, API-equivalent value
  with caching, API-equivalent value without caching, and signed cache effect.
- One combined cumulative chart compares the three series across both tools;
  Claude and Codex breakdowns expose the same history and reconcile exactly to
  the combined totals.
- Cost analysis offers **7d / 30d / 90d**, defaulting to 30d. This captures weekly
  and monthly comparisons without an unbounded scan; existing 24h operational
  trends remain available.
- Rate cards are model- and effective-date-aware so changing today’s price does
  not rewrite older days. The UI identifies rate dates, subscription periods,
  local-machine scope, and priced-record coverage.
- Unknown evidence remains named and unavailable/partial, never a fabricated
  zero. A true zero is shown only after a complete scan finds no usage.
- Labels consistently distinguish spend from API-equivalent value and avoid
  invoice, ROI, or provider-bill-savings claims.
- The existing account-limit gauges remain first in the dashboard hierarchy;
  cost analysis stays with secondary activity/trends and does not enter the
  SwiftBar badge or dropdown.
- Desktop and phone views remain readable using the existing zero-dependency,
  vanilla-SVG design system.

## Scope
- Add a local, owner-editable, effective-dated subscription-cost configuration
  outside tracked source; absence or invalid data has a clear setup diagnostic.
- Add an effective-dated, model-aware API rate-card path with explicit
  provenance/as-of metadata and no runtime network dependency.
- Extend source-aware daily aggregation with subscription allocation,
  observed-cache value, no-cache value, cache effect, and completeness/coverage
  for 7d, 30d, and 90d.
- Add one combined cost overview plus per-tool histories, and consolidate/relabel
  the existing “Est. value” cards/chart so there is one cost vocabulary.
- Verify that supported usage scanning includes current nested Claude subagent
  log layouts and deduplicates records before using “all usage” or “total” copy.
  Scans remain bounded and cached; budget exhaustion is incomplete evidence.
- Add pricing, allocation, API, rendering, responsive, and hostile-config tests,
  including rate/plan changes, unknown models, partial data, and both tools’
  cache semantics.

## Out of Scope
- Provider invoices, billing accounts, credit-card transactions, taxes, receipts,
  or pay-as-you-go API-key usage.
- Inferring subscription price from detected plans or shipping guessed defaults.
- Forecasts, renewal projections, budgets, alerts, recommendations, exports, or
  “money saved” claims.
- Currency conversion in v1; both configured subscription amounts and existing
  rate cards are USD-denominated.
- Runtime price discovery, web scraping, or new external dependencies.
- Cross-host historical totals. V1 combines both tools on **this machine**;
  peers do not expose deduplicated cost history.
- Backfilling deleted/absent logs, estimating tokens from quota percentages, or
  an unbounded all-time scan.

## Key Decisions
- The product never blends subscription spend and API equivalent into one
  “cost.” They are separate, comparable series.
- Owner confirmation is the only subscription-price source of truth. Plan labels
  provide context, not billing evidence.
- Historical pricing is effective-dated. Unknown rate coverage weakens the
  aggregate visibly instead of falling through to a guessed default.
- Combined totals inherit the weakest relevant completeness state; known partial
  amounts may appear only when clearly labeled partial and naming what is absent.
- No-cache is a deterministic reprice of observed records, not a simulation of
  different requests or token volume.
- “Combined” means Claude + Codex on the local machine. Multi-host cost history
  waits for a bounded peer-history and deduplication contract.

## Flags for the Next Stages
- **Planner/Architect:** prove nested Claude transcript coverage and define
  bounded traversal, deduplication identity, and scan-completeness output.
- **Planner/Architect:** define effective-dated subscription/rate configuration
  without retroactively changing historical meaning.
- **Designer:** keep actual spend versus API equivalent unmistakable and show
  partial coverage adjacent to the affected number.
- **Auditor:** bound and validate local configuration size, entries, dates,
  overlaps, and finite nonnegative amounts; never expose raw config through APIs.
