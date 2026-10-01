# Schema — Available API Credits
**Feature:** available-api-credits
**Stage:** 3 — The Architect
**Source:** prd.md (approved), strategic-brief.md
**Store:** none added. SQLite is unchanged; credits stay bounded in memory.

## Path
Incremental. Eighteen prior `schema.md` files and a shipped SQLite store exist,
and this feature changes the `/api/state` wire contract (additive
`accountLimits.credits`), the `/api/codex-insights` contract (removal, FR-28),
and the `src/hosts.js` peer normalizer. It is **not** Frontend Only even though
nothing new is persisted: the contract and the peer whitelist are structural
changes the Engineer, Tester, and Auditor must see. Running hands-off, the path
is declared here and proceeded on.

## Current Schema State

### Durable state — unchanged (no migration)

The complete SQLite schema remains exactly:

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

No table, column, index, row, or schema version is added or changed. The
owner-managed `account-config.json`, `subscriptions.json`, `hosts.conf`, the
captured provider files, and the badge's runtime files are untouched. **No
credit observation is ever written to disk** (PRD Out of Scope; CLAUDE.md
"persist only what has no other history" — a credit standing is a current
account fact with a TTL, exactly like reset credits and the plan label).

### In-memory account facts (src/codex-limits.js) — the single producer

Module-level sparse-update cache, poller-written only, already shipped:

| Variable | Meaning | Written by |
|---|---|---|
| `observedCreditUnlimited` / `observedCreditUnlimitedAtMs` | last `credits.unlimited` boolean + its observation time | `observeAccountFacts()` |
| `observedHasCredits` / `observedHasCreditsAtMs` | last `credits.hasCredits` boolean + time | `observeAccountFacts()` |
| `observedCreditBalance` / `observedCreditBalanceAtMs` | last string balance (control-stripped, trimmed, ≤64 code points, or `null` when empty) + time | `observeAccountFacts()` via `boundedBalance()` |
| `observedResetCreditsSnapshot` / `observedResetCreditsAtMs` | reset-credit snapshot | unchanged |
| `observedPlanType` / `observedPlanAtMs` | plan tier | unchanged |

Time bands already shipped and reused verbatim (FR-07):

- `ACCOUNT_FACT_TTL_MS` = clamp(5 min … 30 min, 5 × poll interval) — fresh.
- `ACCOUNT_FACT_HARD_CAP_MS` = 24 h — past it the evidence is cleared.
- `clearObservedCredits()` — already clears every credit variable on a
  recognised plan change or an unknown plan (FR-08 second sentence is already
  satisfied by this function; no new clearing code).
- Sparse updates (`credits` absent, or a field `null`/non-boolean/non-string)
  already leave the prior observation and its timestamp untouched (FR-06,
  FR-08 first sentence, FR-10 last sentence). The rollout-file fallback never
  calls `observeAccountFacts()` (FR-09).

**Nothing in the ingest path changes.** This feature adds a second *reader*
over the same cache and retires the credits half of the existing reader.

## Changes in This Feature

### Added

#### 1. New module `src/account-credits.js` — one home for the credits vocabulary

Pure, dependency-free (imports nothing). Shared by the local producer and the
peer normalizer so the enum, the balance sanitizer, and the unsupported factory
have exactly one definition (the `src/net.js` "one home for a classifier"
discipline; NFR-03 requires byte-identical stripping at both boundaries).

```js
export const CREDIT_STATUSES       = new Set(['unlimited', 'available', 'none', 'stale', 'unsupported']);
export const CREDIT_FRESH_STATUSES = new Set(['unlimited', 'available', 'none']);   // legal lastStatus values
export const CREDIT_REASONS        = new Set(['never-observed', 'not-reported', 'peer-omitted']);
export const CREDIT_BALANCE_MAX_CODE_POINTS = 64;

// FR-10 / NFR-03. Returns: undefined (not a string → caller ignores, retains prior),
// null (empty after stripping), or the bounded string. No numeric coercion ever.
export function boundedCreditBalance(raw) {
  if (typeof raw !== 'string') return undefined;
  const cleaned = raw.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').trim();
  if (!cleaned) return null;
  return [...cleaned].slice(0, CREDIT_BALANCE_MAX_CODE_POINTS).join('');
}

// Every unsupported block is built here so the four-key shape is fixed (FR-01).
export function unsupportedCredits(reason) {
  return { status: 'unsupported', reason, balance: null, capturedAt: null };
}
```

