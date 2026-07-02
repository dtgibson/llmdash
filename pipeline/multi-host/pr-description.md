## Multi-host

### What this does
One llmdash instance now aggregates several of your tailnet machines into a single
view — each host's Claude Code + Codex limit windows **and** its per-machine
activity, side by side, the local machine included as one host. The local instance
polls each configured peer's existing `/api/state` on its interval poller, caches
the results per host, and serves a combined view at a new `GET /api/hosts`. Limits
are presented as the *account's* numbers (identical same-account meters are
detected and shown once, never as N independent budgets); activity is the genuine
per-machine data and leads each host card; an unreachable host shows a named
offline callout, never a stale meter or fabricated zeros. **Unset, it behaves
exactly as today** — one host, this machine, no new UI.

Configure with `LLMDASH_HOSTS="host[:port][=label],…"`. The single-host `/api/state`
contract is **untouched** (byte-for-byte), so the local view and the menu-bar badge
keep consuming it unchanged.

### How to test
1. `npm test` — full suite green (**262 tests**, 260 pass, 2 pre-existing skips; the
   baseline was 181, so 81 new tests).
2. **Single-host unchanged:** start the server with `LLMDASH_HOSTS` unset and confirm
   `/api/state` is byte-identical to before and the dashboard renders exactly as
   today (no host chrome). `/api/hosts` returns the single local host.
3. **Multi-host:** point `LLMDASH_HOSTS` at one or two other machines (or scratch
   loopback fake peers serving crafted `/api/state`) and confirm `/api/hosts`
   aggregates them, the client shows host cards + the collapsed "Account limits"
   banner + a per-machine activity block, and one offline peer doesn't break the
   others. See `pipeline/multi-host/how-to-see-it.md` for the step-by-step.

### Notes for reviewer
- **The `/api/state` guard is load-bearing.** `tests/state-unchanged.test.js` is a
  golden-contract test: it locks `buildState()`'s field set/meanings and asserts the
  `/api/state` response shape is identical whether or not peers are configured. The
  badge's existing tests pass untouched. Multi-host adds a *new* endpoint
  (`/api/hosts`); `/api/state` and `buildState()` got zero diff.
- **Account-sameness is a pure client-side derivation** over `/api/hosts` (no new
  server field): hosts group by matching per-window reset epochs (±60s). Extracted
  to `src/host-view.js` and unit-tested (`tests/hosts-account.test.js`); `public/app.js`
  carries a verbatim copy, locked in lockstep by a static test.
- **The outbound fetch is the SSRF-shaped surface** (`fetchPeerState` in
  `src/hosts.js`): configured-hosts-only, credential-free `GET /api/state`,
  timeout-bounded **and** body-capped, **no redirect follow** (3xx → peer-error),
  every peer field clamped/normalized/escaped. Fault-injection tested in
  `tests/hosts-fanout.test.js` against scratch loopback peers.
- **Fan-out safety:** bounded concurrency + a single-flight guard so a slow tick's
  fan-out can't pile up across ticks; the local reading is taken in-process (never
  self-HTTP); peer polling runs only on the interval, never on the request path (a
  static assertion enforces this).
- **Zero new runtime dependencies, no build step** — `node:http` only
  (`tests/hosts-zerodep.test.js`).
- New reason codes `peer-unreachable` / `peer-error` (with an escaped `cause`/`detail`),
  own-key mapped client-side. The reserved `auto-refresh-*` names are not reused.
- Verified in a real browser render at 375px: the banner, host cards, same-account
  annotations, and offline callout paint with **no horizontal overflow**.
