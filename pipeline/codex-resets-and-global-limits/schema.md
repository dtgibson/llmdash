# Schema — Codex Resets and Global Limits
**Feature:** codex-resets-and-global-limits
**Stage:** 3 — The Architect
**Source:** prd.md (approved)
**Path:** Incremental (extending existing live account-state contracts)
**Store:** existing SQLite and owner configuration files remain unchanged; reset-credit detail is poller-observed, bounded in-process state only.

## Path

Incremental. llmdash already has a persisted usage-snapshot schema, live Claude model-limit records, a sparse Codex account-fact cache, additive `/api/state` tool objects, and peer normalization for `/api/hosts`. This feature extends those runtime contracts. It does not add durable data, a table, a column, an index, a migration file, a new endpoint, or a request-path provider read.

## Current Schema State

### SQLite

The cumulative durable usage schema remains:

```sql
CREATE TABLE IF NOT EXISTS usage_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  captured_at TEXT NOT NULL,
  source TEXT NOT NULL,
  window TEXT NOT NULL,
  used_pct REAL NOT NULL,
  resets_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_usage_source_window_time
  ON usage_snapshots (source, window, captured_at);
```

Account windows use `source = claude-code|codex`. Claude model caps already reuse the table with `source = claude-model:<model-slug>` and their provider window. Reset entitlements are current account facts rather than history, so they never enter this table.

### Existing live account contracts

- Claude's statusline reading may contain a bounded `model_limits` array. `/api/state` exposes it on each tool as `modelLimits[]` with `source`, `provider`, `model`, `label`, `window`, `usedPct`, `remainingPct`, `resetsAt`, and `capturedAt`.
- Codex's poller asks the sanctioned app-server method `account/rateLimits/read`. `src/codex-limits.js` currently retains recognized plan, credit status, opaque balance, and `rateLimitResetCredits.availableCount` for a bounded account-fact lifetime. It deliberately ignores reset-credit detail.
- `/api/state` returns `{tools,headroom,generatedAt}`. Each tool has the fixed keys `source`, `label`, `plan`, `haveLimits`, `limits`, `modelLimits`, `projection`, `activity`, `dataAt`, `freshness`, and `limitsDiagnostic`.
- `/api/hosts` is a poller-owned cache of normalized `/api/state` readings. Its request handler does no provider work or peer fan-out.
- The browser groups account-wide windows by tool source and matching reset epochs, renders each unique account before machine-local activity, and currently renders `modelLimits` again inside lower tool details.
- `/api/codex-insights` separately exposes local Codex diagnostics plus an account-facts line containing the already-normalized reset-credit count. It is not suitable as the top multi-host source because it is local-machine-only.
- `${LLMDASH_DATA_DIR}/account-config.json`, legacy `subscriptions.json`, and their reset/billing endpoint remain independent owner configuration. They are not provider entitlement stores.

### Verified Codex source evidence

The installed Codex app-server currently returns this bounded shape alongside the normal account windows:

```json
{
  "rateLimitResetCredits": {
    "availableCount": 3,
    "credits": [
      {
        "id": "ignored",
        "resetType": "codexRateLimits",
        "status": "available",
        "grantedAt": 1782932812,
        "expiresAt": 1785524812,
        "title": "ignored",
        "description": "ignored"
      }
    ]
  }
}
```

The live account used for verification returned three detail records for `availableCount: 3`; every record had `resetType: codexRateLimits`, `status: available`, and Unix-second `expiresAt` evidence. Only availability and expiry semantics are needed. IDs, titles, descriptions, and grant times are discarded before the response line leaves the parser.

## Changes in This Feature

### Added

#### Bounded Codex reset-credit snapshot

`src/codex-limits.js` gains a reset-credit observer and a detached reader for the top account state. A successful supported observation normalizes to:

```json
{
  "available": true,
  "status": "available",
  "availableCount": 3,
  "expirations": [
    "2026-07-31T18:40:12.000Z",
    "2026-08-11T20:29:52.000Z",
    "2026-08-12T17:03:22.000Z"
  ],
  "missingExpirationCount": 0,
  "capturedAt": "2026-07-30T20:00:00.000Z"
}
```

Exact rules:

