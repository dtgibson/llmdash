# PRD — Device Health Snapshot
**Feature:** device-health-snapshot
**Date:** 2026-08-12
**Stage:** 2 — The Planner
**Source:** strategic-brief.md (approved)

## Feature Overview
Add a compact, host-scoped device-health snapshot near the top of llmdash that
shows CPU usage, RAM usage, and available space on the filesystem that stores
llmdash data. The snapshot follows the dashboard's existing one-minute refresh
cycle so the user can recognize sustained machine pressure without receiving a
realtime monitoring experience.

## User Stories

**US-01** — As the llmdash owner, I want to see my current CPU usage near the top of the dashboard, so that I can tell at a glance whether processor pressure may be slowing my coding work.

**US-02** — As the llmdash owner, I want to see my current RAM usage near the top of the dashboard, so that I can recognize memory pressure without opening a separate system utility.

**US-03** — As the llmdash owner, I want to see how much space remains on the volume that stores llmdash data, so that I can recognize low-space risk before it affects local history or work.

**US-04** — As someone viewing more than one machine in llmdash, I want device health attached to the machine it describes, so that one host's resource pressure is never mistaken for another's.

**US-05** — As someone making a quick decision from operational data, I want failed, stale, unsupported, and pending readings stated honestly, so that a missing measurement is never presented as healthy zero usage.

## Functional Requirements

### Placement and Device Scope

**FR-01** — In single-host mode, the dashboard shall place the device-health snapshot after the canonical account-limits area and before Tool details, activity, diagnostics, cost analysis, and trends.

**FR-02** — In multi-host mode, the dashboard shall place each reachable host's device-health snapshot inside that host's section, before that host's tool activity and diagnostics; it shall not create a combined cross-host CPU, RAM, or disk value.

**FR-03** — The snapshot shall identify the device it describes as `This machine` in single-host mode and by the existing bounded host label in multi-host mode.

**FR-04** — Each snapshot shall contain exactly three primary metrics: CPU usage, RAM usage, and available disk space.

### Metric Meaning

**FR-05** — CPU usage shall be a finite percentage from 0 through 100 representing the proportion of aggregate logical-CPU time that was non-idle during the collector's documented sampling interval; it shall not be derived from load average or from a single cumulative counter reading.

**FR-06** — RAM usage shall be a finite percentage from 0 through 100 using the operating system's current used-memory semantics, with readily reclaimable or available memory excluded from used memory when the platform exposes that distinction. The documented definition shall identify which memory classes count as used.

**FR-07** — Available disk space shall represent space available to the llmdash service on the filesystem containing the configured llmdash data directory. The snapshot shall show both a human-readable available amount and the percentage of that filesystem's total capacity that is available.

**FR-08** — The disk metric shall name the target in user-facing copy as the llmdash data volume or an equivalent bounded volume label; it shall not expose the configured data-directory path in the browser payload or UI.

**FR-09** — CPU, RAM, and disk availability shall be independent. A valid metric shall remain visible when either of the other two metrics is pending, unsupported, malformed, or failed.

### Collection, Refresh, and Freshness

**FR-10** — Device-health collection shall run as part of the existing llmdash polling cycle, whose default cadence is 60 seconds and whose configured cadence remains the single refresh authority; the feature shall not introduce a second refresh setting or independent recurring timer.

**FR-11** — Page rendering, the browser's one-second age refresh, and HTTP requests shall never initiate or wait for a device-health measurement.

**FR-12** — Each successful metric shall retain the canonical capture time of the observation that produced it, and the UI shall show the snapshot's age with minute-level framing rather than implying continuously live values.

**FR-13** — A last-good metric shall be treated as current through two configured polling intervals, aging after two and through five intervals, and stale after five intervals. The state shall be derived from the metric's retained capture time and the expected polling interval, not from page-load or host-fetch time.

### Degraded and Mixed-Version States

**FR-14** — When collection of a metric fails after a prior success, the dashboard shall retain that metric's last-good value and original capture time, label the latest update attempt as failed, and allow the value to progress through the aging and stale states in FR-13.

**FR-15** — When a metric has no valid last-good value, the UI shall show a reason-specific state of `Measuring`, `Unsupported`, or `Unavailable` as applicable; it shall not show `0`, `0%`, a current timestamp, `NaN`, or an empty meter as a substitute.

**FR-16** — An unreachable host shall retain the dashboard's existing named offline/error treatment and shall not display local device-health values, fabricated remote values, or a last-known remote snapshot as current.

**FR-17** — A reachable peer whose llmdash version does not report device health shall remain reachable and shall show `Device health unavailable · not reported by this host`; absence of the optional health data shall not become a host error.

**FR-18** — Before display, all device-health numbers shall be coerced to finite values, percentages shall be constrained to 0 through 100, byte counts shall be non-negative and internally consistent, timestamps shall be valid canonical ISO instants, diagnostic codes shall come from a bounded known set, and invalid fields shall degrade only the affected metric.

