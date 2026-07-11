# PRD: Model-Specific Limits

## User Story

As an llmdash user, I want to see individual model caps such as Fable or Sonnet alongside my account-wide limits, so I know when a specific model is constrained even if my main account windows still have room.

## Requirements

- FR-01: Claude auto-refresh parses model-specific weekly limit meters from `/usage` when they are present.
- FR-02: Account-wide `five_hour` and `seven_day` readings remain unchanged and never take their value from a model-specific section.
- FR-03: Model-specific caps include label, stable model slug, window, used percentage, remaining percentage, reset time when parseable, capture time, and a stable source id.
- FR-04: The state API includes `modelLimits` for every tool. Tools without model caps return an empty array.
- FR-05: The poller records model-specific snapshots using the existing snapshot storage path.
- FR-06: The dashboard renders model caps as supplemental model-specific limits, not as account-wide gauges.
- FR-07: Multi-host peer payload normalization clamps percentages, canonicalizes timestamps, and drops malformed model caps.
- FR-08: All dynamic labels from local or peer model caps are escaped at render.

## Acceptance Checks

- Fixture `/usage` captures still parse the account-wide 5-hour and weekly windows.
- The fixture Fable cap is parsed into `modelLimits` and no longer disappears.
- A synthetic Sonnet cap is parsed without adding a new account-wide window.
- `/api/state` emits `modelLimits: []` for Codex and populated model limits for Claude when the reading file contains them.
- Peer state with hostile model labels keeps the label raw during normalization but escapes safely in the browser renderer.
