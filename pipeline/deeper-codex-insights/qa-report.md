# QA Report — Deeper Codex Insights

**Date:** 2026-07-12
**Test Runner:** `node:test` via `npm test`
**Result:** PASSED

## Test Suite Results

Final regression: **539 tests total — 537 passed, 0 failed, 2 skipped**.

The two skips are pre-existing environment-conditional menu installer checks in
`tests/menubar-install.test.js`; they exercise the no-Node path and skip because
this Mac has a system-wide Node binary. Focused parser, aggregation, account,
server, client, dashboard, multi-host, and menu suites all passed. Weft design
lint reported 0 findings, and `git diff --check` was clean.

## Acceptance Criteria Verification

| Criterion | Result | Notes |
|---|---|---|
| QA-01 Insight placement | ✓ Pass | Production markup and render inspection place `▲ Codex insights` after tool/host activity and before Trends; account limits remain primary. |
| QA-02 Supported ranges | ✓ Pass | Independent 24h, 7d, and 30d buttons are present, keyboard controls expose pressed state, and visible copy names the selected range. |
| QA-03 Atomic range update | ✓ Pass | One request updates the complete insight surface; request sequencing rejects late responses, preserves prior values while loading, and leaves account facts range-independent. |
| QA-04 Capability detection | ✓ Pass | Reasoning, turn, effort/model, tool, context, compaction, and timing availability are derived independently; missing or timestamp-invalid evidence affects only dependent metrics. |
| QA-05 Zero versus unavailable | ✓ Pass | Explicit zero reasoning, sessions, and compactions render as `0`; absent/malformed fields remain `available:false` with null values and render `Unavailable`. |
| QA-06 Scope disclosure | ✓ Pass | Activity is labeled `This machine`; the plan/credit strip is labeled `Account-wide`. |
| QA-07 Reasoning share | ✓ Pass | Known reasoning/output fixtures produce exact counts and share, explicit zero is retained, and a zero/missing output denominator is unavailable. |
| QA-08 Turn insight | ✓ Pass | Explicit turn identities produce exact count and supported-token average; legacy null turn identities do not fabricate counts or averages. |
| QA-09 Session insight | ✓ Pass | Session count and tokens/session are exact in fixtures; serialized aggregate responses contain no session identifiers. |
| QA-10 Busiest day | ✓ Pass | UTC daily totals are exact and tied totals deterministically select the most recent day. |
| QA-11 Model mix | ✓ Pass | Token shares and explicit-turn counts use tagged records only; output is bounded to five named models plus `Other`, with deterministic ordering. |
| QA-12 Effort mix | ✓ Pass | Only allowlisted explicit effort settings contribute; counts sort by observed turns and remain bounded to five rows, with unknowns folded into `Other`. |
| QA-13 Tool breakdown | ✓ Pass | Invocation starts map to six fixed categories, including current `tool_search_call`; call IDs dedupe starts, while arguments, queries, paths, outputs, and raw names never cross the aggregate. |
| QA-14 Context pressure | ✓ Pass | Explicit input/window fixtures produce exact peak and ≥80% counts for explicit turns only; missing windows or turn identity leave the metric unavailable. |
| QA-15 Compactions | ✓ Pass | Canonical events take precedence over fallback events, structured IDs dedupe, affected sessions are exact, and timestamp-less events do not fabricate supported zeroes. |
| QA-16 Latency | ✓ Pass | Median and nearest-rank p95 use explicit completed-task duration/first-token fields only; malformed, missing, duplicate, and aborted turns do not contribute. |
| QA-17 Live plan | ✓ Pass | Live `planType: pro` maps to `ChatGPT Pro`; missing sparse updates preserve known data, while an explicit unknown tier clears it instead of defaulting to Plus. |
| QA-18 Credits | ✓ Pass | Status precedence is `Unlimited` → `Credits available` → `No credits`; opaque balances are sanitized/bounded, reset counts are bounded, and no currency or billing meaning is invented. |
| QA-19 Daily trends | ✓ Pass | Two or more supported UTC days render exact reasoning-share and average-tokens/turn series; fewer points omit the chart, gaps use calendar spacing, and text equivalents report observed values. |
| QA-20 Multi-host scope | ✓ Pass | The standalone section remains `This machine`, uses its own local endpoint, performs no peer fan-out, and presents account facts once as account-wide. |
| QA-21 No-data state | ✓ Pass | Empty ranges retain account facts, show one concise range-specific explanation, and omit metric grids/charts and fabricated numbers. |
| QA-22 Malformed records | ✓ Pass | Malformed JSON, invalid numeric tuples, timestamp-less events, unknown event types, unreadable nested sessions, and hostile strings are isolated without suppressing valid sessions or the dashboard. |
| QA-23 Aggregate-only contract | ✓ Pass | Contract tests and a current-rollout probe found no prompts, responses, commands, paths, emails, raw IDs, `sessionKey`, or `turnKey`; labels are bounded. |
| QA-24 Local-only behavior | ✓ Pass | The scanner/aggregator use local filesystem metadata only, add no fetch/HTTP/child-process path, and piggyback account facts on the existing rate-limit poll. |
| QA-25 Request-path performance | ✓ Pass | `/api/codex-insights` calls a pure cache getter; one poller scan fills all three ranges, narrow Trends reads do not evict the 30-day parse cache, and failed refreshes preserve last-good data. |
| QA-26 Version compatibility | ✓ Pass | Current installed rollout shapes expose all six capabilities; legacy top-level and nested token/completion shapes retain supported metrics while unsupported fields degrade independently. |
| QA-27 Input/render hardening | ✓ Pass | Non-finite and negative values are rejected/bounded, model/effort/tool labels are normalized, inherited-key enums use own-key checks, timestamps are validated, ratios are clamped, and rendered strings are escaped. |
| QA-28 Zero-dependency architecture | ✓ Pass | `package.json` is unchanged, no runtime dependency/build step/store/migration was added, and insights re-derive from rollout logs. |
| QA-29 Existing-contract safety | ✓ Pass | Full regression is green; `/api/state`, peer shapes, trend readers, menu rendering, and native menu files remain unchanged. |
| QA-30 Accessibility | ✓ Pass | Range buttons are keyboard operable with visible focus and pressed state; zero/unavailable meaning is textual; charts have title/description/full text equivalents; concise status announcements avoid periodic re-announcement. |
| QA-31 Responsive themes | ✓ Pass | The 860px hierarchy was visually inspected; 700/620/430px reflow rules and 320px hostile-balance coverage prevent clipping/overflow, and light/dark variables provide readable contrast without color-only meaning. |
| QA-32 Snapshot semantics | ✓ Pass | Analytics code has no database write; `insertSnapshot` remains restricted to existing live limit windows, and no insight row is written to `usage_snapshots`. |

