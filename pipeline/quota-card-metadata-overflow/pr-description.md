# PR Description — Quota Card Metadata Overflow

## Summary

Keeps every primary quota card focused on remaining quota and geometrically
uniform. The card header now contains only the window name, the quota figure
occupies a reserved row, and a compact footer renders only `RESET · <duration>`
or `RESET · —`.

Full reset evidence remains visible once in the associated pacing row. Live and
provider readings are named there; a configured Claude fallback retains its exact
next occurrence, timezone abbreviation, IANA timezone, countdown, and pacing
consequence.

## Implementation

- Split duration-only gauge formatting from detailed pacing evidence formatting.
- Removed `.win-reset` and all source/date/timezone prose from quota-card headers.
- Added one semantic `.limit-reset-compact` footer to available and unavailable
  cards; unavailable windows always render an em dash rather than implying reset
  evidence for a window the provider did not report.
- Reserved the same five CSS grid rows for available, maxed, missing-reset, and
  unavailable cards at desktop and compact breakpoints.
- Kept long evidence wrap-safe in `.burn-cap`, outside the elevated gauges.
- Added explicit pacing copy for missing reset timing and unavailable windows.

## Preserved Invariants

- Raw provider payloads and `/api/state`, `/api/hosts`, and reset-configuration
  contracts are unchanged.
- Provider-over-configured reset precedence, boundary refetch, freshness/stale
  treatment, account identity, polling, projections, history, and multi-host
  collapse semantics are unchanged.
- Maxed windows still render `limit reached` with a full critical bar.
- Unavailable slots still render no percentage or filled meter.
- Menu-bar output and its presentation helpers are unchanged.

## Verification

- `node --test tests/hosts-client.test.js tests/dashboard-refinement.test.js tests/app-copy.test.js tests/menubar-parity.test.js`
  — 64 passed, 0 failed.
- `/Users/developer/.weft/bin/weft-design-lint check public/`
  — clean, 5 files scanned, 0 findings.
- `git diff --check` — clean.

Coverage now pins compact in-card grammar, full live/provider/configured pacing
evidence, reset-boundary recovery, missing and unavailable states, maxed behavior,
multi-host fallback scope, deterministic desktop/390px/320px rows, two-column
phone geometry, and wrap-safe supporting evidence.

## Convention Flags

No new dependency, framework, build step, API, persistence, outbound request,
configuration knob, menu-bar behavior, or security-sensitive sink was introduced.
Dynamic meter widths remain the only inline presentation styles.

## Limitation

The in-app browser runtime had no connected browser during the Engineer pass, so
interactive screenshot/geometry inspection could not run there. Deterministic
row and overflow contracts are covered by the focused tests; QA should perform
the final rendered desktop, 390px, and 320px measurement pass.
