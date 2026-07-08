## Last shipped: status-bar-popup-legibility (2026-07-08) — CLOSED OUT

The macOS SwiftBar/xbar dropdown is readable in the states that used to make it
hard to use: primary labels use normal menu text sizing, and long offline or
diagnostic copy is emitted as bounded non-action rows instead of one enormous
line. The new wrapping path sanitizes for the SwiftBar grammar, wraps by words,
and splits a single overlong token so a long unavailable host cannot widen the
whole pop-up. Action rows (`href=`, refresh, scripts, submenus) stay separate and
unchanged.

- Commit `f4e5f3f` (implementation) + `10f6d02` (context/deploy report) + this
  close-out, on origin/main.
- Installed `/Users/developer/llmdash` was fast-forwarded through the shipped
  implementation; the launchd service is running and `/api/state` + `/api/hosts`
  return 200. The installed SwiftBar wrapper previewed a long unavailable host as
  bounded rows.
- QA passed (`npm test`: 463 passing, 0 failing, 2 skipped) plus focused menu-bar
  suites. Security passed with no findings and `git diff --check` clean.

## Status: idle — no active feature
Pipeline is clean and reset. Run `$weft` to start the next lane.

## Roadmap (open)
- **Up Next:** Limit alerts — notify before a window is exhausted.
- **On the Horizon:** a tmux / terminal statusline (would reuse the compact glyph cell
  grammar this feature established).
