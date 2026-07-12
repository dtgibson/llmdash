# Handoff — Menu Model Limits

## What Shipped
The macOS menu-bar dropdown now renders Claude model-specific limits from `modelLimits` under the Claude Code section. Account-wide 5-hour and weekly rows remain first, followed by `Model limits` and any Fable/Sonnet-style model rows currently present.

## Key Decisions
- Model-specific limits are dropdown detail only.
- They do not affect the title glyph, binding calculation, display presets, host grouping, polling, or API contracts.
- The model block is omitted when no model limits are present.
- Malformed model reset timestamps degrade to `—`.

## Verification
- `npm test`: 482 passing, 0 failing, 2 skipped.
- Focused menu-bar single-host, multi-host, and display/logo tests passed.
- Security review passed with no findings.
- Deployed runtime plugin to `/Users/developer/llmdash/scripts/menubar/llmdash.5s.js`.
- Live service is running and `/api/state` responds.
- Installed plugin output shows the current Fable cap under `Model limits`.

## Operational Note
The initial installer-hook service reload failed with `launchctl bootstrap` error 5 after unloading the service. The plist validated cleanly and was recovered with direct user-domain bootstrap:

`launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.llmdash.dashboard.plist"`
