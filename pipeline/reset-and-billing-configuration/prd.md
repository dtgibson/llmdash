# PRD — Reset and Billing Configuration

**Feature:** Reset and Billing Configuration
**Date:** 2026-07-23
**Stage:** 2 — The Planner
**Source:** strategic-brief.md (approved)

## Feature Overview

Reset and Billing Configuration gives the single operator a safe, same-origin dashboard workflow for defining fallback usage-reset timing and recurring monthly billing amounts.
The dashboard must prefer a reset supplied by the live provider and use owner-saved configuration only when that live value is unavailable.
Configured reset timing consists of a weekday, local time, and IANA time zone and is evaluated with daylight-saving-time awareness.
For this deployment, Friday at 11:00 p.m. in `America/Los_Angeles` may be seeded because it was explicitly product-owner-confirmed in this run; it remains editable, and no hidden generic default is activated for other installs.
Reset configuration must not make stale usage data appear fresh; usage freshness remains an independent provider-derived state.
Billing configuration stores operator-confirmed recurring USD monthly amounts as effective-dated history rather than overwriting prior values.
Existing schema-v1 fixed billing periods remain intact and retain their original meaning.
The feature exposes read/download links for the active `account-config.json`,
legacy `subscriptions.json`, and the rate-card resource while tightly limiting
all configuration file and HTTP access.
The application has no login or role model; tailnet reachability is the access boundary.

## User Stories

- **US-01** — As the operator, I want the live provider reset shown when available so that I see the authoritative next reset.
- **US-02** — As the operator, I want a configured reset clearly labeled so that I do not mistake it for provider data.
- **US-03** — As the operator, I want to edit a reset weekday, time, and IANA time zone so that fallback timing follows my operating schedule.
- **US-04** — As the operator, I want daylight-saving transitions handled correctly so that the configured local reset remains predictable.
- **US-05** — As the operator, I want stale usage to remain marked stale regardless of reset configuration so that freshness is truthful.
- **US-06** — As the operator, I want to confirm a recurring USD monthly amount and its effective dates so that billing changes are explicit.
- **US-07** — As the operator, I want month-end clamping for billing anchors on days 29 through 31 so that every month has a valid boundary.
- **US-08** — As the operator, I want historical amounts and schema-v1 fixed periods preserved so that past billing remains reproducible.
- **US-09** — As the operator, I want links to read or download the active account configuration, legacy subscription configuration, and rate card so that I can inspect every billing input.
- **US-10** — As the operator, I want a responsive form with actionable validation so that I can configure the feature on any supported screen size.
- **US-11** — As the operator, I want access limited to known endpoints and protected files so that the feature cannot become a general file-write channel.

## Functional Requirements

### Reset

- **FR-01** — When a successful live provider response includes a next-reset value, the system must display and use that value regardless of configured fallback values.
- **FR-02** — When the live provider has no usable next-reset value, the system must calculate the fallback from the saved weekday, local time, and IANA time zone and label the result `Configured`.
- **FR-03** — Fallback calculation must use time-zone rules for the target date, preserve wall-clock intent across DST changes, choose the earlier occurrence for an ambiguous local time, and advance to the first valid instant for a nonexistent local time.
- **FR-04** — This deployment may seed Friday at 11:00 p.m. in `America/Los_Angeles` from the explicit product-owner confirmation in this run; the operator may edit it, and other installs must have no active fallback until their configuration is explicitly saved.
- **FR-05** — Saving or displaying reset configuration must not update usage timestamps, freshness flags, or stale indicators; stale usage must remain stale until refreshed by its authoritative source.

### Billing

- **FR-06** — The operator may create a recurring monthly billing amount only by entering a USD value with at most two fractional digits and completing an explicit confirmation action.
- **FR-07** — Each recurring amount must have an inclusive effective-start date and optional exclusive effective-end date; a change must atomically close the prior record at the new start and append a new immutable record without overlap.
- **FR-08** — Monthly periods must retain their anchor day; anchors on days 29, 30, or 31 must resolve to the last calendar day when that day does not exist in a month.
- **FR-09** — The system must preserve all prior recurring-amount versions and continue to read schema-v1 fixed periods using their stored amount, start, and end semantics without converting, deleting, or rewriting them.
- **FR-10** — The dashboard must provide read and download links for the active `account-config.json`, legacy `subscriptions.json` configuration, and the rate-card resource, using only fixed application-defined identifiers and safe filenames.

