# Strategic Brief — Deeper Codex Insights

## What We're Building
Add a Codex insights layer that explains how Codex work consumes tokens and
context, not just how many tokens were used. It will turn structured metadata
already present in local Codex session logs and the live Codex account response
into a compact, range-aware view beneath the existing account limits.

## Why Now
llmdash already shows Codex limits, token totals, cache behavior, cost estimates,
and daily trends, but those totals do not explain what drove the usage. The recent
visual refinement established a clear place for deeper analysis below the primary
account gauges, and the Codex reader now carries the live plan correctly. This is
the right moment to add diagnostic depth without weakening the dashboard's
account-limits-first hierarchy.

## The User Problem
When Codex burns through a large amount of context or tokens, the user cannot tell
whether the cause was reasoning intensity, long turns, repeated compaction, a
particular model or effort setting, heavy tool use, or one unusually large
session. They can see volume but cannot diagnose the work pattern behind it, which
makes it harder to choose an appropriate model, split work into better-sized
sessions, or understand a sudden change in usage.

## Success Criteria
- The Codex section explains the dominant usage pattern for the selected 24-hour,
  7-day, or 30-day range without competing visually with account limits.
- The user can see reasoning-token share, tokens per turn, tokens per session,
  session count, busiest day, model and effort mix, tool-use breakdown, and
  context/compaction pressure whenever Codex records the supporting fields.
- Plan and credit information is shown only when the live Codex account response
  supplies it, with account-wide scope stated plainly.
- Every insight is derived deterministically from structured metadata. Missing or
  version-dependent fields produce an honest unavailable state, never an inferred
  number or fabricated zero.
- Local activity remains labeled per machine in multi-host views, while account
  metadata remains clearly account-wide.
- No prompt, response, command output, or other session content is exposed through
  the API or UI; only bounded, normalized aggregates leave the local parser.

## Scope
- Extend the Codex session parser to collect supported structured metadata for
  reasoning, turns, sessions, models, effort, tool calls, context usage, and
  compaction events.
- Add range-aware aggregates for reasoning share, average tokens per turn and
  session, session count, busiest day, model/effort mix, tool-use mix, context
  pressure, and compactions.
- Include response latency only if the architecture pass finds explicit,
  reliably paired timestamps in the structured events; otherwise report it as
  unavailable and leave it out of the visual summary.
- Carry live plan and available credit metadata from the Codex app-server response
  without introducing a second account-data path.
- Present the insights as a quieter Codex detail section in the dashboard, using
  the existing range controls, responsive layout, design tokens, and honesty
  language.
- Preserve the existing snapshot database semantics: historical insights are
  re-derived from local Codex logs and are not duplicated into SQLite.
- Add fixture-driven parser, aggregation, API, rendering, responsive, and
  hostile-input coverage for every new field.

## Out of Scope
- Reading or displaying prompt text, model responses, command output, file paths,
  or other session content.
- General ChatGPT message caps, API-key billing, invoices, or pay-as-you-go spend.
- Reconstructing metrics Codex does not record explicitly, including heuristic
  latency pairing or guessed context pressure.
- Recommendations, scoring, productivity judgments, or automated advice based on
  the user's work patterns.
- Claude parity in this feature; these insights are specific to data Codex already
  records.
- Adding deeper analytics to the menu-bar glyph or dropdown; that surface remains
  focused on limits and immediate constraint status.
- New runtime dependencies, cloud processing, telemetry upload, or a new
  persistence store.

## Key Decisions
- The existing account-limits-first hierarchy remains unchanged; insights are a
  secondary diagnostic layer.
- Structured local Codex metadata and the existing app-server poll are the only
  sources of truth.
- Metric availability is capability-detected per field and Codex version. Unknown
  data is omitted or labeled unavailable rather than approximated.
- Account facts and per-machine activity stay visibly distinct, especially in the
  multi-host view.
- The feature aggregates metadata only and never exposes session content.
- The architecture stage must prove field availability against sanitized real-log
  shapes before the Planner's optional metrics become implementation commitments.
