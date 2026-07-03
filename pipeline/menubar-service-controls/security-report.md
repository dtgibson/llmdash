# Security Review — Menu-bar Service Controls

**Date:** 2026-07-03
**Feature:** menubar-service-controls
**Stack:** node http (minimal vanilla `node:http`, zero runtime deps) + a macOS SwiftBar badge and a new `osascript`/`launchctl`/`fs` service-and-uninstall helper — no stack checklist file; reviewed against CLAUDE.md security conventions + the prior features' security-report house format (multi-host-badge, menu-bar-badge, claude-auto-refresh)
**Checklist basis:** Feature-specific checks derived from this feature's genuinely new (and most powerful) surfaces — a menu-bar click that can **unload a launchd agent, delete its plist, revert the Claude statusline wiring, remove trust artifacts, delete the app checkout, and (opt-in) delete the usage-history DB** via a **self-deleting detached helper** — plus the standing llmdash conventions (fixed-literal `osascript` + ARGV-only values, marker-gate-before-every-delete, user-domain launchctl / no sudo, serve-only 405-for-non-GET/HEAD, no dead knob, tailnet single-user threat model with accepted informational path disclosure)
**Outcome:** **PASSED WITH NOTES**

---

## Summary

This is the most destructive feature shipped in llmdash to date — a single badge
click can tear down the whole install — and it was reviewed adversarially, end to
end. It holds. Every `osascript` dialog is a **fixed-literal** AppleScript run via
`execFileSync('/usr/bin/osascript', ['-e', <fixed>])` with **no shell**; every
`launchctl` op is `execFileSync('/bin/launchctl', [...ARGV])` in the **user**
domain `gui/<uid>` (no `sudo`, no system domain); every removal is `fs.rmSync`
(never a `/bin/rm` shell). The one dynamic value that reaches AppleScript (the
resolved checkout path) goes through the `asStr()` escaper and reaches commands
only as ARGV — a hostile checkout path, label, or `settings.json` value is inert
data end to end (verified with a hostile-input scratch round-trip: a sentinel
survived, no shell fired, `.pwned` never created). **Marker-gating holds on every
delete**: the plist only for the resolved label's file, the statusline reverted
only when the command points at THIS checkout, the trust entry removed via an
own-key `hasOwnProperty` check (a foreign `/user/real/project` was kept), the
wrapper removed only with the `llmdash-menu-bar-badge` marker (a non-marker user
file spared), the checkout only the resolved `LLMDASH_DIR`/`~/llmdash`, and
`~/.llmdash` removed only if empty. The **detached self-deleting teardown** reads
every path up front from ARGV, temp-copies itself into a per-user-`0700`
`os.tmpdir()`, deletes the checkout LAST as a leaf, self-cleans its temp dir only
after a `basename.startsWith('llmdash-teardown-')` guard, and reports honestly on
partial failure (never claims a removal that didn't happen). **Serve-only is
preserved**: `src/server.js` is byte-for-byte unchanged by this feature (no
write/mutation endpoint, non-GET/HEAD → 405 `allow: GET, HEAD`, baseline headers,
`no-store`); a remote tailnet peer cannot trigger any of these mutations — they
are badge-process-local, with no endpoint. **One Informational finding only** (the
statusline-revert ownership check is a substring `includes()` rather than a
path-boundary match — a self-inflicted, non-attacker-controlled false-positive
that could revert a user's own oddly-named statusline command, never a wrong
*deletion*). No Critical/High findings — clear to deploy. The real
`com.llmdash.dashboard` service, its plist, `~/llmdash`, and the DB were verified
**untouched** before and after all scratch execution; no scratch label or temp
litter remained. `npm test` green at 374 / 372 pass / 2 skip / 0 fail.

---

## Findings

### 1. Statusline-revert ownership is a substring `includes()` match, not a path-boundary match

**Severity:** Informational
**Location:** `scripts/menubar/service-control-action.mjs` — `stepStatusline()`, line 167 (`!String(cmd).includes(p.statuslineTarget)`)
**Status:** Accepted (precise remediation noted; not applied in-stage — see below)

**Description:** The teardown reverts `~/.claude/settings.json` only when the
`statusLine.command` is judged to belong to THIS checkout. The ownership test is
`String(cmd).includes(p.statuslineTarget)` where `statuslineTarget` is
`<checkout>/scripts/statusline.js`. This correctly **spares** a sibling install
(`<checkout>2/scripts/statusline.js` — verified left untouched) and a user's own
unrelated command (verified). But it is a **substring** test: a command whose
target is our path plus a suffix — e.g. `node <checkout>/scripts/statusline.js.bak`
— `includes()`-matches and would be reverted (verified: `touched=true`,
"removed the llmdash statusLine entry"). This is a false-positive **write** to
`settings.json` (dropping the `statusLine` key or restoring `.bak`), **not** a
wrong deletion of any file and **not** attacker-reachable: `settings.json` is a
user-local file (never peer-supplied), the real installer only ever writes the
exact `node <dir>/scripts/statusline.js`, and the trigger requires the user to
have hand-authored a *different* command that embeds our full checkout path as a
strict prefix. The blast radius is one JSON key in the user's own settings, only
during a confirmed complete-uninstall. Consistent with the accepted single-user
tailnet posture; flagged for completeness.

**Remediation:** Tighten the ownership test to a path-boundary match rather than a
bare substring — accept the match only when `statuslineTarget` appears in `cmd`
followed by end-of-string or whitespace (i.e. the command is
`node <target>` optionally followed by args), so a `…statusline.js.bak` superstring
no longer qualifies. Kept out of this stage deliberately: the real installer's
command is `node <target>` and a user may legitimately append args or a redirect,
so a naive equality tightening risks a **false negative** (failing to revert a
real wiring). The Engineer should pick the boundary regex with that call-site
context; the current behavior is safe for every real-install shape.

---

## Anti-injection trace — `osascript` / `launchctl` / `fs` (the sharpest surface)

Traced in code and confirmed structurally + empirically (hostile-input scratch
round-trip, sentinel survived):

1. **Fixed-literal AppleScript.** `confirm()` and `showMessage()` build their
   script from **constant** copy strings (`UNINSTALL_TITLE`, `uninstallBody(dir)`,
   `DATA_*`, `SERVICE_*`) passed through `asStr()` (escapes `\` and `"`). The ONE
   dynamic value in any dialog is the resolved checkout path in `uninstallBody`,
   embedded via `asStr()` — never re-fed as script. `asStr()` was fuzzed with five
   AppleScript-breakout payloads (`"; do shell script "rm -rf …`, `` `…` ``,
   `$(…)`, `" & (do shell script …) & "`, embedded newlines): each produced a
   **balanced** literal with **no unescaped interior quote**.
2. **No shell, anywhere.** `execFileSync('/usr/bin/osascript', ['-e', script])`,
   `execFileSync('/bin/launchctl', [...ARGV])`, `execFileSync('/bin/sh',
   [installer, '--remove-badge', checkout])` (the installer is ARGV[0], **not**
   `sh -c` — `checkout` is a positional `$1`, never interpreted), and
   `spawn(process.execPath, [tmpSelf, '--run', '--payload', json])`. Grep-confirmed
   **no** `shell:true`, `sh -c`, `-c`, `exec()`, `execSync`, `eval`, `new Function`,
   or template-string-into-command in the helper.
3. **Removals are `fs.rmSync`, not a shell `rm`.** Grep-confirmed
   `execFileSync('/bin/rm')` is **absent**; every delete is `fs.rmSync`/`fs.rmdirSync`
   against a resolved path.
4. **Hostile checkout path + hostile label end to end.** A scratch teardown driven
   with a checkout dir named `` check`;$(x)&"quote `` and a label
   `` com.evil`;$(touch x)&"q `` completed with every step `ok`, deleting both as
   **plain filesystem paths** — no shell interpretation. The property is the
   *mechanism* (fixed literal + ARGV + `fs`), not any one string.
5. **`process.execPath`, never bare `node`.** The detached child and the live-state
   read both spawn `process.execPath` / `$ABS_NODE` (the standing minimal-PATH
   lesson) — grep-confirmed.

## Marker-gating / never-delete-the-wrong-thing trace (the highest-stakes property)

Each removal verifies ownership **before** deleting; probed adversarially for
traversal, symlink, substring, and own-key bypass:

- **plist** (`stepService`) — `p.plist` is always `<laDir>/<label>.plist`; the
  delete targets only that constructed path. A foreign label yields a foreign
  filename, never the real `com.llmdash.dashboard.plist` unless that IS the
  resolved label. No path is derived from external input.
- **statusline** (`stepStatusline`) — reverted only when the command points at
  THIS checkout (see Finding 1 for the substring nuance). A **sibling** checkout
  sharing a path prefix (`<checkout>2/…`) and a **user's own** command were both
  left byte-identical (verified). Invalid JSON → left untouched, honest report.
- **trust** (`stepTrust`) — the `~/.claude.json` entry is deleted only via
  `Object.prototype.hasOwnProperty.call(j.projects, p.trustDir)` (own-key, not a
  broad rewrite); a foreign `/user/real/project` entry was **kept** (verified).
  `~/.llmdash` is removed only when `readdirSync(...).length === 0`.
- **wrapper** (`stepWrapper` + installer `remove_badge`) — deleted only if it
  carries the `llmdash-menu-bar-badge` marker (or is a legacy symlink, which `rm`
  unlinks without following); a non-marker user file is **spared** with an honest
  message (verified). The wrapper path is SwiftBar-dir-derived, never checkout-derived.
- **checkout** (`stepCheckout`) — `rm -rf` only the resolved
  `LLMDASH_DIR`/`~/llmdash`; no traversal, the path is resolved once up front.
- **substring-match trap** — a `settings.json` command pointing at a *different*
  install that merely shares our checkout as a prefix (`<checkout>-evil-sibling/…`)
  was correctly left untouched; the one residual substring nuance (superstring of
  our target) is Finding 1.
- **DB rescue** (`rescueDataIfNeeded`) — moves only the **named** `DATA_FILES`
  (`llmdash.db`, `-wal`, `-shm`, `claude-ratelimits.json`, `hosts.conf`) into
  `~/.llmdash/preserved-data`, created via `fs.mkdirSync(dest,{recursive})`; it
  never rm's a whole dir it doesn't own, and only rescues when the data dir is
  `isUnder(dataDir, checkout)` (a proper `path.relative` `..`/absolute check, not
  a substring).

## No privilege escalation

Every `launchctl` op is the user domain `gui/<uid>` (`uid` from
`os.userInfo().uid` / `id -u`) — `bootout`/`bootstrap`/`print`. Grep-confirmed
**no** `sudo`, **no** system domain (`system/`, `gui/0/`, `/Library/LaunchDaemons`),
**no** setuid, and every `fs` op is under user-owned paths. The two `sudo`/system
mentions in the source are comments asserting they are NOT used.

## The detached self-deleting teardown

- **Read-up-front, delete-last, no Hazard E.** `runTeardown` receives a fully
  resolved paths object; the detached `--run` child reads its inputs from the
  ARGV `--payload` JSON only. The checkout delete (`stepCheckout`) is step 5, a
  **leaf** — nothing imports from the checkout afterward. The temp self-clean at
  the very end reads only `process.argv[1]`'s realpath (the temp copy, already
  resident on APFS). The helper `import`s nothing from `../../src` or `../../config`
  — verified.
- **Ordering enforced by the caller** (`runTeardown`): service → statusline →
  trust → wrapper → (rescue) → checkout → data. Asserted by the shipped test and
  re-verified.
- **Honest partial failure, not weaponizable.** Each step returns `{ok, detail}`
  and never throws; `summarizeTeardown` names every step that did NOT complete and
  never claims a removal that didn't happen (verified via an undeletable-trust-dir
  scratch case: the message says "did NOT complete … trust"). A partial failure
  cannot be used to *hide* a wrong deletion because each step reports its own
  concrete outcome.
