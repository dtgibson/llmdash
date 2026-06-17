# PRD — Claude Code Live Dashboard
**Feature:** claude-code-live-dashboard
**Date:** 2026-06-16
**Stage:** 2 — The Planner
**Source:** strategic-brief.md (approved)

## Feature Overview
A local web app that displays the user's authoritative Claude Code (Max) 5-hour
and weekly usage limits, remaining percentage and reset countdown, in a
mobile-friendly page served over the user's Tailscale network. It also records
periodic usage snapshots to local storage from first run, so the later trend
charts have real history.

## User Stories
> **US-01** — As the dashboard owner, I want to open a URL on my laptop and see my Claude Code 5-hour and weekly remaining usage, so that I know my current headroom at a glance.
> **US-02** — As the dashboard owner, I want to open that same URL on my phone over Tailscale, so that I can check my limits away from my desk.
> **US-03** — As the dashboard owner, I want each window to show when it resets, so that I can plan heavy work around the reset.
> **US-04** — As the dashboard owner, I want to see how fresh the numbers are, so that I can trust whether they're current or stale.
> **US-05** — As the dashboard owner, I want usage recorded over time from the moment it starts running, so that later trend charts have real history.
> **US-06** — As the dashboard owner, I want the page to update on its own, so that it stays current while I watch it.

## Functional Requirements

*Data collection*
> **FR-01** — The app shall obtain the Claude Code 5-hour window's used/remaining percentage and reset time.
> **FR-02** — The app shall obtain the Claude Code weekly (7-day) window's used/remaining percentage and reset time.
> **FR-03** — The app shall source these values from Claude Code's sanctioned interface (the statusline rate-limits data as the primary route), not from an estimate computed from logs.
> **FR-04** — When fresh data cannot be obtained, the app shall retain and display the last known values with their age, rather than showing nothing or zeros.

*Display*
> **FR-05** — The app shall display, for each window, the remaining percentage (remaining = 100 − used).
> **FR-06** — The app shall display a human-readable countdown to each window's reset.
> **FR-07** — The app shall display the timestamp or relative age of the latest data snapshot.
> **FR-08** — The app shall present a layout readable and usable on a phone screen.
> **FR-09** — The app shall refresh displayed values automatically on a regular interval without a manual reload.
> **FR-10** — The app shall visually distinguish a healthy window from a nearly-exhausted one (e.g. a color shift as remaining drops).

*Serving & access*
> **FR-11** — The app shall run as a background service on the user's machine.
> **FR-12** — The app shall serve the dashboard over the user's Tailscale network, reachable from other devices on the tailnet.
> **FR-13** — The app shall not require a login of its own.

*History logging (foundation for feature 3)*
> **FR-14** — The app shall persist periodic snapshots of each window's used percentage and reset time to local storage, starting from first run.
> **FR-15** — Each stored snapshot shall include its capture time.
> **FR-16** — Snapshot persistence shall survive app restarts (stored on disk, not only in memory).

