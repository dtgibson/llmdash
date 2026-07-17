# QA Report — LLM Cost Over Time

**Date:** 2026-07-16
**Test Runner:** `node:test` via `npm test`
**Final Attempt:** 3 of 3
**Result:** PASSED

## Test Suite Results

The final stable regression completed with **609 tests total — 607 passed, 0
failed, 2 skipped**. The two skips are pre-existing environment-conditional
menu installer checks for the no-Node path; they skip because this machine has
a system-wide Node binary.

The focused cost-analysis, ledger, rate-card, subscription, server, client, and
Codex-event run completed with **75 passed, 0 failed, 0 skipped**. The focused
inventory is one test larger than the pre-retry baseline because attempt 2 added
the BigInt-before-add arithmetic regression.

Additional checks passed:

- isolated live server GET/HEAD/method checks for 7d, 30d, and 90d;
- byte-identical repeated cached responses and unknown-range fallback to 30d;
- exact 90-local-date lower bound across the fall DST transition;
- exact partial-day, 23-hour spring-day, and 25-hour fall-day allocation;
- all-range/all-measure reconciliation and deterministic reruns;
- tracked rate launch boundaries with no pre-launch or year-2000 back-projection;
- Weft design lint: 0 findings;
- `git diff --check`: clean;
- zero runtime dependencies and no cost-analysis billing/network path.

## Retry History

- **Attempt 1 — needs fix.** Found incorrect all-zero/no-rate handling; cached
  malformed Claude evidence losing diagnostics; malformed and unreadable Codex
  evidence appearing complete; unsafe overflow behavior; signed sub-micro cache
  effect losing its UI sign; rate overlap misclassified as `unknown_model`;
  missing used-effective-interval provenance; followed subscription/rate/usage
  root symlinks; and accepted hostile bidi or malformed-Unicode labels.
- **Attempt 2 — needs fix.** Retesting found four additional boundary defects:
  Claude no-cache channels were added as Numbers before BigInt conversion;
  Codex fallback diagnostics overwrote `source_unreadable`; combined cache-effect
  overflow omitted `amount_overflow`; and invalid timestamps used a generic
  category. The tracked rate card was also corrected to exact-model launch dates
  instead of back-projecting current prices.
- **Attempt 3 — pass.** No concurrent product edits occurred. Both prior rounds,
  every new regression, the full suite, focused suite, live contract, direct
  boundary probes, and all 40 acceptance rows passed on one stable build.

## Acceptance Criteria Verification

