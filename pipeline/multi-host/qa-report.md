# QA Report — Multi-Host

**Date:** 2026-07-02
**Test Runner:** node:test (`npm test`)
**Lane:** New Feature (Stage 6 — The Tester)
**Result:** **PASSED**

---

## Test Suite Results

**262 tests, 260 passing, 0 failing, 2 skipped.** Matches the Engineer's reported
baseline exactly (262 / 260 / 2). Duration ~5.4 s.

### Why the 2 skips skip (confirmed — not new omissions)

Both skips are pre-existing, environmental, and unrelated to multi-host. Via the
TAP reporter they are:

- `--resolve-node: exits non-zero when node cannot be resolved (loud failure)`
  (`tests/menubar-install.test.js:81`)
- `--setup-badge: node unresolved → loud failure with the fix, non-zero, no dead
  badge` (`tests/menubar-install.test.js:239`)

Both guard with `t.skip('a system-wide node exists on this machine')` — they can
only run in an environment where `node` is **absent** from PATH (to prove the
installer fails loudly). This machine has `node` at
`/Users/developer/.nvm/versions/node/v24.18.0/bin/node` (v24.18.0), so the guard
skips them by design. These are badge-install tests, not multi-host tests; no
multi-host test is skipped.

---

## Acceptance Criteria Verification (QA-01 … QA-27)