`boundedBalance()` in `src/codex-limits.js` is **moved** here (same regex, same
behaviour — the existing `codex-account-facts.test.js` sanitising assertions
must keep passing against the moved function) and `codex-limits.js` imports it.

#### 2. New reader `codexCredits(nowMs = Date.now())` in `src/codex-limits.js`

A detached, time-aware snapshot for `/api/state`, the sibling of
`codexResetCredits()`. Every call returns a fresh object (callers cannot mutate
cache state). Algorithm, in order:

```
standing  = observedCreditUnlimited === true  ? 'unlimited'
          : observedHasCredits === true       ? 'available'
          : observedHasCredits === false      ? 'none'
          : null                                                   // FR-04
if standing === null → return unsupportedCredits('never-observed') // FR-05 (balance ignored)

contributing = [observedCreditUnlimitedAtMs, observedHasCreditsAtMs,
                observedCreditBalanceAtMs].filter(t => t !== null)
capturedAtMs = max(contributing)                                   // FR-06: newest contributing fact
ageMs        = nowMs - capturedAtMs
if ageMs >= ACCOUNT_FACT_HARD_CAP_MS → return unsupportedCredits('never-observed') // FR-07 cleared band
                                       (read-side only; do NOT mutate the cache — codexResetCredits
                                        has the same read-side discipline)
balance      = observedCreditBalance ?? null   // string or null; never coerced (FR-11)
capturedAt   = new Date(capturedAtMs).toISOString()
if ageMs > ACCOUNT_FACT_TTL_MS
  → { status: 'stale', lastStatus: standing, balance, capturedAt }  // FR-07 stale band
else
  → { status: standing, balance, capturedAt }                       // fresh band
```

Rules the Engineer must hold:

- **Precedence uses the retained flags, not the per-fact `fresh()` filter.**
  `fresh()` ages each flag independently; the block ages as a unit by its newest
  contributing observation (FR-06/FR-07). In practice `unlimited`, `hasCredits`
  and `balance` arrive in one `credits` object per poll, so their timestamps are
  equal; the PRD's "newest contributing fact" is the ratified rule for the
  theoretical case where they differ.
- `nowMs` is coerced exactly as `codexResetCredits()` does (`Number`, fall back
  to `Date.now()` when not finite) so the mocked-clock tests (QA-08) work.
- The `capturedAt` is always derived from an observation timestamp — there is
  no "now" fallback anywhere (FR-06, CLAUDE.md timestamp rule).
- `"0"` is a legal balance and flows through unchanged (FR-11).
- No file read, subprocess, or poll is added; this is in-memory arithmetic on
  the request path, the same cost class as `codexResetCredits()` (FR-03,
  NFR-01).

#### 3. Claude producer — constant block in `src/claude-limits.js`

```js
export function claudeCredits() { return unsupportedCredits('not-reported'); }
```

Always this value, regardless of statusline or `/usage` evidence (FR-12). It is
a function (not a shared constant object) so each state build gets a detached
object, matching the Codex reader's contract.

#### 4. `/api/state` wire contract — `tools[].accountLimits.credits`

`toolWrap()` in `src/server.js` gains an eighth parameter:

```js
export function toolWrap(source, label, plan, live, activity, nowMs,
                         resetCredits = null,
                         credits = unsupportedCredits('never-observed'))
```

and emits:

```js
accountLimits = {
  scope: 'account-wide',          // unchanged (FR-02)
  resetCredits: resetCredits || unsupportedResetCredits,   // unchanged (FR-02)
  credits,                         // NEW — exactly one of the shapes below
}
```

`buildState()` passes `claudeCredits()` for Claude and `codexCredits(nowMs)` for
Codex. The default (`never-observed`) is the honest generic for any future tool
that has not been wired; it must never be relied on for Claude.

**Exact `credits` shapes (FR-01) — no other keys are ever present:**

