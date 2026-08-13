# PR description — Device Health Snapshot

## Summary

Adds a glanceable, per-machine CPU, RAM, and available disk-space snapshot near
the top of llmdash. Collection runs once on the existing poll cadence, publishes
through the existing `/api/state` and `/api/hosts` contracts, and retains honest
last-good evidence when one metric fails.

## What changed

- Added an in-memory device-health collector using Node CPU counters, bounded
  macOS `vm_stat`, and `statfs` for the llmdash data volume.
- Added the optional `deviceHealth` member to local state and strict,
  field-by-field normalization for peer state.
- Added one shared single-/multi-host dashboard band with current, aging, stale,
  measuring, unsupported, unavailable, and update-failed states.
- Documented the metric definitions, default one-minute cadence, disk target,
  macOS-only RAM limitation, and the no-history/no-alert/no-realtime boundary.
- Added collector, contract, degradation, and UI coverage without a dependency,
  build step, endpoint, timer, configuration knob, or database migration.

## Seeing Device Health Snapshot locally

1. Run `npm start`.
2. Open <http://localhost:8787>.
3. Find **Device health** directly below **Account limits**.
4. RAM and disk populate on the first completed poll. CPU initially says
   **Measuring** and reports usage after the next poll observation (about one
   minute at the default `LLMDASH_POLL_MS=60000`).
5. To see per-host placement, configure an existing `LLMDASH_HOSTS` peer; each
   reachable host shows its own health before that host's activity. A legacy
   peer is labeled **Not reported by this host** and remains reachable.

## Boundaries

Device-health samples stay in process memory and are never written to SQLite.
There are no trends, alerts, notifications, overall health verdicts, menu-bar
changes, or remediation controls. RAM collection is intentionally macOS-only in
this release; unsupported RAM does not hide CPU or disk.
