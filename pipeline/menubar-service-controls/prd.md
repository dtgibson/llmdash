# PRD — Menu-bar Service Controls
**Feature:** menubar-service-controls
**Date:** 2026-07-03
**Stage:** 2 — The Planner
**Source:** strategic-brief.md (approved)

---

## Feature Overview

Two new install-lifecycle controls in the macOS menu-bar badge dropdown: a
**local-service toggle** that installs (registers + loads) or removes (unloads +
unregisters) the `com.llmdash.dashboard` launchd agent on this Mac, reflecting
the **live launchd state**; and an **"Uninstall llmdash" action** offered in two
tiers — remove the menu-bar badge only, or uninstall llmdash completely (service,
badge wrapper, checkout, Claude statusline wiring, and auto-refresh trust
artifacts), with the irreplaceable snapshot-history **data dir preserved by
default** and an explicit opt-in to also delete it. Both are local, user-scoped
operations run by the badge process via the shipped `shell=` action → tracked
node helper → `osascript` confirm pattern — **not** new HTTP endpoints. The
dashboard's serve-only / read-only (405-for-non-GET/HEAD) posture is preserved.

---

## User Stories

> **US-01** — As the single user running llmdash on a Mac that has become a
> monitoring station (badge only, watching remote hosts), I want to remove the
> local llmdash service from the menu bar, so that this machine stops running a
> local monitor without me dropping to a terminal for `launchctl unload`.

> **US-02** — As the user who removed the local service earlier, I want to
> re-install it from the menu bar, so that this machine becomes a full local
> monitor again with a correctly regenerated service (absolute node/codex/claude
> paths), without editing or reloading a plist by hand.

> **US-03** — As the user glancing at the badge, I want the service menu item to
> show the **real** launchd state (running / stopped / not installed), so that I
> can trust it rather than wonder whether a checkmark reflects reality.

> **US-04** — As the user who no longer wants the menu-bar badge but still wants
> llmdash running, I want a "Remove the menu-bar badge only" action, so that the
> badge disappears from the bar while the service, checkout, and data are left
> exactly as they are.

> **US-05** — As the user decommissioning llmdash on this Mac, I want an
> "Uninstall llmdash completely" action that **lists exactly what will be
> removed before it acts**, so that I understand the consequences — especially
> that my irreplaceable usage-history database is called out — before I confirm.

> **US-06** — As the user uninstalling llmdash, I want my snapshot-history
> database (`llmdash.db`) **preserved by default**, with a separate explicit
> opt-in to also delete it, so that I never destroy history that cannot be
> rebuilt just by removing the app.

> **US-07** — As the user, I want every destructive action gated by a
> confirmation naming the consequence and to be told honestly when a step
> partially fails, so that a cancel changes nothing and I am never told a removal
> happened that didn't.

> **US-08** — As the user uninstalling llmdash, I want the teardown to complete
> even though it deletes the very checkout and service the helper was launched
> from, so that the badge actually disappears and the machine is left clean
> rather than half-removed.

---

## Functional Requirements

### Area A — Service toggle (install / remove the local launchd service)

> **FR-01** — The badge dropdown shall present a state-aware local-service
> control: when the service is **not installed**, an "Install the local service"
> action; when it is **installed** (loaded or unloaded), a "Remove the local
> service" action. Both present in single-host **and** multi-host dropdown modes
> (via a shared helper, so the control is reachable on a fresh single-host /
> monitoring-station machine, not only in multi-host mode).

> **FR-02** — On "Install the local service", the app shall (re)generate the
> `com.llmdash.dashboard` LaunchAgent plist from the tracked template
> (`macos/com.llmdash.dashboard.plist.example`) — resolving **absolute**
> node/codex/claude paths and the checkout dir via the installer's existing
> resolve logic, never a stale cached plist — write it to
> `~/Library/LaunchAgents/com.llmdash.dashboard.plist`, and load it
> (`launchctl load -w` / bootstrap) so it starts at login and restarts on crash.

> **FR-03** — On "Remove the local service", the app shall unload the agent
> (`launchctl bootout` / `unload`) **and delete the plist**
> (`~/Library/LaunchAgents/com.llmdash.dashboard.plist`), so the agent is truly
> unregistered — a genuine "remove the service", not a transient stop that
> `KeepAlive:true` would relaunch. *(Default resolution of OQ-01; see Open
> Questions.)*

