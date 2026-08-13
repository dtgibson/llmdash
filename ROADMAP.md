# Roadmap

This is a living document. It reflects the current best thinking on what to build
next, not a contract. Things change as you learn more about your users and your
product. Update it freely.

---

## Shipped

31 features shipped.

- **Last shipped:** Dashboard density and health trends — the first read now moves
  from canonical account capacity to compact host operations, with current health
  and bounded process-lifetime history kept separate per machine.
- **Previously:** Device health snapshot — each reachable machine shows its own
  minute-sampled CPU, RAM, and available llmdash data-volume evidence.

---

## Up Next

1. **Limit alerts** — a heads-up when you're running low on a window.

Limit alerts now stand on four things that shipped since they were queued: a
fresh-by-default Claude reading (auto-refresh — DECISIONS.md 2026-07-02) so an
alert isn't built on a permanently stale number; the menu-bar badge's
most-constrained-window selection + honesty-state model (2026-07-02), which an
alert can reuse for its trigger logic rather than reinvent; and the multi-host
peer plumbing (2026-07-02), so an alert can now fire **across hosts** (a combined
`/api/hosts` view already carries every machine's per-tool picture) rather than
only the local machine; plus explicit Codex reset expirations and global model-cap
evidence with distinct partial, unsupported, stale, and source-error states.
Alerts should still respect those evidence states and freshness bands rather than
blindly trust an old reading or invent a missing expiration.

---

## On the Horizon

- **tmux / terminal statusline emitter** — the same `/api/state` → most-
  constrained-glyph logic feeding the terminal statusline the user lives in.
  Would reuse the badge's selection + honesty model and (per CLAUDE.md) ship a
  parity guard for any `public/app.js` helper it must copy.
- Optional strict tailnet-only binding by default
- A fourth source slots in via the source-aware path if ever wanted
- **Cross-host cost history** — only after a bounded peer-history and
  deduplication contract exists; current cost analysis intentionally values one
  machine's local logs so it cannot silently omit or double-count activity.
