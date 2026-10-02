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

---

## Deploy blocker: startup readiness

### What was wrong

`src/server.js` ran `refreshCodexAnalytics()` and `refreshCostAnalysis()`
synchronously before `server.listen()`. On the current corpus (about 8.0 GB of
`~/.codex/sessions`, 2.3 GB of `~/.claude/projects`) the cold priming kept the
process from listening for about 95–120 seconds in production, so every deploy,
including the previous version `8b021a3`, failed `install-macos.sh --service
install`'s 45-second readiness gate. After the listener came up, each poller
tick ran a 90-day ledger pass (Claude and Codex scans, bounded at 512 MiB of
changed bytes and 10 s of wall time per source) as one synchronous block, so
requests stalled for seconds on every tick until the ledger converged (17
passes on this corpus).

### What changed

- **Listen first, then prime.** Before binding, startup now does only cheap work:
  the DB open, the owner account-config read, health lines, and the local host
  seed. `startPoller()` moved into the `listen` callback. The poller's first
  tick is the prime and runs the same refreshes in the same order. The installer's
  deadline and readiness semantics are unchanged.
- **Cooperative scans.** The poller-owned structured-log work is unchanged except
  that it can now yield. The scan bodies (`scanCodexSession`, `scanCodexRollouts`,
  the Claude ledger parse/scan, `buildUsageLedger`, the cost refresh, and the
  Codex analytics refresh) are now generator functions with suspension points
  between files, between lines, and between range builds. A small helper
  (`src/cooperative.js`) provides two drivers:
  - `runToCompletion` is the existing synchronous API. It passes no pacer, so it
    never suspends; every existing caller and test is unchanged.
  - `runCooperatively` is used by the poller. Once a 20 ms time slice has elapsed,
    it returns to the event loop with `setImmediate` and then resumes the scan.

  Suspension never changes what is read or published. Every bound, budget, wall
  deadline, descriptor-validated no-follow read, last-good fallback, cache
  ceiling, and the single end-of-scan parse-cache and analytics-cache
  replacement are unchanged. The pacer uses real time and is separate from the
  scans' injectable `nowFn` budget clocks. `pollOnce` now awaits
  `refreshCodexAnalyticsAsync` and `refreshCostAnalysisAsync` at the same
  points in the tick.