| Band | Shape |
|---|---|
| fresh | `{ status: 'unlimited'\|'available'\|'none', balance: string\|null, capturedAt: ISO }` |
| stale | `{ status: 'stale', lastStatus: 'unlimited'\|'available'\|'none', balance: string\|null, capturedAt: ISO }` |
| unsupported | `{ status: 'unsupported', reason: 'never-observed'\|'not-reported'\|'peer-omitted', balance: null, capturedAt: null }` |

Field bounds: `balance` ≤ 64 code points, control/format/line/paragraph
separators stripped, trimmed, never numeric; `capturedAt` canonical ISO
(`toISOString()` output) or `null`; `lastStatus` present **only** when
`status === 'stale'`; `reason` present **only** when `status === 'unsupported'`.
A fresh/stale block always has a non-null `capturedAt`; an unsupported block
always has `null` balance and `capturedAt`.

Everything else in the tool object (`source`, `label`, `plan`, `haveLimits`,
`limits`, `modelLimits`, `projection`, `activity`, `dataAt`, `freshness`,
`limitsDiagnostic`) and the top-level state keys are byte-for-byte unchanged
(NFR-07). `tests/state-unchanged.test.js` `TOOL_KEYS` needs no edit; its
`accountLimits` deep-equal (line ~113) gains the `credits` key — Claude
`not-reported`, Codex `never-observed` on a fresh process.

#### 5. Peer normalizer — `src/hosts.js`

`normalizeAccountLimits(value, nowMs)` returns a third key:

```js
return {
  scope: 'account-wide',
  resetCredits: normalizeResetCredits(value.resetCredits, nowMs),
  credits: normalizeCredits(value.credits),           // NEW
};
```

`unsupportedAccountLimits()` (the degraded shape for a non-object / wrong-scope
`accountLimits`) gains `credits: unsupportedCredits('peer-omitted')` (FR-14).

New `export function normalizeCredits(value)` — whitelist, in this order
(FR-13, FR-14, NFR-03):

1. Not a plain object, or `status` not in `CREDIT_STATUSES` → `unsupportedCredits('peer-omitted')`.
2. `status === 'unsupported'` → `unsupportedCredits(CREDIT_REASONS.has(value.reason) ? value.reason : 'peer-omitted')`. Balance and capturedAt are forced to `null` regardless of what the peer sent.
3. `capturedAt = typeof value.capturedAt === 'string' ? normalizeIso(value.capturedAt) : null`; if `null` → `unsupportedCredits('peer-omitted')` (a fresh or stale block without a valid clock cannot age honestly).
4. `balance = value.balance === null ? null : boundedCreditBalance(value.balance)`; if `undefined` (non-string) → treat as `null`. The peer value is **re-stripped and re-bounded** here — the local sanitiser is not trusted across the wire.
5. `status === 'stale'` → require `CREDIT_FRESH_STATUSES.has(value.lastStatus)`, else `unsupportedCredits('peer-omitted')`; emit `{ status: 'stale', lastStatus, balance, capturedAt }`.
6. Otherwise (fresh) → emit `{ status, balance, capturedAt }`. Any extra peer keys are dropped.

A valid peer `capturedAt` is preserved as-is (clock skew intact, never
restamped), matching the module's existing contract comment.

**Reset-credit `stale` pass-through (FR-15), same change:**

- `RESET_CREDIT_STATUSES` becomes `new Set(['available', 'zero', 'partial', 'stale', 'unsupported'])`.
- In `normalizeResetCredits()`, the emitted `status` becomes
  `value.status === 'stale' ? 'stale' : (availableCount === 0 ? 'zero' : missingExpirationCount > 0 ? 'partial' : 'available')`.
  Count, expirations, and `missingExpirationCount` are still re-filtered by the
  local clock exactly as today; only the status label is preserved. No other
  reset-credit field or bound changes (FR-02).

`normalizeTool()` is unchanged (it already calls `normalizeAccountLimits`).
The local host's entry in `/api/hosts` is `buildState()` taken in-process by
the poller (`src/poller.js`), so FR-16 holds structurally — no code.

#### 6. `/api/codex-insights` — removal (FR-28)

`codexAccountFacts()` in `src/codex-limits.js` returns only:

```js
{ scope: 'account-wide', plan: { available: boolean, label: string|null } }
```

