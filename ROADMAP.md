# Roadmap

This is a living document. It reflects the current best thinking on what to build
next, not a contract. Things change as you learn more about your users and your
product. Update it freely.

---

## Shipped

27 features shipped.

- **Last shipped:** Reset and billing configuration — Claude now has an
  owner-saved weekly fallback when live reset evidence is unavailable, recurring
  monthly Claude/Codex access costs update automatically, and every fixed billing
  input is reachable from the protected settings page over Tailscale.
- **Previously:** LaunchAgent reload resilience — every reload subprocess has a
  hard deadline, ambiguous deadline completion fails closed, a natural status
  `124` stays distinct from timeout, and uncertain absence retains the original
  bootout evidence.

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

- **Complete-uninstall hardening** — verify service shutdown before destructive
  work, preserve `llmdash.db-journal`, and report detached teardown results and
  recovery locations; the full follow-up is saved for a future Weft run.
- **tmux / terminal statusline emitter** — the same `/api/state` → most-
  constrained-glyph logic feeding the terminal statusline the user lives in.
  Would reuse the badge's selection + honesty model and (per CLAUDE.md) ship a
  parity guard for any `public/app.js` helper it must copy.
- Optional strict tailnet-only binding by default
- A fourth source slots in via the source-aware path if ever wanted
- **Cross-host cost history** — only after a bounded peer-history and
  deduplication contract exists; current cost analysis intentionally values one
  machine's local logs so it cannot silently omit or double-count activity.
