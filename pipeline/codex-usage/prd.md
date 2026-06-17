# PRD — Codex Usage
**Feature:** codex-usage
**Date:** 2026-06-16
**Stage:** 2 — The Planner
**Source:** strategic-brief.md (approved)

## Feature Overview
Add Codex (ChatGPT Plus) as a second source in the existing dashboard, at full
parity with Claude Code: its 5-hour and weekly limit windows and its activity
stats, shown alongside Claude Code so you can read cross-tool headroom and switch
when one tool maxes out.

## User Stories
> **US-01** — As the owner, I want Codex's 5-hour and weekly remaining next to Claude Code's, so I have one view of both tools.
> **US-02** — As the owner, I want Codex's reset countdowns and burn projection, so I can pace Codex the way I pace Claude.
> **US-03** — As the owner, when one tool is low or maxed, I want to instantly see which tool still has headroom, so I can switch and keep working.
> **US-04** — As the owner, I want Codex's activity stats (tokens, cache hit rate, estimated value, token mix, cache savings), so I get the same picture I have for Claude.
> **US-05** — As the owner, I want every Codex number clearly attributed to Codex, so I'm never confused about which tool a figure is for.
> **US-06** — As the owner, I want the dashboard to keep working if Codex data isn't there yet, so an empty Codex never breaks the page.

## Functional Requirements

*Codex limits*
> **FR-01** — The app shall obtain Codex's 5-hour window used/remaining % and reset time.
> **FR-02** — The app shall obtain Codex's weekly window used/remaining % and reset time.
> **FR-03** — The app shall source these from Codex's sanctioned interface (the app-server `account/rateLimits/read`), without sending a chat message.
> **FR-04** — When fresh Codex data can't be obtained, the app shall retain and show last known values with their age, or indicate Codex data isn't available yet.

*Display (parity + comparison)*
> **FR-05** — The app shall display Codex's windows with the same gauge treatment as Claude (remaining %, status color, reset countdown).
> **FR-06** — The app shall display a burn-rate projection for Codex's 5-hour window.
> **FR-07** — The app shall present both tools in one view so that, when a window is low or exhausted, the tool with the most headroom is easy to spot at a glance.
> **FR-08** — The app shall clearly label each tool's section (Claude Code vs Codex).

*Codex activity stats*
> **FR-09** — The app shall compute Codex token usage (5h / week / today) from Codex's local session logs.
> **FR-10** — The app shall display Codex cache hit rate, estimated value (week + today), token mix, and cache savings, matching Claude's set, where the data is available.
> **FR-11** — The app shall compute Codex estimated value using OpenAI per-model API rates (a table separate from Claude's).
> **FR-12** — With little or no Codex activity, the app shall show empty/zero stats rather than erroring, and indicate they fill in as Codex is used.

*Storage & integration*
> **FR-13** — The app shall record Codex limit snapshots in the existing `usage_snapshots` table with `source = "codex"` (no schema change).
> **FR-14** — Existing Claude Code behavior shall be unchanged.

## Non-Functional Requirements
> **NFR-01 — Reliability:** querying the Codex app-server shall never crash the app; failures are caught and the rest of the dashboard keeps serving.
> **NFR-02 — Security:** no Codex tokens/credentials in responses, logs, or UI; existing headers and tailnet-only posture still apply.
> **NFR-03 — Footprint:** the app-server subprocess shall be managed responsibly (not spawned per request), respecting Codex's rate guidance.
> **NFR-04 — Consistency:** Codex reuses the existing design-system components — no new UI patterns.
> **NFR-05 — Honesty:** limits account-wide, activity from local logs, each labeled.

## Out of Scope
- General ChatGPT chat caps; Kagi; trend charts; alerts.
- Any change to Claude Code's behavior or data path.

## Open Questions
> **OQ-01** — How to run the app-server: interval poll + cache vs a long-lived subprocess with the `account/rateLimits/updated` push. *Default:* whichever is reliable; Architect/Engineer decide.
> **OQ-02** — Codex log shape (`~/.codex/sessions/**/rollout-*.jsonl` token_count events) may vary by version. *Default:* parse documented fields, degrade gracefully if absent.
> **OQ-03** — OpenAI pricing values. *Default:* current published per-model rates in config, user-editable.
> **OQ-04** — Strength of the "headroom" cue. *Default:* side-by-side with the low/maxed window flagged; an explicit "switch to X" cue is a Stage 4 design call.

## Success Metrics
| ID | What's Being Verified | Pass Condition |
|---|---|---|
| QA-01 | Codex 5-hour remaining | Matches Codex's own figure within rounding |
| QA-02 | Codex weekly remaining | Matches Codex's own figure within rounding |
| QA-03 | Codex reset countdowns | Counts down toward the correct reset |
| QA-04 | Codex burn projection | Consistent with recent usage and its reset |
| QA-05 | Side-by-side headroom | Both tools render together; the one with more headroom is obvious when the other is low |
| QA-06 | Source labeling | Every number attributed to the right tool, no cross-contamination |
| QA-07 | Codex activity stats | Tokens/cache/value/mix/savings render like Claude's, from Codex logs |
| QA-08 | OpenAI pricing | Codex value uses the OpenAI rate table |
| QA-09 | Snapshot storage | Codex snapshots persist with `source="codex"` in the existing table |
| QA-10 | Graceful empty Codex | With no Codex data, the page loads; Codex shows waiting/empty, Claude unaffected |
| QA-11 | No credential leakage | No Codex token in responses, source, or logs |
| QA-12 | Claude unaffected | Claude's gauges and stats behave exactly as before |
