# Schema / System Design — multi-host
**Feature:** multi-host
**Date:** 2026-07-02
**Stage:** 3 — The Architect
**Path:** Incremental (prior schemas exist; **cached-only default ⇒ no tables, no columns, no migration**)
**Endpoint call:** **new `/api/hosts`** (OQ-01) — `/api/state` stays byte-for-byte untouched
**Persistence call:** **cached-only** (OQ-02) — peer readings live in an in-memory per-host cache, never SQLite

---

## Data layer verdict

**No database change.** Under the cached-only default (OQ-02, confirmed below), a
peer's reading is a live in-memory value maintained by the interval poller and
served from a per-host cache. Nothing about a peer is persisted: `usage_snapshots`,
`insertSnapshot`, dedup, trends, and `getLatestPerWindow` are **untouched** and
remain **local-host-only** (each peer already persists its own snapshots on its own
machine — the out-of-scope "cross-host history store"). This "schema" is therefore a
**system design**: a new in-memory host cache, a new read-only endpoint, a poller
fan-out, config parsing, per-host degradation, and disclosure — not a data model
change.

Multi-host adds **zero runtime dependencies and no build step** (NFR-01): the
fan-out is `node:http` only — the badge's `fetchState(host, port)` is the template
(hardened here). `package.json` runtime deps stay at 0.

### Why cached-only stands (OQ-02 confirmed)

