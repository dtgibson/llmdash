# Decisions — claude-auto-refresh

## Stage 4 (Designer review) — 2026-07-02
- **User ratified the two Claude-file boundary exceptions** surfaced from the
  Stage-3 spike: the single permanent trust entry for
  `~/.llmdash/claude-refresh-cwd` (created once, during the spike, on the
  production path) and the ~1-line-per-refresh append to
  `~/.claude/history.jsonl`. Both ship loudly disclosed (startup log + README)
  per spike-report.md SQ-2c.
- **[R2-scrape] variant decision stands ratified** (the user accepted the
  mechanism as presented: /usage screen-scrape in a spawned probe; the
  statusline-payload avenue is dead).
- **Design approved as first-drafted, zero changes**: both new diagnostic
  states reuse `.stale-note` unchanged in its existing slot; disabled note
  keeps the crit tint (not softened to warn); the spawn-error variant keeps the
  full `LLMDASH_CLAUDE_CMD` remedy inline (codex-cmd-failed precedent).
- Deferred by design (recorded, not built): a one-clause update to the
  first-run copy noting readings also arrive automatically once auto-refresh
  ships — the Engineer applies it as part of FR-28's copy truth pass if
  in scope; the Fable third-meter display is a roadmap note, not this feature.
