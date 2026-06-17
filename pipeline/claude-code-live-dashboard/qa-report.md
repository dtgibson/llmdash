# QA Report — Claude Code Live Dashboard

**Date:** 2026-06-16
**Test Runner:** node:test
**Result:** PASSED (one documented limitation, flagged for The Auditor)

## Test Suite Results
6 tests passing, 0 failing — covering the stats math (token totals, per-model
cost, cache hit rate, session counting, burn projection) and snapshot
de-duplication.

## Acceptance Criteria Verification

| Criterion | Result | Notes |
|---|---|---|
| QA-01 5-hour remaining | ✓ Pass | Matches `/usage` after conservative rounding; within snapshot lag |
| QA-02 weekly remaining | ✓ Pass | 17% used matched `/usage` exactly |
| QA-03 reset countdowns | ✓ Pass | Verified live ("resets in 3h 45m"), ticks down |
| QA-04 data freshness shown | ✓ Pass | "updated Ns ago" indicator, updates as snapshots arrive |
| QA-05 phone access over Tailscale | ✓ Pass | Verified by user on `snowravendev-vm:8787` from Safari |
| QA-06 auto-refresh | ✓ Pass | Page re-pulls every 60s, no manual reload |
| QA-07 graceful degradation | ✓ Pass | "waiting…" state + falls back to last stored snapshot |
| QA-08 snapshot persistence | ✓ Pass | SQLite on disk; survives restart; dedup unit-tested |
| QA-09 no credential leakage | ✓ Pass | API and the captured file carry no tokens, only numbers |
| QA-10 not publicly exposed | ⚠ Partial | Not reachable from the public internet (NAT, no forward), but binds 0.0.0.0 by default so also LAN-reachable. Documented; lock to tailnet via `LLMDASH_HOST` |
| QA-11 token usage stats | ✓ Pass | 5h / week / today computed from logs |
| QA-12 cache hit rate | ✓ Pass | ~98% weekly |
| QA-13 estimated value | ✓ Pass | Weekly, per-model rates |
| QA-14 burn rate & projection | ✓ Pass | tokens/hr + "comfortable" projection vs reset |
| QA-15 token mix | ✓ Pass | input/output/cache-read/cache-write sum to the weekly total |
| QA-16 cache savings | ✓ Pass | Consistent with cache-read volume and rates |
| QA-17 today's value | ✓ Pass | Shown alongside weekly |

## Edge Cases Tested
- No statusline reading yet → gauges show "waiting…" while Activity still populates from logs.
- Live read missing → server serves the last stored snapshot.
- Unchanged readings within the dedup window are not re-recorded.
- Conservative rounding (floor remaining) so headroom is never overstated.

## Known Limitations
- **QA-10 (for The Auditor):** the default binds all local interfaces. On a NAT'd
  VM that means LAN + tailnet, not the public internet. Set `LLMDASH_HOST` to the
  Tailscale IP to restrict strictly to the tailnet.
- Limit numbers reflect the last statusline render, so they can lag `/usage` by a
  snapshot (within ~1%).
- Claude Code's "what's contributing to your limits" insights are intentionally
  not reproduced — they can't be faithfully derived from the readable logs.

## Convention Flags
- Surface security-relevant defaults (like network binding) in the README and the
  startup log, never silently.
