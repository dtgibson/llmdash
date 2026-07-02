# Security Review — menu-bar-badge

**Date:** 2026-07-02
**Feature:** menu-bar-badge — a SwiftBar/xbar menu-bar plugin that is a pure consumer of the dashboard's existing `/api/state`, rendering a one-glance remaining-% badge with a full-picture dropdown
**Stack:** Vanilla Node (`node:http`), zero runtime dependencies, plain JS; the badge is a client-only out-of-process plugin (no new listener). Frontend/served surface unchanged.
**Checklist:** Project conventions (CLAUDE.md) + the prior feature reviews as the house pattern (`pipeline/claude-auto-refresh/security-report.md`) + this feature's own security requirements (NFR-04 sanitization, the SwiftBar output grammar). No served checklist exists for this stack; the checks-performed table below is built for this feature's actual surfaces.
**Outcome:** PASSED WITH NOTES (three findings — one Low, resolved in-stage and re-verified; two Informational, accepted with rationale. Nothing blocks deployment.)

---

## Summary

The badge is an out-of-process, client-only plugin that turns the dashboard's
already-served `/api/state` into SwiftBar/xbar stdout — a line-based grammar
where `|` opens a space-separated param list (including the arbitrary-command
`bash=`/`shell=` params) and newlines/`---` are structural. The primary review
was an end-to-end trace of every value that reaches stdout against that grammar:
percentages and reset countdowns are coerced numbers (`Math.floor` / `Date.parse`
delta), never raw strings; tool/window labels are server-side constants
(`'Claude Code'`/`'Codex'`/`'5-hour'`/`'Weekly'`); diagnostic `reason` is a closed
enum resolved by own-key lookup and never rendered raw; and the one free-form
field that reaches a line (`limitsDiagnostic.detail` for `codex-cmd-failed`) is
passed through `sanitize()`. The fetch is a plain loopback/tailnet `http.get` with
a 2 s timeout, does not follow redirects (verified: a 302 rejects → offline),
attaches no credentials, and every failure path lands on the offline state
(exit 0, never a stack trace to stdout). The installer's new `resolve_node`/
`setup_badge` rewrite the shebang atomically (temp+`mv`, quoted paths, loud
failure on unresolved node so no dead badge ships) and symlink only into a
*verified-existing* SwiftBar dir under the plugin's own fixed name — never
installing SwiftBar. `src/server.js`, `public/app.js`, `config.js`,
`src/health.js`, and `package.json` are confirmed unchanged (QA-24); runtime
deps stay at 0.

One gap was found and fixed in-stage: the operator-supplied `LLMDASH_BADGE_HOST`
/`LLMDASH_PORT` flowed **verbatim** into the `Open dashboard | href=…` line and
the offline note, while the sibling free-form field (`detail`) was sanitized —
an internal inconsistency. A host value carrying a raw space (SwiftBar's param
separator) could mechanically append a second param, including `bash=`. It is
local operator env — the same authority that can already run anything, so not a
trust-boundary crossing — but it flows to a *clickable* action and the project's
own convention is to sanitize before output. Fixed with a `sanitizeHostPort()`
(strip whitespace and `|`; a real host/IP/port never contains them), applied at
`baseUrl()` and the offline line, and locked with a regression test. Re-verified
adversarially: every hostile host now collapses to a single inert href token —
no space-separated second param, no extra menu line. Suite green at 170/170
(168 pass, 2 graceful skips — the baseline 168 plus two new seam tests).

---

## Findings

### Operator-supplied host/port were interpolated unsanitized into the SwiftBar `href=` line

