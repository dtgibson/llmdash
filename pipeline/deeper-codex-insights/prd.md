# PRD — Deeper Codex Insights
**Feature:** deeper-codex-insights
**Date:** 2026-07-12
**Stage:** 2 — The Planner
**Source:** strategic-brief.md (approved)

## Feature Overview
Add a secondary Codex insights section that explains the local work patterns
behind token use and context pressure. The section uses only structured Codex
metadata and live account metadata, keeps account limits visually primary, and
states clearly when a metric is unavailable.

## User Stories
> **US-01** — As a Codex user, I want to see what kinds of work consumed my
> tokens, so that a sudden increase is understandable rather than mysterious.

> **US-02** — As a Codex user, I want to compare reasoning, turn size, sessions,
> models, effort, and tools over a chosen period, so that I can recognize my own
> usage patterns.

> **US-03** — As a Codex user, I want to know when sessions approached their
> context limit or compacted, so that I can tell when a task became too large for
> one session.

> **US-04** — As a user with several monitored machines, I want local work
> patterns kept separate from account-wide facts, so that I do not mistake
> several machines for several budgets.

> **US-05** — As a privacy-conscious user, I want insights calculated without
> exposing my prompts, responses, commands, or files, so that the dashboard stays
> safe to view over my tailnet.

> **US-06** — As a user on a changing Codex version, I want unsupported metrics
> to say they are unavailable, so that the dashboard never presents a guess as a
> fact.

## Functional Requirements

### Placement and Range
> **FR-01** — The app shall present deeper Codex insights as a secondary section
> below the existing Codex account limits and their immediate pacing context.

> **FR-02** — The insights section shall support 24-hour, 7-day, and 30-day
> ranges and shall identify the active range beside the values it controls.

> **FR-03** — Changing the active range shall update every range-dependent
> insight as one coherent view; account facts that are not range-dependent shall
> remain unchanged.

### Availability and Meaning
> **FR-04** — Each insight shall be derived only from structured Codex event or
> account fields and shall declare itself unavailable when its required fields
> are absent, malformed, or semantically ambiguous.

> **FR-05** — The app shall distinguish an unavailable metric from a true
> observed zero in both the API representation and the rendered copy.

> **FR-06** — The section shall state that activity insights describe the local
> machine while plan and credit facts describe the Codex account.

### Token, Turn, and Session Insights
> **FR-07** — When supported, the app shall show reasoning tokens as a share of
> recorded output tokens and shall show the corresponding token counts.

> **FR-08** — When supported, the app shall show recorded turn count and average
> total tokens per recorded turn for the selected range.

> **FR-09** — The app shall show session count and average total tokens per
> session for the selected range without exposing session identifiers.

> **FR-10** — For ranges spanning more than one calendar day, the app shall show
> the busiest day by total recorded tokens, including the date and token total;
> tied days shall resolve consistently.

### Model, Effort, and Tool Insights
> **FR-11** — When model metadata is present, the app shall show a model mix for
> the selected range using token share and recorded-turn count.

> **FR-12** — When effort metadata is present, the app shall show the recorded
> effort-setting mix by turn; absent effort metadata shall not be inferred from
> model names or reasoning-token volume.

> **FR-13** — When tool metadata is present, the app shall show a bounded
> tool-use breakdown by invocation count while excluding arguments, outputs,
> paths, commands, and other tool payload content.

### Context Health and Timing
> **FR-14** — When both current-context use and an explicit context-window size
> are present, the app shall show peak context pressure and the number of
> recorded turns at or above 80 percent for the selected range.

> **FR-15** — When explicit compaction events are present, the app shall show the
> compaction count and number of sessions affected for the selected range.

> **FR-16** — Response latency shall be shown only from explicit completed-task
> duration fields; when supported, the app shall show median and 95th-percentile
> total duration and time-to-first-token for the selected range. Aborted turns
> and heuristic timestamp pairing shall be excluded.

