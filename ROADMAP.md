# Roadmap

This is a living document. It reflects the current best thinking on what to build
next, not a contract. Things change as you learn more about your users and your
product. Update it freely.

---

## Shipped

7 features shipped.

- **Last shipped:** Menu-bar badge — a zero-dependency SwiftBar/xbar plugin puts
  the most-constrained remaining % (across both tools, both windows) in the macOS
  menu bar, with a full-picture dropdown and honest freshness/offline states; a
  pure consumer of `/api/state`, wired in by a generated wrapper that never
  modifies the tracked source.
- **Previously:** Claude auto-refresh — the Claude limit reading now keeps itself
  fresh via an activity-gated `/usage` screen-scrape probe, so a desktop-app-only
  day of active use no longer leaves the headline number permanently stale, with
  honest failing/disabled states.

---

## Up Next

1. **Limit alerts** — a heads-up when you're running low on a window.

Limit alerts now stand on two things that shipped since they were queued: a
fresh-by-default Claude reading (auto-refresh — DECISIONS.md 2026-07-02) so an
alert isn't built on a permanently stale number, and the menu-bar badge's
most-constrained-window selection + honesty-state model (2026-07-02), which an
alert can reuse for its trigger logic rather than reinvent. Alerts should still
respect the freshness bands — the reading can lag during inactivity, and the
probe can be failing or disabled — rather than blindly trust an old reading.

---

## On the Horizon

- **Multi-host badge** — a host *list* (per-machine dropdown grouping + glyph
  selection/switching) so one badge can watch several tailnet dashboards at once.
  Deliberately deferred from the menu-bar badge to keep the single-glyph scope
  clean; the plugin is built so a host list slots in without a rewrite (a single
  configurable `LLMDASH_BADGE_HOST` shipped instead — DECISIONS.md 2026-07-02).
- **tmux / terminal statusline emitter** — the same `/api/state` → most-
  constrained-glyph logic feeding the terminal statusline the user lives in.
  Would reuse the badge's selection + honesty model and (per CLAUDE.md) ship a
  parity guard for any `public/app.js` helper it must copy.
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
