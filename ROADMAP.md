# Roadmap

This is a living document. It reflects the current best thinking on what to build
next, not a contract. Things change as you learn more about your users and your
product. Update it freely.

---

## Shipped

25 features shipped.

- **Last shipped:** LaunchAgent reload hardening — macOS install/reload now waits
  for the old user-domain job to disappear before bootstrap and retries only one
  status-5 transient; persistent and unrelated failures still fail loudly.
- **Previously:** Local cost analysis — owner-confirmed subscription spend now
  sits beside exact-model observed-cache and no-cache API-equivalent histories,
  with signed cache effect and explicit evidence completeness.

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
- **LaunchAgent lifecycle follow-ups** — add hard per-subprocess wall-clock
  deadlines to the attempt-bounded reload path, and preserve a non-benign
  `bootout` diagnostic when the later absence check cannot complete.
- **Cross-host cost history** — only after a bounded peer-history and
  deduplication contract exists; current cost analysis intentionally values one
  machine's local logs so it cannot silently omit or double-count activity.
