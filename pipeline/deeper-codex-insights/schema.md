# Data Layer Design — Deeper Codex Insights
**Feature:** deeper-codex-insights
**Stage:** 3 — The Architect
**Path:** Incremental
**Source:** prd.md (approved)
**Store:** existing SQLite, unchanged. No tables, columns, rows, or migrations.

## Architecture Summary
The feature adds a privacy-bounded Codex event scanner, one poller-owned
analytics cache, and a local read-only endpoint. A 30-day scan is performed once
per poll and feeds both the existing Codex activity summary and the three insight
ranges. HTTP handlers only select a cached range and serialize it.

The existing `/api/state`, `/api/hosts`, `/api/trends`, peer-normalization, and
menu-bar contracts do not gain or lose fields. Dashboard JavaScript fetches the
new endpoint after the primary state so the account-limit view remains the fast,
primary surface. In multi-host mode this v1 section is explicitly scoped to
`This machine`; it does not fan out to peers.

## Verified Source Evidence
The implementation is based on the structured shapes emitted by the installed
Codex CLI, not prompt or response content. Every field remains capability
detected because older/newer logs may omit it.

| Insight | Structured source | Accepted meaning | Unavailable when |
|---|---|---|---|
| Token totals and reasoning | `event_msg.token_count.payload.info.last_token_usage` | Per-record input, cached-input subset, output, reasoning-output, and total tokens | No finite token usage record exists |
| Turn boundary | `event_msg.task_started.turn_id`, `turn_context.turn_id`, `event_msg.task_complete.turn_id` | Internal grouping key only; never returned | No supported boundary exists for a turn-dependent metric |
| Session boundary | One rollout JSONL file | Internal grouping key only; never returned | No supported records exist in a file/range |
| Model | `turn_context.model` | Model active for the associated turn | Missing or fails bounded-label normalization |
| Effort | `turn_context.effort` | Explicit effort setting for the associated turn | Missing or outside the allowlist |
| Context pressure | `token_count.info.last_token_usage.input_tokens` and `token_count.info.model_context_window`, with `task_started.model_context_window` fallback | Input-context use divided by explicit model context window | Either finite positive denominator or finite non-negative numerator is absent |
| Compaction | top-level `compacted`; `event_msg.context_compacted` only as compatibility fallback | One explicit compaction in a session | Neither canonical nor fallback event exists |
| Total latency | `event_msg.task_complete.duration_ms` | Explicit duration of a successfully completed task | No finite non-negative value exists |
| First-token latency | `event_msg.task_complete.time_to_first_token_ms` | Explicit time to first token for a successfully completed task | No finite non-negative value exists |
| Tool use | `response_item.function_call` / `response_item.custom_tool_call` invocation record | One invocation classified into a fixed category | No supported invocation record exists |
| Plan | live `account/rateLimits/read` → `rateLimits.planType` | Account-wide plan attached to quota response | Unknown or absent and no prior recognized live value |
| Credits | live `rateLimits.credits.{balance,hasCredits,unlimited}` and `rateLimitResetCredits.availableCount` | Account-wide credit status and optional bounded facts | Entire credit object has never been observed |

Fields containing message text, replacement history, commands, arguments,
outputs, paths, cwd, Git metadata, account email, opaque IDs, and raw tool names
are never copied into normalized records.

## Module and Control Flow

### `src/codex-events.js` — scanner and normalized records
Introduce a source-specific scanner with two layers:

1. `scanCodexSession(lines, sessionKey)` is a pure JSONL reducer used by tests.
2. `scanCodexRollouts(sinceMs)` performs the existing bounded directory walk,
   reads eligible rollout files, calls the reducer, and filters normalized
   records by timestamp. Parsed-file results are reused while path, modification
   time, and size are unchanged; deleted and out-of-range cache entries are
   pruned, so each poll normally reparses only the active rollout.

The reducer keeps identifiers only as ephemeral map keys. Its return value is an
internal object of finite numbers, timestamps, bounded enums/labels, and internal
session/turn keys. No raw event object or content field survives the line being
processed.

Normalized usage samples contain:

