# Deployment Report — Menu-Bar Logo Assets

**Date:** 2026-07-08
**Commit deployed:** `78226f6` (`Bundle menu-bar logo assets`)
**Environment:** Local Mac install at `/Users/developer/llmdash`
**Result:** PASSED

## Deployment Steps

- Committed and pushed the verified logo asset change to `origin/main`.
- Fast-forwarded the installed checkout at `/Users/developer/llmdash` to
  `78226f6`.
- Restarted `com.llmdash.dashboard` with `launchctl kickstart -k`.
- Quit and reopened SwiftBar so the menu-bar plugin reloads from the updated
  installed checkout.

## Health Checks

| Check | Result | Notes |
|---|---|---|
| Installed checkout clean and at deployed commit | Pass | `git -C /Users/developer/llmdash log -1` shows `78226f6`. |
| LaunchAgent running from installed checkout | Pass | `launchctl print` shows state `running`, working directory `/Users/developer/llmdash`, and a fresh pid after restart. |
| `/api/state` healthy | Pass | Returned HTTP 200 after restart. |
| `/api/hosts` healthy | Pass | Returned HTTP 200 after restart. |
| SwiftBar reopened | Pass | `/Applications/SwiftBar.app/Contents/MacOS/SwiftBar` is running after reopen. |
| Installed logo assets present | Pass | Both bundled PNGs are 26x26 RGBA images under the installed checkout. |
| Logo render path works | Pass | Installed-code render with `toolMark=logo` emitted the neutral `◆` floor plus a PNG `templateImage=`. |

## Notes

The user's current saved badge display config is grouped by tool and side-by-side,
but does not currently set `!display-tool-mark=logo`. The deployed code is ready;
choosing **Display -> Tool marks -> Logos** in SwiftBar enables the bundled marks.
