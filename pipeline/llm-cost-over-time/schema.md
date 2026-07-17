# Schema — LLM Cost Over Time
**Feature:** llm-cost-over-time
**Stage:** 3 — The Architect
**Path:** Incremental
**Source:** prd.md (approved)
**Store:** existing SQLite, unchanged. No tables, columns, rows, or migrations.

## Current Schema State
- SQLite contains the existing `usage_snapshots` limit history; it stores no
  usage-ledger, subscription, rate-card, or monetary-value rows.
- Claude and Codex token activity is re-derived from local JSONL sources. Current
  estimated-value reducers use legacy in-process pricing semantics.
- `/api/state`, `/api/hosts`, `/api/trends`, and `/api/codex-insights` are the
  shipped read contracts. Peer fan-out and the menu bar consume those existing
  contracts and have no historical cost schema.

## Changes in This Feature

### Added
- Untracked local `${LLMDASH_DATA_DIR}/subscriptions.json` v1 owner-confirmation
  contract, detailed in **Subscription Configuration Contract**.
- Tracked `config/api-rates.json` v1 effective-dated pricing contract, detailed
  in **Effective-Dated Rate Card Contract**.
- Ephemeral normalized usage-ledger and immutable cost-cache schemas, detailed
  in **Additive Components and Control Flow** and **Ledger Traversal,
  Deduplication, and Bounds**.
- Additive read-only `GET|HEAD /api/cost-analysis` v1 response, detailed in
  **API Contract**.

### Modified
None. No existing persisted schema, table, column, row type, or public response
contract is changed.

### Unchanged
- SQLite initialization, schema version, and `usage_snapshots` reads/writes.
- `/api/state`, `/api/hosts`, `/api/trends`, and `/api/codex-insights` field
  contracts.
- Peer normalization/fan-out, host cache, SwiftBar/menu output, service controls,
  and installer state.

## Design Decisions
- **Derived, not persisted:** monetary history remains reproducible from local
  logs, confirmed coverage, and effective-dated rates; SQLite is untouched.
- **One comparable record set:** both API equivalents and signed cache effect
  use identical deduplicated evidence and coverage.
- **Exact arithmetic:** picodollar `BigInt` calculations serialize as bounded
  integer microdollars with paired reconciliation rules.
- **Bounded background work:** the poller builds all ranges atomically; requests
  never traverse logs or parse configuration.
- **Local-only v1:** combined means Claude + Codex on this machine; no peer API
  or menu consumer receives cost history.

The sections below specify each decision's schema, formulas, budgets, degraded
states, and verification seams.

## Architecture Summary
The feature adds one local owner-edited subscription file, one tracked
effective-dated API rate card, a shared normalized usage ledger for Claude and
Codex, one poller-owned in-memory cost cache, and one additive read-only endpoint.
The widest 90-day local scan is reduced once into 7-day, 30-day, and 90-day
views. HTTP requests only select and serialize a completed cached view.

No monetary value is written to SQLite. `usage_snapshots` remains exclusively a
limit-snapshot table, because subscription inputs and local usage valuations can
be deterministically re-derived. The existing `/api/state`, `/api/hosts`,
`/api/trends`, `/api/codex-insights`, peer normalization/fan-out, and menu-bar
contracts remain byte-for-byte compatible. Cost analysis is fetched separately
by the web dashboard and always declares `local-machine` scope.

## Additive Components and Control Flow

### `config/api-rates.json` — tracked historical rate card
Add a reviewed, source-controlled rate card containing only exact model IDs and
effective intervals. It is the sole pricing input; `config.json` pricing and
model-family/default fallbacks are not consulted by cost analysis.

The rate card is parsed at startup and whenever its file identity changes. A
failed reload preserves the last valid parsed card for cached historical views,
marks the new refresh partial with `rate_card_invalid`, and never silently adopts
only the valid half of a syntactically invalid file. Once syntax and the
top-level envelope pass, semantic record-level validation rejects only affected
source/rate entries and overlap components; unrelated valid model intervals
remain available.