| ID | Result | Evidence |
|---|---|---|
| QA-01 Peer-list parsing | ✓ Pass | `tests/hosts-config.test.js`: `host`, `host:port`, `host=label`, `host:port=label`, labels-with-spaces, port defaults to `config.port`, multi-entry list yields N peers in order. |
| QA-02 Local always present / no dead knob | ✓ Pass | Unit: unset/empty/`,,`/whitespace ⇒ exactly 1 host, self:true, `remoteHosts([])`. **Live:** single-host boot (LLMDASH_HOSTS unset) → `/api/hosts` returns 1 host `{label:"This machine", self:true}`; disclosure log "no peers configured … issues no outbound reads (single-host)." |
| QA-03 Dedup / self not double-counted | ✓ Pass | `hosts-config.test.js`: `127.0.0.1`/`localhost`/`127.0.0.1:8787` collapse to the single local host (self:true, no remote target); dup `host:port` counted once (later label wins); tailnet-IP + pinned config.host identity match. |
| QA-04 Entry validation/normalization | ✓ Pass | `sanitizeHostPort` strips whitespace + `\| ; \` $ ( ) / \\`; present-but-invalid port (`h:0`,`h:70000`) → `bad-port` error (not coerced); empty host → `empty-host` error, never fabricated; malformed entries surface in the startup disclosure. |
| QA-05 Fan-out on poller, local in-process | ✓ Pass | **Live proof:** scratch peers' `/counter` advanced ~1 per 5 s tick (interval poller fans out); 30 rapid `GET /api/hosts` produced **delta 0** on both peer counters — no fetch from the request path. Local host reads in-process (`writeLocalHost` → `buildState()`, no self-HTTP). Static assertion: `server.js` never references `fetchPeerState`. |
| QA-06 Combined view served from cache | ✓ Pass | `server.test.js` + `hosts-degradation.test.js`: `/api/hosts` is a pure `getCombined()` cache read carrying every host's full per-tool picture + freshness/offline state. **Live:** delta-0 counter proof (above) confirms no per-request fetch/subprocess/blocking I/O. |
| QA-07 Ingest normalize/clamp/escape | ✓ Pass | `hosts-degradation.test.js`: used-% 150→100, −20→0, remainingPct derived from clamped used-%; bad/missing timestamp → null (never "now"), `dataAt` null not now; free-form fields kept raw for render-time esc(). |
| QA-08 Bounded timeout + concurrency | ✓ Pass | `hosts-fanout.test.js`: hung peer bounded by timeout → `peer-unreachable/timeout` in <FAST+1.5s; `pollPeers` with one hung + one fast peer completes bounded, fast peer reachable. Single-flight `inFlight` guard in `startPoller`. **Live:** counter advanced exactly ~1/tick — no pile-up across ticks. |
| QA-09 Peer failure → named state, never fabricated | ✓ Pass | Unit: non-200→`peer-error/http-500`, bad JSON→`bad-json`, oversized→`oversized`, redirect→`redirect`, refused→`peer-unreachable/connect`, timeout→`peer-unreachable/timeout`; failed host `state:null`. **Live:** dead-port offline peer → `{reason:"peer-unreachable", cause:"connect"}`, `state:null`, DOM shows named callout with 0 gauges / 0 tiles. |
| QA-10 Per-host freshness bands | ✓ Pass | `hosts-degradation.test.js`: freshness with non-finite thresholds → null (no band); valid one preserved with `capturedAt/freshForMs/staleAfterMs`. Client `ageBand()` derives band live from server thresholds. Codex `freshness:null` per host. |
| QA-11 Per-host diagnostics incl. new peer codes | ✓ Pass | Client maps `hostDiagnostic` by own-key (`hasOwnProperty` on `PEER_CAUSE_FRAGMENTS`); escaped `detail`; reserved `auto-refresh-*` not reused (`hosts-client.test.js` + `hosts-degradation.test.js`). **Live:** offline callout rendered `(peer-unreachable)` with the cause fragment, detail escaped. |
| QA-12 Unconfigured first-run honesty | ✓ Pass | **Live:** single-host DOM has `#hosts` empty, 0 account banners / host cards / you-pills / offline cards / legend. Only `#tools` renders today's blocks. |
| QA-13 Combined view groups per host, independent state | ✓ Pass | `hosts-degradation.test.js`: one offline host doesn't flag/suppress another (reachable host unaffected, offline `state:null`); stable ordering (offline not sorted to bottom). **Live:** 4 hosts, offline host in place, other 3 render fully. |
| QA-14 Per-host activity distinct / honest not-available | ✓ Pass | **Live:** Desktop tiles 12.7M today / 91% cache; Work laptop 5.5M today / 83% cache — genuinely distinct per machine. Codex-with-no-sessions → honest "No Codex sessions have been recorded on this machine yet" note, no fabricated zeros. |
| QA-15 Account-wide-limits honesty | ✓ Pass | **Live DOM:** `acctBanners:1`, scope `"account-wide · identical on This machine & Desktop"`, 2 gauge panels in the banner (shared meter shown **once**), 2 same-account annotations. Different-account "Work laptop" renders its **own** 2 gauges in-group (bars 78%/29%) under "account limits · this machine", 0 same-acct annotation → reads distinct. Cannot read as N budgets. |
| QA-16 Single-host `/api/state` contract unchanged | ✓ Pass | Golden guard `state-unchanged.test.js` (5/5). **Tamper-verified:** adding a top-level key to `buildState()` made the guard **fail** with `AssertionError: a new top-level /api/state key would break the badge/local contract` (+`__tamper_hosts`), then reverted → passes (tamper fully removed, 0 artifacts). **Live:** `/api/state` top-level keys `generatedAt,headroom,tools`; tool keys unchanged. Badge tests 42/42 pass untouched. |
| QA-17 Per-host render (not just load) | ✓ Pass | **Live DOM, real browser:** each reachable host renders 2 gauge panels + 2 pacing burn-lines + 6 tiles + 4 mix segments; bar-fill widths are real numbers (e.g. Work laptop 78%/29%). Rendered through the shared `toolHtml`/`gaugeHtml` path (`#tools` empty in multi-host mode — renderer not forked). |
| QA-18 Single-host UI unchanged | ✓ Pass | **Live:** single-host boot renders `#tools` with 2 tool blocks + 4 gauges, header "updated 3m ago" (no "N hosts"), footer "Activity: local session logs", zero host chrome. Screenshot matches today's dashboard. |
| QA-19 Disclosure | ✓ Pass | **Live startup log:** "Multi-host: 3 peers configured — read-only GET /api/state to [host:ports] on each 5s poll (tailnet-only, credential-free, no discovery)"; per-peer `Hosts:` health lines; single-host boot logs the no-outbound reality. README covered by `hosts-disclosure.test.js`. |
| QA-20 Zero deps / no build | ✓ Pass | `hosts-zerodep.test.js`: `package.json` runtime + dev deps `{}`, no `build` script; multi-host modules import only `node:`/relative; fan-out uses `import http from 'node:http'`. |
| QA-21 Request-path isolation | ✓ Pass | Static assertion (`server.js` never calls `fetchPeerState`; `/api/hosts` = `getCombined()`). **Live:** 30× `GET /api/hosts` → 0 peer-counter delta. |
| QA-22 Compatibility / shape tolerance | ✓ Pass | `hosts-degradation.test.js` + `hosts-fanout.test.js`: missing/extra fields → partial reading (seven_day null, unknown fields dropped), never a crash; wrong-shape JSON → `peer-error` (unusable), null top-level → offline. |
| QA-23 No transitive fan-out | ✓ Pass | Structural: `fetchPeerState` targets a fixed `path:'/api/state'` (never `/api/hosts`), targets come only from `parseHosts`, no host derived from a payload. **Live:** peers received only `/api/state` GETs (the fake peer serves `/api/state`; its own peer list, if any, is never traversed). |
| QA-24 Outbound-fetch security posture | ✓ Pass | `hosts-fanout.test.js`: redirect (302) **not followed** → `peer-error/redirect`, second server never hit; credential-free `GET /api/state` only; timeout + body cap enforced. **Live:** peer-supplied XSS label + `<script>` detail escaped (`&lt;img…`, no `<img>` node, no alert, no console error). |
| QA-25 Response-body cap | ✓ Pass | `hosts-fanout.test.js`: a peer streaming >4 MiB against a 16 KiB cap is aborted at the cap → `peer-error/oversized`; body never fully buffered (`res.destroy()` + `req.destroy()` on overflow). |
| QA-26 Hardening preserved | ✓ Pass | `server.test.js`: `/api/hosts` carries `nosniff`, `referrer-policy`, CSP `default-src 'self'`, `cache-control: no-store`; rejects non-GET/HEAD with 405 + `allow: GET, HEAD`. No peer field interpolated into a style (`hosts-client.test.js`). |
| QA-27 Clock-skew preserved | ✓ Pass | `hosts-degradation.test.js`: a valid but 47h-skewed `capturedAt` is preserved as-is (normalized to canonical ISO, not re-stamped to now); freshness `capturedAt` likewise; non-canonical ISO round-trips to canonical. |

