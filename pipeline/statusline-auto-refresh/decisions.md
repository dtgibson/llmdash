# Feature Decisions — statusline-auto-refresh

## Freshness bands tightened to 5m / 10m — 2026-07-01 (design review)
**Decision:** Aging begins at 5 minutes, stale at 10 minutes (stale stays derived
as 2× the single `LLMDASH_CLAUDE_MAX_AGE_MS` knob, default 300000), replacing the
Planner's 15m / 60m (4×) defaults.
**Why:** The user can burn the entire 5-hour window in under an hour of heavy
use, so a reading older than a few minutes is already suspect for pacing
decisions.
**Applied to:** prd.md (defaults table, FR-08, FR-16, OQ-03, QA-01/09/13/16/17/
18/20), schema.md (§1a, §3, §4, §8, §9), design.html, design-spec.md.

## Design calls accepted as proposed — 2026-07-01 (design review)
The user approved the first design direction with the four flagged calls as
designed: crit-red stale treatment, pacing rows keep confident copy under a
stale reading, "aging" as the middle-band pill word, and "capture the first
reading" as the no-reading remedy verb.

## Clarified at design review — 2026-07-01
Active CLI use keeps readings seconds-fresh (statusline re-renders continuously
during a session); this feature changes nothing about capture, only the honest
display of age when captures stop.
