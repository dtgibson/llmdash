# Decisions — Dashboard Tool Grouping

## 2026-07-13 — Codex window duration is authoritative

The live Codex app-server returned `primary.usedPercent: 41` with
`windowDurationMins: 10080` and no secondary window. llmdash currently maps
field position (`primary` / `secondary`) to 5-hour / weekly and ignores the
duration, so it labels a real weekly reading as 5-hour and combines it with an
older stored weekly reading.

The run now includes a prerequisite honesty fix: map supported windows by their
reported duration, treat missing windows as unavailable, and prevent obsolete
stored windows from filling an explicitly absent live window. The visual design
must make a missing short window legible without fabricating a percentage.

This expands the original presentation-only scope because making the mislabeled
number more prominent would knowingly worsen the dashboard's core promise.
