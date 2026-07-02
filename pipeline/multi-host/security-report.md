# Security Review — Multi-Host

**Date:** 2026-07-02
**Feature:** multi-host
**Stack:** node http (minimal vanilla `node:http`, zero runtime deps) — no stack checklist file; reviewed against CLAUDE.md security conventions + the prior features' security-report house format (claude-auto-refresh, menu-bar-badge)
**Checklist basis:** Feature-specific checks derived from the multi-host threat model (the new OUTBOUND surface, NFR-03) + the standing llmdash conventions (baseline security headers, method-lock, escape-at-render, clamp/normalize-at-ingest, enum reason codes, no dead knobs, tailnet single-user threat model)
**Outcome:** **PASSED WITH NOTES**

---

## Summary

Multi-host flips llmdash from serve-only to issuing outbound HTTP reads to
operator-configured tailnet peers — the SSRF-shaped surface at the heart of this
review. That surface is well built: fetch targets come only from
`LLMDASH_HOSTS` (no discovery, no host derived from a payload → no transitive
fan-out), the request is a credential-free `GET /api/state` built from an
options object (not a URL string) with a hardened host/port sanitizer, redirects
are never followed (3xx → `peer-error`), and the fetch is both timeout-bounded
and body-capped. `/api/state` and `buildState()` are byte-for-byte unchanged;
`/api/hosts` is a pure in-memory cache read off the request path; peers are never
persisted. One real defect was found and **fixed in-stage**: peer-supplied
*activity* numeric fields were passed through un-coerced at ingest and reached
two unescaped client render paths, permitting markup injection (script execution
already blocked by the existing CSP; rated Medium). With that resolved, the
feature is clear to deploy.

---

## Findings

### 1. Peer activity numeric fields were un-coerced at ingest → markup injection into two unescaped render paths

**Severity:** Medium
**Location:** `src/hosts.js` — `normalizeActivity()` (was lines 221–231); render sinks `public/app.js:8-13` (`fmtTokensHtml` `String(n)` fallback) and `public/app.js:115` (`a.sessionsToday + ' sessions'`, raw concatenation)
**Status:** **Resolved** (fixed in-stage; `npm test` green at 262/260/2)

**Description:** A fetched peer's `/api/state` is semi-trusted data. Every other
peer numeric field is coerced/clamped at ingest (`normalizeWindow` clamps
used-%, `normalizeHeadroom`/`normalizeProjection` coerce their numbers), but
`normalizeActivity` returned the peer's `activity` object **verbatim** whenever
`hasData !== false`. The client then renders several activity fields through
paths that do **not** escape:

- `fmtTokensHtml(n)` ends in `return String(n)` — a non-numeric value renders
  raw. Reached by `a.burnTokensPerHour`, `a.tokens.{last5h,week,today}`, and the
  token-mix legend counts.
- `tilesHtml` builds the "sessions" note as `a.sessionsToday + ' sessions'` —
  raw string concatenation, no `esc()`.

A hostile peer sending, e.g., `activity.tokens.today = "<img src=x onerror=…>"`
or `activity.sessionsToday = "<img …>"` therefore injected that markup into
`innerHTML`. I confirmed the survival empirically: the `<img …>` string reached
the rendered HTML unescaped in both paths. The activity block is reachable
(`hasData:true` renders it via `activityOnlyHtml`/`fullHostToolHtml` →
`tilesHtml`). The stale in-code comment on `normalizeActivity` asserted "text is
esc()'d" — false for these two sinks.

**Why Medium, not High/Critical:** script execution is **blocked by the existing
CSP** — there is no `script-src 'unsafe-inline'` (script falls back to
`default-src 'self'`), so an `onerror=` handler does not fire, and injected
`img`/external `src` is blocked by the same `default-src 'self'`. The residual
risk is same-origin markup/layout injection (misleading content, a phishing-style
overlay) by a tailnet peer — a real defect and a direct violation of the
"escape text / never interpolate untrusted input into raw HTML" convention, but
not remote code execution against a compliant browser. It does **not** clear the
Critical/High bar and so does not block deployment.

**Remediation (applied):** Coerce every rendered activity number to a finite
number or `null` **at ingest** in `normalizeActivity` — the same discipline the
rest of the normalizer already applies — so no peer string can reach an
unescaped render path. Verified: hostile HTML strings (`<img>`, `<script>`,
`;background:url()`) all collapse to `null`/`0` (rendering as `—`/`0`);
legitimate activity is preserved unchanged; `hasData:false` still yields the
honest not-available state; full suite green.

---

### 2. Operator-supplied host label appears verbatim in the startup terminal log