```text
{
  tsMs, sessionKey, turnKey,
  input, cached, output, reasoning, total,
  model|null, effort|null, contextWindow|null
}
```

Normalized completed turns contain:

```text
{
  tsMs, sessionKey, turnKey,
  durationMs|null, firstTokenMs|null,
  model|null, effort|null
}
```

Compactions contain only `{ tsMs, sessionKey }`. Tool invocations contain only
`{ tsMs, sessionKey, turnKey, category }`, where category is an internal enum.

### `src/codex-stats.js` — one analytics cache
Refactor the current Codex reader around the shared normalized scan:

- `refreshCodexAnalytics(nowMs)` scans the widest supported range (30 days)
  once, rebuilds existing activity totals from the deduplicated usage stream,
  builds all three insight aggregates, and atomically replaces the cache.
- `computeCodexActivity()` becomes a cache read. A cold cache returns the existing
  honest `{hasData:false}` shape rather than scanning during an HTTP request.
- `getCodexInsights(range)` becomes a cache read; unsupported ranges normalize to
  `7d`, matching existing trend behavior.
- `clearCodexStatsCache()` invalidates the combined cache for tests and the
  poller. The poller immediately calls `refreshCodexAnalytics()` synchronously
  before publishing local host state.
- Server startup prewarms once before the first local-host seed. That scan is
  startup/background work, not request work.
- The existing exported `readUsageRecords(sinceMs)` remains for `/api/trends`
  and tests, but delegates to the same scanner so existing and new Codex totals
  share deduplication and token semantics.

No new runtime dependency, worker, subprocess, database write, or timer is
introduced.

### `src/codex-limits.js` — account-fact cache
Extend the existing live rate-limit observer with `codexAccountFacts()`.
Recognized plan values retain the current allowlisted label behavior. Credit
metadata is normalized as follows:

- `unlimited === true` → `unlimited`.
- Otherwise `hasCredits === true` → `available`.
- Otherwise `hasCredits === false` → `none`.
- Otherwise status is unavailable.
- `balance` is optional, trimmed, control-character-free, and capped at 64
  characters. It is never parsed as money and receives no unit suffix.
- `rateLimitResetCredits.availableCount` is an optional integer clamped to
  `0..1_000_000`.
- Missing/null fields on a sparse live update preserve the last observed
  recognized value; an explicit supported boolean or finite count replaces it.
  An explicit `planType: unknown` or other nonempty unrecognized plan clears the
  prior plan to unavailable rather than leaving a stale tier visible.
- Reset-credit IDs, titles, descriptions, grant/expiry timestamps, and
  individual spend limits are ignored.

The fallback rollout path may update plan/windows but does not fabricate credit
facts absent from that event.

### `src/server.js` — additive local endpoint
Add `GET|HEAD /api/codex-insights?range=24h|7d|30d`. It calls only
`getCodexInsights(range)` and serializes the cached aggregate under the existing
security and `no-store` headers. Other methods retain the global 405 behavior.
No existing endpoint shape changes.

## Token and Turn Normalization

### Numeric safety
Every numeric input passes `Number.isFinite`, is clamped to a non-negative safe
integer, and is rejected rather than coerced from objects/arrays. Cached input
must not exceed input. Reasoning availability is tracked independently: an
explicit zero is supported, while missing, negative, non-finite, or
greater-than-output reasoning is unavailable rather than converted to zero.
Total is always recomputed as `input + output` because cached input is a subset
of input. Sums saturate at `Number.MAX_SAFE_INTEGER`; ratios are clamped to
`0..1` only after their inputs validate.

### Repeated `token_count` snapshots
Codex can emit the same `last_token_usage` snapshot more than once. Per rollout
file the reducer maintains:

- the active explicit turn key from `task_started` or `turn_context`;
- a set of token fingerprints already emitted for that explicit turn; and
- the last fingerprint for records without a usable turn key.