| Criterion | Result | Verification |
|---|---|---|
| QA-01 Three-measure separation | Pass | The summary, breakdown, response, and charts keep configured subscription spend, observed-cache API equivalent, and no-cache API equivalent separate. Cache effect is a derived fourth value; no path adds subscription spend to an API value. |
| QA-02 Default and supported ranges | Pass | Cost analysis defaults independently to 30d and accepts 7d/30d/90d. Client request sequencing and pressed-state tests confirm that cost-range changes do not change the operational Trends range. |
| QA-03 Partial current day | Pass | A fixed 2026-07-16 15:00 PDT probe ended exactly at the generation instant, marked the final bucket partial, allocated `$0.625` of a `$1/day` period for 15 elapsed hours, and reconciled the `$6.625` range total. The UI says “through” generation time. |
| QA-04 Local-day and DST boundaries | Pass | Calendar fixtures contain the correct 23-hour spring and 25-hour fall buckets. Direct allocation retained the complete configured `$23` and `$25` amounts on those days, and the 90d lower bound used local midnight rather than a fixed-duration subtraction. |
| QA-05 Subscription allocation | Pass | Exact picodollar allocation uses actual elapsed overlap. Full, partial, daily, summary, and cumulative fixtures reconcile after aggregation and one consistent microdollar rounding rule. |
| QA-06 Confirmed zero versus missing | Pass | Confirmed full `$0` coverage produces complete numeric zero. Missing, unreadable, invalid, unconfirmed, or uncovered configuration produces partial/unavailable state and never fabricates zero. |
| QA-07 Subscription gaps | Pass | A partially covered Codex fixture shows only the supported positive amount, status `partial`, bounded `subscription_gap`, coverage duration, and bounded gap dates. |
| QA-08 Subscription overlap and invalid records | Pass | Same-tool overlap components reject every participant; true adjacent and other-tool entries survive. Invalid records remain inert, while malformed file syntax makes subscription evidence unavailable. |
| QA-09 Effective-dated prices | Pass | Exact-model lookup is inclusive at `effectiveFrom` and exclusive at `effectiveTo`; before/at-boundary fixtures select the prior/new rate. Daily aggregation prices each record before summing, so an intraday boundary retains both valuations. |
| QA-10 No price fallback | Pass | Unknown model, family-like model, pre-launch date, and missing exact interval remain unpriced and reduce shared coverage. Tracked Fable 5, Sonnet 5, and GPT-5.3-Codex tests explicitly return no rate one millisecond before launch. |
| QA-11 Invalid rate intervals | Pass | Strict parsing rejects negative/non-finite strings, missing or extra channels, reversed intervals, malformed metadata, and whole overlap components without poisoning unrelated exact models/dates. |
| QA-12 Claude observed-cache formula | Pass | The four-channel fixture values normal input, output, cache write, and cache read distinctly and produces the exact expected 67 microdollars. |
| QA-13 Claude no-cache formula | Pass | The same record values input + cache write + cache read at normal input and leaves output unchanged, producing 80 microdollars. The large-safe-integer regression converts each channel to BigInt before addition. |
| QA-14 Codex observed-cache formula | Pass | The fixture prices uncached input as `input - cached`, cached input once at its cache rate, and output once, producing 252 microdollars. |
| QA-15 Codex no-cache formula | Pass | The same fixture prices total input once at normal input plus unchanged output, producing 315 microdollars without adding cached input twice. |
| QA-16 Malformed Codex subset | Pass | `cached_input > input` is rejected by normalized event parsing and guarded again during aggregation; it cannot be clamped or contribute to either API measure. |
| QA-17 Same record set | Pass | A missing exact rate excludes the record from both API totals and cache effect. Observed/no-cache reasons and recognized/comparable record and token coverage are shared. |
| QA-18 Signed cache effect | Pass | Positive, zero, negative, and sub-micro fixtures equal no-cache minus observed before display rounding. Negative output remains negative, `rawSign`/`belowResolution` preserve sub-micro direction, and the UI never calls the result savings. |
| QA-19 Deduplication | Pass | Stable Claude IDs, fallback-adjacent Claude tuples, Codex turn/fingerprint records, and repeated structured events deduplicate before coverage and valuation. Counts and amounts include each logical record once. |
| QA-20 Coverage disclosure | Pass | Complete, unknown-model, unsupported-record, cached-malformed, unreadable/cold/changed file, fallback identity, and exhausted-budget fixtures return bounded statuses/reasons and recognized/comparable counts without content or paths. |
| QA-21 Unknown denominator | Pass | Unreadable and budget-limited scans preserve known included counts, set `denominatorKnown:false`, return null ratios, and render “additional usage may be omitted” instead of a percentage. |
| QA-22 True zero versus unavailable | Pass | Complete readable empty sources produce complete API zero. Missing/inaccessible roots and wholly unpriceable nonempty evidence produce `amountMicros:null` with unavailable status. Zero-token recognized records remain comparable zero without requiring a rate. |
| QA-23 Sub-cent value | Pass | Positive values under one cent render `<$0.01`; signed negative values render `−<$0.01`; a signed sub-micro value cannot collapse to `$0.00`. |
| QA-24 Combined completeness | Pass | Two complete tools combine completely; known output with a partial/unavailable contributor is partial with inherited tool/evidence reasons; two unsupported tools combine to null/unavailable. Overflow reasons also propagate into combined cache effect. |
| QA-25 Range reconciliation | Pass | Direct frozen-input checks passed for every measure across 7d, 30d, and 90d: final cumulative equals summary, combined equals Claude + Codex, daily totals reconcile, and cache effect equals no-cache minus observed. |
| QA-26 Complete date series | Pass | Range construction returns exactly 7/30/90 ordered local dates. Complete empty days contribute zero, incomplete evidence carries non-complete status and patterned chart segments, and the current date remains partial. |
| QA-27 API semantics | Pass | Live responses expose schema version, local-machine scope, currency, selected range, exact interval/timezone/generation instant, combined and per-tool summaries/daily/cumulative series, finite-safe amount-or-null fields, independent coverage, and bounded provenance/reasons. |
| QA-28 Diagnostic privacy | Pass | Responses and client copy use a fixed reason vocabulary. Parser errors, raw config/log lines, prompts, responses, paths, account/session IDs, and arbitrary reasons are neither serialized nor rendered; dynamic provenance labels are escaped. |
| QA-29 Subscription setup state | Pass | Missing/invalid config renders an owner-confirmation setup instruction and the exact `${LLMDASH_DATA_DIR}/subscriptions.json` remedy. Isolated live startup kept account limits, activity, Trends, and the rest of the shell operational. |
| QA-30 Pricing provenance | Pass | Only sources and effective intervals actually used by comparable records are serialized and rendered, including model and effective date range. Missing exact rate coverage is separately flagged with actionable bounded copy. |
| QA-31 Local-machine scope | Pass | API and UI both state `This machine · Claude + Codex`. Cost analysis is absent from peer payloads and performs no peer-history request; live `/api/hosts` contained no cost field. |
| QA-32 Vocabulary consolidation | Pass | Presentation scans contain none of `Est. value`, ambiguous `today's value`, or `cache savings`. The shipped UI consistently uses the three canonical full labels plus signed `Cache effect · no cache − observed`. |
| QA-33 Limits-first/menu unchanged | Pass | Live markup places account limits and tool detail before cost analysis. `/api/state` retains its exact top-level contract, peer responses remain cost-free, and the full native menu/badge golden suite passed unchanged. |
| QA-34 Bounded cached scans | Pass | Poller refresh performs one bounded 90-local-day ledger scan for all ranges. The HTTP handler calls only the immutable cache getter; repeated live 90d responses were byte-identical, and scan budgets degrade to partial evidence without blocking unrelated endpoints. |
| QA-35 Config hardening | Pass | Size/depth/count/date/amount/rate/text bounds, exact-key shapes, safe integers, hostile prototype-like values, bidi controls, unpaired surrogates, and subscription/rate/usage-root symlinks are rejected or inert with honest bounded diagnostics. |
| QA-36 No billing/network import | Pass | Static inspection found no billing, invoice, API-key, scraping, subprocess, or outbound request path in cost aggregation/readers. The browser fetches only the same-origin cached endpoint, and single-host live startup disclosed no outbound peer reads. |
| QA-37 Accessibility | Pass | Native range buttons expose a labelled group, keyboard operation, visible focus, and `aria-pressed`. Charts have accessible title/description and full textual final values/statuses; sign, series identity, and partial/unavailable state use text and line patterns rather than color alone. |
| QA-38 Responsive themes | Pass | The 860px shell, bounded phone gutters, 700/620/430px reflow rules, wrap-safe provenance, single-column phone charts, light/dark variables, reduced motion, and non-color line patterns are pinned by client/style tests. Weft design lint reported 0 findings. |
| QA-39 Failure isolation | Pass | Claude/Codex scan failures, malformed subscription entries, invalid rates, cold cache, and refresh failure preserve unaffected tool values or last-good evidence. Live account-limit/state/host/static endpoints remained functional with both usage roots absent. |
| QA-40 Deterministic re-run | Pass | Repeated aggregation with frozen inputs, timezone, generation instant, subscriptions, and rate card produced byte-identical JSON for 7d, 30d, and 90d with stable status, coverage, provenance, and day ordering. |

