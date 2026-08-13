# Schema — Dashboard Density and Health Trends
**Feature:** dashboard-density-health-trends
**Stage:** 3 — The Architect
**Source:** prd.md (approved)
**Path:** Incremental (extending the existing poller-owned device-health and host-state contracts)
**Store:** existing SQLite and owner-managed files remain unchanged; health history is bounded process-lifetime state only.

## Path

Incremental. llmdash already has the required collectors, one poller-owned
`deviceHealth` snapshot per process, additive `/api/state` and normalized
`/api/hosts` contracts, host-scoped rendering, and vanilla SVG conventions. This
feature adds a bounded history to that existing machine-health object and
recomposes existing account, pacing, and host content around it.

There is no table, column, index, migration file, new endpoint, browser polling
loop, request-path probe, runtime dependency, configuration file, or durable
health-history write. The existing SQLite database remains exclusively the
history store for provider limit percentages.

## Current Architecture

### Durable state — unchanged

The complete SQLite schema remains:

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

`usage_snapshots` keeps account-window and model-cap history. Device CPU, RAM,
and disk observations do not enter it. Health history is replaceable operational
context, has an explicit process-lifetime product boundary, and has no backfill
source after restart; persisting it here would mix machine telemetry into an
account-limit table and would violate the approved privacy boundary.

The owner-managed `account-config.json`, `subscriptions.json`, `hosts.conf`, and
captured provider files are also unchanged. There is no health-history file.

### Existing live path

`src/device-health.js` currently owns one detached `DeviceHealthSnapshot` and a
CPU counter baseline. `pollOnce()` calls `refreshDeviceHealth({nowMs})` exactly
once on the existing interval, waits for its bounded CPU/RAM/disk collection,
and only then calls `buildState()` for the local host. Requests never collect
device health.

`/api/state` exposes the local snapshot as optional top-level `deviceHealth`.
The local host cache receives that same detached state in process. A remote host
is read only through its configured, credential-free `GET /api/state`; its state
is strictly normalized by `src/hosts.js` before entering `host-cache`. The
browser reads only `GET /api/hosts`, so the same normalized host contract drives
single- and multi-host presentation.

The current health object has this shape:

```json
{
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
```

Metric status, last-good retention, original capture times, bounded reason
enums, probe timeouts, host identity, and health freshness bands remain exactly
as shipped.

## Additive Health-History Contract

### Wire shape

New processes add one optional `history` member inside `deviceHealth`:

```json
{
  "scope": "device",
  "pollIntervalMs": 60000,
  "cpu": { "status": "available", "usedPct": 37.4 },
  "ram": { "status": "available", "usedPct": 68.2 },
  "disk": { "status": "available", "availablePct": 25 },
  "history": [
    {
      "capturedAt": "2026-08-12T20:00:00.000Z",
      "cpuUsedPct": 35.1,
      "ramUsedPct": 67.8,
      "diskAvailablePct": 25.1
    },
    {
      "capturedAt": "2026-08-12T20:01:00.000Z",
      "cpuUsedPct": null,
      "ramUsedPct": 68.2,
      "diskAvailablePct": null
    }
  ]
}
```

The exact contract is:

- `history` is either absent/null for a host that does not report this feature,
  or an array containing `0..60` observations. A new local process always emits
  an array; it begins empty. Absence is distinguishable from a supported host
  that is still collecting.
- `capturedAt` is the canonical UTC ISO time assigned to that poller's collection
  attempt. It is never a browser-render time, peer-fetch time, or copied
  last-good metric time.
- `cpuUsedPct`, `ramUsedPct`, and `diskAvailablePct` are independently either a
  finite JSON number clamped to `0..100` or `null`. CPU and RAM are explicitly
  **used** percentages; disk is explicitly **available** percentage. The names
  preserve that semantic distinction at every layer.
- An observation with one or more null metrics is valid. An all-null observation
  is an explicit attempted-cadence gap, not a measurement and not a fabricated
  zero.
- Observations are ordered oldest to newest by `capturedAt`, use at most one
  entry per canonical timestamp, and never exceed 60. The newest 60 canonical
  timestamps win.
- No bytes, paths, raw OS output, failure strings, host labels, provider data,
  process identifiers, or cross-host identity is copied into a sample.