### Account Facts
> **FR-17** — The app shall show the plan attached to the live Codex quota
> response and shall never replace an unavailable plan with a hardcoded tier.

> **FR-18** — When the live Codex response explicitly provides credit metadata,
> the app shall show an account-wide status of `Unlimited`, `Credits available`,
> or `No credits`, plus a reset-credit count when present. A bounded balance may
> be shown only as the response supplies it; the app shall not invent a currency,
> unit, or pay-as-you-go meaning.

### Trends, Multi-host, and Degraded States
> **FR-19** — The section shall provide a compact daily trend for reasoning share
> and average tokens per recorded turn wherever at least two supported daily
> points exist in the selected range.

> **FR-20** — In multi-host views, the deeper-insights section shall identify its
> scope as `This machine` and shall not sum, imply coverage of, or initiate new
> fan-out requests for remote-machine activity. Same-account plan or credit facts
> shall remain account-wide rather than appearing as independent balances.

> **FR-21** — When no supported Codex insight data exists for the selected range,
> the section shall show one concise explanation and shall not render empty
> charts, fabricated zeros, or partial labels that imply data exists.

> **FR-22** — Malformed or unknown structured records shall be skipped without
> preventing valid records, existing Codex activity, account gauges, or the rest
> of the dashboard from rendering.

> **FR-23** — Data returned to a client shall contain normalized aggregates and
> bounded display labels only; it shall not contain raw session records, prompts,
> responses, command text, tool payloads, file paths, account email, or session
> identifiers.

## Non-Functional Requirements
> **NFR-01 — Privacy:** Parsing and aggregation shall remain local. The feature
> shall introduce no telemetry upload, cloud processing, or new outbound request.

> **NFR-02 — Performance:** Session-log scanning and aggregation shall remain off
> the HTTP request path; requests shall read a bounded cache refreshed through the
> existing background/activity path.

> **NFR-03 — Compatibility:** Older and newer Codex log shapes shall degrade per
> metric. One unknown field or event type shall not disable the full section.

> **NFR-04 — Security:** Every external string, number, timestamp, enum, and
> nested aggregate shall be normalized at ingest, bounded before output, and
> escaped at render; enum-to-copy lookups shall use own-key checks.

> **NFR-05 — Architecture:** The feature shall add no runtime dependency, build
> step, remote service, or second persistence store.

> **NFR-06 — Contract Safety:** Existing account-limit, activity, trend,
> multi-host, and menu-bar consumers shall retain their shipped fields and
> meanings; any insight data shall be additive and the menu-bar output shall not
> change.

> **NFR-07 — Accessibility:** Insight values, availability states, range controls,
> and charts shall have text equivalents, keyboard-operable controls, visible
> focus, and meaning that does not depend on color alone.

> **NFR-08 — Responsive Design:** The section shall preserve the dashboard's
> 860-pixel reading width and reflow without horizontal scrolling at 320 CSS
> pixels in both light and dark themes.

> **NFR-09 — Persistence:** Insight history shall be re-derived from Codex logs;
> `usage_snapshots` shall remain reserved for limit snapshots and shall receive
> no new insight rows.

## Out of Scope
- Prompt text, model responses, command output, tool arguments or results, file
  paths, session identifiers, and other session content.
- General ChatGPT message caps, API-key usage, billing, invoices, or
  pay-as-you-go spend.
- Guessed context pressure, inferred effort, heuristic latency matching, or any
  metric Codex does not record explicitly.
- Productivity scores, recommendations, rankings, or judgments about the user's
  work.
- Claude parity.
- Deeper analytics in the menu-bar glyph or dropdown.
- Cloud aggregation, public sharing, new authentication, or a new history store.

## Open Questions
- **Which older Codex versions lack completed-task timing or context-window
  fields?** Default: capability-detect each metric independently and render it
  unavailable; never reconstruct it from nearby timestamps or model names.
- **How should unknown tool names be displayed?** Default: normalize a bounded
  allowlisted category when one exists and group everything else under `Other`,
  without returning the raw tool name or payload text.

