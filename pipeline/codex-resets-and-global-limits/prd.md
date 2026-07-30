# PRD — Codex Resets and Global Limits
**Feature:** codex-resets-and-global-limits
**Date:** 2026-07-30
**Stage:** 2 — The Planner
**Source:** strategic-brief.md (approved)

## Feature Overview
Add an account-scoped global-limits area near the top of llmdash that shows available Codex resets with their expirations and brings every provider-reported global limit, including weekly Fable and Sonnet caps, into the same leading account view.

## User Stories

**US-01** — As the llmdash owner, I want to see how many Codex resets I have available, so that I know how much recovery capacity remains before I start a long task.

**US-02** — As the llmdash owner, I want to see when each available Codex reset expires, so that I can use time-limited resets before losing them.

**US-03** — As someone who uses several Claude and Codex limits at once, I want every account-wide cap near the top of the dashboard, so that the constraint most likely to stop my work is not buried in a lower tool section.

**US-04** — As someone monitoring more than one machine, I want account-wide limits shown once per account, so that repeated host readings do not look like separate allowances.

**US-05** — As someone making decisions from incomplete provider data, I want zero, stale, unsupported, and unavailable states to remain distinct, so that I never act on a fabricated allowance.

## Functional Requirements

### Leading Account Hierarchy

**FR-01** — The dashboard shall keep the existing primary 5-hour and weekly account gauges as the first limits shown near the top of the page.

**FR-02** — The dashboard shall place a supplementary global-limits area immediately beneath the primary account gauges and before pacing, machine-local activity, diagnostics, cost analysis, and trends.

**FR-03** — The supplementary area shall be grouped by account rather than by machine or local log source.

**FR-04** — The existing primary gauges shall retain their current identities, percentages, reset semantics, binding behavior, and account-collapse behavior.

### Codex Reset Availability

**FR-05** — When the sanctioned Codex account response explicitly reports reset availability, the Codex account block shall show the number of resets currently available.

**FR-06** — The available count shall include only reset quantities that the provider reports as available and whose explicit expiration has not passed at the time of the reading.

**FR-07** — The view shall represent every available reset covered by the provider evidence with its provider-supplied expiration date.

**FR-08** — Reset expirations shall be ordered from soonest to latest. Resets with the same expiration may be grouped only when the group shows the exact quantity represented.

**FR-09** — An expiration shall be shown as an unambiguous localized calendar date. When the provider supplies a precise instant, the display shall preserve enough time and timezone context to avoid moving the expiry to a misleading day.

**FR-10** — Expiration information shall be readable without hover, pointer input, or opening a secondary page.

**FR-11** — An explicit provider-reported zero shall render as `0 available` with no fabricated expiration rows.

**FR-12** — If the provider reports an available count but omits or invalidates one or more corresponding expirations, the view shall retain the authoritative count, identify how many expiration details are unavailable, and shall not invent dates.

**FR-13** — Expired reset records shall not contribute to the available count or remain presented as available after a fresh reading crosses their expiration.

### Other Global Account Limits

**FR-14** — The supplementary area shall show every bounded limit the provider identifies as global or account-wide, including model-specific weekly Fable and Sonnet limits when present.

**FR-15** — Each global limit shall show its provider-facing name, scope or window, current remaining state, reset or expiry evidence when available, and freshness state.

**FR-16** — The global-limit presentation shall support new provider-reported account-wide limits without treating Fable and Sonnet as a closed allowlist.

**FR-17** — A global limit shall appear once in the account area. Any lower tool-specific presentation of the same allowance shall not remain as a second independent-looking budget.

### Accounts, Hosts, and Evidence States

**FR-18** — Matching readings from several hosts signed into the same account shall collapse into one global account view using the product's existing account-identity rules.

**FR-19** — Different reachable accounts shall retain separate account views and shall never have their resets or global caps combined.

**FR-20** — The UI shall distinguish at least these states wherever applicable: available value, authoritative zero, unsupported, unavailable, malformed, stale, and source error.

**FR-21** — A stale last-good reading may remain visible only with its existing age and freshness warning; its timestamp and availability shall not be refreshed by unrelated data.

**FR-22** — Provider strings, counts, percentages, quantities, and timestamps shall be normalized before display. Invalid or out-of-range values shall degrade to an honest unavailable or partial state rather than raw text, `NaN`, a fabricated zero, or a fabricated date.

## Non-Functional Requirements

**NFR-01 — Performance:** The feature shall use the existing poller-owned, cache-served data path. Rendering or requesting the dashboard shall not trigger a provider command, account scan, or peer fan-out.

**NFR-02 — Accessibility:** The section shall use a meaningful heading and reading order, expose all status through text as well as color, and remain keyboard- and screen-reader-readable.

