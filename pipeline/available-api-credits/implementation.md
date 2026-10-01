# Implementation — Available API Credits

**Feature:** available-api-credits
**Stage:** The Engineer (New Feature lane)
**Date:** 2026-10-01
**Status:** implemented in the working tree; not committed, pushed, or deployed.

---

## Available API Credits

### What this does
Codex's provider-reported credit standing (Unlimited / Credits available / No
credits, the provider's opaque balance, and its capture age) moves out of the
buried Codex-insights account row and into the account story at the top of the
dashboard, as a "Credit balance" sub-block above the unchanged reset credits in
a group now titled "Codex credits & resets". Claude gets an honest, reason-coded
"Claude Code does not report a usage-credit balance" row instead of a gap. The
standing travels on `/api/state` as an additive `accountLimits.credits` block,
is whitelisted on the peer path (together with passing reset-credit `stale`
through), and is selected on its own clock when several hosts collapse into one
account. No new poll, subprocess, file read, or persistence.

### How to test
1. `npm test` from the project root (908 tests; 906 pass, 2 machine-dependent skips).
2. Start an isolated instance (the installed service already owns 8787):
   `LLMDASH_HOST=127.0.0.1 LLMDASH_PORT=8790 LLMDASH_CLAUDE_AUTOREFRESH=0 npm start`
3. `curl -s http://127.0.0.1:8790/api/state` — each tool's `accountLimits`
   has `scope`, `resetCredits`, and `credits`. Codex shows the live standing
   (for this account: `{"status":"available","balance":"62500","capturedAt":"…"}`)
   once the first poll lands (a few seconds); Claude is always
   `{"status":"unsupported","reason":"not-reported","balance":null,"capturedAt":null}`.
4. `curl -s 'http://127.0.0.1:8790/api/codex-insights?range=7d'` — `account`
   is `{"scope":"account-wide","plan":{…}}` with no `credits` key.
5. Open `http://127.0.0.1:8790/` and check the "Other global limits" band (see
   the guide below), then narrow the window to 320px: no horizontal scroll.

### Notes for reviewer
- **One vocabulary module, two trust boundaries.** `src/account-credits.js`
  holds the enums, the balance sanitizer (moved verbatim from
  `codex-limits.js`), and the unsupported-block factory. Both the local Codex
  producer and `normalizeCredits` in `src/hosts.js` import it, so stripping and
  the 64-code-point bound are byte-identical at both boundaries; the client
  re-strips at render as defense in depth.
- **Stale precedence comes from the retained flags**, not the per-fact
  `fresh()` filter (architect flag d), so an aged block reports `lastStatus`.
  The block ages as one unit on its newest contributing observation; reading
  past the 24 h cap returns `never-observed` without mutating the cache.
- **Source error is a note only** for credits (architect flag c / FR-23): the
  standing keeps its status and gains "The latest Codex account read failed."
  The reset-credit `source-error` state flip is deliberately not mirrored.
- **QA-20 is pinned by a golden fixture.** Before `public/app.js` was edited,
  the reset-credit HTML for all seven states (available, zero, partial, stale,
  source-error, unsupported, malformed) was rendered from HEAD under a fixed
  clock and saved as `tests/fixtures/reset-credits-html.json` (only the
  locale-formatted expiry date label is a placeholder). The new test renders
  the same fixtures post-change and asserts byte equality. `resetCreditsHtml`
  itself is untouched.
- **One Usage link per section.** `supplementaryLimitsHtml` computes whether
  the Claude offer renders there and passes it down; the not-reported row's
  pointer is plain text when the offer owns the link, and the single anchor
  otherwise (e.g. a peer-only account).
- **Badge untouched.** `scripts/` has no diff and `computeMultiBadge` output is
  unchanged (all 214 badge tests pass). The only badge-adjacent edit is the
  `fakeCheckout()` file list in `tests/menubar-install.test.js`: the badge runs
  in place and imports `src/hosts.js`, which now imports
  `src/account-credits.js`, so the e2e fixture must copy it like a real
  checkout has it.
