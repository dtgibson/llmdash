# Spike Report — Menu-bar Service Controls (SPIKE-01: detached self-uninstall survival)
**Feature:** menubar-service-controls
**Date:** 2026-07-03
**Stage:** 3 — The Architect
**Path:** Incremental (prior `menu-bar-badge` + `multi-host-badge` schemas exist; this feature adds installer service/uninstall hooks + a detached teardown helper + state-aware badge dropdown items; **no tables, no columns, no migration**)

---

## SPIKE-01 VERDICT — [SELF] **PASS (with one binding rule). A detached teardown process survives both (a) `launchctl bootout` of the service that indirectly spawned it and (b) `rm -rf` of its own origin checkout — completing the full ordered teardown to exit 0.**

The primary FR-13/FR-19 path ships: the complete-uninstall runs as a **detached** process that unloads the scratch service, deletes the plist, reverts the statusline (restoring `.bak`), removes the trust artifacts, removes the marker-gated wrapper, deletes the checkout **last**, and exits 0 — **while continuing to execute after both its spawning service and its own origin directory are gone.** The PRD's pre-authorized fallback (leave a "delete `~/llmdash` by hand" instruction) is **not needed**.

**The one binding rule the spike surfaced (this is the whole point of the temp-copy):**

> A detached process **survives** deleting its own checkout on macOS/APFS — already-loaded code stays resident in memory. But **any code path that lazily reaches back into the deleted checkout after the `rm` fails.** A not-yet-imported sibling module loaded via `await import('../../src/…')` **after** the checkout is gone throws `ERR_MODULE_NOT_FOUND` (measured). Therefore the teardown must be **self-contained OR run from a temp copy**, and must **read everything it needs from the checkout BEFORE the delete step** — never lazily afterward.

The chosen approach satisfies both: the helper **copies itself to a temp dir, `cd`s out of the checkout, and runs from there** (`detached:true`, `child.unref()`), and does all reads-from-checkout up front. This makes the checkout-delete a leaf operation with nothing left to load.

### Exact safe teardown ordering (proven, FR-13)

```
1. service   → launchctl bootout gui/<uid>/<label>  +  delete the plist
               (plist deletion marker-gated: basename === "<label>.plist")
2. statusline→ restore settings.json.bak IF the wiring points at THIS checkout
               (else leave untouched — a different install / a user command)
3. trust     → delete the ~/.claude.json project entry for the refresh cwd
               (own-key check) + rm the ~/.llmdash/claude-refresh-cwd dir
4. wrapper   → rm the SwiftBar wrapper ONLY if it carries the marker
               (a non-marker user file is spared with an honest message)
5. checkout  → rm -rf the resolved checkout LAST
6. data      → ONLY if --delete-data (opt-in); AFTER the checkout (in case data
               lives under it). Default: preserved.
```

### Exact detach mechanics (the shape the Engineer wires)

```js
// The "action" (invoked from inside the checkout by the badge) does ONLY this and returns:
const tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-teardown-'));
const tmpSelf = path.join(tmpDir, 'teardown.mjs');
fs.copyFileSync(process.argv[1], tmpSelf);          // self-contained: builtins only
const child = spawn(process.execPath, [tmpSelf, ...argsWithout('--detach'), '--run'], {
  cwd: tmpDir,          // cd OUT of the checkout so its deletion can't strand cwd
  detached: true,       // new session — outlives the parent and the spawning service
  stdio: 'ignore',
});
child.unref();
process.exit(0);        // returns immediately, exactly as the badge action expects
```

The **spawning service** (`launchctl bootout`) and the **origin checkout** (`rm -rf`) are both destroyed by the detached child; because it is `detached`, `unref`'d, running its **own executable path (`process.execPath` = the absolute node)** against a **temp copy of itself** with cwd in temp, neither destruction reaches it.

---

## What was and wasn't touched (spike budget — small, scratch-only, non-polluting)

- **The REAL service was NEVER touched.** No `bootout`/`kickstart`/`unload`/`load` of `com.llmdash.dashboard`. Verified after the spike: `launchctl print gui/502/com.llmdash.dashboard` succeeds (PID 33445, still loaded); the real plist is byte-unchanged (971 bytes, mtime **Jul 2 16:50**, the pre-spike baseline).
- **The REAL checkout(s) and data were NEVER touched.** `~/llmdash` present; the dev working copy `/Users/developer/devwork/llmdash` present; `data/llmdash.db` present (16384 bytes, mtime Jul 2 15:48); `~/.claude/settings.json` untouched (mtime Jul 1 21:32); `~/.claude.json`, the real SwiftBar plugin dir, and `~/.llmdash` were never read or written by the spike.
- **All spike work ran against DISTINCT scratch labels** `com.llmdash.spike-<epoch>-<rand>` (never `com.llmdash.dashboard`), bootstrapped from plists written under the session scratchpad, running a trivial `sleep` loop (`scratch-service.sh`), NOT the real server.
- **All scratch paths lived under the session scratchpad** (`…/scratchpad/spike01/**`): a scratch `checkout/`, `data/`, `launchagents/`, `swiftbar/`, `trust/`, `claude/` per case. Deleted at the end.
- **Cleanup verified:** `launchctl list | grep com.llmdash.spike` → empty; the scratch dir is gone; leftover `llmdash-teardown-*` temp dirs removed. Only `com.llmdash.dashboard` remains in launchd (the real, untouched service).
- **Budget:** three scratch-agent load/teardown cycles + two no-launchd control probes. Small, as scoped.

