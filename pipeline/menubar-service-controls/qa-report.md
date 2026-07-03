# QA Report — Menu-bar Service Controls

**Feature:** menubar-service-controls
**Date:** 2026-07-03
**Stage:** 6 — The Tester
**Lane:** New Feature (`sessionType: "feature"`)
**Test Runner:** node:test (`npm test`)
**Result:** **PASSED**

---

## Test Suite Results

`npm test` — **374 tests, 372 pass, 0 fail, 2 skipped.** Matches the Engineer's
reported baseline exactly. No new failures, no new skips.

### The 2 skips (pre-existing, environment-dependent — NOT new omissions)

Both live in `tests/menubar-install.test.js` and skip because a system-wide `node`
exists on this Mac, so the "node cannot be resolved" failure path can't be exercised
here:

- `--resolve-node: exits non-zero when node cannot be resolved (loud failure)` —
  `# SKIP a system-wide node exists on this machine`
- `--setup-badge: node unresolved → loud failure with the fix, non-zero, no dead
  badge` — `# SKIP a system-wide node exists on this machine`

These are the shipped "badge-install node-unresolved" skips (they predate this
feature). Confirmed via the TAP reporter. The feature added **zero** new skips: the
three new feature test files (`install-service-hooks`, `menubar-service-control`,
`menubar-uninstall-dropdown`) run **28 tests / 28 pass / 0 skip** in isolation.

---

## Acceptance Criteria Verification (QA-01 … QA-28)

