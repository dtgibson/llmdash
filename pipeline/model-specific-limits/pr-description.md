# PR Description: Model-Specific Limits

## Summary

Adds model-specific limit support for Claude `/usage` sections such as `Current week (Fable)` or `Current week (Sonnet 4.5)`.

## Changes

- Parses model-specific weekly caps separately from account-wide Claude windows.
- Extends the Claude reading file with optional `model_limits`.
- Normalizes model caps into `tool.modelLimits` on `/api/state` and `/api/hosts`.
- Snapshots model caps using existing `usage_snapshots` rows with sources like `claude-model:fable`.
- Renders model-specific limits in the dashboard wherever the corresponding tool's account limits appear.
- Normalizes peer-provided model caps and escapes model labels in the browser renderer.

## Notes

No database migration. Account-wide gauges, headroom, and same-account grouping remain based on the existing `five_hour` and `seven_day` account windows only.