**Score: 27 / 27 Pass. 0 Fail, 0 Deferred, 0 N-A.**

---

## The load-bearing guard (QA-16) — independent confirmation

Beyond the golden test passing, I independently confirmed the guard is not a
no-op:

1. **Tamper-check:** added `__tamper_hosts: []` to `buildState()`'s return. Ran
   `tests/state-unchanged.test.js` in isolation → the top-level-shape assertion
   **failed** (`AssertionError: a new top-level /api/state key would break the
   badge/local contract`, actual keys included `__tamper_hosts`). Reverted;
   confirmed `grep -c __tamper src/server.js == 0` and the `git diff HEAD` for
   `server.js` contains **no** tamper line — only the legitimate `/api/hosts`
   handler additions.
2. **Live `/api/state` shape:** on a scratch-port + scratch-data-dir boot with
   `LLMDASH_HOSTS` unset, `/api/state` top-level keys are exactly
   `generatedAt,headroom,tools` and tool keys exactly the shipped set — no
   multi-host field leaked.
3. **Badge unaffected:** `menubar*.test.js` = 42/42 pass, untouched.

The `/api/state` handler and `buildState()` receive **zero** diff; multi-host is
a separate `/api/hosts` endpoint reading an in-memory cache.

---

## Real-browser findings (live integration, independent of the Engineer's VM/DOM proof)

**Safety:** never touched `~/llmdash` or the live 8787 service. Every server ran
on a scratch port (8899 multi-host, 8898 single-host) with a scratch
`LLMDASH_DATA_DIR`. Three scratch loopback peers: **same-account** (identical
reset epochs to the local seed), **different-account** (distinct epochs),
**offline** (a dead port, nothing listening). The local Claude reading was seeded
to share the same-account peer's reset epochs so the collapse behavior is real.