The `credits` sub-object (`available`, `status`, `balance`,
`resetCreditsAvailable`) is deleted. `getCodexInsights()` in
`src/codex-stats.js` is unchanged in code (`account: codexAccountFacts()`); its
payload loses the key. The dashboard's `insightAccountHtml()` renders
"Account-wide" + plan label (or "Plan unavailable") only, and the
`CREDIT_STATUS_COPY` table in the insights section is removed (the new copy
table lives in the supplementary section, below) (FR-27).

#### 7. Dashboard — `public/app.js` supplementary account groups

Touchpoints, with the structure the Engineer should follow (mirror the
`resetCreditsForDisplay` → `resetStatePill` → `resetCreditsHtml` trio):

- **`CREDITS_STATUS_COPY`** (null-prototype or `Object.freeze` + own-key check):
  `unlimited → 'Unlimited'`, `available → 'Credits available'`,
  `none → 'No credits'`, `stale → (pill)`, `unsupported → 'Unavailable'`.
  **`CREDITS_REASON_COPY`**: `never-observed`, `peer-omitted`, `not-reported`
  with the exact FR-22 sentences. Every lookup goes through
  `Object.prototype.hasOwnProperty.call(TABLE, code)` (FR-20, NFR-02; QA-21's
  `status:'constructor'` case).
- **`creditsForDisplay(tool)`** — pure: reads
  `tool.accountLimits.credits` only when `scope === 'account-wide'`; a missing
  block, non-object, or status outside the five → `{ state: 'unsupported', reason: null }`
  (renders "Unavailable" with no reason sentence). Re-applies the same
  control-strip + 64-code-point bound to `balance` at render as defence in depth
  (the existing `boundedInsightLabel` regex is the same class; a dedicated
  `boundedCreditBalanceLabel` that returns `null` for empty rather than
  `'Other'` is required so an empty balance never becomes the word "Other").
  Computes `age = fmtAge(capturedAt)` when `capturedAt` is non-null (FR-23).
  Carries `sourceError = limitsDiagnostic.reason ∈ {codex-cmd-failed, no-reading}`
  for the FR-23 note — credits keep their own status under a source error (the
  reset-credit `source-error` state flip is **not** mirrored; the PRD specifies
  a note only).
- **`creditsHtml(tool, { usageLinkElsewhere })`** — emits the "Credit balance"
  sub-block:
  - `<h4 class="nested-limit-title">Credit balance</h4>` (a real heading inside
    the `aria-labelledby` group — NFR-05).
  - Status line: copy from the table; for `stale`, the existing
    `resetStatePill('stale', capturedAt)` markup (same pill class, same
    "stale · <age>" grammar) followed by `last reading: <lastStatus copy>`.
  - Balance row (FR-21): when `balance` is a non-null string →
    `Provider balance <bdi class="credit-balance-value">${esc(balance)}</bdi> · provider's own figure; not converted`;
    when `null` and status ∈ fresh/stale → `Provider balance · not reported`;
    when `unsupported` → no row.
  - Age line whenever `capturedAt` is non-null (FR-23).
  - Notes: source-error note and/or stale note (FR-23) using the existing
    `.evidence-note` / `.evidence-note.critical` classes and exact PRD copy.
  - Reason sentence for `unsupported` (FR-22); for `not-reported` also the
    pointer: plain text "Check in Claude Usage" when `usageLinkElsewhere` is
    true, else `<a class="promotion-link" href="https://claude.ai/settings/usage" rel="noopener noreferrer">Check in Claude Usage</a>` (FR-25, FR-26).
- **`globalToolGroupHtml(tool, suffix, { usageLinkElsewhere })`**:
  Codex title → `'Codex credits & resets'`; Codex body order →
  `creditsHtml(...)` then `<h4 class="nested-limit-title">Reset credits</h4>` +
  the **unchanged** `resetCreditsHtml(tool)` output, then the existing
  "Model caps" nested title and rows (FR-19). Claude body → existing model-cap
  rows/empty copy, then `creditsHtml(...)` (FR-25). The existing
  `resetCreditsHtml` function body is not edited (QA-20 pins its output).
