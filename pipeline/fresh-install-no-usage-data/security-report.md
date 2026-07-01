# Security Review — fresh-install-no-usage-data

**Date:** 2026-07-01
**Feature:** fresh-install-no-usage-data (fix lane)
**Stack:** Vanilla Node (node:http, node:sqlite), zero dependencies, plain HTML/CSS/JS
**Checklist:** Project conventions (CLAUDE.md) + general self-hosted web-app checks — no served checklist for this stack
**Outcome:** PASSED WITH NOTES

---

## Summary

This fix (installer codex-path resolution, startup health readout, once-per-cause
spawn-failure logging, per-tool `limitsDiagnostic` in `/api/state`, honest UI empty
states) introduces no new vulnerability and bypasses no existing control. All
baseline controls were verified live on a sandboxed instance (headers, CSP, 405,
no-store) and every new dynamic string is HTML-escaped before rendering — confirmed
with hostile payloads. Three informational notes: a small path disclosure over the
tailnet boundary (acceptable for the documented threat model), a pre-existing
robustness limit in the installer's sed/plist substitution, and the absence of any
automated regression test for the security headers the project's conventions require.

---

## Findings

### /api/state discloses the configured codex command path and errno to tailnet peers

**Severity:** Informational
**Location:** `src/server.js:111-119` (buildState), `src/codex-limits.js:13-31`
**Description:** When Codex limits are unavailable because the configured command
cannot be run, `/api/state` now returns `limitsDiagnostic: { reason:
"codex-cmd-failed", cmd, detail }` where `cmd` is the configured codex command
(typically an absolute path such as `/Users/<name>/.local/bin/codex`, which reveals
the local username) and `detail` is an errno string (`ENOENT`, `EACCES`) or the
literal `"not found"` / `"spawn failed"`. The server binds 0.0.0.0:8787 by design
(Tailscale is the documented access boundary), so any tailnet peer can read this.
Verified live: the payload carries exactly the allowlisted fields — no raw stderr
(the child's stderr is `stdio: 'ignore'`), no exception messages (only `e.code`
crosses), no environment contents. Claude's diagnostic is a bare enum
(`{ reason: "no-statusline-reading" }`). The dashboard already exposes strictly
more sensitive data (usage percentages, plan names, activity stats) across the
same boundary, so this adds negligible new exposure for a single-user tool.
**Remediation:** None required for this threat model. If the dashboard ever gains
non-personal deployment modes, gate `cmd`/`detail` behind a config flag.
**Status:** Accepted

### Installer sed/plist substitution is not robust to metacharacters in resolved paths

