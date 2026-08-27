# QA Report — Usage Coverage Gaps

**Date:** 2026-08-27
**Test Runner:** Node.js `node:test` (`npm test`)
**Result:** PASSED — QA retry attempt 1

## Post-Security-Remediation Verification

The mandatory Tester rerun independently reproduced every original audit finding against the retry-1 diff. F-01 through F-04 are closed, including the combined high-cardinality precision defect found on the first post-security pass.

### Required remediation findings

| Finding | Result | Exact evidence |
|---|---|---|
| F-01: growing streamed files can exceed byte/time ceilings | ✓ Closed | The descriptor reader requests at most the opened snapshot plus one detection byte. A synthetic growing 1-byte newline-free snapshot made one `readSync` request of 2 bytes and then returned `BOUNDED_FILE_CHANGED`. Deadline injection during an oversized unterminated drain stopped after 3 reads and still performed the final descriptor `fstat`. Production-path tests preserve no-follow open, regular-file validation, descriptor identity, final-size equality, last-good fallback, and later convergence. |
| F-02: nested Claude discriminators can hide oversized usage | ✓ Closed | An oversized top-level assistant row with valid Opus 5 usage and nested `{type:"user", message:{role:"user"}}` evidence returned 0 records with `denominatorKnown:false` and `record_unsupported`. The non-usage exception parses the anchored generated top-level property sequence and exact top-level `type:"user"` / `message.role:"user"`; nested fragments cannot satisfy it. Genuine generated oversized user rows remain definite non-usage. |
| F-03: heap amplification and unbounded omission grouping | ✓ Closed | Claude cache insertion is bounded at 175,000 records / 96 MiB estimated; Codex cache insertion at 1,100,000 records; the combined result at 1,250,000 records. Tool scopes retain at most 56 detail rows plus closed per-reason overflow. The combined scope now fairly re-aggregates the two already bounded sources, reserves at most 16 tool/reason overflow rows, and emits at most 64 rows without discarding counts. |
| F-04: zero cache writes require irrelevant duration evidence | ✓ Closed | A detailed-rate Claude row with 0 cache-write tokens and absent duration channels remained fully comparable and priced to 30,500,000 micros in the fixture. Normalization records an exact `0/0` split. Positive cache writes without exact 5-minute/1-hour evidence still produce `cache_write_ttl_unknown` and are not guessed. |

## Combined Overflow Retry Reproduction

The former failing case used 100 distinct unknown Claude models plus 100 distinct unknown Codex models, with 1–100 tokens per tool:

- Combined coverage reported 200 recognized records, 0 comparable records, and 10,100 omitted tokens.
- The bounded output contained 50 rows: 48 fairly selected details plus 2 exact tool/reason overflow rows.
- Omission rows summed to all 200 records and all 10,100 tokens in the Claude, Codex, and combined scopes.
- The two combined overflow rows each held 76 records / 4,750 tokens for `unknown_model`; selected detail rows held the remaining 24 records / 300 tokens per tool.
- Output was repeat-stable and sorted by tool, model, then reason. Every reason belonged to the closed eight-value omission set.
- Every row had exactly `tool`, `model`, `reason`, `records`, and `tokens`. Injected raw-content, private-path, and payload sentinels did not appear.

## Test Suite Results

- Security-remediation focused suite: 66 passed, 0 failed, 0 skipped (`bounded-file`, `codex-events`, `usage-ledger`, and `cost-analysis`).
- Broader affected suite: 132 passed, 0 failed, 0 skipped. It also covered Fable retention/freshness, rate-card intervals and tiers, browser evidence-note escaping, Codex insights, and both ledgers.
- Full suite: 813 total; 811 passed, 0 failed, 2 skipped, 0 cancelled, 0 todo in 81.660 seconds.
- The two skips are environment-dependent negative-path checks for an unresolved Node binary; they skipped because this machine has a system-wide Node installation.
- `git diff --check`: clean.

## Current-Corpus and Resource Verification