**Severity:** Informational
**Location:** `src/health.js` — `peerHealthLines()` (`r.label`, lines 112/114/117), `peerDisclosureLine()` malformed-entry echo (line 94)
**Status:** Accepted

**Description:** A host label / malformed-entry string from `LLMDASH_HOSTS` is
printed into the startup console lines unescaped. This is the accepted posture,
not a finding to fix: the label is **operator-controlled configuration** (the
same operator reading the log), not peer-supplied data, and a terminal log line
is plain text, not an HTML/style/SQLite render surface. The escaping requirement
applies to the rendered surfaces — all of which do escape it (`esc()` on every
peer field in `public/app.js`). Flagged for completeness only; consistent with
the standing tailnet single-user threat model and the QA report's noted
observation.

---

### 3. Best-effort self-identification can issue one loopback-ish fetch to the local machine under an unresolved alias

**Severity:** Informational
**Location:** `src/hosts.js` — `isLocalHost()` (no DNS, by design)
**Status:** Accepted (documented, FR-03)

**Description:** `isLocalHost` matches loopback forms, the pinned bind host, and
the tailnet IPv4 — but performs **no DNS** (a deliberately-declined
subprocess/blocking-I/O cost). A peer listed under a hostname alias or a second
tailnet name that actually resolves to this machine would be polled over HTTP as
a "remote." This is a **correctness-preserving** miss: it issues one extra
loopback-ish `GET /api/state` to a host the operator explicitly configured, and
at worst double-*shows* the local reading honestly (the account-wide-limits
collapse merges the identical numbers). It never fabricates a reading and never
targets a host outside the configured list. No security consequence beyond one
self-directed request; accepted as designed.

---

## Outbound-surface trace (NFR-03 — the defining risk)

The six required adversarial checks on the new outbound surface, traced in code
and, where cheap, confirmed empirically:

1. **Target control — configured hosts only.** `fetchPeerState(host, port, …)`
   is called only from `pollPeers`, over `remoteHosts(parseHosts())` — the
   operator's `LLMDASH_HOSTS` list. No target is ever derived from a fetched
   payload; `normalizePeerState` reads only limit/activity/diagnostic data and
   never a host or URL. **No transitive fan-out**: the path is a hardcoded
   `path: '/api/state'`, never `/api/hosts`, so a peer's own peer list is never
   traversed. Structural.

2. **No redirect follow.** `http.get` (node builtin) does **not** auto-follow
   redirects, and the handler explicitly maps any 3xx → `peer-error/redirect`
   and drains the response. Confirmed empirically: a 302 pointing at a second
   server left that pivot server **never hit** ("PIVOT HIT" never printed) — the
   SSRF-pivot vector is closed.

3. **Bounded timeout AND body cap.** `timeout: peerTimeoutMs` bounds a hung peer
   (→ `req.destroy` → `peer-unreachable/timeout`); the `res.on('data')` handler
   counts bytes and, on exceeding `peerBodyCapBytes`, calls `res.destroy()` +
   `req.destroy()` and resolves `peer-error/oversized`. The cap is checked
   **before** appending the chunk, so accumulation cannot overshoot past a chunk
   boundary. A hostile peer can neither hang the poller nor OOM the process.

4. **Credential-free, method-locked.** The request carries no auth header, no
   cookie, no token — only `GET /api/state`. No other method or path is ever
   issued. Nothing sensitive leaves the machine.

5. **URL construction from host/port.** The fetch uses an **options object**
   (`{ host, port, path }`), not a URL string — so a pathological host cannot
   restructure the request line. `sanitizeHostPort` additionally strips
   everything outside `[A-Za-z0-9._:\-\[\]]`. Verified adversarially: `/`, `@`,
   CRLF, space, `?`, `#`, `%` are all removed, so userinfo re-pointing, path
   injection, header injection, and query/fragment confusion all fail — a
   malformed host degrades to a garbled name that fails DNS/connect
   (`peer-unreachable`), never to a *different valid* target. The sanitizer is
   applied to both the fetch target (`fetchPeerState`) and every rendered
   host/port (`esc()` around `host.host`/`host.port` in `public/app.js`).

6. **Every peer field untrusted, in and out.** INGEST (`normalizePeerState`):
   used-% clamped 0–100 with `remainingPct` re-derived from the clamped value;
   timestamps normalized to canonical ISO via `Date.parse` → `toISOString`,
   `null` on unparseable, **never** defaulted to now (a 47h-skewed capture is
   preserved as-is, never re-stamped fresh); numeric fields coerced to finite or
   null (Finding 1 closed the activity gap). RENDER (`public/app.js`): every
   free-form field (`host.label`, `tool.label`, `tool.plan`, diagnostic
   `detail`/`cmd`) passes through `esc()`; reason/cause codes are mapped by
   own-key (`hasOwnProperty` on `PEER_CAUSE_FRAGMENTS`/`AUTOREFRESH_CAUSE_
   SENTENCES`) so a `__proto__`/`constructor` reason falls to the generic
   fallback rather than an inherited method; and — critical under
   `style-src 'unsafe-inline'` — the one style sink (`gaugeHtml` bar width) only
   ever receives `win.remainingPct`, a number clamped to [0,100] at ingest, so a
   peer cannot break out of a `style="width:…"`.

