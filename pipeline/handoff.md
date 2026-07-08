## Last shipped: compact-mode-display-honesty (2026-07-08) - CLOSED OUT

The macOS SwiftBar/xbar badge now keeps compact mode compact: exactly one
status-bar title line appears before the first `---`, and explanatory scope copy
like "Watching 3 machines · 1 not reachable" stays in the dropdown where it can
wrap. Display settings now describe the menu-bar glyph honestly: layout controls
which glyph units appear, density controls how terse each glyph cell is, and the
dropdown remains the full per-host view.

- Commit `1ee31db` shipped the implementation; commit `3e0e1af` recorded the
  deployment report and project-memory updates; this close-out follows on
  origin/main.
- Installed `/Users/developer/llmdash` was fast-forwarded through the shipped
  implementation and context update. The launchd service is running, and
  `/api/state` + `/api/hosts` return 200.
- The installed SwiftBar wrapper emitted one title line followed by `---`; a
  forced compact side-by-side/offline preview emitted `▪ S12 T80 D⊘` as the only
  title line, with the watching/unreachable copy below the separator.
- QA passed (`npm test`: 467 passing, 0 failing, 2 skipped) plus focused menu-bar
  separator tests. Security passed with no findings and `git diff --check` clean.
- Context promoted the separator convention in `CLAUDE.md`, clarified the current
  product wording in `PRODUCT_CONTEXT.md`, and logged the display-honesty
  decision in `DECISIONS.md`.

## Status: idle - no active feature
Pipeline is clean and reset. Run `$weft` to start the next lane.

## Roadmap (open)
- **Up Next:** Limit alerts - notify before a window is exhausted.
- **On the Horizon:** a tmux / terminal statusline (would reuse the compact glyph
  cell grammar and one-title-line separator contract).