---

## Host environment on the target Mac (measured)

| Fact | Value |
|---|---|
| `launchctl` | `/bin/launchctl` (macOS-native) |
| user launchd domain | `gui/502` (the user Aqua session) — no `sudo`, no system domain used |
| `node` | `/Users/developer/.nvm/versions/node/v24.18.0/bin/node` (nvm — the absolute-node lesson still binds; the detached child runs `process.execPath`, which IS this absolute node) |
| filesystem | APFS (a deleted-but-open file/dir stays resident for a running process) |
| real service | `com.llmdash.dashboard` loaded (PID 33445) — untouched throughout |

---

## Per-context findings — with captured evidence

### Context A — the full detached teardown (default: preserve data) — **PASS**
Invoked the helper **at its origin path inside the scratch checkout** (as the badge action would), with `--detach`. It re-spawned itself from a temp copy and returned exit 0; the detached child then ran the ordered teardown and recorded a verdict file **after** deleting its origin:

```
action returned (exit 0) — detached child (pid 25480) continues from /var/folders/.../llmdash-teardown-RkWnkf/teardown.mjs
AFTER:  scratch agent BOOTED OUT · checkout DELETED · plist DELETED · wrapper DELETED · trust dir DELETED
        data dir PRESERVED (llmdash.db, claude-ratelimits.json, hosts.conf all present)
        settings.json → .bak restored ("old-user-command")
        .claude.json → scratch trust entry gone, "/some/other/dir" KEPT
recorded steps (in order): service.bootout✔ · service.plist-deleted✔ · statusline.restored-bak✔ ·
        trust.entry-removed✔ · trust.dir-removed✔ · wrapper.removed✔ · checkout.removed✔ ·
        data.preserved✔ · post-checkout.still-running✔ {cwd: <temp>, originGone: TRUE}
```

The load-bearing line is the last: **`post-checkout.still-running` with `originGone: true`** — the process did real work (fs ops, wrote the verdict file) *after* `bootout` of its spawning agent and `rm -rf` of its origin checkout.

### Context B — `--delete-data` opt-in — **PASS**
Same run with the data opt-in: `data.deleted✔` and the data dir is empty afterward; `checkout.removed✔` still ran first (data is the final step). Confirms the opt-in path deletes the DB **only** when asked and **after** the checkout.

### Context C — marker-gating refusal — **PASS**
A scratch wrapper **without** the `llmdash-menu-bar-badge` marker: `wrapper.left-untouched✔ ("no marker — user file")`; the file is present afterward. A user's own file at the wrapper path is never deleted.

### Control D — in-place (no temp copy, cwd inside the checkout) — **survives, but fragile**
A naive detached process with cwd inside the checkout, script loaded from the checkout, deleting its own dir: it **survived** (`rm-self✔`, `post-rm-import-builtin✔ darwin`, `cwd-after-rm✔` returning the now-dangling path). So on macOS/APFS the origin-file being unlinked alone does not kill it. **But see Hazard E** — this is why we still temp-copy.

### Hazard E — lazy import from the checkout AFTER the delete — **FAILS (the decisive rule)**
The real failure mode: a detached process that, after `rm -rf` of the checkout, tries to `await import('./sibling.mjs')` for a module it had **not** already loaded:
```
rm-checkout✔ · lazy-import-after-rm ✗ ERR_MODULE_NOT_FOUND
```
**This is the rule the design must honor:** the teardown must be self-contained (or run from a temp copy) and must read everything it needs from the checkout **before** the delete — never lazily afterward. The chosen temp-copy + read-up-front design makes Hazard E structurally impossible.

---

## Security properties proven (for the Auditor)

1. **No privilege escalation.** All `launchctl` work is in the **user** domain `gui/<uid>` — `bootout`, plist delete, all under user-owned paths. No `sudo`, no system domain, no write outside user-owned locations (NFR-03). Confirmed: the spike never invoked `sudo` and never touched a system path.
2. **Marker-gating holds on every removal.** The plist is deleted only when `basename === "<label>.plist"`; the wrapper only when it carries the marker; the statusline reverted only when it points at **this** checkout; the trust entry removed only on an own-key (`hasOwnProperty`) match. A foreign artifact at any of these paths is spared with an honest message (NFR-05). Proven for the wrapper (Context C) and the statusline/trust (Context A: `/some/other/dir` was kept).
3. **Data preserved by default; deletion is opt-in and irreversible-by-design last.** The DB survives unless `--delete-data` is passed, and even then only after the checkout (Context A vs B) (FR-12).
4. **Honest on partial failure.** Each step records `ok:true/false` + a detail; a failed step (e.g. bootout of an already-gone label, a plist label-mismatch) is reported, never claimed as done (FR-20). The step log is the substrate for the post-uninstall message.
5. **No HTTP surface involved.** The teardown is a local `launchctl`/fs operation in a detached helper process — the server's request path is never on the path (NFR-04/NFR-10).