This is additive beneath an already optional object. Older clients ignore the
unknown nested key. Older peers omit it and remain reachable. An older llmdash
normalizer already reconstructs the known device-health fields and therefore
drops the unknown key safely; new-to-old mixed deployments retain the current
snapshot while showing history as not reported.

### Observation versus last-good snapshot

The current snapshot and the history answer different questions and must not be
derived from each other after failure retention:

- The current snapshot may retain a prior available value when the latest probe
  fails. Its `capturedAt` remains the time of that prior successful metric, while
  `attemptedAt` advances and `updateStatus` becomes `failed`.
- The history observation represents only the latest collection attempt. A
  metric receives a number only when that metric succeeded in this exact attempt.
  A retained last-good value is therefore `null` in the new observation.

Implementation must construct a `nextSnapshot`, then form the observation from
metrics satisfying all of these conditions: `status === "available"`,
`updateStatus === "ok"`, `capturedAt === attemptedAt` for this refresh, and the
appropriate percentage is a finite number. This check prevents a reducer's
retained last-good value from leaking into a later chart point. Percentages are
clamped once more when the observation is built.

The CPU baseline attempt produces `cpuUsedPct:null` while successful RAM and disk
values may occupy the same observation. Unsupported, measuring, failed,
malformed, and missing metrics all produce null for that metric. One observation
is appended after every completed refresh, including an all-null observation, so
the chart can break a line at a failed cadence without claiming a new reading.
No metric value or original metric capture time is fabricated.

### Local history ownership and eviction

`src/device-health.js` extends its existing module-private snapshot with the
history array; it does not create a second timer or a per-host map. Each llmdash
process records only the machine it is running on, and peers carry their own
history in their own `/api/state` response.

The append operation is a small pure reducer:

1. Accept the previous `0..60` normalized observations and the one new
   observation from the completed refresh.
2. Replace the prior observation if it has the same canonical `capturedAt`.
3. Sort by timestamp ascending so a wall-clock correction cannot create a
   non-chronological wire array.
4. Retain only the final 60 observations.
5. Return a new array; never expose or mutate the module's retained array.

At the default 60-second cadence, 60 observations span approximately 59 elapsed
minutes between first and last timestamps. If the existing `LLMDASH_POLL_MS`
knob is changed or a poll is skipped, the truthful result is still “latest 60
attempts,” not invented minute interpolation. `_resetDeviceHealth()` clears both
the CPU baseline and the history, which makes restart/test semantics explicit.
`getDeviceHealthSnapshot()` continues to return a detached clone and performs no
I/O.

## Peer Normalization

`normalizeDeviceHealth()` remains the single ingest boundary and gains a
`normalizeHealthHistory()` call. A bad or absent history never invalidates the
otherwise valid device snapshot, tool state, or reachable host.

Exact normalization rules:

1. If `history` is absent, null, or not an array, normalize it to `null`
   (“not reported”). A valid empty array remains `[]` (“supported, collecting/no
   observations yet”).
2. Before mapping, select only the final 60 raw array entries. This establishes
   the allocation and traversal bound even for hostile direct-call fixtures; the
   peer HTTP body retains its independent 256 KiB streaming cap. A conforming
   producer is chronological, so these are its newest candidates.
3. Require every retained sample to be a plain object with a canonicalizable
   `capturedAt`. A malformed sample or timestamp drops that sample only.
4. For each percentage, accept only a JavaScript number for which
   `Number.isFinite` is true. Clamp a finite value to `0..100`. A string, boolean,
   null, array, object, `NaN`, or infinity becomes null for that metric without
   dropping valid siblings or the sample's gap timestamp.
5. Drop unknown keys. Canonicalize time with
   `new Date(Date.parse(value)).toISOString()` and never substitute the local
   clock, peer fetch time, state `generatedAt`, or current snapshot capture time.
6. Sort accepted samples oldest to newest. If two canonical times collide, the
   later wire entry replaces the earlier whole sample. Retain the newest 60 after
   de-duplication.
7. Return newly allocated samples/arrays. No object supplied by a peer is retained
   by reference.

Peer history stays under `hosts[n].state.deviceHealth.history`; it is never moved
into `HostReading`, joined to a local ring, or combined with another host. A
failed peer refresh continues to replace that host reading with `state:null`, so
old peer history is not displayed as reachable/current. A legacy reachable peer
continues to show its current normalized health and a fixed “history not reported
by this host” state.