- **No attacker-influenced ARGV.** The child is launched by the badge process from
  operator-local resolved state (realPaths / injected test paths). No network or
  peer input reaches it; `os.tmpdir()` is `mode 700, uid <user>` on this macOS
  (verified), so the temp copy and the paths-on-command-line are same-user-only.

## Serve-only preserved

`src/server.js` is **byte-for-byte unchanged** by this feature (`git diff HEAD --
src/server.js` empty; last touched by `multi-host`). No POST/PUT/DELETE/PATCH
handler, no `writeFile`, no launchctl/uninstall import; non-GET/HEAD → 405
(`allow: GET, HEAD`); `/api/state`, `/api/trends`, `/api/hosts` are pure reads with
baseline headers + `no-store`. Every mutation in this feature is a local
`launchctl`/`fs` op in the **badge/helper** process — there is no endpoint, so a
remote tailnet peer behind the `0.0.0.0` bind cannot trigger a service toggle or
uninstall. NFR-04/NFR-10 hold.

## Live-state read + health line

`readServiceState` (in `llmdash.5s.js`) runs in the **badge render process**
(`fs.existsSync(plist)` + one `launchctl print gui/<uid>/<label>`), off the
server's request path and poller — a read failure falls back to the safe
`not-installed` (offers Install, never Remove). `serviceStateLine` (in
`src/health.js`) is a cheap fs check for the startup log; it discloses only the
plist path, label, and checkout dir — no secret/token/credential is read or logged
by either feature file (grep-confirmed). This is the accepted operator-facing
informational posture, consistent with the prior reports.