- **QA-15 detect-and-collapse (real browser DOM):** exactly **one** "Account
  limits" banner, scope `"account-wide · identical on This machine & Desktop"`,
  the shared 5-hour/Weekly gauges rendered **once** in the banner; each
  same-account host card leads with its own **activity** and shows the
  "Account limits above" annotation instead of a duplicate meter. The
  different-account host renders its **own** meters in-group under "account
  limits · this machine". The view **cannot** be read as N independent budgets.
- **QA-09/13 offline-only + independence:** the offline peer shows the named
  `peer-unreachable` callout (host + reason + last-polled age + the fix), a dashed
  de-emphasized card, **0 gauges / 0 tiles**, `state:null` — no gauge, no
  fabricated zeros, no stale-as-fresh. The other 3 hosts render fully and are
  unaffected.
- **QA-17 renders (not just loads):** gauges have real bar widths, pacing lines,
  tiles with real per-machine values (Desktop 12.7M/91%, Work laptop 5.5M/83%),
  and 4-segment token-mix bars — all through the reused renderer.
- **QA-18 single-host unchanged:** with `LLMDASH_HOSTS` unset, `#hosts` is empty,
  zero host chrome, today's `#tools` layout, single-host header + footer;
  `/api/hosts` returns the single local host.
- **Escaping (QA-24/NFR-04):** a peer whose label was
  `<img src=x onerror=alert(1)>` and whose diagnostic detail contained
  `<script>` reached the DOM only escaped — **zero** injected `<img>` nodes,
  **zero** console output (no `alert(1)` fired), the label displayed as inert
  text. The `sanitizeHostPort`/`esc` bug class is closed on the host list and
  every rendered peer field.
- **Request-path isolation (QA-05/21):** 30 rapid `GET /api/hosts` → **0** delta
  on both peer request counters; the counters advanced only on the 5 s poller
  interval. No outbound fetch on the request path; single-flight keeps the tick
  bounded with no in-flight accumulation.
- **Responsive:** no horizontal overflow at desktop (1280) or mobile (375) —
  `scrollWidth === clientWidth` at both; host cards stack in a single column.

---

## Edge Cases Tested (beyond the acceptance table)

- **Redirect-to-another-host is not followed** — the redirect target server was
  never hit (unit) → resolves to `peer-error/redirect` (SSRF-shaped surface
  closed).
- **Oversized body aborted at the cap** — a 4 MiB stream against a 16 KiB cap is
  destroyed, not buffered.
- **A tool with no `source`** is dropped (can't be rendered honestly); other
  tools survive.
- **Wrong-shape but valid JSON** (`{nope:true}`) → `peer-error` (unusable), never
  fabricated.
- **Stable host ordering** — an offline host stays in its configured position,
  not sorted to the bottom.

---

## Known Limitations (observations, not blockers)

- **Self-identification is best-effort (documented, FR-03).** A peer reachable via
  an unresolved hostname alias or a second tailnet name would be polled over HTTP
  as a "remote" that is really the local machine. This is a correctness-preserving
  miss (it double-*shows* the local reading under two labels, honestly, and issues
  one loopback-ish fetch) — never a fabricated reading; the account-wide-limits
  collapse covers the "same numbers twice" case regardless. No DNS resolution is
  attempted (a subprocess/blocking-I/O cost the Architect deliberately declined).
- **The account banner's shared meter uses the freshest member's tool**, so its
  activity-derived burn-rate line reflects that representative host, not a sum.
  Observed live as "0 tokens / hr" when the representative (local seed) has no
  session logs — this is the account *meter*, not per-host activity; per-host
  activity renders separately under each host card. Consistent with the design
  spec (limits are the account's numbers; activity is per machine) and the
  out-of-scope "no cross-host roll-up" rule.
- **The offline peer's XSS label appears verbatim in the startup terminal log**
  (a plain-text console line, not HTML) — expected and safe; the escaping
  requirement applies to HTML/style/SQLite render surfaces, all of which escape it.

---

## Convention Flags

_None._ The multi-host implementation already honors every standing CLAUDE.md
convention (source-aware shared path, clamp/normalize/escape at ingest, enum
reason codes with own-key mapping, server-supplied freshness thresholds, verify-
it-renders, no request-path I/O, zero-dep). No new recurring check emerged that
isn't already a standing rule.