- A fresh-process `refreshCodexAnalytics()` returned `true` and published aggregate activity plus 30-day insights in 10.256 seconds. It retained 219 parsed files / 63,524 normalized records; after forced GC the process used 13.4 MiB heap and 244.0 MiB RSS.
- A fresh production-style `refreshCostAnalysis()` converged on pass 21 in 73.298 seconds. Passes 1–20 published bounded partial evidence with `scan_budget_total_bytes`; pass 21 removed that marker and established a known denominator.
- Converged 30-day combined coverage: 204,006 recognized records / 36,293,385,630 tokens; 194,872 comparable records / 35,085,790,727 tokens.
- The 9,134-record / 1,207,594,903-token pricing gap reconciled exactly to two aggregate rows:
  - Codex `gpt-5.6` before the reviewed interval: 6,223 records / 787,914,623 tokens, `rate_missing`.
  - Codex model context `unknown`: 2,911 records / 419,680,280 tokens, `unknown_model`.
- Converged scan reasons contained no `file_too_large`, `record_unsupported`, `source_unreadable`, or scan-budget marker. `dedupe_fallback` remains an identity-quality warning, not an unread-record gap.
- Forced-GC convergence memory: 170.2 MiB heap used, 315.3 MiB heap total, 912.6 MiB RSS.
- Cache occupancy at convergence: Claude 1,174 files / 127,651 records / 63,783,758 estimated bytes, below 175,000 records / 100,663,296 bytes; Codex 1,047 files / 1,001,544 records, below 1,100,000 records.

## Acceptance Criteria Verification

| Criterion | Result | Notes |
|---|---|---|
| Reset-less Fable evidence survives newer account-only writes, preserves capture time, and expires only at the explicit seven-day boundary. | ✓ Pass | Focused tests cover repeated writes, TTL-minus-one, and exact expiry. Explicit resets still expire at their reset instant. |
| Every safely readable current usage record is counted, and unpriceable usage is isolated by model and token count. | ✓ Pass | The current corpus converges with a known denominator and exact model/reason aggregates. Synthetic high-cardinality gaps reconcile at each scope under the row cap. |
| Fresh-process Codex activity/insights and cost analysis initialize within hard budgets and converge as files grow. | ✓ Pass | Analytics published in 10.256 seconds; cost evidence converged on pass 21 with bounded partial output on every prior pass. Growth/deadline tests preserve last-good data. |
| False `record_unsupported` / `file_too_large` notes disappear while genuine exclusions and offline peers remain separate. | ✓ Pass | Neither false read reason remained after convergence. The peer timeout remains operationally separate from local completeness. |
| Reviewed effective-dated pricing is exact and positive cache writes are never priced without required channel evidence. | ✓ Pass | Opus 5, GPT-5.6 Sol, the bounded GPT-5.6 interval, the 272,000-token tier boundary, and separate Claude 5m/1h writes pass. Zero writes need no irrelevant split; positive writes still do. |
| Public output is aggregate-only, bounded, escaped, and precise. | ✓ Pass | Omission rows expose only five aggregate fields, use closed reasons, stay within 64 rows, reconcile exact totals, and render through the existing escaped client path. No filename, path, raw content, identifier, or payload is exposed. |

## Edge Cases Tested

- Snapshot-plus-one reads, newline-free growth, enforced drain deadlines, final `fstat`, descriptor identity, symlink refusal, and last-good convergence.
- Genuine oversized Claude user rows versus oversized assistant usage with nested user discriminators.
- Claude record/estimated-byte cache eviction, Codex pre-insertion record eviction, per-file rejection, combined record ceilings, and forced-GC measurements.
- One-tool and two-tool high-cardinality omission sets, fair detail allocation, exact per-tool/reason overflow totals, row caps, repeat stability, closed reasons, and content minimization.
- Zero and positive Claude cache-write rows with absent or exact duration evidence.
- Reset-less Fable TTL boundaries, effective-date and high-input pricing boundaries, large-rollout streaming, cold newest-first publication, client escaping, and unavailable-versus-zero behavior.

## Known Limitations

- The long-running local service remains the pre-deploy build; verification used fresh current-code processes and did not mutate the live service.
- `snowravendev-vm` remains unreachable and needs separate host/network diagnosis.
- Exact pricing remains intentionally partial outside reviewed effective intervals and for missing model context; no rate is fabricated.
- Older Codex rows without stable turn identity retain `dedupe_fallback`; this does not make the recognized usage denominator unknown.

## Convention Flags

- Every bounded aggregate that truncates detail must retain exact overflow totals at that same scope; test high-cardinality input across both tools, not only one tool at a time.
- Treat a fresh-process current-corpus scan plus forced-GC cache/heap measurement as a release check for usage-ingestion changes.