### `src/subscriptions.js` — local owner-confirmed input
Read `${LLMDASH_DATA_DIR}/subscriptions.json`, using the existing resolved data
directory (normally `~/.llmdash`) and no HTTP mutation surface. The file is not
tracked, synced, or created with guessed values. Absence is an expected
`subscription_missing` state; documentation supplies an example, but the owner
must create and confirm the real values.

The reader uses `lstat`, accepts only a regular non-symlink file, and parses into
a new immutable value. Syntax and top-level envelope failure invalidate the
whole current file. After that envelope passes, entry-level errors reject only
the affected entry/overlap component and preserve unrelated accepted entries.
An absent/invalid current file is reported as such; it does not keep an old owner
amount looking current.

### `src/usage-ledger.js` — shared normalized 90-day evidence
Add a source-neutral ledger over the existing Claude and Codex scanners. Claude
records are normalized from the same transcript usage events consumed by
`src/stats.js`; Codex records come from the canonical deduplicated stream in
`src/codex-events.js`. Existing activity and trend reducers are redirected to
the same accepted stream so old `Est. value` surfaces cannot retain separate
model matching or cost arithmetic.

Internal normalized records have this shape:

```text
{
  tool: "claude" | "codex",
  tsMs: safe integer,
  identity: internal string,
  model: bounded exact string,
  input: safe nonnegative integer,
  output: safe nonnegative integer,
  cacheWrite: safe nonnegative integer,
  cacheRead: safe nonnegative integer,
  cacheReadIsInputSubset: boolean
}
```

`identity`, source file metadata, and source paths are internal only. No prompt,
response, command, tool payload, account identifier, session identifier, or path
survives into the public aggregate.

### `src/cost-analysis.js` — pure validation, pricing, and aggregation
This module owns:

- subscription/rate schema validation and interval indexing;
- exact fixed-point pricing and time-proportional allocation;
- pricing coverage and completeness reduction;
- daily and cumulative 7d/30d/90d views; and
- atomic in-memory cache replacement.

`buildCostAnalysis({nowMs, timeZone, ledger, scanReport, subscriptions,
rateCard})` is pure and fixture-driven. It builds all ranges and all three scopes
(`combined`, `claude`, `codex`) in one pass. `getCostAnalysis(range)` only reads
the last immutable snapshot.

### Poller and server integration
The existing 60-second server poll tick calls a single-flight
`refreshCostAnalysis(nowMs)` after local usage sources are refreshed and before
the next dashboard state is published. Startup schedules the same refresh once;
startup and HTTP serving do not wait for a cold filesystem scan.

Each tick:

1. Re-check subscription and rate-card identity.
2. Traverse source metadata within the scan budgets and parse only new or
   changed JSONL bytes/files.
3. Rebuild the normalized 90-day ledger and all three ranges.
4. Atomically swap the complete immutable snapshot.

Even with unchanged usage, aggregation runs each tick because the partial
current day and subscription overlap advance with `nowMs`. Concurrent ticks
coalesce into one refresh. A refresh failure retains the last good snapshot but
sets refresh metadata to `stale` with a fixed reason; a cold cache returns an
immediate unavailable response. No HTTP handler scans, parses config, spawns a
process, or waits on the poller.

Add `GET|HEAD /api/cost-analysis?range=7d|30d|90d`. An omitted range selects
`30d`; an unsupported or repeated range returns `400` with the existing bounded
JSON error shape. Other methods retain the global `405` behavior. Successful and
degraded analysis responses use the existing security and `no-store` headers.

## Subscription Configuration Contract
`subscriptions.json` has one exact v1 shape:

```json
{
  "schemaVersion": 1,
  "currency": "USD",
  "subscriptions": [
    {
      "tool": "claude",
      "amountUsd": "100.00",
      "startDate": "2026-07-01",
      "endDate": "2026-07-31",
      "confirmed": true
    },
    {
      "tool": "codex",
      "amountUsd": "0.00",
      "startDate": "2026-07-01",
      "endDate": "2026-07-31",
      "confirmed": true
    }
  ]
}
```

Validation is closed rather than coercive:

- File size: at most 256 KiB; JSON nesting: at most 8; entries: at most 512.
- Only `schemaVersion:1`, `currency:"USD"`, and the shown entry keys are
  accepted. Unknown top-level or entry keys are invalid rather than echoed.