> **FR-04** — The service control shall reflect the **live** launchd state, read
> at render time (e.g. via `launchctl print gui/<uid>/com.llmdash.dashboard` or
> equivalent, plus the plist's presence on disk), classified honestly as
> **running**, **stopped** (plist present/loaded but not running), or **not
> installed** (no plist / not bootstrapped). It shall never display a faked or
> assumed checkmark/state.

> **FR-05** — "Remove the local service" shall be gated by an `osascript`
> confirmation naming the consequence (this Mac stops running a local monitor).
> A cancel shall change nothing. *(Install is non-destructive; per OQ-03 its
> default is a confirmation too, for consistency — see Open Questions.)*

> **FR-06** — After the local service is removed, the badge shall keep
> functioning as a monitoring station off any configured remote hosts (its
> loopback read of the **local** instance is what stops; remote-host watching is
> unaffected). *(A removed local service means the local `/api/hosts` read
> fails; the badge renders its existing offline state honestly — see FR-16.)*

> **FR-07** — The service actions shall be **idempotent**: "Install" when the
> service is already installed and loaded is a friendly reload/no-op (regenerates
> the plist and reloads, never an error); "Remove" when the service is not
> installed is a friendly no-op reporting nothing to remove.

> **FR-08** — When the plist exists but the agent is **unloaded**, the state read
> (FR-04) shall report "stopped" (not "not installed"), and "Install" shall load
> the existing/regenerated plist while "Remove" shall delete it — each honest to
> the real on-disk + launchd state.

### Area B — Uninstall (two tiers)

> **FR-09** — The badge dropdown shall present an "Uninstall llmdash" affordance
> offering two tiers: **"Remove the menu-bar badge only"** and **"Uninstall
> llmdash completely"**. Both present in single-host and multi-host dropdown
> modes.

> **FR-10** — "Remove the menu-bar badge only" shall reverse `--setup-badge` by
> removing the marker-gated SwiftBar wrapper (the same behavior as
> `--remove-badge`), leaving the service, checkout, and data dir untouched. It
> shall be marker-gated: a real file in SwiftBar's plugin dir **without** the
> `llmdash-menu-bar-badge` marker is a user's own file and shall never be deleted
> (an honest "left untouched" message instead).

> **FR-11** — "Uninstall llmdash completely" shall, **before removing anything**,
> present an `osascript` confirmation dialog that **enumerates every artifact to
> be removed**: the launchd service + plist; the badge wrapper; the checkout
> (`~/llmdash`, or the resolved `LLMDASH_DIR` override); the Claude statusline
> wiring in `~/.claude/settings.json` (restoring `settings.json.bak` if present);
> and the auto-refresh trust entry in `~/.claude.json` for
> `~/.llmdash/claude-refresh-cwd` plus that directory. The dialog shall call out
> that the snapshot-history database is the only irreplaceable asset and is
> **preserved by default**. A cancel shall change nothing.

> **FR-12** — The complete uninstall shall **preserve the data dir by default**
> (`claude-ratelimits.json`, `hosts.conf`, `llmdash.db` under `config.dataDir`)
> and offer a **separate explicit opt-in** to also delete it, worded to name the
> irreversibility (e.g. "Also delete your usage history? This can't be undone.").
> Only on explicit opt-in shall the data dir's llmdash-owned files be deleted;
> otherwise they survive the uninstall.

> **FR-13** — On confirmed complete uninstall, the app shall reverse the
> installer's actions in a **safe teardown order**: (1) unload + unregister the
> service (`launchctl bootout` + delete plist); (2) revert the Claude statusline
> wiring; (3) remove the auto-refresh trust artifacts; (4) remove the badge
> wrapper (marker-gated); (5) delete the checkout **last**. The data dir is
> deleted only if opted in (FR-12), and only after the checkout step if the data
> dir lives under the checkout. *(Ordering is confirmed against SPIKE-01; see
> Open Questions and Out of Scope.)* **[SELF]**

> **FR-14** — The Claude statusline revert (FR-13 step 2) shall only revert the
> wiring in `~/.claude/settings.json` when it points at **this** checkout's
> `scripts/statusline.js`; if `settings.json` has a `settings.json.bak`, it shall
> be restored. If the statusline points at a **different** llmdash checkout or a
> user's own command, it shall be left untouched (never clobber another install
> or a user's own config), reported honestly.

> **FR-15** — The complete uninstall shall **never uninstall SwiftBar**. The
> enumeration dialog and post-uninstall message shall *point to*
> `brew uninstall --cask swiftbar` as a manual step, but the action shall never
> run it. When SwiftBar's plugin dir is not detected, the badge-removal step
> shall instruct the user to remove the wrapper by hand rather than fail
> silently.

> **FR-16** — After the local service is unregistered (by Remove-service or by
> the complete uninstall), the badge's loopback read of the **local** instance
> fails; the badge shall render its existing honest offline state (never a
> fabricated number, never a crash). After a complete uninstall the wrapper is
> gone, so the badge disappears from the bar on the next SwiftBar refresh.

### Area C — Mechanism (installer hooks + detached helper)

> **FR-17** — `scripts/install-macos.sh` shall be extended with new hooks as the
> **single source of truth** for the launchctl/plist/teardown logic: a service
> hook (e.g. `--service install|remove|status`) that generates+loads / unloads+
> deletes the plist and prints the live state, and an uninstall hook (e.g.
> `--uninstall [--keep-data]`) that performs the enumerated teardown. The badge
> actions shall invoke this logic rather than duplicating launchctl/plist code.
> Hook verb names shall be honest to what they do (install/remove/status, not a
> misleading start/stop).

> **FR-18** — A **new tracked helper** under `scripts/menubar/` (e.g.
> `service-control-action.mjs`) shall be invoked by SwiftBar
> `shell="$ABS_NODE" param1="<helper>" param2=<verb>` dropdown actions, mirroring
> `host-config-action.mjs`: **fixed-literal** AppleScript confirm/enumerate
> dialogs, `execFileSync('/usr/bin/osascript', …)` with **no shell**, values
> passed as **ARGV / captured stdout only** (never concatenated into a command or
> script), running under the wrapper's absolute node (`process.execPath` /
> `$ABS_NODE`). It shall be delivered by the same marker-gated wrapper / tracked-
> source model (the tracked source is never rewritten; `--remove-badge` /
> "Remove badge only" reverse it symmetrically).

