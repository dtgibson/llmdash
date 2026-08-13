## Dashboard Density and Health Trends

### What this does
Recomposes the dashboard into a compact **Capacity now** read: primary quota and
canonical account allowances first, then host-scoped pacing beside current
device health. Each llmdash process now retains its latest 60 health collection
attempts in memory and renders CPU used, RAM used, and disk available as an
accessible per-host SVG with honest gaps.

### How to test
1. Run `npm start` and open `http://localhost:8787`.
2. Confirm Capacity now shows quota and global allowances before one operational
   summary per reachable host.
3. Confirm each host summary shows pacing, current CPU/RAM/disk evidence, and a
   collecting or latest-hour history state.
4. Leave the process running across several poll intervals and confirm points
   accumulate without a page reload or a second browser request cadence.
5. With multiple configured hosts, confirm each chart names and contains only
   its own host. An older peer should keep current health and say history is not
   reported.
6. Run `node --test tests/device-health.test.js tests/hosts-degradation.test.js tests/hosts-client.test.js tests/dashboard-refinement.test.js`, then `npm test`.

### Notes for reviewer
- History is intentionally process-lifetime only, bounded to 60 attempts, and
  clears on restart; no schema, migration, file, telemetry, or SQLite write was
  added.
- Failed metrics append null gaps while the current snapshot independently keeps
  its last-good value and original capture time.
- Peer history accepts only the final 60 raw candidates, canonicalizes time,
  accepts only finite number percentages, clamps to 0–100, sorts/dedupes, and
  never invalidates otherwise valid peer state.
- The renderer defensively repeats the 60-entry and finite-number bounds, breaks
  paths at nulls and cadence gaps, uses non-color line/marker distinctions, and
  includes an exact bounded screen-reader table.
- Configured fan-out is explicitly capped at 16 remote peers plus the always-
  present local host; overflow is ignored with a named diagnostic.
- No runtime dependency, route, probe, timer, mutation surface, deployment
  change, or database migration was introduced.
