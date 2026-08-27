# Bug Brief — Usage Coverage Gaps

## What is broken
- Fable is nondeterministic: the live Claude reading is fresh but currently has `modelLimits: []`, so the weekly cap vanishes between otherwise healthy updates.
- Live 30-day cost coverage is partial: 199,039 records / 35.6B tokens are recognized, but only 116,886 / 16.7B are comparable; the denominator is unknown.
- A cold Codex analytics refresh now returns `false` with no data, even though the long-running service still has a fresh cache; a restart would expose the gap.
- The configured peer `snowravendev-vm` times out, so its usage cannot be assessed from this machine and remains an operational uncertainty.

## Steps to reproduce
1. Run `curl -fsS http://127.0.0.1:8787/api/state | jq '.tools[] | select(.source=="claude-code") | {freshness,modelLimits}'`; observe a fresh reading with `modelLimits: []`.
2. Seed a temporary reading with a Fable `model_limits` row whose `resets_at` is `null`, then call `writeReadingIfNewer` with a newer account-only payload; re-read it and observe that `model_limits` was deleted.
3. Run `curl -fsS 'http://127.0.0.1:8787/api/cost-analysis?range=30d' | jq '.scopes.combined.usageCoverage'`; observe partial coverage and all three named reasons.
4. Inventory the eligible local logs and replay `scanClaudeUsage` / `scanCodexUsage`; observe the two unpriced models, one 200.6 MB rejected rollout, and 86 oversized non-usage Claude rows.
5. In a fresh Node process call `refreshCodexAnalytics()` with default configuration; it returns `false` with no generated data while the warm live service still answers from cache.

## Root causes
- The model-cap merge conflates “reset not reported” with “expired”; reset-less Fable evidence survives only until another organic statusline capture.
- The reviewed rate card lacks observed `claude-opus-5` (~81,952 records / 19.3B tokens) and `gpt-5.6` (~6,265 / 788M), producing most of the cost gap.
- One 200.6 MB Codex rollout exceeds the usage ledger's 128 MiB file cap and hides ~559 records / 70.8M tokens rather than being read incrementally.
- Eighty-six valid 1.0–1.36 MB Claude *user* rows contain no usage, yet their size alone marks all Claude usage coverage `record_unsupported`.

## Expected behavior
- A current model cap remains visible across account-only writes even when reset timing is absent, with reset shown unavailable and bounded independent freshness/expiry rules.
- Every recognized usage model is priced from reviewed effective-dated evidence or named precisely as unpriceable; non-usage rows do not reduce usage coverage.
- Large and growing logs are processed incrementally within hard budgets, and a cold process converges without an all-or-nothing cache dependency.
- Coverage diagnostics quantify the omitted records/tokens without leaking filenames or raw log content; unreachable peers remain explicitly separate.

## Blast radius
- Capture/retention: `src/claude-refresh.js`, `scripts/statusline.js`, and model-limit tests; `/api/state`, `/api/hosts`, dashboard, and menu-bar consume the result.
- Usage ingestion: `src/usage-ledger.js`, `src/codex-events.js`, `src/codex-stats.js`, their caches/bounds, and focused scan/cold-start tests.
- Pricing/coverage: `config/api-rates.json`, `src/rate-card.js`, `src/cost-analysis.js`, and the bottom-of-page evidence notes in `public/app.js`.
- No database migration is indicated; the remote peer timeout is outside the proven local code defects and needs separate host/network diagnosis.

## Constraints and flags
- Public, effective-dated pricing must be confirmed before adding Opus 5 or GPT-5.6 rates; never infer prices from nearby model names.
- Preserve regular-file checks, symlink refusal, byte/line/time ceilings, atomic last-good caches, and unavailable-versus-zero semantics.
- Provider-omitted cap resets and offline peers cannot become “complete” by fabrication; retain honest evidence age and source diagnostics.
- Treat a clean cold-process scan as a release gate: the currently running service's warm cache masks the Codex analytics failure.

## What done looks like
- A reset-less Fable fixture survives repeated newer account-only writes, expires only under the new explicit policy, and renders stable across refreshes.
- A raw-log replay reports complete usage coverage for all safely readable current records; any genuinely unpriced model is isolated by model and token count.
- Fresh-process Codex activity/insights and 30-day cost analysis initialize within budgets on today's 4.2 GiB corpus and keep advancing as files grow.
- Live verification shows stable model caps and no false `record_unsupported`/`file_too_large` notes; the peer timeout remains separately actionable if unresolved.
