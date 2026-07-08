# Roadmap

This is a living document. It reflects the current best thinking on what to build
next, not a contract. Things change as you learn more about your users and your
product. Update it freely.

---

## Shipped

15 features shipped.

- **Last shipped:** Menu-bar dropdown legibility and complete legend — the macOS
  badge dropdown now uses explicit dark readable colors for normal rows and a
  complete Legend that explains every visible badge/menu mark, including the `▪`
  llmdash mark.
- **Previously:** Dropdown legibility and aging symbols — the macOS badge dropdown
  started using darker top summary/header rows, and aging readings switched to the
  clearer `◷` marker while stale readings kept `⚠`; the change was
  presentation-only, with `/api`, polling, persistence, and action rows unchanged.

---

## Up Next

1. **Limit alerts** — a heads-up when you're running low on a window.

Limit alerts now stand on three things that shipped since they were queued: a
fresh-by-default Claude reading (auto-refresh — DECISIONS.md 2026-07-02) so an
alert isn't built on a permanently stale number; the menu-bar badge's
most-constrained-window selection + honesty-state model (2026-07-02), which an
alert can reuse for its trigger logic rather than reinvent; and the multi-host
peer plumbing (2026-07-02), so an alert can now fire **across hosts** (a combined
`/api/hosts` view already carries every machine's per-tool picture) rather than
only the local machine. Alerts should still respect the freshness bands — a
reading can lag during inactivity, the probe can be failing or disabled, and a
peer can be offline — rather than blindly trust an old reading.

---

## On the Horizon

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
