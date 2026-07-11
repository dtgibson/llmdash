# QA Report — Model Limit Detection

**Date:** 2026-07-11
**Test Runner:** node:test via `npm test`
**Result:** PASSED

## Test Suite Results

Focused tests:

```sh
node --test tests/claude-refresh-parse.test.js
```

20 tests passing, 0 failing.

```sh
node --test tests/statusline-model-merge.test.js
```

1 test passing, 0 failing.

Full suite:

```sh
npm test
```

481 tests total: 479 passing, 0 failing, 2 skipped.

Whitespace check:

```sh
git diff --check
```

Passed.

## Acceptance Criteria Verification

| Criterion | Result | Notes |
|---|---|---|
| Newer account-wide statusline readings must not delete still-active model-specific caps. | Pass | Covered by `tests/statusline-model-merge.test.js` and the new write-path regression in `tests/claude-refresh-parse.test.js`. |
| A newer `/usage` capture should update model caps it sees and preserve other still-active model caps from the prior reading. | Pass | Covered by the new Fable/Sonnet merge regression: incoming Fable replaces old Fable while Sonnet remains preserved. |
| Expired model caps should fall out after their reset time instead of lingering indefinitely. | Pass | Covered by the expired-model regression in `tests/claude-refresh-parse.test.js`. |
| The `/usage` probe should wait briefly after the first parseable account-wide reading so late-rendered model cap sections can be captured. | Pass | Verified in `src/claude-refresh.js`: the probe now records the best parse and waits `MODEL_LIMIT_SETTLE_MS` before writing. Existing parser tests confirm late Sonnet-style sections parse correctly once present. |
| Existing Claude account-window parsing and newest-capturedAt behavior must not regress. | Pass | Existing parser, reset conversion, newest-wins, freshness, diagnostics, server-state, and menu-bar suites all pass. |

## Edge Cases Tested

- Preserved model rows from older files without per-row `captured_at` keep the old file-level `capturedAt`, so account-only writes do not restamp stale model evidence.
- Incoming model rows receive their own `captured_at`.
- Matching model/window rows are replaced by newer `/usage` evidence.
- Different active model rows are carried forward when a newer payload omits them.
- Expired model rows are dropped on the next newer write.
- The actual `scripts/statusline.js` executable preserves model caps while updating account windows.
- Sonnet-style model labels such as `Sonnet 4.5` parse into stable `claude-model:sonnet-4-5` rows.

## Known Limitations

The app still only displays model-specific caps that Claude reports through `/usage` or that remain active from a prior captured `/usage` reading. If Claude does not expose a Sonnet cap for the account/window, llmdash does not fabricate one.
