# Implementation — Usage Credit Expiry

**Feature:** usage-credit-expiry
**Stage:** 5 — The Engineer
**Built from:** strategic-brief.md, prd.md, schema.md, design-spec.md, design.html, decisions.md

## Usage Credit Expiry

### What this does
The Codex credits group in **Other global limits** now opens with a **Next reset
expiry** headline: the soonest provider-reported reset-credit expiration, with its
date, a live countdown, the reset reading's capture age, and a note when that
reset lapses before the current Codex weekly reset. The Codex **Credit balance**
gains one line, `Expiry · not reported by Codex`, carried on the wire as a new
server-stated sub-fact, `accountLimits.credits.expiry`. Every date shown is an
instant Codex reported; every absence is a reason-coded statement; nothing is
inferred.

### How to test
1. `npm test` (node:test). New and extended cases live in
   `tests/hosts-client.test.js`, `tests/codex-account-facts.test.js`,
   `tests/account-credits.test.js`, `tests/hosts-degradation.test.js`, and
   `tests/dashboard-refinement.test.js`.
2. Start a local instance on a spare port with an isolated data dir:
   `LLMDASH_PORT=8799 LLMDASH_HOST=127.0.0.1 LLMDASH_DATA_DIR=/tmp/llmdash-check LLMDASH_CLAUDE_AUTOREFRESH=0 npm start`
3. After the first Codex poll (a few seconds), `curl -s http://127.0.0.1:8799/api/state`
   shows `tools[codex].accountLimits.credits.expiry` = `{"status":"not-reported"}`.
   The Claude credits block stays the four-key unsupported shape with no `expiry`.
4. Open `http://127.0.0.1:8799/`. Under **Other global limits → Codex credits &
   resets**, the order is Next reset expiry → Credit balance → Reset credits.

### Notes for reviewer
- **Wire change is one nested key.** Fresh and stale Codex credits blocks carry
  `expiry` as exactly `{status:'not-reported'}` or
  `{status:'reported', expiresAt:<canonical ISO, strictly future>}`. Unsupported
  blocks keep their fixed four-key shape. `src/server.js`, the poller, the Codex
  spawn path, `src/db.js`, `/api/hosts`, `computeMultiBadge`, and every menu-bar
  source are untouched.
- **One home for the vocabulary.** `CREDIT_EXPIRY_STATUSES`,
  `creditExpiryNotReported()`, and `creditExpiryFromIso()` live in
  `src/account-credits.js`; both `src/codex-limits.js` and `src/hosts.js` import
  them.
- **Forward path is a seam, not evidence.** `observeAccountFacts()` reads
  `credits.expiresAt` / `credits.expires_at` (epoch seconds or ISO) by analogy to
  the provider's reset-credit naming. No live response carries it today
  (verified: the live `/api/state` reports `not-reported`). The schema flagged this
  for the Auditor; it is driven by a fake-app-server test, so it is not a dead knob.
- **Peer path.** `normalizeCredits(value, nowMs)` whitelists the sub-fact with a
  `Set.has` status check; an absent key (older llmdash), unknown or inherited-name
  status, or a past/unparseable instant degrades to `not-reported`. The
  `normalizePeerState`-path test ships in this change.
- **Client honesty.** The headline reuses `resetCreditsForDisplay` verbatim, so it
  inherits state, age, and pill; it never reuses the list's classes or the
  `Reset credits` heading literal, so the golden slice stays scoped. The weekly
  note runs the schema's guards in order and reuses `providerResetIsCurrent` on the
  raw provider `seven_day.resetsAt` (never the configured-schedule selection). A
  balance `reported` instant that has passed on the render tick is omitted, never
  relabelled. Copy for the absence goes through the own-key `CREDIT_EXPIRY_COPY`
  table.
- **Goldens.** `tests/fixtures/reset-credits-html.json` is unchanged (`git diff`
  empty) and its test passes. The new Claude credit pin
  (`tests/fixtures/claude-credit-html.json`) was captured from the pre-change
  `app.js` under the golden's fixed clock before any client edit (schema
  Migration Plan step 0) and asserted before and after the change.
