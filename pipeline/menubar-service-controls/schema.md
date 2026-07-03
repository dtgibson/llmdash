# Schema / System Design — menubar-service-controls
**Feature:** menubar-service-controls
**Date:** 2026-07-03
**Stage:** 3 — The Architect
**Path:** Incremental (prior `menu-bar-badge` + `multi-host-badge` + install schemas exist; **no tables, no columns, no migration** — this is a system design: installer hooks + a detached teardown helper + state-aware badge dropdown items + disclosure)
**SPIKE-01 [SELF]:** PASS — detached self-uninstall survives its own origin; see `spike-report.md`
**Self-deletion call:** **detached temp-copy of a self-contained helper, read-everything-up-front, delete the checkout LAST** (SPIKE-01 rule)
**Service-toggle call:** **install = (re)generate plist + `launchctl bootstrap`; remove = `launchctl bootout` + delete plist** (OQ-01 default: delete the plist — a true unregister)
**Data-deletion call:** **preserve the DB by default; deletion is an explicit opt-in** (OQ-02 / THE ratification item)

---

## Data layer verdict

**No database change. No tables, no columns, no migration.** This feature adds **no persisted data** of its own. It (a) writes/deletes the launchd **plist** (a system config file, already the installer's job), (b) reverts the Claude **statusline** wiring and **trust** artifacts (files the installer created), (c) removes the **badge wrapper** (a generated file), and (d) deletes the **checkout** — all *removal/regeneration of install artifacts*, never a data-model change. `usage_snapshots`, `insertSnapshot`, dedup, trends, `getLatestPerWindow`, `hosts.conf`, and the whole `src/db.js` / `src/host-cache.js` layer are **untouched**. The one irreplaceable asset — `llmdash.db` — is **preserved by default** and only deleted on an explicit opt-in (FR-12). This is therefore a **system design**, not a schema change.

**Zero runtime dependencies, no build step (NFR-09).** The installer hooks are POSIX `sh` + `launchctl`/`sed` (as today); the helper is Node builtins (`node:child_process`, `node:fs`, `node:os`, `node:path`) + macOS-native `osascript`/`launchctl` only. `package.json` runtime deps stay at **0** (confirmed: `dependencies: {}`). macOS/launchd only — the Linux systemd unit is out of scope (NFR-09).

**HTTP stays read-only (NFR-04).** No new endpoint; `src/server.js` keeps its non-GET/HEAD → 405 (`allow: GET, HEAD`), baseline headers, static `no-store`. Every mutation here is a local `launchctl`/fs op in the **badge/helper** process, off the request path and off the poller tick (NFR-10).

---

## Area A — the installer hooks (single source of truth, FR-17)

`scripts/install-macos.sh` already owns plist generation (`sed` from the template, resolving absolute node/codex/claude paths), `launchctl load`, `setup_badge`/`remove_badge` (marker-gated), the statusline wiring (+`.bak`), and `resolve_node`/`resolve_codex`/`resolve_claude`. This feature **extends that script** with the service + uninstall hooks so the launchctl/plist/teardown logic has **one home**. The badge helper *invokes* these; it never duplicates launchctl/plist code (QA-17).

New hooks, matching the existing `--setup-badge`/`--remove-badge`/`--resolve-*` dispatch block (the `if [ "${1:-}" = … ]` ladder near line 252):

### `--service install|remove|status [project-dir]`

```
--service install   → resolve_node/codex/claude (existing fns) → regenerate the plist from
                      macos/com.llmdash.dashboard.plist.example via the SAME sed substitution
                      the main flow uses (NODE_PATH/PROJECT_DIR/CODEX_PATH/CLAUDE_PATH/port) →
                      write ~/Library/LaunchAgents/com.llmdash.dashboard.plist →
                      launchctl bootout gui/<uid>/com.llmdash.dashboard 2>/dev/null || true  (idempotent reload)
                      launchctl bootstrap gui/<uid> "$PLIST"  (load; RunAtLoad+KeepAlive already in the template)
                      → print the resulting live state (status logic below)
--service remove    → launchctl bootout gui/<uid>/com.llmdash.dashboard  (unregister; honest if already gone)
                      → rm -f "$PLIST"   (delete the plist — a true "remove", OQ-01 default)
                      → print "not installed"
--service status    → print running | stopped | not-installed  (the live-state read, below)
```

- **Plist regeneration, never a stale cached plist (FR-02/QA-02):** `--service install` re-runs the existing `resolve_node`/`resolve_codex`/`resolve_claude` probes and the existing `sed` template substitution, so re-adding the service bakes **fresh absolute paths** (matching the fresh-install decision). It is factored so both the main install flow (step 4/5 today) and `--service install` call the **same** generate-and-load helper — no second copy of the sed/launchctl logic (QA-17).
- **launchctl verbs (SPIKE-01 finding 5):** `bootout gui/<uid>/<label>` to unregister (pairs with the plist delete), `bootstrap gui/<uid> <plist>` to load. Both in the **user** domain — no `sudo`, no system domain (NFR-03/QA-23). The existing main flow's `launchctl unload/load -w` stays as-is for back-compat, but the new hooks use the modern `bootout`/`bootstrap` pair (with the `<uid>` resolved from `id -u`).
- **Idempotence (FR-07/NFR-07/QA-07):** `install` when already loaded → `bootout || true` then `bootstrap` = a friendly reload (regenerates the plist, reloads). `remove` when not installed → `bootout` of an absent label is a no-op and `rm -f` of an absent plist is a no-op → prints "nothing to remove", exits 0.
- **Plist-present-but-unloaded (FR-08/QA-08):** `status` reports "stopped" when the plist is on disk but `launchctl print` fails; `install` bootstraps it; `remove` deletes it.

### The live-state read (FR-04/QA-04) — running | stopped | not-installed

```
uid=$(id -u)
if [ ! -f "$PLIST" ]; then
  state=not-installed          # no plist on disk
elif launchctl print gui/$uid/com.llmdash.dashboard >/dev/null 2>&1; then
  state=running                # bootstrapped into the user domain (loaded)
else
  state=stopped                # plist present but not bootstrapped
fi
```

Honest and never faked: the state is derived from `launchctl print`'s exit code + the plist's on-disk presence, both cheap and off the request path. `--service status` prints exactly one of `running`/`stopped`/`not-installed` on stdout (the badge shells this to label the toggle — see Area C).

### `--uninstall [--keep-data] [--yes] [project-dir]`

The enumerated two-tier teardown. **Because `install-macos.sh` itself lives in the checkout being deleted, the destructive full-uninstall is driven by the detached node helper (Area D), not run inline in the shell.** The `--uninstall` shell hook is the **non-self orchestration + the single-source enumeration text**; the helper handles the detach + the checkout-delete-last (see Mechanism). The shell hook is still the source of truth for *what* is torn down and *the ordering*; the node helper is the *executor* that survives its own origin.

Concretely, the split:
- `install-macos.sh --uninstall` exposes the **step functions** (unload+delete plist; revert statusline; remove trust artifacts; remove wrapper marker-gated) and the **enumeration string**, reusing `remove_badge`/`swiftbar_plugin_dir`/`BADGE_WRAPPER_MARKER` verbatim.
- The **detached node helper** (Area D) calls these steps in order and owns the **checkout-delete-last** (the leaf op the shell script can't safely do to itself mid-run). For the non-badge, non-checkout steps, the helper may shell `install-macos.sh --uninstall --step=<name>` **before** it deletes the checkout (all reads-up-front, SPIKE-01 rule), or inline the equivalent fs ops — Engineer's call, but **nothing may lazily read from the checkout after the delete step** (Hazard E).

---

## The teardown ordering (FR-13, proven in SPIKE-01) — the load-bearing sequence

```
1. service    launchctl bootout gui/<uid>/com.llmdash.dashboard   +  rm -f "$PLIST"
              (plist delete marker-gated: only the com.llmdash.dashboard label's file)
2. statusline revert ~/.claude/settings.json — ONLY if statusLine.command points at THIS
              checkout's scripts/statusline.js; restore settings.json.bak if present; else
              delete the statusLine key we added. If it points ELSEWHERE → leave untouched. (FR-14)
3. trust      delete the ~/.claude.json `projects[<claudeRefreshCwd>]` entry (own-key check)
              + rm -rf ~/.llmdash/claude-refresh-cwd. (FR-11/FR-13)
4. wrapper    remove_badge — rm the SwiftBar wrapper ONLY if it carries the
              `llmdash-menu-bar-badge` marker (a non-marker user file is spared, honest msg). (FR-10/FR-15)
5. checkout   rm -rf the resolved checkout (LLMDASH_DIR override or ~/llmdash) — LAST,
              from the detached temp-copied helper. (FR-13/FR-19 [SELF])
6. data       ONLY if --delete-data (opt-in): rm the llmdash-owned files under config.dataDir
              (llmdash.db, claude-ratelimits.json, hosts.conf) — AFTER the checkout (data may
              live under it). Default: preserved. (FR-12)
```

Each step is **marker-gated** (NFR-05) and **honest on partial failure** (FR-20): a step records ok/detail; a failed step (bootout of an already-gone label, an undeletable file, a label mismatch) is reported in the post-uninstall message with exactly what did **not** happen and what remains, never claimed as done.

### Statusline revert scoping (FR-14/QA-14) — the exact match

The installer wires `settings.json` with `command: 'node ' + dir + '/scripts/statusline.js'` (install-macos.sh step 6). The revert:
- **Match:** `s.statusLine.command` contains this checkout's `…/scripts/statusline.js` (resolve `dir` = `LLMDASH_DIR` override or `~/llmdash`).
- **On match:** if `settings.json.bak` exists → restore it (copy over + delete the `.bak`); else → delete the `statusLine` key llmdash added and rewrite. (Out of scope: reconstructing a user's own pre-existing statusline beyond the `.bak` the installer wrote.)
- **No match** (points at a **different** llmdash checkout, or a user's own command) → **leave untouched**, report honestly. Proven in SPIKE-01 Context A (a `command` not containing this checkout was left alone; `/some/other/dir` in `.claude.json` was kept).

### Trust artifacts (FR-11/FR-13) — surgical, own-key

`config.claudeRefreshCwd` = `~/.llmdash/claude-refresh-cwd`. Claude Code records a one-time "trust this folder" entry keyed by that path in `~/.claude.json` under `projects`. The teardown deletes **only** that key (own-key `hasOwnProperty` check — never a broad rewrite) and `rm -rf`s the `~/.llmdash/claude-refresh-cwd` dir. Other `projects` entries (a user's real projects) are untouched (proven: `/some/other/dir` kept). `~/.llmdash` itself is removed only if empty after the refresh-cwd is gone (never blindly — a user may have other things there).

---

## Area B — the enumerated confirmation (FR-11) & data opt-in (FR-12)

The complete-uninstall **enumerates every artifact before acting** in a fixed-literal `osascript` dialog. The floor copy (Designer refines wording, preserving the enumeration + honesty + the data opt-in):

```
Uninstall llmdash from this Mac?

This will remove:
  • the launchd service (com.llmdash.dashboard) and its plist
  • the menu-bar badge wrapper
  • the app checkout at <resolved checkout path>
  • the Claude Code statusline wiring (restoring your backup if present)
  • the auto-refresh trust folder (~/.llmdash/claude-refresh-cwd) and its ~/.claude.json entry

Your usage-history database (llmdash.db) is PRESERVED by default — it's the only
thing here that can't be rebuilt. SwiftBar is NOT removed (uninstall it yourself
with: brew uninstall --cask swiftbar).

[Cancel]  [Uninstall]
```

Then, **only if the user chose Uninstall**, a **second** dialog offers the data opt-in (FR-12), worded to name irreversibility:

```
Also delete your usage history (llmdash.db)? This can't be undone.
[Keep my history]  [Delete history too]
```

- **Cancel at either dialog changes nothing** (NFR-01). Proven inert in SPIKE-01 (the confirm-declined path performs no removal).
- The **data opt-in defaults to Keep** — the destructive answer requires an explicit second click (FR-12). This second dialog maps to the helper's `--delete-data` flag / `--keep-data` default (test seam: injectable, no real dialog).
- **`--service remove` / "Remove local service"** gets its own single confirm naming the consequence ("This Mac stops running a local monitor…"); **install** gets a lighter confirm (OQ-03 default: yes, every mutation confirmed, lighter copy). Both fixed-literal (NFR-02).

---

## Area C — the badge dropdown additions (FR-01, FR-09) — BOTH modes

The two controls live in the **shared action-lines helper** so they appear in **single-host AND multi-host** dropdowns (a fresh single-host / monitoring-station machine reaches them). The existing `hostConfigActionLines({ remotes })` in `scripts/menubar/llmdash.5s.js` is the precedent — it is already called from **both** `dropdownLines` (single) and `multiDropdownLines` (multi). The new items ride the **same shared helper** (or a sibling helper called right after it in both places), so there is **one source** for the service/uninstall items and they are structurally present in both modes (QA-01/QA-09).

### State-aware service item (FR-01/FR-04)

The badge learns the live launchd state cheaply by **shelling `install-macos.sh --service status`** under `$ABS_NODE`-adjacent — but per NFR-10 the read must be **off the request path**; it happens in the **badge render process** (which already spawns nothing on the server). Two options, Engineer's call:
- **(a) The badge shells `--service status`** once per render (a cheap `launchctl print` + `-f` check; the badge process, not the server). Simple; one subprocess per 5s render.
- **(b) A tiny state read inline in the plugin** (`fs.existsSync(plist)` + a `launchctl print` via `execFileSync`) — same cost, no shell hop.

Either way the read is **live, never faked** (FR-04). The resulting label:

```
state = not-installed → "＋ Install the local service"   (shell → service-control-action.mjs install)
state = running       → "－ Remove the local service"    (shell → service-control-action.mjs remove)   + a "· running" suffix
state = stopped       → "－ Remove the local service"    (+ a "· stopped" suffix)  [install path also offered to reload]
```

Rendered as SwiftBar action lines exactly like the host-config actions:
```
＋ Install the local service | shell="${ABS_NODE}" param1="${SERVICE_CONTROL_ACTION}" param2=install terminal=false refresh=true
－ Remove the local service · running | shell="${ABS_NODE}" param1="${SERVICE_CONTROL_ACTION}" param2=remove terminal=false refresh=true
```

### Uninstall submenu (FR-09) — both modes

```
Uninstall llmdash…
  ↳ Remove the menu-bar badge only | shell="${ABS_NODE}" param1="${SERVICE_CONTROL_ACTION}" param2=remove-badge terminal=false refresh=true
  ↳ Uninstall llmdash completely…  | shell="${ABS_NODE}" param1="${SERVICE_CONTROL_ACTION}" param2=uninstall terminal=false refresh=true
```

- **"Remove badge only"** delegates to the existing `remove_badge` (marker-gated; leaves service/checkout/data). After it, SwiftBar loses the wrapper → the badge disappears on the next refresh (FR-16).
- **"Uninstall completely"** launches the enumerated confirm (Area B) then the detached teardown (Area D).
- After a service-remove or a complete uninstall, the badge's loopback `/api/hosts` read fails → the **existing** offline state renders (no fabricated number, no crash — FR-16/QA-16); remote-host watching is unaffected (FR-06).

---

## Area D — `scripts/menubar/service-control-action.mjs` (new, tracked) — the helper

A **new tracked sibling** of `host-config-action.mjs` under `scripts/menubar/`, delivered by the **same** marker-gated wrapper / absolute-node model (NFR-08). It mirrors `host-config-action.mjs`'s hardening exactly.

```
node service-control-action.mjs install       → confirm (light) → install-macos.sh --service install → showMessage(state)
node service-control-action.mjs remove        → confirm (consequence) → install-macos.sh --service remove
node service-control-action.mjs remove-badge  → install-macos.sh --remove-badge
node service-control-action.mjs uninstall     → enumerate+confirm → data opt-in dialog → DETACHED teardown
node service-control-action.mjs uninstall --yes --keep-data      (test seam: skip dialogs, drive by injected flags)
node service-control-action.mjs uninstall --yes --delete-data    (test seam: opt-in deletion)
```

### Anti-injection (NFR-02, mirrors host-config-action.mjs verbatim)

- **Fixed-literal AppleScript** for every dialog (the enumeration is our own copy; the resolved checkout path is embedded via the existing `asStr()` AppleScript-string escaper, never re-fed as script). `execFileSync('/usr/bin/osascript', ['-e', <fixed>], …)` — **no shell**.
- **`execFileSync('/bin/launchctl', […ARGV])`** for launchctl, `execFileSync('/bin/rm'…)` avoided in favor of `fs.rmSync` — **no `sh -c`, no `eval`**, values as ARGV / captured stdout only.
- Runs under `process.execPath` / `$ABS_NODE` (the absolute node the wrapper bakes) — a bare `node` is dead under the minimal spawn PATH (standing lesson).

### The detached uninstall (FR-19 [SELF], SPIKE-01) — the exact mechanism

Per SPIKE-01, `service-control-action.mjs uninstall`, after the confirms:
1. **Copies the self-contained teardown logic to a temp dir** (`fs.mkdtempSync` under `os.tmpdir()`), `cd`s there (`cwd: tmpDir`), spawns `process.execPath` against the temp copy with `detached:true, stdio:'ignore'`, `unref()`s, and **returns immediately** (exit 0) — as the badge action expects.
2. The **detached child** runs the ordered teardown (FR-13), reading **every path it needs up front** (all passed on ARGV: label, plist, checkout, settings, claude-json, trust-dir, wrapper, data-dir, flags), and **never lazily imports from the checkout after the delete** (Hazard E). It deletes the checkout LAST and the data dir only on `--delete-data`, then exits 0.
3. The checkout-delete is a **leaf** — nothing loads after it. SwiftBar loses the wrapper (deleted in step 4 of the ordering) and the badge disappears on the next refresh.

**The teardown helper is self-contained** (Node builtins only, all inputs on ARGV) precisely so the temp copy needs nothing from the checkout. This is the SPIKE-01 binding rule made concrete.

### Injectable scratch paths (FR-21/QA-21) — the test seam

Mirroring `host-config-action.mjs`'s `opts.hostsFile` seam, the helper takes **injectable paths** (plist, checkout, settings, claude-json, trust-dir, wrapper, data-dir) and **injectable confirmation** (`--yes`, `--keep-data`/`--delete-data`, or `LLMDASH_ACTION_NONINTERACTIVE=1`) so the **full round-trip runs against scratch dirs with no real dialog, no real `launchctl`, no touch of the real service/checkout/data**. The label is injectable too (tests use `com.llmdash.spike-*`, never `com.llmdash.dashboard`). Production omits the injections → the real resolved paths.

---

## Area E — disclosure (FR-22)

- **`src/health.js`** (`healthLines()`): add a **service-state line** (OQ-05 default: yes) — a cheap fs check (`fs.existsSync(plist)`) + the checkout it would act on, naming running/stopped/not-installed and where an uninstall would act. Off the request path, consistent with the existing `hostsConfigLine`/`peerHealthLines` convention. Example: `  Service: launchd agent installed (com.llmdash.dashboard, plist present) — the menu-bar badge can remove or uninstall it; a complete uninstall would remove this checkout (<dir>), the badge wrapper, the statusline wiring, and the trust folder, preserving llmdash.db by default.`
- **README** + the installer's badge-setup / startup output: disclose the new powers — the menu-bar service toggle, the two-tier uninstall, the **data-preserved-by-default** default, and the **SwiftBar-never-removed** rule (FR-22/QA-22), consistent with "surface security-relevant defaults, never silently."
- The `remove_badge` message already points to `brew uninstall --cask swiftbar` as a manual step; the uninstall enumeration + post-uninstall message do the same (FR-15).

---

## Data flow (end to end)

```
badge dropdown "Uninstall llmdash completely…"  (shell=$ABS_NODE service-control-action.mjs uninstall, terminal=false refresh=true)
  → service-control-action.mjs: osascript ENUMERATE+CONFIRM dialog (fixed-literal, lists every artifact, DB preserved by default)
       Cancel → nothing changes, exit 0
  → osascript DATA OPT-IN dialog (default Keep) → --keep-data | --delete-data
  → copy self-contained teardown to os.tmpdir(), spawn(process.execPath, [tempCopy, …ARGV, --run], {cwd:temp, detached:true}).unref()
  → action returns (exit 0); badge action done
  ───────────── the DETACHED child (survives bootout + rm -rf of its origin) ─────────────
  → 1 service:    launchctl bootout gui/<uid>/com.llmdash.dashboard + rm plist
  → 2 statusline: restore settings.json.bak IF wiring points at THIS checkout (else untouched)
  → 3 trust:      delete ~/.claude.json projects[refresh-cwd] (own-key) + rm ~/.llmdash/claude-refresh-cwd
  → 4 wrapper:    remove_badge (marker-gated) → SwiftBar loses the wrapper
  → 5 checkout:   rm -rf <resolved checkout>  ── LAST (leaf; nothing loads after)
  → 6 data:       only if --delete-data, AFTER checkout; else PRESERVED
  → exit 0 (honest per-step report; SwiftBar refresh → badge gone)
```

HTTP is **read-only** throughout — the only mutations are local `launchctl`/fs ops in the badge/helper process; the server never mutates and grows no endpoint (NFR-04/QA-24).

---

## Modules

| File | Change |
|---|---|
| `scripts/install-macos.sh` | **+`--service install\|remove\|status` and `--uninstall [--keep-data]` hooks** in the existing dispatch ladder. Factor the main-flow plist generate+load (steps 4/5) into a shared fn both the main flow and `--service install` call (no duplicate sed/launchctl). `--service remove` = `bootout`+`rm plist`. `--service status` = the live-state read. `--uninstall` exposes the ordered step fns + the enumeration text; reuses `remove_badge`/`swiftbar_plugin_dir`/`BADGE_WRAPPER_MARKER`/`resolve_*` verbatim. Uses `bootout`/`bootstrap gui/<uid>` (user domain, no sudo). +disclosure lines. |
| `scripts/menubar/service-control-action.mjs` | **New, tracked.** The install/remove/remove-badge/uninstall helper the SwiftBar actions invoke under `$ABS_NODE`. Fixed-literal osascript confirms (reuse `asStr()` from host-config-action or a shared copy), `execFileSync`/no-shell, ARGV-only, `process.execPath`. The DETACHED temp-copy uninstall (self-contained, read-up-front, checkout LAST). Injectable scratch paths + `--yes`/`--keep-data`/`--delete-data` test seam. |
| `scripts/menubar/llmdash.5s.js` | **+service/uninstall dropdown items in the shared action-lines path** (present in single AND multi mode via `dropdownLines` + `multiDropdownLines`, like `hostConfigActionLines`). +the live-state read to label the toggle (badge process, off the request path). `SERVICE_CONTROL_ACTION` resolved from `PLUGIN_DIR` (sibling of the plugin), execed via `ABS_NODE`. No HTTP mutation. |
| `src/health.js` | **+a service-state line** in `healthLines()` (OQ-05): plist present? checkout resolved? what a complete uninstall would touch, DB-preserved-by-default. Cheap fs check, off the request path. |
| `macos/com.llmdash.dashboard.plist.example` | **Unchanged** (the template `--service install` regenerates from). |
| `config.js` | **Unchanged** — `dataDir`/`dbPath`/`rateLimitsFile`/`hostsFile`/`claudeRefreshCwd`/`LLMDASH_DIR` resolution all reused as-is by the helper (paths passed on ARGV). No new knob (the uninstall's data-opt-in is a dialog choice / flag, not an env knob — no dead knob). |
| `src/server.js` | **Unchanged.** 405-for-non-GET/HEAD, baseline headers, `no-store` all stay; no new endpoint (NFR-04/QA-24). |
| `README.md` | **+a service-toggle + two-tier-uninstall section** (FR-22): the menu-bar powers, data-preserved-by-default, SwiftBar-never-removed, the manual `brew uninstall --cask swiftbar` pointer. |
| `tests/menubar-service-control.test.js`, `tests/install-service-hooks.test.js`, `tests/menubar-uninstall-dropdown.test.js` (new); extend `tests/menubar-install.test.js`, `tests/health.test.js`, `tests/server.test.js` | **New/extended.** (See *Test seams*.) |

**Untouched:** `src/db.js`, `src/stats.js`, `src/codex-stats.js`, `src/trends.js`, the `usage_snapshots` schema, `getCombined`/`host-cache.js`, `src/hosts.js`/`src/host-config.js`, the `/api/state` + `/api/hosts` contracts, `hosts.conf`, the freshness thresholds/diagnostic reason codes.

---

## Security / posture (NFR-01–NFR-05, NFR-09, NFR-10 — for the Auditor)

- **No privilege escalation (NFR-03/QA-23).** Every `launchctl` op is the **user** domain `gui/<uid>` (`bootout`/`bootstrap`/`print`); every file op is under user-owned paths. No `sudo`, no system launchd domain, no write outside user-owned locations. Proven in SPIKE-01.
- **Structural anti-injection (NFR-02/QA-18).** Fixed-literal AppleScript; `execFileSync('/usr/bin/osascript'|'/bin/launchctl', […])` with **no shell**; every dynamic value (a resolved path, the label) reaches the helper only as ARGV / captured stdout, never concatenated into a command or script. No `sh -c`, no `eval`. Mirrors the shipped `host-config-action.mjs`.
- **Marker-gating on every removal (NFR-05/QA-25).** Wrapper only with the `llmdash-menu-bar-badge` marker; statusline only when it points at THIS checkout; plist only the `com.llmdash.dashboard` label's file; checkout only the resolved `LLMDASH_DIR`; trust entry only the own-key `claudeRefreshCwd` match. A user's own file at any of these is spared with an honest "left untouched" message. Proven (wrapper, statusline/trust) in SPIKE-01.
- **HTTP stays read-only (NFR-04/QA-24).** No new endpoint; the mutations are local `launchctl`/fs ops in the badge/helper process; the request path and poller tick do no new work (NFR-10/QA-28). The `0.0.0.0` bind gains no write surface.
- **Honest on partial failure (NFR-06/FR-20/QA-20).** Every step records ok/detail; a failed step is named in the post-uninstall message ("service removed; the checkout could NOT be deleted — remove <dir> by hand") and never claimed as done. The final defensive message covers a checkout-delete IO failure (SPIKE-01 fallback, reduced to the honest-partial path).
- **Confirm on every mutation (NFR-01).** Service remove (consequence copy), service install (light, OQ-03), badge-only removal, complete uninstall (enumerated), data deletion (irreversibility copy) — each an explicit `osascript` confirm; a cancel changes nothing.

---

## Test seams (Stage-6 QA table)

Every logic check is **pure or injectable** against scratch fixtures — **no real service, checkout, data dir, or dialog** (the live in-menu-bar render + real dialogs are deploy-time captures, per the badge's shipped deferral). The scratch pattern mirrors `tests/menubar-install.test.js` (temp checkout, scratch SwiftBar dir via `LLMDASH_SWIFTBAR_DIR`, distinct label `com.llmdash.spike-*`, fake bins).

- **Installer service hooks** (`tests/install-service-hooks.test.js`, spawn `install-macos.sh` against a scratch checkout + scratch `HOME`/LaunchAgents-like dir + a distinct label injected):
  - `--service install` regenerates the plist from the template with **absolute** node/codex/claude paths (no placeholders remain) and issues `bootstrap` (QA-02); the generated plist is inspected + the recorded launchctl invocation checked.
  - `--service remove` issues `bootout` **and** deletes the scratch plist; the file is gone (QA-03).
  - `--service status` classifies not-installed / stopped / running from plist-presence + `print` (QA-04/QA-08) over the three scratch states.
  - idempotence: install-when-installed reloads without error; remove-when-absent → "nothing to remove", exit 0 (QA-07).
  - hooks are the single source of truth: no second launchctl/sed copy (QA-17, by inspection).
- **`service-control-action.mjs` — round-trip, no real dialog/service** (`tests/menubar-service-control.test.js`, drive with `--yes`/`--keep-data`/`--delete-data` + injected scratch paths + a distinct scratch label):
  - the ordered teardown removes artifacts service→statusline→trust→wrapper→checkout→data; each scratch artifact gone afterward, data per opt-in (QA-13).
  - data preserved by default; `--delete-data` deletes the scratch DB, after the checkout (QA-12).
  - statusline revert restores the scratch `.bak` when pointing at the scratch checkout; left untouched (honest report) when pointing elsewhere (QA-14).
  - marker-gating: a scratch wrapper without the marker is spared; a foreign plist label / different statusline target / non-owned trust key is not removed (QA-10/QA-25).
  - anti-injection by inspection (no value concatenated into an `-e` string; `execFileSync` no-shell; `process.execPath`) + a hostile-input round-trip that stays inert (QA-18).
  - honest partial failure: an injected failure (undeletable scratch file / bootout error) → the message states what did NOT happen; no removal claimed for it (QA-20).
  - the detached-survival check (QA-19 [SELF]): the SPIKE-01 harness, generalized into a test — a detached teardown against a **scratch** install completes + exits 0 after the scratch label's `bootout` and the scratch checkout's `rm -rf`. Distinct label, scratch paths only.
- **Badge dropdown items in BOTH modes** (`tests/menubar-uninstall-dropdown.test.js`, pure over injected state):
  - given launchd state not-installed → "Install the local service"; installed → "Remove the local service" — asserted in single-host AND multi-host fixtures (QA-01).
  - both uninstall tiers ("Remove badge only" + "Uninstall completely") present in both modes (QA-09).
  - the items shell to `$ABS_NODE`/`process.execPath` against `service-control-action.mjs`, no HTTP mutation (by inspection).
- **Badge offline after service removed** (extend `tests/menubar-degradation.test.js`): a failing local `/api/hosts` → the existing offline glyph, no number/crash; wrapper-removed → absent from the scratch SwiftBar dir (QA-06/QA-16).
- **SwiftBar never removed** (extend `tests/menubar-install.test.js`): no code path runs `brew uninstall --cask swiftbar`; the enumeration/post-uninstall copy points to it; a missing scratch SwiftBar dir → by-hand instructions, not an error (QA-15).
- **Delivery model preserved** (extend `tests/menubar-install.test.js`): the tracked `service-control-action.mjs` rides the marker-gated wrapper/absolute-node model; `--remove-badge` reverses symmetrically; the tracked source is never rewritten (QA-27).
- **Disclosure** (extend `tests/health.test.js` + a README assertion): `healthLines()` names the service state + uninstall scope; README documents the toggle, two-tier uninstall, data-preserved default, SwiftBar-never-removed (QA-22).
- **HTTP read-only preserved** (extend `tests/server.test.js`): all responses carry baseline headers, non-GET/HEAD → 405 (`allow: GET, HEAD`), static `no-store`; no new write endpoint; the request path does no launchctl/uninstall work (QA-24/QA-28).
- **Zero deps / no build / macOS-only** (extend `tests/hosts-zerodep.test.js` or a new guard): `package.json` runtime deps still 0; the helper + hooks use only Node builtins + `osascript`/`launchctl`; no build step; the feature guards against the Linux systemd path (QA-26).
- **No privilege escalation** (by inspection + the scratch-only test paths): no `sudo`, no system domain, no path outside user-owned locations (QA-23).

---

## Risks the Engineer inherits

1. **Self-deletion ordering & the lazy-import trap (FR-13/FR-19, SPIKE-01 Hazard E).** The detached teardown must be **self-contained** (or run from a temp copy) and **read everything from the checkout BEFORE the delete step**. A single `await import('../../src/…')` or a shell-out to `install-macos.sh` *after* the checkout is gone throws `ERR_MODULE_NOT_FOUND`. Do all reads-up-front; delete the checkout LAST as a leaf. The temp-copy + ARGV-only inputs is the chosen structural guard.
2. **The installer script deletes itself (FR-17 ↔ FR-19).** `install-macos.sh` lives in the checkout being removed. The node helper — not the shell script — owns the checkout-delete-last. Any `--uninstall --step=…` shell calls must happen **before** the delete step. Don't let the final delete depend on the shell script still existing.
3. **Live-state read placement (FR-04/NFR-10).** The `launchctl print`/`--service status` read must run in the **badge render process**, never on the server's request path or poller tick. One subprocess per render is fine; the server gains no work.
4. **Single + multi mode presence (FR-01/FR-09).** The service/uninstall items must ride the **shared** action-lines path so they show in both single-host and multi-host dropdowns — like `hostConfigActionLines`, which is already called from both `dropdownLines` and `multiDropdownLines`. Don't add them to only one renderer.
5. **Never touch a DIFFERENT install (FR-14/NFR-05).** The statusline revert only fires when the wiring points at THIS checkout; the plist delete only the `com.llmdash.dashboard` label; the checkout only the resolved `LLMDASH_DIR`. A second llmdash checkout on the same Mac, or a user's own statusline command, must be left untouched.
6. **launchctl verb hygiene (SPIKE-01 finding 5).** Use `bootout gui/<uid>/<label>` + `bootstrap gui/<uid> <plist>` (modern, per-domain, user domain). Resolve `<uid>` from `id -u`. Never `sudo`, never a system domain.
7. **Honest partial failure is per-step (FR-20).** Report exactly what did NOT happen (e.g. "service removed; checkout could not be deleted — remove <dir> by hand"); never claim a removal that didn't occur. This is also the reduced SPIKE-01 fallback for a checkout-delete IO failure.
8. **process.execPath, not `node` (standing lesson).** The detached child and every action shell must use the absolute node (`process.execPath` / `$ABS_NODE`) — a bare `node` is dead under the minimal spawn PATH.

## Open sub-decisions left to the Designer / user (FLAGS)

- **Uninstall scope + data-deletion default + confirmation copy (OQ-01/OQ-02/OQ-03) — THE ratification item.** The two-tier structure, delete-the-plist-on-remove (OQ-01 default), preserve-DB-by-default with an explicit opt-in (OQ-02 default), and the enumerated + irreversibility copy (Area B) are the working defaults — **flagged for the user to ratify at the Designer stage.** The Designer refines wording while preserving the enumeration + honesty + the data opt-in.
- **Service-item labels + state suffix (OQ-02).** "Install/Remove the local service" + a `· running`/`· stopped` suffix are the working default; the Designer refines within the xbar-safe grammar.
- **Live-state read mechanism (Area C a vs b)** — shell `--service status` vs inline `execFileSync` — Engineer's call; both are cheap, off the request path, and live-never-faked.
- **The health-line exact copy (OQ-05)** — a service-state line in `healthLines()` is the default-yes; final wording is the Architect's/Engineer's within the health-readout convention.