## Success Metrics
| ID | What's Being Verified | Pass Condition |
|---|---|---|
| QA-01 | Insight placement | Codex insights render below account limits and do not alter the limits-first order. |
| QA-02 | Supported ranges | 24h, 7d, and 30d controls are present and the active range is textually identified. |
| QA-03 | Atomic range update | A range change updates every range-dependent value while plan/credit facts remain stable. |
| QA-04 | Capability detection | Removing each required source field makes only its dependent metric unavailable. |
| QA-05 | Zero versus unavailable | Fixtures with a real zero render `0`; absent or malformed fields render unavailable, never `0`. |
| QA-06 | Scope disclosure | The section labels activity per machine and account facts account-wide. |
| QA-07 | Reasoning share | A fixture with known reasoning/output tokens produces the exact share and both counts; a zero denominator is unavailable. |
| QA-08 | Turn insight | A fixture with known per-turn deltas produces the exact turn count and average tokens per turn. |
| QA-09 | Session insight | Known sessions produce the exact count and tokens/session without an identifier in the response. |
| QA-10 | Busiest day | Known and tied daily totals produce the expected date and token total deterministically. |
| QA-11 | Model mix | Known model-tagged turns produce exact token shares and turn counts; missing tags do not invent a model. |
| QA-12 | Effort mix | Known effort tags produce exact counts and missing tags render unavailable without inference. |
| QA-13 | Tool breakdown | Known tool events produce bounded name/count rows and hostile arguments, paths, and outputs never cross the response. |
| QA-14 | Context pressure | Explicit use/window fixtures produce the exact peak and ≥80% count; either field missing makes the metric unavailable. |
| QA-15 | Compactions | Explicit compaction fixtures produce exact event and affected-session counts. |
| QA-16 | Latency | Explicit completed-task duration and time-to-first-token fields produce exact median and p95 values; aborted or malformed turns are excluded. |
| QA-17 | Live plan | Quota `planType: pro` renders `ChatGPT Pro`; missing or unknown values never default to Plus. |
| QA-18 | Credits | Explicit `hasCredits`, `unlimited`, balance, and reset-credit-count fixtures render only their documented account-wide status; no currency, unit, or billing meaning is invented. |
| QA-19 | Daily trends | Two or more supported days render exact reasoning-share and tokens/turn points; fewer points omit the trend. |
| QA-20 | Multi-host scope | A multi-host dashboard labels deeper insights `This machine`, does not merge or imply remote activity, makes no new peer fan-out request, and does not present account facts as separate balances. |
| QA-21 | No-data state | An empty supported range shows one explanation, no charts, and no fabricated numeric values. |
| QA-22 | Malformed records | Hostile/unknown records are skipped while valid records and the rest of the dashboard still render. |
| QA-23 | Aggregate-only contract | Response inspection finds no raw content, paths, email, account/session IDs, or unbounded labels. |
| QA-24 | Local-only behavior | A network/process spy observes no new outbound call or subprocess for insight collection. |
| QA-25 | Request-path performance | HTTP handlers consume cached aggregates and perform no session-tree scan. |
| QA-26 | Version compatibility | Mixed old/new fixtures retain every supported metric and isolate unsupported ones. |
| QA-27 | Input and render hardening | Non-finite numbers, hostile labels, inherited-key enums, and malformed timestamps remain inert and bounded. |
| QA-28 | Zero-dependency architecture | `package.json` still has no runtime dependencies and no build step or new store exists. |
| QA-29 | Existing-contract safety | Existing API, multi-host, trend, and native menu suites pass; installed menu output is unchanged. |
| QA-30 | Accessibility | Keyboard, focus, text-equivalent, and color-independence checks pass for controls and insights. |
| QA-31 | Responsive themes | At 320px and 860px, both themes render without horizontal scrolling or clipped insight content. |
| QA-32 | Snapshot semantics | No insight record is written to `usage_snapshots`; existing limit snapshot behavior is unchanged. |
