# QA Report — Usage Trends

**Date:** 2026-06-16
**Test Runner:** node:test
**Result:** PASSED

## Test Suite Results
14 tests passing, 0 failing (adds the daily-bucketing aggregation).

## Acceptance Criteria Verification
| Criterion | Result | Notes |
|---|---|---|
| QA-01 Limit-burn chart | ✓ Pass | Remaining-% line per window per tool; now range-responsive |
| QA-02 Tokens/day chart | ✓ Pass | Stacked bars with per-bar totals |
| QA-03 Value-over-time | ✓ Pass | Line with per-point $ labels |
| QA-04 Cache-rate chart | ✓ Pass | Line, 0–100% |
| QA-05 Range switch | ✓ Pass | 24h/7d/30d re-scopes all charts (verified after the x-axis fix) |
| QA-06 Vanilla SVG, no deps | ✓ Pass | SVG only; package.json deps still empty |
| QA-07 Mobile readable | ✓ Pass | Responsive SVG (width:100%) |
| QA-08 Empty/thin state | ✓ Pass | Codex shows "not enough data yet" |
| QA-09 Source labeling | ✓ Pass | Each card states source/scope |
| QA-10 Performance | ✓ Pass | Per-range cache + mtime-bounded reads |
| QA-11 No leakage | ✓ Pass | Trend responses are aggregates/timestamps only |
| QA-12 Existing unaffected | ✓ Pass | Gauges/activity intact — and the CSP fix below actually repaired their bars |

## Fixes during verification (caught by user testing)
- **Blank bars / token mix / legend swatches (cross-cutting):** the strict CSP
  (`default-src 'self'`) silently blocked the inline `style=""` attributes the
  gauges, token-mix, and legends rely on — a **latent bug since the Codex
  refactor** moved those to template strings. Fixed by allowing
  `style-src 'self' 'unsafe-inline'` (script-src stays locked). **FOR THE AUDITOR.**
- **Stale assets:** static files now served `cache-control: no-store`.
- **Limit-remaining not range-responsive:** x-axis was scaled to the data's own
  span; now anchored to the selected window, so ranges differ visibly.
- **Labels:** added y-axis labels with units, per-point `$` labels on the value
  chart, and per-bar token totals.

## Known Limitations
- Limit-burn history is ~today only, so 7d/30d show a narrow band that fills
  leftward over time. Codex trends stay empty until Codex is used.

## Convention Flags
- A strict CSP must allow `style-src 'unsafe-inline'` (or set styles via JS), and
  UI verification must confirm elements actually **render**, not just that the
  page loads — the blank-bar bug passed a "page loads" check but failed visually.
