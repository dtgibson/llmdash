# Schema — Device Health Snapshot
**Feature:** device-health-snapshot
**Stage:** 3 — The Architect
**Source:** prd.md (approved)
**Path:** Incremental (extending existing runtime state and host contracts)
**Store:** existing SQLite and owner configuration remain unchanged; device health is bounded process-lifetime state only.

## Path

Incremental. The project already has a cumulative SQLite schema and additive
live-state contracts for account limits, machine-local activity, and peer hosts.
This feature extends the poller-owned runtime state and the optional `/api/state`
payload; it adds no table, column, index, migration file, configuration file, or
request-path probe.

## Current Schema State

### Durable SQLite schema

The complete persisted schema remains unchanged after this feature:

```sql
CREATE TABLE IF NOT EXISTS usage_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  captured_at TEXT NOT NULL,
  source TEXT NOT NULL,
  window TEXT NOT NULL,
  used_pct REAL NOT NULL,
  resets_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_usage_source_window_time
  ON usage_snapshots (source, window, captured_at);
```

`source` is `claude-code`, `codex`, or a bounded model-cap source such as
`claude-model:<model-slug>`. Device CPU, RAM, and disk observations never enter
this table: they are replaceable current machine facts, and this feature has no
history or trend semantics.

### Existing owner-managed file state

- `${LLMDASH_DATA_DIR}/account-config.json` remains the strict versioned owner
  source for configured reset and recurring billing data.
- `subscriptions.json`, `hosts.conf`, and the captured Claude rate-limit file
  retain their existing ownership, validation, and seed-once rules.
- `LLMDASH_DATA_DIR` continues to select the directory whose filesystem is
  relevant to this feature; there is no new device-health configuration file or
  path-setting endpoint.

### Existing live state and host contracts

- `/api/state` returns `{tools, headroom, generatedAt}`. Tool objects retain
  their standard limit windows, `modelLimits`, `accountLimits`, projections,
  machine-local activity, freshness, and diagnostic fields.
- Codex reset-credit details remain bounded account facts in process memory;
  they are not persisted. Fable, Sonnet, and future model caps retain the
  existing generic `modelLimits[]` representation.
- `/api/hosts` returns poller-owned `HostReading` entries. A reachable entry's
  `state` is the normalized `/api/state` shape for exactly that host; an offline
  entry has `state:null` plus the existing named host diagnostic.
- The local host is written in-process. Remote hosts are explicit configured
  peers whose credential-free `GET /api/state` responses are normalized before
  cache publication. HTTP handlers only serialize current caches.

### Cumulative local state contract after this feature

`/api/state` gains one optional top-level machine-local object:

```json
{
  "tools": [],
  "headroom": null,
  "generatedAt": "2026-08-12T20:01:00.000Z",
  "deviceHealth": {
    "scope": "device",
    "pollIntervalMs": 60000,
    "cpu": {
      "status": "available",
      "usedPct": 37.4,
      "capturedAt": "2026-08-12T20:01:00.000Z",
      "attemptedAt": "2026-08-12T20:01:00.000Z",
      "updateStatus": "ok",
      "reason": null,
      "intervalMs": 60003
    },
    "ram": {
      "status": "available",
      "usedPct": 68.2,
      "capturedAt": "2026-08-12T20:01:00.000Z",
      "attemptedAt": "2026-08-12T20:01:00.000Z",
      "updateStatus": "ok",
      "reason": null
    },
    "disk": {
      "status": "available",
      "availableBytes": 268435456000,
      "totalBytes": 1073741824000,
      "availablePct": 25,
      "target": "data-volume",
      "capturedAt": "2026-08-12T20:01:00.000Z",
      "attemptedAt": "2026-08-12T20:01:00.000Z",
      "updateStatus": "ok",
      "reason": null
    }
  }
}
```

Contract rules:

- `deviceHealth` is additive and optional. Its absence means “not reported by
  this host,” which preserves mixed-version peers and existing clients.
- `scope` is the literal `device`. `pollIntervalMs` is the finite positive
  effective interval used by the owning poller, bounded on the wire to
  `1_000..86_400_000`; invalid configuration falls back to `60_000` for the
  freshness contract rather than emitting `NaN` or infinity.
