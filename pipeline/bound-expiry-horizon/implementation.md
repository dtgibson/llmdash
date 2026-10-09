# Implementation — bound-expiry-horizon

Credit-standing and reset-credit expiration evidence now shares one inclusive ceiling of `10 * 365.25 * 24 * 60 * 60 * 1000` milliseconds (315,576,000,000 ms) ahead of the supplied clock. The exact ceiling is valid; ceiling + 1 ms, year 9999, and epoch milliseconds interpreted as seconds are rejected.

## What changed

- `src/account-credits.js` defines `ACCOUNT_EXPIRY_MAX_AHEAD_MS` and the shared canonical normalizer `boundedAccountExpirationIso`. It preserves past instants for reset-credit accounting. `creditExpiryFromIso` applies the ceiling while retaining its strictly-future requirement and `not-reported` fallback.
- `src/codex-limits.js` applies the shared normalizer to reset-credit epoch seconds against the observation clock, and to numeric/ISO values on the existing credit-standing expiry seam. Rejected reset dates become missing expiration evidence, retaining the authoritative available count. Existing expired-date subtraction remains unchanged.
- `src/hosts.js` applies the same normalizer to peer reset dates before sorting, count-bounding, and past-date subtraction. Peer credit-standing expiry already passes through `creditExpiryFromIso`.
- Existing shared-helper and peer tests were extended; one focused local account-fact test exercises both expiration paths using the fake app-server and a fixed clock.

## Verification

Ran on the development Mac:

```sh
node --test tests/account-credits.test.js tests/codex-account-facts.test.js tests/hosts-degradation.test.js
```

**39 tests passed, 0 failed** (5.45 seconds). Coverage includes normal dates, canonical ISO, the inclusive ceiling, ceiling + 1 ms, year 9999, unit mismatch, preserved authoritative counts/missing evidence, repeated past-date subtraction, zero/partial/stale states, original capture time, and both facts through a complete `normalizePeerState` fixture.

Syntax checks passed for all six changed JavaScript files. `git diff --check` passed. The repository has no build step. The full cumulative suite is reserved for the bundle verification.

## PR description

### What this does

`bound-expiry-horizon` prevents implausibly distant credit expirations from being presented as provider evidence at local and peer trust boundaries. Both paths use the same inclusive ten-year ceiling, with rejected reset dates disclosed as missing evidence and rejected credit-standing dates disclosed as `not-reported`.

### How to test

Run the focused command above. Its fixed-clock fixtures verify that the exact ceiling survives and that rejected dates do not lower the authoritative count, while ordinary past reset dates subtract once.

### Notes for reviewer

The shared normalizer intentionally accepts past instants: reset accounting needs them before dropping them from the wire. Credit-standing expiry separately requires a strictly future instant. The existing unobserved provider-field seam and its observation-clock/null-clear concerns (F1/F2) remain out of scope.

## Seeing the change locally

This change has no new screen or visual design. Its local verification uses synthetic provider responses and peer payloads, with no running dashboard or peer connection required. A maintainer can run the focused command above in the development checkout to see the named checks and their pass/fail results.

In the dashboard, a rejected reset date would leave the available count intact and show the existing missing-expiration disclosure. A rejected credit-standing expiry would show the existing `not-reported` state. Valid expiry countdowns keep their behavior. No separate preview was started for this data-validation change; the orchestrator owns any integrated tailnet preview.

## Scope and limitations

No UI/CSS, quota-reset windows, generic timestamps, transport, persistence, schema, runtime dependencies, deployment configuration, or pipeline state changed. No device or remote peer was accessed. No server, deploy, or commit was performed.

## Convention flags

- Account credit expirations use one shared inclusive ten-365.25-day-year ceiling and canonical normalizer at both local and peer ingestion. Past reset instants stay available internally for count subtraction; rejected future instants are missing evidence and never lower the authoritative count.
- Closeout should update the existing convention/roadmap/decision record that still lists F3 as open. F1/F2 remain separate unresolved concerns.