- **Small design deviation:** `.promotion-link:focus-visible` uses the
  stylesheet's existing focus idiom (`outline: 3px solid var(--focus-ring);
  outline-offset: 2px`) instead of the mockup's `box-shadow` ring with a 120ms
  fade, matching every other focus ring in the app and staying visible in
  forced-colors mode. The 140ms ease-out hover underline is as designed.
- **Defensive client choice not spelled out in the schema:** a fresh/stale
  block without a parseable `capturedAt`, or a stale block whose `lastStatus`
  is outside the table, renders "Unavailable" with no reason sentence (it
  cannot be aged honestly), mirroring the peer normalizer.
- **Mobile containment (QA-35)** is verified in a real browser, not by an
  automated test (the project carries no browser dependency); the static CSS
  guarantees are asserted in `tests/dashboard-refinement.test.js`.

---

## Seeing Available API Credits locally

1. Open a terminal in your project folder: `/Users/developer/devwork/llmdash`.

2. Start a second copy of the dashboard beside the one that is already
   installed (the installed one uses port 8787, so this one uses 8790):

   `LLMDASH_HOST=127.0.0.1 LLMDASH_PORT=8790 LLMDASH_CLAUDE_AUTOREFRESH=0 npm start`

   Wait for the line `llmdash running at http://127.0.0.1:8790`.

3. Open your browser and go to: `http://127.0.0.1:8790`

4. At the top, under the four big gauges, find the band headed
   **OTHER GLOBAL LIMITS**. It has two columns (one column on a phone).

5. What to look for:
   - **Right column, "▲ Codex credits & resets"** (this title used to say
     "Codex reset credits"). First a small **CREDIT BALANCE** heading, then:
     - **Credits available** (or **Unlimited**, or a greyer **No credits**),
     - a muted line **Provider balance 62500 · provider's own figure; not
       converted** (the number is whatever Codex reports; it is never turned
       into money and a reported `0` shows as `0`),
     - a faint **updated 12s ago** line.
     Then a thin divider and the **RESET CREDITS** block, which looks exactly
     as before (count, expiry dates).
   - **Left column, "◆ Claude model caps"**: after the model-cap text, a thin
     divider, **CREDIT BALANCE**, **Unavailable**, the sentence **Claude Code
     does not report a usage-credit balance.**, and a blue **Check in Claude
     Usage** link. If the Claude "Reset for free" offer is showing below, that
     line instead reads "Check in Claude Usage, linked under the Claude offer
     below." so the page never shows two copies of the link.
   - **Further down, "Deeper Codex insights"**: the account row now shows only
     **Account-wide** and the plan (e.g. **ChatGPT Pro**); the credit words and
     balance are gone from there.

6. Other states you may see in the Codex Credit balance block:
   - If the Codex reading is older than the account-fact window (5–30 minutes,
     depending on the poll interval): an amber **STALE · 2H 5M AGO** pill,
     "last reading: Credits available", and an amber note "The last good credit
     reading is old; the balance may have changed."
   - If the latest Codex read failed: a red note "The latest Codex account read
     failed. Showing the last good credit reading."
   - Right after a restart, before the first Codex poll: **Unavailable** with
     "No credit standing has been observed from Codex yet."
   - In the multi-host view, an older llmdash on another machine shows
     **Unavailable** with "This host did not report a credit standing."

7. When you are done, press `Ctrl+C` in the terminal to stop this copy. The
   installed dashboard on 8787 is not affected.

---

## Files changed

Added
- `src/account-credits.js` — credit enums, `boundedCreditBalance`, `unsupportedCredits`.
- `tests/account-credits.test.js` — sanitizer and unsupported-shape cases (QA-11, QA-12, FR-01).
- `tests/fixtures/reset-credits-html.json` — pre-feature reset-credit HTML golden (QA-20).

Modified (source)
- `src/codex-limits.js` — new `codexCredits(nowMs)`; `codexAccountFacts()` shrunk to `{scope, plan}`; sanitizer moved out.
- `src/claude-limits.js` — `claudeCredits()` (always `not-reported`).
- `src/server.js` — `toolWrap()` eighth `credits` param; `buildState()` wires both producers.
- `src/hosts.js` — `normalizeCredits()`; `credits` in `normalizeAccountLimits` / `unsupportedAccountLimits`; `stale` added to `RESET_CREDIT_STATUSES` and preserved by `normalizeResetCredits`.
- `public/app.js` — `CREDITS_STATUS_COPY` / `CREDITS_REASON_COPY`, `creditsForDisplay`, `creditsHtml`, Codex group retitle and order, Claude credit tail, one-link ownership, independent credit selection in `supplementaryToolForMembers`, insights row reduced to the plan.
- `public/styles.css` — `.credit-*` rules; `.promotion-link` hover and focus states.
- `README.md` — Capacity now paragraph on the credit standing and the Claude not-reported state.

