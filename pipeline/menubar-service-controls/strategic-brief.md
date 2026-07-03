# Strategic Brief — Menu-bar Service Controls

## What We're Building

Two menu-bar controls that let the user manage llmdash's install lifecycle
without ever opening a terminal:

1. **A local-service toggle** — from the badge dropdown, register/load the
   llmdash launchd monitoring service on this Mac, or unregister/unload it.
   This makes a machine a full local monitor or turns it into a
   monitoring-station (badge only, watching remote hosts) with one click.
2. **An "Uninstall llmdash" action** — from the badge dropdown, tear down
   llmdash on this Mac: the launchd service, the badge wrapper, and
   (with explicit ratification) the checkout, the Claude statusline wiring,
   and the auto-refresh trust artifacts — reversing what the installer did.
   SwiftBar itself is never touched.

Both are **local, user-scoped operations run by the badge process** (the same
`shell=` action → tracked node helper → `osascript` confirm dialog pattern the
multi-host-badge feature shipped). They are **not** new HTTP endpoints — the
dashboard's serve-only / read-only posture is preserved.

## Why Now

The badge already reached the point where this is the natural next step, not a
leap. Three things just shipped that make it coherent:

- **The menu-bar badge exists and already mutates local state safely** — the
  multi-host-badge feature (DECISIONS.md 2026-07-03) established the exact
  pattern this reuses: SwiftBar dropdown actions → `$ABS_NODE` → a tracked
  helper → fixed-literal `osascript` confirm/input dialogs → local file ops,
  with structural anti-injection and no HTTP write surface. The hardest
  precedent (a click that changes the machine) is already set and hardened.
- **The monitoring-station identity became real** — the badge can now run on a
  Mac with *zero* local Claude/Codex, watching remote hosts. Once that machine
  exists, "I don't need the local service here" is a coherent, common request —
  but today the only way to answer it is `launchctl unload` in a terminal.
- **The installer already owns all this logic** — `scripts/install-macos.sh`
  generates and loads the plist, wires the badge (`--setup-badge` /
  `--remove-badge`, marker-gated), and reverses cleanly. The teardown knowledge
  exists; it just isn't reachable from the bar. This feature exposes it, it
  doesn't reinvent it.

The product arc "everything from the menu bar" (install badge → add/remove hosts
→ **manage/remove the service** → **uninstall**) removes the last standing
terminal dependencies for the install lifecycle. That completion is the case for
building it now.

## The User Problem

The single user runs llmdash on one or more of their own Macs. Today, every
install-lifecycle action after the first `curl | bash` requires the terminal:
stopping the service on a machine that's become a monitoring station means
`launchctl unload`; removing llmdash entirely means remembering the plist path,
the checkout path, the statusline wiring, and the data dir, and deleting each by
hand. For a personal glance-tool the user reaches for from the menu bar, dropping
to a terminal to *manage the tool itself* is exactly the friction the badge was
built to remove. They want to add or remove local monitoring, or remove the app
altogether, from the same bar they already use to read it.

## Success Criteria

- From the badge dropdown, the user can **turn the local monitoring service off**
  on a machine (unregister the launchd agent) and **turn it back on**, and the
  menu **reflects the real launchd state** — checked/enabled shown honestly,
  never faked. The badge keeps working off remote hosts when the local service is
  off (the monitoring-station story stays intact).
- From the badge dropdown, the user can **uninstall llmdash** on this Mac. Before
  anything is removed, a confirmation dialog **lists exactly what will be
  removed** — and the irreplaceable snapshot-history DB is called out explicitly.
  After confirming, the service is unloaded, the badge wrapper removed, and the
  ratified artifacts deleted; the badge disappears from the bar.
- **Nothing destructive happens without an explicit confirmation** naming the
  consequence. A cancel changes nothing.
- Every action is **honest on partial failure** — if the service won't unload or
  a file won't delete, the dialog says what didn't happen; it never claims a
  removal that didn't occur.
- The uninstall action **survives deleting its own origin** — the helper (which
  lives in the checkout being removed) completes the teardown even though it is
  removing the directory its own code was loaded from.
- **SwiftBar is never uninstalled** — an uninstall may *point to*
  `brew uninstall --cask swiftbar` but never runs it.
- HTTP stays **read-only** — no new endpoint, still 405 for non-GET/HEAD. No
  `sudo`, no privileged path — everything is user-scoped (a user launchd agent,
  user-owned files).

## Scope

- A **local-service toggle** in the badge dropdown that **registers/loads** the
  launchd agent `com.llmdash.dashboard` (writes the plist from the template,
  `launchctl load -w`) or **unregisters/unloads** it (`launchctl bootout` /
  `unload`, and — for a true "remove the service" — deletes the plist). The
  toggle reflects the **real launchd state**, read live (checked/enabled), never
  a cached or assumed value.
