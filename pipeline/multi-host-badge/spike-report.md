# Spike Report — Multi-Host Badge (SPIKE-01: osascript-from-SwiftBar input)
**Feature:** multi-host-badge
**Date:** 2026-07-02
**Stage:** 3 — The Architect
**Path:** Incremental (prior schemas exist; this feature adds a config-file layer + badge multi-host consumption + local-edit actions; **no tables, no columns, no migration**)

---

## SPIKE-01 VERDICT — [OSA] **PASS. `osascript display dialog` works from a SwiftBar `bash=`-style detached/launchd-parented spawn.**

The primary FR-14/FR-15/FR-16 path ships: a SwiftBar dropdown action can launch a
native `osascript` `display dialog`, capture a typed hostname/IP, and pass it to a
local `node` helper that `sanitizeHostPort`-validates it and writes the config file
via an atomic temp+rename — with **no TTY, no full user env, no TCC/Automation
prompt**. The fallback (open-the-file / instructions pane) is **not needed as the
primary mechanism**, but is retained as a documented degradation (see below) because
the runtime-config value is independent of the input mechanism.

**Exact working SwiftBar action syntax (the shape the Engineer wires):**

```
Add host… | shell="$ABS_NODE" param1="$PLUGIN_DIR/host-config-action.mjs" param2=add terminal=false refresh=true
```

- `shell=` (SwiftBar) / `bash=` (xbar) names the executable; `paramN=` are argv.
- `terminal=false` — no Terminal window flashes (the spawn is windowless).
- `refresh=true` — SwiftBar re-runs the plugin after the action, so the dropdown
  reflects the new host list (FR-17).
- The **executable is `$ABS_NODE`** (the same absolute node the wrapper bakes,
  NFR-06) running a tracked helper — NOT a bare `node` (dead under the minimal
  spawn PATH, the measured menu-bar lesson). The helper itself launches the
  `osascript` dialog (Node `child_process.execFileSync('osascript', […])`), reads
  the captured value, sanitize/validate/atomic-writes, and exits.

---

## What was and wasn't installed / touched (spike budget — small, non-polluting)

- **Installed: NOTHING.** No `brew`, no cask, no plugin, no launchd/service change.
  SwiftBar was **already present** on this Mac (`/Applications/SwiftBar.app`, a live
  wrapper at `~/Library/Application Support/SwiftBar/Plugins/llmdash.5s.js`) — I read
  its presence but **did not touch, replace, or point SwiftBar at anything**.
- **The live badge was not touched.** The real `~/Library/Application
  Support/SwiftBar/Plugins/llmdash.5s.js` wrapper is byte-identical before and after
  (confirmed by directory listing: same size 239, same mtime). The tracked plugin
  `scripts/menubar/llmdash.5s.js` and the live 8787 service were not modified.
- **No scratch SwiftBar plugin dir was needed.** I tested the `osascript` mechanism
  **directly** in progressively more detached contexts (below) rather than end-to-end
  through a real SwiftBar action — the SwiftBar `bash=`/`shell=` action semantics are
  well-documented (windowless spawn, argv via `paramN=`, `terminal=false`,
  `refresh=true`) and the load-bearing risk is entirely "does a GUI dialog appear from
  a session-detached spawn", which the direct tests answer conclusively.
- **The real data dir was not polluted** — no `hosts.conf` was written to
  `/Users/developer/devwork/llmdash/data/` (confirmed: dir contains only the
  pre-existing `claude-ratelimits.json`, `llmdash.db`, and a probe typescript).
- **All prototype/fixture files** lived in the session scratchpad
  (`…/scratchpad/spike01/`) and were **removed at the end** (confirmed: dir gone).

---

## Host environment on the target Mac (measured)

