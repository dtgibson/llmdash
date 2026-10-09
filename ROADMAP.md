# Roadmap

This is a living document. It reflects the current best thinking on what to build
next, not a contract. Things change as you learn more about your users and your
product. Update it freely.

---

## Shipped

35 features shipped.

- **Last shipped:** Usage credit expiry — the Codex credits group now opens with
  the soonest provider-reported reset expiry (date, countdown, age, and a note
  when it lapses before the weekly reset), and the balance states that Codex does
  not report its expiry.
- **Previously:** Available API credits — Codex's credit standing now sits
  beside its resets in the account story (Claude honestly says it reports none),
  and the server answers readiness within a second regardless of log-corpus size.

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
blindly trust an old reading or invent a missing expiration. An expiry alert can
read the reset-credit expirations and the balance's expiry state directly: only
per-reset instants are provider evidence, and "not reported" is a stated absence,
never a date to infer.

---

## On the Horizon

- **Credit-expiry seam decision** — the build reads a balance-expiry key
  (`credits.expiresAt` / `expires_at`) that no Codex response has ever carried,
  with a guessed name and unit. Either drop the read until Codex documents the
  field, or give it its own observation clock, treat an explicit `null` as a
  clear, and name it in the README.
- **Cost evidence gaps** — add a rate for unsuffixed `gpt-6` only with exact
  provider evidence, resolve `Other` to exact model IDs before pricing, and
  improve cross-file identity evidence before claiming fallback records unique.
- **tmux / terminal statusline emitter** — the same `/api/state` → most-
  constrained-glyph logic feeding the terminal statusline the user lives in.
  Would reuse the badge's selection + honesty model and (per CLAUDE.md) ship a
  parity guard for any `public/app.js` helper it must copy.
- **Durable LAN opt-out** — `LLMDASH_ALLOW_LAN` in the installer/plist template,
  so the opt-out survives a deploy (today a hand-added plist entry is wiped).
- **Peer ingest of the new diagnostics** — the `stale` reset-credit status and
  the credit standing now cross peers; still pass the `model-cap-expired` /
  `window-not-reported` fields (model, window, last-observed time), which the
  `src/hosts.js` normalizer drops today, with a peer-path test.
- **Faster first Codex limits after a cold start** — the first reading follows the
  first tick's analytics (17–33 s, badge shows `—` meanwhile); read limits first.
  The owner-settings save's synchronous cost refresh could likewise route through
  the poller's single-flight tick.
- **Badge credits row** — an optional dropdown row for the credit standing, keeping
  the badge title and `computeMultiBadge` unchanged.
- **Index-seekable model-snapshot query** — replace the per-request `LIKE` scan
  in `getLatestModelSnapshots()` with a range predicate (or a per-tick cache).
- **`/usage` parser reliability** — the observed dropped weekly-heading character
  is now accepted, but future pane layouts can still cause `parse-failed` probes;
  keep the scrape resilient without inventing partial readings.
- **Codex per-limit map** — read Codex 0.153.0's `rateLimitsByLimitId` to
  explain (or fill) the missing 5-hour window.
- A fourth source slots in via the source-aware path if ever wanted
- **Cross-host cost history** — only after a bounded peer-history and
  deduplication contract exists; current cost analysis intentionally values one
  machine's local logs so it cannot silently omit or double-count activity.
