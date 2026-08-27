# How to see the usage coverage fix

## 1. Run the automated checks

From the repository root:

```sh
node --test tests/claude-refresh-parse.test.js tests/claude-freshness.test.js
node --test tests/bounded-file.test.js tests/codex-events.test.js tests/usage-ledger.test.js tests/cost-analysis.test.js
npm test
git diff --check
```

The Claude tests prove a reset-less Fable cap survives newer account-only writes until its seven-day retention boundary, only anchored generated user headers exempt an oversized row, and parsed-file cache insertion stays inside record/estimated-byte bounds. The Codex tests prove descriptor reads stop at the opened snapshot detection byte, scan deadlines interrupt newline-free drains, cache bounds apply before insertion, last-complete data survives file growth, and a later pass converges. Cost tests prove high-cardinality omissions aggregate before sorting at both tool and combined scope, 100 omitted records from each tool reconcile to all 200 combined records/tokens within 64 rows, and zero cache writes price without duration evidence.

## 2. Run a cold 90-day convergence check

This scans only local aggregate usage and prints no filenames or raw log content. A large corpus may need several bounded passes; each pass reuses the in-process parse cache.

```sh
node --input-type=module <<'NODE'
import {
  clearCostAnalysisCache,
  getCostAnalysis,
  refreshCostAnalysis,
} from './src/cost-analysis.js';
import { clearUsageLedgerCaches } from './src/usage-ledger.js';

clearCostAnalysisCache();
clearUsageLedgerCaches();

for (let pass = 1; pass <= 40; pass++) {
  const refreshed = refreshCostAnalysis();
  const payload = getCostAnalysis('90d');
  const coverage = payload.scopes.combined.usageCoverage;
  console.log({
    pass,
    refreshed,
    status: coverage.status,
    denominatorKnown: coverage.denominatorKnown,
    recognizedRecords: coverage.recognizedRecords,
    reasons: coverage.reasons,
  });
  if (refreshed && coverage.denominatorKnown) {
    for (const name of ['combined', 'claude', 'codex']) {
      const value = payload.scopes[name].usageCoverage;
      console.log(name, {
        status: value.status,
        denominatorKnown: value.denominatorKnown,
        recognizedRecords: value.recognizedRecords,
        comparableRecords: value.comparableRecords,
        recognizedTokens: value.recognizedTokens,
        comparableTokens: value.comparableTokens,
        reasons: value.reasons,
        omissions: value.omissions,
      });
    }
    break;
  }
}
NODE
```

Expected result: the denominator becomes known, `scan_budget_total_bytes` disappears after convergence, and neither `file_too_large` nor `record_unsupported` remains. Truly unpriced records stay listed by exact model/reason and aggregate counts. If more than 56 model/reason groups exist for one tool, the remaining exact counts appear in bounded `(additional models)` rows instead of growing an unbounded omission map. The combined scope independently re-aggregates both tool lists into at most 48 detail rows plus exact tool/reason overflow rows, so its omission sums still match recognized minus comparable records/tokens.

## 3. Inspect the dashboard evidence notes

Start the development server:

```sh
npm start
```

Open <http://localhost:8787>, scroll to **Cost analysis**, and select **90d**. At the bottom of the section:

- Coverage notes should name each actual omission with its model, reason, record count, and token count.
- Large readable rollouts should no longer appear as `file_too_large`.
- Oversized known non-usage response/tool-output rows should not produce `record_unsupported`.
- Model-less older Codex usage should remain in the recognized denominator under `unknown`, not disappear.

For the exact cached API payload after the poller has converged:

```sh
curl -fsS 'http://127.0.0.1:8787/api/cost-analysis?range=90d' \
  | jq '.scopes | with_entries(.value = .value.usageCoverage)'
```

If the provider currently reports a Fable cap, let at least one normal account-only Claude refresh occur. The cap should remain visible with its original evidence age; an unavailable reset remains unavailable rather than being invented.
