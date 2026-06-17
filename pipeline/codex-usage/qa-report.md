# QA Report — Codex Usage

**Date:** 2026-06-16
**Test Runner:** node:test
**Result:** PASSED (with documented residual risk on Codex activity parsing)

## Test Suite Results
12 tests passing, 0 failing — adds Codex stats parsing/pricing and the
cross-tool headroom logic to the existing Claude coverage.

## Acceptance Criteria Verification

| Criterion | Result | Notes |
|---|---|---|
| QA-01 Codex 5-hour remaining | ✓ Pass | Live via app-server; gauge populated in the user's environment |
| QA-02 Codex weekly remaining | ✓ Pass | Same source; populated |
| QA-03 Codex reset countdowns | ✓ Pass | "time remaining" shown and ticking |
| QA-04 Codex burn projection | ✓ Pass | Computes from the 5-hour reading (burn rate 0 until activity logs exist) |
| QA-05 Side-by-side headroom | ✓ Pass | Smoke-verified: strip fires when a tool <20% and another has more; hidden when both comfortable |
| QA-06 Source labeling | ✓ Pass | Each tool in its own labeled block |
| QA-07 Codex activity stats render | ✓ Pass | Render correctly; empty with "fills in as you use it" note (no Codex logs yet) |
| QA-08 OpenAI pricing | ✓ Pass | Separate table; unit-tested |
| QA-09 Snapshot storage source="codex" | ✓ Pass | Smoke-verified via stored snapshots |
| QA-10 Graceful empty Codex | ✓ Pass | Codex empty does not break the page; Claude unaffected |
| QA-11 No credential leakage | ✓ Pass | API carries no tokens; codex binary holds its own auth |
| QA-12 Claude unaffected | ✓ Pass | After fixing a regression — see below |

## Edge Cases Tested
- Codex with zero logs → graceful empty state, Claude fully intact.
- Headroom strip shown/hidden correctly across both-comfortable and one-low cases.
- Live Codex app-server read confirmed working in the user's real environment
  (it could not run in the build sandbox).

## Regressions found and fixed
- **QA-12:** the multi-tool rewrite dropped two Claude tiles (Cache saved · week,
  Est. value · today). Caught during verification, restored for every tool, and
  confirmed by the user.

## Known Limitations / Residual Risk
- The Codex **activity parser** is built to Codex's documented log shape but
  could not be tested against real logs (none exist yet). Its real confirmation
  comes on first actual Codex use; a mismatch there would be a small fix.
- Codex limit values were confirmed populated by the user but not
  programmatically compared to Codex's own display.

## Convention Flags
- When refactoring a single-source view to multi-source, diff the rendered stat
  set against the prior version so no stat silently drops (the QA-12 regression).