- `tool` is exactly `claude` or `codex`; `confirmed` is exactly boolean `true`.
- `amountUsd` is a base-10 string matching `0|[1-9][0-9]{0,6}` plus optional
  `.[0-9]{1,2}`. Maximum is `$1,000,000.00`; exponent, sign, whitespace,
  separators, `NaN`, and `Infinity` are rejected.
- Dates are exact Gregorian `YYYY-MM-DD` values from 2000-01-01 through
  2100-12-31. `endDate >= startDate`; one entry may cover at most 3,660 dates.
- Dates are interpreted in the analysis timezone. Coverage begins at local
  midnight on `startDate` and ends at local midnight after `endDate`.
- Adjacent same-tool intervals are valid. Every entry in a same-tool overlap
  component is rejected in full. Different tools do not overlap semantically.
- An explicitly confirmed zero entry proves zero only for its own interval.
  A gap remains a gap.

Subscription diagnostics expose only tool, fixed reason code, and bounded date
intervals. Amounts from rejected records and raw file content never leave the
reader.

## Effective-Dated Rate Card Contract
`config/api-rates.json` has this v1 shape:

```json
{
  "schemaVersion": 1,
  "currency": "USD",
  "asOf": "2026-07-16T00:00:00.000Z",
  "sources": [
    {
      "id": "anthropic-public-2026-07-16",
      "label": "Anthropic API pricing",
      "publishedAt": "2026-07-16T00:00:00.000Z"
    }
  ],
  "rates": [
    {
      "tool": "claude",
      "model": "claude-sonnet-4-6",
      "effectiveFrom": "2026-07-16T00:00:00.000Z",
      "effectiveTo": null,
      "sourceId": "anthropic-public-2026-07-16",
      "usdPerMillionTokens": {
        "input": "3.00",
        "output": "15.00",
        "cacheWrite": "3.75",
        "cacheRead": "0.30"
      }
    }
  ]
}
```

Rate-card bounds and validation:

- File size: at most 1 MiB; nesting: at most 10; sources: at most 128; rate
  entries: at most 4,096.
- `asOf`, `publishedAt`, `effectiveFrom`, and non-null `effectiveTo` are canonical
  ISO-8601 UTC instants. `effectiveFrom < effectiveTo`; null is open-ended.
- IDs and labels are printable, control-free UTF-8 capped at 64 and 96 code
  points respectively. Source IDs are unique and every rate references one.
- Models are exact case-sensitive emitted IDs, printable ASCII, 1–96 characters.
  No substring, prefix, family, `default`, wildcard, or case-folded match exists.
- Rate strings use the same non-exponent decimal grammar with at most six
  fractional digits and a maximum `$100,000.000000` per million tokens.
- Claude requires `input`, `output`, `cacheWrite`, and `cacheRead`; Codex requires
  `input`, `output`, and `cacheRead` and forbids `cacheWrite`.
- Every entry in an overlapping interval component for the same `(tool, model)`
  is rejected in full. Adjacent intervals are valid.
- Historical price updates append/split explicit intervals. Adding a new
  effective interval never alters which interval matches an earlier timestamp.

The public response returns only source ID, reviewed label, publication instant,
card `asOf`, and the earliest/latest effective instants actually used. It does
not return the card, individual rates, or rejected values.

## Ledger Traversal, Deduplication, and Bounds

### File discovery and incremental parsing
The scanner reuses the current Claude project root and Codex session root. It
walks with `lstat`, skips symlinks and non-regular files, tolerates file races,
and considers only `.jsonl` candidates whose modification time can intersect the
90-day lower bound. Nested Claude subagent layouts are included.

Per source/tool, each refresh has these hard ceilings:

| Budget | Ceiling |
|---|---:|
| Relative directory depth | 6 |
| Directories opened | 512 |
| Directory entries inspected | 20,000 |
| Candidate JSONL files | 10,000 |
| One file size | 128 MiB |
| Newly read bytes | 512 MiB |
| JSONL lines parsed | 2,000,000 |
| Accepted normalized records | 1,000,000 |
| One JSONL line | 1 MiB |
| Wall-clock traversal/parse time | 10,000 ms |

