## Menu-bar service controls

### What this does
Adds two install-lifecycle controls to the macOS menu-bar badge dropdown — in
**both** single-host and multi-host mode. A **state-aware local-service toggle**
installs (regenerates the plist + loads) or removes (unloads + deletes the plist)
this Mac's `com.llmdash.dashboard` launchd agent, reading the **live** launchd
state (running / stopped / not-installed) — never faked. An **"Uninstall llmdash…"
submenu** offers two tiers: remove the menu-bar badge only, or uninstall llmdash
completely (service + plist, badge wrapper, checkout, Claude statusline wiring,
and the auto-refresh trust artifacts) behind an enumerate-before-acting
confirmation, with the irreplaceable usage-history database (`llmdash.db`)
**preserved by default** and an explicit, permanent-warned opt-in to also delete
it. Every mutation is a local `launchctl` / filesystem op run by the badge process
behind an OS confirmation — **not** a new HTTP endpoint; the dashboard stays
serve-only (405 for non-GET/HEAD).

### How it works
- **`scripts/install-macos.sh`** gains `--service install|remove|status` and
  `--uninstall --enumerate|--step=…` hooks (the single source of truth for the
  launchctl/plist/teardown logic). The main install flow's plist generate+load was
  factored into shared `generate_plist` + `load_service` functions both it and
  `--service install` call — no duplicated `sed`/`launchctl`. All launchctl work is
  the **user** domain `bootout`/`bootstrap gui/<uid>` — no `sudo`, no system domain.
  The label + LaunchAgents dir are injectable (`LLMDASH_SERVICE_LABEL` /
  `LLMDASH_LAUNCH_AGENTS_DIR`) for tests.
- **`scripts/menubar/service-control-action.mjs`** (new, tracked) is the helper the
  SwiftBar actions invoke under `$ABS_NODE`. It mirrors `host-config-action.mjs`'s
  hardening: fixed-literal `osascript` dialogs via `execFileSync` (no shell),
  `execFileSync('/bin/launchctl', …)`, `fs.rmSync` (no `/bin/rm`), values on ARGV
  only, `process.execPath`. The complete uninstall runs as a **detached temp-copy
  of this self-contained file** (imports nothing from the checkout — Hazard E), so
  it survives `launchctl bootout` of its spawning service and `rm -rf` of its own
  origin checkout (SPIKE-01). Ordered teardown: service → statusline → trust →
  wrapper → checkout **last** → data (only on opt-in). When the data dir lives under
  the checkout (the default `~/llmdash/data`), the DB is **rescued** to
  `~/.llmdash/preserved-data` before the checkout is deleted.
- **`scripts/menubar/llmdash.5s.js`** adds the state-aware service item + the
  Uninstall submenu via a shared `actionClusterLines()` path called from BOTH
  `dropdownLines` (single) and `multiDropdownLines` (multi). The live launchd state
  is read in the badge render process (`fs.existsSync(plist)` + one
  `launchctl print`), off the request path.
- **`src/health.js`** adds a service-state disclosure line to `healthLines()`.
- **`src/server.js`** is unchanged (405 / read-only / no new endpoint).
- **`README.md`** documents the service toggle, the two-tier uninstall,
  data-preserved-by-default, and SwiftBar-never-removed.

### How to test
1. Start the dashboard: `npm start` (or use the running launchd service). Confirm
   `http://localhost:8787` serves.
2. Run the badge from a terminal to preview the dropdown lines (no SwiftBar needed):
   `node scripts/menubar/llmdash.5s.js`. You should see either
   `－ Remove the local service · running` (service loaded) or
   `＋ Install the local service` (not), plus `⊘ Uninstall llmdash…` with two
   sub-items — in both single-host and multi-host mode.
3. Service hooks (SCRATCH — never the real label):
   `LLMDASH_SERVICE_LABEL=com.llmdash.spike-demo LLMDASH_LAUNCH_AGENTS_DIR=/tmp/la
   scripts/install-macos.sh --service status|install|remove` (against a scratch
   checkout). `--service status` prints one of `running|stopped|not-installed`.
4. `npm test` — the full suite is green (374 tests; +40 for this feature).

### Notes for reviewer
- **SAFETY:** all tests and manual verification use **scratch** dirs and a
  **distinct** launchd label (`com.llmdash.spike-*`) under a scratch LaunchAgents
  dir, driven by injected flags (`--yes`/`--keep-data`/`--delete-data`) with no
  real `osascript` dialogs. The real `com.llmdash.dashboard` service, `~/llmdash`,
  and the data dir are never touched. Confirmed at hand-off: the real service is
  still running and `~/llmdash` + `llmdash.db` are intact (real plist byte-unchanged).
- The two launchd-touching test files (`install-service-hooks`,
  `menubar-service-control`) use **disjoint scratch-label namespaces** so a
  parallel `node --test` run's cleanup never asserts about the other file's labels.
- The **detached-survival** path (QA-19) is exercised as a real test against a
  scratch launchd agent + scratch checkout: the child completes the teardown after
  its origin is booted out and `rm -rf`'d, exiting 0.
- **Known limitation:** the live in-menu-bar render + real `osascript` dialogs are
  deploy-time captures (per the badge's shipped deferral); the mechanism is proven
  and the terminal-preview render is verified here.
- **Data-preservation nuance:** the default `dataDir = <checkout>/data` means a
  blind checkout `rm` would destroy the DB — so preservation **moves** the DB to
  `~/.llmdash/preserved-data` before the checkout is deleted and the final message
  says where it went. (An artifact ambiguity the schema flagged with "data may live
  under it"; resolved by rescue-before-delete.)

## Convention Flags
- **Self-contained detached-teardown helpers must import only `node:` builtins** —
  never `../../src` or `../../config`, and never a lazy `import()` from the
  checkout. A helper that deletes its own checkout and keeps running (temp-copy
  detach) throws `ERR_MODULE_NOT_FOUND` on any post-delete checkout read (spike
  Hazard E). Locked structurally by a zero-dep guard test.
- **Preserve-by-default that can be defeated by a co-located data dir must rescue,
  not merely order.** When the irreplaceable asset lives under a directory being
  deleted, "delete it last" isn't enough — move it to safety first and name the new
  location. (The `~/.llmdash/preserved-data` rescue.)
- **launchd tests use disjoint scratch-label namespaces per test file** so a
  parallel `node --test` cleanup assertion (`launchctl list`) only ever checks its
  own labels — a shared `com.llmdash.spike-` prefix makes one file's cleanup flake
  on another's still-loading labels.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
