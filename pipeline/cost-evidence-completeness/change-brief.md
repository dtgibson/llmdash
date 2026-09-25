# Change Brief — Cost Evidence Completeness

## What is changing
Improve the existing local Claude/Codex cost analysis for 7, 30, and 90 days. Reconcile retained usage against both observed-cache and no-cache API-equivalent values, add exact-model rates only when their prices and effective dates are verified, and recover safely readable usage now excluded by the log scanners. Keep remaining gaps explicit and quantified in the existing coverage and evidence notes.

## Why now
The live 30-day snapshot on 2026-09-24 PT prices 126,735 of 154,756 recognized records (23.05B of 31.64B tokens). Its 28,021 known omissions are `claude-fable-5-1`, `claude-opus-5-5`, `gpt-6`, and `gpt-6-sol`; `source_unreadable` and `record_unsupported` also leave the true denominator unknown. The reviewed rate card currently ends at 2026-08-27.

## User-facing impact
Existing cost totals and charts may increase as defensible evidence becomes comparable; coverage notes should explain any records that still cannot be counted or priced. These remain local API-equivalent estimates, separate from owner-confirmed configured subscription spend, never provider charges or invoices.

## Scope
Review `src/usage-ledger.js`, `src/codex-events.js`, `src/cost-analysis.js`, `src/rate-card.js`, `config/api-rates.json`, the existing cost notes in `public/app.js`, and focused tests. Preserve the current endpoint, ranges, cache arithmetic, and subscription settings. No new screen, persistence schema, peer/menu cost data, inferred plan price, or guess for missing model/rate evidence.

## Design pass
Not needed — no visual change. Existing cost values and evidence copy may update within the current layout.

## Decisions touched
- **Local cost analysis (2026-07-16):** separate configured spend from exact-model, effective-dated API estimates; partial and unavailable remain distinct from zero.
- **LLM usage coverage gaps (2026-08-27):** bounded convergent scans and exact omission totals, with a fresh-process current-corpus release check.
- **Codex model-token attribution (2026-08-27):** retain explicit IDs and provenance; infer a missing model only from one unambiguous complete session.
- **Weekly pacing + Codex stats (2026-06-17):** cached input is a subset of Codex input, so pricing must not double-count tokens.

## What done looks like
Every safely readable current-corpus usage record is counted once. Each of the four observed models is priced from a verified effective-dated rate where available or remains a precise omission; unsupported or unreadable evidence stays named with bounded, reconcilable counts where knowable. Per-tool and combined totals, daily histories, observed/no-cache values, and signed cache effect agree across 7/30/90 days. A fresh-process cold scan converges within I/O and memory ceilings; no missing evidence becomes zero or receives a guessed price.