The fingerprint is the tuple of normalized `last_token_usage`, the normalized
cumulative `total_token_usage` tuple when present, and the explicit context
window. An explicit turn emits each complete fingerprint once. Including the
cumulative tuple preserves two legitimate same-sized model calls whose session
total advanced. Without a turn key or cumulative tuple, only a consecutive
per-call duplicate is suppressed, so separated legacy records are not silently
collapsed. A new explicit turn resets the relevant set. Cumulative
`total_token_usage` is a dedupe cross-check only and is never summed as a usage
delta.

All usage records associated with one explicit turn are summed to that turn
before turn-average, context, model, and effort aggregation. This permits genuine
multi-step tool/model work inside one task while removing repeated snapshots.

### Model and effort association
`turn_context` values are stored against its internal turn key and applied to
usage/completion records with the same key; the active context is a fallback for
legacy records without a key. Model labels must match a printable bounded token
pattern and are capped at 48 characters. The API returns at most the top five
models by tokens plus `Other`, with ties sorted by label. Effort is restricted to
`Minimal`, `Low`, `Medium`, `High`, and `X-high`; a present but unrecognized
future value is grouped as `Other`, while a missing value is not inferred.

### Tool classification
Only invocation-start records are counted; call outputs and matching end events
are ignored. An internal call identifier deduplicates an exact repeated start
when present. The name is inspected transiently and mapped to one of six fixed labels:
`Shell`, `File edits`, `Search`, `MCP`, `Subagents`, or `Other`. API output never
contains the inspected name. Fixed categories sort by count descending, then by
label.

### Compaction compatibility
If a file contains any canonical top-level `compacted` events, only those are
counted. Otherwise its `event_msg.context_compacted` records are used. This
file-level precedence prevents the two representations of one compaction from
being counted twice. A structured window identifier may deduplicate exact
repeats internally but never leaves the reducer. Only count and affected-session
cardinality leave the scanner.

## Range Aggregation
Ranges are exact rolling intervals ending at `nowMs`: 24 hours, 7 days, and 30
days. Day buckets use UTC because rollout timestamps are UTC. Records exactly on
the lower bound are included.

For each range:

- **Reasoning share:** `sum(reasoning) / sum(output)`. A zero output denominator
  is unavailable, even when reasoning is zero. Counts remain available when
  finite usage records exist.
- **Turn count:** distinct supported turn groups containing usage. Average
  tokens/turn is `sum(input + output) / count`.
- **Sessions:** rollout files containing supported usage in range. Average
  tokens/session is the same token sum divided by session count.
- **Busiest day:** UTC day with greatest total tokens. A tie resolves to the most
  recent day, then the date and token count are returned.
- **Model mix:** per-model token sum and turn count. `tokenShare` uses the token
  sum of model-tagged turns as its denominator; untagged usage is not assigned.
- **Effort mix:** explicit effort-tagged turn counts; denominator is tagged
  turns only.
- **Context pressure:** per-turn maximum `input/contextWindow`, accepted only
  when `0 <= input <= contextWindow`; report overall peak, supported turn count,
  and count whose peak is `>= 0.80`.
- **Compactions:** canonical event count and distinct affected sessions.
- **Latency:** successful `task_complete` records only. Total duration and
  first-token duration have independent sample counts/availability. Median is
  the middle value or the arithmetic mean of the two middle values for an even
  sample count; p95 uses nearest rank at sorted index `ceil(.95*n)-1`.
- **Daily trends:** one row per UTC day with supported usage: total, reasoning,
  output, turn count, `reasoningShare|null`, and
  `averageTokensPerTurn|null`. Rendering requires at least two non-null points
  for each trend.

Observed zeros remain numeric zero. Unavailable values are `null` paired with an
explicit `available:false`; they are never encoded as zero.

## API Contract
The endpoint returns a bounded object of this shape (illustrative values):

