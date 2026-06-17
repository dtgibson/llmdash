# PRD — Weekly Limit Predictor and Codex Stats
**Feature:** weekly-limit-predictor-and-codex-stats
**Date:** 2026-06-17
**Stage:** 2 - The Planner
**Source:** strategic-brief.md (approved)

## Feature Overview
Add weekly pacing beside the existing 5-hour pacing so each tool shows both
near-term and weekly risk. Re-check Codex local data and surface extra stats
only when they are reliable.

## User Stories
> **US-01** - As the dashboard user, I want to see whether my 5-hour usage is on
> pace, so that I can avoid short-window lockouts.
> **US-02** - As the dashboard user, I want to see whether my weekly usage is on
> pace, so that I can avoid running out later in the week.
> **US-03** - As the dashboard user, I want both pacing signals visible at once,
> so that one window does not hide risk in the other.
> **US-04** - As the dashboard user, I want Codex stats to expand only when real
> data exists, so that the dashboard never invents usage.
> **US-05** - As the dashboard user, I want unavailable Codex stats called out
> clearly, so that I understand the difference between missing data and zero
> usage.

## Functional Requirements

### Pacing Predictors
> **FR-01** - The app shall calculate a pacing result for the 5-hour window when
> limit usage and reset time are available.
> **FR-02** - The app shall calculate a pacing result for the weekly window when
> limit usage and reset time are available.
> **FR-03** - The app shall identify whether each window is on pace to stay under
> the limit or likely to reach the limit before reset.
> **FR-04** - The app shall treat a maxed 5-hour or weekly window as the binding
> signal for that specific window.
> **FR-05** - The app shall omit pacing text for a window when the required limit
> data is unavailable.

### Dashboard Display
> **FR-06** - The dashboard shall show the 5-hour predictor and weekly predictor
> at the same time for each tool.
> **FR-07** - Each predictor shall name its window, reset timing, and pacing
> status.
> **FR-08** - Weekly pacing shall not replace or hide the existing 5-hour pacing
> signal.
> **FR-09** - The existing headroom cue shall continue to consider both 5-hour
> and weekly windows.

### Codex Stats
> **FR-10** - The app shall audit current Codex local data for reliable activity
> stats during implementation.
> **FR-11** - The app shall surface additional Codex stats only if they come from
> stable, readable local data.
> **FR-12** - If no reliable additional Codex stats are available, the app shall
> keep the current "not available" state.
> **FR-13** - The app shall never display fabricated zeroes for unavailable Codex
> activity.

## Non-Functional Requirements
> **NFR-01 - Honesty:** Unavailable stats must be labeled as unavailable, not
> represented as zero.
> **NFR-02 - Compatibility:** The feature must preserve the zero-dependency Node
> and vanilla frontend stack.
> **NFR-03 - Performance:** Codex data checks must not run on the HTTP request
> path.
> **NFR-04 - Security:** The feature must not use credential reuse, unsupported
> APIs, or public network exposure.

## Out of Scope
- Alerts or notifications.
- Menu-bar or tray badge.
- General ChatGPT chat caps.
- Unsupported API or credential workarounds.
- Guessing Codex token usage from incomplete data.

## Open Questions
- Can this Codex installation expose any additional reliable activity stats?
  Default assumption: no. Keep "not available" unless implementation proves
  otherwise.

## Success Metrics
| ID | What's Being Verified | Pass Condition |
|---|---|---|
| QA-01 | 5-hour predictor remains visible | The dashboard still shows 5-hour pacing for tools with 5-hour limit data. |
| QA-02 | Weekly predictor appears | The dashboard shows weekly pacing for tools with weekly limit data. |
| QA-03 | Both predictors are visible | A tool with both windows shows both pacing signals at the same time. |
| QA-04 | Maxed weekly limit | A weekly window with 0% remaining is shown as limit reached. |
| QA-05 | Missing window data | A missing pacing input does not produce misleading text. |
| QA-06 | Headroom behavior | The cross-tool cue still fires when either window is low or maxed. |
| QA-07 | Codex unavailable stats | Codex activity remains "not available" when no reliable local activity data exists. |
| QA-08 | Codex available stats | If reliable Codex activity data exists, the UI surfaces it without duplicating or fabricating values. |
