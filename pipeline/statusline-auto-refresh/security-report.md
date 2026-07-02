# Security Review — statusline-auto-refresh (Branch B)

**Date:** 2026-07-01
**Feature:** statusline-auto-refresh — honest reading-age freshness layer (Branch B: zero auto-spawn machinery by design)
**Stack:** Vanilla Node (node:http, node:sqlite), zero dependencies, plain HTML/CSS/JS
**Checklist:** Project conventions (CLAUDE.md / DECISIONS.md) + general self-hosted web-app checks — no served checklist for this stack
**Outcome:** PASSED (both findings resolved in-stage by a targeted revision; each resolution independently re-verified — see finding statuses)

---

## Summary

This feature adds a server-supplied freshness block and a `stale-reading`
diagnostic to `/api/state`, client-side age bands and a stale note, one clamped
env knob, and startup/README copy — with zero new endpoints, zero new subprocess
sites, and zero new dependencies, all locked in place by a guard test suite that
runs on every `npm test`. All baseline controls (headers, CSP, 405, no-store,
traversal guard) were verified live on a sandboxed instance, and every new
dynamic value in the UI was traced to a numerically-derived or escaped source,
including a hostile-payload probe against the `capturedAt` ingest path. The
review initially raised two non-blocking findings (raw `capturedAt` served and
persisted verbatim; no upper bound on the freshness knob); the Engineer resolved
both in a targeted revision touching only `src/claude-limits.js`, `config.js`,
`README.md`, and `tests/claude-freshness.test.js` (all other audited files
byte-identical to the reviewed state), and both resolutions were independently
re-verified with fresh live probes on a second sandboxed instance. The suite now
passes 73/73.

---

## Findings

### Raw `capturedAt` string from the statusline file is served and persisted verbatim

**Severity:** Low
**Location:** `src/claude-limits.js:33–35` (ingest), `src/server.js:50–77`
(`toolWrap` passes `live.capturedAt` into `limits.*.capturedAt`),
`src/poller.js:12` (persisted to SQLite), `src/trends.js:42` (re-served as `t`)
**Description:** The new validity check accepts any string for which
`Number.isFinite(Date.parse(v))` holds, then keeps the **raw string** rather
than the parsed value. V8's date parser ignores arbitrary parenthesized content,
so a value like `"2026 (<img src=x onerror=alert(1)>)"` passes validation —
verified live: it is served verbatim over the tailnet at
`/api/state → tools[].limits.five_hour.capturedAt`, stored raw in
`usage_snapshots.captured_at` by the poller, and re-served at `/api/trends`.
**No exploitable sink exists today**: every client render path was traced —
`dataAt`, `freshness.capturedAt`, and `limitsDiagnostic.capturedAt` are
re-serialized via `toISOString()` server-side, and the client only ever passes
raw date fields through `Date.parse` + numeric formatting (`fmtAge`, `fmtDur`,
`ageBand`, chart coordinates) before `innerHTML`. The file is also written by
the user's own statusline script inside the local trust boundary. But the
project's own convention treats this file as externally sourced (its
`used_percentage` is clamped for exactly that reason), the string is now
persisted indefinitely, and one future renderer that prints a `capturedAt`
field raw would turn this latent value into stored XSS.
**Remediation:** Normalize at the ingest boundary in `src/claude-limits.js` —
keep the parsed value, not the raw string:
`capturedAt = new Date(Date.parse(parsed.capturedAt)).toISOString()`. One line;
canonicalizes everything downstream (API, SQLite, trends).
**Status:** Resolved — `src/claude-limits.js:35–41` now re-serializes at ingest
(`Date.parse` → `new Date(ts).toISOString()`); the mtime fallback path was
already canonical. Re-verified live (sandboxed instance, 127.0.0.1:18788): the
exact hostile payload emerges as `"2026-01-01T08:00:00.000Z"` at every
`capturedAt` field and the full `/api/state` body contains zero occurrences of
`<img` or `onerror`; regression tests added
(`tests/claude-freshness.test.js:127–143`, including a valid-but-non-ISO
normalization case).

### `LLMDASH_CLAUDE_MAX_AGE_MS` clamp has no upper bound; `2×` can overflow to `Infinity`

**Severity:** Informational
**Location:** `config.js:11–14` (clamp), `config.js:41` (`claudeStaleAfterMs`
getter), `src/server.js:112–116` (serialized into `/api/state`),
`public/app.js:40–47` (`ageBand`)
**Description:** The clamp handles non-finite, zero, negative, and empty values
correctly (verified by tests), but accepts any finite positive number. At
`LLMDASH_CLAUDE_MAX_AGE_MS ≥ ~9e307`, the derived `claudeStaleAfterMs`
(`2 × maxAge`) overflows to `Infinity`, which `JSON.stringify` serializes as
`null` (verified). The client's `age > f.staleAfterMs` then compares against
`null` (coerced to 0), marking every reading **stale immediately** — while the
server's own `ageMs > Infinity` check never emits the `stale-reading` note.
Result: a contradictory UI (crit pill, no explanatory note), the opposite of
the "never stale" intent of a huge threshold. Operator-controlled local config;
requires a deliberately absurd value; no security impact beyond a dishonest
freshness display, which this project treats as a defect class.
**Remediation:** Upper-clamp the knob (e.g. cap at 7 days = `604_800_000`), or
reject the value unless `Number.isFinite(2 * value)`.
**Status:** Resolved — `config.js:11–14` now applies
`Math.min(raw, 604_800_000)` (7-day ceiling) with the lower-bound fallback
intact. Re-verified live with `LLMDASH_CLAUDE_MAX_AGE_MS=9e307`: the wire
carries `freshForMs: 604800000, staleAfterMs: 1209600000` (finite — no
`Infinity → null`), the startup log honestly reports the clamped 168h/336h
bands, and the server-side stale diagnostic behaves consistently with the
client bands; regression tests added
(`tests/claude-freshness.test.js:149–168`: `Infinity`, `9e307`, ceiling±1,
plus a wire-finiteness assertion). README documents both clamp directions.