**Severity:** Low
**Location:** `scripts/menubar/llmdash.5s.js:186` (`baseUrl`, pre-fix
`` `http://${host}:${port}/` ``) → the `Open dashboard | href=` line
(`:232`) and the offline note (`:243`, `Dashboard offline — no server on
${host}:${port}`). Source: `LLMDASH_BADGE_HOST` / `LLMDASH_PORT` (`:34–35`).
**Description:** A SwiftBar/xbar dropdown line's param list is **space-separated**
after the first `|` (`href=… bash=… param1=…`), and `bash=`/`shell=` make a menu
item run an arbitrary command on click. `host`/`port` reached both the `href=`
value and the offline text with **no sanitization**, while the feature's other
free-form field (`limitsDiagnostic.detail`) was already run through `sanitize()`
— an internal inconsistency and a divergence from the CLAUDE.md rule "never
interpolate untrusted input into raw output; escape text." Proven mechanically:
with `LLMDASH_BADGE_HOST='127.0.0.1/ bash=/bin/sh param1=-c param2="rm -rf ~"
terminal=false'`, the emitted line became
`Open dashboard | href=http://127.0.0.1/ bash=/bin/sh param1=-c … :8787/`, i.e.
a clickable `bash=` action. Note `sanitize()` alone would **not** have fixed this:
it maps `|`/newlines to a *space*, but a space is itself the param separator, so
a space-based `bash=` token survives — host/port need whitespace stripped, not
space-substituted. **Not a trust-boundary crossing:** the value is local operator
env, the same authority that can already run any command, and the Stage-4 ratified
use is a tailnet host the operator hand-enters. But it flows to a *clickable*
action and future-proofs the deferred multi-host list (a host value that might
one day come from a config file/sync, less trusted than hand-typing).
**Remediation:** Added `sanitizeHostPort(s)` = `String(s).replace(/[\s|]/g, '')`
(a real host/IP/port never contains whitespace or `|`), applied inside
`baseUrl()` (the single chokepoint for every `href=`) and the offline note line.
**Status:** Resolved — `scripts/menubar/llmdash.5s.js:75–87` (`sanitizeHostPort`),
`:198–200` (`baseUrl`), `:255–256` (offline line). Re-verified adversarially: all
four hostile host inputs (space-, `|`-, and newline-based) collapse to a single
inert href token — no space-separated second param, no extra menu line — while
legitimate values (`127.0.0.1`, `100.64.0.9`, `my-mac.tailnet.ts.net`, `8787`)
round-trip unchanged. Locked with two regression tests
(`tests/menubar.test.js:290–318`: the `sanitizeHostPort` unit seam and an `emit`
end-to-end hostile-host assertion). Suite: 170/170 (168 pass, 2 skip).

### The `/api/state` response body is accumulated without a size cap

**Severity:** Informational
**Location:** `scripts/menubar/llmdash.5s.js:293–299` (`fetchState`: `body += c`
in the `data` handler, no length guard)
**Description:** The fetch bounds *time* (2 s `FETCH_TIMEOUT_MS`, verified to
reject a hung server) but not *size*: a party answering on `HOST:PORT` could
stream a very large body within the window, growing the accumulated string until
the plugin process OOMs. **Blast radius is one tick:** the plugin is a
short-lived per-interval process (spawned ~every 5 s, exits immediately), so an
OOM kills a single badge refresh, not the menu-bar host or the Mac — the next
tick runs normally. Reaching it also requires a party impersonating the dashboard
on the configured host, which is outside the single-user-tailnet threat model
(the same posture under which local host authority is accepted).
**Remediation:** Optionally cap the body (e.g. abort/`req.destroy()` past a few
hundred KB — `/api/state` is a few KB) and treat overflow as offline. Not applied
in-stage: it changes the fetch's control flow beyond a minimal obviously-correct
edit, the trigger is model-excluded, and the impact is bounded to one tick.
**Status:** Accepted — bounded to a single short-lived process, trigger requires
an in-model-excluded impersonating peer; recommended as a small hardening
follow-up, not blocking.

### A hostile `/api/state` numeric field would render as odd text (never an injection)