- **Cold states verified, two over-claims fixed.** `/api/codex-insights` returns
  its existing unavailable payload (`hasData:false`, `generatedAt:null`, every
  metric `available:false`). `/api/cost-analysis` returns its existing `cold`
  payload (`cache_cold`, null amounts, which the client already renders as
  "still warming"). `/api/state` Codex activity is `hasData:false,
  generatedAt:null`. None throw or fabricate zeros. However, the client rendered
  the never-scanned insights and activity states as completeness claims ("No
  supported Codex activity was recorded…", "No Codex sessions have been
  recorded…"). Both now read as loading only when `generatedAt === null`, which
  is the local producer's never-refreshed marker. Peer-normalized activity omits
  the field, so peer copy is unchanged. No wire shape changed.

### Files

- `src/cooperative.js` (new): pacer, synchronous drain, and cooperative driver.
- `src/codex-events.js`, `src/usage-ledger.js`: generator forms with
  synchronous wrappers. `scanCodexRolloutsSteps` and `buildUsageLedgerSteps`
  are exported.
- `src/codex-stats.js`, `src/cost-analysis.js`: `refreshCodexAnalyticsAsync` and
  `refreshCostAnalysisAsync`; the synchronous exports are kept.
- `src/poller.js`: awaits the cooperative refreshes.
- `src/server.js`: no heavy pre-listen priming; `startPoller()` runs after listen.
- `public/app.js`: adds warming copy for a never-scanned local Codex activity or
  insights payload.
- Tests: `tests/cost-analysis.test.js` covers a real-corpus fixture: the
  refresh yields mid-scan, stays `cold` until it publishes, and deep-equals the
  synchronous refresh. `tests/codex-insights.test.js` covers the same for
  insights. `tests/server.test.js` asserts that no structured-log scan happens
  before listen and that `startPoller` runs in the listen callback.
  `tests/codex-insights-client.test.js` and `tests/hosts-client.test.js` cover
  the warming copy.

### Measurements

These measurements are from a fresh process from this dev checkout on
127.0.0.1, with a scratch data dir and `LLMDASH_CLAUDE_AUTOREFRESH=0`, on the
current corpus. The page cache was warm from earlier runs. Production and
`~/llmdash` were untouched.

| Check | Result |
| --- | --- |
| Spawn to first 200 on `/api/state` | 0.31 s (default 60 s poll); 0.46–0.86 s on four later runs |
| Installer readiness logic (the exact `wait_for_service_ready` + curl invocation, extracted, run against a fresh instance) | READY after ~1 s of the 45 s budget (0.5 s per probe) |
| `/api/state` once a second, 200 s, startup prime + 3 ticks at 60 s | 200 polls, 0 non-200; max 394 ms, p50 3 ms, p99 338 ms; `/api/hosts` max 416 ms |
| `/api/state` once a second, 330 s at 10 s polling through cost convergence | 329 polls, 0 non-200; max 1,058 ms (one sample), p50 6.9 ms, p99 362 ms |
| Further 10 s-poll runs (110–150 s) | max 401, 424, 208 ms |
| In-process event-loop gap probe (150 s run) | largest gaps ~230–250 ms: the poller's existing Claude 7-day activity read (`stats.js computeActivity`, ~235 ms per tick) and the final 90-day range build (~100–135 ms) |
| Before (deploy report) | no listener for ~95–120 s; 6–7 s responses during the cold scan |

During warm-up, `/api/codex-insights?range=30d` answered 200 in 1.6 ms with
`hasData:false, generatedAt:null`. `/api/cost-analysis` answered 200 with
`refresh: cold / cache_cold`, coverage `unavailable`, and null amounts. Insights
published within the first tick, about 20 s after start. Cost published partial
(`scan_budget_total_bytes`) on the first tick and converged by about 220 s at a
10 s poll (only `dedupe_fallback` and `unknown_model` remained). The first Codex
limits reading appeared 17–33 s after start. It comes after the analytics in the
tick, as before. Until then, `/api/state` reports Codex `no-reading`.

**Release check (fresh process, `--expose-gc`, cooperative drivers in poller
order):** converged on pass 17 (the 2026-09-24 synchronous check also took 17).
After forced GC: heap used 92.2 MiB, heap total 228.5 MiB, RSS 1,160 MiB. A
synchronous-driver run in the same session also converged on pass 17, with
92.1 MiB, 231.3 MiB, and 1,196 MiB, so the memory profile did not change. Cache
occupancy at convergence was within every ceiling:
- Claude: 1,120 files, 148,626 of 175,000 records, 74.4 MB of 100.7 MB estimated.
- Codex usage: 1,401 files, 218,514 of 1,100,000 records.
- Codex insights: 272 files, 86,692 of 500,000 records.
- Ledger: 366,319 of 1,250,000 records.

The 7d, 30d, and 90d reconciliation passed for the Claude, Codex, and combined
scopes. Daily sums and the final cumulative values equal their summaries for
observed and no-cache cost. The cache effect equals no-cache minus observed.
Recognized minus comparable records and tokens equals the omission rows. The
omissions match the prior release: `gpt-6` 2,631 records / 400,101,344 tokens,
and 90-day `Other` 113 records / 11,095,912 tokens. There are 60
fallback-identity Codex records.

### Test results (after this fix)

`npm test`: 912 tests, 910 pass, 2 skipped (the same machine-dependent skips),
0 fail. After the cold-trends fix below: 915 tests, 913 pass, 2 skipped, 0 fail.

### Re-verification fix: cold trends

Re-verification found one more cold path. `/api/trends` built its Codex daily
series by synchronously scanning on the request path. The old startup had
already filled the parse cache that scan reuses, so it was cheap; with
listen-first, the first dashboard load after a restart scanned a cold cache. On
the Tester's probe, a cold 7d request blocked `/api/state` for 1.84 s and a cold
30d request blocked it for 19.1 s.

What changed:
- **Codex trends read the poller's published scan.** The Codex analytics refresh
  now keeps the last published 30-day usage set: references to records the
  parse cache already holds, at the widest trends range. `readUsageRecords`
  became a pure filter over that set, so trends never scan on the request path.
- **Explicit warming state.** Each trends tool carries
  `activityState: 'ready' | 'warming'`. Codex is `warming` with `daily: []`
  until the first publish, and a warming answer is not cached, so the next
  request sees the published data. The client maps the state with an own-key
  lookup to "Reading this machine's local Codex session logs — token trends
  appear once the first scan finishes", instead of "Not enough data yet" or
  "limits only". While warming, it checks again after 15 s instead of waiting
  out the 120 s cadence.
- **Local only.** Trends is fetched only by the local page. Peers and the badge
  read `/api/state` and `/api/hosts`, so no peer-normalizer change is needed.
- **Claude side.** Its trends reader keeps no cache, so it has no cold exposure:
  it reads the range's transcripts on every request at the same cost, cold or
  warm. That cost is about 0.25 s for 7d and 0.8 s for 30d. It is unchanged
  and is now the only scan left in the trends handler (see decisions.md).

Files: `src/codex-stats.js`, `src/trends.js`, `public/app.js`,
`tests/trends.test.js` (warming/ready/no-rescan test, plus an equivalence test
against the former scan for 24h, 7d, and 30d), and `tests/hosts-client.test.js`
(warming copy).

Measurements below come from the Tester's `trends-probe.mjs` on a fresh
process with a warm page cache. `/api/state` was polled every 100 ms, and a
trends request was fired at t≈2 s and again at t≈70 s.

| Request | Before: trends / `/api/state` stall | After: trends / `/api/state` stall |
| --- | --- | --- |
| cold 7d at t≈2 s | 1,933 ms / 1,844 ms | 263 ms / 235 ms |
| warm 7d at t≈70 s | 336 ms / 314 ms | 241 ms / 137 ms |
| cold 30d at t≈2 s | 19,196 ms / 19,103 ms | 825 ms / 737 ms |
| warm 30d at t≈70 s | 929 ms / 891 ms | 789 ms / 748 ms |

First 200 arrived at 0.32 s in both runs, with 0 non-200 responses. The
largest `/api/state` response was 237 ms over the 7d run and 748 ms over the
30d run; the 30d figure is the Claude transcript read. An earlier probe pair
ran while an iOS Simulator boot held the machine's load average near 300. In
that run one 6.3 s and one 0.7 s `/api/state` stall coincided with stalls in
the probe process itself. An instrumented rerun put the server's own longest
event-loop gap at the Claude 30d trends read (1.09 s under load) and showed no
other server gap above 0.85 s.

**Same results once converged.** On the real corpus, after the parse cache
converged, the published-scan Codex daily series for 24h, 7d, and 30d was
byte-identical (as JSON) to the former request-path scan at the same instant.
That covered 2, 7, and 25 days, and 69,181,978 / 666,993,581 / 5,275,977,527
tokens.