| ID | Result | Evidence |
|---|---|---|
| QA-01 | ✓ Pass | `serviceControlActionLines` is state-aware over injected state: `not-installed → ＋ Install the local service` (`param2=install`), `running/stopped → － Remove the local service · <suffix>` (`param2=remove`). Asserted in single-host (`emit`) AND multi-host (`emitMulti`) fixtures. Independently reproduced: live single-host dropdown emits `－ Remove the local service · running` (the suffix reflects the REAL live launchd state of `com.llmdash.dashboard`); multi-host fixture with `serviceState:"stopped"` emits `－ Remove the local service · stopped`. |
| QA-02 | ✓ Pass | `install-macos.sh --service install` against a scratch checkout + scratch LaunchAgents dir + scratch label regenerates the plist from the template with **absolute** node/codex/claude paths + the checkout as `WorkingDirectory`, issues `launchctl bootstrap gui/<uid>`, and the agent is verifiably loaded (`launchctl print` exit 0). Independently reproduced: generated plist showed `<BIN>/node`, `<BIN>/codex`, `<BIN>/claude`, the scratch checkout, the scratch label — **0 placeholders remaining, 0 real-label leaks**. |
| QA-03 | ✓ Pass | `--service remove` issues `launchctl bootout` **and** `rm -f "$PLIST"`; the scratch plist file is gone afterward ("unloaded and deleted the plist … State: not-installed"). Reproduced independently against a scratch label. |
| QA-04 | ✓ Pass | Live state derived from `[ -f "$PLIST" ]` + `launchctl print` exit code → exactly one of `running`/`stopped`/`not-installed` on stdout. Round-trip over all three scratch states passes. `readServiceState` (badge-side) is injectable and never faked — `execFile` stub throwing → `stopped`, returning → `running`, no plist → `not-installed`. |
| QA-05 | ✓ Pass | `runRemoveService` gates on `confirm(...)` with the **safe** default button (`Cancel`); a declined confirm (or `interactive:false` without `--yes`) returns `{ok:false, reason:'cancelled'}` — no `launchctl`, no plist delete. `--yes`/non-interactive proceeds. (Verified by inspection of `runRemoveService`/`runInstall` + the `confirm` default-button-is-Cancel discipline.) |
| QA-06 | ✓ Pass | `tests/menubar-degradation.test.js`: a failing local `/api/hosts` read lands on the existing offline glyph, exit 0, no fabricated number, no crash; remote-host watching path is unaffected. The service/uninstall items ride the LIVE dropdown, not the offline one. |
| QA-07 | ✓ Pass | `--service install` when already installed → `bootout \|\| true` then `bootstrap` = friendly reload (`State: running`, exit 0, no error). `--service remove` when absent → "nothing to remove", exit 0. Both reproduced independently. |
| QA-08 | ✓ Pass | A scratch plist present but not bootstrapped → `--service status` reports `stopped` (not `not-installed`); install loads it, remove deletes it. |
| QA-09 | ✓ Pass | Both tiers — `⊘ Uninstall llmdash…` parent, `--▬ Remove the menu-bar badge only` (`param2=remove-badge`), `--⊘ Uninstall llmdash completely…` (`param2=uninstall`) — present in single AND multi fixtures. Tier 2 carries its own `…` and its own gate. Reproduced live in both modes. |
| QA-10 | ✓ Pass | Badge-only removal marker-gated. A scratch wrapper carrying `llmdash-menu-bar-badge` is removed; a wrapper **without** the marker is spared ("a non-llmdash file in SwiftBar's dir was spared (no marker)") and remains on disk. Reproduced independently. |
| QA-11 | ✓ Pass | `uninstallBody(dir)` enumerates the service+plist, wrapper, checkout, statusline wiring (+`.bak` restore), and trust folder + `.claude.json` entry, and states `llmdash.db` is **PRESERVED**. Cancel (declined dialog 1) → `{ok:false, reason:'cancelled'}`, nothing removed. Enumeration copy present verbatim (checked). |
| QA-12 | ✓ Pass | Default (no data opt-in) **preserves** `llmdash.db`; when data lives under the checkout it is **rescued** to `~/.llmdash/preserved-data` (scratch-homed) BEFORE the checkout delete — content intact (`DBDATA` verified at the rescued path), `data.preserved:true`. `--delete-data` deletes the DB **after** the checkout (`iCheckout < iData`), `preserved:false`. |
| QA-13 **[SELF]** | ✓ Pass | Ordered step log is exactly `service,statusline,trust,wrapper,checkout,data`; every scratch artifact gone afterward (plist, checkout, wrapper, trust dir), settings restored to the `.bak`. |
| QA-14 | ✓ Pass | Statusline revert restores the scratch `.bak` when `settings.json` points at THIS checkout's `statusline.js` (`restored settings.json.bak`); when it points ELSEWHERE it is **left untouched** and reported honestly ("points elsewhere … left it untouched"), settings byte-identical. Reproduced independently. |
| QA-15 | ✓ Pass | No code path runs `brew uninstall --cask swiftbar` (asserted over the helper + plugin + installer sources); the enumeration + post-uninstall + installer copy *point to* it as a manual step. A missing scratch SwiftBar dir → by-hand instructions, not an error. |
| QA-16 | ✓ Pass | Local read failing → existing offline glyph (no number, no crash); the offline dropdown shows NO service/uninstall items (they live on the live dropdown, which can't reach the helper offline anyway). After a complete uninstall the marker-gated wrapper is removed → badge absent on next refresh. |
| QA-17 | ✓ Pass | `install-macos.sh` exposes `--service install\|remove\|status` + `--uninstall`; the plist `sed` substitution lives in exactly one place (`generate_plist`), the main flow calls `generate_plist`/`load_service` (no second inline `sed`/`launchctl`). Modern user-domain verbs (`bootstrap gui/$uid`, `bootout gui/$uid/$SERVICE_LABEL`). The badge helper delegates to `install-macos.sh --service …` / `--remove-badge` rather than duplicating launchctl/plist code. |
| QA-18 | ✓ Pass | `child_process` imports **only** `execFileSync` + `spawn` (no `exec`/`execSync`). Every subprocess target is a fixed literal — `execFileSync('/usr/bin/osascript', ['-e', script])` (no shell), `execFileSync('/bin/launchctl', […ARGV])`, `/bin/sh [installer, …ARGV]` (script-file + ARGV, not `sh -c`), `spawn(process.execPath, …)`. No `/bin/rm` (uses `fs.rmSync`). No `sh -c`, no `eval(`. `asStr()` escapes the one dynamic value (checkout path) into a balanced AppleScript literal. Hostile input (`"; do shell script "…"`) round-trip stays inert data — no sentinel file created. |
| QA-19 **[SELF]** | ✓ Pass | The DETACHED teardown against a **scratch install** (a REAL scratch launchd agent bootstrapped under a distinct label + sleep loop, a scratch checkout carrying a copy of the helper): the action returns `{reason:'detached'}` at once; the detached child completes the ordered teardown and **exits 0 after `bootout` of its scratch label AND `rm -rf` of its scratch checkout** — checkout/plist/wrapper/trust all gone, scratch label no longer loaded, DB rescued. Reproduced by the test (158ms) with real launchctl. |
| QA-20 | ✓ Pass | An injected undeletable trust dir (read-only parent) → the trust step reports `ok:false` ("could not remove …"); `summarizeTeardown` names exactly what did NOT complete ("some steps did NOT complete: • trust: …") and never claims the removal. |
| QA-21 | ✓ Pass | The full round-trip runs with `--yes`/`--keep-data`/`--delete-data` + injected scratch `paths` + a distinct scratch label — no real dialog, no real launchctl label touched, no real checkout/data in reach. The `opts.run` inline mode returns the ordered step log for direct assertion. |
| QA-22 | ✓ Pass | `serviceStateLine()` in `src/health.js` names the service state (`launchd agent present`/`no launchd agent plist on disk`) + the uninstall scope (checkout, wrapper, statusline, trust folder) and states `llmdash.db` is preserved by default; included in `healthLines()`. README documents the toggle, two-tier uninstall, data-preserved-by-default, and the SwiftBar-never-removed rule. Asserted in `tests/health.test.js`. |
| QA-23 | ✓ Pass | No `sudo` invocation and no system launchd domain in the installer hooks (asserted line-by-line over non-comment lines); every `launchctl` op is user-domain `gui/<uid>`; every fs op is under user-owned/injected-scratch paths. |
| QA-24 | ✓ Pass | `tests/server.test.js`: all responses carry baseline headers, non-GET/HEAD → 405 (`allow: GET, HEAD`), static `no-store`; **no** new write endpoint (mutating methods on service/uninstall paths → 405, would-be routes not even GET-served); `server.js` source runs no launchctl/uninstall work. Independently reproduced against live `:8787`: `GET /` 200, `GET /api/hosts` 200, `POST /` 405. |
| QA-25 | ✓ Pass | Marker-gating across every removal: wrapper (marker check), statusline (points-at-THIS-checkout check), plist (only `$SERVICE_LABEL.plist` — a foreign `com.someone.else.plist` in the same scratch dir is untouched), trust entry (own-key `hasOwnProperty` — a user's `/some/other/dir` project is kept). All reproduced independently. |
| QA-26 | ✓ Pass | `package.json` `dependencies:{}`, `devDependencies:{}`, no build step. The helper imports ONLY `node:` builtins (`node:child_process`, `node:fs`, `node:os`, `node:path`, `node:url`) — no `../../src`/`../../config`, no dynamic `import()` from the checkout (Hazard E guard). 0 systemd refs in the feature helper; installer is macOS-scoped (`launchctl` only). |
| QA-27 | ✓ Pass | The tracked `service-control-action.mjs` rides the marker-gated wrapper/absolute-node model; `--setup-badge` leaves it byte-identical; `--remove-badge` reverses symmetrically and leaves the tracked helper intact; SwiftBar never auto-(un)installed. Asserted in `tests/menubar-install.test.js`. |
| QA-28 | ✓ Pass | The live-state `launchctl print` read runs in the badge render process (`readServiceState`, called at render, `try { readServiceState() } catch { 'not-installed' }`); the server request path and poller tick do no new work (asserted in `tests/server.test.js` + by inspection). |

---

## Edge Cases Tested (beyond the acceptance table)

- **The verb hygiene:** the installer uses `bootout gui/<uid>/<label>` + `bootstrap
  gui/<uid> <plist>` (modern per-domain, user domain), never legacy `load -w`/`unload`
  in the new hooks, never a system domain.
- **Every dialog's default button is the SAFE choice** (`Cancel` on install/remove/
  uninstall-confirm; `Keep my history` on the data opt-in) — a reflexive Return never
  destroys anything (NFR-01, verified by inspection of all `confirm(...)` calls).
- **Data-under-checkout collateral avoidance:** `isUnder()` detects a data dir living
  under the checkout (config's default `<checkout>/data`); the rescue runs before the
  checkout delete, so "preserved by default" is never silently broken by the `rm -rf`.
- **Real-service intact after the suite + independent scratch drives:** the whole run
  (which bootstraps/boots-out real scratch launchd agents) left the real
  `com.llmdash.dashboard` loaded (PID 33445), `:8787` serving 200, the real plist at
  its pre-feature baseline (971 bytes, mtime Jul 2 16:50), and **no** scratch/qa
  labels or `llmdash-teardown-*` temp dirs leaked.

---

## Known Limitations

- **Live in-menu-bar SwiftBar render + real `osascript` dialogs are deploy-time
  captures (DEFERRED).** Per the badge's shipped deferral: the *logic* (dropdown
  stdout, dialog copy, detached teardown, launchctl hooks) is fully proven against
  scratch fixtures here, but the actual in-bar SwiftBar rendering and the real
  confirmation dialogs popping are a deploy-time verification step, not automatable in
  CI. The Deployer should capture: the two service-toggle states in the live bar, the
  Uninstall submenu, and the three dialogs (enumerate, data opt-in, service-remove).
- **QA-05 (remove confirm/cancel inertness)** is verified by inspection of the
  `confirm(...)` default-button discipline + the non-interactive/`--yes` seam rather
  than by driving a real declined dialog (dialogs are deferred). The cancel-is-inert
  path is exercised structurally: no `--yes` + interactive-off short-circuits before
  any mutation.
- **The `--service install` node-unresolved loud-failure path** cannot be exercised on
  a machine with a system-wide node (same reason as the 2 pre-existing badge-install
  skips); it is guarded by inspection (`service_install` returns non-zero with the fix
  message when `resolve_node` fails).

---

## Convention Flags

*(none — nothing emerged that warrants a new standing rule. The feature already
honors the existing multi-source, marker-gating, honest-partial-failure, and
serve-only conventions in CLAUDE.md; the Engineer's self-contained/read-up-front
detached-teardown discipline is already captured in the spike report and schema.)*

---

## Real-install-intact verification (SAFETY — end of run)

All checks green after the full suite + independent scratch drives:

| Check | Result |
|---|---|
| `com.llmdash.dashboard` still loaded | ✓ `launchctl print gui/<uid>/com.llmdash.dashboard` succeeds (PID 33445) |
| No scratch labels leaked | ✓ no `com.llmdash.spike-*` / `com.llmdash.qa-*` in `launchctl list` |
| Real checkout `~/llmdash` intact | ✓ present; `~/llmdash/data/llmdash.db` present |
| Dev checkout intact | ✓ `/Users/developer/devwork/llmdash/.git` present; `data/llmdash.db` present |
| Real plist intact | ✓ `~/Library/LaunchAgents/com.llmdash.dashboard.plist` — 971 bytes, mtime Jul 2 16:50 (pre-feature baseline) |
| `:8787` serves | ✓ `GET /` 200, `GET /api/hosts` 200, `POST /` 405 |
| Real `~/.claude/settings.json` untouched | ✓ mtime Jul 1 21:32 (pre-feature) |
| No `~/.llmdash/preserved-data` created | ✓ no rescue ran against the real home (scratch homes only) |
| No `llmdash-teardown-*` temp litter | ✓ 0 in `$TMPDIR` |

**The real service, checkout, data dir, plist, and Claude config were never touched.
Every mutating check ran against scratch dirs + distinct scratch labels
(`com.llmdash.spike-*` / `com.llmdash.qa-*`), all cleaned up.**

---

*End of QA Report — menubar-service-controls. Result: PASSED.*