Modified (tests)
- `tests/codex-account-facts.test.js` — shrink; `codexCredits()` coverage for QA-03…QA-11 (fake app-server now logs spawns and can fail fast for the rollout-fallback case).
- `tests/state-unchanged.test.js` — `accountLimits` deep-equal gains `credits` (QA-01, QA-13).
- `tests/hosts-degradation.test.js` — legacy shapes gain `credits: peer-omitted`; new peer-path tests for QA-14, QA-15, QA-16, QA-32.
- `tests/hosts-client.test.js` — five title assertions moved to "Codex credits &amp; resets"; reset fixture loop scoped to the reset sub-block; collapse tests extended (QA-18, QA-19); golden QA-20; credit-state loop (QA-21…QA-24, QA-31, QA-33); order and distinct-facts test (QA-25, QA-34); Claude row and single-link test (QA-26, QA-27).
- `tests/hosts-retain-live.test.js` — self host credits equal `buildState()` (QA-17).
- `tests/codex-insights-client.test.js` — fixture drops `account.credits`; QA-28 legacy-payload test.
- `tests/codex-insights.test.js` — insights `account` keys are `plan`, `scope` (QA-29).
- `tests/dashboard-refinement.test.js` — credit containment and link focus CSS assertions (NFR-06).
- `tests/app-copy.test.js` — README disclosure (QA-30).
- `tests/menubar-install.test.js` — `fakeCheckout()` copies `src/account-credits.js` (badge import tree).

---

## Test results

- **Baseline (HEAD, before changes):** 885 tests, 883 pass, 2 skipped, 0 fail.
- **After:** `npm test` — 908 tests, 906 pass, 2 skipped, 0 fail, 0 cancelled.
  The two skips are the pre-existing machine-dependent `--resolve-node` /
  `--setup-badge` "node unresolved" cases (a system-wide node exists here);
  `pipeline/baseline-failures.json` lists no known failures.
- **Badge suites explicitly (QA-36):** `node --test tests/menubar*.test.js tests/qa-badge-display.test.js` — 214 tests, 212 pass, 2 skipped, 0 fail; `git diff -- scripts/` is empty.
- **Design lint:** `~/.weft/bin/weft-design-lint check public/` — clean, 5 files, 0 findings.
- **Live wire check** (isolated instance on 127.0.0.1:18797, scratch data dir,
  Claude auto-refresh off; stopped afterwards; production 8787 and `~/llmdash`
  untouched): Codex `credits` = `available` / `"62500"` with a real
  `capturedAt`; Claude = `unsupported` / `not-reported`; `accountLimits` keys
  `scope,resetCredits,credits`; `/api/codex-insights` `account` has no
  `credits`; the self host in `/api/hosts` carries identical blocks; no new
  startup health line.
- **Real-browser render check** (headless Chromium via the locally installed
  Playwright): live page and a worst-case injected payload (stale pill, 64-code-
  point space-free balance, failed-read note, offer present) at 320, 375, 390,
  430, and 1280px. Document and body `scrollWidth` equal the viewport at every
  width with no element past the right edge; exactly one claude.ai Usage anchor
  per section; `bdi.credit-balance-value` computes `unicode-bidi: isolate`; the
  "Credit balance" and "Reset credits" sub-headings are level-4 headings inside
  the labelled group regions in the accessibility tree. Light and dark schemes
  checked visually against the mockup.

---

## Convention Flags

- **Prove an "unchanged output" claim with a pre-change golden, not by
  inspection.** When a refactor wraps or relocates a shipped presentation block
  that must stay byte-identical, render it from HEAD under a fixed clock before
  editing, commit that output as a fixture (placeholdering only locale-dependent
  text such as `Intl` date labels), and assert equality afterwards. See
  `tests/fixtures/reset-credits-html.json` and the QA-20 test in
  `tests/hosts-client.test.js`.
- **The badge's in-place import tree is test-pinned.** The menu-bar badge runs
  from the live checkout and imports `src/hosts.js`; any new relative import
  added to `hosts.js` (or `host-config.js` / `net.js`) must also be added to the
  `fakeCheckout()` file list in `tests/menubar-install.test.js`, or the
  end-to-end wrapper test fails with `ERR_MODULE_NOT_FOUND`. This is a fixture
  update, not a badge behavior change.
- **A section's single external link is owned by a computed flag.** When two
  sibling blocks in one rendered section could each offer the same external
  link, the section renderer decides ownership once (here, whether the Claude
  offer renders) and passes it down; the non-owner renders a plain-text pointer
  naming where the link is, so the page never shows two copies and never
  dead-ends.