**Severity:** Informational
**Location:** `scripts/menubar/llmdash.5s.js:119` (`Math.floor(win.remainingPct)`),
`:215/:218` (`Date.parse(row.resetsAt) - Date.now()` → `fmtDur`)
**Description:** The plugin trusts the server's clamping: `remainingPct` is
`Math.max(0, 100 - usedPct)` server-side with `usedPct` clamped 0–100, and
`resetsAt` is a timestamp string parsed only into a numeric delta. If a hostile
`/api/state` supplied `remainingPct: NaN`/`Infinity`, `Math.floor` yields
`NaN`/`Infinity`, rendering the literal text `"NaN%"`/`"Infinity%"`; an
unparseable `resetsAt` yields `"NaNm"`. These are **cosmetic** — no `|`, newline,
or param can be formed from a coerced number or a parsed-delta string, so there
is **no injection and no structural break**. Producing it requires a party
impersonating the dashboard (out of model), and the server is the sole writer of
the payload with its own clamps.
**Remediation:** Optionally coerce with a finite-number guard before formatting
(e.g. `Number.isFinite(pct) ? Math.floor(pct) : dash`). Not applied: no security
impact (never an injection), and the server-side clamp is the contract the badge
is designed to consume (FR-05 "recompute nothing").
**Status:** Accepted — cosmetic-only, no grammar break, trigger model-excluded.

---

## Checks Performed