The combined Claude + Codex refresh has a 20,000 ms ceiling. Reaching any
ceiling stops that source cleanly, retains accepted records, sets the matching
`scan_budget_*` reason, and makes its denominator unknown. It never returns a
percentage from a truncated denominator.

Parsed-file cache keys are `(device, inode, size, mtimeMs)`. Unchanged files
reuse their normalized results. An append-only file resumes at the last complete
newline and retains any unterminated tail until the next refresh. Shrinkage,
inode replacement, or non-append mutation reparses the file. Deleted and
out-of-range entries are pruned after a successful discovery pass. A file over
the per-file cap is not sampled; it is omitted with `file_too_large`, preserving
honesty rather than treating a tail as the whole file.

### Claude record identity
Only supported assistant usage records with a valid timestamp, exact model, and
finite nonnegative integer token tuple enter the ledger.

Deduplication key precedence is:

1. the record's explicit stable event UUID;
2. exact `(message ID, request ID, timestamp, model, token tuple)` when both IDs
   are supported; or
3. a content-free `(timestamp, model, token tuple)` fingerprint suppressed only
   when consecutive inside the same internal session.

The first two keys deduplicate across direct, nested subagent, and copied
transcripts. The fallback deliberately does not deduplicate across files, which
avoids collapsing two legitimate identical calls. Fallback-identity records are
counted and disclosed as `dedupe_fallback`; they do not expose the fingerprint.

### Codex record identity
Reuse `src/codex-events.js` canonical acceptance stream: explicit turn key plus
the normalized per-call usage and cumulative-total tuple deduplicates repeated
snapshots; without a reliable turn/cumulative tuple, only a consecutive identical
snapshot is suppressed. Cached input remains a subset of total input. No second
Codex scanner or cost-only dedupe rule is introduced.

### Recognized and comparable evidence
`recognizedRecords` counts deduplicated, structurally valid in-range usage
records before pricing. Recognized billing tokens are:

- Claude: `input + output + cacheWrite + cacheRead`.
- Codex: `input + output`; cached input is a subset and is not added again.

A recognized record is `comparable` only when its timestamp matches one valid
exact-model interval and every nonzero channel needed by both API formulas has a
rate. Comparable record/token counts are the shared denominator for observed and
no-cache values. An unpriceable record contributes to neither API amount.

## Exact Money and Allocation Arithmetic
All parsing and arithmetic are fixed-point; IEEE-754 currency multiplication is
not authoritative.

- One USD = `1_000_000_000_000` picodollars.
- API rate strings (up to six decimals of USD per million tokens) convert exactly
  to integer picodollars per token.
- Subscription strings convert exactly to integer picodollars.
- Internal token, rate, multiplication, allocation, and cumulative totals use
  `BigInt`.
- The API's canonical unit is integer microdollars (`amountMicros`), where one
  USD = `1_000_000` microdollars. Conversion from an aggregate picodollar value
  rounds half away from zero exactly once at the serialized cumulative boundary.
- Daily `amountMicros` is the difference between consecutive rounded cumulative
  boundaries. The final cumulative value and the sum of daily deltas therefore
  reconcile exactly. Cache effect is calculated in signed picodollars first;
  its serialized `amountMicros` is then the canonical no-cache microdollars minus
  canonical observed-cache microdollars at the same boundary. This paired
  rounding makes the visible equation exact. Cache effect also carries
  `rawSign:-1|0|1`; if a nonzero raw effect is below one microdollar,
  `belowResolution:true` keeps its sign visible instead of presenting a true
  zero.
- A serialized amount must remain within `Number.MAX_SAFE_INTEGER` microdollars;
  overflow makes the affected value unavailable with `amount_overflow`.

Subscription allocation uses cumulative quotients so DST and remainder
distribution are deterministic. For coverage `[S,E)` with amount `A`, allocated
picodollars through instant `T` are:

```text
floor(A * clamp(T - S, 0, E - S) / (E - S))
```

The allocation for any bucket `[B0,B1)` is the cumulative value at `B1` minus
the cumulative value at `B0`. A full coverage interval sums exactly to `A`.