> **FR-19** — The complete-uninstall path shall run as a **detached** teardown
> process that survives deleting its own origin: it either copies the needed
> teardown logic to a temp location first or is self-contained and reads nothing
> further from the checkout after it starts, then executes the ordered teardown
> (FR-13) and exits — surviving `launchctl bootout` of the service that
> (indirectly) spawned it and `rm -rf` of its own checkout. The exact mechanism
> is settled by SPIKE-01. **[SELF]**

> **FR-20** — Every service/uninstall action shall be **honest on partial
> failure**: if `launchctl bootout` fails, a file won't delete, or a step errors
> mid-teardown, the resulting dialog/log shall state exactly what did **not**
> happen and what remains, leaving the rest recoverable. It shall never claim a
> removal that didn't occur.

> **FR-21** — The helper shall provide a **test seam** mirroring
> `host-config-action.mjs`: the service/uninstall logic shall be driveable
> non-interactively with injected confirmation (e.g. `--yes`, `--keep-data`, an
> env-injected value) against **scratch** paths (a scratch LaunchAgents-like dir,
> a scratch checkout, a scratch data dir), so the round-trip is testable without
> popping a real `osascript` dialog and without touching the real service,
> checkout, or data.

### Area D — Disclosure

> **FR-22** — The README and the installer's badge-setup / startup output shall
> disclose the new powers (the menu-bar service toggle and the two-tier
> uninstall, including the data-preserved-by-default default and the SwiftBar-
> never-removed rule), consistent with the "surface security-relevant defaults,
> never silently" convention. *(A service-state / uninstall-capability line in
> `src/health.js`'s startup readout is the Architect's call — see Open Questions
> OQ-05.)*

---

## Non-Functional Requirements