| Check | Result |
|---|---|
| **SwiftBar/xbar output-injection (primary surface) — trace every value to stdout** | |
| `badge.pct` / `row.remaining` reach stdout only via `Math.floor(win.remainingPct)` — a coerced integer; no raw string; `NaN`/`Infinity` render as inert text, never a `|`/newline/param | Finding — Informational (cosmetic), Accepted |
| `row.resetsAt` never reaches stdout as a string — only `Date.parse(resetsAt) - Date.now()` → `fmtDur` (a number → `d/h/m` literal); a bad timestamp yields `"NaNm"`, no grammar break | Pass |
| Tool labels (`tv.label`, `b.toolLabel`) are server-side **constants** (`'Claude Code'`/`'Codex'`, `src/server.js:107,109`) — the server is the sole writer of `/api/state`; unsanitized use is a controlled constant, not free-form | Pass |
| Window labels (`row.label`, `b.windowLabel`) are code constants (`'5-hour'`/`'Weekly'`, `WINDOWS`) | Pass |
| `limitsDiagnostic.reason` is a closed enum resolved by **own-key** `hasOwnProperty` lookup (`diagLine`, `:90–95`); never rendered raw; a `__proto__`/`constructor` reason takes the fixed fallback, not an inherited method (mirrors the shipped convention) | Pass |
| The one free-form field reaching a line — `codex-cmd-failed` `detail` — is passed through `sanitize()` (`:85`); `cmd` is **not rendered at all**; `cause` is never rendered raw | Pass |
| `sanitize()` strips `|`, `\r`, `\n` → space; adequate for free-form *text* (an injected `\| bash=…` loses its `|`, and free text forms no recognized `key=value` param). QA-23 locks a `\| rm -rf /` detail → the injected `|` is neutralized (`tests/menubar.test.js:250–257`) | Pass |
| **Operator host/port → the `href=` clickable action** | |
| `LLMDASH_BADGE_HOST`/`LLMDASH_PORT` interpolated **unsanitized** into `baseUrl()` (the `href=` value) and the offline note; a raw space could append a `bash=`/`shell=` param (proven mechanically) | Finding — Low, Resolved in-stage |
| Fix `sanitizeHostPort()` strips whitespace + `|`; every hostile host now collapses to a single inert href token (no 2nd param, no extra line); legit hosts/IPs/hostnames/ports round-trip unchanged; locked by two regression tests | Pass (post-fix) |
| **Configurable-host fetch (SSRF-shaped, judged against the threat model)** | |
| `http.get` does **not** follow redirects — a 302 is a non-200 → reject → offline (verified empirically with a live redirector) | Pass |
| No credentials/tokens attached — `fetchState` sets only `{host,port,path:'/api/state',timeout}`; no `Authorization`/`Cookie`/token header; the plugin reads only `/api/state`, never any credential file | Pass |
| Host/port can no longer break out of the URL or the `href=` param post-fix (whitespace/`|` stripped) | Pass |
| **Resource / DoS & crash-safety** | |
| 2 s `FETCH_TIMEOUT_MS` honored — a hung server rejects within the bound (test-locked, `tests/menubar-degradation.test.js:56–66`); a hung fetch can't freeze the menu bar | Pass |
| Response body accumulated without a size cap (`body += c`) — a huge body could OOM one plugin tick | Finding — Informational, Accepted (bounded to one short-lived process; trigger model-excluded) |
| Every failure path (non-200, timeout, connection error, bad JSON) → `emit(offline)`, exit 0, never a stack trace to stdout (which SwiftBar would render as a broken menu); last-resort `try/catch` around `emit(computeBadge(...))` catches a throwing compute → offline (`:307–324`) | Pass |
| No number is ever emitted in the offline state (the offline branch has no number path) and no-reading shows `▪ —` not a number — structural, test-locked (QA-09/QA-12, `tests/menubar.test.js`) | Pass |
| **Installer changes (`resolve_node` / `setup_badge`)** | |
| Shebang rewrite is atomic and safe: writes to `"$plugin.tmp.$$"` then `mv` over the intended `$plugin`; `$plugin`/`$tmp`/`$node_bin` all quoted (spaces/metachars in the checkout path handled); the `&&` gate prevents a truncated plugin; writes only the intended file (`scripts/install-macos.sh:100–102`) | Pass |
| Unresolved node → `return 1` with loud stderr guidance **before** any rewrite; the shebang is left as the portable dev default — no silently-dead badge baked (test-locked, `tests/menubar-install.test.js:116–128`) | Pass |
| Symlink target dir is **verified-existing**: `defaults read … PluginDirectory` gated by `[ -d "$sb_pref" ]`, else the fixed default gated by `[ -d ]`; `ln -sf "$plugin" "$sb_dir/llmdash.5s.js"` clobbers only the plugin's own fixed name (never an unrelated file), and `-sf` replaces a pre-existing symlink rather than following it to write through; path quoted (`:107–116`) | Pass |
| "Never installs SwiftBar" holds — with no SwiftBar dir it names the `brew install --cask swiftbar` prerequisite and does not claim to have installed it (test-locked, `:94–98`) | Pass |
| Pre-existing sed/plist metachar fragility (DECISIONS.md accepted) is untouched by the new badge code (uses `echo`/`tail`/`mv`, not sed substitution) — not worsened, not re-flagged | Pass |
| **Secrets / disclosure** | |
| No token/secret/credential read or logged anywhere in the plugin, installer badge code, tests, fixtures, or helpers (grep clean); the plugin reads only `/api/state`, never `~/.claude*`/`~/.codex*`/any credential | Pass |
| No real account strings in fixtures (grep for real emails/orgs is clean) | Pass |
| README honestly discloses SwiftBar as a **user-installed** third-party prerequisite never auto-installed, the badge as a **mirror** of the dashboard (not a second independent reading), the zero-dependency claim, and both config knobs with their real effect — satisfies "surface prerequisites, never silently" | Pass |
| The `href`/dropdown leak nothing sensitive — only the dashboard URL the operator configured and fixed honest copy | Pass |
| **Contract & zero-dep integrity (QA-24)** | |
| `src/server.js`, `public/app.js`, `config.js`, `src/health.js`, `package.json` confirmed **unchanged** in the working tree — no `/api/state`/threshold/diagnostic-code change | Pass |
| `package.json` runtime `dependencies` = `{}` (0), `type: module`; the plugin is `node:http`-only, no build step | Pass |
| The badge adds no network listener — it is a client only (one `GET /api/state` per host tick) | Pass |
| **Regression** | |
| Full suite green before and after the in-stage fix; baseline 168 (166 pass / 2 graceful skips) preserved, now 170 (168 pass / 2 skip) with the two new seam tests; fix scope confined to `scripts/menubar/llmdash.5s.js` (one new helper + two call sites) and `tests/menubar.test.js` (import + two tests) | Pass |

