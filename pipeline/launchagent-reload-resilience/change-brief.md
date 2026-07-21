# Change Brief — LaunchAgent Reload Resilience

## What is changing
Complete the shared macOS reload hardening in `scripts/install-macos.sh`.
Give `bootout`, every absence `print`, each poll/retry sleep, and every
`bootstrap` attempt a hard per-process wall-clock deadline. Capture the
`bootout` status and diagnostic; when absence cannot later be confirmed, report
that original non-benign evidence with the terminal failure. Both the main
installer and `--service install` must inherit the behavior. Extend the
scratch-only `tests/install-service-hooks.test.js`; leave removal/status hooks,
plist generation, menu controls, APIs, data, and non-macOS paths unchanged.

## Why now
The last release fixed the observed unload/bootstrap race, but its security
review accepted two Low follow-ups: a hung local subprocess can still block an
attempt-bounded reload indefinitely, and a suppressed `bootout` error can be
replaced by a generic unload timeout. Both are now tracked together on the
roadmap and are the remaining gaps in the same reliability boundary.

## User-facing impact
Dashboard, menu-bar, API, and data behavior do not change. A macOS install or
reload must finish or fail within explicit subprocess bounds, and failure copy
must retain the useful launchctl root cause. Booting out an already-absent job
remains a friendly idempotent reload; uncertain state still blocks bootstrap.

## Design pass
Not needed — this is shell lifecycle resilience with no visual interaction.

## Decisions touched
- LaunchAgent reload sequencing (2026-07-19): strengthen finite attempts and
  sleeps into hard subprocess deadlines without changing exact status rules.
- Menu-bar service controls (2026-07-03): keep `install-macos.sh` as the single
  user-domain source of install/reload truth and report partial failure honestly.
- Fresh-install recovery (2026-07-01): preserve absolute binary resolution and
  regenerated plist contents; add no Homebrew command or runtime dependency.

## What done looks like
Hanging fake `bootout`, `print`, sleep, and `bootstrap` commands are terminated
and reaped within fixed deadlines on stock macOS/Bash 3.2; tests do not depend
on `timeout`/`gtimeout` and never touch `com.llmdash.dashboard`. A non-benign
`bootout` that leaves absence unconfirmed returns nonzero, prints its original
diagnostic plus the terminal absence failure, and makes zero bootstrap calls.
Confirmed absence stays idempotent. Print status `113`, bootstrap status `5`,
attempt counts, shared entry points, and all existing failure predicates remain
unchanged; any timeout fails loudly without an unbounded child process.
