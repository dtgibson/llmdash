# Roadmap

This is a living document. It reflects the current best thinking on what to build
next, not a contract. Things change as you learn more about your users and your
product. Update it freely.

---

## Shipped

5 features shipped.

- **Last shipped:** Claude reading freshness — the Claude limit reading shows
  its age, flagged "aging" past 5 minutes and "stale" past 10 with the CLI
  remedy named (the planned auto-refresh spawn was refuted by spike, so the
  honest freshness layer shipped instead).
- **Previously:** Weekly limit predictor + Codex stats — both pacing windows
  per tool with status pills, and Codex token activity populated from local
  logs.

---

## Up Next

1. **Menu-bar / tray badge** — current remaining % glanceable in the corner,
   without opening the dashboard.
2. **Limit alerts** — a heads-up when you're running low on a window.

Both inherit the Claude manual-refresh reality: a reading is only as fresh as
the last real CLI statusline render (auto-refresh was refuted — DECISIONS.md
2026-07-01), so badge/alert logic must respect the freshness bands rather than
trust an old reading.

---

## On the Horizon

- Optional strict tailnet-only binding by default
- A fourth source slots in via the source-aware path if ever wanted
- Auto-refresh revival: probe whether `/status` (a client-side slash command,
  no message sent) populates `rate_limits` in the statusline payload — the one
  untested avenue after the spike refuted idle-session refresh
  (`pipeline/statusline-auto-refresh/spike-report.md` has the validated spawn
  mechanics a reviver must honor)