- **Deliberate refinements from the approved artifacts** (all behaviour-neutral):
  1. No `observedCreditExpiresAtAtMs`. The schema lists it, but nothing reads it
     (the expiry ages with the standing's clock by design), so it would be a
     write-only variable. One variable, `observedCreditExpiresAt`, is kept and
     cleared by `clearObservedCredits()`.
  2. Added `.next-expiry-block + .credit-block-lead > .nested-limit-title {
     margin-top: 12px; }`. In the mockup the Credit balance heading sat against
     the new hairline because `.credit-block-lead` zeroes its heading margin; this
     restores the system's "12px after a hairline" rhythm (the same value
     `.credit-block-tail` uses).
  3. The balance Expiry line renders only for the Codex tool. The copy names
     Codex, so a malformed non-Codex fresh block can never claim "not reported by
     Codex". Claude's shipped block is pinned and untouched either way.
- **Existing tests adjusted because the contract intentionally changed** (no
  assertion was loosened away):
  - `tests/hosts-client.test.js`: the `creditBlock` slice helper now starts at the
    Credit balance block (it previously started at the group head, which would now
    include the headline); the identical-expirations test scopes its
    one-row-per-instant count to the list (the headline is a separate fact that
    also carries the soonest `datetime`) and now also asserts the headline's
    grouped copy; the group-order test now includes Next reset expiry first.
  - `tests/hosts-degradation.test.js`: valid peer blocks with no `expiry` key now
    normalize with `expiry: {status:'not-reported'}` (FR-16's older-peer rule).
  - `tests/codex-account-facts.test.js`: the credits key set and the stale-block
    deep-equal now include `expiry`.
- **QA-20 contract guard.** The producer's exact key-set assertion
  (`['balance','capturedAt','expiry','status']`) plus an untouched `server.js`
  prove `/api/state` differs only by `accountLimits.credits.expiry`;
  `tests/state-unchanged.test.js` needed no edit (both tools are unsupported in its
  sandbox, which carries no `expiry` key).
- **Pre-existing, unrelated failures (2).** `tests/rate-card.test.js` "tracked rate
  card validates…" and `tests/reset-billing-api.test.js` "all three fixed
  resources…" fail on this dev checkout before and after the change, identically.
  Cause: `config/api-rates.json` is hard-linked here (`nlink` 2) and the secure
  reader (`src/secure-config-file.js`) rejects multi-link files by design. Not
  touched by this feature.

### QA traceability
| QA | Where it is proven |
|---|---|
| QA-01, QA-25 | hosts-client "the Codex group reads next reset expiry, credit balance, reset credits, then model caps…" (h4 order, first sub-block, `<time datetime>`) |
| QA-02 | hosts-client "the headline shows the soonest reset date…" |
| QA-03 | hosts-client "identical reset expirations group only with their exact quantity" (headline assertions) |
| QA-04 | hosts-client "the headline shows…" (fresh) and "…inherits stale and source-error state…" |
| QA-05 | hosts-client "the headline is omitted for zero, unsupported, and malformed evidence" (+ stale-zero, source-error-zero) |
| QA-06 | hosts-client "a count without dates reads \"not reported\"…" |
| QA-07 | hosts-client "the one-second tick drops a passed instant…" |
| QA-08 | hosts-client "same-account hosts select newest…" and "different accounts keep…" (extended) |
| QA-09, QA-11 | hosts-client "the note appears when…" (exact copy, grouped copy, list not annotated) |
| QA-10 | hosts-client "the note is absent whenever any guard fails" (11 cases incl. equal instants and null freshness) |
| QA-11, QA-24 (CSS) | dashboard-refinement "named phone and desktop geometry…" (min-width/overflow-wrap, no nowrap/text-overflow/clamp, note not a callout) |
| QA-12, QA-13 | account-credits "a credit expiry is a canonical future instant…"; codex-account-facts key-set asserts and "a reported credit expiry is canonical, future-only, sparse-retained…" |
| QA-14 | codex-account-facts `neverObserved` deep-equals (24 h), state-unchanged (Claude, never-observed), hosts-client peer test (four keys on every unsupported reason) |
| QA-15 | hosts-client "…states \"Expiry · not reported by Codex\"… (QA-15 pin)" and "a reported balance expiry shows its date…" |
| QA-16 | hosts-client "the Claude credit block is pinned to its pre-change rendering…" |
| QA-17, QA-18 | hosts-client "peer credit expiry survives or degrades through normalizePeerState…"; hosts-degradation (older peer) |
| QA-19 | hosts-client "reset-credit HTML for every state is unchanged…" with the fixture unmodified |
| QA-20, QA-23 | `git diff --stat`: no server.js, poller, db.js, or menu-bar change; full suite green apart from the two pre-existing failures |
| QA-21 | README and PRODUCT_CONTEXT.md credit-expiry paragraphs |
| QA-22 | hosts-client "a reported balance expiry…" (`constructor`, `__proto__`, `toString`, hostile) and "invalid reset instants are dropped…" |
| QA-24 (rendered) | Headless Chromium against the live local server: document and body scroll widths equal the viewport at 320, 390, and 900 px for the live state, the grouped variant with a reported balance expiry, and the stale variant; no new element overflows |
| QA-26 | `grep -rn "grantedAt\|granted_at" src public` is empty; no 30-day constant touches an expiry |

### Verification performed
- `npm test`: 929 tests, 925 pass, 2 fail (the pre-existing rate-card pair above),
  2 skipped. Baseline before the change: 915 tests, 911 pass, the same 2 fail, 2
  skipped.
- `~/.weft/bin/weft-design-lint check public/`: clean, 0 findings.
- Live local server (port 8799, isolated data dir, auto-refresh off):
  `/api/state` Codex `accountLimits.credits.expiry` = `{"status":"not-reported"}`;
  rendered page shows Next reset expiry (Oct 4, 9:19 PM PDT, expires in 2d 0h,
  updated 16s ago, plus the weekly-reset note since the reset precedes the Oct 9
  weekly reset), then Credit balance with `Expiry · not reported by Codex`, then
  the unchanged Reset credits list; the Claude group has no expiry text. Server
  stopped afterwards.

## Seeing Usage Credit Expiry locally

1. Open a terminal in your project folder (`/Users/developer/devwork/llmdash`).

2. Start the dashboard on a spare port so it does not clash with the installed
   service:
   `LLMDASH_PORT=8799 LLMDASH_HOST=127.0.0.1 npm start`

3. Wait about ten seconds for the first Codex reading, then open your browser and
   go to:
   http://127.0.0.1:8799/

4. Scroll to the **Other global limits** band, just below the four account gauges,
   and find the right-hand group headed **▲ Codex credits & resets**.

5. What to look for:
   - The group now starts with **NEXT RESET EXPIRY**: a date in your timezone,
     "expires in …" counting down every second, and "updated … ago".
   - If that reset lapses before your Codex weekly window turns over, a sentence
     below it reads **Expires before your Codex weekly reset.** followed by when
     the weekly window resets.
   - Under **CREDIT BALANCE**, a new line reads **Expiry · not reported by Codex**.
   - **RESET CREDITS** below looks exactly as before.
   - The Claude group on the left shows no expiry line at all.
   - On a phone (or a narrow browser window), everything wraps with no sideways
     scrolling.

6. When you are done, press Ctrl+C in the terminal to stop it.

## Convention Flags
- **Disclosed-absence sub-facts.** When a provider does not report a fact the UI
  would naturally show next to a figure (here, a credit-balance expiry), the
  producer emits an enum sub-object (`{status:'not-reported'}`) rather than
  omitting the key; the enum, factory, and the one future-only ISO normalizer live
  in the shared module both trust boundaries import; the peer whitelist degrades
  an absent key (older peer), unknown status, or invalid instant to the absence;
  and the client omits, never relabels, a reported value that becomes invalid on
  the render tick.
- **A summary promoted out of a golden-pinned block reuses that block's display
  function verbatim and never its markup.** The Next reset expiry headline calls
  `resetCreditsForDisplay` (inheriting state, age, and pill) but uses its own
  class names and heading, so the golden's slice anchor
  (`<h4 …>Reset credits</h4>`) and its placeholder regex
  (`<time class="expiry-date"`) stay scoped to the list.