## Live and Manual Verification

- Started the production server on isolated loopback port `18789` with isolated
  Claude, Codex, and data roots and no configured peers.
- Verified 200/no-store/security-header behavior for all three cost ranges,
  HEAD parity with an empty body, POST rejection with `405`/`Allow`, and invalid
  range normalization to 30d.
- Verified missing local roots remained unavailable with `source_missing`, not
  numeric zero, while `/api/state`, `/api/hosts`, and the dashboard shell stayed
  functional.
- Verified repeated 90d reads were byte-identical and that `/api/state` and
  `/api/hosts` gained no cost-analysis fields.
- Verified the live HTML hierarchy remains account limits → tool details → cost
  analysis and defaults the independent cost control to 30d.
- Stopped the isolated server after the checks.

## Edge Cases Tested

- Zero-token/unknown-model records without a rate.
- Claude malformed JSON and invalid timestamps on both initial and cached scans.
- Codex malformed files; cold unreadable files; changed unreadable cached files;
  and fallback-identity evidence combined with `source_unreadable`.
- Exact `timestamp_invalid`, `record_unsupported`, `rate_overlap`,
  `source_unreadable`, and `amount_overflow` category preservation.
- Tool, daily, cumulative, and combined safe-integer overflow, including cache
  effect diagnostics.