---

## Checks Performed

| Check | Result |
|---|---|
| Fetch targets come only from `parseHosts(LLMDASH_HOSTS)` — no discovery/enumeration | Pass |
| No transitive fan-out — fetch path hardcoded `/api/state`, never derived from a payload | Pass |
| No redirect follow — 3xx → `peer-error/redirect`; pivot server never hit (empirical) | Pass |
| Per-peer timeout bounds a hung peer (`peerTimeoutMs`, destroys request) | Pass |
| Body cap aborts an oversized/streaming body (`peerBodyCapBytes`, checked before append) | Pass |
| Credential-free — no auth header/cookie/token attached | Pass |
| Method/path-locked — only `GET /api/state` | Pass |
| URL built from options object, not a string (no request-line restructuring) | Pass |
| `sanitizeHostPort` neutralizes `/ @ CRLF space ? # %` (empirical) | Pass |
| Sanitizer applied to both fetch target and rendered host/port | Pass |
| Malformed host degrades to connect-failure, never a different valid target | Pass |
| Ingest: used-% clamped 0–100, `remainingPct` re-derived from clamped value | Pass |
| Ingest: timestamps → canonical ISO, null on bad, never defaulted to "now" | Pass |
| Ingest: clock skew preserved (not re-stamped local now) | Pass |
| Ingest: numeric fields coerced to finite/null (limits/headroom/projection) | Pass |
| Ingest: activity numeric fields coerced to finite/null | Finding 1 — Resolved |
| Ingest: `null` on non-object / no tools array → offline, not fabricated | Pass |
| Render: every free-form peer field escaped via `esc()` | Pass |
| Render: reason/cause codes mapped by own-key (`hasOwnProperty`) — no proto bypass | Pass |
| Render: no peer value reaches a `style=` except a clamped/coerced number | Pass |
| Peer-supplied activity string cannot reach an unescaped render sink | Resolved (was Finding 1) |
| `/api/hosts`: baseline security headers (nosniff, CSP, referrer-policy) | Pass |
| `/api/hosts`: non-GET/HEAD → 405 with `allow: GET, HEAD` | Pass |
| `/api/hosts`: `cache-control: no-store` | Pass |
| `/api/hosts`: pure cache read — no fetch/subprocess/blocking I/O on request path | Pass |
| `/api/hosts`: exposes only the existing per-tool shape (no new sensitive field) | Pass |
| `/api/state` + `buildState()` byte-for-byte unchanged (golden guard, tamper-verified) | Pass |
| `host-cache.js`: in-memory only — peers never written to SQLite/`db.js` | Pass |
| `config.js`: peer knobs clamp both ways, no dead knob | Pass |
| `config.js`: `LLMDASH_HOSTS` malformed entries recorded honestly, never fabricated | Pass |
| `health.js`: peer health/disclosure are cheap fs/cache reads off the request path | Pass |
| `health.js`: operator label in log line — accepted informational (config, not peer) | Finding 2 — Accepted |
| Self-identification best-effort, no DNS — accepted correctness-preserving miss | Finding 3 — Accepted |
| DoS: bounded concurrency (`peerConcurrency`) caps outbound sockets | Pass |
| DoS: single-flight `inFlight` guard prevents tick pile-up under slow/hostile peers | Pass |
| Zero runtime deps / no build step preserved (fan-out uses `node:http`) | Pass |
| Reserved `auto-refresh-*` reason codes not reused | Pass |
| `npm test` baseline green after in-stage fix (262 / 260 pass / 2 skip) | Pass |

---

## Convention Flags

- **Coerce externally-sourced numbers at ingest — including nested/aggregate
  objects, not just the top-level meter.** Finding 1 arose because the ingest
  normalizer clamped the limit/headroom numbers but passed the *activity* object
  through verbatim, and two client render helpers (`fmtTokensHtml`'s `String(n)`
  fallback, `sessionsToday` concatenation) do not escape. The standing rule
  should read: any externally-sourced numeric that reaches a render sink must be
  coerced to a finite number (or null) at ingest, and this applies to every
  nested field of a fetched payload — a "looks like data, keep as-is" pass on a
  sub-object is a gap when a downstream formatter has an unescaped string path.
