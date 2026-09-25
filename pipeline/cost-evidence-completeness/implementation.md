# Cost Evidence Completeness — implementation

## Built

- Added effective-dated, exact-ID standard API rates for `claude-fable-5-1`, `claude-opus-5-5`, and `gpt-6-sol`. Claude's 5-minute and 1-hour cache writes remain separate. GPT-6 Sol retains its above-272,000-input-token full-request tier.
- Recognized the generated top-level Codex `compacted` header as a definite non-usage row when its line exceeds the 1 MiB parsing cap. The current corpus has 19 such rows. Oversized token events still mark the scan incomplete.
- Evidence notes now give the exact count of included records lacking stable cross-file IDs. Source read failures describe a source or subtree accurately.
- Kept unsuffixed `gpt-6` unpriced: official OpenAI API model and pricing documents name `gpt-6-sol`, `gpt-6-luna`, and `gpt-6-astra`, but do not establish an exact API price or alias mapping for `gpt-6`.

The endpoint, ranges, subscription settings, and storage schema are unchanged.

## Rate evidence

| Exact ID | Effective from (UTC) | Standard USD / million input, output, cache read | Cache write / tier evidence |
| --- | --- | --- | --- |
| `claude-fable-5-1` | 2026-09-01 | $10, $50, $0.25 | 5m $12.50; 1h $20 |
| `claude-opus-5-5` | 2026-09-22 | $4, $20, $0.20 | 5m $5; 1h $8 |
| `gpt-6-sol` | 2026-09-22 | $2, $10, $0.20 | Over 272K input: $4 input, $15 output, $0.40 cached input for the full request |

Anthropic's [Fable 5.1 overview](https://docs.anthropic.com/en/docs/models/fable-5-1/overview) and [Opus 5.5 overview](https://docs.anthropic.com/en/docs/models/opus-5-5/overview) establish exact API IDs and release dates; its [pricing page](https://docs.anthropic.com/en/docs/about-claude/pricing) establishes all five token channels. Official OpenAI documentation establishes the [GPT-6 Sol API release date](https://developers.openai.com/api/docs/changelog), [exact model ID and long-context rule](https://developers.openai.com/api/docs/models/gpt-6-sol), and [standard short/long rates](https://developers.openai.com/api/docs/pricing). These are API-equivalent estimates for retained local logs, not provider charges.

## Current-corpus verification

On 2026-09-24 PT, a fresh Node process scanned the current 90-day local corpus and converged on pass 17. Each pass retained the 512 MiB changed-byte ceiling and the existing wall-time, file, line, and record bounds. The final scan had no unreadable, unsupported, or outstanding scan-budget reason. Claude had a known denominator; Codex was partial solely because 60 included records lack stable cross-file identity. The 19 oversized `compacted` snapshots supplied no token usage and no longer cause an unsupported-record warning.

| Range | Comparable / recognized records | Exact known omissions | Reconciliation |
| --- | --- | --- | --- |
| 7d | 21,138 / 23,397 | `gpt-6`: 2,259 records, 364,679,241 tokens | Passed |
| 30d | 152,882 / 155,513 | `gpt-6`: 2,631 records, 400,101,344 tokens | Passed |
| 90d | 328,306 / 331,050 | `gpt-6`: 2,631 records, 400,101,344 tokens; `Other`: 113 records, 11,095,912 tokens | Passed |

For every range and each Claude, Codex, and combined scope, observed and no-cache daily sums equal their summary values; final cumulative values equal those summaries; the signed cache effect equals no-cache minus observed; and recognized minus comparable records and tokens exactly equal the omission rows. The 90-day Codex ledger also labels 22,002 records / 2,189,992,913 tokens as session-level model estimates. Those are included in the priced set where the inferred exact ID has a reviewed rate. The 60 fallback-identity records are counted and disclosed, not called omitted.

## Verification

- `node --test tests/rate-card.test.js tests/codex-events.test.js tests/cost-analysis.test.js tests/usage-ledger.test.js tests/cost-analysis-client.test.js` — 83 passed.
- Fresh-process current-corpus convergence and 7d/30d/90d arithmetic checks — passed.
- `git diff --check` — passed.

## PR description

### What this does

Cost analysis now prices three newly observed models from provider-published exact rates and dates. It also classifies oversized Codex compaction snapshots correctly so non-usage content does not make coverage look incomplete; remaining model and identity gaps stay quantified.

### How to test

1. Run the focused test command above.
2. Open the cost analysis view and switch among 7d, 30d, and 90d.
3. Compare each scope's final chart values with its summary and check Evidence notes for the exact `gpt-6` omission and fallback-identity count.

### Notes for reviewer

Do not substitute GPT-6 Sol pricing for unsuffixed `gpt-6`; the exact mapping is not documented. The full cold scan takes multiple bounded passes on this machine. No production deployment is part of this stage.

## Seeing cost evidence completeness

Open the tailnet-only development preview at **https://hephaestus-developer.giraffe-chuckwalla.ts.net:8934/**, then scroll to **Local cost analysis**. Switch the **7d**, **30d**, and **90d** range controls. The Evidence notes list any unpriced records and the count with fallback identities; the Reconciled breakdown and charts show the observed-cache, no-cache, and signed cache-effect values. The preview currently has no owner-confirmed subscription coverage, so configured subscription spend is unavailable for both tools; API-equivalent values remain separate.

For a local developer run, start the repository with `npm start`; its default address is `http://127.0.0.1:8787/`. The remote preview above is the user-facing route and does not require access to localhost on the development Mac.
