# PRD — Dashboard Density and Health Trends
**Feature:** dashboard-density-health-trends
**Date:** 2026-08-12
**Stage:** 2 — The Planner
**Source:** strategic-brief.md (approved)

## Feature Overview
Recompose llmdash around a compact first-read summary of quota headroom,
allowances, pacing, and per-machine health, then add a bounded one-hour chart of
the existing once-per-minute machine-health measurements.

## User Stories

> **US-01** — As the llmdash owner, I want the most urgent quota and machine
> signals together near the top, so that I can decide whether to start demanding
> work without scrolling through supporting detail.

> **US-02** — As the llmdash owner, I want reset credits and other current
> allowances promoted beside remaining quota, so that usable headroom is not
> hidden in a lower account section.

> **US-03** — As the llmdash owner, I want pacing beside current quota, so that I
> can distinguish healthy headroom from allowance that is being consumed too
> quickly.

> **US-04** — As the llmdash owner, I want an hour of CPU, RAM, and disk history
> for each machine, so that I can distinguish a brief spike from sustained
> pressure.

> **US-05** — As someone viewing several machines, I want every health chart to
> stay attached to its host, so that one machine's pressure is never attributed
> to another.

## Functional Requirements

### Information hierarchy

> **FR-01** — The app shall put a compact first-read region before lower-priority
> detail on both single-host and multi-host views.

> **FR-02** — The first-read region shall include remaining percentages for every
> current primary quota window, current provider-reported reset credits or other
> global allowances when supported, pacing, and device health.

> **FR-03** — The first-read region shall preserve the existing evidence labels,
> source scope, freshness, reset timing, unsupported, partial, stale, and error
> states rather than implying all values share one source or confidence level.

> **FR-04** — An allowance or reset entitlement shall have one canonical account
> location; promoting it shall not create a duplicate representation farther
> down the page.

> **FR-05** — Activity, cost, detailed account evidence, diagnostics, and longer-
> range analysis shall remain reachable below the first-read region.

> **FR-06** — The first-read region shall remain readable without horizontal page
> scrolling at the existing supported mobile and desktop widths.

### Health history

> **FR-07** — The app shall retain at most 60 chronological machine-health
> observations per host, covering approximately the latest hour at the existing
> once-per-minute cadence.

> **FR-08** — Each observation shall identify its capture time and independently
> carry a finite CPU-used percentage, RAM-used percentage, and disk-available
> percentage or a missing value for each metric.

> **FR-09** — Only successfully captured metric values shall appear as chart
> points; measuring, failed, unsupported, missing, and invalid values shall form
> gaps and shall not be plotted as zero or joined through.

> **FR-10** — Failed refreshes shall not fabricate new readings or change the
> original capture time of last-good values.

> **FR-11** — Health history shall remain scoped to the host that produced it and
> shall never be combined across hosts.

> **FR-12** — Health history shall be optional in local and peer state. A host
> without it shall remain reachable and shall continue to show its current health
> snapshot when available.

> **FR-13** — Peer history shall accept only bounded arrays with canonical
> timestamps and finite percentages clamped from 0 through 100; malformed samples
> or metrics shall be discarded without invalidating the peer's otherwise valid
> state.

> **FR-14** — The history chart shall show CPU used, RAM used, and disk available
> as visually distinct series with accessible names and the semantic difference
> between used and available made explicit.

> **FR-15** — The chart shall communicate the covered time range, gaps, and an
> empty or not-reported state without presenting false continuity.

> **FR-16** — The chart shall render for the local host and each reachable peer
> from the same normalized host-state contract.

> **FR-17** — The chart shall update from refreshed cached state without adding a
> separate browser polling loop or triggering device probes from an HTTP request.

### Compatibility and preservation

> **FR-18** — Existing quota, pacing, activity, cost, host, and account semantics
> shall remain unchanged except for their placement and compact presentation.

> **FR-19** — Existing older peers that omit health history shall degrade to a
> clear unavailable-history state rather than causing host or page failure.

> **FR-20** — Reduced-motion preferences shall disable non-essential chart or
> layout animation without hiding data.

## Non-Functional Requirements

> **NFR-01 — Bounds:** Local and normalized peer history shall never exceed 60
> observations per host, and invalid peer input shall not permit unbounded memory
> growth or DOM output.

> **NFR-02 — Performance:** Rendering the first-read region and three 60-point
> series per configured host shall remain responsive at the project's existing
> bounded host-count limits and shall not add a new request cadence.