| Fact | Value |
|---|---|
| `osascript` | `/usr/bin/osascript` (macOS-native, always present) |
| SwiftBar | **installed** (`/Applications/SwiftBar.app`; live plugin dir `~/Library/Application Support/SwiftBar/Plugins/` with the user's real `llmdash.5s.js` wrapper) |
| `node` | `/Users/developer/.nvm/versions/node/v24.18.0/bin/node` (**nvm** — invisible to a minimal-PATH spawn; the absolute-node lesson still binds) |
| GUI session | present (Aqua login session — required for `display dialog` to show) |

---

## Per-context findings — with captured output

The question is not "does `display dialog` work" (it obviously does from a normal
shell) but "does it work from the **session-detached, no-TTY, sparse-env** context a
SwiftBar `bash=`/`shell=` action is spawned in (launchd/`open`-parented, no
controlling terminal)". I tested three progressively-more-detached contexts. Each
used `giving up after 2` so the dialog auto-dismisses — the spike never blocks — and
each returned a **captured value** with **exit 0**.

### Context A — normal shell (baseline)
```
osascript -e 'display dialog "…" default answer "127.0.0.1:8788" … giving up after 2'
→ button returned:, text returned:127.0.0.1:8788, gave up:true    (exit 0)
```

### Context B — detached, no TTY, **stripped env** (`env -i`), stdin from `/dev/null`
The closest cheap approximation of SwiftBar's windowless spawn: no controlling
terminal, inherited environment stripped to `PATH=/usr/bin:/bin HOME=…`, stdin
closed, output redirected to a file, run under `nohup … &`.
```
nohup env -i PATH=/usr/bin:/bin HOME="$HOME" osascript -e 'display dialog …' < /dev/null > out 2>&1 &
→ button returned:, text returned:10.0.0.5:9000, gave up:true      (exit 0)
```
**The GUI dialog appeared even with a stripped env and no TTY.** `display dialog`
bridges to the GUI via the per-user Aqua/WindowServer session (the launchd bootstrap
namespace), **not** the controlling terminal — so a session-detached spawn still
shows it.

### Context C — `launchctl asuser <uid>` (the launchd-parented GUI context)
The strongest test: `launchctl asuser` runs the command in the user's GUI login
context, exactly the bootstrap a launchd-parented process (like SwiftBar's spawns)
uses to reach the GUI.
```
launchctl asuser <uid> osascript -e 'display dialog "…" default answer "192.168.1.42:8787=Laptop" … giving up after 2'
→ button returned:, text returned:192.168.1.42:8787=Laptop, gave up:true   (exit 0)
```
**Works.** This is the decisive result: a launchd-parented spawn reaches the GUI and
shows the dialog.

### Context D — full FR-15 round-trip (dialog → sanitize → validate → atomic write)
A prototype `node` helper (mirroring `src/hosts.js` `sanitizeHostPort` + the
`parseHosts` per-entry grammar) took the captured value **on ARGV** and did the
atomic temp+rename write into a scratch config file. Fed a **hostile** answer with
leading/trailing whitespace, a `|`, and `rm -rf ~`:

```
dialog default answer:  "  100.64.0.9:8790=Studio | rm -rf ~  "
captured (verbatim):    [  100.64.0.9:8790=Studio | rm -rf ~  ]
helper result:          {"ok":true,"canonical":"100.64.0.9:8790=Studio | rm -rf ~"}
config file appended:   100.64.0.9:8790=Studio | rm -rf ~
duplicate re-add:       {"ok":false,"reason":"duplicate","key":"100.64.0.7:8788"}   (not written)
":99999" (empty host):  {"ok":false,"reason":"empty-host"}                          (not written)
```

The **host:port** part came through clean (`100.64.0.9:8790`); the `| rm -rf ~` was
inside the **label** (after `=`). This surfaced a design rule (below): the stored
label is data — it is `sanitize()`-scrubbed **at render** before it touches a SwiftBar
line (the badge already does this for peer labels), and newline-stripped before it
enters the file. The atomic write left **no partial file and no leftover temp**
(confirmed: no `.hosts.conf.tmp.*` after the rename).

---

## Security properties proven (for the Auditor)

1. **No AppleScript/shell injection from the entered value.** The `osascript`
   invocation's prompt and `default answer` are **fixed literals**; the entered value
   leaves `osascript` via `text returned of result` into a captured string and is
   passed to the node helper **only on ARGV** — it is **never compiled back into an
   AppleScript source string** and never interpolated into a shell command. A
   `| rm -rf ~` answer is inert (it lands as data in a label field, render-sanitized
   later). This is the load-bearing anti-injection rule the shipped helper must keep:
   **literal AppleScript + ARGV-only value passing** (do not build the AppleScript by
   string-concatenating the value; do not `eval`/`sh -c` the value).
2. **No TCC / Automation prompt.** `display dialog` is a **Standard Additions**
   built-in — it shows a dialog owned by the scripting process, it does **not** drive
   another application, so it does **not** trigger the Automation (Apple Events) TCC
   consent prompt. All three contexts returned a value with exit 0 and **no consent
   dialog**. (Automation TCC fires only for `tell application "OtherApp"`, which this
   never does.) So the affordance works out of the box — no entitlement, no
   pre-authorization step, no per-machine "grant access" gate.
3. **Sanitize at the door.** Host/port through `sanitizeHostPort` (strip anything
   outside `[A-Za-z0-9._:\-\[\]]`); an empty-after-sanitize host or an out-of-range
   port is a **rejected malformed entry** (honest message, nothing written), never a
   coercion (proven: `":99999"` → `empty-host`, not written).
4. **Atomic, local, user-owned write.** temp+rename on the same filesystem — no
   partial config ever observable, no network write, no privileged path, under the
   data dir, by the user-owned badge process. Concurrent writes are last-write-wins
   without corruption (OQ-06).

---

## Fallback (retained, not the primary path)

Per the PRD, the runtime-config mechanism is **independent of** the input mechanism.
Since SPIKE-01 passed, the shipped primary is the `osascript` dialog. The fallback —
used only if a specific deploy environment ever refuses the dialog (e.g. a headless
CI-like login, or a future macOS TCC tightening) — is documented copy that:
- **opens the config file** for hand-editing (a SwiftBar `href=file://…` /
  `shell=open` action to the file under the data dir), and
- shows an **instructions pane** naming the file path and the `host[:port][=label]`
  format.
In every fallback the file stays the runtime source of truth (FR-01), the poller
re-reads it (FR-03), and edits apply next tick with no restart. The Add/Remove
**helper** (sanitize→validate→atomic-write) is the same in both worlds; only the
**value-collection front end** differs (dialog vs. hand-edit). The Engineer should
build the helper so it is driveable **with an injected value** (for tests and for the
fallback), independent of the dialog.

---

## Findings later stages must honor

1. **osascript-from-SwiftBar WORKS** (`shell="$ABS_NODE" paramN=… terminal=false
   refresh=true`; the helper launches the dialog via `execFileSync('osascript', …)`).
   No TCC prompt, no TTY needed, no full env needed. Primary path, ships.
2. **Literal AppleScript + ARGV-only value passing is the anti-injection rule.** Never
   string-concatenate the entered value into an AppleScript source or a shell command.
   The value is data end-to-end.
3. **The helper runs under the wrapper's absolute node** (NFR-06). A bare `node` is
   dead under the minimal spawn PATH — the same measured menu-bar lesson. The
   SwiftBar action's `shell=` executable is the baked `$ABS_NODE`; the installer
   already resolves it.
4. **The stored label is data** — `sanitize()` (strip `|\r\n`) at render before any
   SwiftBar line (the badge already does this for peer labels); newline-stripped
   before it enters the file. A `|` in a label cannot break the line grammar because
   it is scrubbed at render (FR-11).
5. **Atomic temp+rename, no lock** (OQ-06) — no partial file, last-write-wins is
   honest for a single-user tool. No leftover temp after rename.
6. **The runtime-config value is independent of the input mechanism** — the fallback
   ships the same live/restart-free config even if the dialog is ever refused.
7. **SwiftBar stays a disclosed user prerequisite** — never auto-installed (NFR-06),
   even though it happens to be installed on this dev Mac.

---

## QA coverage proven at spike time

| QA | Status at Stage 3 |
|---|---|
| QA-14 (Add/Remove/List actions present, [OSA]) | ✅ action syntax settled (`shell=$ABS_NODE paramN=… terminal=false refresh=true`); helper-invoked, no HTTP |
| QA-15 (Add: sanitize→validate→atomic append, reject malformed/dup) | ✅ full round-trip proven with hostile input; empty-host + duplicate rejected, not written |
| QA-16 (Remove: atomic, mid-fetch safe) | ✅ same atomic temp+rename mechanism (Remove is the mirror; helper driven by injected value) — poller-tick reconciliation is the runtime half, tested at Stage 6 |
| QA-23 (config-edit security posture) | ✅ literal-AppleScript + ARGV-only (no injection); atomic temp+rename (no partial file); local/user-owned (no network write) |
| QA-25 (zero deps / macOS-native) | ✅ `osascript` (macOS-native) + `node:child_process`/`node:fs` (builtins) — no npm dep, no build |
| QA-28 (concurrent edits safe) | ✅ atomic rename → last-write-wins, no partial/corrupt file (no leftover temp confirmed) |
| Live in-menu-bar dialog render (deploy capture) | ⏳ deferred to deploy per the badge's shipped deferral — the mechanism is proven; the in-menu-bar screenshot is a deploy-time capture the user does after ratifying SwiftBar |