The brief lists a cross-host history store as out of scope, and each peer already
persists its own snapshots locally. Persisting peer readings buys only
offline-survivability of a last-known reading — but FR-09 already forbids showing a
last-cached peer reading **as fresh**, so a persisted-across-restart peer value
would have to be presented as stale/last-known anyway, and after a restart the next
poller tick (≤ `pollIntervalMs`, default 60 s) refills the cache from live peers.
The survivability gain is marginal; the cost is real (a peer-provenance column, a
write path that must clamp/normalize/escape every peer field per FR-07/NFR-03, and a
new `usage_snapshots` semantics where a row is no longer "this machine's own
history"). **Cached-only.** The local host's own snapshots still persist exactly as
today.

---

## The two axes: host × tool (the core modeling call, FR-17)

"Source-aware" today is one axis — **tool** (`source` ∈ `claude-code | codex`), a
`tools[]` array built by `buildState()` and rendered by `toolHtml()`. Multi-host
adds a **host** axis *on top of, not inside*, the tool axis:

```
combined = { hosts: [ HostReading, HostReading, ... ], generatedAt }

HostReading = {
  host,              // sanitized host string (the poll target / identity key)
  label,            // operator label, DEFAULT = host; free-form → escaped at render
  port,             // resolved port (number)
  self: bool,       // true for the local host (in-process reading, never HTTP)
  reachable: bool,  // false ⇒ this fetch failed; see hostDiagnostic
  hostDiagnostic: null | { reason: 'peer-unreachable'|'peer-error', cause, detail? },
  fetchedAt,        // ISO — when THIS host's cache entry was last refreshed (or attempted)
  state: null | { tools:[…], headroom, generatedAt }   // the peer's own /api/state payload, verbatim-shaped
}
```

**`state` is the exact `/api/state` shape** — for `self` it is literally
`buildState()`; for a peer it is the fetched-then-**normalized** payload. The client
renders each `HostReading.state` through **the same `toolHtml()` / `gaugeHtml()` /
`burnHtml()` / `tilesHtml()` / `limitsNoteHtml()` path** that renders the local view
today — the renderer is **not forked**; a host is a new outer loop wrapping the
existing per-tool render. The store is **not forked**: peers never touch `db.js`.

This is the load-bearing decision. A peer payload is consumed **exactly** as the
local one because it *is* the same shape — the same clamp/normalize/escape happens at
ingest (FR-07), and the same `esc()` happens at render (already the case in
`app.js`).

---

## Endpoint shape — new `/api/hosts` (OQ-01, [EP])

**Decision: a new `GET /api/hosts` endpoint; `/api/state` is not modified at all.**

Rationale over extending `/api/state`:

1. **`/api/state` stays pristine (FR-16, QA-16).** The badge
   (`scripts/menubar/llmdash.5s.js`) and the local dashboard consume `/api/state`
   unchanged — no new field to ignore, no risk of an additive field bloating the
   single-host payload the badge fetches every 5 s. "Additive-only" is a promise
   that must be *tested*; "not touched at all" is a promise that is *structurally
   true*. The `/api/state` builder and its handler get **zero diff**.
2. **Clean client mode-switch (FR-18).** The client asks `/api/hosts`; an empty /
   single-host answer (see below) renders **exactly today's single-host view** with
   no host chrome. Multi-host presentation engages only when `hosts.length > 1`.
3. **No self-recursion hazard.** `/api/hosts` fans out to peers' **`/api/state`**,
   never to peers' `/api/hosts` (FR-21) — the one-hop rule is structural because the
   fan-out target is a *different* path than the combined endpoint. If we extended
   `/api/state` to carry the combined view, a peer fetching a peer's `/api/state`
   would pull the whole tree — the transitive-fan-out trap. Separate paths make
   "fetch only the peer's own reading" the natural, only shape.

**Both consumers keep working:** `/api/state` → single-host (badge + local render +
the `self` sub-reading inside `/api/hosts`); `/api/hosts` → combined view (the new
dashboard section). The combined endpoint exposes **only** the same per-tool shape
`/api/state` already exposes, per host (NFR-03: no new sensitive surface).

**Single-host degenerate case (FR-02/FR-12/FR-18):** when no peers are configured,
`/api/hosts` returns `{ hosts: [ { self:true, host, label, port, reachable:true,
state: buildState() } ], generatedAt }` — one host, the local one. The client, seeing
`hosts.length === 1 && hosts[0].self`, renders the **existing** single-host layout
with **no** host-grouping chrome (it may even keep using `/api/state` in that mode —
see *Client* below). No peer states, no offline rows, no multi-host affordances,
**no outbound fetch ever issued** (the poller's fan-out list is empty). Byte-for-byte
today.

---

## Config — `LLMDASH_HOSTS` (OQ-03)

**Env var: `LLMDASH_HOSTS`** (chosen over `LLMDASH_PEERS`: the list *includes* the
local host, so "hosts" is more honest than "peers"; the UI and README say "hosts").

**Per-entry format: `host[:port][=label]`**, comma-separated (comma chosen over
whitespace so a `label` may contain spaces — e.g. `LLMDASH_HOSTS=laptop=Work
Laptop,100.64.0.7:8788=Desktop`). One new module owns all of this:

```
src/hosts.js   (new)
  parseHosts(raw = process.env.LLMDASH_HOSTS, cfg = config) → { hosts:[…], errors:[…] }
```

Parsing / normalization rules:

| Field | Rule |
|---|---|
| `host` | Split off `=label` first (first `=`), then split off `:port` (last `:`). Sanitize with **`sanitizeHostPort`** discipline (strip whitespace + metacharacters — the badge's fixed-Low generalized here, FR-04/NFR-03). Empty after sanitize ⇒ **malformed** (recorded in `errors`, not fabricated). |
| `port` | Digits only; `1–65535`. Absent/invalid ⇒ default `config.port`. A present-but-invalid port ⇒ **malformed entry** (honest error), not a silent coercion. |
| `label` | Everything after the first `=`. **Free-form, retained raw, escaped at render** (never sanitized into meaninglessness, never interpolated into HTML/style). Default = the sanitized `host` string. |

**Local host always present (FR-02/FR-03).** After parsing, `parseHosts` prepends
the local host (`self:true`, `host = 'local'` sentinel or the bind host, `port =
config.port`, `label = 'This machine'` unless the operator labeled it) and
**dedupes**:

- **Dedup key** = `sanitizedHost:port`. A duplicate `host:port` collapses to one
  entry (first label wins; a later explicit label may override the default — Engineer
  picks the least-surprising rule and tests it, QA-03).
- **Self-identification (FR-03, the honest tradeoff).** An entry is treated as the
  local host — and served **in-process** (`buildState()`), never self-HTTP'd — when
  its sanitized host matches a **known local identity**: `127.0.0.1`, `localhost`,
  `::1`, `config.host` when pinned, or the machine's **tailnet IPv4** (reuse
  `tailnetIPv4()` from `src/net.js`) on `config.port`. **Tradeoff, stated:** exact
  identification is not always possible — a peer reachable via a hostname alias or a
  second tailnet name we don't resolve would be polled over HTTP as a "remote" that
  is really us. That is a *correctness-preserving* miss (it double-*shows* the local
  reading under two labels, honestly, and issues one loopback-ish fetch) — **never a
  correctness hazard**: it cannot cause a fabricated reading, and the account-wide
  limits honesty (below) covers the "same numbers shown twice" case regardless. We do
  **not** attempt DNS resolution to unify aliases (a subprocess/blocking-I/O risk off
  budget); we match the cheap known-identity set and accept the documented miss.

**Effective host set** = `[ localHost, …dedupedRemotePeers ]`. Empty/unset
`LLMDASH_HOSTS` ⇒ `[ localHost ]` ⇒ single-host behavior, **no dead knob** (FR-02).

`errors[]` (malformed entries) are surfaced honestly — a startup log line **and** a
`healthLines()` line (FR-04/FR-19) — never silently dropped, never fabricated into a
reading.

---

## Timeout / concurrency / body-cap (OQ-06)

Three concrete bounds, in `config.js` (each a real knob that drives behavior — no
dead knobs; all clamped both ways like the existing `*_MS` knobs):

| Knob | Env var | Default | Justification |
|---|---|---|---|
| `peerTimeoutMs` | `LLMDASH_PEER_TIMEOUT_MS` | **3000** | The badge uses 2 s for menu-bar snappiness; the poller has a 60 s tick of headroom, so 3 s tolerates a tailnet round-trip to a busy peer that is building its own `/api/state` (Codex activity compute) without the menu bar's twitchiness. Clamp ≥ 500 ms, ≤ 30 s. |
| `peerConcurrency` | `LLMDASH_PEER_CONCURRENCY` | **4** | Fan out, don't serialize (FR-08); don't unleash unbounded sockets on a large list. 4 covers the realistic personal-tailnet size (2–5 machines) in one wave; a longer list drains through a bounded worker pool. Clamp ≥ 1, ≤ 32. |
| `peerBodyCapBytes` | `LLMDASH_PEER_BODY_CAP_BYTES` | **262144** (256 KiB) | A real `/api/state` is a few KB (measured ~2 KB local); 256 KiB is generous headroom for a fat future payload yet far below anything that could exhaust memory. A peer streaming past the cap is **aborted** and resolved to `peer-error` (FR-22). Clamp ≥ 16 KiB, ≤ 8 MiB. |

**No-pile-up guarantee (FR-08).** The fan-out is `await`ed within the tick and each
fetch is `peerTimeoutMs`-bounded, so a tick cannot outrun `peerTimeoutMs` (+ the
existing local poll work). A **single-flight guard per tick** (`inFlight` boolean in
the poller, mirroring `claude-refresh`'s single-flight) means a still-running fan-out
from a slow prior tick is not restarted — the next tick's `run()` sees `inFlight` and
returns, so in-flight fetches never accumulate across ticks. The cache retains each
host's **last successful** reading only until its next attempt overwrites it (with a
success or a named failure — never silently kept as fresh, FR-09).

---

## Modules

| File | Change |
|---|---|
| `src/hosts.js` | **New.** `parseHosts()` (config → effective host set + errors), `isLocalHost()` (identity match), `normalizePeerState()` (clamp/normalize/escape a fetched payload into the `/api/state` shape, FR-07/FR-20), `fetchPeerState(host, port, {timeoutMs, bodyCapBytes})` (hardened `node:http` GET — no redirect follow, body cap, bounded timeout). Node builtins only. |
| `src/host-cache.js` | **New.** The in-memory per-host cache: `setHost(key, HostReading)`, `getCombined()` → `{ hosts:[…], generatedAt }` assembled off the request path. Process-lifetime module state (like `claude-refresh`'s failure state). |
| `src/poller.js` | **+fan-out.** After the local Claude/Codex poll, run `pollPeers()` — bounded-concurrency fan-out over the remote host set, writing each result into `host-cache`; the local host is written from `buildState()` in-process (never self-HTTP). Single-flight guard. |
| `src/server.js` | **+one handler:** `GET /api/hosts` → `JSON.stringify(getCombined())` from cache, no fetch/subprocess/blocking I/O (NFR-02). Same security headers, same 405 for non-GET/HEAD. **`/api/state` handler untouched.** |
| `config.js` | Three clamped knobs (above) + `LLMDASH_HOSTS` (parsed lazily via `parseHosts`, exposed as `config.hosts` / a getter). |
| `src/health.js` | `healthLines()` gains a **per-configured-peer line** (reachable / last error / the fix) + a malformed-entry line; a new startup disclosure line (how many peers, to which `host:port` outbound reads go). Cheap checks only — reads the cache's last state, no fresh fetch, off the request path. |
| `public/app.js` | **+host dimension:** a `renderHosts(combined)` outer loop that calls the **existing** `toolHtml()` per host; a `hostDiagnostic` → copy map (own-key lookup, escaped `detail`), the account-wide-limits label. Single-host mode = today's render, unchanged. |
| `public/index.html` | A `#hosts` container (the multi-host section); the existing `#tools` path stays for single-host mode (or `#hosts` renders the single host with no chrome — Engineer/Designer pick, see *Client*). |
| `public/styles.css` | Host-group chrome (Designer owns exact layout). |
| `README.md` | The `LLMDASH_HOSTS` section (format, tailnet-only read-only outbound posture, local-host-always-included, the three bound knobs, the single-host default). |
| `tests/hosts-config.test.js`, `tests/hosts-fanout.test.js`, `tests/hosts-degradation.test.js`, `tests/state-unchanged.test.js`, `tests/fixtures/state-*.json` | **New.** (See *Test seams*.) |

**Untouched:** `src/db.js`, `src/stats.js`, `src/codex-stats.js`, `src/trends.js`,
the `usage_snapshots` schema, and the entire `/api/state` code path. The badge is
untouched (badge-multi-host is the deferred follow-on, OQ-05).

---

## Control flow — one poller tick

```
pollOnce()                                             [src/poller.js]
├─ (existing) claude refresh → claude snapshot → codex snapshot → stat caches   (LOCAL, unchanged)
├─ host-cache.setHost(localKey, { self:true, reachable:true, state: buildState(), fetchedAt })
└─ pollPeers()                                         [uses src/hosts.js]
     for each REMOTE host in the effective set, bounded to peerConcurrency:
        fetchPeerState(host, port, {timeoutMs, bodyCapBytes})
          success (200 + parseable + within cap + no cross-host redirect):
             normalizePeerState(payload) →  clamp used-% 0–100 · normalize timestamps to
             canonical ISO (drop/mark-unusable on unparseable; NEVER default to now;
             preserve a valid peer capturedAt as-is, clock-skew intact, FR-07/QA-27) ·
             leave free-form fields raw for render-time esc()
             → setHost(key, { reachable:true, state: normalized, fetchedAt })
          failure (timeout | ECONN* | non-200 | bad JSON | oversized | redirect-to-other-host):
             → setHost(key, { reachable:false, hostDiagnostic:{reason, cause, detail?}, fetchedAt })
             (the prior cache entry is REPLACED by the failure — a stale reading is never
              silently kept as fresh; if "show last-known, flagged" is chosen, the last
              state rides along under an explicit stale flag, never as reachable/fresh, FR-09)
```

Peer polling runs **only** inside `pollOnce()` — never on the HTTP path (FR-05,
NFR-02). The `await` on the fan-out is bounded by `peerTimeoutMs` × ceil(N /
concurrency); the 60 s tick tolerates it. **No transitive fan-out (FR-21/NFR-03):**
the fetch target is always a peer's **`/api/state`** (never `/api/hosts`), so a
multi-host peer contributes only its own reading; llmdash never fetches a host
*derived from* a peer payload.

## Serving — off the request path (NFR-02, FR-06)

```
GET /api/hosts                                          [src/server.js]
  → getCombined()  = { hosts: [...cache entries...], generatedAt }   // pure cache read
  → JSON.stringify → 200 application/json; no-store
  (no fetch, no subprocess, no blocking I/O — same discipline that keeps Codex's
   subprocess and the Claude probe off the request path)
```

Same `SECURITY_HEADERS`, same non-GET/HEAD → 405, same `no-store` (NFR-04).

## Hardened peer fetch (NFR-03 — the SSRF-shaped surface)

`fetchPeerState` extends the badge's `fetchState` with the outbound-posture
requirements:

- **Explicit configured hosts only** — targets come from `parseHosts` alone; no
  discovery, no auto-enumeration, no host derived from any payload (FR-21).
- **Read-only, credential-free** — only `GET /api/state`; no other method, no
  headers carrying credentials, no write path.
- **Bounded timeout AND body cap** — `req.timeout = peerTimeoutMs`; accumulate the
  body under `peerBodyCapBytes` and `req.destroy()` + reject on overflow (FR-22).
- **No surprising redirect** — `http.get` does **not** follow redirects by default;
  treat any `3xx` as `peer-error` (a peer must not bounce the read to an
  unconfigured/unexpected target). Do not opt into redirect-following.
- **Every peer field is data** — `normalizePeerState` clamps numbers and normalizes
  timestamps at ingest; the client `esc()`s every free-form field at render (labels,
  diagnostic strings). No peer field is ever interpolated into a style or raw HTML
  (NFR-04). Style values stay literals/coerced numbers.

---

## Per-host degradation & the new reason codes (FR-09, FR-11)

Two levels of diagnostic, both **enum reason codes, own-key (`hasOwnProperty`)
mapped client-side, free-form fields escaped** — the shipped convention:

**1. Per-tool `limitsDiagnostic` (unchanged, per host).** A peer's tool objects carry
their own existing codes (`stale-reading`, `no-statusline-reading`,
`auto-refresh-failing`, `auto-refresh-disabled`, `codex-cmd-failed`, `no-reading`)
verbatim across the wire; the client maps them exactly as today, now inside the
per-host render loop. **Reserved names `auto-refresh-failing` / `auto-refresh-disabled`
are not reused** for peer failures (CLAUDE.md).

**2. New per-host `hostDiagnostic` (new, at the `HostReading` level).** When a peer's
*fetch* fails (not its tool data), the host carries:

| `reason` (new enum) | Trigger | `cause` |
|---|---|---|
| `peer-unreachable` | timeout, connection refused, DNS/connect error | `timeout` \| `connect` |
| `peer-error` | non-200, unparseable JSON, oversized body, redirect | `http-<status>` \| `bad-json` \| `oversized` \| `redirect` |

`detail` is an escaped free-form string (e.g. the sanitized error message); it is
**never rendered raw** (own-key mapping + `esc()`). Copy names **which host and why**
(FR-09): e.g. *"Desktop is unreachable — no response within 3 s (peer-unreachable)."*
A failed host is **never** shown as a fabricated zero, **never** as fresh, and any
last-known reading (if the Designer chooses "show last-known, flagged") is explicitly
stale-flagged (FR-09). The collapse-into-one-code-with-a-`cause` option is available
to the Engineer; the requirement is a **named, enum, escaped** state.

**Precedence:** `hostDiagnostic` (the host can't be read at all) is presented at the
host level and **supersedes** per-tool diagnostics for that host (there is no tool
data to diagnose). A reachable host shows no `hostDiagnostic`; its tools show their
own `limitsDiagnostic` as today. One host's state never affects another's (FR-13).

**Per-host freshness (FR-10).** Each host's tool objects carry the **server-supplied**
`freshness` thresholds as received from that peer's `/api/state`
(`freshForMs`/`staleAfterMs`); the client derives each host's fresh/aging/stale band
**live on the render tick** via the existing `ageBand()` — never hardcoded. Codex
stays `freshness:null` (no band), per tool, per host. A peer's `capturedAt` is
honored as captured (normalized to canonical ISO, **never re-stamped to local now**),
so a peer clock skew is preserved and its band reflects the peer's stated capture
time (QA-27).

---

## Account-wide-limits honesty (FR-15, NFR-05) — the load-bearing product call

**Shipped floor (label-only, always present):** every host's limit gauges are
**labeled as account-wide** — reusing the product's existing account-wide-vs-local
language (the footer already says *"Limits: account-wide · Activity: local session
logs"*; `trends.js` charts already carry `'account-wide · snapshots'`). Per-host
differentiation is **led by activity** (the genuinely per-machine data, FR-14), so N
identical meters never *imply* N independent budgets. This label stands **even if the
optional detection below is not built.**

**Optional refinement (OQ-04, Architect-cheap, flagged for the Designer/user):**
detect account-sameness by comparing the limit **tuple** across hosts — the natural
key is the pair of window **`resetsAt`** epochs (+ `usedPct`), since two machines on
the same account share identical reset windows. When two reachable hosts' Claude (or
Codex) reset epochs match within a small tolerance, **collapse or annotate** the
repeated meter ("same account — shown once / same as <host>"); when they differ,
render each host's meter as its own. This is a *pure client-side derivation* over the
combined payload (no new server field, no new data) — cheap and honest — but the
**exact copy and visual treatment are the Designer's, and the framing is flagged for
the user to ratify.** The observable requirement: (a) limits labeled account-wide on
every host; (b) the UI does not read as N independent budgets when meters are
identical; (c) different-account hosts read as distinct.

---

## Client rendering (FR-17, FR-18)

- **Single-host mode** (`hosts.length === 1 && hosts[0].self`, or `/api/hosts`
  unused): render **exactly today** — `#tools` via `toolHtml()`, no host chrome, no
  per-host label, no offline rows (FR-18/QA-18). The Engineer may keep the existing
  `/api/state` fetch for this mode and only switch to `/api/hosts` when peers are
  configured, or always use `/api/hosts` and branch on `hosts.length` — both satisfy
  FR-18; the simpler is "always `/api/hosts`, branch on length."
- **Multi-host mode** (`hosts.length > 1`): `renderHosts()` loops hosts →per host, a
  labeled group header (escaped label + freshness/offline state) wrapping the
  **existing** `state.tools.map(toolHtml)` and the existing headroom cue. A failed
  host renders its `hostDiagnostic` copy in place of tool blocks (never a gauge of
  zeros). Gauges/pacing/tiles/mix **actually render per host** through the unchanged
  renderer (QA-17 — verify it renders, not just that the page loads).
- The renderer and store are **not forked** — a host is an outer loop over the
  existing per-tool render; peers never touch `db.js`.

---

## Disclosure surfaces (FR-19)

- **Startup log:** a line stating how many peers are configured and to which
  `host:port` outbound reads will go (or, when none, *"No peers configured — this
  instance issues no outbound reads (single-host)."*). Any malformed `LLMDASH_HOSTS`
  entry logged with the fix. Mirrors the existing network-binding disclosure.
- **`healthLines()`:** a **per-configured-peer** line (reachable? last error? the
  fix) reading the cache's last state — a cheap check, **off the request path**, no
  fresh fetch. When no peers: a line stating the single-host / no-outbound reality.
  Malformed entries get their own honest line.
- **README:** the `LLMDASH_HOSTS` env var + `host[:port][=label]` format; the
  **tailnet-only, read-only outbound** posture (only `GET /api/state`, no
  credentials, no discovery, no transitive fan-out); the local-host-always-included
  rule; the three bound knobs and defaults; and that an unset var = today's
  single-host behavior.

---

## Config / env (no dead knobs — each drives behavior)

| Key | Env var | Default | Drives |
|---|---|---|---|
| `hosts` (parsed) | `LLMDASH_HOSTS` | unset ⇒ `[local]` | the effective host set → poller fan-out targets + the combined view |
| `peerTimeoutMs` | `LLMDASH_PEER_TIMEOUT_MS` | 3000 (clamp 0.5–30 s) | each peer fetch's timeout bound |
| `peerConcurrency` | `LLMDASH_PEER_CONCURRENCY` | 4 (clamp 1–32) | fan-out parallelism cap |
| `peerBodyCapBytes` | `LLMDASH_PEER_BODY_CAP_BYTES` | 262144 (clamp 16 KiB–8 MiB) | per-peer response byte cap |

Reused unchanged: `config.port` (peer default port + local-identity check),
`pollIntervalMs` (fan-out cadence), the freshness knobs (per host, from each peer's
own payload).

---

## Test seams (Stage-6 QA table)

Structured so every QA row maps to a **pure or injectable** test — no live tailnet
peer needed; a scratch loopback server (the badge's `tests/helpers/menubar-run.js`
pattern) stands in for a peer's `/api/state`, and `fetchPeerState` takes an injectable
fetch/agent for fault injection.

- **`parseHosts` — pure config tests** (`tests/hosts-config.test.js`): `host`,
  `host:port`, `host=label`, `host:port=label`, labels-with-spaces; port default =
  `config.port`; malformed port/host → `errors[]` not fabricated; sanitize strips
  whitespace/metacharacters (QA-01, QA-04); empty/unset ⇒ `[local]` only (QA-02);
  local listed explicitly (or dup `host:port`) ⇒ counted once, `self:true`,
  in-process (QA-03); `isLocalHost` matches loopback/localhost/tailnet-IP.
- **`normalizePeerState` — pure ingest tests**: used-% >100/<0 → clamped 0–100;
  bad/missing timestamp → host marked unusable/offline, **not** defaulted to now; a
  valid skewed `capturedAt` preserved as-is (QA-07, QA-27); free-form fields survive
  for render-time escape; missing/extra fields → partial/offline, no crash (QA-22,
  shape tolerance FR-20).
- **`fetchPeerState` — injected-fetch fan-out** (`tests/hosts-fanout.test.js`):
  against scratch loopback fake peers — success caches; non-200/bad-JSON/oversized/
  redirect → `peer-error`; timeout/refused → `peer-unreachable` (QA-09, QA-24,
  QA-25); a redirect to another host is **not followed** → `peer-error` (QA-24);
  body cap aborts an oversized stream (QA-25). One slow/hung peer + fast peers: tick
  completes within the bound, fast peers + local render, in-flight fetches don't
  accumulate across ticks (single-flight, QA-08).
- **Poller integration**: `pollPeers` writes the cache; local host is in-process
  (no self-HTTP where identifiable) (QA-05); **no peer fetch from any HTTP handler**
  — static/inspection assertion that only `pollOnce` calls `fetchPeerState`
  (QA-05, QA-21).
- **`getCombined` / `/api/hosts` handler** (`tests/hosts-degradation.test.js`):
  request performs no fetch/subprocess (cache read only), payload carries every
  host's full per-tool picture + its own freshness/offline state (QA-06); each host
  independent — one offline host doesn't flag/suppress another (QA-13); per-host
  `limitsDiagnostic` + new `hostDiagnostic` render by own-key lookup with escaped
  `detail`, reserved `auto-refresh-*` not reused (QA-11); per-host freshness bands
  derived from server-supplied thresholds, Codex no-band, independent per host
  (QA-10); per-host activity distinct / honest "not available" not fabricated zeros
  (QA-14).
- **Account-wide honesty** (client-derivation test if OQ-04 refinement is built):
  identical reset-epoch hosts collapse/annotate; different-epoch hosts read distinct;
  the account-wide label present regardless (QA-15).
- **`/api/state`-unchanged guard** (`tests/state-unchanged.test.js`): a fixture-based
  contract test asserting `buildState()`'s field set and meanings are unchanged, and
  the `/api/state` handler response is byte-identical to a pre-feature golden — the
  structural proof of FR-16/QA-16. The badge's existing tests must keep passing
  untouched.
- **Hardening preserved** (extend `tests/server.test.js`): `/api/hosts` carries the
  baseline headers, rejects non-GET/HEAD with 405, is `no-store` (QA-26); no peer
  field interpolated into a style/raw HTML.
- **Zero deps / no build** (QA-20): `package.json` runtime deps still 0; fan-out
  uses `node:http` only.
- **Client render** (QA-17): the multi-host section actually renders each host's
  gauges/pacing/tiles/mix (browser-render verification per the "renders, not just
  loads" convention) — Stage-6 UI check.

---

## Risks the Engineer inherits

1. **`/api/state` must stay byte-for-byte unchanged (FR-16/QA-16).** Do not add a
   field to `buildState()` or its handler. The account-sameness detection is
   **client-side over `/api/hosts`** — it needs no new server field. Keep the
   golden-contract test as the guard; the badge's tests must pass untouched.
2. **No transitive fan-out (FR-21/NFR-03).** The fan-out target is always a peer's
   **`/api/state`**, never `/api/hosts`, and never a host derived from a payload.
   This is structural given the separate endpoints — don't let a refactor route the
   fan-out through `/api/hosts`.
3. **The SSRF-shaped surface is for the Auditor.** `fetchPeerState` must enforce:
   configured-hosts-only, credential-free `GET /api/state` only, bounded timeout
   **and** body cap, **no redirect-follow to another host** (treat 3xx as
   peer-error), and clamp/normalize/escape every peer field. The `sanitizeHostPort`
   bug class lives on the host list and every rendered peer field.
4. **Self-identification is best-effort (FR-03).** The known-identity match
   (loopback/localhost/tailnet-IP/`config.host`) can miss a hostname alias — a
   correctness-preserving miss (double-shows the local reading, honestly; one extra
   loopback-ish fetch), never a fabricated reading. Document it; don't add DNS
   resolution (subprocess/blocking-I/O off budget).
5. **Single-flight + bounded fan-out** must prevent pile-up: a slow prior tick's
   fan-out blocks the next tick's start (`inFlight` guard) so in-flight fetches never
   accumulate (FR-08/QA-08).
6. **Shape tolerance (FR-20/NFR-06).** A peer running an older/newer llmdash with
   missing/extra fields must degrade to partial/offline, never crash the poller or
   `/api/hosts` — `normalizePeerState` is defensive, and `getCombined` tolerates a
   partial `state`.

## Open sub-decisions left to the Engineer / Designer

- **OQ-04 account-sameness presentation** — label-only floor is settled; the
  detect-and-collapse refinement's **copy and visual treatment are the Designer's,
  flagged for the user to ratify.**
- **FR-09 offline treatment** — "show last-known, flagged as stale" vs "show
  offline-only" is the Designer's call; the honesty floor (never stale-as-fresh) is
  settled.
- **Client fetch mode** — always `/api/hosts` (branch on `hosts.length`) vs keep
  `/api/state` for single-host and switch to `/api/hosts` when peers exist — both
  satisfy FR-18; Engineer picks the simpler.
- **Reason-code shape** — two codes (`peer-unreachable`/`peer-error`) vs one with a
  `cause` — Engineer's call; the requirement is named/enum/escaped.
