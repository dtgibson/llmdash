## Last shipped: dropdown-legibility-aging-symbols (2026-07-08) - CLOSED OUT

The macOS SwiftBar/xbar badge dropdown now uses darker top summary, header,
scope/count, and section rows (`#222222`, `#333333`, `#555555`) and clearer
freshness markers: aging is `◷`, stale remains `⚠`, and `·` is only a separator.
This is presentation-only: polling, `/api/state`, `/api/hosts`, display
preferences, service controls, and action rows are unchanged.

- Commit `053c961` shipped the implementation; commit `498ba95` recorded the
  deployment report and project-memory updates; this close-out follows on
  origin/main.
- Installed `/Users/developer/llmdash` was fast-forwarded to `053c961`, the
  launchd service was restarted, and `/api/state` + `/api/hosts` returned 200.
- Installed badge output showed one title line before `---`, darker dropdown rows,
  and a forced aging render emitted `▪ ◆ 66% ◷`.
- QA passed (`npm test`: 467 passing, 0 failing, 2 skipped) plus focused menu-bar
  suites. Security passed with no findings and `git diff --check` clean.
- Context promoted the five-state glyph grammar in `CLAUDE.md`, clarified product
  wording in `PRODUCT_CONTEXT.md`, updated `ROADMAP.md`, and logged the decision
  in `DECISIONS.md`.

## Status: idle - no active feature
Pipeline is clean and reset. Run `$weft` to start the next lane.

## Roadmap (open)
- **Up Next:** Limit alerts - notify before a window is exhausted.
- **On the Horizon:** a tmux / terminal statusline (would reuse the compact glyph
  cell grammar and one-title-line separator contract).
