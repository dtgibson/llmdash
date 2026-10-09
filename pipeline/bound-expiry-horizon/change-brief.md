# Change Brief — bound-expiry-horizon

## What is changing
Reject credit-expiry and reset-credit expiration instants more than ten years ahead at both local Codex ingestion and peer normalization. Define one shared ceiling of `10 * 365.25 * 24 * 60 * 60 * 1000` milliseconds relative to the supplied clock; the exact ceiling remains valid. Preserve canonical ISO output and existing expired-reset accounting. Rejected reset dates become missing expiration evidence without lowering the authoritative available count; rejected credit-standing expiry becomes `not-reported`.

## Why now
The 2026-10-02 security review recorded missing plausibility bounds as F3, and the roadmap already calls for this hardening. A fixed-clock probe confirmed `9999-12-31T00:00:00.000Z` survives both `creditExpiryFromIso` and peer `normalizeResetCredits` as available expiry evidence. Local `resetExpirationIso` likewise checks only numeric and JavaScript date validity.

## User-facing impact
Implausibly distant dates stop appearing as provider evidence. Existing missing-expiration and `not-reported` states explain the absence; valid dates, counts, capture ages, freshness bands, and ordinary expiry countdowns keep their behavior. This strengthens existing behavior and adds no screen, flow, schema, or persisted data.

## Design pass
Not needed — no visual change.

## Decisions touched
- 2026-10-02, “Usage credit expiry — reported instants only, stated absence, no invented dates”: resolves F3 for both expiry paths; leaves the separate unobserved-field and observation-clock concerns F1/F2 out of scope.
- 2026-07-30, “Codex resets and global limits — current entitlement evidence in one account story”: preserves authoritative counts, partial/zero/stale states, original observation time, and expired-date count subtraction.
- 2026-07-02, “Multi-host — a new `/api/hosts` endpoint, cached-only peers, account-wide-limits collapse”: strengthens its shared ingestion-normalization rule without changing transport or persistence.
No decision is reversed.

## Scope
Expected code changes: `src/account-credits.js` (shared date ceiling/normalizer), `src/codex-limits.js` (local epoch-seconds reset expiration path), and `src/hosts.js` (peer reset expiration path; credit-standing expiry already uses the shared helper).
Extend focused shared-helper, local Codex account-fact, and peer normalization tests; update the relevant convention/roadmap/decision record during closeout.
Exclude UI/CSS, generic historical/capture timestamps, quota reset windows, billing settings, provider-field discovery, expiry-clock/null-clear fixes, transport, database, deployment configuration, and other devices or hosts.

## What done looks like
Fixed-clock tests accept a normal expiry and the exact ceiling; reject ceiling + 1 ms, year 9999, and an epoch-milliseconds-as-seconds mismatch through local and peer paths.
Rejected dates retain the authoritative count and increase missing-expiration evidence; ordinary past dates still subtract exactly once, with zero/partial/stale states and canonical ISO unchanged.
Focused tests pass, including a full `normalizePeerState` case; no new UI or runtime dependency is introduced.