- `available` means supported provider evidence was observed; it does not mean the count is greater than zero.
- `status` is one of `available|zero|partial|unsupported`. `unsupported` has `available:false`, null count/capture, and empty expirations.
- `availableCount` accepts only a finite non-negative integer and is bounded to `0..1_000_000`.
- At most 128 reset detail records are retained. Each retained detail must be a plain object with `resetType === "codexRateLimits"`, `status === "available"`, and a canonicalizable finite Unix-second `expiresAt`. Unknown types/statuses and malformed timestamps are not treated as available expiry evidence.
- `expirations` contains only canonical UTC ISO strings strictly after the reader's `now`. It sorts ascending and retains duplicates because two resets may share one expiry. The UI may group an identical ISO value only with its exact quantity.
- When the provider count and complete valid detail list agree, the count equals the unexpired detail count. When the declared count is valid but details are absent, capped, malformed, unknown, or incomplete, the declared count remains authoritative and `missingExpirationCount = max(0, availableCount - expirations.length)`; status is `partial` when that value is nonzero. No expiry is invented.
- When a complete detail list proves that a previously labeled available record has expired, it is excluded from both the effective count and the expiry list. A fresh provider count of zero yields status `zero`, an empty list, and no missing details.
- Missing/null reset-credit fields are sparse updates and retain the last valid snapshot only within the existing bounded account-fact lifetime. An explicit recognized update replaces the whole snapshot atomically. A recognized plan/account change or unknown nonempty plan clears it with the other account credit facts.
- `capturedAt` is the actual successful app-server observation time and is never restamped by a sparse update, request, activity refresh, or peer normalization. Once the bounded account-fact lifetime expires, the reader returns `unsupported` rather than silently presenting stale entitlement data as current.
- The parser never retains or exports reset IDs, titles, descriptions, grant times, raw objects, individual spend limits, or arbitrary provider labels.

#### Additive tool contract

Every `/api/state` tool gains one bounded account-scoped object:

```json
{
  "accountLimits": {
    "scope": "account-wide",
    "resetCredits": {
      "available": true,
      "status": "available",
      "availableCount": 3,
      "expirations": ["2026-07-31T18:40:12.000Z"],
      "missingExpirationCount": 0,
      "capturedAt": "2026-07-30T20:00:00.000Z"
    }
  }
}
```

- Codex receives the current detached reset-credit snapshot from `src/codex-limits.js`; Claude receives the fixed unsupported reset-credit shape.
- `accountLimits.scope` is the literal `account-wide`. No machine-local activity, balance, account identifier, credit ID, or free-form provider content is added.
- Existing `limits` and `modelLimits` stay byte-for-byte in meaning and shape. The latter remains the generic bounded collection for Fable, Sonnet, and future provider model caps; it is no longer treated as lower-page-only data.
- Existing clients that ignore the additive key continue to work. `/api/codex-insights` may keep its legacy reset count for contract compatibility, but the dashboard no longer renders that count in the lower insights account line.

#### Peer ingest normalization

`src/hosts.js` gains `normalizeAccountLimits()` and `normalizeResetCredits()`:

- Require a plain `accountLimits` object and literal `scope: account-wide`; otherwise return the fixed unsupported shape.
- Accept only the four reset status enums above, a bounded integer count, `0..128` canonical future/past ISO strings before the local expiry filter, a bounded missing count, and a canonical `capturedAt`.
- Recompute rather than trust impossible combinations: invalid dates are removed; the missing count is at least `availableCount - validFutureExpirations`; zero has no expirations; `available:false` cannot carry a count or date.
- Return fresh arrays/objects so a peer payload cannot mutate cache state. Unknown keys, raw labels, IDs, and nested objects are dropped.
- A peer with an older llmdash version simply yields `unsupported` for reset details while its existing gauges and model caps continue to render.

### Modified

#### State assembly

- `src/server.js` imports only the detached reset-credit reader; it never starts Codex. `buildState(nowMs)` attaches the snapshot to the Codex tool while assembling the already-cached response.
- The local poller continues to own the app-server call. Its existing `buildState()` publication places the account snapshot into `host-cache`, so `/api/state` and `/api/hosts` stay pure bounded serialization on the request path.
- The state contract's golden key list is intentionally extended with `accountLimits`; all other tool fields and the primary headroom calculation remain unchanged.

#### Account overview rendering

