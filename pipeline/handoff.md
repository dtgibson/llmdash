# Handoff — Model Limit Detection

Feature: `model-limit-detection`
Lane: `fix`
Date: 2026-07-11

## What Changed

- Claude's organic statusline capture now uses the shared newest-wins writer instead of replacing `data/claude-ratelimits.json` directly.
- Still-active Claude `model_limits` rows are preserved across newer account-only captures until their reset time.
- Incoming `/usage` model rows replace older rows for the same model/window while other active model rows remain.
- Model rows now keep per-row `captured_at`, so account-only writes do not falsely restamp old model evidence.
- The `/usage` probe now waits briefly after the account windows parse so lower-rendered model sections such as Fable or Sonnet can appear before the reading is written.

## Why

Fable appeared only sometimes because a normal Claude statusline render erased the optional `model_limits` extension. Sonnet-style caps could also be missed if the probe finished before lower sections rendered.

## Verification

- `node --test tests/claude-refresh-parse.test.js` passed: 20 tests.
- `node --test tests/statusline-model-merge.test.js` passed: 1 test.
- Full `npm test` passed: 481 total, 479 passing, 2 skipped, 0 failed.
- `git diff --check` passed.
- Security review passed with no findings.

## Deployment

- Runtime commit deployed: `66507d9 Fix Claude model limit persistence`.
- Pushed `66507d9` to `origin/main`.
- Fast-forwarded installed checkout `/Users/developer/llmdash` from `bc639f2` to `66507d9`.
- Restarted `com.llmdash.dashboard`.
- Relaunched SwiftBar.
- `/api/state` and `/api/hosts` returned successfully.
- Final live check found a Claude Fable model cap: weekly, 16% used / 84% remaining, reset `2026-07-18T06:00:00.000Z`.
- Existing remote host `SRDev VM` remains unreachable; this is unrelated pre-existing state.

## Remaining Notes

- The app only shows model-specific caps that Claude reports through `/usage` or that remain active from a prior captured `/usage` reading; it does not fabricate a Sonnet cap when Claude does not expose one.
- No database migration was needed.