- **`supplementaryLimitsHtml(tools, suffix, promotion)`**: computes
  `usageLinkElsewhere = Boolean(promotion) && ordered.some(claude-code)` (the
  same predicate that decides whether `promotionHtml` renders) and passes it to
  each group, so each supplementary section carries exactly one Usage anchor
  (FR-26).
- **`supplementaryToolForMembers(members, representative)`** (FR-17, FR-18):
  after choosing `resetCandidates[0]`, choose credits independently:
  ```
  creditCandidates = members.map(m => m.tool.accountLimits)
    .filter(l => l && l.scope === 'account-wide' && l.credits
                 && l.credits.status !== 'unsupported'
                 && Number.isFinite(Date.parse(l.credits.capturedAt || '')))
    .sort(newest credits.capturedAt first)
  credits = creditCandidates[0]?.credits
         ?? representative.tool.accountLimits?.credits
         ?? unsupported 'peer-omitted'
  tool.accountLimits = { ...(chosenLimits), credits }   // spread — never mutate a member's object
  ```
  Account grouping itself (`accountKey`, `groupAccounts`) is unchanged; a
  different account is a different group, so blocks never merge (FR-18).
- **Insights**: `insightAccountHtml` reduced per #6; `CREDIT_STATUS_COPY` and
  the balance fragment removed.

#### 8. Dashboard CSS — `public/styles.css`

Additive rules only, in the supplementary block (near `.reset-summary`):

```css
.credit-summary { display: flex; align-items: center; flex-wrap: wrap; gap: 7px 10px; min-width: 0; margin: -2px 0 8px; }
.credit-status { color: var(--text); font-family: var(--mono); font-size: .9rem; font-weight: 650; overflow-wrap: anywhere; }
.credit-last { color: var(--muted); font-size: .67rem; }
.credit-balance { margin: 4px 0 8px; color: var(--muted); font-size: .67rem; line-height: 1.5; overflow-wrap: anywhere; min-width: 0; }
.credit-balance-value { color: var(--text); font-family: var(--mono); unicode-bidi: isolate; overflow-wrap: anywhere; word-break: break-word; }
.credit-age { margin: 0 0 6px; color: var(--faint); font-size: .62rem; }
```

`<bdi>` already isolates; the explicit `unicode-bidi: isolate` keeps the
guarantee even if the element is swapped. `overflow-wrap: anywhere` +
`min-width: 0` on every new container is what makes a 64-code-point space-free
balance wrap inside the two-column `.supplement-grid` at 320px (NFR-06). The
stale pill reuses `.state-pill.pill-warn` (already `white-space: nowrap`; the
"stale · 3h ago" text is short and already proven at 320px by reset credits).
No inline styles; no untrusted value reaches a style attribute (NFR-02).

#### 9. README — dashboard description (FR-29)

One or two sentences in the "Capacity now" section: the Codex group shows the
provider-reported credit standing (Unlimited / Credits available / No credits,
with the provider's opaque balance and its capture age, stale past the account
TTL) beside reset credits; Claude Code does not report a credit balance and the
dashboard says so rather than showing a figure. No new health line
(`healthLines()` unchanged).

### Modified

| Where | Before | After | Risk |
|---|---|---|---|
| `codexAccountFacts()` return | `{scope, plan, credits:{available,status,balance,resetCreditsAvailable}}` | `{scope, plan}` | Low — one consumer (`getCodexInsights`), one client function (`insightAccountHtml`), one test file. The `resetCreditsAvailable` duplicate disappears with it (it was already a "do not duplicate reset credits" concern in `codex-insights-client.test.js`). |
| `toolWrap()` signature | 7 params | 8th `credits` param with honest default | Low — two call sites, both in `buildState()`. |
| `RESET_CREDIT_STATUSES` | 4 values | + `stale` | Low — widening a whitelist with a status the local producer already emits; the client's `RESET_DISPLAY_STATUSES` already accepts `stale`. |
| `normalizeResetCredits()` status | recomputed | `stale` preserved, else recomputed | Low — count/expirations logic untouched. |
| Codex supplementary title | "Codex reset credits" | "Codex credits & resets" | Low — five assertions in `tests/hosts-client.test.js` (lines ~706, 851, 908, 910, 943) update to the new string. |
| `supplementaryLimitsHtml` / `globalToolGroupHtml` | no link-ownership flag | `usageLinkElsewhere` option | Low — internal client functions. |