- An **"Uninstall llmdash" action** in the badge dropdown, offered as **two
  tiers** (see Key Decisions):
  - **"Remove the menu-bar badge only"** — reverses `--setup-badge` (the
    marker-gated wrapper), leaves the service, checkout, and data intact.
  - **"Uninstall llmdash completely"** — a confirmation dialog **enumerating
    every artifact** before acting: the launchd service + plist, the badge
    wrapper, the checkout (`~/llmdash`), the Claude statusline wiring in
    `~/.claude/settings.json` (restoring the `.bak` if present), and the
    auto-refresh trust entry + `~/.llmdash/claude-refresh-cwd`. The snapshot-
    history data dir (`claude-ratelimits.json`, `hosts.conf`, `llmdash.db`) is
    **preserved by default with an explicit opt-in to also delete it** — the DB
    is the product's only irreplaceable asset (see Key Decisions).
- **Reuse of the shipped osascript-confirm helper pattern** — a new tracked
  helper under `scripts/menubar/`, invoked by SwiftBar `shell="$ABS_NODE"`
  actions, mirroring `host-config-action.mjs` (fixed-literal AppleScript, ARGV/
  captured-stdout only, `execFileSync`, no shell, no value concatenation).
- **Extension of the installer's hooks** as the single source of truth for the
  launchctl/plist/teardown logic (e.g. `--service start|stop|status`,
  `--uninstall [--keep-data]`), reconciled with the self-deletion ordering (see
  Key Decisions) — the badge actions call installer logic, not a duplicated
  copy of it.
- **Honest, idempotent behavior** — re-running an action already applied is a
  friendly no-op; a partial failure is reported truthfully.
- **Disclosure** — README + startup-log coverage of the new powers, consistent
  with the "surface security-relevant defaults, never silently" convention.

## Out of Scope

- **Installing SwiftBar** or **uninstalling SwiftBar** — SwiftBar is a
  user-installed prerequisite llmdash never manages. An uninstall may *point to*
  `brew uninstall --cask swiftbar`; it never runs it. (Standing convention.)
- **A full install-from-nothing from the bar** — "add the service" assumes the
  app files are already present (the badge is running, so the checkout exists);
  it (re)creates and loads the launchd agent from those files. Bootstrapping
  llmdash onto a bare machine stays the `curl | bash` installer's job.
- **Any HTTP write/mutation endpoint** — these controls are local
  `launchctl`/fs operations run by the badge process. The `0.0.0.0` bind gains
  no write surface; `server.js` stays 405-for-non-GET/HEAD, serve-only.
- **Any privilege escalation** — no `sudo`, no system-level launchd domain
  (`gui/<uid>` user agent only), no writes outside user-owned paths.
- **Managing the Linux systemd service** — this is a macOS menu-bar feature;
  the systemd unit is not in scope.
- **Remote service control** — a control acts only on **this** Mac (the machine
  the badge runs on). It never reaches across the tailnet to start/stop/uninstall
  a peer (that would require a mutation surface the serve-only posture forbids).
- **Changing the `/api/state` or `/api/hosts` contract.**

## Key Decisions