**Severity:** Informational
**Location:** `scripts/install-macos.sh:84-89`
**Description:** `CODEX_BIN` (and `NODE_BIN`, `DIR`) are substituted into the plist
via `sed "s#CODEX_PATH#${CODEX_BIN}#g"`. A path containing `#` breaks the sed
expression, `&` or `\` expands as a sed replacement metacharacter, and `<`/`&`
would produce malformed plist XML. This is **pre-existing** — the sed block is
unchanged by this fix, and `CODEX_BIN` was already substituted here at HEAD. The
new `resolve_codex()` probe (`$HOME/.local/bin`, `/opt/homebrew/bin`,
`/usr/local/bin`) introduces no new input class: values still derive from the
user's own `$HOME` and `PATH` on their own machine, which are trusted in this
threat model. Worst case is a malformed plist and a service that fails to load —
visible, not silent, and not privilege-gaining (the user already controls
everything the plist runs as). All shell expansions in the new code are correctly
double-quoted (spaces in `$HOME` are handled); `--resolve-codex` is genuinely
read-only (exits before any mutation; only `command -v`, `[ -x ]`, and `echo`);
no `eval`, no new network fetch, nothing elevated.
**Remediation:** If ever hardened: substitute placeholders with a small Node
heredoc (string replace, XML-escape) instead of sed. Not warranted now.
**Status:** Accepted (pre-existing, out of this fix's scope)

### No automated regression test for the baseline security headers

**Severity:** Informational
**Location:** `tests/server.test.js` (absence)
**Description:** CLAUDE.md requires baseline headers (`nosniff`, CSP with
`script-src 'self'`, `Referrer-Policy`), 405 for non-GET/HEAD, and `no-store` on
statics. All were verified **intact and live** in this review (sandboxed instance
on 127.0.0.1:8898: full header set on `/` and `/api/state`, `POST /api/state` →
405 with `allow: GET, HEAD`). But no test in the suite asserts any of them, so a
future change could drop a header without failing CI. Not introduced by this fix —
coverage never existed — but this fix's verification narrative assumed it did,
which is exactly how such a gap eventually bites.
**Remediation:** Add a small integration test that starts the server on an
ephemeral port and asserts the security-header set, the 405 behavior, and
`cache-control: no-store` on `/`, `/app.js`, and `/api/state`.
**Status:** Open

---

## Checks Performed

| Check | Result |
|---|---|
| **Installer — scripts/install-macos.sh** | |
| All new shell expansions double-quoted (paths with spaces/special chars in `$HOME`) | Pass |
| `--resolve-codex` hook is read-only; exits before clone/plist/launchctl/statusline steps | Pass |
| sed/plist substitution vs hostile-looking paths | Finding — see above (Informational, pre-existing) |
| No `eval` of untrusted content; no new network fetch piped to shell | Pass |
| Nothing runs with elevated privileges (user-level `launchctl`, `~/Library/LaunchAgents`) | Pass |
| Re-run idempotence: statusline config preserved with backup; plist regeneration is documented "safe to re-run" behavior, unchanged | Pass |
| Warning copy prints resolved local paths only, to the installing user's own terminal | Pass |
| **API surface — /api/state limitsDiagnostic** | |
| Response fields explicitly allowlisted (`reason` enum; `cmd`; `detail`) — verified in code (`src/server.js:116-118`) and live | Pass |
| No secrets, raw stderr, or exception text in payload (child stderr ignored; only `e.code` recorded) | Pass |
| `detail` bounded to errno strings / fixed literals | Pass |
| Disclosure of local binary path + errno across the 0.0.0.0/tailnet boundary | Finding — see above (Informational, accepted) |
| **Client rendering — public/app.js** | |
| `esc()` applied to every dynamic value on new paths (`d.cmd`, `d.detail`, `tool.label`); `d.reason` compared, never interpolated | Pass |
| Hostile-payload test of `limitsNoteHtml` (script/img/attr-breakout in cmd, detail, reason, label) — all escaped | Pass |
| No untrusted input in style values (new note emits no style attributes; existing widths remain coerced numbers) | Pass |
| No new inline `<script>` or event-handler attributes; `index.html` untouched; CSP `script-src 'self'` stays meaningful | Pass |
| **src/health.js** | |
| Probe paths come only from config/env (`rateLimitsFile`, `codexSessionsDir`, `codexCmd`) — never from request input; no traversal vector | Pass |
| Probes read existence/age/executability only (`statSync`, `accessSync`) — no file contents in logs or API | Pass |
| No subprocess; used at startup/module-load only, never on the HTTP request path | Pass |
| **src/codex-limits.js — spawn and logging** | |
| `spawn(config.codexCmd, ['app-server'])` — arg array, no `shell: true`, command string never split or interpolated | Pass |
| Spawn-failure log: configured cmd + errno + fixed remediation copy; no secrets | Pass |
| Once-per-cause logging — unit test plus live run (1 line across multiple 60s polls) | Pass |
| Diagnostic state transitions bounded (`ok` clears and re-arms; fallback keeps actionable cause) | Pass |
| `/api/state` reads the diagnostic from memory; codex subprocess stays on the poller, off the request path | Pass |
| **Regression of baseline controls** | |
| `nosniff`, CSP (`default-src 'self'`, `script-src` effectively `'self'`), `referrer-policy` on all responses — verified live | Pass |
| Non-GET/HEAD rejected: `POST /api/state` → 405, `allow: GET, HEAD` — verified live | Pass |
| `cache-control: no-store` on statics and API — verified live | Pass |
| Automated test coverage for the above controls | Finding — see above (Informational) |
| Zero runtime dependencies — `package.json` unchanged, no deps, no build step | Pass |
| Externally-sourced percentage clamping intact (`mapWindow` clamps 0–100) | Pass |
| Static-file path traversal guard intact (`serveStatic` prefix check, unchanged) | Pass |
| Full test suite | Pass — 48/48 |

---

## Convention Flags

- The baseline security headers, 405 rejection, and no-store policy are recorded
  conventions but have zero automated enforcement — add a server integration test
  asserting them so a future refactor can't silently drop one. (This review
  verified them live; the next one shouldn't have to.)