No SQLite modification. No change to `resetCredits` field types, enums, or
bounds (FR-02).

### Unchanged (used, not modified)

- `usage_snapshots` table and all `src/db.js` queries.
- `observeAccountFacts()`, `boundedBalance` semantics (moved, not changed),
  `clearObservedCredits()`, `observePlanType()`, `ACCOUNT_FACT_TTL_MS`,
  `ACCOUNT_FACT_HARD_CAP_MS`, `codexResetCredits()`, `codexPlanLabel()`,
  `readCodexLimits()` and the rollout fallback.
- Poller cadence and app-server call count (NFR-01); `/api/state`,
  `/api/hosts`, `/api/codex-insights` route handlers in `src/server.js`.
- `normalizeTool`, `normalizePeerState` top level, `fetchPeerState`,
  `normalizeDiagnostic`, `normalizeIso`.
- `accountKey`, `groupAccounts`, `newestRepresentative`, `accountRecords`,
  `resetCreditsForDisplay`, `resetStatePill`, `resetCreditsHtml`,
  `promotionHtml`.
- Menu-bar badge: `scripts/menubar/*` contains zero references to
  `accountLimits`, `resetCredits`, or `credits` (verified by grep);
  `computeMultiBadge`, the title/dropdown grammar, `hosts.conf` handling, and
  every badge test are byte-for-byte unchanged (NFR-07, QA-36).
- `src/health.js` `healthLines()` (FR-29).

## Migration Plan

There is no database migration. The order below keeps every intermediate commit
green and honours NFR-08 (peer whitelist and its test land together).

1. **`src/account-credits.js`** — create with the constants, `boundedCreditBalance`,
   `unsupportedCredits`. Move `boundedBalance` out of `codex-limits.js` and
   import it. Add `tests/account-credits.test.js` (sanitiser cases: QA-11
   strings, `"0"`, numeric → `undefined`, 100 → 64 code points, whitespace →
   `null`).
2. **Producer** — add `codexCredits()` to `src/codex-limits.js`; shrink
   `codexAccountFacts()` to `{scope, plan}`; add `claudeCredits()` to
   `src/claude-limits.js`. Update `tests/codex-account-facts.test.js`: the
   existing deep-equals drop `credits`; add a `codexCredits()` test block
   covering QA-04 … QA-11 with the mocked clock (the file already drives
   `codexAccountFacts(nowMs)` with offsets — reuse that pattern for TTL−1s,
   TTL+1s, 24h).
3. **Wire** — extend `toolWrap()` and `buildState()` in `src/server.js`.
   Update `tests/state-unchanged.test.js` (accountLimits deep-equal gains
   `credits`), add QA-01/QA-13/QA-17 assertions (`tests/state-diagnostics.test.js`
   or `state-unchanged`; QA-17 via `getCombined()` self host). Add the QA-03
   no-new-work assertion: a request to `/api/state` spawns nothing (the existing
   codex-limits-live / server tests already stub spawn; count must be unchanged).
4. **Peer path (one commit)** — `normalizeCredits`, `normalizeAccountLimits`,
   `unsupportedAccountLimits`, `RESET_CREDIT_STATUSES` + `stale` pass-through in
   `src/hosts.js`, **together with** `normalizePeerState`-path tests in
   `tests/hosts-degradation.test.js` covering QA-14, QA-15, QA-16 (fresh block
   canonicalised; stale without `lastStatus` → `peer-omitted`; fresh without
   `capturedAt` → `peer-omitted`; control-char balance re-stripped to 64;
   missing block / `status:'bogus'` / `reason:'bogus'` → `peer-omitted`; peer
   `resetCredits.status:'stale'` re-emitted as `stale`). Update the existing
   "legacy peers … degrade" deep-equals to include `credits: peer-omitted`.
5. **Insights** — remove the credits fragments from `insightAccountHtml` and
   `CREDIT_STATUS_COPY`; update `tests/codex-insights-client.test.js` fixtures
   (drop `account.credits`) and its three credit assertions to QA-28; add the
   QA-29 payload assertion in `tests/codex-insights.test.js`.
