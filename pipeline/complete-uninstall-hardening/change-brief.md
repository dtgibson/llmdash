# Change Brief — Complete Uninstall Hardening

## What is changing
Strengthen the existing complete-uninstall path in the menu-bar helper. The detached teardown must prove the llmdash LaunchAgent is no longer registered before it removes any artifact, preserve `llmdash.db-journal` with the existing SQLite files, and present the operator with the final outcome plus every location that may contain recoverable data.

## Why now
The reset-and-billing security review found three gaps in the shipped uninstall guarantees: a failed `launchctl bootout` is currently treated as success, the rollback-journal sidecar is absent from the owned-data list, and the detached child computes a result that never reaches the operator.

## User-facing impact
The existing post-uninstall message becomes reliable and complete. It will say whether teardown finished and name preserved-data, partial-rescue, retained-checkout, or manual-recovery locations; no new screen, command, or uninstall choice is added.

## Design pass
Not needed — no visual change. This hardens lifecycle logic and the copy in an existing macOS result dialog.

## Decisions touched
- Menu-bar service controls — a service toggle + two-tier uninstall, preserve/rescue the DB, detached self-uninstall, installer hooks as truth (2026-07-03).
- LaunchAgent reload sequencing — observed absence before bounded error-5 retry (2026-07-19), reused for exact stopped-state evidence.
- LaunchAgent reload deadlines — fail-closed timer authority with exact-child scope (2026-07-20), whose bounded-process rule must also cover uninstall checks.

## What done looks like
No teardown artifact is removed until `launchctl print` proves the service absent, and uncertainty retains the install intact with the original evidence. Preservation and explicit deletion both cover `llmdash.db-journal`; the detached path reports success or failure and names every recovery location. Focused scratch-install tests, the full suite, and a real detached scratch invocation all pass.