The existing outbound posture does not change: configured hosts only, fixed
credential-free `GET /api/state`, sanitized host/port, no redirect following,
timeout and body cap, and no target derived from a peer response. A full history
is only a few bounded kilobytes, so neither the response-body limit nor any fetch
knob needs expansion.

The effective host set is explicitly bounded to 16 unique remote peers plus the
always-present local machine. Duplicate and local-resolving entries do not
consume the remote budget. Additional unique remotes are ignored with one named
`host-limit-exceeded` diagnostic, bounding poll fan-out, host-cache size, and
per-host chart/table DOM at 17 rendered hosts and 1,020 history rows.

## Runtime and Request Flow

One normal poll tick remains:

```text
pollOnce()                                                    src/poller.js
├─ refresh provider/account/activity caches                  existing
├─ await refreshDeviceHealth({ nowMs })                      existing owner
│  ├─ collect CPU + bounded RAM/disk probes concurrently
│  ├─ reduce current snapshot with last-good semantics       unchanged
│  ├─ build this-attempt observation (successes or nulls)
│  └─ append/dedupe/sort/evict to newest 60; atomic swap
├─ writeLocalHost(... buildState(nowMs))
│  └─ detached deviceHealth, including local history
└─ pollPeers(...)
   └─ GET /api/state → normalizePeerState
      └─ normalizeDeviceHealth + normalizeHealthHistory
```

Serving remains pure:

```text
GET /api/state → buildState() → getDeviceHealthSnapshot() → JSON
GET /api/hosts → getCombined() → JSON
```

Neither handler samples a metric, reads SQLite for health, spawns a command,
contacts a peer, changes a timestamp, or appends an observation. The browser's
existing `GET /api/hosts` cadence receives updated histories naturally. It adds
no health endpoint and no timer.

## Dashboard Composition

The data change and density change share one structural rule: render each fact
once at its canonical scope, in urgent-to-supporting order.

### First-read region

The page's first-read region contains, in semantic DOM order:

1. the existing conditional cross-tool headroom warning;
2. every unique account's primary quota windows;
3. that account's provider allowances/reset entitlements and model caps, once;
4. compact pacing for each applicable tool, with the same source, reset,
   freshness, unsupported, and at-risk evidence already used today; and
5. each reachable host's current device-health snapshot and bounded history
   figure, explicitly labeled with that host.

Single-host mode uses one account summary followed by one operational host
summary labeled `This machine`. Multi-host mode keeps the current account
identity/collapse rules, then renders one operational summary per reachable host.
Pacing stays host/tool scoped because its burn rate comes from that machine's
local activity; the UI must not promote one representative machine's projection
as an account-wide fact. An unreachable host gets its existing named offline
callout and no retained chart.

Activity tiles, local cost analysis, deeper Codex diagnostics, detailed tool
stories, and long-range usage trends follow the complete first-read region.
Evidence that qualifies an urgent number (stale/source-error/unsupported/reset
scope and timing) remains attached to that number; “lower priority” never means
silently stripping evidence.

The renderer is split by responsibility rather than duplicated:

- account window/allowance functions remain the sole canonical account renderers;
- the existing `burnHtml()` logic becomes a shared compact pacing renderer used
  in the first-read operational summary;
- the lower tool renderer becomes activity/diagnostics only and removes its
  pacing call;
- the current `deviceHealthHtml()` becomes the host operational renderer and
  gains the one-hour figure; its old lower-page invocation is removed;
- single- and multi-host modes call the same pacing and device-history functions.

This preserves all values while preventing the same allowance, pacing block, or
health snapshot from appearing both above and below.

### Health figure contract

Each host figure uses the normalized `0..60` samples and plain SVG. It has three
fixed series:

| Series | Value field | Visible/accessibility name | Non-color cue |
|---|---|---|---|
| CPU | `cpuUsedPct` | `CPU used` | solid stroke + circle markers |
| RAM | `ramUsedPct` | `RAM used` | dashed stroke + square markers |
| Disk | `diskAvailablePct` | `Disk available` | dotted stroke + diamond markers |

All use a fixed `0..100%` y-domain. The x-domain covers the expected span of the
retained samples using `pollIntervalMs`; visible copy also states the actual
oldest/newest captured times and sample count so a new process says it is still
collecting rather than claiming a full hour. With the normal 60-second cadence,
the heading reads “Last hour.” A non-default cadence is described as the latest
60 samples and is never relabeled as exactly one hour.

