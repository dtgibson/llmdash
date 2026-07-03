# Security Review — Multi-Host Badge

**Date:** 2026-07-02
**Feature:** multi-host-badge
**Stack:** node http (minimal vanilla `node:http`, zero runtime deps) + a macOS SwiftBar badge and its `osascript` config helper — no stack checklist file; reviewed against CLAUDE.md security conventions + the prior features' security-report house format (multi-host, menu-bar-badge, claude-auto-refresh)
**Checklist basis:** Feature-specific checks derived from this feature's two genuinely new surfaces — (a) a local config-file **WRITE** path driven from the menu bar, and (b) an `osascript` dialog that ingests a **user-typed hostname** — plus the standing llmdash conventions (baseline security headers, method-lock, escape-at-render, clamp/normalize-at-ingest, enum reason codes own-key mapped, no dead knobs, tailnet single-user threat model with accepted informational path/errno disclosure)
**Outcome:** **PASSED WITH NOTES**

---

## Summary

Multi-host-badge adds two firsts to a previously serve-only, read-only tool: a
local `hosts.conf` **write** path (the badge's Add/Remove actions) and an
`osascript` dialog that reads a user-typed hostname. Both were the focus of an
adversarial trace, and both are well built. The `osascript` invocation is
`execFileSync('/usr/bin/osascript', ['-e', <fixed-literal>])` — no shell, no
value ever concatenated into the AppleScript source; the typed value returns via
`text returned of result` on stdout and reaches `host-config.js` as a plain ARGV
string, so a `"; rm -rf ~"` / `$(…)` / backtick / newline / AppleScript-breaking
`"` payload is inert data end to end (verified structurally and empirically). The
write path is atomic temp+rename, `mode 0o600`, to the **fixed**
`config.dataDir/hosts.conf` (no path derived from user input → no traversal), a
value only lands after `sanitizeHostPort` + `parseHosts` validation, the local
host is never removable, and an embedded newline is stripped at write so a label
or host field **cannot smuggle a second config line or a `!local=` directive**
(verified). The badge renderer `sanitize()`s every free-form field so a
`|`/newline/`bash=` label cannot smuggle a clickable SwiftBar param (verified:
every rendered line carries exactly one `|`). Serve-only is preserved: `server.js`
has no write/mutation endpoint, all responses keep the baseline headers +
non-GET/HEAD → 405 + `no-store`, and the hardened peer fetch in `src/hosts.js`
is byte-for-byte unchanged by this feature. Two **Informational** notes only
(a downstream `NaN%`/`Infinity%` cosmetic gap that no injection sink is reachable
from, and the accepted operator-config-in-terminal-log disclosure). No
Critical/High findings — clear to deploy. `npm test` green at 333 / 331 pass / 2 skip.

---

## Findings

### 1. Badge glyph renders a non-finite `remainingPct` as literal `NaN%` / `Infinity%` if the already-normalized ingest contract were ever violated

**Severity:** Informational
**Location:** `scripts/menubar/llmdash.5s.js` — `computeBadge()` (`Math.floor(win.remainingPct)`, ~line 135) and the `emit`/`emitMulti` glyph
**Status:** Accepted

**Description:** The badge is a **second-line consumer**: it reads `/api/hosts`,
whose per-host `state` was already run through `normalizePeerState` at the local
instance's ingest, where `clampPct` coerces every `usedPct`/`remainingPct` to a
finite number in [0,100] or `null`. So through the real data path a peer string
never reaches the badge as a live number. When I injected a malformed value
**downstream of** that ingest normalization (a string `"50;background:url(x)"`
and `Infinity` placed directly on the badge's input, a state the `/api/hosts`
contract does not produce), the badge rendered `NaN%` / `Infinity%` as plain
SwiftBar **text**. Crucially, **no style/URL/HTML/shell sink was reachable** — I
confirmed the output contains no `background`/`url(` and the value lands only in
the text portion of a line (after the single `|`), never a `style=`/`href=`. The
residual is cosmetic honesty (a `NaN%` glyph) *only* under a contract violation
that can't occur through `/api/hosts`. Consistent with the standing "primary
coercion at ingest" discipline; the badge need not re-coerce because its upstream
already did. Flagged for completeness; no action required.

### 2. A bad `!local=` directive line from `hosts.conf` is echoed verbatim into the startup terminal log

**Severity:** Informational
**Location:** `src/health.js` — `hostsConfigLine()` (`Ignored a bad directive "${e.entry}" …`)
**Status:** Accepted

**Description:** When the config file contains a malformed directive line,
`hostsConfigLine()` prints the offending line (`e.entry`) into the startup
console unescaped. This is the accepted posture, not a defect to fix: the line
is **operator-controlled configuration** in a local file (the same operator
reading the log), not peer-supplied data, and a terminal log line is plain text,
not an HTML/style/SQLite render surface. It mirrors the prior multi-host report's
accepted Finding on the operator label in the startup log. No secret or token is
read or logged by either new file (grep-confirmed). Flagged for completeness only,
consistent with the tailnet single-user threat model.

---

## Anti-injection trace — the `osascript` / shell surface (the sharpest risk)

Traced in code and confirmed structurally + empirically:

1. **Fixed-literal AppleScript.** `promptForHost`, `showMessage`, and
   `confirmRemove` each build their script from a **constant** copy string
   (`ADD_PROMPT`, `INVALID_MSG`, `REMOVE_CONFIRM(…)`) passed through `asStr()`
   (which escapes `\` and `"` — used only on our own copy). The user's typed
   value is **never** concatenated into a script; the prompt script ends
   `return text returned of result`, returning the value on stdout. Structural
   (test: "the typed value never re-enters an AppleScript source string").
2. **No shell.** The invocation is `execFileSync('/usr/bin/osascript', ['-e',
   script], …)` — an absolute binary, an ARGV array, `shell:false` by default.
   No `sh -c`, `exec()`, `execSync`, `eval`, backticks, or template
   interpolation of any value into a command anywhere in the helper (test:
   "uses execFileSync (ARGV), never exec/execSync/sh -c/eval").
3. **Value is ARGV/stdout-only.** The captured string is trimmed and handed to
   `addHost(hostsFile, entry, …)` as a plain argument; it never re-enters
   AppleScript or a command. A hostile hostname/label (`"; rm -rf ~`, `$(…)`,
   backticks, `\n`, `| bash=…`, an AppleScript-breaking `"` + `end tell`)
   therefore cannot execute, break out of AppleScript, or reach a shell.
4. **QA proof holds structurally.** The `100.64.0.9:8790=Studio | rm -rf ~`
   round-trip lands as literal file text (`$HOME` intact); the property is the
   *mechanism* (fixed literal + ARGV), not the one string — any payload is data.

## Local-file WRITE trace

1. **Atomic + `0o600` + fixed target.** `atomicWrite` writes
   `${hostsFile}.tmp.<pid>.<ctr>` then `renameSync` onto `hostsFile`
   (`mode:0o600`), on the same dir — no partial-file window is ever observable;
   the temp is unlinked on a failed rename (no leak; test: "writes atomically
   (no temp leaks)"). `hostsFile` is always `config.dataDir/hosts.conf`, never
   derived from user input → **no path traversal**, no write outside the data
   dir. The helper builds no path from the typed value.
2. **Validate-before-write.** A value reaches the file only after
   `parseHosts` accepts it and `sanitizeHostPort` normalizes the host; a
   malformed/out-of-range-port/empty-host value returns `invalid` and writes
   **nothing** (tests confirm the file is never even created on rejection).
3. **Local host never removable.** `removeHost` refuses any `local:<port>` key
   (`is-local`, no write); the badge's Remove submenu only lists non-self hosts.
4. **A label/host cannot smuggle a line or a directive.** Every write strips
   `[\r\n]` per entry (the newline is the record delimiter). Verified three
   ways: a label `Studio\n!local=exclude`, a host `…\n!local=exclude=Lab`, and a
   direct `writeHostsConfig(['a=Alpha\n!local=exclude'])` all collapse to a
   single inert line — `localMode` stays `auto`, the directive is never forged.
5. **Concurrent writes** are last-write-wins without corruption (atomic rename;
   acceptable single-user, OQ-06).

## Config READ / parse trace

- A hand-crafted/corrupt file never crashes: an unreadable file logs **once**
  (module latch, re-armed on recovery), falls back to the env seed/last-good, and
  returns `error{unreadable}` — honest degradation, never a fabricated reading.
- `!local=` is a **closed enum** (`include`/`exclude`/`auto`); a bad value →
  `directiveErrors` + default `auto`, never a passthrough to a sink. An unknown
  `!`-directive is an honest error, never a silent host entry.
- The file body reuses the shipped `parseHosts` grammar + `sanitizeHostPort`
  (one parser, one sanitizer) — no new grammar, no new injection surface.

## Sanitize-before-every-sink trace (badge)

The hostile label `Desk bash=/bin/sh | shell=evil\nEVIL=1` was traced to the
badge stdout: `sanitize()` collapses `|` and `\r\n` to spaces, so **every**
rendered line carries exactly one `|` (the legitimate SwiftBar param delimiter).
The `bash=`/`shell=`/`=` text lands entirely in the display-text portion *before*
that single `|`, which SwiftBar treats as label text, not params — no clickable
`bash=`/`shell=` action can be smuggled. `host`/`port` on every `href=`/key go
through `sanitizeHostPort` (strips `[\s|]`); the Remove action passes the
sanitized `host:port` key on `param3`, never a free-form label. The property is
structural: because a `|` can never survive `sanitize()`, a label can never open
a second param region.

## Serve-only preserved

`server.js` has **no** write/mutation endpoint (grep-confirmed: no
POST/PUT/DELETE/PATCH handler, no `writeFile`, no `addHost`/`removeHost` import);
non-GET/HEAD → 405 with `allow: GET, HEAD`; `/api/hosts` is a pure in-memory
cache read (`getCombined()`), `no-store`, baseline headers. The write path lives
only in the badge process, never behind the `0.0.0.0` bind. The badge issues no
outbound fetch (reads local `/api/hosts`). `src/hosts.js`'s hardened
`fetchPeerState`/`normalizePeerState` are **unchanged** by this feature (last
touched by the `multi-host` feature) — this feature does not weaken them.

---

## Checks Performed

| Check | Result |
|---|---|
| `osascript` AppleScript is a fixed literal — typed value never concatenated into the script | Pass |
| Invocation is `execFileSync('/usr/bin/osascript', ['-e', …])` — no shell, ARGV array | Pass |
| No `sh -c` / `exec()` / `execSync` / `eval` / backticks / template-into-command anywhere in the helper | Pass |
| Typed value returns via `text returned of result` and reaches `addHost` ARGV/stdout-only | Pass |
| Hostile hostname/label (`"; rm -rf ~`, `$(…)`, backtick, `\n`, AS-breaking `"`) cannot execute/break out/reach a shell | Pass (structural + empirical) |
| Write is atomic temp+rename on the same dir — no observable partial-file window | Pass |
| Write is `mode 0o600`; temp unlinked on failed rename (no leak) | Pass |
| Write target is the fixed `config.dataDir/hosts.conf` — no path derived from user input | Pass |
| No path traversal / no write outside the data dir; helper builds no path from the typed value | Pass |
| Value written only after `sanitizeHostPort` + `parseHosts` validation; rejected value writes nothing | Pass |
| Local host is never removable (`local:<port>` → `is-local`, no write) | Pass |
| A label/host with an embedded newline cannot inject a second line or a `!local=` directive | Pass (verified 3 ways) |
| Concurrent writes are last-write-wins without corruption (atomic rename) | Pass |
| Corrupt/unreadable file → no crash, log-once (latched), honest degradation, never a fabricated reading | Pass |
| Malformed line → `errors[]`/`fileErrors`, never fabricated | Pass |
| `!local=` directive value is a closed enum (include/exclude/auto), never a passthrough to a sink | Pass |
| File body reuses `parseHosts` + `sanitizeHostPort` — no new grammar, no new injection | Pass |
| Badge `sanitize()`s every free-form field; a `|`/newline/`bash=` label cannot smuggle a SwiftBar param | Pass (empirical: exactly one `|` per line) |
| Badge `host`/`port` on `href=`/key via `sanitizeHostPort` (strips `[\s|]`) | Pass |
| Remove action passes the sanitized `host:port` key on `param3`, never a free-form label | Pass |
| Nested peer numbers coerced at ingest (`clampPct`/`num`) before the badge — no string reaches a style/width | Pass |
| Badge non-finite `remainingPct` renders as inert text only; no style/URL/HTML sink reachable | Finding 1 — Accepted |
| `server.js`: no HTTP write/mutation endpoint (no POST/PUT/DELETE/PATCH, no writeFile) | Pass |
| `server.js`: non-GET/HEAD → 405 with `allow: GET, HEAD` | Pass |
| `/api/hosts` + all responses: baseline headers (nosniff, CSP `default-src 'self'`, referrer-policy) | Pass |
| `/api/hosts`: `cache-control: no-store`; pure cache read (no fetch/subprocess on request path) | Pass |
| `0.0.0.0` bind gains no write surface (write path is in the badge process only) | Pass |
| Badge issues no outbound fetch (reads local `/api/hosts`) | Pass |
| `src/hosts.js` `fetchPeerState`/`normalizePeerState` hardening unchanged by this feature | Pass |
| Delivery: `host-config-action.mjs` runs under `$ABS_NODE` (not bare `node`); marker-gated wrapper model | Pass |
| No secret/token/credential read or logged in either new file | Pass |
| Config-file health/startup line: operator-config echoed to terminal log only — accepted informational | Finding 2 — Accepted |
| DoS: config read is one `fs.readFileSync` on the poller tick; fan-out concurrency + body-cap bound the outbound | Pass |
| Reserved `auto-refresh-*` reason codes not reused as host codes | Pass |
| Zero runtime deps / no build step preserved (node builtins + `osascript` only) | Pass |
| `npm test` baseline green (333 tests / 331 pass / 2 skip / 0 fail) | Pass |

---

## Convention Flags

_Nothing worth establishing as a new standing rule emerged. The load-bearing
disciplines this feature relied on — fixed-literal `osascript` + ARGV-only value,
newline-strip-at-write as the record-delimiter guard, and coerce-nested-numbers-
at-ingest — are already codified in CLAUDE.md and the prior security reports._