- `public/app.js` adds one supplementary account renderer used by both the single-host `#single-limits` surface and each unique account group produced by `accountOverviewHtml()`.
- Within each tool's top account lane, primary 5-hour and weekly gauges remain first. Immediately below them, the renderer shows that tool's existing `modelLimits[]` plus Codex `accountLimits.resetCredits` when supported.
- Same-account groups select supplementary evidence by its own timestamp: newest valid `capturedAt` for reset credits and newest valid `capturedAt` per model-limit source. A missing field from an older peer never erases newer supported evidence from another member. Different account groups never merge.
- Reset expirations sort by epoch and group identical canonical instants with a visible quantity. Browser-local presentation uses an unambiguous medium date and time with timezone context; every value remains visible in the normal reading flow, not in `title` text or hover-only UI.
- `availableCount: 0` renders `0 available`. A positive partial snapshot renders the authoritative count, all known expirations, and `<N> expiration dates unavailable`. Unsupported evidence either omits the reset block or renders the fixed unavailable copy when Codex account evidence is otherwise present; raw status values never become copy.
- The existing lower `modelLimitsHtml(tool)` call is removed from `toolCoreHtml()` after its content moves to the top. The lower Codex insight account line stops repeating the reset-credit count. The menu-bar badge retains its independent existing model-limit rendering and receives no reset-credit UI in this feature.
- Primary gauge identity, pacing, headroom, trends, cost analysis, machine-local activity, and account-key calculation remain unchanged.

### Unchanged

- SQLite table, index, rows, deduplication, model-cap history, trends, and all snapshot writes.
- `account-config.json`, `subscriptions.json`, reset-schedule provenance, recurring billing history, and the exact reset/billing HTTP route.
- Codex's app-server method, poll interval, subprocess boundary, fallback rollout behavior, and account-fact lifetime.
- `/api/state`, `/api/hosts`, and `/api/codex-insights` route names, methods, cache headers, security headers, and request-path I/O posture.
- Existing standard account windows, same-account reset-epoch grouping, headroom calculation, and local activity semantics.
- Menu-bar data model and presentation, alerts, notifications, and reset consumption.

## Migration Plan

1. Add pure reset-credit normalization and sparse-cache tests, then observe the current app-server payload without publishing the new field. Existing count-only account facts continue unchanged.
2. Add `accountLimits` to local state assembly and strict peer normalization. Update intentional state-contract fixtures while proving legacy peers with no field remain compatible.
3. Add the supplementary top renderer for single- and multi-host views. Move model caps there and remove only the exact lower duplicates, including the lower Codex reset-count copy.
4. Run focused parser, server, peer, and browser suites plus the full suite and real browser rendering at phone and desktop widths.
5. Rollback ignores/removes the additive runtime field and restores the prior renderer. There is no durable entitlement data or schema migration to reverse.

## Design Decisions

### Current evidence, not history

Reset credits are time-limited account entitlements. Persisting them beside usage percentages would let expired grants survive as if current and would turn `usage_snapshots` into two incompatible kinds of record. The app-server observation and its original timestamp are the source of truth; bounded in-process retention covers sparse updates without creating history.

### Minimal privacy surface

The provider supplies IDs and descriptive strings, but the requested product behavior needs only a bounded count and expiry instants. Dropping every identifier and free-form field inside the parser keeps `/api/state` and peer payloads aggregate-only and removes an unnecessary display-injection and account-correlation surface.

### One top account story

The existing `modelLimits` contract already represents Fable, Sonnet, and future model caps generically. Reusing it avoids a duplicate global-limit API while moving its presentation to the correct account-scoped location. A narrow `accountLimits.resetCredits` addition covers the one different entitlement shape. The browser joins both under the primary gauges, where the user asked to see them.

### Partial evidence stays partial

`availableCount` and per-credit expirations are independent pieces of explicit provider evidence. A valid count remains useful when one expiry is malformed or omitted, but the UI must state exactly how many expiry details are missing. Rejecting the entire snapshot would hide known allowance; fabricating rows would be worse.

### Verification seams

- Pure Codex fixtures cover the live three-credit shape, snake/camel top-level aliases, explicit zero, identical expiries, expired records, count/detail mismatch, 129+ records, malformed dates/counts/statuses/types, sparse updates, account changes, TTL expiry, and mutation resistance.
- State tests pin the additive `accountLimits` shape while preserving every existing primary tool value and proving that state assembly starts no subprocess.
- Peer tests cover legacy omission, hostile nested values, oversized arrays, impossible count/date combinations, canonical timestamps, account separation, and newest-evidence selection.
- Client tests cover zero, full, partial, unsupported, expired, identical-expiry grouping, Fable/Sonnet/future model limits, exact duplicate removal, same-account collapse, different-account separation, escaped labels, and no raw enum copy.
- Browser QA verifies the global section renders below primary gauges and before local detail at phone and desktop widths, with keyboard/screen-reader order and no hover-only expiry information.