### Management

- **FR-11** — The dashboard must provide a responsive reset-and-billing form that the single tailnet-reachable operator can view and edit; the application must not introduce login, identity, or role-based authorization.
- **FR-12** — Configuration HTTP access must be restricted to the exact allowlist `GET /api/config/reset-billing` and `PUT /api/config/reset-billing`; every other path or method must be rejected.
- **FR-13** — Configuration endpoints must be same-origin only, require CSRF validation for state changes, emit no permissive CORS headers, and reject cross-origin state-changing requests.
- **FR-14** — The PUT endpoint must accept JSON only, enforce a 32 KiB request-body limit before parsing, reject trailing or duplicate data, and return a bounded response.
- **FR-15** — The server must strictly validate the complete schema, reject unknown keys, validate IANA zones and calendar dates, normalize USD to integer cents, prevent effective-period overlap, and return field-level errors without persisting invalid input.
- **FR-16** — Before every read or write, the server must reject symlinks and require the configured target and existing parent components to resolve to the application-owned regular-file location.
- **FR-17** — Valid saves must use same-directory atomic replacement, set file mode `0600`, flush before replacement, and retain the last valid configuration if validation, serialization, or I/O fails.
- **FR-18** — The implementation must not accept arbitrary filesystem paths, follow user-controlled links, write peer files, or expose a generic read/write endpoint; resource reads and downloads must resolve through a fixed application allowlist.

## Non-Functional Requirements

- **NFR-01** — Security: Tailnet reachability is the access boundary; same-origin and CSRF checks, endpoint allowlisting, strict parsing, and protected file handling must be enforced server-side.
- **NFR-02** — Reliability: A failed save must leave the prior valid configuration readable and unchanged, and restart recovery must never prefer a partial temporary file.
- **NFR-03** — Performance: Configuration reads and calculations should complete within 200 ms at p95 under normal local-service load, excluding provider and resource-download latency.
- **NFR-04** — Accessibility: The form must support keyboard operation, programmatic labels, logical focus order, inline error association, and WCAG 2.2 AA contrast.
- **NFR-05** — Responsiveness: The form must remain usable without horizontal page scrolling from 320 CSS pixels through desktop widths.
- **NFR-06** — Auditability: Successful changes must record timestamp, changed field names, and resulting version, but not actor identity, raw request bodies, or sensitive values.
- **NFR-07** — Compatibility: Existing schema-v1 data must remain readable, and new records must use a versioned schema that supports deterministic future migration.
- **NFR-08** — Observability: Rejected writes, provider/fallback selection, validation failures, and atomic-save failures must emit structured events without exposing raw request bodies.
- **NFR-09** — Determinism: Given the same provider result, saved configuration, effective date, and time-zone database version, reset and billing calculations must return the same result.

## Out of Scope

- Editing provider-reported reset values or forcing the provider to refresh usage.
- Treating configured reset timing as evidence that stale usage has become current.
- One-time charges, usage-based pricing, taxes, discounts, currency conversion, invoicing, or payment collection.
- Editing or migrating schema-v1 fixed billing periods.
- Uploading subscription documents or rate cards through this feature.
- Arbitrary URL fetching, arbitrary filesystem browsing, peer-file editing, or cross-origin API access.
- Login, accounts, user roles, actor attribution, or delegated billing approval workflows.

## Open Questions

None. Product defaults and boundary behavior are resolved: this deployment may seed the explicitly confirmed Friday 11:00 p.m. `America/Los_Angeles` value, other installs have no hidden active default, billing uses inclusive-start/exclusive-end dates, and DST edge cases follow FR-03.

## Success Metrics

