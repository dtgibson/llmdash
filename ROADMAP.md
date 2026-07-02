# Roadmap

This is a living document. It reflects the current best thinking on what to build
next, not a contract. Things change as you learn more about your users and your
product. Update it freely.

---

## Shipped

6 features shipped.

- **Last shipped:** Claude auto-refresh — the Claude limit reading now keeps
  itself fresh via an activity-gated `/usage` screen-scrape probe (statusline
  transport stays dead, but the on-screen pane parses cleanly), so a
  desktop-app-only day of active use no longer leaves the headline number
  permanently stale, with honest failing/disabled states.
- **Previously:** Claude reading freshness — the Claude limit reading shows its
  age, flagged "aging" past 5 minutes and "stale" past 10, with stale gauges
  kept rendering.

---

## Up Next

1. **Menu-bar / tray badge** — current remaining % glanceable in the corner,
   without opening the dashboard.
2. **Limit alerts** — a heads-up when you're running low on a window.

Both now inherit a fresh-by-default Claude reading (auto-refresh shipped —
DECISIONS.md 2026-07-02): during active Claude use the reading is kept current
by the `/usage` probe, so a badge or alert is no longer built on a permanently
stale number. They should still respect the freshness bands — the reading can
lag during inactivity, and the probe can be failing or disabled — rather than
blindly trust an old reading.

---

## On the Horizon

- Optional strict tailnet-only binding by default
- A fourth source slots in via the source-aware path if ever wanted
- **Auto-refresh — settled:** the statusline/payload avenue is closed for good
  (neither `/status` nor `/usage` populates `rate_limits`); the `/usage`
  screen-scrape shipped instead (DECISIONS.md 2026-07-02). Two open threads
  remain from it:
  - **Auto-refresh teardown hardening** — an ungraceful llmdash exit mid-probe
    can orphan one probe session and leave a stale typescript; a SIGTERM/exit
    teardown hook plus a startup stale-typescript sweep would close it (accepted
    OPEN security follow-up, a deliberate engineering change).
  - **Fable per-model weekly meter** — `/usage` renders a third *Current week
    (Fable)* promotional cap beyond the two contract windows; a possible future
    source-aware addition if per-model caps become worth surfacing.
