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

## Stage 8 (Deployer) — 2026-07-02
- **Shipped.** Committed to main (62e248e), pushed to origin/main, fast-forwarded
  the installed copy at ~/llmdash to the same commit, and re-ran the macOS
  installer — which regenerated the LaunchAgent plist with the resolved absolute
  claude path baked in as `LLMDASH_CLAUDE_CMD=/Users/developer/.local/bin/claude`
  (the launchd-minimal-PATH resolution QA had deferred) and reloaded the service.
- **Live verification (the deploy target has no staging; this IS production):**
  service running (com.llmdash.dashboard), plist env now carries LLMDASH_CLAUDE_CMD
  alongside the existing codex path and port. `/api/state` on the live service
  showed `haveLimits: true` with both windows populated and a reading only ~22s
  old (5h 22% used / weekly 51% used; weekly reset 2026-07-04T06:00Z matches the
  spike's authoritative epoch), `limitsDiagnostic: null` (fresh). The auto-refresh
  probe fired on the installed copy after restart and produced a fresh reading with
  no manual CLI ritual — the feature's core acceptance criterion, verified in
  production.
- `.claude/` (dev-only preview/worktree tooling) added to `.gitignore` so it stays
  out of the repo.
- Security Finding 3 (orphaned-probe-on-ungraceful-exit) remains an accepted OPEN
  informational item — a follow-up (SIGTERM teardown hook + startup stale-typescript
  sweep), not a blocker; recorded for the roadmap by the Chronicler.