- Metric `status` is exactly `available|measuring|unsupported|unavailable`.
  `available` means a valid last-good value exists; it may coexist with
  `updateStatus:failed` when the latest attempt failed.
- `updateStatus` is exactly `pending|ok|failed|unsupported`. `pending` is the
  pre-attempt state, `ok` means the latest attempt or baseline observation was
  valid, `failed` carries one bounded reason, and `unsupported` is a stable
  platform-capability result.
- `capturedAt` is the canonical ISO time of the observation that produced the
  visible value. It is null until a value exists and is never restamped by a
  failed attempt, state assembly, a browser render, or a peer fetch.
- `attemptedAt` is the canonical ISO time of the latest collection attempt for
  that metric. It provides update-failure evidence but never drives freshness.
- Fields not belonging to a metric/status are null or omitted in the local
  snapshot and are reconstructed into the fixed normalized shape at peer
  ingest. No raw operating-system output or arbitrary error message crosses the
  wire.
- Freshness is derived in the client from each metric's `capturedAt` and the
  enclosing `pollIntervalMs`: current at age `<= 2 × interval`, aging at
  `> 2 ×` and `<= 5 ×`, stale at `> 5 ×`. `updateStatus:failed` is shown in
  addition to, not instead of, that evidence-age band.

### Runtime ownership

A new `src/device-health.js` module owns exactly two pieces of process state:

1. the latest immutable `DeviceHealthSnapshot`; and
2. the prior valid CPU counter baseline `{logicalCount,totalMs,idleMs,observedAtMs}`.

The module exports a poller refresh operation, a detached cache reader, pure
normalizers/parsers for tests, and a reset seam for tests. The cache reader
returns a fresh detached object and performs no filesystem call, subprocess,
sampling, or timestamp mutation.

## Changes in This Feature

### Added

#### CPU collector and exact semantics

CPU uses Node's builtin `os.cpus()` cumulative per-logical-CPU time counters;
no subprocess or load average is involved.

For each observation:

1. Require a non-empty CPU array and finite non-negative `user`, `nice`,
   `sys`, `idle`, and `irq` counters for every logical CPU.
2. Sum `totalMs = user + nice + sys + idle + irq` and `idleMs = idle` across
   all logical CPUs.
3. The first valid observation establishes the baseline and publishes
   `status:measuring`, `updateStatus:ok`, `reason:baseline-required`, with no
   percentage or capture time.
4. A later observation is comparable only when the logical-CPU count matches,
   both aggregate counters are monotonic, elapsed wall time is positive and no
   greater than one day, and `deltaTotalMs > 0`. Then:

   `usedPct = clamp(100 × (deltaTotalMs - deltaIdleMs) / deltaTotalMs, 0, 100)`

   The current observation time becomes `capturedAt`, and the actual positive
   wall interval becomes integer `intervalMs`.
5. A CPU-count change, counter regression, malformed reading, or zero delta
   cannot produce a percentage. It resets the baseline to the current valid
   observation when possible. With a prior value, that value and its capture
   time remain while the latest update becomes failed; without one, CPU remains
   measuring or unavailable as appropriate. The next comparable observation
   starts from the reset baseline.

This percentage is aggregate non-idle logical-CPU time over the real interval
between poll observations. A skipped poll naturally lengthens the interval; it
does not invent a realtime sample.

#### macOS RAM collector and exact semantics

macOS RAM uses one fixed `/usr/bin/vm_stat` execution per poll. The collector
parses only the banner page size and these known integer fields:

- `Pages active`
- `Pages wired down`
- `Pages purgeable`
- `Pages occupied by compressor` (with the documented older
  `Pages used by VM compressor` alias accepted)

The definition is:

`usedPages = max(0, activePages - purgeablePages) + wiredPages + compressorOccupiedPages`

`usedPct = clamp(100 × usedPages × pageSize / os.totalmem(), 0, 100)`

This counts active memory after subtracting explicitly purgeable pages, plus
wired memory and physical pages occupied by compressed memory. It excludes
free, inactive, speculative, and purgeable capacity.
It is intentionally a stable “currently committed” approximation for the
glanceable feature, not Activity Monitor's pressure graph or a claim about swap.