Each series is reduced to contiguous SVG path segments. A null value breaks only
that series. Adjacent finite points are also separated when their timestamps are
more than `2 × pollIntervalMs` apart, so a sleeping process or skipped poll cannot
draw false continuity even if no explicit all-null observation exists. No line is
interpolated through a gap and no null is converted to zero. One valid value may
render as its marker; zero values render at the real zero baseline.

The figure includes:

- visible literal legend labels and distinct line/marker samples;
- a visible coverage/gap/collecting or not-reported sentence;
- an SVG `<title>` and `<desc>` with the host label, semantics, time coverage,
  sample count, and gap statement; and
- a screen-reader-only bounded table with at most 60 rows (`Time`, `CPU used`,
  `RAM used`, `Disk available`), using `Not measured` for null rather than `0%`.

There is no hover-only value, pointer interaction, canvas, script animation, or
keyboard requirement. IDs for title/description linkage come from local render
indices, never peer labels. Host labels and all visible strings pass through the
existing `esc()` boundary; paths and coordinates are generated only from clamped
numbers. CSS distinguishes the series without color and keeps SVG width fluid.
`prefers-reduced-motion: reduce` disables the existing non-essential transitions
for the first-read region and figure while leaving every point, line, label, and
table value present.

### Empty and degraded states

- `history:null`: `History unavailable · not reported by this host`; current
  snapshot remains visible.
- `history:[]`: `Collecting health history · no observations yet`.
- observations with no finite values: show the covered attempt range and
  `No successful health readings in this range`; do not draw axes as if zeros
  were observed.
- only one finite point in a series: draw the named marker and state that the
  trend is still collecting.
- missing values between successes: visible gap copy plus separated segments.
- current metric failure with earlier successful history: keep the current
  snapshot's existing failed-update evidence and show the historical points up
  to their original times; do not extend the last point to now.
- unreachable peer: existing host error only, with no stale state/history.

## File and Module Changes

| File | Change |
|---|---|
| `src/device-health.js` | Add the 60-observation constant, empty history, pure current-attempt observation builder, chronological append/replace/evict reducer, detached history output, and reset behavior. Current collectors and last-good semantics remain unchanged. |
| `src/hosts.js` | Extend `normalizeDeviceHealth()` with optional strict bounded history normalization. Do not alter host parsing, fetch targets, tool/account normalization, or current metric rules. |
| `src/poller.js` | No new owner or cadence. Keep the one existing awaited `refreshDeviceHealth({nowMs})` before local state publication. Comments/tests may pin that history is appended there only. |
| `src/server.js` | No route or request-flow change. `buildState()` obtains the additive nested field from the existing detached reader. |
| `src/host-cache.js` | No new store. It continues to cache each host's whole normalized state; histories remain nested and host-scoped. |
| `public/index.html` | Group the existing account surfaces and host operational summaries into a semantic first-read region before detailed tool, activity, cost, diagnostic, and long-range trend sections. Do not duplicate canonical allowance nodes. |
| `public/app.js` | Add defensive bounded browser normalization, segmented health SVG/table rendering, and shared operational-summary composition. Move existing pacing and current health to the first-read region and remove their exact lower duplicates. Keep the existing `/api/hosts` refresh. |
| `public/styles.css` | Add compact first-read/host-history layout, responsive SVG/legend/table treatment, distinct non-color series styles, phone overflow guards, and reduced-motion overrides using current design tokens. |
| `tests/device-health.test.js` | Cover independent successes, all-null gap attempts, CPU baseline, failed last-good non-copy, duplicate/reordered time handling, 61st-observation eviction, detachment, reset/restart, and one refresh owner. |
| `tests/hosts-degradation.test.js` and host contract suites | Cover legacy omission, empty support, oversized input, malformed sample/time, independently malformed metrics, number-only finite clamp, canonical sort/dedupe, sibling state survival, mutation resistance, and host isolation. |
| `tests/hosts-client.test.js`, `tests/dashboard-refinement.test.js`, and responsive fixtures | Cover first-read ordering, exact duplicate removal, single/multi-host isolation, segmented gaps, semantics/accessibility, empty/not-reported states, max bounded histories, safe escaping, and no horizontal overflow. |
| `README.md`, `PRODUCT_CONTEXT.md`, `pipeline/design-system.md` | Document process-lifetime history, restart reset, default minute cadence, exact used/available semantics, gaps, host scope, no persistence, and the reusable compact health-trend pattern. |

