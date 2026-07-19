# Change Brief — LaunchAgent Reload Hardening

## What is changing
Harden the shared macOS LaunchAgent reload path in
`scripts/install-macos.sh`: after `bootout`, confirm the prior user-domain job
is absent before `bootstrap`, then retry only the observed transient error-5
case within a strict bound. Both the main installer and `--service install`
must inherit the same behavior. Extend `tests/install-service-hooks.test.js`;
leave service removal, plist generation/template, menu controls, APIs, data,
and non-macOS paths unchanged.

## Why now
Several production deployments, including the latest cost-analysis release,
hit `launchctl bootstrap` error 5 immediately after a successful unload. Valid
plists loaded once launchd settled or the existing job was kickstarted, which
isolates the risk to the immediate `bootout` → `bootstrap` handoff.

## User-facing impact
Dashboard, menu-bar, API, and data behavior do not change. A macOS install or
reload may wait briefly and make a bounded retry instead of leaving the service
stopped; persistent or unrelated launchctl failures must still fail loudly.

## Design pass
Not needed — no visual change.

## Decisions touched
- Menu-bar service controls (2026-07-03): preserve `install-macos.sh` as the
  single source of launchctl truth, modern `gui/<uid>` verbs, and an idempotent
  friendly reload; this hardens that decision rather than reversing it.
- Fresh-install recovery (2026-07-01): preserve absolute binary resolution and
  regenerated plist contents; the load-sequencing change must not weaken them.

## What done looks like
Both install entry points wait for the old scratch label to disappear before
bootstrapping. A forced one-time error 5 recovers; a persistent error 5 or any
other bootstrap failure exits nonzero within the bound. Repeated scratch-label
reloads end in `running`, and tests never touch `com.llmdash.dashboard`.