> **NFR-01 — Security (confirmation):** Every system mutation (service remove,
> service install per OQ-03, badge removal, complete uninstall, data deletion)
> shall be gated by an explicit `osascript` confirmation naming the consequence;
> the complete-uninstall dialog shall enumerate every artifact before acting. A
> cancel shall change nothing.

> **NFR-02 — Security (structural anti-injection):** All AppleScript shall be
> **fixed literals**; `osascript` shall be invoked via
> `execFileSync('/usr/bin/osascript', …)` with **no shell**; any dynamic value
> (a resolved path, a host key) shall reach the helper only as ARGV / captured
> stdout, **never** concatenated into a command or AppleScript source. No
> `sh -c`, no `eval`.

> **NFR-03 — Security (no privilege escalation):** No `sudo`, no system-level
> launchd domain — the user launchd agent (`gui/<uid>`) and user-owned paths
> only. No write outside user-owned paths.

> **NFR-04 — Security (HTTP stays read-only):** No new HTTP write/mutation
> endpoint. These controls are local `launchctl` / filesystem operations in the
> badge/helper process. `src/server.js` stays serve-only: non-GET/HEAD → 405
> (`allow: GET, HEAD`), baseline headers, static `no-store`. The `0.0.0.0` bind
> gains no write surface.

> **NFR-05 — Security (marker-gating / never delete a non-llmdash file):** Any
> file removal shall verify the path is one llmdash created before deleting it:
> the badge wrapper only when it carries the `llmdash-menu-bar-badge` marker; the
> statusline wiring only when it points at **this** checkout (FR-14); the plist
> only the `com.llmdash.dashboard` label's file; the checkout only the resolved
> `LLMDASH_DIR`. A user's own file at any of these locations shall never be
> deleted — an honest "left untouched" message instead.

> **NFR-06 — Honesty (live state, never fabricated):** The service menu item
> shall show the true launchd state read live (NFR / FR-04); a removal that
> partially fails shall be reported truthfully (FR-20); the uninstall shall
> enumerate before acting (FR-11); no removal shall ever be claimed that did not
> happen.

> **NFR-07 — Idempotence:** Re-running an already-applied action shall be a
> friendly no-op (install-when-installed → reload; remove-when-absent → nothing
> to remove; badge-remove-when-absent → nothing to remove), never an error or a
> false claim.

> **NFR-08 — Delivery model preserved:** The new helper is a **tracked** source
> file delivered by the shipped marker-gated wrapper / absolute-node model; the
> tracked source is never rewritten in place (so `git pull` / installer re-run
> stays clean), and "Remove badge only" / `--remove-badge` reverse it
> symmetrically. SwiftBar stays a disclosed user prerequisite, never installed or
> uninstalled by llmdash.

> **NFR-09 — Zero runtime dependencies, no build step:** The helper and hooks
> shall use Node builtins (`node:child_process`, `node:fs`, `node:os`,
> `node:path`) and macOS-native `osascript` / `launchctl` only; `package.json`
> runtime deps stay at 0; no build step. macOS/launchd only (the Linux systemd
> service is out of scope).

> **NFR-10 — Request-path isolation:** The live-state read (`launchctl print`)
> and all service/uninstall subprocess work happen in the badge/helper process,
> **never** on the HTTP request path or the server's poller tick. The server
> gains no new work.

---

## Out of Scope

- **Installing or uninstalling SwiftBar** — SwiftBar is a user-installed
  prerequisite llmdash never manages. The uninstall dialog may *point to*
  `brew uninstall --cask swiftbar`; it never runs it. *(Standing convention.)*
- **A full install-from-nothing from the bar** — "Install the local service"
  assumes the checkout already exists (the badge is running, so it does); it
  (re)creates and loads the launchd agent from those files. Bootstrapping llmdash
  onto a bare machine stays the `curl | bash` installer's job.
- **Any HTTP write/mutation endpoint** — the controls are local `launchctl` / fs
  operations. `server.js` stays 405-for-non-GET/HEAD, serve-only. (NFR-04.)
- **Any privilege escalation** — no `sudo`, no system-level launchd domain, no
  writes outside user-owned paths. (NFR-03.)
- **Managing the Linux systemd service** — this is a macOS menu-bar feature; the
  `llmdash.service` systemd unit is not in scope.