```json
{
  "source": "codex",
  "scope": "local-machine",
  "range": "7d",
  "generatedAt": "2026-07-12T20:00:00.000Z",
  "hasData": true,
  "account": {
    "scope": "account-wide",
    "plan": { "available": true, "label": "ChatGPT Pro" },
    "credits": {
      "available": true,
      "status": "available",
      "balance": "12.5",
      "resetCreditsAvailable": 2
    }
  },
  "summary": {
    "reasoning": { "available": true, "share": 0.18, "tokens": 180, "outputTokens": 1000 },
    "turns": { "available": true, "count": 12, "averageTokens": 4200 },
    "sessions": { "available": true, "count": 3, "averageTokens": 16800 },
    "busiestDay": { "available": true, "day": "2026-07-12T00:00:00.000Z", "tokens": 31000 }
  },
  "mix": {
    "models": { "available": true, "items": [{ "label": "gpt-5", "tokens": 42000, "tokenShare": 0.8, "turns": 10 }] },
    "effort": { "available": true, "items": [{ "label": "High", "turns": 8, "share": 0.67 }] },
    "tools": { "available": true, "items": [{ "label": "Shell", "invocations": 14, "share": 0.5 }] }
  },
  "context": {
    "pressure": { "available": true, "peak": 0.84, "supportedTurns": 4, "turnsAtOrAbove80Pct": 1 },
    "compactions": { "available": true, "count": 2, "sessionsAffected": 1 }
  },
  "latency": {
    "total": { "available": true, "medianMs": 3400, "p95Ms": 9200, "samples": 10 },
    "firstToken": { "available": true, "medianMs": 550, "p95Ms": 1100, "samples": 9 }
  },
  "daily": [{
    "day": "2026-07-12T00:00:00.000Z",
    "tokens": 31000,
    "reasoningTokens": 180,
    "outputTokens": 1000,
    "turns": 5,
    "reasoningShare": 0.18,
    "averageTokensPerTurn": 6200
  }]
}
```

Bounded output limits are 30 daily rows, six model rows (five plus `Other`), five
effort rows, and six fixed tool rows. `hasData:false` is valid alongside
available account facts; activity metric objects remain present with
`available:false` and null values so clients never guess from missing keys.

## UI Data Flow
The dashboard continues to render primary state first. Its existing 24h/7d/30d
range state triggers a same-origin fetch to `/api/codex-insights`; stale responses
are ignored with a monotonically increasing request token. Loading preserves the
prior insight view with an `Updating` status. A failed request produces one
section-level unavailable explanation and does not affect limits, activity,
trends, hosts, or menu output.

The client renders only fixed HTML templates and escaped bounded labels. Ratios
drive bar widths only after finite clamping. Charts have visible textual values
and accessible names; the range control is keyboard operable with visible focus.

## Failure and Compatibility Behavior
- Unreadable directories/files, malformed JSONL, primitive JSON, unknown events,
  and malformed fields are skipped independently.
- One bad session does not discard other sessions or account facts.
- A missing newer field disables only its dependent metric.
- An empty range returns `hasData:false`, not fabricated zero activity.
- A cold cache returns an unavailable aggregate immediately; it does not scan on
  request.
- Cache replacement is atomic: a failed refresh keeps the prior good value and
  logs one bounded error without event content.
- Account-limit and plan parsing continues even when insight scanning fails.

## Verification Seams
- Pure scanner fixtures pin current, legacy, repeated-token, malformed,
  compaction-dual-representation, hostile-label, and content-leak cases.
- Pure aggregate fixtures pin every formula, UTC boundary, tie-break,
  zero/unavailable distinction, percentile, cap, and sort.
- Endpoint tests spy on filesystem/subprocess functions and prove cached-only
  request behavior, range normalization, HEAD, headers, and aggregate-only JSON.
- Poller tests prove one 30-day scan refreshes all ranges before any external
  asynchronous poll work and before local state is published, that unchanged
  files reuse parsed results, and that a failed scan preserves the last good
  cache.
- Existing state-shape, hosts, trends, menu-bar, and installer suites remain
  unchanged and must pass.
- Browser/client tests cover loading, no-data, mixed availability, range race,
  light/dark themes, keyboard focus, and 320/860-pixel layouts.

## Migration and Rollback
There is no migration. Rollback removes the endpoint, scanner/aggregate UI, and
account-credit observer while leaving the existing SQLite file and
`usage_snapshots` untouched. The deduplication correction is shared with existing
Codex activity; its regression fixtures remain even if the deeper UI is rolled
back, because returning to duplicate token totals would knowingly restore an
incorrect value.
