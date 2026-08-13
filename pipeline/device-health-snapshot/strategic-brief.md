# Strategic Brief — Device Health Snapshot

## What We're Building
Add a compact device-health snapshot near the top of llmdash that shows the
current machine's CPU usage, RAM usage, and available disk space. It refreshes
once per minute and is designed as a quiet at-a-glance answer to “is this
computer overtaxed?” rather than as a realtime system monitor.

In the existing limits-first hierarchy, this is a clearly labeled
machine-local companion to the account-limit story: visible early enough to
scan immediately, but not promoted above the AI-usage headroom that defines the
product.

## Why Now
llmdash already brings together the account-wide limits and machine-local
activity that shape an AI coding session. The remaining blind spot is the
machine itself. A slowdown can feel like provider throttling, tool latency, or
an overloaded computer; today the user must leave llmdash and open another
utility to distinguish those cases. A three-metric snapshot closes that gap
without turning the product into a general observability suite.

The feature also fits the shipped architecture unusually well. llmdash already
has a one-minute poller, a host-first data model, a cache-served request path,
and explicit scope labels separating account facts from per-machine facts. The
new snapshot can follow all four rather than introduce a new timer or realtime
stream.

## The User Problem
When coding sessions feel sluggish or unusually demanding, the user cannot see
from the dashboard whether their current device is simply under resource
pressure. Checking Activity Monitor or running several shell commands breaks
the glanceable workflow and makes a basic diagnosis feel larger than it is.

The user does not need a performance trace. They need three honest, recent
signals in one place:

- how busy the CPU is;
- how much memory is in use; and
- how much usable space remains on the disk that matters to llmdash.

A minute-level sample is deliberately sufficient. It reveals sustained or
recent pressure at a glance while avoiding the noise, visual urgency, and
collection cost of realtime monitoring.

## Success Criteria
- A compact device-health surface appears near the top of the dashboard on both
  phone and desktop, after the primary account-limit area and before deeper tool
  details.
- It shows CPU usage and RAM usage as clear percentages, plus available disk
  space as a human-readable quantity with enough capacity context to judge it
  (recommended: available amount and percent of the measured filesystem).
- Every reading is explicitly scoped to its device. In single-host mode that is
  “This machine”; in multi-host mode each reachable configured host carries its
  own snapshot rather than implying one machine's health describes another.
- Samples refresh on the existing 60-second poll cadence. Rendering or HTTP
  requests never trigger a fresh operating-system probe, and the UI does not
  animate or imply sub-minute precision.
- CPU usage has an explicit interval meaning and is never fabricated from a
  single cumulative counter. The Architect should choose a lightweight,
  platform-appropriate sampled calculation that produces a defensible
  one-minute snapshot.
- RAM usage uses an explicitly documented operating-system definition. The
  implementation must not present cache/reclaimable memory as irreducibly
  consumed without deciding and documenting that semantic.
- Available disk space names a stable filesystem target. Recommended default:
  the filesystem containing llmdash's data directory, since lack of space there
  directly threatens the dashboard's no-backfill history; this remains an
  Architect decision if platform APIs make another target more honest.
- Missing, unsupported, stale, or failed measurements render as named
  unavailable states, never zero. A failed collection does not overwrite a
  known last-good sample without retaining its capture time and degraded state.
- The implementation adds no runtime dependency, no build step, no unbounded
  subprocess work, and no raw process, path, command, or host details to the
  browser payload.

## Scope
- A bounded local collector for CPU, RAM, and filesystem capacity using Node
  builtins and/or a fixed, allowlisted operating-system probe where a builtin
  cannot provide an honest value.
- Collection on the existing poller cadence (default 60 seconds), cached in
  memory and served read-only with the rest of each host's cached state.
- A normalized device-health payload containing finite values or nulls, a
  capture time, platform/support state, and bounded diagnostic reason codes.
- Extension of the existing host-aware contract so each host can report its own
  health snapshot. The exact schema and whether the single-host compatibility
  endpoint gains the field are Architect decisions; the principle is one shared
  host path, not a parallel health-only endpoint or renderer.
