## Last shipped: menubar-logo-assets (2026-07-08) - CLOSED OUT

The macOS SwiftBar badge's opt-in **Tool marks -> Logos** mode now ships with
bundled local template-image marks: Claude uses the Claude symbol, and Codex uses
the OpenAI blossom mark because Codex is an OpenAI product. The existing neutral
`◆` / `▲` glyph floor remains unconditional, xbar/no-image fallback still names
the tool, and there is no first-use fetch or runtime logo download.

- Commit `78226f6` shipped the implementation and was deployed to the installed
  checkout at `/Users/developer/llmdash`.
- The launchd service was restarted, SwiftBar was quit and reopened, and
  `/api/state` plus `/api/hosts` returned 200.
- Installed asset checks showed both bundled marks as 26x26 RGBA PNGs, and an
  installed render with `toolMark=logo` emitted the neutral `◆` floor plus PNG
  `templateImage=`.
- QA passed (`npm test`: 467 passing, 0 failing, 2 skipped) plus focused menu-bar
  suites. Security passed with no findings; no dependency, shell, HTTP mutation,
  or runtime network surface was added.
- Context updated `CLAUDE.md`, `PRODUCT_CONTEXT.md`, `DECISIONS.md`, and
  `ROADMAP.md` so future menu-bar logo work keeps the local-only bundled-asset,
  documented-source, neutral-floor posture.

## Status: idle - no active feature
Pipeline is clean and reset. Run `$weft` to start the next lane.

## Roadmap (open)
- **Up Next:** Limit alerts - notify before a window is exhausted.
- **On the Horizon:** a tmux / terminal statusline emitter; optional strict
  tailnet-only binding; source-aware fourth-tool expansion; auto-refresh teardown
  hardening; Fable per-model weekly meter.
