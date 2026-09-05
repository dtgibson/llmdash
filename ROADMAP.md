# Roadmap

This is a living document. It reflects the current best thinking on what to build
next, not a contract. Things change as you learn more about your users and your
product. Update it freely.

---

## Shipped

32 features shipped.

- **Last shipped:** Tailnet bind and reporting resilience — the dashboard now
  refuses non-tailnet connections by default (`LLMDASH_ALLOW_LAN=1` opts back in),
  and Claude model caps and Codex windows/resets say why they are missing instead
  of vanishing.
- **Previously:** Dashboard density and health trends — the first read moves from
  canonical account capacity to compact host operations, with health history kept
  separate per machine.

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
Alerts should still respect those evidence states and freshness bands (Codex now
carries a band too, and a missing window or expired cap names itself) rather than
blindly trust an old reading or invent a missing expiration.

---

## On the Horizon

- **tmux / terminal statusline emitter** — the same `/api/state` → most-
  constrained-glyph logic feeding the terminal statusline the user lives in.
  Would reuse the badge's selection + honesty model and (per CLAUDE.md) ship a
  parity guard for any `public/app.js` helper it must copy.
- **Durable LAN opt-out** — `LLMDASH_ALLOW_LAN` in the installer/plist template,
  so the opt-out survives a deploy (today a hand-added plist entry is wiped).
- **Peer ingest of the new diagnostics** — pass `model-cap-expired` /
  `window-not-reported` evidence and the `stale` reset-credit status through the
  `src/hosts.js` normalizer with a peer-path test, so the multi-host view is as
  honest as the local one.
- **Index-seekable model-snapshot query** — replace the per-request `LIKE` scan
  in `getLatestModelSnapshots()` with a range predicate (or a per-tick cache).
- **`/usage` parser reliability** — the pre-existing `parse-failed` probes; a
  layout the scrape can read again, or a sturdier parse.
- **Codex per-limit map** — read Codex 0.153.0's `rateLimitsByLimitId` to
  explain (or fill) the missing 5-hour window.
- A fourth source slots in via the source-aware path if ever wanted
- **Cross-host cost history** — only after a bounded peer-history and
  deduplication contract exists; current cost analysis intentionally values one
  machine's local logs so it cannot silently omit or double-count activity.
