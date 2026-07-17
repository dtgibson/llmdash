## LLM Cost Over Time

### What this does

Adds a local, independently ranged Cost analysis surface that keeps configured
subscription spend, API-equivalent value with observed caching, and the same
supported records repriced without caching visibly separate. It builds one
bounded 90-day Claude + Codex usage ledger on the poller, values only exact
effective-dated model matches with fixed-point arithmetic, and serves immutable
7d/30d/90d snapshots through the additive read-only `/api/cost-analysis`
endpoint.

The dashboard includes reconciled Combined/Claude/Codex summaries, monotonic
cumulative charts, signed cache effect, evidence coverage, reviewed price
provenance, setup/partial/unavailable states, responsive layouts, and accessible
text equivalents. Existing state, hosts, trends, Codex insights, peer, and
menu-bar contracts are unchanged; ambiguous legacy estimated-value/cache-savings
cards were removed from the dashboard.

### How to test

1. Run `npm test` and confirm the complete Node test suite passes.
2. Start the app with `npm start`, then open `http://localhost:8787`.
3. Confirm Account limits and tool activity still lead the page, with Cost
   analysis after the existing tool surfaces.
4. Switch Cost range among 7d, 30d, and 90d. Confirm its range is independent
   of Trend range and Codex insights.
5. Confirm the four Combined values remain distinct and the Combined row equals
   Claude + Codex. Confirm Cache effect equals No cache minus Observed cache.
6. Inspect all three cumulative charts and their direct final values. Partial
   evidence uses dashed lines/status text and never a downward cumulative step.
7. With no local `subscriptions.json`, confirm only subscription spend is
   Unavailable and the API-equivalent analysis still renders when supported.
8. Add a scratch owner-confirmed subscription fixture as documented in README,
   restart/refresh, and confirm fixed access values and coverage appear without
   changing account-limit or menu output.
9. Check 320px and desktop widths, keyboard range selection, light/dark themes,
   and chart accessible names/text equivalents.
10. Verify `GET` and `HEAD` on `/api/cost-analysis`; confirm `Cache-Control:
    no-store`, local-machine scope, and that mutating methods return 405.

### Notes for reviewer

- Subscription amounts are never inferred from a plan label. The local
  `$LLMDASH_DATA_DIR/subscriptions.json` file is optional, owner-confirmed, and
  untracked; absent configuration intentionally renders setup/unavailable.
- The tracked rate card was reviewed on 2026-07-16 against official Anthropic
  and OpenAI pricing sources. Matching is exact and effective-dated. Unknown
  model IDs—including models whose public rate cannot be represented without
  an unapproved context-tier assumption—remain unpriced and reduce coverage.
- Currency math uses BigInt picodollars internally and serializes canonical
  integer microdollars. Daily deltas are differences of rounded cumulative
  boundaries, so summaries, series, tool totals, and signed cache effect
  reconcile exactly.
- Cold scans are bounded. If a local tree exceeds a safety budget, known
  evidence remains partial and the denominator stays unknown; HTTP requests
  never scan logs or configuration.
- There is no SQL migration and no runtime dependency.

## Convention Flags

- Counterfactual valuations must use exact model/effective-date rates and a
  shared comparison set; no family or latest-rate fallback.
- Owner financial configuration stays local, explicit, and unavailable rather
  than inferred.
- Expensive local analysis is poller-owned and atomically cached; request paths
  are pure bounded reads.