No `package.json`, `config.js`, database, migration, settings, menu-bar, network,
authentication, or deployment-contract change is required.

## Migration and Rollback

1. Add the local history reducer and deterministic tests behind the existing
   device-health reader. A restart starts with `history:[]`; there is no backfill.
2. Publish the additive nested field through existing state assembly and add peer
   normalization. Prove an older peer with no field remains reachable and a new
   payload stays under existing fetch bounds.
3. Add the shared chart renderer and first-read composition. Move, rather than
   copy, pacing, allowances, and health snapshot markup; pin semantic DOM order.
4. Verify focused sampling/peer/client suites, the full `node:test` suite, and
   real phone/desktop layouts with one host, several hosts, 60-point/gapped
   histories, legacy peers, reduced motion, and light/dark themes.
5. Rollback removes/ignores `deviceHealth.history` and restores the previous
   composition. All history disappears naturally on process exit, so there is
   no data migration, cleanup, downgrade transform, or recovery operation.

## Invariants and Verification Seams

- **Bound:** after 61 distinct completed refreshes, only chronological samples
  2 through 61 remain; every local and normalized peer history is `<=60`.
- **No fabricated reading:** a failed RAM refresh after a good RAM value appends
  `ramUsedPct:null`; the current snapshot keeps its old RAM percentage and old
  `capturedAt` with a newer failed `attemptedAt`.
- **Independent metrics:** CPU baseline/failure can be null while RAM and disk
  succeed in the same timestamp; each line gaps independently.
- **No false continuity:** an intervening null or a timestamp jump over twice the
  cadence creates separate path segments; generated SVG contains no bridge.
- **Host isolation:** histories from two peer fixtures remain only beneath their
  originating `HostReading`; no reducer or renderer accepts multiple hosts as one
  health series.
- **Legacy compatibility:** missing history yields not-reported copy, not host
  failure; current snapshot and tool/account state still render.
- **Strict peer input:** only the last 60 raw candidates are traversed; timestamps
  canonicalize; non-number/non-finite metrics become null; finite percentages
  clamp; malformed siblings do not erase valid state.
- **Refresh ownership:** source inspection pins one poller call, no
  `refreshDeviceHealth` call in the server, no health fetch timer/endpoint in the
  browser, and no device-health reference in `src/db.js`.
- **Privacy:** source scans find no health samples in SQL, files, logs, telemetry,
  provider payloads, third-party requests, or menu-bar data.
- **Presentation:** quota windows, canonical allowances, pacing, and each host's
  health precede activity/cost/diagnostics/long trends; promoted content has no
  lower duplicate; phone fixtures have no horizontal document/component scroll.
- **Accessibility:** every series has an explicit used/available name and
  non-color cue; each figure has title/description, visible gap/range copy, and a
  bounded exact text table; reduced motion hides no information.
- **Dependency/performance:** package runtime dependencies remain empty, SVG
  creation is bounded to three 60-point series and one 60-row text equivalent per
  rendered reachable host, and maximum configured-host fixtures add no timer or
  unbounded DOM from peer history.

## Design Decisions

### Extend `deviceHealth`, not SQLite or a new endpoint

The existing object already defines metric meaning, capture ownership, cadence,
host scope, and mixed-version behavior. Nesting history there makes one host state
self-contained and lets `/api/state` and `/api/hosts` carry it through their
existing read-only path. A separate endpoint would create synchronization and
polling questions; SQLite would create retention, privacy, and migration semantics
the product explicitly rejected.

### Record attempted gaps, never retained values

An explicit null at an attempted timestamp is the only deterministic way to show
that one metric failed between two successes without drawing a line through it.
It is not a reading: it carries no number. Constructing history from the finished
last-good snapshot without the exact-success check would be a serious honesty bug,
because a failed attempt would look like a new identical measurement and receive a
false new timestamp.

### Keep history at its producing host

The local process owns only its local ring. A peer exports only its own ring.
`host-cache` does not accumulate, merge, or persist it. This preserves the shipped
host boundary structurally and makes an offline peer's history disappear with its
state rather than masquerade as live data.

### One compact operational read, supporting detail below

Quota and allowances are account facts; pacing and health are host/tool facts.
The first-read region can place them together without erasing those scopes by
keeping account blocks first and explicit host summaries second. Moving the
existing renderers, rather than copying their output, preserves evidence and
enforces the one-canonical-location rule.
