## Last shipped: menubar-dropdown-legibility-legend (2026-07-08) - CLOSED OUT

The macOS SwiftBar/xbar badge dropdown now uses explicit dark readable colors for
normal dropdown rows (`#111111`, `#1f1f1f`, `#333333`) and darker dropdown-specific
state colors for legend samples and diagnostics. The Legend now explains every
visible badge/menu mark, including `▪`, `·`, `▸ binding`, `◆`, `▲`, `◷`, `⚠`,
`—`, `⊘`, `St12`, `+2`, `✓`, `＋`, `－`, `☰`, `🖥`, `🛈`, and `▬`.

- Commit `8353709` shipped the implementation; commit `52add6b` recorded the
  deployment report and project-memory updates; this close-out follows on
  origin/main.
- Installed `/Users/developer/llmdash` was fast-forwarded to `8353709`, the
  launchd service was restarted, SwiftBar was quit and reopened, and `/api/state`
  + `/api/hosts` returned 200.
- Installed badge output showed one title line before `---`, dark readable
  dropdown rows, and the expanded legend.
- QA passed (`npm test`: 467 passing, 0 failing, 2 skipped) plus focused menu-bar
  suites. Security passed with no findings and `git diff --check` clean.
- Context updated `CLAUDE.md`, `PRODUCT_CONTEXT.md`, `DECISIONS.md`, and
  `ROADMAP.md` so future menu-bar work keeps dropdown readability and legend
  coverage complete.

## Status: idle - no active feature
Pipeline is clean and reset. Run `$weft` to start the next lane.

## Roadmap (open)
- **Up Next:** Limit alerts - notify before a window is exhausted.
- **On the Horizon:** a tmux / terminal statusline (would reuse the compact glyph
  cell grammar and one-title-line separator contract).