---

## Checks Performed

| Check | Result |
|---|---|
| Every `osascript` dialog is a fixed-literal AppleScript — no dynamic value concatenated into the script body | Pass |
| `osascript` invoked via `execFileSync('/usr/bin/osascript', ['-e', …])` — no shell, ARGV array | Pass |
| The one dynamic dialog value (resolved checkout path) reaches AppleScript only via `asStr()` | Pass |
| `asStr()` produces a balanced literal with no unescaped interior quote under 5 breakout payloads | Pass (empirical) |
| `launchctl` invoked via `execFileSync('/bin/launchctl', [...ARGV])` — no shell | Pass |
| Installer shell-out is `execFileSync('/bin/sh', [installer, '--remove-badge', checkout])` — script as ARGV[0], not `sh -c` | Pass |
| Removals use `fs.rmSync` (never `execFileSync('/bin/rm')` / a shell `rm`) | Pass |
| No `shell:true` / `sh -c` / `-c` / `exec()` / `execSync` / `eval` / `new Function` / template-into-command in the helper | Pass |
| Detached child spawns `process.execPath` (absolute node), ARGV array, no shell | Pass |
| Hostile checkout path + hostile label torn down as plain fs paths — no shell fired, sentinel survived, no `.pwned` | Pass (empirical) |
| plist delete marker-gated to the resolved `<laDir>/<label>.plist` only; no path from external input | Pass |
| statusline reverted only when the command points at THIS checkout; sibling + user-command left byte-identical | Pass |
| statusline ownership is a substring `includes()`, not a path-boundary match (superstring false-positive) | Finding 1 — Accepted |
| Invalid `settings.json` JSON → left untouched, honest report (no clobber) | Pass |
| trust entry removed via own-key `hasOwnProperty` only; a foreign `/user/real/project` is KEPT | Pass (empirical) |
| `~/.llmdash` removed only if empty after the refresh-cwd is gone | Pass |
| wrapper removed only with the `llmdash-menu-bar-badge` marker; a non-marker user file spared, honest message | Pass (empirical) |
| Legacy wrapper symlink unlinked with `rm`/`fs.rmSync` (never followed to its target) | Pass |
| checkout `rm -rf` only the resolved `LLMDASH_DIR`/`~/llmdash`; path resolved once, no traversal | Pass |
| substring-match trap: a different install sharing our checkout as a prefix is left untouched | Pass (empirical) |
| DB rescue moves only named `DATA_FILES` into `~/.llmdash/preserved-data`; `isUnder` is a proper `path.relative` check | Pass |
| temp copy created with `fs.mkdtempSync` under `os.tmpdir()` (mode 700, per-user) | Pass |
| No `sudo`, no system launchd domain (`system/`, `gui/0/`, LaunchDaemons), no setuid | Pass |
| Every `launchctl` op is user domain `gui/<uid>` (`uid` from `os.userInfo().uid` / `id -u`) | Pass |
| Every `fs` write/delete is under user-owned paths | Pass |
| Detached teardown reads all inputs from ARGV `--payload`; imports nothing from `../../src` or `../../config` | Pass |
| checkout delete is LAST (leaf); nothing lazily reads the checkout after it (Hazard E structurally impossible) | Pass |
| Ordering enforced: service→statusline→trust→wrapper→checkout→data | Pass |
| Honest on partial failure: each step reports ok/detail; a failed step is named, never claimed done | Pass (empirical) |
| Partial-failure path cannot hide a wrong deletion (each step reports its own concrete outcome) | Pass |
| Detached child gets no network/peer input; launched from operator-local state; tmpdir same-user-only | Pass |
| Temp self-clean gated by `basename.startsWith('llmdash-teardown-')` — never deletes checkout/arbitrary path | Pass |
| `src/server.js` byte-for-byte unchanged by this feature (empty `git diff HEAD`) | Pass |
| `server.js`: no HTTP write/mutation endpoint (no POST/PUT/DELETE/PATCH, no writeFile, no launchctl import) | Pass |
| `server.js`: non-GET/HEAD → 405 `allow: GET, HEAD`; `/api/*` reads carry baseline headers + `no-store` | Pass |
| Remote tailnet peer cannot trigger any mutation (badge-process-local; no endpoint); `0.0.0.0` gains no write surface | Pass |
| Live-state read runs in the badge process, off the request path/poller; read failure → safe `not-installed` | Pass |
| `serviceStateLine` discloses only plist/label/checkout paths — accepted informational; no secret read or logged | Pass |
| No secret/token/credential read or logged in either new file | Pass |
| README + startup output disclose the toggle, two-tier uninstall, data-preserved-by-default, SwiftBar-never-removed (FR-22) | Pass |
| SwiftBar never (un)installed — enumeration/post-uninstall copy only points to `brew uninstall --cask swiftbar` | Pass |
| Reserved `auto-refresh-*` diagnostic codes not reused by this feature | Pass |
| Zero runtime deps / no build step preserved (node builtins + `osascript`/`launchctl` only) | Pass |
| Real `com.llmdash.dashboard` service/plist/`~/llmdash`/DB verified intact before + after all scratch execution | Pass |
| No stray scratch launchd label or `llmdash-teardown-*` temp litter after runs | Pass |
| `npm test` baseline green (374 tests / 372 pass / 2 skip / 0 fail) | Pass |