### Presentation

**FR-19** — The three metrics shall appear together in one compact snapshot with a stable CPU → RAM → Disk reading order on phone and desktop.

**FR-20** — Every available CPU and RAM reading shall show its numeric percentage, and every available disk reading shall show its available amount and available percentage; visual meters or color may supplement but shall not replace those values.

**FR-21** — Fresh, aging, stale, measuring, unsupported, unavailable, and update-failed states shall be distinguishable through visible text or symbols with accessible names and shall not rely on color alone.

**FR-22** — The surface shall not animate metric values, interpolate between samples, show sparklines, or issue an overall `healthy`, `safe`, `overloaded`, or equivalent verdict. The numbers and evidence state shall remain the decision surface.

### Host Contract and Documentation

**FR-23** — The local state read shall expose the normalized device-health snapshot with the local host's state, and the combined hosts read shall carry each reporting host's snapshot only inside that host's state so the existing host dimension remains authoritative.

**FR-24** — Device-health data shall be additive and optional in existing state and host responses. Existing consumers and peers that ignore, omit, or do not recognize the new field shall retain their current limit, activity, freshness, and offline behavior.

**FR-25** — Device-health samples shall remain current in-memory operational facts and shall not be written to usage-history SQLite tables or used to backfill trends.

**FR-26** — User documentation shall state the meaning of all three metrics, the disk target, the default one-minute cadence and existing cadence override, the CPU sampling interval, the RAM classes counted as used, the current lack of history/alerts/realtime monitoring, and any unsupported platform behavior.

## Non-Functional Requirements

**NFR-01 — Performance:** Collection shall be poller-owned, cache-served, single-flight with the existing poll cycle, and bounded in elapsed time and output size. A slow or failed measurement shall not accumulate concurrent collectors or block an HTTP response.

**NFR-02 — Accessibility:** The snapshot shall have a semantic heading, logical DOM reading order, accessible names for metric values and states, text equivalents for all status cues, and no hover-only information.

**NFR-03 — Responsive layout:** The three metrics, host scope, freshness, and degraded-state copy shall remain readable at the dashboard's supported phone and desktop widths without horizontal page scrolling or clipped values.

**NFR-04 — Compatibility:** The feature shall preserve the zero-runtime-dependency, no-build-step Node 24+ stack and shall work on the primary macOS LaunchAgent deployment. On another documented platform, an unsupported metric shall degrade per FR-15 rather than preventing llmdash from starting or hiding supported metrics.

**NFR-05 — Security:** Any operating-system probe shall use a fixed executable and arguments, no shell interpolation, an allowlisted environment, bounded execution and output, and no user-controlled command or path. No process list, command, raw probe output, filesystem path, username, or other new machine identifier shall enter the HTTP payload.

**NFR-06 — Reliability:** One metric's failure shall not invalidate the host, the other device-health metrics, account limits, tool activity, or peer polling. A partial snapshot shall publish atomically with explicit per-metric states.

**NFR-07 — Honesty:** The snapshot shall remain visibly machine-local and minute-sampled; collection, host fetches, browser rerenders, and unrelated fresh data shall never refresh a measurement's evidence time.

## Out of Scope

- Realtime sampling, continuously moving gauges, or sub-minute browser updates to metric values.
- Historical CPU, RAM, or disk storage, charts, trends, summaries, or backfill.
- Alerts, notifications, threshold configuration, automatic remediation, or process termination.
- Per-process CPU or memory attribution and process lists.
- Temperature, fan speed, battery, GPU, network, load average, swap history, or additional system-monitor metrics.
- A combined health score or a product claim that a particular reading is universally healthy, safe, or overloaded.
- Changes to account-limit, headroom, tool-activity, cost-analysis, or menu-bar glyph semantics.
- Adding device-health metrics to the SwiftBar/xbar menu-bar badge in this feature.
- Persisting peer or local device-health samples in SQLite.
- Discovering machines or collecting health from any host outside the existing explicit llmdash host set.
- A new device-health refresh preference separate from the existing poll interval.

## Open Questions

**OQ-01 — CPU observation interval:** Which bounded platform source will provide the cumulative idle and total counters used by FR-05? Default assumption: The Architect shall use counter deltas between consecutive poller-owned observations, publish CPU as `Measuring` until two valid observations exist, and record the actual interval represented by each resulting sample.

**OQ-02 — macOS RAM classes:** Which macOS memory categories produce the closest stable equivalent to current non-reclaimable used memory under FR-06? Default assumption: count application/active, wired, and compressed memory as used; exclude free and readily reclaimable cached/inactive memory; if the available platform evidence cannot support that distinction, publish RAM as unsupported rather than silently substituting free-only arithmetic.

