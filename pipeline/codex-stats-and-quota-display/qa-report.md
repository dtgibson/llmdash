# QA Report — Codex Stats & Quota Display (Fix)

**Date:** 2026-06-16
**Test Runner:** node:test
**Result:** PASSED — all three bugs fixed, no regressions

## Test Suite Results
15 tests passing, 0 failing (includes the updated both-window `computeHeadroom`
tests: weekly-maxed, 5-hour-low, both-comfortable, single-tool).

## Bug Verification (vs bug-brief "what done looks like")
| Bug | Result | Notes |
|---|---|---|
| 1 — Codex activity shows zeros | ✓ Fixed | Activity now reads "not available" (no fake `0`/`$0` tiles); confirmed via live `hasData:false` |
| 2 — Maxed quota not surfaced | ✓ Fixed | The maxed window's gauge shows "limit reached"; the burn callout shows "Weekly limit reached" (the binding constraint) instead of "on pace to stay under the 5-hour limit" |
| 3 — Headroom strip never fires | ✓ Fixed | `computeHeadroom` now considers both windows; verified live (Codex weekly maxed → "switch to Claude Code, 79% left") and unit-tested |
| Bonus — Codex trends | ✓ Fixed | Codex trends render only the limit-burn chart + a "limits only" note; the empty token/cache/value charts are gone |

## Edge Cases
- Codex with no activity data → "not available" everywhere (tiles, mix, trends), limits still live.
- A 0%-remaining window → "limit reached" on the gauge and as the binding signal in the burn callout.
- Headroom: weekly-maxed, 5-hour-low, both-comfortable, and single-tool-data cases all covered by tests.

## Regressions
None. Claude's activity, gauges, and charts are unchanged (Claude has data → full
activity + all trend charts). The both-window headroom change is covered by tests.

## Confirmed
All three fixes plus the trends cleanup confirmed live by the user.
