## Codex model token coverage

### What this does
Preserves exact GPT-5.6 Terra and Luna labels, prices them with official effective-dated short- and long-context rates, and attributes historical model-less Codex records only when the complete session contains one unambiguous explicit model. The estimate is carried as record provenance and disclosed with exact record and token totals. Active rollout growth now reports a retry-pending state while retaining last-good evidence instead of claiming the source is unreadable.

### How to test
1. Run `node --test tests/codex-events.test.js tests/usage-ledger.test.js tests/rate-card.test.js tests/cost-analysis.test.js tests/cost-analysis-client.test.js`.
2. Run `npm test`.
3. Run the fresh-process 90-day convergence check in `pipeline/codex-model-token-coverage/how-to-see.md`.
4. Open the dashboard, select the 90-day Cost analysis range, and inspect Usage and pricing coverage plus Evidence notes.

### Notes for reviewer
Inference is deliberately session-scoped: zero or multiple explicit normalized models leave missing-model records unresolved. Pricing begins on July 30, 2026 and never back-projects before the documented change. The remaining current-corpus Codex omission is the unmapped `Other` model group; no rate was guessed for it. No endpoint, persistence, dependency, provider request, raw-log exposure, or request-path scan was added.
