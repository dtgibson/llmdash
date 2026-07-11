# QA Report: Model-Specific Limits

## Automated Tests

Command:

```sh
npm test
```

Result:

- 477 tests total
- 475 passing
- 2 skipped
- 0 failed

## Focused Coverage Added

- Real `/usage` fixtures still parse account-wide 5-hour and weekly windows.
- Fable model cap parses as `modelLimits`, not as the account-wide weekly reading.
- Synthetic Sonnet cap parses after the contributing section.
- Optional `model_limits` payload extension writes the expected statusline shape.
- `/api/state` exposes `modelLimits` for all tools.
- Peer model caps are clamped, timestamp-normalized, and stripped to known fields.
- Browser render test confirms model labels are escaped before `innerHTML`.

## Manual Review

Reviewed the diff for:

- No database migration.
- No headroom/account grouping changes from model-specific caps.
- No menu-bar behavior change.
- No raw peer/model label interpolation into styles.
