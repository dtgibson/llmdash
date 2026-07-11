# Model Limit Detection Bug Brief

## Report

The Claude model-specific limit meters are unreliable: Fable only appears sometimes, and Sonnet has not appeared for the user. The affected setup is the live macOS menu-bar app and dashboard after the model-specific limits feature was deployed.

## Findings

- `scripts/statusline.js` writes `data/claude-ratelimits.json` directly with only `{ rate_limits, capturedAt }`.
- The `/usage` auto-refresh path writes model-specific caps as the optional `model_limits` extension in the same file.
- Any newer organic Claude statusline render can therefore overwrite the file and erase `model_limits`, even though the model caps remain active until their reset time.
- The `/usage` probe finishes as soon as the account-wide session and weekly windows parse. Real Claude TUI captures can render lower sections later, so model-specific sections such as Sonnet can be missed even when the pane eventually contains them.

## Expected Behavior

- Newer account-wide statusline readings must not delete still-active model-specific caps.
- A newer `/usage` capture should update any model caps it sees and preserve other still-active model caps from the prior reading.
- Expired model caps should fall out after their reset time instead of lingering indefinitely.
- The `/usage` probe should wait briefly after the first parseable account-wide reading so late-rendered model cap sections can be captured.

## Blast Radius

The fix is limited to Claude rate-limit capture and persistence:

- `scripts/statusline.js`
- `src/claude-refresh.js`
- parser/write-path tests

The public API and dashboard rendering already consume `model_limits`; the issue is upstream data retention and capture timing.