The command uses `execFile` with the absolute executable, an empty fixed argv,
no shell, an allowlisted `PATH`, `LANG=C`, `LC_ALL=C`, a 2-second timeout, and a
32 KiB output cap. Missing fields, changed output, non-integer/negative values,
an invalid page size/total, timeout, signal, spawn failure, or nonzero exit fails
RAM only. On non-macOS platforms RAM is `unsupported`; this release does not
substitute `totalmem - freemem`, because that would count reclaimable cache as
irreducibly used and violate the approved semantics.

#### Data-volume disk collector and exact semantics

Disk uses Node's builtin `fs.promises.statfs(config.dataDir, {bigint:true})`.
`config.dataDir` already exists by normal server startup because SQLite is
initialized first. The values are:

`totalBytes = blocks × bsize`

`availableBytes = bavail × bsize`

`availablePct = clamp(100 × availableBytes / totalBytes, 0, 100)`

`bavail`, rather than `bfree`, is authoritative because it represents space
available to the llmdash service account after filesystem reservations. Both
byte counts must be non-negative safe integers, `totalBytes > 0`, and
`availableBytes <= totalBytes`. Only the literal target label `data-volume`
leaves the collector; the configured path, mount path, device name, and raw
statfs object do not.

The statfs promise is guarded by a 2-second publication deadline and one module
single-flight latch. A timed-out kernel call is discarded if it later resolves,
and the latch prevents another disk call from accumulating while it remains in
flight. Thus the poller can publish a failed disk attempt within its bound
without moving blocking work onto an HTTP request or creating an unbounded
backlog.

#### Atomic poller refresh and failure retention

`pollOnce()` starts one device-health refresh on each existing poll tick. CPU
observation is immediate; RAM and disk collection run concurrently. The refresh
settles within the fixed collector deadline, constructs one detached snapshot,
and swaps the module cache once. It never writes SQLite.

Each metric is reduced independently:

- success replaces only that metric's value and sets its own capture/attempt
  time;
- a failed latest attempt preserves a prior value and capture time, changes
  only `attemptedAt`, `updateStatus`, and the bounded reason;
- failure without a prior value publishes `unavailable` rather than zero;
- stable unsupported capability publishes `unsupported` without preventing the
  other metrics;
- a second refresh call while one is already active returns the current cache
  rather than starting overlapping work (the enclosing poller already has its
  own single-flight guard; the module guard makes the invariant local and
  testable).

Bounded reason enums are:

- CPU: `baseline-required|counter-unavailable|counter-invalid|counter-reset`
- RAM: `unsupported-platform|probe-timeout|probe-failed|output-too-large|parse-failed|invalid-values`
- Disk: `statfs-timeout|statfs-failed|invalid-values`

No thrown message, command, path, PID, username, or raw output is retained.

#### State/API attachment

`buildState()` reads the detached device-health cache and appends it as the
top-level `deviceHealth` member. It does not start collection. The local host
cache consequently receives the same object through its existing in-process
`buildState()` path, and peers expose their own health through the existing
fixed `/api/state` fetch.

No endpoint is added:

- `GET /api/state` returns local device health additively;
- `GET /api/hosts` returns each host's health only as
  `hosts[n].state.deviceHealth`;
- all other routes and request methods remain unchanged.

The synchronous startup host seed may initially contain measuring/pending
health. The immediate first poll produces RAM/disk values and the CPU baseline;
the next valid poll produces the first CPU percentage.

#### Peer normalization

`normalizePeerState()` gains `deviceHealth: normalizeDeviceHealth(payload.deviceHealth)`.
The top-level health object must be plain, have `scope:device`, and carry a
valid bounded interval; otherwise it normalizes to null. Null means a reachable
legacy or invalid-reporting peer, not an offline host.

For a valid object, each metric is normalized independently into a fresh fixed
object:

- accept only known status/update/reason enums and drop unknown keys;
- canonicalize timestamps through `toISOString()` and never default one to now;
- coerce percentages to finite numbers and clamp them to `0..100`;
- accept CPU `intervalMs` only as a positive integer no greater than one day;
- accept disk bytes only as non-negative safe integers with total greater than
  zero and available no greater than total, then recompute `availablePct`
  rather than trusting the peer's percentage;
- an invalid available value degrades only that metric to unavailable with no
  fabricated capture time; a valid last-good value with `updateStatus:failed`
  remains available;
- drop free-form diagnostic text and every filesystem/machine field not in the
  contract.

Peer `fetchedAt`, peer state `generatedAt`, and unrelated tool freshness never
replace metric capture times. An offline peer retains the existing `state:null`
behavior and therefore shows no stale health values.

#### Shared dashboard presentation contract

`public/app.js` gains a shared `deviceHealthHtml(health, hostLabel)` renderer and
bounded client normalizers/formatters. It is used in both modes:

- single-host: one semantic section immediately after `#single-limits` and
  before `#details-heading`, labeled `This machine`;
- multi-host: the same inner component inside each reachable `.host`, after the
  host heading and before that host's tool activity.

The stable order is CPU, RAM, Disk. CPU and RAM show rounded whole percentages;
disk shows binary-unit available capacity (`GiB`, or `MiB` below 1 GiB) plus a
rounded available percentage. Exact underlying finite values remain available
to accessible names. The component uses text/symbol state cues, semantic labels,
and no hover-only meaning. Color/meter fill is supplemental.

The browser derives current/aging/stale live from the retained capture time and
reported poll interval on its existing one-second render pass; it never changes
metric values. A failed latest update is named alongside the age. Measuring,
unsupported, and unavailable get fixed copy and no zero/meter. A reachable host
with `deviceHealth:null` gets `Device health unavailable · not reported by this
host`. No cross-host aggregate, health verdict, animation, history, or menu-bar
consumer is introduced.

### Modified

- The cumulative `/api/state` model adds the optional top-level `deviceHealth`
  object. All existing tool, headroom, generated-time, account, and activity
  meanings remain unchanged.
- `HostReading.state` adds the same optional normalized member. Host identity,
  reachability, account collapsing, offline behavior, and fan-out targets remain
  unchanged.
- `pollOnce()` invokes the new collector once before `writeLocalHost()` so the
  state published for that tick contains the completed bounded snapshot.
- The dashboard's single- and multi-host composition adds the shared health
  section at the PRD-defined locations. Existing account-limits-first ordering
  remains canonical.
- README/startup documentation gains metric definitions, data-volume scope,
  minute cadence, macOS RAM support, and the no-history/no-alert/no-realtime
  boundary. It exposes no path or command output.

### Unchanged

- `usage_snapshots`, its index, all existing rows, snapshot deduplication,
  model-cap history, trends, and database initialization.
- Account reset-credit runtime state, account/config files, recurring billing,
  and cost analysis.
- Existing tool windows, model limits, account identity, headroom, activity,
  insights, freshness, and limit diagnostics.
- Peer list/configuration, hardened target selection, `/api/state` fetch path,
  timeout/body cap, no-redirect rule, and host-cache lifetime.
- Route names, methods, cache/security headers, and the no-I/O-on-request rule.
- Menu-bar badge data and presentation, alerts, notifications, health history,
  and any control/remediation path.

## Migration Plan

1. Add `src/device-health.js` with pure CPU-delta, vm-stat parsing, statfs
   normalization, metric reduction, cache detachment, and injected test seams.
   No existing state or persistence changes at this point.
2. Invoke the bounded refresh from `pollOnce()` before local host publication.
   Prove startup, single-flight, partial failure, last-good retention, and no
   `insertSnapshot()` calls.
3. Add the optional local `deviceHealth` state member and strict peer
   normalization. Update intentional contract fixtures while proving an omitted
   member keeps legacy peers reachable and existing consumers unchanged.
4. Add the shared single-/multi-host renderer, semantic markup, responsive
   styles, live age-band derivation, and fixed degraded-state copy.
5. Document the selected semantics and run focused collector, poller, server,
   peer-normalization, client, accessibility, responsive-browser, and full
   regression suites.

