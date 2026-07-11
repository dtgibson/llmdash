# Handoff — Model-Specific Limits

Feature: `model-specific-limits`
Lane: `feature`
Date: 2026-07-10

## What Changed

- Claude `/usage` model caps such as `Current week (Fable)` now parse into `modelLimits` instead of being discarded.
- Account-wide `five_hour` and `seven_day` limits remain separate and cannot be replaced by model-specific caps.
- The Claude statusline reading can include optional `model_limits`.
- `/api/state` and `/api/hosts` expose `modelLimits` arrays for every tool.
- Peer-provided model caps are normalized and clamped before rendering.
- The dashboard renders a compact `model-specific limits` section wherever tool account limits are shown.

## Why

Some Claude models have their own limits. Without a separate model-limit channel, llmdash could show healthy account-wide headroom while hiding a constrained model-specific cap.

## Verification

- Full `npm test` passed: 477 total, 475 passing, 2 skipped, 0 failed.
- Real Fable fixtures prove model caps parse separately from account-wide windows.
- Browser render tests verify model labels are escaped before `innerHTML`.
- Security review found no blocking issues.

## Deployment

- Runtime commit deployed: `dfc0c1e Add model-specific limit display`.
- Source, `origin/main`, and installed checkout were confirmed at `dfc0c1e`.
- Restarted `com.llmdash.dashboard`.
- Relaunched SwiftBar.
- `/api/state` and `/api/hosts` returned successfully and include `modelLimits` arrays.
- The current live Claude reading has no active model cap, so `modelLimits` is empty until a future `/usage` capture includes one.
- Existing remote host `SRDev VM` remains unreachable; this is unrelated pre-existing state.

## Remaining Notes

- No database migration was needed.
- No menu-bar title behavior changed in this feature.