> **NFR-03 — Accessibility:** The first-read region and chart shall be keyboard-
> independent, carry meaningful text/ARIA equivalents, not rely on color alone,
> and preserve readable contrast and focus behavior.

> **NFR-04 — Security:** External peer numbers and timestamps shall be normalized
> before rendering; no peer-provided string shall reach HTML unescaped, and the
> feature shall add no mutation, shell, or public-network surface.

> **NFR-05 — Privacy:** Health history shall stay in process memory and the
> read-only host state. It shall not enter usage-history SQLite, logs, telemetry,
> or third-party services.

> **NFR-06 — Compatibility:** The feature shall work with the existing Node 24+
> runtime and plain HTML/CSS/JavaScript stack without a framework, bundler, chart
> dependency, or runtime dependency.

> **NFR-07 — Testability:** Sampling, eviction, degraded evidence, peer
> normalization, DOM ordering, responsive behavior, and chart semantics shall be
> covered by deterministic `node:test` checks.

## Out of Scope

- Long-term or restart-persistent device-health history.
- Backfill, prediction, anomaly detection, alerts, or notification delivery.
- Cross-host aggregation of machine health.
- Per-process telemetry, process lists, temperature, battery, or network data.
- New provider quota sources or changes to quota and cost collection.
- New write APIs, settings, authentication, hosting, or dependencies.
- Replacing the detailed lower-page views with the compact first-read summary.

## Open Questions

None — all decisions are resolved in this document. The chart uses a rolling
60-sample, process-lifetime window; disk remains an available-percentage series;
and history is optional for older peers.

## Success Metrics

| ID | What's Being Verified | Pass Condition |
|---|---|---|
| QA-01 | First-read ordering (FR-01, FR-02, FR-05) | In single- and multi-host fixtures, quota percentages, allowances/resets, pacing, and device health render before activity, cost, diagnostics, and detailed evidence. |
| QA-02 | Evidence honesty (FR-03, FR-04) | Partial, unsupported, stale, source-error, freshness, reset, and scope fixtures retain their labels, and each account allowance appears once. |
| QA-03 | Responsive density (FR-06) | Supported phone and desktop viewport fixtures have no horizontal page overflow and keep the urgent region readable. |
| QA-04 | Bounded sampling (FR-07, FR-08) | After 61 valid minute refreshes, exactly the newest 60 chronological observations remain with independent finite-or-null metrics. |
| QA-05 | Honest gaps (FR-09, FR-10) | Measuring, failed, unsupported, missing, and invalid metric fixtures produce gaps, never zero points or connecting segments, while last-good timestamps remain unchanged. |
| QA-06 | Host isolation (FR-11, FR-16) | Two-host fixtures render two distinct histories, and no sample from either host appears in the other's series. |
| QA-07 | Optional compatibility (FR-12, FR-19) | A reachable older peer without history stays reachable, keeps its current snapshot, and shows a clear unavailable-history state. |
| QA-08 | Peer normalization and bounds (FR-13) | Oversized arrays are capped to 60, times are canonical ISO, percentages clamp to 0–100, malformed entries drop, and valid sibling state survives. |
| QA-09 | Chart semantics (FR-14, FR-15) | The DOM exposes named CPU-used, RAM-used, and disk-available series, a one-hour time label, gap/empty copy, and non-color distinctions. |
| QA-10 | Refresh ownership (FR-17) | Source inspection and tests prove the existing poller owns sampling and browser refresh remains on the existing state cadence with no request-path probe. |
| QA-11 | Existing behavior (FR-18) | The full test suite passes with quota, pacing, activity, cost, host, and account contracts unchanged except for approved additive history and layout. |
| QA-12 | Reduced motion (FR-20) | A reduced-motion media fixture disables non-essential transitions while every series and value remains visible. |
| QA-13 | Performance bounds (NFR-01, NFR-02) | Maximum configured-host fixtures render only bounded 60-point series and introduce no new polling timer or runtime dependency. |
| QA-14 | Accessibility and security (NFR-03, NFR-04) | Automated assertions find meaningful chart text/ARIA, non-color cues, escaped peer content, normalized external values, and no new mutation or execution surface. |
| QA-15 | In-memory privacy (NFR-05, NFR-06) | No database migration/table/write, telemetry payload, third-party request, chart package, or runtime dependency is added for health history. |