- BigInt-before-add with individually safe Claude channels whose Number sum is
  not exactly representable.
- Positive, negative, zero, sub-cent, and signed below-resolution cache effects.
- Same-record exclusion for unknown model, missing interval, and malformed Codex
  cached-input subset.
- Subscription zero, gap, overlap component, adjacency, other-tool overlap,
  malformed file, unconfirmed entry, extreme date, and exact partial overlap.
- Rate boundary instants, two intervals in one day, invalid/reversed/overlapping
  intervals, missing channels, exact model matching, and pre-launch dates.
- Exact launch dates for Haiku 4.5, Opus 4.8, Fable 5, Sonnet 5, and
  GPT-5.3-Codex; no tracked interval begins in 2000.
- Subscription, rate-card, Claude-root, and Codex-root symlinks.
- Bidi controls, unpaired surrogates, control characters, overlong labels,
  hostile prototype-like values, non-finite values, and raw parser text.
- Spring-forward and fall-back daily allocation, partial current day, and the
  90-local-date fall-DST cutoff that differs from fixed 90×24h by 30 minutes in
  the selected fixture.
- Stale range-response races, stale refresh preservation, continuous dates,
  unknown denominators, and complete empty sources.

## Known Limitations

- Cost analysis is intentionally local to this machine. It does not aggregate
  peer history or claim account-wide usage.
- Subscription spend appears only for explicit owner-confirmed USD coverage.
  Missing or gapped periods remain partial/unavailable by design.
- API-equivalent values cover only exact reviewed model/rate intervals on or
  after their effective dates. Unknown or older model/date evidence remains
  visibly unpriced rather than receiving a family or current-rate fallback.
- Completeness depends on retained, readable supported local logs. Deleted,
  inaccessible, unsupported, or budget-omitted evidence is disclosed and is not
  reconstructed.
- Responsive verification is deterministic DOM/CSS contract testing plus design
  lint; this repository does not include a screenshot pixel-diff harness.
- Provider invoices, billing reconciliation, API-key usage, taxes, discounts,
  forecasts, alerts, exports, and cross-host history remain out of scope.

## Convention Flags

- `agents/communication-style.md` is absent in this repository. This did not
  block product or QA verification; existing project and Weft conventions were
  followed.
- Tracked rate `effectiveFrom` values must remain tied to reviewed exact-model
  launch/effective dates. A current rate must never be back-projected to 2000 or
  any pre-launch usage.
- Any new local-log shape must prove a valid timestamp and stable identity where
  available; otherwise it must retain bounded partial/unavailable diagnostics
  rather than becoming complete zero.