## Runtime and Manual Verification

- Loaded the production dashboard on an isolated local port using the installed
  Codex rollout directory and inspected the rendered 7-day section in Chrome.
- Switched the insight range independently and confirmed visible pressed/range
  state updates without changing the Trends control.
- Ran an aggregate-only 30-day current-shape probe: all tool, compaction, turn,
  reasoning, context, and latency capabilities were detected; the serialized
  response contained no raw IDs or path-shaped values and all labels were within
  their bounds.
- Restored the browser to the existing live dashboard and stopped the isolated
  QA server after inspection.

## Edge Cases Tested

- Repeated token notifications with complete and legacy fallback deduplication.
- Missing timestamps followed by valid duplicate events.
- Legacy top-level token, task-start, and task-complete shapes.
- Explicit zero reasoning versus missing reasoning and zero denominator.
- Null legacy turn identity versus explicit turn identity.
- Canonical/fallback compaction precedence and malformed capability events.
- Valid tool, compaction, and timing evidence without any token-usage rows.
- Aborted turns followed by contradictory late completions, and completions later
  invalidated by an abort.
- Current shell, search, MCP, subagent, file-edit, and unknown tool starts.
- Transient unreadable root, nested directory, changed cached file, and cold
  unreadable file behavior.
- Stale range-response races and persistent endpoint-error timer retries.
- All-zero charts, calendar gaps, colliding date labels, >24h duration caps,
  normalized minute/hour rounding, hostile HTML labels, and 64-character balances.

## Known Limitations

- Work-pattern insights are intentionally local to the machine serving llmdash;
  remote-machine insight aggregation is out of scope.
- Availability depends on explicit structured fields emitted by the installed
  Codex version. Unsupported historical records remain unavailable instead of
  being reconstructed heuristically.
- Daily buckets are UTC, as labeled. Credit balances remain opaque strings
  because the live response does not supply a safe display unit.

## Convention Flags

- Treat evolving local-log capabilities as supported only when a structurally
  valid, timestamped record is observed; missing identity or required fields must
  remain unavailable rather than becoming zero.
- Shared parse caches serving several time ranges must retain the widest active
  horizon so a narrow read cannot force the next broad refresh to reparse history.