---

## Convention Flags

_Nothing new worth establishing as a standing rule emerged. The load-bearing
disciplines this feature relied on — fixed-literal `osascript` + ARGV-only values,
marker-gate-before-every-delete, own-key `hasOwnProperty` for the trust entry,
user-domain `launchctl` / no sudo, read-up-front + delete-checkout-last for the
detached teardown, and serve-only 405-for-non-GET/HEAD — are already codified in
CLAUDE.md and the prior security reports. The one nuance (prefer a path-boundary
match over a substring `includes()` when gating a delete/revert on path ownership)
is captured as Finding 1's remediation and does not rise to a standing rule; the
existing "marker-gate every removal" convention already covers the intent._

---

## Addendum — Finding 1 resolved in-stage (Orchestrator-routed, 2026-07-03)

Finding 1 (the substring statusline-revert match) was **fixed forward** rather than
left Accepted, given it sits on a destructive teardown path. `stepStatusline()` in
`scripts/menubar/service-control-action.mjs` now gates the revert on a new exported
`targetIsWholeToken(cmd, target)` helper: the target `<checkout>/scripts/statusline.js`
is matched only as a **whole path token** — bounded on the right by end-of-string,
whitespace, or a quote — never another path character. The real installed command
shape (`node <dir>/scripts/statusline.js`) still reverts; a user command that is the
target plus a suffix (`.bak`, `2`, or a deeper path) is left byte-identical with the
honest "left it untouched" report. Four tests added (real shape reverts; two suffix
false-positives don't; a direct `targetIsWholeToken` unit test). Suite green at 378
(376 pass / 2 pre-existing skips). Real install verified intact (service loaded,
~/llmdash + llmdash.db + ~/.claude/settings.json untouched).

**Finding 1 status: Resolved.** Outcome stands **PASSED WITH NOTES** (now with no open
findings).