| ID | What's Being Verified | Pass Condition |
|---|---|---|
| QA-01 | FR-01 — Live provider reset precedence | Conflicting live and configured values always display and select the live value. |
| QA-02 | FR-02 — Configured fallback selection and label | A missing live reset uses saved fields and displays the `Configured` label in every fixture. |
| QA-03 | FR-03 — DST-aware fallback policy | Spring-gap, fall-overlap, and ordinary-date fixtures across IANA zones match the specified policy. |
| QA-04 | FR-04 — Explicit deployment seed and no generic default | This deployment can seed the confirmed value and edit it; a clean unrelated install has no active fallback before save. |
| QA-05 | FR-05 — Usage freshness independence | Viewing or saving reset settings changes no usage timestamp, freshness flag, or stale indicator. |
| QA-06 | FR-06 — Confirmed recurring USD amount | Confirmation and valid cents succeed; cancellation, extra precision, negative, and malformed values persist nothing. |
| QA-07 | FR-07 — Effective-dated changes | Past and future changes atomically close and append records with no overlap or history overwrite. |
| QA-08 | FR-08 — Day 29–31 month-end clamp | Leap/non-leap February and 30/31-day month fixtures yield valid boundaries while retaining the anchor. |
| QA-09 | FR-09 — History and schema-v1 preservation | New saves retain recurring history and leave schema-v1 fixed records byte-for-byte unchanged and readable. |
| QA-10 | FR-10 — Fixed account-config, legacy-subscription, and rate-card links | All three resources read/download correctly; unknown IDs, traversal strings, and unsafe filenames are rejected. |
| QA-11 | FR-11 — Responsive operator form without login roles | Core view/edit tasks pass at 320 px and desktop without account, identity, or role-dependent behavior. |
| QA-12 | FR-12 — Exact endpoint allowlist | Nearby paths, encoded variants, trailing slashes, and unsupported methods are all rejected. |
| QA-13 | FR-13 — Same-origin, CSRF, and no-CORS enforcement | Foreign origins, invalid/missing CSRF proof, and preflights cannot write; no permissive CORS header is emitted. |
| QA-14 | FR-14 — Bounded canonical JSON | Wrong content type, oversized bodies, duplicate keys, and trailing tokens persist nothing; responses stay bounded. |
| QA-15 | FR-15 — Strict schema validation | Unknown fields, invalid zones/dates/cents, and overlaps return field errors and make zero disk changes. |
| QA-16 | FR-16 — Symlink and regular-file protection | Symlinks, directories, devices, and redirected parent components are safely rejected before access. |
| QA-17 | FR-17 — Atomic mode-0600 last-valid behavior | Faults during serialization, flush, and replacement preserve prior content, atomic visibility, and mode `0600`. |
| QA-18 | FR-18 — No arbitrary paths or peer writes | Path injection and resource-ID probes access only fixed allowlisted targets and modify no peer file. |
| QA-19 | NFR-01 — Tailnet and server-side security boundary | Security review confirms no app login and verifies all origin, CSRF, parsing, route, and file controls server-side. |
| QA-20 | NFR-02 — Failure and restart recovery | Failed saves and restarts always return the last valid file and never a partial temporary file. |
| QA-21 | NFR-03 — Read and calculation latency | Representative sampling meets p95 at or below 200 ms, excluding provider and download latency. |
| QA-22 | NFR-04 — Accessibility | Keyboard, label, focus, error-association, and contrast checks meet WCAG 2.2 AA. |
| QA-23 | NFR-05 — Responsive layout | The form is fully usable from 320 CSS pixels through desktop with no horizontal page scrolling. |
| QA-24 | NFR-06 — Identity-free audit record | Each successful change logs timestamp, field names, and version, with no actor or sensitive payload. |
| QA-25 | NFR-07 — Version compatibility | Schema-v1 fixtures remain readable and unchanged while new data uses the versioned schema. |
| QA-26 | NFR-08 — Safe structured observability | Required events are structured and contain no raw body or sensitive configuration value. |
| QA-27 | NFR-09 — Deterministic calculation | Repeated identical fixtures under the same time-zone database version return identical results. |