---

## Convention Flags

- **Operator-supplied config that flows into a menu-bar (SwiftBar/xbar) line must
  be sanitized for that grammar before output — not just free-form payload text.**
  A SwiftBar param list is space-separated, so any value reaching a `| …=…` line
  (including a `href=` value built from `LLMDASH_BADGE_HOST`/`LLMDASH_PORT`) must
  have whitespace and `|` stripped, or a stray space can append a second param —
  including the arbitrary-command `bash=`/`shell=`. This extends the existing
  "escape text before output; never interpolate untrusted input into raw output"
  convention to the menu-bar surface and to *config-derived* values, not only
  wire payload text. (Relevant now for the deferred multi-host badge, where a host
  value may one day come from a file/sync rather than hand-typing.)

---

## Addendum — post-review re-check of `--remove-badge` (Orchestrator, 2026-07-02)

After the review, a symmetric uninstall (`remove_badge()` + `--remove-badge`) was
added to `scripts/install-macos.sh` at the user's request. Re-checked the new code:

- **Symlink-only removal is the load-bearing guard and is correct.** `remove_badge`
  removes `"$sb_dir/llmdash.5s.js"` only when `[ -L "$link" ]` (a symlink); `rm` on a
  symlink removes the link, never following it to the target, so the repo's plugin
  source is untouched. A real (non-symlink) file at that path hits the explicit
  `elif [ -e "$link" ]` branch and is **left untouched** — the installer can never
  delete a real user file.
- **No path-injection / arbitrary-delete surface.** The target is a fixed filename
  inside SwiftBar's own detected plugin dir (`defaults read com.ameba.SwiftBar
  PluginDirectory` or the standard `~/Library/Application Support/SwiftBar/Plugins`);
  no user argument reaches the `rm` target beyond that detection. Path is quoted; no
  glob, no recursion, no `-rf`. `readlink` is used only to report where the link
  pointed.
- **Never uninstalls SwiftBar** (prints `brew uninstall --cask swiftbar` for the user
  to run by choice); never touches the checked-in source; idempotent no-op (exit 0)
  when nothing is linked.

**Verdict: no new findings.** Outcome stands **PASSED WITH NOTES**. Suite green at
175 tests (173 pass / 2 graceful skips) after the +5 remove-badge tests.

---

## Addendum 2 — wrapper redesign re-check (Orchestrator, 2026-07-02)

The badge install was redesigned mid-deploy (a generated wrapper replaces the
shebang-baked symlink, so the tracked source — and the git checkout — is never
modified). Re-checked the new `scripts/install-macos.sh` code:

- **`remove_badge` is still safe.** It deletes `$sb_dir/llmdash.5s.js` only when
  it is a symlink (`rm` the link, never followed) OR a real file that contains the
  `llmdash-menu-bar-badge` marker. A real file **without** the marker is a user's
  own file and is explicitly left untouched. Fixed single filename, quoted, no
  glob, no `-rf`.
- **`setup_badge` migration is safe.** It `rm -f`s the target only if it's a
  symlink or a marker wrapper; a non-marker real file makes setup refuse (exit 1)
  rather than clobber it.
- **`restore_tracked_shebang` is bounded.** It rewrites line 1 only when it is
  exactly the committed `#!/usr/bin/env node` (no-op) or a baked `#!/<abs>/node`
  shape (restore); every other first line is left untouched. Temp-file + `mv`,
  quoted.
- **Wrapper contents** are `exec "<abs-node>" "<tracked-plugin>" "$@"`, both paths
  quoted. Informational (Accepted, single-user posture): a double-quote in the
  install-dir path could break the generated wrapper's quoting — self-inflicted,
  local, consistent with the accepted operator-config stance.

**Verdict: no new blocking findings.** Outcome stands **PASSED WITH NOTES**.
Suite green at 181 (179 pass / 2 graceful skips).
