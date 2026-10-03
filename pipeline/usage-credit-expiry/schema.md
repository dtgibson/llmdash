# Schema — Usage Credit Expiry
**Feature:** usage-credit-expiry
**Stage:** 3 — The Architect
**Source:** prd.md (approved), strategic-brief.md (Evidence Inventory is the provider-data verdict)
**Store:** none added. SQLite is unchanged; every expiry fact stays a bounded in-memory account fact.

## Path
Incremental. The project has a shipped SQLite store and thirty-plus prior
`schema.md` files, and this feature changes the `/api/state` wire contract
(additive `accountLimits.credits.expiry`) and the `src/hosts.js` peer
normalizer. Nothing new is persisted, so the data-layer half of this file is
"no change", but the project's conventions treat a `/api/state` field addition
as a contract change that ships with the peer whitelist and a
`normalizePeerState`-path test in the same commit (CLAUDE.md, Multi-source) — a
structural change the Engineer, Tester, and Auditor must see, exactly as the
2026-10-01 `available-api-credits` schema classified the parent field. Not
Frontend Only. Running hands-off, the path is declared here and proceeded on.

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

**No database changes.** `src/db.js` is not edited; no table, column, index,
row, or query is added or changed. Reason: an expiry instant is a current
account entitlement fact, the same class as the reset-credit expirations and
the credit standing — DECISIONS.md 2026-07-30 ("retain only the bounded
available count, every explicit unexpired expiration, and the original
observation time in process memory"; persisting short-lived entitlements
"would create misleading history") and CLAUDE.md ("persist only what has no
other history … time-limited provider entitlements … stay bounded in memory").
The owner-managed `account-config.json`, `subscriptions.json`, `hosts.conf`,
the captured provider files, and the badge's runtime files are untouched.

### In-memory account facts (`src/codex-limits.js`) — the single producer

Already shipped and reused verbatim:

| Variable | Meaning | Written by |
|---|---|---|
| `observedCreditUnlimited` / `…AtMs` | last `credits.unlimited` + time | `observeAccountFacts()` |
| `observedHasCredits` / `…AtMs` | last `credits.hasCredits` + time | `observeAccountFacts()` |
| `observedCreditBalance` / `…AtMs` | last bounded balance string + time | `observeAccountFacts()` |
| `observedResetCreditsSnapshot` / `observedResetCreditsAtMs` | `{ availableCount, expirations[], observedAtMs }` — the per-reset `expiresAt` instants, ISO, sorted ascending, ≤128, bounded to the count | `observeAccountFacts()` → `normalizeResetCreditsObservation()` |
| `observedPlanType` / `observedPlanAtMs` | plan tier | `observePlanType()` |

Bands: `ACCOUNT_FACT_TTL_MS` = clamp(5 min … 30 min, 5 × poll) → fresh;
`ACCOUNT_FACT_HARD_CAP_MS` = 24 h → cleared on read. `clearObservedCredits()`
clears every credit variable on a recognised plan change or an unknown plan.

**New in this feature (one pair, same discipline):**

| Variable | Meaning | Written by |
|---|---|---|
| `observedCreditExpiresAt` (ISO string \| `null`) / `observedCreditExpiresAtAtMs` | last provider-reported credit-balance expiry instant + time | `observeAccountFacts()` — see *Added §2* |

Today the provider's `credits` object carries exactly `hasCredits / unlimited /
balance` (brief, Evidence Inventory), so this pair is never written in
production and `codexCredits()` emits `not-reported`. It exists because FR-12 /
QA-13 require the forward path to be real and testable through the fake
app-server harness (`tests/codex-account-facts.test.js` drives the producer
only via `LLMDASH_FAKE_CODEX_RESPONSE`), not as a dead knob: the path is
exercised by a shipped test and its absence is disclosed on the wire.

### `/api/state` — `tools[].accountLimits` after this feature

```
accountLimits = {
  scope: 'account-wide',                      // unchanged
  resetCredits: <unchanged shape>,            // available/zero/partial/stale/unsupported; expirations[] ISO
  credits: <one of the shapes below>,         // the ONLY change is the nested `expiry`
}
```

**Exact `credits` shapes (no other keys are ever present):**

| Band | Shape |
|---|---|
| fresh | `{ status: 'unlimited'\|'available'\|'none', balance: string\|null, capturedAt: ISO, expiry: <Expiry> }` |
| stale | `{ status: 'stale', lastStatus: 'unlimited'\|'available'\|'none', balance: string\|null, capturedAt: ISO, expiry: <Expiry> }` |
| unsupported | `{ status: 'unsupported', reason: 'never-observed'\|'not-reported'\|'peer-omitted', balance: null, capturedAt: null }` — **no `expiry` key** (FR-13) |

**`<Expiry>` — the new sub-fact, exactly one of two shapes:**

| `status` | Shape | Meaning |
|---|---|---|
| `'not-reported'` | `{ status: 'not-reported' }` — **exactly one key** | The provider's credit shape carries no expiry instant (today: always, for Codex). |
| `'reported'` | `{ status: 'reported', expiresAt: ISO }` — **exactly two keys** | A provider-reported credit-balance expiry, canonical `toISOString()` output, **strictly in the future at read time**. |

Field rules:

- `expiry` is present on **every** fresh and stale credits block and on **no**
  unsupported block. Present ⇒ a plain object with exactly the keys above.
- `expiresAt` is present **only** when `status === 'reported'`; it is never
  `null`, never a bare `Date.parse`-validated input string, always
  `new Date(ms).toISOString()`.
- **Future-only rule:** at every read (producer `codexCredits(nowMs)`, peer
  `normalizeCredits(value, nowMs)`), a `reported` instant with
  `Date.parse(expiresAt) <= nowMs` becomes `{ status: 'not-reported' }`. A
  passed expiry is not a current expiry (PRD Open Question 3 default).
- **Never "now":** an unparseable or missing instant degrades to
  `not-reported`; `expiresAt` is never defaulted to the current time (FR-12,
  QA-13 last clause; CLAUDE.md timestamp rule).
- The expiry sub-fact has **no clock of its own on the wire**: it ages with the
  credits block it rides on (`credits.capturedAt`, TTL → `stale`, 24 h → block
  becomes unsupported and the key disappears).

Everything else in the tool object (`source`, `label`, `plan`, `haveLimits`,
`limits`, `modelLimits`, `projection`, `activity`, `dataAt`, `freshness`,
`limitsDiagnostic`) and every top-level state key is byte-for-byte unchanged
(FR-19). `tests/state-unchanged.test.js` line 111 (`accountLimits` deep-equal on
a fresh process) **needs no edit**: both tools are `unsupported` there, which
carries no `expiry` key.

## Changes in This Feature

### Added

#### 1. `src/account-credits.js` — the expiry vocabulary, one home

Pure, dependency-free. Shared by the local producer and the peer normalizer so
enum, shape, and factory have exactly one definition (QA-12 requires both
`src/codex-limits.js` and `src/hosts.js` to import from here).

```js
export const CREDIT_EXPIRY_STATUSES = new Set(['not-reported', 'reported']);

// The disclosed absence. A function (not a shared constant) so every block
// gets a detached object, matching unsupportedCredits().
export function creditExpiryNotReported() {
  return { status: 'not-reported' };
}

// The one normalizer for a candidate expiry instant that is already an ISO
// (or ISO-parseable) string: canonical ISO, strictly future, else not-reported.
// Never defaults to now. Both trust boundaries call this.
export function creditExpiryFromIso(value, nowMs) {
  if (typeof value !== 'string') return creditExpiryNotReported();
  const ms = Date.parse(value);
  const now = Number(nowMs);
  if (!Number.isFinite(ms) || !Number.isFinite(now) || ms <= now) return creditExpiryNotReported();
  return { status: 'reported', expiresAt: new Date(ms).toISOString() };
}
```

`unsupportedCredits()`, `CREDIT_STATUSES`, `CREDIT_FRESH_STATUSES`,
`CREDIT_REASONS`, `boundedCreditBalance()` are unchanged — the four-key
unsupported shape test (`tests/account-credits.test.js` line 21) must keep
passing untouched (QA-14).

The provider's **epoch-seconds** convention is deliberately *not* in this
module: converting Codex's numeric instants is the provider reader's job
(`resetExpirationIso()` in `src/codex-limits.js` already does it for reset
credits), and the shared module stays provider-neutral over ISO strings.

#### 2. Producer — `src/codex-limits.js`

**Ingest (`observeAccountFacts`)**, inside the existing
`if (credits && typeof credits === 'object' && !Array.isArray(credits))` block,
after the balance:

```
raw = credits.expiresAt ?? credits.expires_at
iso = typeof raw === 'number' ? resetExpirationIso(raw)      // epoch seconds, like every Codex instant
    : typeof raw === 'string' ? toIso(raw)                     // already imported from ./claude-limits.js: Date.parse → toISOString, else null
    : undefined                                               // absent → sparse: retain prior
if (iso !== undefined) { observedCreditExpiresAt = iso; observedCreditExpiresAtAtMs = observedAtMs; }
```

- Key names `expiresAt` / `expires_at` are **by analogy** to the provider's
  own `rateLimitResetCredits.credits[].expiresAt` (camel/snake accepted exactly
  as the reset path does). They are not evidence of a future field — the brief
  shows the shape has none. Flagged below for the Auditor.
- A present-but-unparseable value stores `null` (an explicit "could not read"
  that renders `not-reported`), never the prior value and never now.
- `clearObservedCredits()` also resets `observedCreditExpiresAt = undefined;
  observedCreditExpiresAtAtMs = null;` (plan change / unknown plan clears it
  with the rest of the credit facts).
- The rollout-file fallback never calls `observeAccountFacts()`, so it never
  writes this pair (unchanged).

**Reader (`codexCredits(nowMs)`)** — the two non-unsupported returns gain the
key; the two `unsupportedCredits('never-observed')` returns do not:

```js
const expiry = creditExpiryFromIso(observedCreditExpiresAt ?? null, at);   // not-reported today
return ageMs > ACCOUNT_FACT_TTL_MS
  ? { status: 'stale', lastStatus: standing, balance, capturedAt, expiry }
  : { status: standing, balance, capturedAt, expiry };
```

`at` is the already-coerced clock (`Number(nowMs)`, `Date.now()` fallback), so
the mocked-clock tests drive the future-only rule. The expiry's own observation
time (`observedCreditExpiresAtAtMs`) does **not** join the block's
`capturedAtMs = max(...)`: an expiry instant is a statement about the future,
not an evidence clock for the standing, and FR-13's "aged past 24 h → no key"
must follow the standing's clock. (If a provider ever reports the field, the
three flags and the expiry arrive in the same `credits` object per poll, so
the clocks coincide in practice.)

No file read, subprocess, poll, or request-path work is added (NFR-01, QA-23).

#### 3. Server — `src/server.js`

**No code change.** `toolWrap()` already passes the `codexCredits(nowMs)` /
`claudeCredits()` object through to `accountLimits.credits`; the nested key
rides along. `claudeCredits()` in `src/claude-limits.js` is unchanged
(`unsupportedCredits('not-reported')`, no expiry key — FR-15).

#### 4. Peer normalizer — `src/hosts.js`

`normalizeCredits` gains a clock and whitelists the sub-fact (FR-16):

```js
export function normalizeCredits(value, nowMs = Date.now()) {
  // steps 1–3 unchanged: not plain / status outside CREDIT_STATUSES → peer-omitted;
  // unsupported → unsupportedCredits(reason|peer-omitted) (NO expiry key);
  // capturedAt not a valid ISO → peer-omitted.
  const expiry = normalizeCreditExpiry(value.expiry, nowMs);
  if (value.status === 'stale') { …; return { status: 'stale', lastStatus, balance, capturedAt, expiry }; }
  return { status: value.status, balance, capturedAt, expiry };
}

function normalizeCreditExpiry(value, nowMs) {
  if (!isPlainObject(value) || !CREDIT_EXPIRY_STATUSES.has(value.status)) return creditExpiryNotReported();
  if (value.status === 'not-reported') return creditExpiryNotReported();
  return creditExpiryFromIso(value.expiresAt, nowMs);      // reported: re-parse, canonical ISO, strictly future
}
```

- `normalizeAccountLimits(value, nowMs)` passes its existing `nowMs` through:
  `credits: normalizeCredits(value.credits, nowMs)`. `unsupportedAccountLimits()`
  is unchanged (`peer-omitted`, no key).
- Accept/degrade table (every row has a QA-17 case):

| Peer `expiry` | Result |
|---|---|
| `{ status: 'not-reported' }` | `{ status: 'not-reported' }` |
| `{ status: 'reported', expiresAt: <future, parseable> }` | `{ status: 'reported', expiresAt: <canonical ISO> }` |
| `reported` with past, unparseable, non-string, or missing `expiresAt` | `{ status: 'not-reported' }` |
| unknown `status` (incl. `'constructor'`, `'__proto__'`) | `{ status: 'not-reported' }` — a `Set.has` lookup, never a bracket lookup |
| key absent (older llmdash peer), `null`, array, non-object | `{ status: 'not-reported' }` (PRD Open Question 2 default) |
| any of the above on a peer `unsupported` block | no `expiry` key at all |

- Extra keys on the peer `expiry` object are dropped (whitelist, never spread).
  A valid peer `capturedAt` is still preserved as-is (clock skew intact).
- `normalizeDiagnostic`, `RESET_CREDIT_STATUSES`, `normalizeResetCredits`,
  `normalizeTool`, `normalizePeerState` top level, `fetchPeerState`: unchanged.

#### 5. Dashboard — `public/app.js`

Everything here is a pure presentation regroup over the existing payload
(`tool.accountLimits.resetCredits`, `tool.accountLimits.credits`,
`tool.limits.seven_day`, `tool.freshness`, `tool.limitsDiagnostic`). No new
fetch, no new field read from the server beyond `credits.expiry`.

**5a. Derived view model — `nextExpiryForDisplay(tool, nowMs = Date.now())`**

Inputs: `reset = resetCreditsForDisplay(tool, nowMs)` (already applies the
local-clock future filter, the `stale-reading` → `stale` and
`codex-cmd-failed` / `no-reading` → `source-error` overrides, and bounds to
128 / count), plus `tool.limits.seven_day`, `tool.freshness`,
`tool.limitsDiagnostic`.

```
if reset.state ∈ {unsupported, malformed}            → null   // FR-04
if reset.availableCount === 0                         → null   // FR-04 `zero`, also a stale/source-error block with 0 available
soonest = reset.expirations[0] ?? null                        // ascending, future-only by construction
quantity = soonest ? count of leading expirations === soonest : 0   // the list's grouping rule (FR-02)
pill = reset.state ∈ {stale, source-error} ? resetStatePill(reset.state, reset.capturedAt)   // FR-03
     : (!soonest && reset.state === 'partial') ? resetStatePill('partial')                 // FR-05
     : ''
age = fmtAge(reset.capturedAt)                                // "updated 3m ago" (FR-03)
weeklyNote = (see 5b) — null unless every guard passes
return { state: reset.state, capturedAt: reset.capturedAt, soonest, soonestMs, quantity, pill, age, weeklyNote }
```

Selection rule: `expirations[0]` — the array is already sorted ascending and
filtered to `> nowMs` by `resetCreditsForDisplay`, so the first element *is* the
soonest future instant and a passed instant can never be selected (FR-06). The
live countdown comes for free from the existing 1 s `render()` tick
(`setInterval(() => { if (state) render(); }, 1000)`); `nowMs` must be read
once per render call and passed down, never captured at load.

Freshness inheritance (US-05, NFR-05): the headline has **no freshness logic of
its own** — `state`, `capturedAt`, and the pill come from the reset block's
display state. The credit-balance block keeps its separate `credits.capturedAt`
clock; the two are never merged.

**5b. The two-instant comparison (FR-08 / FR-09)** — compute only when *all*
guards hold, in this order; the first failure returns `null` (no note):

1. `soonest` is present (a `partial`/no-date headline never gets a note).
2. `reset.state ∈ {available, partial}` (not `stale`, not `source-error`).
3. `win = tool.limits && tool.limits.seven_day`; `win` is an object and
   `typeof win.resetsAt === 'string'` (omitted window / missing field → null).
4. `weeklyMs = Date.parse(win.resetsAt)`; finite and `> nowMs`.
5. Currency — the existing provider-reset rule, i.e. exactly what
   `providerResetIsCurrent(tool, weeklyMs)` checks: `ageBand(tool.freshness)`
   is neither `null` nor `'stale'`, and `limitsDiagnostic.reason !== 'stale-reading'`.
   Reuse `providerResetIsCurrent` directly (it reads `Date.now()`, which the
   test harness's `DateImpl` controls) rather than re-deriving the predicate.
6. `soonestMs < weeklyMs` — **strictly** earlier; equal or later → null.

Result: `{ weeklyMs }`. Copy (FR-10): `"${quantity > 1 ? `${quantity} resets expire` : 'Expires'} before your Codex weekly reset (in ${fmtDur(weeklyMs - nowMs)})."`
— plain block text, wraps, never truncated; applies to the soonest only; no
list item is annotated. Nothing about the weekly reset is inferred, defaulted,
or taken from a configured schedule or another window/host (configuration is
never eligible for Codex — `dashboardWindowReset` already encodes that; the
note reads the raw provider `resetsAt`, not the dashboard selection, so the
`/api/config` reset view is never consulted).

**5c. Headline markup — `nextExpiryHtml(tool, nowMs)`**, rendered **first** in
the Codex body of `globalToolGroupHtml`, before the `credit-block-lead` div:

```
<div class="next-expiry-block">
  <h4 class="nested-limit-title">Next expiry</h4>                       // same level as "Credit balance" (NFR-03)
  <div class="next-expiry-summary">
    [soonest]  <time class="next-expiry-date" datetime="${esc(iso)}">${esc(resetExpirationLabel(iso))}</time>
               <span class="next-expiry-relative">${esc(`${quantity > 1 ? `${quantity} resets expire` : 'expires'} in ${fmtDur(soonestMs - nowMs)}`)}</span>
    [no date]  <span class="unavailable-metric">not reported</span>     // FR-05: no <time>, no countdown
    ${pill}
  </div>
  <p class="next-expiry-age">${esc(age)}</p>
  [note]     <p class="next-expiry-note">${esc(noteCopy)}</p>
</div>
```

- Date formatter: `resetExpirationLabel(iso)` (the list's `Intl.DateTimeFormat`
  call) — identical text to the list for the same instant (QA-02). If it returns
  `null`, render the no-date branch (no raw ISO leaks as a label).
- Duration formatter: `fmtDur` (QA-02 expects `expires in 1h 0m`).
- New class names (`next-expiry-*`) rather than reusing `.expiry-date` /
  `.expiry-item`: those are bound to the list's two-column grid, and the
  golden regex in `tests/hosts-client.test.js` targets `<time class="expiry-date"`
  — keeping the headline's `<time>` on a different class keeps the golden's
  placeholder substitution scoped to the list.
- The headline HTML must not contain the literal
  `<h4 class="nested-limit-title">Reset credits</h4>`: the test harness's
  `resetBlock()` slices from that string's first occurrence (FR-18 depends on
  the slice landing on the real list).
- The stale / source-error explanatory sentences are **not** repeated here
  (FR-03; the Reset credits sub-block owns them — QA-04 counts one occurrence
  per group).

**5d. Credit-balance expiry line — `creditsForDisplay` / `creditsHtml`**

```js
const CREDIT_EXPIRY_COPY = Object.freeze({ 'not-reported': 'Expiry · not reported by Codex' });
```

`creditsForDisplay(tool)` (fresh/stale branch only) adds:

```
e = raw.expiry
expiry = (e && typeof e === 'object' && !Array.isArray(e) && ownKey(CREDIT_EXPIRY_COPY, e.status))
           ? { status: 'not-reported' }
       : (e && typeof e === 'object' && !Array.isArray(e) && e.status === 'reported'
          && typeof e.expiresAt === 'string' && Number.isFinite(Date.parse(e.expiresAt))
          && Date.parse(e.expiresAt) > nowMs)
           ? { status: 'reported', expiresAt: new Date(Date.parse(e.expiresAt)).toISOString() }
       : null                                                    // omit the line (FR-14)
```

`creditsHtml` renders, after the `credit-balance` row and before the
`credit-age` line:

- `not-reported` → `<p class="credit-expiry">Expiry · not reported by Codex</p>`
- `reported` → `<p class="credit-expiry">Expiry <time class="credit-expiry-date" datetime="${esc(iso)}">${esc(resetExpirationLabel(iso))}</time> · expires in ${esc(fmtDur(ms - nowMs))}</p>`
- `null` → nothing. This is the branch for an absent key, a status outside the
  own-key table (`'constructor'`, `'__proto__'`, `'toString'` — QA-22), **and**
  a `reported` instant that has passed on the render tick: "not reported by
  Codex" would be false for a reported instant, and the standing itself
  (`none` / `stale`) carries the current state, so the line is omitted rather
  than relabelled. No raw code ever reaches the DOM.
- The `unsupported` branch of `creditsHtml` is **not** touched: Claude's block
  renders exactly as before (FR-15, QA-16).

**5e. Multi-host collapse — `supplementaryToolForMembers`: no change.** The
headline reads the collapsed tool's `accountLimits.resetCredits` (already the
newest valid capture of the account, chosen by `resetCandidates[0]`), and the
weekly `resetsAt` from the representative's `limits` (same account ⇒ same
window epochs by the `accountKey` definition). `credits.expiry` rides inside
the whole `credits` object the existing selector already copies
(`creditCandidates[0].credits`). Different accounts remain different groups
(FR-07, QA-08).

#### 6. Dashboard CSS — `public/styles.css`

Additive rules only, beside `.credit-block` (line ~673). Every new container
gets `min-width: 0` and `overflow-wrap: anywhere`; none gets `white-space:
nowrap`, `text-overflow`, or a `title`-only payload (QA-11, NFR-04):

```css
.next-expiry-block { min-width: 0; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
.next-expiry-block > .nested-limit-title { margin-top: 0; }
.next-expiry-summary { display: flex; align-items: center; flex-wrap: wrap; gap: 7px 10px; min-width: 0; margin: -2px 0 6px; }
.next-expiry-date { display: block; min-width: 0; color: var(--text); font-family: var(--mono); font-size: 0.9rem; font-weight: 650; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.next-expiry-relative { display: block; color: var(--muted); font-size: 0.67rem; overflow-wrap: anywhere; }
.next-expiry-age { margin: 0 0 6px; color: var(--faint); font-size: 0.62rem; font-variant-numeric: tabular-nums; }
.next-expiry-note { margin: 6px 0 0; color: var(--text); font-size: 0.67rem; line-height: 1.5; overflow-wrap: anywhere; min-width: 0; }
.credit-expiry { min-width: 0; margin: 0 0 6px; color: var(--muted); font-size: 0.67rem; line-height: 1.5; overflow-wrap: anywhere; }
.credit-expiry-date { color: var(--text); font-family: var(--mono); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
```

Since `.credit-block-lead` already draws the divider under the balance block,
the headline block draws its own above it; The Designer may restyle, but the
`min-width: 0` / `overflow-wrap: anywhere` / no-`nowrap` invariants are the
mobile contract. No inline styles; no untrusted value reaches a style
attribute.

#### 7. Disclosure — README and `PRODUCT_CONTEXT.md` (FR-20)

Extend the existing credit paragraphs (README line ~37; `PRODUCT_CONTEXT.md`
lines ~14–19 and ~217–224) with: Codex reports per-reset expirations only, so
the dashboard headlines the soonest; the Codex credit balance carries no
expiry and is disclosed as "not reported by Codex"; Claude Code reports
neither a credit balance nor an expiry on any sanctioned local channel, and no
expiry is ever inferred from grant times, the observed 30-day pattern, usage,
plan, or billing period. No `healthLines()` change (nothing is missing that a
user could fix).

### Modified

| Where | Before | After | Risk |
|---|---|---|---|
| `codexCredits()` fresh/stale return | 3 / 4 keys | + `expiry` | Low — additive; the two unsupported returns unchanged. `tests/codex-account-facts.test.js` deep-equals on fresh/stale blocks gain `expiry: { status: 'not-reported' }`. |
| `observeAccountFacts()` | reads `unlimited / hasCredits / balance` | + optional `expiresAt`/`expires_at` (sparse) | Low — no field in production responses today; flagged as by-analogy naming. |
| `clearObservedCredits()` | clears 8 vars | clears 10 | Low. |
| `normalizeCredits(value)` | no clock | `(value, nowMs = Date.now())`, + `expiry` on fresh/stale | Low — one call site (`normalizeAccountLimits`), already has `nowMs`. |
| `creditsForDisplay` / `creditsHtml` | no expiry | `expiry` view + one line in the fresh/stale branch | Low — the `unsupported` branch (Claude) is not edited; pin fixture proves it. |
| `globalToolGroupHtml` Codex body | credit-block → Reset credits → Model caps | **Next expiry** → credit-block → Reset credits → Model caps | Low — `resetCreditsHtml` body not edited; golden proves it. |

No SQLite modification. No change to `resetCredits` field types, enums,
bounds, or selection (FR-07, FR-19).

### Unchanged (used, not modified)

- `usage_snapshots` and every `src/db.js` query; the poller cadence and
  app-server call count; `src/server.js` (`toolWrap`, `buildState`, routes);
  `src/claude-limits.js` `claudeCredits()`.
- `codexResetCredits()`, `normalizeResetCreditsObservation()`,
  `resetExpirationIso()` (reused, not edited), `ACCOUNT_FACT_TTL_MS`,
  `ACCOUNT_FACT_HARD_CAP_MS`, `codexPlanLabel()`, `codexAccountFacts()`.
- `normalizeResetCredits`, `RESET_CREDIT_STATUSES`, `normalizeDiagnostic`,
  `normalizeTool`, `normalizePeerState`, `fetchPeerState`, `normalizeIso`.
- `resetCreditsForDisplay`, `resetStatePill`, `resetExpirationLabel`,
  `resetExpiryRows`, `resetCreditsHtml` (reused; **bodies not edited**),
  `providerResetIsCurrent`, `dashboardWindowReset`, `ageBand`, `fmtDur`,
  `fmtAge`, `esc`, `accountKey`, `groupAccounts`,
  `supplementaryToolForMembers`, the primary gauges and pacing rows.
- Menu-bar badge: `scripts/menubar/*` has no reference to `accountLimits`,
  `resetCredits`, or `credits`; `computeMultiBadge`, every badge output and
  fixture, `hosts.conf` handling (FR-19, QA-20). `/api/hosts` route and
  top-level contract (the nested key rides inside the already-whitelisted
  credits block of the re-served peer state).

## Migration Plan

There is no database migration. Order keeps every intermediate commit green
and honours FR-17 (peer whitelist and its test land together) and FR-18 /
QA-16 (goldens captured **before** the client edit).

0. **Capture the Claude pin fixture first, from the pre-change `app.js`.**
   Render the Claude `creditsHtml` for `unsupportedCredits('not-reported')`
   with `usageLinkElsewhere` true and false, under `controlledClock`, into
   `tests/fixtures/claude-credit-html.json`; add the asserting test to
   `tests/hosts-client.test.js` next to the QA-20 golden (same slice/compare
   pattern via `claudeGroup()`). Confirm the existing reset golden passes.
1. **`src/account-credits.js`** — add `CREDIT_EXPIRY_STATUSES`,
   `creditExpiryNotReported()`, `creditExpiryFromIso()`. Extend
   `tests/account-credits.test.js`: future ISO → canonical reported; past,
   equal-to-now, unparseable, non-string, `undefined` → not-reported; result
   never equals `new Date(nowMs).toISOString()`; the four-key unsupported test
   untouched (QA-14).
2. **Producer** — `observeAccountFacts` ingest pair, `clearObservedCredits`,
   `codexCredits` key. Extend `tests/codex-account-facts.test.js` via the fake
   app-server: QA-12 (`unlimited` / `available` / `none` / `stale` each carry
   `{ status: 'not-reported' }`), QA-13 (a response whose `credits.expiresAt`
   is a future epoch → `reported` canonical ISO; a past epoch, a garbage
   string → `not-reported`; a response omitting the field after one that
   carried it retains the prior observation; a plan change clears it), and the
   24 h case (block unsupported, no key).
3. **Peer** — `normalizeCredits(value, nowMs)` + `normalizeCreditExpiry`,
   `normalizeAccountLimits` pass-through. **Same commit:** QA-17 unit rows and
   the QA-18 `normalizePeerState`-path test in `tests/hosts-client.test.js`
   (it already owns `renderWith`, `controlledClock`, `stateOf`, and the
   `status: 'constructor'` credits case at line ~928): one full peer payload
   through `normalizePeerState`, every accept/degrade row asserted on
   `tools[].accountLimits.credits.expiry`, then the normalized state rendered
   and matched against the local-block headline and the
   "Expiry · not reported by Codex" line.
4. **Client + CSS** — 5a–5d, §6. Tests in `tests/hosts-client.test.js` under
   `controlledClock(NOW)` with `NOW = Date.UTC(2026, 9, 1, 12, 0, 0)` (the
   golden's clock): QA-01 ordering (`indexOf` of the three `<h4>`s), QA-02
   `<time class="next-expiry-date" datetime="…">` + `expires in 1h 0m`, QA-03
   grouping, QA-04 pills and single-occurrence sentences, QA-05 omission
   (`doesNotMatch /Next expiry/`, no `next-expiry-date`, no `—`), QA-06,
   QA-07 (`clock.set(NOW + 2h)` then re-render), QA-08 collapse, QA-09/10 the
   note matrix (eight negative cases), QA-11 (regex over `styles.css`: the
   `next-expiry-note` rule has no `nowrap` / `text-overflow`; note text absent
   from every `<li class="expiry-item">`), QA-15 pin (`Expiry · not reported by
   Codex` literal; `reported` +30 d → `expires in 30d 0h`; absent /
   `'constructor'` → no `credit-expiry` element), QA-16 Claude pin, QA-19
   reset golden unchanged (`git diff --quiet tests/fixtures/reset-credits-html.json`),
   QA-22 proto keys + a `<`/`"` expiration string dropped before render,
   QA-24 CSS invariants on every new class (mirror
   `tests/dashboard-refinement.test.js` style), QA-25 heading level and
   `<time datetime>`.
5. **Contract guard** — in `tests/state-unchanged.test.js` (or
   `state-diagnostics`): with observed Codex credits, the tool object's key set
   and every `accountLimits` key except `credits.expiry` deep-equal the
   pre-change build (QA-20's "differs only by `accountLimits.credits.expiry`").
6. **Docs** — README, `PRODUCT_CONTEXT.md` (QA-21). `grep -rn "grantedAt\|granted_at"
   src public` stays empty of any new read; no 30-day constant touches an
   expiry (QA-26).

## Design Decisions

- **Incremental, not Frontend Only.** No persistence changes, but the
  `/api/state` contract and the peer whitelist change; the project treats that
  as structural (precedent: `pipeline/available-api-credits/schema.md`).
- **Two statuses only; `reported` is a real shape today.** `CREDIT_EXPIRY_STATUSES`
  = `{not-reported, reported}`. No `expired`, no `peer-omitted` expiry status
  (PRD Open Questions 2 and 3): a passed instant is not a current expiry, and
  "not reported" is true for every Codex host regardless of llmdash version.
  Revisit only when a provider actually reports the field.
- **The shared factory is ISO-only; epoch-seconds conversion stays with the
  provider reader.** `creditExpiryFromIso` is provider-neutral and both
  boundaries call it; `resetExpirationIso` already owns Codex's numeric
  convention. One normalizer per trust boundary, one definition of "future".
- **The expiry has no wire clock of its own.** It ages with the credits block
  (`capturedAt`, TTL, 24 h cap). A separate `expiryCapturedAt` would be a second
  age for a fact that today is a constant absence; adding one when a provider
  reports the field is additive.
- **Forward-compatible ingest reads `credits.expiresAt`/`expires_at` by analogy
  to the provider's reset-credit naming.** FR-12 / QA-13 require a real,
  testable path through the fake app-server; the only way to drive it is a
  provider key, and no such key exists today. The name is a seam, not
  evidence — **flag for the Auditor**: if the team prefers zero speculative
  field reads, the alternative is to drop the ingest pair and test only
  `creditExpiryFromIso`, accepting that QA-13's "driving the producer" clause
  then holds at the function level rather than the response level.
- **Client re-validates `reported` on every render tick and omits (never
  relabels) a passed instant.** The server and peer guarantee future-only at
  their read time; between fetches an instant can pass. Omission is the honest
  branch FR-14 already defines for "not renderable"; "not reported by Codex"
  would be false for an instant Codex did report.
- **Headline freshness = reset reading's freshness, structurally.** The view
  model consumes `resetCreditsForDisplay`'s state verbatim and adds no clock
  logic; `partial`-with-no-date is the only case that shows the `partial` pill
  (FR-05), and a `stale`/`source-error` block with zero available instants is
  omitted like `zero` (its `availableCount` is 0; the Reset credits sub-block
  already says so with its pill).
- **The weekly comparison reuses `providerResetIsCurrent` and the raw provider
  `resetsAt`, never `dashboardWindowReset`'s selection.** The dashboard
  selection can fall through to a *configured* schedule for Claude; Codex is
  never eligible, and the note must never consult configuration (FR-09).
- **Goldens are captured pre-change or not at all.** The reset golden already
  exists and is asserted unmodified; the Claude credit pin is captured from the
  pre-change `app.js` in step 0 — never regenerated from the post-change code
  (the "inspection is not proof" rule, `tests/fixtures/reset-credits-html.json`
  precedent).