**NFR-03 — Responsive layout:** Every reset expiration and global limit shall remain readable at the dashboard's supported phone and desktop widths without horizontal page scrolling.

**NFR-04 — Security:** Externally sourced labels and diagnostics shall be bounded, stripped of control and formatting characters, and escaped before reaching an HTML-rendering surface.

**NFR-05 — Compatibility:** Existing consumers of the account and multi-host responses shall continue to work when no reset or supplementary global-limit evidence is present.

**NFR-06 — Honesty:** The feature shall preserve the product's separation between account-wide limits and machine-local activity and shall never infer entitlement data from usage history.

## Out of Scope

- Purchasing, consuming, extending, or otherwise changing a Codex reset from llmdash.
- Estimating reset availability or expiration from local usage history.
- Alerts or notifications for low reset availability, approaching expiration, or global-limit pressure.
- Historical charts or persistence for reset entitlements and their expiry dates.
- Adding reset or supplementary global-limit details to the menu-bar badge.
- General ChatGPT message caps without a sanctioned machine-readable source.
- Changing the meaning or binding calculation of the existing primary 5-hour and weekly gauges.

## Open Questions

**OQ-01 — Provider evidence shape:** Which fields in the current sanctioned Codex account response carry reset quantity, availability, and per-reset expiration? Default assumption: The Architect shall accept only fields whose semantics are explicit in the live response or stable provider schema; absent or ambiguous evidence ships as unsupported rather than being inferred.

**OQ-02 — Existing lower model-limit rows:** Should an exact duplicate remain in a lower tool section after the global copy is added? Default assumption: remove exact duplicates and keep the account area canonical; retain lower content only when it conveys distinct, clearly labeled context.

## Success Metrics

| ID | What's Being Verified | Pass Condition |
|---|---|---|
| QA-01 | Leading hierarchy (FR-01–FR-04) | Primary 5-hour and weekly gauges retain their current values and behavior; the supplementary global area renders directly below them and before all machine-local sections. |
| QA-02 | Codex reset count and distinct expirations (FR-05–FR-07) | A fixture with three available resets and three expirations shows `3 available` and represents all three provider dates. |
| QA-03 | Ordering and lossless grouping (FR-08) | Expirations render soonest-first; two resets sharing one expiry may render as one row only when that row states quantity `2`. |
| QA-04 | Date precision and non-hover access (FR-09–FR-10) | Every expiry is visible in the normal reading flow, and a precise provider instant renders with enough local date/time context to identify the correct expiry unambiguously. |
| QA-05 | Authoritative zero (FR-11) | An explicit zero renders `0 available`, shows no expiry items, and is not labeled unavailable. |
| QA-06 | Partial reset evidence (FR-12, FR-22) | A declared count of three with only two valid expirations keeps the count, shows the two dates, reports one unavailable expiry detail, and invents no third date. |
| QA-07 | Expiration boundary (FR-06, FR-13) | After a fresh reading crosses one reset's expiry, that reset no longer contributes to the available count or available list. |
| QA-08 | Known global model limits (FR-14–FR-15) | Fable and Sonnet weekly fixtures appear in the top account area with their names, remaining state, reset evidence, and freshness. |
| QA-09 | Future global-limit compatibility (FR-16) | A bounded, previously unseen provider global limit appears correctly without being relabeled as Fable or Sonnet. |
| QA-10 | Canonical placement (FR-17) | The same global allowance is not rendered as two independent-looking budgets in the top and lower tool areas. |
| QA-11 | Multi-host account behavior (FR-18–FR-19) | Two hosts for one account produce one global view; a second distinct account produces a separate view with no mixed reset counts or caps. |
| QA-12 | Evidence-state honesty (FR-20–FR-22) | Unsupported, unavailable, malformed, stale, source-error, and true-zero fixtures render distinct bounded states; none emits raw provider text, `NaN`, or an invented value. |
| QA-13 | Stale-reading semantics (FR-21) | A stale last-good reset/global-limit reading remains visibly stale with its original evidence time after an unrelated fresh activity update. |
| QA-14 | Cached request path (NFR-01, NFR-05) | Dashboard and multi-host requests render cached data without starting a provider probe or peer fetch, and legacy payloads with no new fields still render normally. |
| QA-15 | Accessibility and responsive rendering (NFR-02–NFR-03) | Automated checks and phone/desktop visual verification confirm semantic reading order, text status cues, keyboard readability, and no horizontal page overflow. |
| QA-16 | Untrusted-data handling (NFR-04, NFR-06) | Hostile labels, control characters, non-finite numbers, invalid quantities, and invalid timestamps remain inert and degrade honestly without changing account/local scope. |
