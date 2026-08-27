# Close local LLM usage coverage gaps

## Summary

- Retain reset-less Claude model-cap evidence for one bounded weekly window, preserve its original capture time across newer account-only writes, and still expire explicit resets at their reset instant.
- Stream descriptor-validated Codex rollout files line by line under byte, line, time, file, result, and cache ceilings. Cold scans publish bounded newest-first evidence, converge through the parse cache, and retain the last complete parse when an active file grows mid-read.
- Classify oversized Codex token candidates explicitly while proving known oversized response/tool-output rows are non-usage, so neither kind is silently treated as a generic non-object row.
- Stop descriptor reads at the opened snapshot plus one detection byte and enforce scan deadlines during newline-free drains, while preserving final descriptor identity checks and last-good cache fallback.
- Prove oversized Claude user rows from the anchored generated top-level header; nested discriminator fragments can no longer hide an oversized assistant usage row.
- Keep valid model-less Codex token tuples in the known denominator as `unknown`, add bounded model/reason omission rows to coverage, and render those exact record/token counts in the evidence notes.
- Bound the combined ledger and both parsed caches before insertion, using deterministic eviction plus a conservative Claude byte estimate. Omission groups are capped while accumulating and fold high-cardinality tails into exact per-reason overflow rows.
- Re-aggregate the two bounded tool omission lists at the combined scope: up to 48 fairly allocated detail rows plus 16 reserved tool/reason overflow rows preserve exact combined record/token totals without post-hoc truncation.
- Add reviewed Opus 5 and GPT-5.6 Sol pricing, including the current GPT-5.6 alias interval, high-input tiers, and separate Claude 5-minute/1-hour cache-write channels.
- Price zero cache-write Claude rows exactly without requiring irrelevant 5-minute/1-hour duration evidence; positive cache writes still require a proven split.
- Document the streaming/convergent scan and cache-write pricing behavior in product context and the README.

## Verification

- Security-remediation focused suite: 66/66 passed (`bounded-file`, `codex-events`, `usage-ledger`, `cost-analysis`).
- Combined-output retry suite: 44/44 passed across cost aggregation, client rendering, and endpoint contracts; its 100-Claude + 100-Codex adversarial case reconciles all 200 omitted records/tokens in 50 bounded rows.
- Broader affected focused suite: 132/132 passed, including Claude retention/freshness, cache eviction, streamed growth/deadline handling with last-good retention, nested-discriminator rejection, per-tool and combined high-cardinality omission aggregation, and zero-write pricing.
- Full suite: 813 tests, 811 passed, 2 environment-dependent skips, 0 failed.
- `git diff --check`: clean.
- A fresh production-style 90-day `refreshCostAnalysis()` run converged in one process on pass 19 in 69.619 seconds with a known 1,128,205-record denominator and no `file_too_large`, `record_unsupported`, or scan-budget reason remaining.
- At convergence, forced-GC heap use was 170 MiB. The bounded caches held 127,630 Claude records (63,773,384 conservatively estimated bytes) and 1,001,217 Codex records; the configured ceilings are 96 MiB / 175,000 Claude records, 1,100,000 Codex records, and 1,250,000 combined result records.

## Deliberate boundary and known limitations

Parser `scanDiagnostics` stays internal. The approved public contract is met by bounded omission rows grouped by tool, model, and reason with exact record/token totals; after 56 detailed rows per tool, additional models fold into a deterministic `(additional models)` row for each reason. The combined scope re-accumulates those already bounded lists, retaining up to 48 fairly split details and up to 16 exact tool/reason overflows. Exposing parser counters would duplicate implementation detail without making an omission more actionable.

The converged Codex omissions remain honest instead of being guessed:

- `gpt-5.6` before its reviewed effective interval: `rate_missing`, 6,223 records / 787,914,623 tokens.
- Normalized `Other`: `unknown_model`, 113 records / 11,095,912 tokens.
- Missing model context (`unknown`): `unknown_model`, 57,564 records / 8,269,374,441 tokens.

Older Codex records without stable turn identity still report `dedupe_fallback`. The configured peer `snowravendev-vm` remains operationally unreachable from this machine and is intentionally separate from the local coverage fix.