*Activity stats (sourced from Claude Code's local session logs)*
> **FR-17** — The app shall compute and display token usage for the current 5-hour window, the current week, and today, derived from Claude Code's local session logs.
> **FR-18** — The app shall display a cache hit rate (cache-read tokens as a share of input tokens) over a recent window.
> **FR-19** — The app shall display an estimated value of recent usage: what the logged tokens would cost at pay-as-you-go API rates, shown for the week.
> **FR-20** — The app shall display a current burn rate (tokens per hour) and a plain-English projection of when, at that pace, the 5-hour limit would be reached relative to its reset.
> **FR-21** — The app shall make clear that activity stats are derived from this machine's local logs and are distinct in scope from the account-wide limit gauges.

*Insights (from local session logs)*
> **FR-22** — The app shall display a token mix for the week: input, output, cache-read, and cache-write totals with their relative proportions.
> **FR-23** — The app shall display the estimated cache savings for the week (what cache-read tokens would have cost at full input price, minus their actual cost).
> **FR-24** — The app shall display the estimated value for today, alongside the weekly figure.
> **FR-25** — The app shall NOT surface Claude Code's "what's contributing to your limits" insights (subagent-heavy %, high-context %, long-session %); these are Claude Code's own internal analysis and cannot be faithfully reproduced from the readable logs, so showing a derived approximation would conflict with `/usage`.

## Non-Functional Requirements
> **NFR-01 — Security:** The dashboard shall be reachable only over the private tailnet, never bound to a public interface, and shall never expose Claude Code credentials or tokens in its responses or UI.
> **NFR-02 — Reliability:** A failed data fetch shall not crash the app; it shall keep serving the last known values.
> **NFR-03 — Performance:** The page shall become interactive within roughly 2 seconds on a phone over a normal Tailscale connection.
> **NFR-04 — Footprint:** As a single-user background tool, the app shall use minimal resources and respect the data source's rate-limit guidance (no over-polling).
> **NFR-05 — Compatibility:** The dashboard shall render correctly on current mobile and desktop browsers.

## Out of Scope
- Codex usage (feature 2).
- Trend chart visualization (feature 3); only the underlying snapshot logging is in scope here.
- Alerts or notifications when nearing a limit.
- General ChatGPT chat caps, Kagi, and pay-as-you-go API spend.
- User accounts, authentication, or multi-user support.
- Public/internet exposure beyond the tailnet.
- Backfill of usage from before first run (none is available).

## Open Questions
> **OQ-01** — If the statusline rate-limits path proves unavailable on this Max tier/version (a known intermittent issue), should the app fall back to the direct usage endpoint despite its policy and rate-limit caveats? *Default if unanswered by Stage 5:* ship with the statusline path only; treat the fallback as a separate later decision.
> **OQ-02** — How often should the page update? *Default:* refresh the page from the latest stored snapshot every ~30–60 seconds.
> **OQ-03** — How granular should logged history be? *Default:* capture a snapshot on each successful read, deduplicated to roughly one every few minutes.
> **OQ-04** — Should the dashboard also surface the per-model weekly windows (Opus/Sonnet) the source exposes, or just the headline 5-hour and weekly? *Default:* headline 5-hour + weekly only for v1.
> **OQ-05** — Which rates back the "estimated value" stat? *Default:* current published Anthropic per-model API token rates, kept in a small local config the user can update. Model split as its own stat is deferred (not in this feature).

## Success Metrics
| ID | What's Being Verified | Pass Condition |
|---|---|---|
| QA-01 | 5-hour remaining shown | Dashboard's 5-hour remaining matches Claude Code's own /usage figure within rounding |
| QA-02 | Weekly remaining shown | Dashboard's weekly remaining matches Claude Code's own /usage figure within rounding |
| QA-03 | Reset countdowns | Each window shows a countdown that decreases over time toward the correct reset moment |
| QA-04 | Data freshness shown | The page shows the latest snapshot's age and it updates as new snapshots arrive |
| QA-05 | Phone access over Tailscale | The dashboard loads and is readable on a phone via the machine's tailnet address |
| QA-06 | Auto-refresh | Displayed values update on their own within the configured interval, no manual reload |
| QA-07 | Graceful degradation | On a failed fetch, the page keeps showing last known values with their age and stays up |
| QA-08 | Snapshot persistence | Snapshots accumulate on disk over time and remain after an app restart |
| QA-09 | No credential leakage | No token or credential value appears in the page, its source, or any API response |
| QA-10 | Not publicly exposed | The dashboard is not reachable from outside the tailnet |
| QA-11 | Token usage stats | Dashboard shows tokens for the 5-hour, weekly, and today periods, matching a manual tally of the local logs within rounding |
| QA-12 | Cache hit rate | Dashboard shows a cache hit rate consistent with the logs' cache-read vs input token counts |
| QA-13 | Estimated value | Dashboard shows a weekly estimated value computed from logged tokens at the configured per-model API rates |
| QA-14 | Burn rate & projection | Dashboard shows tokens/hour and a projection to the 5-hour limit consistent with recent usage and the window's reset |
| QA-15 | Token mix | Dashboard shows input/output/cache-read/cache-write totals for the week that sum to the weekly token total |
| QA-16 | Cache savings | Dashboard shows a weekly cache-savings figure consistent with cache-read volume and per-model rates |
| QA-17 | Today's value | Dashboard shows today's estimated value alongside the weekly value |
