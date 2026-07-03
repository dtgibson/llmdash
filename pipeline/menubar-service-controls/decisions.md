# Decisions — menubar-service-controls

## Stage 4 (Designer review) — 2026-07-03
- **User approved the design as drawn ("ship it, all three as recommended"),
  ratifying:**
  1. **Full-uninstall scope** = everything the installer put on the machine: the
     launchd service + plist, the badge wrapper, the app checkout, the Claude
     statusline wiring (restoring `settings.json.bak` if present), and the
     auto-refresh trust folder (`~/.llmdash/claude-refresh-cwd` + the own-key
     `~/.claude.json` entry). Presented in an enumerate-before-acting osascript
     dialog that lists every artifact by name/path. SwiftBar is never removed (the
     dialog points to `brew uninstall --cask swiftbar`).
  2. **Usage history preserved by default** — `llmdash.db` (and the rest of the data
     dir) is kept unless the user explicitly picks "Delete history too" in a second
     dialog; that destructive option is never the default button and is warned as
     permanent/irreversible. It's the product's only irreplaceable asset ("self-
     logged history, no backfill").
  3. **"Remove the local service" fully unregisters** — `launchctl bootout` + delete
     the plist (a true remove), not a transient stop (a KeepAlive:true agent would
     relaunch after a plain stop, so a "stopped" state would be a lie). The menu
     item reads the live launchd state (running/stopped/not-installed), never faked.
- **Two-tier uninstall** confirmed: "Remove the menu-bar badge only" (marker-gated
  wrapper removal, leaves service/checkout/data) vs "Uninstall llmdash completely…".
  Both the service toggle and the Uninstall submenu appear in single-host AND
  multi-host dropdown modes (shared action-lines path).
- **Every mutation confirmed** via an osascript dialog with the safe choice as the
  default button; honest on partial failure. Design-system reuse only (dropdown
  chrome, submenu, `.osa-dialog`, good/warn/crit tints) — no new tokens.
- Copy table in design-spec.md is verbatim-binding for the Engineer (the
  enumeration, the honesty note, the data opt-in, and the safe-default must survive
  any wording change).

## Stage 8 (Deployer) — 2026-07-03
- **Shipped.** Commit 96ee98d on origin/main; installed copy at ~/llmdash
  fast-forwarded and the launchd service restarted. Health-checked live: /api/state
  200, POST /api/hosts → 405 (serve-only preserved). The installed badge dropdown
  now shows the state-aware toggle ("－ Remove the local service · running" — reading
  the real launchd state) and the "Uninstall llmdash…" submenu, both pointing at the
  installed service-control-action.mjs under the absolute node. The three osascript
  dialogs (enumerate / data opt-in / service-remove) are the only deploy-deferred
  item — they fire on a real click and were deliberately NOT triggered (one of them
  uninstalls llmdash).
- **Security finding 1 resolved in-stage before ship** (the statusline-revert
  substring→boundary match, commit folded into the feature commit; 378 tests).
- All build/QA/security verification used scratch launchd labels + scratch paths;
  the real service, checkout, and data were verified untouched throughout and after
  deploy.