- A responsive, accessible dashboard component placed near the top but
  subordinate to account limits. Exact card, meter, number, color, and copy
  treatments are Designer decisions.
- Tests for metric semantics, finite/bounded normalization, stale and failure
  behavior, first-run/unavailable states, once-per-minute collection, host
  association, responsive presentation, and no-probe-on-request behavior.
- Brief documentation of what each metric means, what disk is measured, the
  one-minute cadence, and any platform limitation.

## Out of Scope
- Realtime charts, sparklines, historical resource storage, process lists, or
  per-process CPU/RAM attribution.
- Alerts, notifications, automatic remediation, process termination, or claims
  that a displayed level is intrinsically “safe” or “overloaded.”
- Temperature, fan speed, battery, GPU, network, load average, swap history, or
  other general system-monitor metrics.
- Changing the existing account limits, tool activity, menu-bar glyph, or cost
  analysis semantics.
- Persisting device-health samples in SQLite. These are current operational
  facts, not irreplaceable history, and the user asked for a glance rather than
  trends.
- A new user-configurable refresh knob. The existing poll interval already
  defaults to the requested minute; this feature should not add a second cadence
  that can drift from it.
- Public monitoring, team/multi-user observability, remote discovery, or health
  probes to machines not already in the explicit llmdash host set.

## Key Decisions
- **This is a snapshot, not monitoring.** One sample per existing poll minute,
  no realtime stream, no history, and no alerting. The restraint is part of the
  feature: it answers whether sustained pressure is plausible without inviting
  second-by-second attention.
- **Keep the product limits-first.** “Near the top” means immediately after the
  canonical account-limit story and before deeper tool detail. Device health is
  useful context, but it must not displace the AI-quota headroom that llmdash is
  built to surface.
- **Device health is host-scoped.** Account limits can collapse across machines;
  CPU, RAM, and disk cannot. The snapshot belongs to a specific host and must
  flow through the existing host dimension. In multi-host mode, health should be
  attached to each reachable host's story, with offline hosts remaining named
  and unavailable rather than inheriting local values.
- **Collect off the request path and serve from cache.** The poller owns
  collection; HTTP handlers only serialize the last normalized result. This
  preserves the codebase's no-network/no-subprocess-on-request rule and gives the
  minute cadence one authoritative clock.
- **Metric semantics must be explicit before implementation.** CPU “usage,” RAM
  “usage,” and disk “available” each have multiple plausible definitions. The
  Architect must record the chosen sampling interval, memory treatment, and
  filesystem target; the UI and documentation use those definitions without
  upgrading them into a universal overload verdict.
- **Recommended disk target is the filesystem containing the data directory.**
  Disk exhaustion there can stop future SQLite snapshots and damage the
  product's irreplaceable no-backfill history, making it more relevant than an
  arbitrary root or working-directory volume. If this differs from what a user
  expects as “hard-drive space,” the UI should name the measured volume or
  location in plain language.
- **Honest degradation beats a sticky green number.** Unsupported APIs, probe
  failure, malformed values, and an aging sample remain distinguishable. Values
  are finite, clamped where percentages require it, timestamped, and never
  replaced by fabricated zero or “now.”
- **No founding-brief rewrite is required.** The feature serves the same single
  user, same local/tailnet deployment, and same glanceable decision-making
  promise. It is a narrow extension from AI-usage headroom to the local machine
  condition that can affect that work, not a pivot into infrastructure
  monitoring.

## Flags for Later Stages
- **Architect:** choose and document cross-platform/Node-24-compatible CPU and
  memory semantics; confirm the data-directory filesystem target; prove probes
  are bounded, cache-owned, and safe under launchd's minimal environment; and
  preserve `/api/state` and `/api/hosts` compatibility.
- **Designer:** keep the surface visually quiet and limits-subordinate; make all
  three values comparable at a glance without relying on color alone; show the
  host scope and minute-level freshness without realtime theater.
- **Auditor:** scrutinize any subprocess fallback (absolute executable, fixed
  arguments, allowlisted environment, bounded runtime/output, no shell), path
  disclosure in the payload, peer normalization, and hostile/non-finite metric
  values.