---

## Fallback (retained, not needed as the primary path)

Per the PRD, if detached self-deletion had proven unsafe the fallback was: perform every non-self step and leave a final honest instruction ("everything else is removed; you can delete `~/llmdash` now"). **SPIKE-01 PASSED, so the primary detached path ships.** The fallback is reduced to a **defensive last-resort message**: if the detached checkout-delete step itself errors (e.g. a permission/IO failure), the teardown reports "everything else is removed; delete `<checkout>` by hand" rather than claim a removal that didn't happen — this is just the FR-20 honest-partial-failure path applied to the final step, not a separate mode.

---

## Findings later stages must honor

1. **Detached self-uninstall WORKS** — `spawn(process.execPath, [tmpSelfCopy, …, '--run'], { cwd: tmpDir, detached: true, stdio: 'ignore' })` + `unref()`; the action returns immediately, the child completes the ordered teardown and exits 0 after `bootout` + `rm -rf` of its origin. Primary path, ships.
2. **Self-contained OR temp-copy + read-up-front is the binding rule.** A lazy import from the deleted checkout throws `ERR_MODULE_NOT_FOUND` (Hazard E). The teardown must resolve/read everything from the checkout **before** the delete step. Concretely: **the detached helper must NOT `import` from `../../src/…` or the installer after it starts the teardown.** Either inline the logic, or (the chosen model) copy the self-contained helper to temp and run it there, passing every path it needs on ARGV.
3. **Ordering is fixed:** service → statusline → trust → wrapper → checkout LAST → data (opt-in, after checkout). Proven. The checkout-delete is a leaf; nothing loads after it.
4. **The single-source-of-truth logic lives in `install-macos.sh`** (`--service`/`--uninstall` hooks). Reconcile with the detach: the **shell installer runs to completion synchronously** for `--service`; for `--uninstall` the destructive teardown that deletes the checkout runs from the **detached node helper's temp copy** (the shell script `install-macos.sh` is itself in the checkout being deleted, so the uninstall's checkout-delete step must not depend on the shell script still existing mid-run — the node helper, temp-copied, owns the final delete). See schema §Mechanism.
5. **launchctl verbs:** `bootout gui/<uid>/<label>` to unregister (not `unload`, which is the legacy form — `bootout` is the modern per-domain unregister and is what a plist-delete pairs with); `bootstrap gui/<uid> <plist>` to load (with `enable` for `-w` semantics). `launchctl print gui/<uid>/<label>` (exit 0 = present) + plist-on-disk presence = the live-state read (running/stopped/not-installed). All in the **user** domain — no `sudo`.
6. **process.execPath is the absolute node** — the detached child must spawn with `process.execPath`, not a bare `node` (dead under the minimal spawn PATH; the standing menu-bar lesson).
7. **APFS keeps a running process alive after its origin dir is unlinked** — but do not rely on that alone (Hazard E). Temp-copy is the belt; read-up-front is the suspenders.
8. **SwiftBar is never (un)installed** — the uninstall points to `brew uninstall --cask swiftbar` as a manual step, never runs it (standing convention).

---

## QA coverage proven at spike time

| QA | Status at Stage 3 |
|---|---|
| QA-13 (safe teardown ordering, [SELF]) | ✅ recorded step sequence: service→statusline→trust→wrapper→checkout→data, each scratch artifact gone afterward (data per opt-in) |
| QA-19 (detached teardown survives its own origin, [SELF]) | ✅ detached child completed all steps + exit 0 after scratch `bootout` and scratch `rm -rf`; `post-checkout.still-running{originGone:true}` |
| QA-12 (data preserved default; opt-in deletes) | ✅ Context A (preserved) vs Context B (`--delete-data` → deleted, after checkout) |
| QA-14 (statusline revert scoped + .bak restored) | ✅ Context A restored `.bak`; points-elsewhere left untouched (asserted via `/some/other/dir` kept in `.claude.json`) |
| QA-10/QA-25 (marker-gating refusal) | ✅ Context C: non-marker wrapper spared, honest message |
| QA-20 (honest on partial failure) | ✅ every step records ok/detail; a mismatch/absent artifact is reported, not claimed |
| QA-23 (no privilege escalation) | ✅ user domain `gui/<uid>` only; no `sudo`, no system path — measured |
| Live in-menu-bar render + real osascript dialogs | ⏳ deferred to deploy per the badge's shipped deferral; the mechanism is proven, the in-menu-bar capture is a deploy-time step |