- **Remote service control** — a control acts only on **this** Mac (the machine
  the badge runs on); it never reaches across the tailnet to start/stop/uninstall
  a peer (that would need a mutation surface the serve-only posture forbids).
- **Changing the `/api/state` or `/api/hosts` contract** — no new server field is
  required or permitted by this feature.
- **Restoring a user's own pre-existing statusline** beyond the `.bak` the
  installer wrote — llmdash reverts only wiring it added (FR-14); it does not
  reconstruct configuration it never created.
- **The auto-refresh orphaned-session teardown follow-up** (a separate roadmap
  item) — not reopened here.

---

## Open Questions

> **OQ-01 — Does "Remove the local service" delete the plist or only unload it?**
> **Default assumption (if unanswered before Stage 5):** Delete the plist — a
> true "remove the service" that matches the user's wording and leaves no
> unloaded plist that could ghost back on reboot. FR-03 is written to this
> default. *(Flagged for the user to ratify at the Designer stage.)*

> **OQ-02 — Exact toggle and dialog wording, and the exact data-deletion opt-in
> copy.** **Default assumption:** the honest, enumerating strings pinned in this
> PRD (FR-11 enumeration, FR-12 "Also delete your usage history? This can't be
> undone.") are the floor; the Designer refines wording while preserving the
> honesty + enumeration + the data-opt-in. The service item labels
> ("Install the local service" / "Remove the local service") and state suffix
> (running / stopped / not installed) are the working default.

> **OQ-03 — Does "Install the local service" require a confirmation?** **Default
> assumption:** Yes — a confirmation for consistency and because it does mutate
> system state (writes a plist, loads an agent). It is lower-stakes than Remove,
> so the copy can be lighter, but every mutation is confirmed (NFR-01). *(Ratify
> at Designer.)*

> **OQ-04 — SPIKE-01 outcome: does a detached helper survive deleting its own
> origin, and what is the safe teardown ordering + temp-copy need?** **Default
> assumption (pending the Stage-3 spike):** the teardown copies its logic to a
> temp dir (or is self-contained) before it deletes the checkout, `cd`s out of
> the checkout first, deletes the checkout last, and completes detached. If the
> spike shows self-deletion of the checkout is unsafe, the **fallback** is that
> the uninstall completes every other step and leaves a final honest instruction
> ("everything else is removed; you can delete `~/llmdash` now") rather than
> risk a half-broken teardown. FR-13/FR-19 are tagged **[SELF]** and depend on
> this outcome. *(Flagged for the Architect as a Stage-3 spike — see SPIKE-01
> below.)*

> **OQ-05 — Does a service-state / uninstall-capability line belong in
> `src/health.js`'s startup readout?** **Default assumption:** Yes — a cheap fs
> check (plist present? checkout resolved?) added to `healthLines()` naming the
> service state and where the uninstall would act, consistent with the health-
> readout convention. Final placement is the Architect's call. *(FR-22.)*

### SPIKE-01 [SELF] — Self-uninstall detached-process survival (Stage-3, for the Architect)

**Question.** Does a detached, `osascript` / `shell=`-launched node (or shell)
teardown process **survive** (a) `launchctl bootout` of the `com.llmdash.dashboard`
service that (indirectly) spawned the badge that launched it, and (b) `rm -rf` of
its own checkout (`~/llmdash`), from which its code was loaded? What is the safe
teardown **ordering**, and must the process **copy its logic to a temp dir** (or
`cd` out of the checkout) before deleting the checkout?

**Success signal.** A **detached** teardown process completes **all** ordered
steps (FR-13) against a **SCRATCH fake install** — a scratch plist in a temp
LaunchAgents-like path, a scratch checkout dir, a scratch data dir — and exits 0,
with every scratch artifact removed (except a scratch data dir when `--keep-data`)
and the process demonstrably surviving both the scratch service's `bootout` and
the scratch checkout's `rm -rf`. The spike **never** touches the real service,
real checkout, or real data dir.

**Evidence.** A recorded run (or test) showing the detached process's exit code,
the ordered removals, and that it kept executing after its origin directory and
spawning service were gone; a note on whether a temp-copy / `cd`-out was required.

**Budget.** A focused Stage-3 spike (a few hours), self-contained against scratch
fixtures — no live-service risk.

**Fallback (if self-deletion of the checkout proves unsafe).** Either (a) copy the
teardown helper to a temp dir and run it from there, deleting the checkout last;
or (b) the uninstall performs every non-self step and leaves a final honest
instruction that the user can delete `~/llmdash` manually. The chosen path is
recorded in the Stage-3 schema and this PRD's [SELF] requirements are reconciled
to it.

---

## Success Metrics

Every functional requirement maps to at least one QA check below. Live in-menu-bar
render and real `osascript` dialogs are deploy-time captures (per the badge's
shipped deferral); the logic checks below are pure/injectable against scratch
fixtures — no real service, checkout, data dir, or dialog required.

| ID | What's Being Verified | Pass Condition |
|---|---|---|
| QA-01 | Service control is state-aware (FR-01) | Given launchd state = not-installed, the dropdown emits an "Install the local service" action; given installed, it emits "Remove the local service" — asserted over injected state, in both single-host and multi-host dropdown fixtures. |
| QA-02 | Install regenerates + loads the plist (FR-02) | The service hook, run against a scratch install, generates the plist from the template with **absolute** node/codex/claude paths + the resolved checkout dir (no `NODE_PATH`/`CODEX_PATH`/`CLAUDE_PATH`/`PROJECT_DIR` placeholders remain), writes it to the scratch LaunchAgents path, and issues the load — verified by inspecting the generated plist and the recorded launchctl invocation. |
| QA-03 | Remove unloads + deletes the plist (FR-03, OQ-01) | The service hook run with the remove verb issues `launchctl bootout`/`unload` **and** deletes the scratch plist file; the file is gone afterward. |
| QA-04 | Live state is read, never faked (FR-04) | The state read classifies a scratch install as running / stopped / not-installed from the real launchctl query + plist presence; no code path emits a checkmark/state without having queried. Asserted over the three scratch states. |
| QA-05 | Remove is confirmed; cancel is inert (FR-05, NFR-01) | With the confirm declined (injected "cancel"), no launchctl call and no plist deletion occur; with it accepted (`--yes`), the removal proceeds. |
| QA-06 | Badge survives the local service being off (FR-06, FR-16) | With the local `/api/hosts`/`/api/state` read failing (service removed), the badge emits its existing offline state — no fabricated number, no crash — and any configured remote-host watching path is unaffected. |
| QA-07 | Service actions are idempotent (FR-07, NFR-07) | Install against an already-installed scratch state reloads without error; Remove against a not-installed scratch state reports "nothing to remove" and exits 0. |
| QA-08 | Plist-present-but-unloaded state (FR-08) | Given a scratch plist present but not bootstrapped, the state read reports "stopped" (not "not installed"); Install loads it, Remove deletes it. |
| QA-09 | Both uninstall tiers are offered, both modes (FR-09) | The dropdown emits "Remove the menu-bar badge only" and "Uninstall llmdash completely" in both single-host and multi-host fixtures. |
| QA-10 | Badge-only removal is marker-gated (FR-10, NFR-05) | "Remove badge only" deletes a scratch wrapper carrying the `llmdash-menu-bar-badge` marker; a scratch file **without** the marker is left untouched with an honest message; service/checkout/data scratch artifacts are unchanged. |
| QA-11 | Complete uninstall enumerates before acting (FR-11, NFR-06) | The confirm dialog copy (captured non-interactively) lists the service+plist, wrapper, checkout, statusline wiring, and trust artifacts, and states the data dir is preserved by default; with the confirm declined, **nothing** is removed. |
| QA-12 | Data dir preserved by default; opt-in required (FR-12, US-06) | Complete uninstall **without** the data opt-in leaves the scratch data dir (`llmdash.db`, `claude-ratelimits.json`, `hosts.conf`) intact; **with** the explicit opt-in (`--yes` + data flag), those files are deleted. Default path never deletes the DB. |
| QA-13 | Safe teardown ordering (FR-13) **[SELF]** | Against a scratch install, the teardown removes artifacts in order service→statusline→trust→wrapper→checkout (data last, only if opted in); each scratch artifact is gone afterward (data per opt-in). Ordering asserted from the recorded step sequence. |
| QA-14 | Statusline revert is scoped + restores .bak (FR-14, NFR-05) | When scratch `settings.json` points at **this** scratch checkout's `statusline.js`, the wiring is reverted and a scratch `.bak` is restored; when it points at a **different** path or a user command, it is left untouched with an honest report. |
| QA-15 | SwiftBar never removed; dir-not-found handled (FR-15) | No code path runs `brew uninstall --cask swiftbar`; the enumeration/post-uninstall copy *points to* it as a manual step; when the scratch SwiftBar dir is absent, the badge-removal step emits by-hand instructions rather than erroring. |
| QA-16 | Badge offline + disappears post-uninstall (FR-16) | With the local read failing, the badge renders offline (no number, no crash); with the scratch wrapper removed, the badge is absent from SwiftBar's dir. |
| QA-17 | Installer hooks are the single source of truth (FR-17) | `install-macos.sh` exposes the service + uninstall hooks; the badge helper invokes them (or shared logic) rather than duplicating launchctl/plist code — verified by the helper delegating to the installer logic (no second launchctl-generation copy). Hook verbs are honest (install/remove/status). |
| QA-18 | Helper mirrors the anti-injection pattern (FR-18, NFR-02) | The helper invokes `execFileSync('/usr/bin/osascript', …)` with fixed-literal AppleScript, no shell, values passed only as ARGV/captured stdout; asserted by inspection (no value concatenated into an `-e` string or a command) and a hostile-input round-trip that stays inert. Runs under `process.execPath`/`$ABS_NODE`. |
| QA-19 | Detached teardown survives its own origin (FR-19) **[SELF]** | Per SPIKE-01: a detached teardown process completes all steps against a scratch install and exits 0 after the scratch service's `bootout` and the scratch checkout's `rm -rf` — surviving deletion of its origin. (Or the ratified fallback is exercised.) |
| QA-20 | Honest on partial failure (FR-20, NFR-06) | With a simulated failure (a launchctl error or an undeletable scratch file) injected mid-action, the resulting message states exactly what did **not** happen and what remains; no success/removal is claimed for the failed step; the rest is left recoverable. |
| QA-21 | Test seam drives logic without a real dialog/service (FR-21) | The service/uninstall logic runs non-interactively (`--yes`/injected value/`--keep-data`) against scratch paths, asserting the full round-trip with no real `osascript` dialog and no touch of the real service, checkout, or data dir. |
| QA-22 | Disclosure covers the new powers (FR-22) | README + installer/startup output document the service toggle, the two-tier uninstall, the data-preserved-by-default default, and the SwiftBar-never-removed rule; a disclosure test asserts the copy exists. |
| QA-23 | No privilege escalation (NFR-03) | No action invokes `sudo`, a system launchd domain, or a path outside user-owned locations; asserted by inspection + the scratch-only test paths. |
| QA-24 | HTTP stays read-only (NFR-04) | Extend the server test: all responses carry baseline headers, non-GET/HEAD → 405 (`allow: GET, HEAD`), static `no-store`; **no** new write endpoint exists; the request path does no launchctl/uninstall work. |
| QA-25 | Marker-gating across every removal (NFR-05) | For each removable path (wrapper, statusline wiring, plist, checkout), a scratch "user's own" variant (wrong marker / different target path / foreign label) is **not** deleted; only llmdash-created scratch artifacts are removed. |
| QA-26 | Zero deps / no build / macOS-only (NFR-09) | `package.json` runtime deps still 0; the helper + hooks use only Node builtins + `osascript`/`launchctl`; no build step; the feature guards against the Linux systemd path (macOS-only). |
| QA-27 | Delivery model preserved (NFR-08) | The tracked helper rides the marker-gated wrapper/absolute-node model; "Remove badge only" / `--remove-badge` reverse it symmetrically; the tracked source is never rewritten; SwiftBar never auto-(un)installed — extends `tests/menubar-install.test.js`. |
| QA-28 | Request-path isolation (NFR-10) | The live-state `launchctl print` read and all service/uninstall subprocess work occur in the badge/helper process; the server request path and poller tick do no new work — asserted by inspection + the read-only server test (QA-24). |

---

*End of PRD — menubar-service-controls.*
