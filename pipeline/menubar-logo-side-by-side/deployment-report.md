# Deployment Report — Menu-Bar Logo Side-By-Side

Date: 2026-07-08

## Result
Deployed and verified.

## Production Target
- Installed checkout: `/Users/developer/llmdash`
- Branch: `main`
- Commit: `004c72d` (`Refine menu-bar logo rendering`)
- Service: `com.llmdash.dashboard`
- Menu-bar host: SwiftBar

## Deployment Steps
- Pushed `004c72d` to `origin/main`.
- Fast-forwarded `/Users/developer/llmdash` from `2201331` to `004c72d`.
- Restarted the LaunchAgent with `launchctl kickstart -k gui/502/com.llmdash.dashboard`.
- Relaunched SwiftBar with `open -a SwiftBar`.

## Health Checks
- LaunchAgent is running from `/Users/developer/llmdash` with pid `26460`.
- SwiftBar is running from `/Applications/SwiftBar.app/Contents/MacOS/SwiftBar`.
- `http://127.0.0.1:8787/api/state` returned current tool state.
- `http://127.0.0.1:8787/api/hosts` returned the local host and the configured remote host state.
- Installed checkout is clean and aligned with `origin/main`.

## Acceptance Verification
- Current SwiftBar output uses the selected `Claude vs Codex · side-by-side` preset with `Tool marks -> Logos`.
- The title line includes `templateImage=<base64>`.
- The decoded template image is 34x16.
- The title line still includes both text-floor marks: `◆` for Claude and `▲` for Codex.
- The dropdown legend includes the logo explanation: side-by-side uses a paired mark.

## Notes
- The configured remote host `SRDev VM` is still unreachable, which matches the existing app state and is unrelated to this deployment.
