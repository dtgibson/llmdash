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

## 2026-07-13 — Recover first, then avoid the launchd reload race

The production installer again encountered macOS bootstrap error 5 immediately
after unloading the existing job. The running service was restored on the
previous revision before any further deployment attempt. A valid regenerated
plist then loaded cleanly once launchd saw the job as fully absent, confirming
the failure was in the immediate unload/reload handoff rather than this build.

Because the dashboard release changed no service path or environment value, the
final production restart used `launchctl kickstart -k` against the already
loaded, freshly generated service definition. That kept the service boundary
unchanged and avoided another unload/bootstrap race; all live checks passed.