**1. Service toggle = register/unregister the plist, not transient start/stop
(recommended).** A `KeepAlive:true` agent relaunches after a `launchctl stop`,
so a transient "stop" is a lie the moment launchd relaunches it — dishonest UI.
The coherent, least-surprising model is **Install the local service** (write the
plist from the template + `launchctl load -w`) / **Remove the local service**
(`launchctl bootout` + delete the plist). This maps cleanly onto the real user
intent ("this is a monitoring station now, drop the local service") and onto a
launchd state the menu can read and reflect honestly. *Trade-off:* re-adding the
service must regenerate the plist (resolving node/codex/claude absolute paths,
per the installer's fresh-install decision) — which is why this reuses the
installer's plist-generation logic rather than caching a stale plist. The menu
**checks the live launchd state** (`launchctl print gui/<uid>/com.llmdash.dashboard`
or equivalent), never a fake checkmark. *For the Designer/user to ratify: the
exact toggle wording and whether "Remove the local service" deletes the plist
(true unregister) or only unloads it (survives reboot un-loaded).*

**2. Uninstall is two-tier, and the data DB is preserved by default (recommended
— THE ratification item).** Two tiers because the badge and the app have
genuinely different removal intents:
- **"Remove the menu-bar badge only"** — reverses `--setup-badge`, leaves
  everything else. The low-stakes, reversible action.
- **"Uninstall llmdash completely"** — the full teardown, gated by a
  confirmation dialog that **enumerates every artifact before acting**.

Within the full uninstall, the **snapshot-history DB (`llmdash.db`) is the
product's only irreplaceable asset** — the founding brief's "self-logged history,
no backfill" decision means deleting it destroys history that cannot be rebuilt.
So the recommended default is **preserve the data dir; offer an explicit opt-in
to also delete it** ("Also delete N days of usage history? This can't be undone.").
Everything else (service, plist, wrapper, checkout, statusline wiring, trust
artifacts) is reversible-by-reinstall and can default to removal. *This entire
scope — the tiering, the exact default, and above all the data-deletion decision
— is flagged for the user to ratify at the Designer stage.*

**3. Self-uninstall runs as a detached process that survives deleting its own
origin (recommended — the sharp technical risk, flag for an Architect spike).**
The uninstall helper lives inside the checkout it is removing (`~/llmdash/
scripts/menubar/…` alongside `install-macos.sh`), and it must `launchctl bootout`
the very service feeding the badge and `rm -rf` its own directory. A helper that
deletes its own code mid-run can break. The recommended approach: the action
launches a **detached** teardown process that either **copies the needed teardown
logic to a temp location first** or is **self-contained and reads nothing further
from the checkout after it starts**, then unloads the service, removes files in a
safe order (service/plist → statusline wiring → trust artifacts → wrapper →
checkout last), and exits — surviving the deletion of its origin. **Flag for the
Architect: a Stage-3 spike** — does a detached, `osascript`/`shell=`-launched node
helper survive `rm -rf` of its own checkout and `launchctl bootout` of the service
that (indirectly) spawned it? What is the safe teardown ordering, and does it need
to `cd` out of / copy out of the checkout before deleting it?

**4. Extend the installer's hooks; the badge calls them via the detached helper
(recommended).** The launchctl/plist/teardown logic already lives in
`scripts/install-macos.sh` (`--setup-badge`, `--remove-badge`, plist generation,
`launchctl load`, the resolve-node/codex/claude probes). Rather than duplicate
launchctl logic in the badge, **extend the installer with hooks** — e.g.
`--service start|stop|status` and `--uninstall [--keep-data]` — and have the badge
actions invoke them. *Reconcile with Decision 3:* the installer script is itself
in the checkout being removed, so the uninstall path specifically may need the
temp-copy approach (copy the uninstall logic out before it deletes the checkout).
Framed as: extend the installer's hooks as the source of truth; the badge invokes
them through the detached helper, which handles the self-deletion ordering. This
keeps one place that knows what the installer touches, so uninstall reverses it
honestly and stays in sync as the installer evolves.

**5. Destructive-action safety posture (for the Auditor).** Every one of these is
a system mutation from a click, so each carries forward the multi-host-badge
hardening, made stricter by the higher stakes:
- **Explicit `osascript` confirmation on every mutation** — service remove and
  (especially) uninstall; the uninstall dialog **lists exactly what will be
  removed** before doing it. A cancel changes nothing.
- **Structural anti-injection** — fixed-literal AppleScript, `execFileSync`
  (`/usr/bin/osascript`, no shell), values passed as ARGV / captured stdout only,
  never concatenated into a command or script. No `sh -c`, no `eval`.
- **No privilege escalation** — user launchd agent (`gui/<uid>`), user-owned
  files only. Never `sudo`, never a system path.
- **HTTP stays read-only** — no new endpoint; the mutations are local
  `launchctl`/fs operations in the badge/helper process.
- **Idempotent + honest on partial failure** — if `launchctl bootout` fails, say
  so; never claim a removal that didn't happen. Marker-gating carries over (the
  badge wrapper is removed only when it carries the `llmdash-menu-bar-badge`
  marker — a user's own file is never deleted).

**6. Founding-brief alignment — a conscious, disclosed expansion; no rewrite
needed.** This fits llmdash's founding ethos squarely: a personal, single-user
macOS tool that "runs on your machine, glance from anywhere," now with no-terminal
install-lifecycle control. It completes the "everything from the menu bar" arc.
The conscious expansion worth naming: the badge — until now a read-only /
config-only surface — gains **service-lifecycle and self-uninstall powers**, a
significant new *destructive* capability. That expansion is the user's explicit
ask, and it is bounded exactly where the product's conventions draw the line:
user-owned local operations only, every mutation confirmed, no HTTP write surface,
no `sudo`, never touching SwiftBar. **No product-brief rewrite is required** — the
"Out of Scope" list stays accurate (no public exposure, no multi-user, no privilege
escalation). One optional note for the brief: the menu-bar badge is now also a
**local install-lifecycle surface**, not only a read-only glance. Recommend
recording that as a one-line addition to the shipped-capabilities context rather
than a founding-decision change.
