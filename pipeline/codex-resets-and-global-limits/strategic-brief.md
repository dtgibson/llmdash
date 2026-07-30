# Strategic Brief — Codex Resets and Global Limits

## What We're Building
Extend llmdash's top account-limits area to show how many Codex resets are currently available and the expiration date for each one. The same area will also collect every other account-wide limit reported by a provider, including weekly Fable or Sonnet limits, so global constraints are visible together before machine-local activity.

## Why Now
llmdash already promises a single glance at the limits that can interrupt AI coding work, but the current view is incomplete when reset entitlements are absent and model-specific global caps appear farther down the page. Bringing all authoritative account-wide constraints into the leading limits area closes that planning gap and builds directly on the existing account-limit, model-limit, and multi-host foundations.

## The User Problem
The user can see the standard Codex and Claude windows but cannot tell how many Codex resets remain or when each one disappears without leaving llmdash. Global model limits can also be separated from the primary account picture, making it easy to overlook the constraint that will actually stop work next.

## Success Criteria
- The leading account area shows the number of currently available Codex resets and a clear expiration date for every available reset represented by the provider data.
- Weekly Fable, Sonnet, and any other provider-reported global limits appear in that same top area rather than only inside lower, machine-specific sections.
- The view distinguishes an authoritative zero from unavailable, malformed, stale, or unsupported data; it never turns missing evidence into zero or invents an expiration.
- Account-wide facts are shown once per account across multiple hosts, while machine-local activity remains clearly separate.
- Existing 5-hour and weekly gauges keep their current meaning and prominence, with the added global limits immediately beneath them.
- The complete global-limits area remains readable on phone and desktop and does not hide expiration details behind hover-only interactions.

## Scope
- Read Codex reset availability and expiration evidence from the sanctioned live account response already used by llmdash.
- Normalize and expose the reset count and expiration data through the existing source-aware account data path.
- Promote all provider-reported global and model-specific limits into one account-scoped area near the top of the dashboard.
- Preserve freshness, provenance, multi-host account collapsing, and honest unavailable-state behavior.
- Add tests for parsing, normalization, account deduplication, ordering, empty/error states, and responsive rendering.

## Out of Scope
- Purchasing, consuming, or otherwise changing a Codex reset from llmdash.
- Guessing reset availability or expiry from usage history when the provider does not report it.
- Alerts or notifications for an approaching reset expiration or global limit.
- Historical charts or persistence for reset entitlements and their expirations.
- Adding these details to the menu-bar badge in this feature.
- General ChatGPT message caps that have no sanctioned machine-readable source.

## Key Decisions
- Explicit live provider evidence is authoritative. Missing evidence stays unavailable, and only unexpired resets reported as available contribute to the displayed count.
- The top section is organized by account, not machine, because resets and model caps are global account facts.
- Fable and Sonnet are examples, not a hardcoded allowlist; the presentation accommodates any bounded provider-reported global limit without redesign.
- Every available reset's expiry remains recoverable in the UI. Identical expiry dates may be grouped only when the quantity is shown without losing information.
- Global limits stay visually subordinate to the primary 5-hour and weekly gauges but above pacing, local activity, diagnostics, and trends.