There is no database migration, data rewrite, backfill, or configuration
migration. Deployment is a normal code/service reload. At first startup RAM and
disk appear after the immediate poll; CPU says Measuring until the next valid
poll interval.

Rollback removes/ignores the optional state field, collector invocation, and UI
section. Existing peers ignore the additive key, and newer peers interpreted by
older aggregators already drop unknown keys. Process restart discards all device
health. There is no durable state to restore or reverse.

## Design Decisions

### CPU uses counter deltas, not an instantaneous guess

`os.cpus()` supplies cumulative idle and work counters without a command or
dependency. Two observations are the minimum honest basis for “usage,” and the
actual elapsed interval is retained. CPU hotplug or counter reset explicitly
re-baselines instead of turning discontinuity into pressure.

### macOS RAM favors a documented stable definition over false portability

`totalmem - freemem` would label reclaimable cache as used on platforms where
“free” is deliberately small. The bounded `vm_stat` fields support the approved
active/wired/compressed definition on the primary macOS deployment. Other
platforms remain independently supported for CPU and disk while RAM says
Unsupported until an equally explicit semantic is designed.

### Disk follows the data, not an arbitrary root

The filesystem containing `LLMDASH_DATA_DIR` is where exhaustion can stop new
SQLite snapshots and threaten the product's no-backfill history. `bavail`
answers what the service account can actually allocate. The user sees the
stable label “llmdash data volume,” never a private path or device identifier.

### Evidence and update attempts are separate clocks

`capturedAt` belongs to the visible measurement; `attemptedAt` belongs to the
collector attempt. Keeping both prevents a failing collector or fresh peer fetch
from laundering an old value into a fresh one. Age bands remain derivable and a
failed update can be visible without unnecessarily discarding useful last-good
evidence.

### Optional host field is the compatibility boundary

Health is machine-local, so it belongs at the same top level as a peer's tools,
inside that host's state. Making the field additive and optional lets old and new
instances coexist: absent health is “not reported,” malformed health loses only
that surface, and an unreachable host still follows the stronger existing
offline rule.

### No persistence is a product constraint

The requested glance does not need a trend, and device telemetry is replaceable
on the next minute. Keeping it in memory avoids turning the irreplaceable usage
history table into a general monitoring store, avoids retention/privacy policy,
and makes rollback exact.

### Verification seams

- CPU unit tests cover the first baseline, known aggregate delta, 0%/100%
  boundaries, several logical CPUs, count change, counter regression, zero
  delta, malformed/non-finite counters, long skipped intervals, and mutation
  resistance.
- RAM parser tests cover current and older compressor labels, page sizes, the
  active-minus-purgeable plus wired plus compressed formula, clamping, missing
  and duplicate fields, localized/malformed text, oversized output, timeout,
  nonzero exit, spawn failure, and non-macOS unsupported state.
- Disk tests cover `bavail` rather than `bfree`, bigint conversion, the 250 GiB
  of 1 TiB example, zero total, negative/impossible values, unsafe integers,
  rejection, deadline, late completion discard, and the one-in-flight latch.
- Reducer/cache tests cover independent success, mixed partial snapshots,
  first-run states, last-good retention, separate attempt/capture clocks,
  atomic swap, detached reads, overlapping refresh calls, and process reset.
- Poller/server tests prove one refresh per poll tick, refresh-before-local
  publication, zero request-triggered collections, no SQLite writes/schema
  change, additive state shape, and startup behavior.
- Peer tests cover omission by a legacy host, invalid top level, each enum,
  hostile/unknown fields, non-finite/out-of-range percentages, impossible byte
  pairs, canonical timestamps, no restamping, partial degradation, detached
  objects, and offline precedence.
- Client tests cover single-/multi-host placement, fixed CPU→RAM→Disk order,
  binary capacity formatting, current/aging/stale exact boundaries, update
  failure with last-good evidence, measuring/unsupported/unavailable/not-
  reported copy, accessible text cues, no verdict, and unchanged tool rendering.
- Browser QA covers phone and desktop widths, light/dark modes, long bounded
  host labels, keyboard/screen-reader order, no color-only state, no horizontal
  overflow, and one-second age updates without metric interpolation.