API formulas, with rates expressed per token, are:

```text
Claude observed = input*Rin + output*Rout
                + cacheWrite*Rwrite + cacheRead*Rread
Claude no-cache = (input + cacheWrite + cacheRead)*Rin + output*Rout

Codex observed  = (input - cacheRead)*Rin
                + cacheRead*Rread + output*Rout
Codex no-cache  = input*Rin + output*Rout

cache effect    = no-cache - observed
```

`cacheRead > input` invalidates a Codex record. Missing rates for zero-count
channels do not invalidate it. Output tokens and volume never change between
the two comparisons.

## Range and Completeness Reduction
At refresh time the process resolves one IANA timezone (falling back to `UTC`
only if the runtime cannot resolve one) and records it in the snapshot. A range
starts at local midnight `N-1` dates before the generation date and ends at
`generatedAt`; start is inclusive and end exclusive. Daily buckets are local
calendar intervals, including 23/25-hour DST dates. Every date is emitted.

Each metric object has `status: complete|partial|unavailable`,
`amountMicros: safe integer|null`, and a sorted unique reason array capped at 16.
Reduction is deterministic:

- Subscription is `complete` only when accepted confirmed intervals cover every
  instant in scope. Known allocation plus any gap is `partial`; no accepted
  allocation is `unavailable`. A confirmed zero spanning the full interval is a
  complete numeric zero.
- API values are `complete` only when the source scan is complete and every
  recognized record is comparable. At least one comparable record plus omitted
  evidence is `partial`; recognized but wholly unpriceable usage is
  `unavailable`.
- A present, readable, fully traversed source with no recognized in-range usage
  yields complete API zero. A missing/inaccessible root is unavailable.
- Claude fallback-identity records remain included but set the affected source
  to partial with `dedupe_fallback`, because cross-file uniqueness cannot be
  proven without a stable ID. Unknown non-usage event types are ignored; only a
  record that signals usage but has an unsupported usage shape sets
  `record_unsupported`.
- Observed-cache, no-cache, and cache effect always share status, reasons, and
  pricing coverage because they use one comparison set.
- Combined is complete only when both tools are complete; it is partial when at
  least one known amount exists and either tool is partial/unavailable; it is
  unavailable when neither tool supplies an amount.
- A daily incomplete value stays partial/unavailable. Cumulative known amounts
  may continue, but the point carries the inherited state and renderers must not
  connect it as a complete segment.

Fixed public reason codes are:

```text
subscription_missing          subscription_unreadable
subscription_invalid_file     subscription_invalid_entry
subscription_unconfirmed      subscription_overlap
subscription_gap              rate_card_unreadable
rate_card_invalid             rate_invalid_entry
rate_overlap                  unknown_model
rate_missing                  timestamp_invalid
token_record_invalid          source_missing
source_unreadable             source_traversal_error
file_too_large                record_unsupported
dedupe_fallback               scan_budget_depth
scan_budget_directories       scan_budget_entries
scan_budget_files             scan_budget_file_bytes
scan_budget_total_bytes       scan_budget_lines
scan_budget_records           scan_budget_time
amount_overflow               cache_cold
refresh_failed
```

Reasons are severity-sorted, deduplicated, and accompanied only by bounded
counts/tool/date coverage. Raw exception messages are logged only after control
character removal and path redaction; they never enter the response.

## API Contract
`GET /api/cost-analysis?range=30d` returns this bounded v1 shape:

```json
{
  "schemaVersion": 1,
  "source": "local-logs-and-owner-config",
  "scope": "local-machine",
  "currency": "USD",
  "range": "30d",
  "generatedAt": "2026-07-16T22:00:00.000Z",
  "interval": {
    "start": "2026-06-17T07:00:00.000Z",
    "end": "2026-07-16T22:00:00.000Z",
    "timeZone": "America/Los_Angeles",
    "partialCurrentDay": true
  },
  "refresh": {
    "status": "fresh",
    "lastAttemptAt": "2026-07-16T22:00:00.000Z",
    "reasons": []
  },
  "provenance": {
    "subscription": { "ownerConfirmed": true, "coveredMs": 2545200000, "requiredMs": 2545200000, "gapCount": 0 },
    "pricing": {
      "cardAsOf": "2026-07-16T00:00:00.000Z",
      "sources": [{ "id": "anthropic-sonnet-5-launch-2026-06-30", "label": "Anthropic Sonnet 5 launch and API pricing", "publishedAt": "2026-06-30T00:00:00.000Z" }],
      "effectiveRates": [{ "tool": "claude", "model": "claude-sonnet-5", "effectiveFrom": "2026-06-30T00:00:00.000Z", "effectiveTo": "2026-09-01T00:00:00.000Z", "sourceId": "anthropic-sonnet-5-launch-2026-06-30" }]
    }
  },
  "scopes": {
    "combined": {
      "summary": {
        "subscription": { "status": "complete", "amountMicros": 96774194, "reasons": [] },
        "observedCache": { "status": "complete", "amountMicros": 231406250, "reasons": [] },
        "noCache": { "status": "complete", "amountMicros": 488900000, "reasons": [] },
        "cacheEffect": { "status": "complete", "amountMicros": 257493750, "rawSign": 1, "belowResolution": false, "reasons": [] }
      },
      "usageCoverage": {
        "status": "complete",
        "denominatorKnown": true,
        "recognizedRecords": 1214,
        "comparableRecords": 1214,
        "recognizedTokens": 102440000,
        "comparableTokens": 102440000,
        "recordRatio": 1,
        "tokenRatio": 1,
        "deduplicatedRecords": 38,
        "fallbackIdentityRecords": 0,
        "reasons": []
      },
      "subscriptionCoverage": {
        "status": "complete",
        "coveredMs": 2545200000,
        "requiredMs": 2545200000,
        "ratio": 1,
        "gapCount": 0,
        "gaps": []
      },
      "daily": [{
        "date": "2026-07-16",
        "partialDay": true,
        "subscription": { "status": "complete", "amountMicros": 1612903, "reasons": [] },
        "observedCache": { "status": "complete", "amountMicros": 5110000, "reasons": [] },
        "noCache": { "status": "complete", "amountMicros": 8900000, "reasons": [] },
        "cacheEffect": { "status": "complete", "amountMicros": 3790000, "rawSign": 1, "belowResolution": false, "reasons": [] }
      }],
      "cumulative": [{
        "at": "2026-07-16T22:00:00.000Z",
        "subscription": { "status": "complete", "amountMicros": 96774194, "reasons": [] },
        "observedCache": { "status": "complete", "amountMicros": 231406250, "reasons": [] },
        "noCache": { "status": "complete", "amountMicros": 488900000, "reasons": [] },
        "cacheEffect": { "status": "complete", "amountMicros": 257493750, "rawSign": 1, "belowResolution": false, "reasons": [] }
      }]
    },
    "claude": { "summary": {}, "usageCoverage": {}, "subscriptionCoverage": {}, "daily": [], "cumulative": [] },
    "codex": { "summary": {}, "usageCoverage": {}, "subscriptionCoverage": {}, "daily": [], "cumulative": [] }
  }
}
```

Contract bounds:

- Exactly three scopes and at most 90 `daily` plus 90 `cumulative` rows each.
- `amountMicros` is a safe integer or null. It is the canonical money value;
  clients divide by one million only for USD formatting. Cache-effect objects
  additionally carry `rawSign` and `belowResolution` as defined above.
- A positive amount from 1–9,999 microdollars uses adaptive UI precision or
  `<$0.01`; the client never rounds it to a displayed zero.
- `recordRatio`, `tokenRatio`, and subscription `ratio` are finite `0..1` only
  when their denominators are known and positive; otherwise null.
- `gaps` contains at most eight merged date intervals plus `gapCount`; no raw
  entry or amount is exposed.
- Pricing `sources` contains at most 16 sources actually used, sorted by ID.
- Pricing `effectiveRates` contains at most 64 exact tool/model intervals
  actually used, so the UI can show effective-from/effective-to boundaries
  without exposing a usage record.
- Every reasons array contains only the fixed enum, at most 16 entries.
- HEAD sends identical status/headers and no body.