---

## Checks Performed

| Check | Result |
|---|---|
| **New API surface** | |
| `/api/state` freshness block carries only `capturedAt` + two config thresholds — no secrets, paths, or unexpected detail (verified live) | Pass |
| `stale-reading` diagnostic carries exactly `reason`/`capturedAt`/`ageMs`, all server-derived — consistent with the accepted tailnet informational posture (prior audit precedent); strictly less sensitive than fields already served (`dataAt`, usage percentages) | Pass |
| Exactly one diagnostic reason code or null per state; no stale fields on the no-reading code (tests QA-21/QA-25) | Pass |
| No new endpoints; `/api/state` and `/api/trends` remain the only API routes | Pass |
| **Client rendering (XSS)** | |
| Every new dynamic value in `innerHTML` is escaped (`esc()`) or numerically derived (`fmtAge`/`fmtDur` build from `Date.parse` + literals); pill words ("aging"/"stale") are literals | Pass |
| Raw external date strings never reach a render sink — after revision, no raw string survives ingest at all: every `capturedAt` field (API, SQLite, trends) is canonical ISO | Finding (Low) — Resolved, re-verified live |
| Hostile payload probe: `capturedAt` with embedded `<img onerror>` via V8 parenthesized-comment quirk — inert in all rendered output; after revision, absent from the entire wire payload (re-probed live) | Pass |
| No inline event handlers or `<script>` added; CSP `script-src` (via `default-src 'self'`) remains meaningful | Pass |
| Inline style values remain literal or numerically coerced (`width:${barWidth}%` from clamped numbers); new UI uses classes only (`.age-pill`, `.stale-note` — no inline styles) | Pass |
| **Input handling** | |
| `LLMDASH_CLAUDE_MAX_AGE_MS`: garbage / `0` / negative / empty / unset → default 300000; stale always derived 2× (tests, verified) | Pass |
| Knob upper bound / `Infinity` serialization edge — after revision, 7-day ceiling keeps `staleAfterMs` finite on the wire (re-probed live with `9e307`) | Finding (Informational) — Resolved, re-verified live |
| `capturedAt` validation: unparseable or missing → file-mtime fallback, never re-stamped "now" (malformed file can't read eternally fresh); file-vanished race → null (unknown age) | Pass |
| Far-future `capturedAt` (clock skew): never stale server-side; client clamps negative age to "just now" / fresh band (test + live probe) | Pass |
| `ageMs` math: `NaN` from a malformed `dataAt` fails the `> staleAfterMs` comparison safely → null diagnostic; no NaN/Infinity reaches the payload in any reachable state | Pass |
| `used_percentage` clamp to 0–100 at ingest unchanged | Pass |
| **No new attack surface by construction** | |
| Zero new `child_process` sites — guard test enumerates all runtime surfaces (`src/`, `public/`, `scripts/`, `config.js`) live from the working tree and allows only the pre-existing `src/codex-limits.js`; independently confirmed by grep | Pass |
| No new network calls (client fetches remain same-origin `/api/state`, `/api/trends`); no dead `[A]` env knobs (guard test) | Pass |
| No fs writes on the request path — the one addition is a `statSync` read fallback in `readClaudeLimits`, consistent with the existing cheap per-request file read | Pass |
| **Regression of controls (verified live, sandboxed instance on 127.0.0.1:18787)** | |
| `x-content-type-options: nosniff`, `referrer-policy: no-referrer`, CSP `default-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'` on all responses including 405 | Pass |
| Non-GET/HEAD → 405 with `Allow: GET, HEAD` (POST and PUT probed) | Pass |
| `cache-control: no-store` on statics and both API routes | Pass |
| Static path traversal guard intact (`/../config.js` → 404) | Pass |
| `package.json` still declares zero runtime and dev dependencies; no build step introduced (guard test QA-27) | Pass |
| Full test suite green: 73/73 after revision (71/71 at initial review) including new freshness and guard suites | Pass |
| Revision scope check: only `src/claude-limits.js`, `config.js`, `README.md`, `tests/claude-freshness.test.js` changed by the fix; `src/server.js`, `src/health.js`, `public/app.js`, `public/styles.css` diffs byte-identical to the reviewed state; poller/trends/db/package.json/guard tests untouched | Pass |
| Revision introduces no new concern: ingest change is a pure re-serialization (a numeric `capturedAt` now falls back to mtime — honest, not raw); `Date.parse`-finite guarantees `toISOString()` cannot throw (out-of-range dates parse to `NaN`); clamp is a pure `Math.min` | Pass |
| Rendered stat set did not silently drop fields (renderer-contract test, multi-source refactor convention) | Pass |
| **Docs and startup honesty** | |
| Startup log states the manual-refresh reality and surfaces the knob, its default, and the derived stale band (surface-defaults convention; verified live) | Pass |
| README: no auto-refresh/auto-spawn claims (guard-test enforced); documented bands (5m aging / 10m stale, 2× derived, single knob) match code defaults exactly; after revision, both clamp directions (lower fallback, 7-day ceiling) documented | Pass |

---

## Convention Flags

- Normalize externally-sourced timestamps to canonical ISO at the ingest
  boundary — `Date.parse` validation alone does not guarantee a clean string
  (V8 accepts arbitrary parenthesized content inside date strings), so store
  and serve `new Date(Date.parse(v)).toISOString()`, never the raw input.