6. **Dashboard** — before editing, capture `resetCreditsHtml` output for each
   existing state (available / zero / partial / stale / source-error /
   unsupported / malformed) as fixture strings in a test so QA-20's
   "unchanged" clause is provable. Then add the copy tables,
   `creditsForDisplay`, `creditsHtml`, the title/order change, the
   `usageLinkElsewhere` plumbing, and the `supplementaryToolForMembers` credit
   selection. Update the five "Codex reset credits" assertions in
   `tests/hosts-client.test.js`; add tests for QA-18 … QA-27, QA-31 … QA-34 in
   `tests/hosts-client.test.js` (collapse + render) and `tests/app-copy.test.js`
   (exact copy strings), reusing the existing DOM harness those files use.
7. **CSS + mobile** — add the rules in #8; extend the existing 320/375/390/430
   containment test (the mobile-overflow feature's harness in
   `tests/dashboard-refinement.test.js` or the file that owns the viewport
   checks) with a 64-code-point space-free balance plus a stale pill (QA-35).
8. **README** (FR-29) and a final `npm test`; run the badge suites explicitly
   (`menubar*.test.js`, `qa-badge-display.test.js`) to evidence QA-36.

Rollback: every step is additive or a pure rename of client copy; reverting the
commit range restores the prior `/api/state` and `/api/codex-insights` shapes.
Peers on an older llmdash normalise to `peer-omitted` (FR-14), and a newer peer
read by an older llmdash has its `credits` key dropped by the older whitelist —
mixed-version fleets degrade honestly in both directions.

## Design Decisions

### A second reader, not a second cache
The credit standing is already observed and aged in `codex-limits.js`. Adding
`codexCredits()` beside `codexResetCredits()` reuses the same variables, the
same TTL and hard cap, and the same read-side (non-mutating) ageing. There is no
new poll, subprocess, file, or SQLite row (FR-03, NFR-01, CLAUDE.md
persistence rule). The only ingest-path edit is moving `boundedBalance` to a
shared module so the peer normaliser cannot drift from it.

### One vocabulary module shared by both trust boundaries
`src/account-credits.js` is the single home for the enum sets, the balance
sanitiser, and the unsupported factory. The local producer and the peer
normaliser import the same functions, so NFR-03's "both boundaries apply the
same stripping and bound" is structural rather than a copied regex. The client
still re-strips at render — defence in depth, as the CLAUDE.md badge rule
prescribes for compose helpers.

### Block-level ageing by newest contributing fact
The PRD ratifies FR-06/FR-07: the block's `capturedAt` is the newest of the
standing-flag and balance observation times, and the whole block moves fresh →
stale → cleared on that one clock. The standing itself comes from the retained
flags, not from the per-fact `fresh()` filter, so a stale block can honestly say
`lastStatus`. In the shipped provider response all three facts arrive together,
so the timestamps coincide; the rule only matters if a future response splits
them, and then "newest contributing" is the disclosed behaviour.

### `codexAccountFacts()` shrinks instead of the client ignoring a field
FR-28 and the brief's "single wire home" decision are honoured literally: the
insights payload stops carrying `account.credits`. Leaving it on the wire while
hiding it in the UI would be a dead field — the data-layer form of a dead knob.

### Reset-credit `stale` rides the same whitelist touch
`codexResetCredits()` already emits `status: 'stale'`, but a peer's stale reset
block was dropped to `unsupported` by `RESET_CREDIT_STATUSES`. Fixing it in the
same `src/hosts.js` change (FR-15) prevents the new credits row from sitting
beside a reset row that reads as missing when the peer actually has aged
evidence. The local clock still re-filters the count; only the label survives.

### Credits are selected independently in the account collapse
`supplementaryToolForMembers` picks reset credits by their own `capturedAt`;
credits now do the same, over the same already-grouped members (FR-17). A
member with the newest reset evidence does not drag its older credits along,
and all-unsupported members fall back to the representative's `reason`.
Grouping is untouched, so different accounts can never share a block (FR-18).

### Presentation stays in the supplementary section
Credits are an account fact, not a window measurement, so they join reset
credits and the Claude offer in the supplementary group, as three separately
headed sub-blocks (FR-19, FR-24, FR-25). The primary gauges, pacing rows, the
menu-bar badge, and `computeMultiBadge` are not touched.