If `refresh.status` is `stale`, the entire payload retains the original
`generatedAt`, interval end, and values from the last successful build; it does
not advance timestamps around old evidence. `lastAttemptAt` and
`refresh.reasons:["refresh_failed"]` disclose the failed attempt. A cold cache
returns the same top-level shape, current requested range, null metric amounts,
empty series, unavailable coverage, and `cache_cold`.

## UI Data Flow and Vocabulary Consolidation
The dashboard renders account limits first, then requests cost analysis
independently. A monotonically increasing request token discards an older range
response that arrives after a newer selection. During refresh, the prior cost
view remains visible with its original generation time; failure affects only the
cost section.

The client renders from fixed metric keys, fixed reason-code copy, and escaped
reviewed provenance labels. It derives no arithmetic except microdollar display
formatting. Summary values and final cumulative points come directly from the
same response. Charts use `daily`/`cumulative` state to break incomplete segments
and provide a text equivalent.

Existing Claude and Codex activity cards and estimated-value trends are wired to
the shared observed-cache reducer and renamed `API-equivalent · observed cache`,
or removed when they duplicate the new section. Existing `cache savings` copy is
replaced by signed `Cache effect`; no legacy default/family price result remains
visible. This is a UI/reducer consolidation only: existing endpoint fields stay
present for compatibility until a later versioned removal.

## Failure and Compatibility Behavior
- Invalid subscription input degrades subscription only; API values still render.
- Invalid rate input degrades API values only; configured subscription still
  renders.
- One tool's missing/unreadable source does not discard the other tool.
- A refresh exception preserves the last complete immutable cache and marks it
  stale; partial evidence produced without an exception replaces the cache with
  its honest partial state.
- Unknown/new models remain counted in recognized coverage but never priced by a
  guessed rate.
- No peer receives or is queried for cost history. Multi-host rendering still
  shows one local cost section labeled `This machine`.
- `/api/state`, `/api/hosts`, `/api/trends`, `/api/codex-insights`, host cache,
  SwiftBar plugin, and installer contracts do not gain required fields.
- SQLite initialization and `usage_snapshots` inserts are untouched.

## Verification Seams
- Subscription fixtures pin syntax bounds, owner confirmation, exact zero,
  adjacent/overlap behavior, gaps, partial ranges, DST, and malicious input.
- Rate fixtures pin exact model matching, provenance, effective boundaries,
  intra-day changes, missing channels, overlap rejection, unknown models, and no
  fallback path.
- Ledger fixtures pin current nested Claude subagents, stable-ID cross-file
  dedupe, fallback identity, Codex repeated snapshots, cached-input subset
  validation, file append/truncate/replace, and every scan ceiling.
- Arithmetic fixtures use `BigInt` or independently calculated decimal vectors
  to pin all four formulas, negative cache effect, sub-cent values, allocation
  remainders, DST, microdollar rounding, and exact range reconciliation.
- Endpoint tests spy on filesystem/process functions to prove cached-only GET and
  HEAD behavior, default/invalid ranges, stale/cold states, headers, bounds, and
  aggregate-only output.
- Poller tests prove single-flight refresh, 60-second config/rate invalidation,
  changed-file parsing, unchanged-file reuse, all-range atomic replacement, and
  prior-cache retention after exceptions.
- Contract/golden tests prove existing state, hosts, trends, Codex insights,
  peer fan-out, menu output, service controls, and snapshot writes are unchanged.
- Browser tests cover range races, partial/unknown/zero distinctions, signed
  cache effect, provenance, accessible chart text, focus, both themes, and
  320/860-pixel layouts.

## Migration Plan
There is no database migration and no historical-value backfill. Deployment adds
the tracked rate card and code, then the owner creates the optional local
subscription file with confirmed values. Until then, only subscription spend is
unavailable; API-equivalent analysis can operate from valid local logs and rates.

### Rollback
Rollback removes the endpoint, cost cache, rate card, and cost UI. The untracked
subscription file is left untouched as owner data. SQLite and
`usage_snapshots` require no rollback. Shared deduplication and corrected Codex
cache-subset arithmetic should remain if other shipped activity paths consume
them, because reverting those corrections would knowingly restore double counts.