**OQ-03 — Secondary-platform support:** Which non-macOS platforms can meet the same semantics using bounded sources already available to Node 24? Default assumption: macOS is required for this release; Linux or other platforms expose each unsupported metric honestly and do not block the service. No new runtime dependency is permitted to broaden support.

## Success Metrics

| ID | What's Being Verified | Pass Condition |
|---|---|---|
| QA-01 | Single- and multi-host placement (FR-01–FR-04) | Single-host mode renders one CPU → RAM → Disk snapshot after account limits and before Tool details; multi-host mode renders no aggregate health value and places each reporting host's labeled snapshot before that host's tool detail. |
| QA-02 | CPU semantics (FR-05) | A deterministic fixture with known total and idle counter deltas produces the expected aggregate non-idle percentage in the inclusive 0–100 range; one cumulative observation and load-average-only input do not produce a CPU percentage. |
| QA-03 | RAM semantics (FR-06) | A deterministic platform fixture produces the expected 0–100 used percentage from the documented counted memory classes, and reclaimable/available classes are not counted as irreducibly used. |
| QA-04 | Disk meaning and presentation (FR-07–FR-08) | A fixture with 250 GiB available on a 1 TiB data-directory filesystem shows a human-readable 250 GiB and 25% available, labels the data volume, and exposes no configured path. |
| QA-05 | Independent metric states (FR-09) | A snapshot with valid CPU and disk plus failed RAM renders both valid values and only the RAM failure; the host and snapshot remain available. |
| QA-06 | One cadence and cache-only reads (FR-10–FR-11) | Under fake timers, one health collection occurs per existing poll tick with no separate interval; repeated page renders and state/hosts requests cause zero additional measurements. |
| QA-07 | Capture time and age bands (FR-12–FR-13) | A metric keeps its canonical sample time; it is current at exactly two poll intervals old, aging immediately after two through exactly five intervals, and stale immediately after five, while one-second rerenders change age copy only. |
| QA-08 | Failed update with last-good evidence (FR-14) | After a success followed by collection failure, the prior value and capture time remain, `update failed` is visible, and the value becomes aging/stale from its original time rather than the failed attempt time. |
| QA-09 | First-run and unavailable states (FR-15) | Fixtures for insufficient CPU samples, unsupported RAM semantics, and unavailable disk render `Measuring`, `Unsupported`, and `Unavailable` respectively, with no zero, current timestamp, `NaN`, or empty meter. |
| QA-10 | Offline and mixed-version hosts (FR-16–FR-17) | An offline host keeps the existing named offline card and no health values; a reachable legacy host keeps its other data and shows `Device health unavailable · not reported by this host`. |
| QA-11 | Numeric and field normalization (FR-18) | Non-finite, negative, over-100, internally impossible, invalid-date, unknown-diagnostic, and hostile-string fixtures remain inert and degrade only the affected metric without producing raw text or fabricated values. |
| QA-12 | Compact accessible presentation (FR-19–FR-22) | Phone and desktop visual checks show one stable three-metric surface with numeric values and textual/accessibly named states, no horizontal overflow, no color-only meaning, no value animation, no sparkline, and no overall health verdict. |
| QA-13 | State and host contracts (FR-23–FR-24) | Local state carries local health and combined hosts carry health only under the corresponding host state; legacy payloads and consumers with no health field preserve existing limits, activity, freshness, and reachability behavior. |
| QA-14 | No persistence (FR-25) | Several successful poll cycles change no usage-history row count or schema and produce no device-health trend data. |
| QA-15 | Documentation contract (FR-26) | Documentation names all metric semantics, disk target, default and configured cadence behavior, CPU interval, RAM classes, unsupported-platform behavior, and explicit exclusions for realtime, history, and alerts. |
| QA-16 | Bounded performance and atomic reliability (NFR-01, NFR-06) | A timed-out or oversized probe is terminated within its documented bound, never overlaps the next collector, and publishes either the prior complete snapshot with failure evidence or one atomic partial snapshot without affecting unrelated dashboard data. |
| QA-17 | Accessibility and responsive behavior (NFR-02–NFR-03) | Semantic/keyboard checks and phone/desktop visual verification confirm heading and DOM order, accessible metric/state names, non-hover access, readable wrapping, and no horizontal page overflow. |
| QA-18 | Platform and dependency compatibility (NFR-04) | The feature uses no new runtime dependency or build step, works under the supported Node 24+ macOS LaunchAgent environment, and an unsupported-platform metric degrades without preventing startup or hiding supported values. |
| QA-19 | Probe and payload security (NFR-05) | Adversarial configuration cannot alter executable, arguments, environment, or target path; timeout/output caps hold; and HTTP payload inspection finds no process, command, raw output, local path, username, or new machine identifier. |
| QA-20 | Scope and freshness honesty (NFR-07) | Account or activity refreshes and peer fetch times do not change metric capture times, and every rendered snapshot states its machine scope and minute-sampled age. |
