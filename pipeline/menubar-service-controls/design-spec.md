# Design Spec — Menu-bar Service Controls

**Feature:** menubar-service-controls
**Stage:** 4 — The Designer
**Status:** **APPROVED by the user 2026-07-03**, as drawn — all flagged calls
ratified to the recommended treatments: (1) a full uninstall removes service+plist,
badge wrapper, checkout, statusline wiring (restoring the .bak), and the
auto-refresh trust folder; (2) the usage-history DB (llmdash.db) is preserved by
default, deletion is an explicit non-default opt-in warned as permanent; (3)
"Remove the local service" fully unregisters (deletes the plist), not a transient
stop; plus the service-item wording + `· running`/`· stopped` suffix as drawn, and
the three dialogs' verbatim copy (enumerate-before-acting, safe default button).
**Host:** SwiftBar (documented default); xbar is best-effort (the floor is xbar-safe).
**Mockup:** `pipeline/menubar-service-controls/design.html`
**Extends:** `pipeline/multi-host-badge/design-spec.md` (the shipped badge dropdown +
`osascript` dialog vocabulary) — this spec adds new **rows in that existing vocabulary**,
plus three OS-native confirmation dialogs, and reuses everything else verbatim.

---

## Visual Direction

Within the established design system, these controls are new **rows in the shipped
badge's existing action vocabulary** — the same `＋ / － / ☰` glyph grammar, the same
`.dd-action` row, the same submenu affordance, and the same `.osa-dialog` macOS-dialog
styling the multi-host badge already ships. No new tokens, no new color semantics: the
service item is a state-labeled `－`/`＋` row; the Uninstall submenu mirrors the Remove-host
submenu; the confirmation dialogs are OS-native `display dialog`s matched to macOS
convention (icon, title, body, two buttons, **default button on the safe choice**). The
only new "chrome" is the state suffix (`· running` / `· stopped`) — a dim mono locator, not
a color — and the enumeration/opt-in dialog copy. Honesty is the through-line: live state is
never faked, every artifact is enumerated before anything is touched, and the one
irreplaceable asset — the snapshot database — is preserved by default.

---

## The state-aware service item (FR-01 / FR-04)

One row in the shared action-lines helper, present in **both** single-host and multi-host
dropdowns (rides the same path as `hostConfigActionLines`, so it is structurally present in
both `dropdownLines` and `multiDropdownLines`). Its label is read from the **live launchd
state** at render — never a fabricated checkmark — mapping three states → three labels:

| launchd state | Label | Suffix | Action |
|---|---|---|---|
| **not-installed** (no plist on disk) | `＋ Install the local service` | — | light confirm → `service-control-action.mjs install` (regenerate plist w/ fresh absolute paths + load) |
| **running** (loaded in the user domain) | `－ Remove the local service` | `· running` | consequence confirm → `service-control-action.mjs remove` (bootout + delete plist) |
| **stopped** (plist present, unloaded) | `－ Remove the local service` | `· stopped` | consequence confirm → `remove`; Install path also reloads |

- The **suffix** (`· running` / `· stopped`) is a dim mono, tabular locator appended to the
  label — **never a status color** (the honest state is carried by the label word + suffix
  text, so it reads in a monochrome bar; xbar-safe).
- The **`＋` / `－` glyph** matches the shipped `Add host…` / `Remove host…` grammar exactly —
  `＋` = install/add (a thing appears), `－` = remove (a thing goes away).
- **xbar-safe floor:** plain text + `color=` only; nothing depends on a SwiftBar-only param.
- Rendered as a SwiftBar action line exactly like the host-config actions:
  `shell="${ABS_NODE}" param1="${SERVICE_CONTROL_ACTION}" param2=install|remove terminal=false refresh=true`.

**Placement in the dropdown (both modes):** after the per-tool rows (single) / per-host
sections (multi) and their `---` divider, the service item leads the action cluster, then the
host actions (`Add host…` / `Remove host…` / `Watching: N`), then `Uninstall llmdash…`, then a
`---`, then the shipped `Open dashboard` / `Refresh`. Order in the mockup:

- **Single-host, running:** `－ Remove the local service · running` → `Add host…` →
  `☰ Watching: 0 other machines` → `Uninstall llmdash…` → `───` → `Open dashboard` → `Refresh`.
- **Monitoring station, removed:** `＋ Install the local service` → `Add host…` →
  `－ Remove host…` → `☰ Watching: 3 other machines` → `Uninstall llmdash…` → `───` →
  `Open dashboard` → `Refresh`.

---

## The Uninstall submenu (FR-09) — two tiers, both modes

`⊘ Uninstall llmdash…` is a submenu parent (SwiftBar nested items via leading `--`), present
in **both** modes via the same shared helper. Two tiers, deliberately unequal in stakes:

```
⊘ Uninstall llmdash…
  ↳ ▬ Remove the menu-bar badge only     → service-control-action.mjs remove-badge
       (Takes the badge off the bar. Service, checkout, and data stay.)
  ↳ ⊘ Uninstall llmdash completely…      → service-control-action.mjs uninstall
       (Lists everything it will remove, then asks. Your history is kept by default.)
```

- **Tier 1 — "Remove the menu-bar badge only"** delegates to the existing `remove_badge`
  (marker-gated: a wrapper without the `llmdash-menu-bar-badge` marker is a user file, left
  untouched with an honest message). Service, checkout, data all stay. The badge disappears
  on the next SwiftBar refresh.
- **Tier 2 — "Uninstall llmdash completely…"** — the trailing `…` signals it opens a dialog.
  It launches the enumerated confirm (below) then the detached teardown. Never one accidental
  click from tier 1: it carries its own `…` and its own gate.
- The `⊘` glyph reads as "disable/remove entirely" and is distinct from the `－` service-remove
  glyph, so the two removals don't read as the same action.

---

## Binding copy — the confirmation dialogs (VERBATIM)

Fixed-literal `osascript display dialog`s, invoked with no shell; the only dynamic value —
the resolved checkout path `<dir>` (default `~/llmdash`) — is escaped into the string via
`asStr()`, never re-fed as script. **In every dialog the default (macOS-blue) button is the
SAFE choice**, so a reflexive Return never destroys anything.

### 1. The enumerated uninstall confirm (FR-11) — step 1

> **Title:** `Uninstall llmdash from this Mac?`
>
> **Body:**
> ```
> This will remove:
>   • the launchd service (com.llmdash.dashboard) and its plist
>   • the menu-bar badge wrapper (in SwiftBar's plugin folder)
>   • the app checkout at <dir>
>   • the Claude Code statusline wiring (restoring your settings.json.bak if present)
>   • the auto-refresh trust folder (~/.llmdash/claude-refresh-cwd) and its ~/.claude.json entry
>
> Your usage-history database (llmdash.db) is PRESERVED — it's the only thing here
> that can't be rebuilt, so it's kept unless you say otherwise on the next step.
> SwiftBar is not removed — uninstall it yourself with: brew uninstall --cask swiftbar
> ```
>
> **Buttons:** `[ Uninstall ]` `[ Cancel ]` — **`Cancel` is the default button.** Cancel
> changes nothing (no service touched, no file removed).

*Enumeration first, by name and real path, so the user approves the exact scope — never a
vague "are you sure?". Every path is marker-gated (plist only the `com.llmdash.dashboard`
label; statusline only if it points at THIS checkout; wrapper only with our marker; checkout
only the resolved `<dir>`); a second install or a user's own file is left untouched. A step
that can't complete is reported honestly — exactly what did not happen — never claimed done.*

### 2. The data opt-in (FR-12) — step 2, only after Uninstall

> **Title:** `Also delete your usage history?`
>
> **Body:**
> ```
> Your snapshot database (llmdash.db) holds every limit reading llmdash has ever
> recorded. Removing llmdash doesn't need to delete it — and this can't be undone.
> Keep it unless you're sure; it's the only data here that can't be rebuilt by reinstalling.
> ```
>
> **Buttons:** `[ Delete history too ]` `[ Keep my history ]` — **`Keep my history` is the
> default button** (the safe choice). `Delete history too` is the only path that removes
> `llmdash.db`, mapping to the helper's `--delete-data` flag (default `--keep-data`).

*Appears only after the user confirmed the uninstall (step 1). Names irreversibility
explicitly; steers to Keep. The destructive answer requires a deliberate second click.*

### 3. The service-remove confirm (FR-05)

> **Title:** `Remove the local llmdash service?`
>
> **Body:**
> ```
> This Mac will stop running its own local monitor — the launchd agent is unloaded
> and its plist deleted. If this badge watches remote machines, it keeps working off
> those; only the local reading stops. You can re-install the service from this menu any time.
> ```
>
> **Buttons:** `[ Remove the service ]` `[ Cancel ]` — **`Cancel` is the default button.**

### 4. The service-install confirm (FR-05 / OQ-03 default) — lighter

> **Title:** `Install the local llmdash service on this Mac?`
> **Body (lighter):** `This regenerates the launchd agent with fresh paths and loads it so llmdash runs at login and restarts on crash.`
> **Buttons:** `[ Install ]` `[ Cancel ]` — **`Cancel` is the default button.**

*Every mutation is confirmed (NFR-01); a non-destructive install reads lighter than remove.*

---

## Component Usage — reuse vs. new

| Element | Source | Reuse / new |
|---|---|---|
| `.dd-action` row + `＋ / － / ☰` glyph grammar | shipped badge | **Reused verbatim** for the service item + Uninstall parent. |
| Submenu affordance (`--` nested items, caret, sub-labels) | shipped badge (Remove-host submenu) | **Reused** for the Uninstall two-tier submenu. |
| `.osa-dialog` macOS-dialog styling (icon, title, body, buttons) | shipped badge (Add/Remove dialogs) | **Reused verbatim** for all three confirmation dialogs. |
| `asStr()` AppleScript-string escaper + fixed-literal / no-shell discipline | `host-config-action.mjs` | **Reused verbatim** — the resolved path is the only dynamic value, escaped. |
| Status tokens `good` / `warn` / `crit`, tints | design system | **Reused.** `good`-tint for the preserve-by-default note, `warn`-tint for the data opt-in, `crit` hue on destructive buttons. |
| `＋`/`－`/`☰` shared action-lines path (both modes) | `hostConfigActionLines` | **Reused pattern** — the new items ride the same shared helper. |
| **State suffix `· running` / `· stopped`** | — | **New (minimal):** a dim mono, tabular locator on the service item — not a color, xbar-safe. |
| **The enumeration + data-opt-in + service-consequence copy** | — | **New copy** (bound above), honest + enumerating + safe-default. |

**Design-system extension: none.** No new tokens, no new color semantics. The additions are
structural (two action rows, a submenu, three dialogs) built entirely from existing tokens and
the shipped badge/dialog vocabulary.

---

## Design Tokens Applied

- **Preserve-by-default note** (enumerate dialog): `good` / `good-bg` (a deliberate reassurance,
  not a warning) — the kept database reads as a kindness.
- **Data opt-in note:** `warn` / `warn-bg` — a caution, not an error; the irreversibility line
  uses the `crit` color inline.
- **Destructive buttons** (`Uninstall`, `Delete history too`, `Remove the service`): `crit` hue,
  non-default; the **default button** uses `accent` (macOS blue) and always sits on the safe
  choice.
- **Service-item state suffix:** `--dropdown-muted`, mono, tabular-nums.
- **Menu-bar/dropdown chrome colors:** the OS's own, reused verbatim from the shipped mockups.

---

## Interaction Notes (for the Engineer)

- The service item's label is derived from the **live launchd state read in the badge render
  process** (off the request path, off the poller tick — NFR-10). Three labels, three states
  (running / stopped / not-installed), never faked.
- Both new items ride the **shared action-lines helper**, so they are structurally present in
  single-host AND multi-host dropdowns (like `hostConfigActionLines`, called from both
  `dropdownLines` and `multiDropdownLines`). Don't add them to only one renderer.
- Each action shells to `service-control-action.mjs` under `$ABS_NODE` / `process.execPath`
  (`terminal=false`, `refresh=true`) — **no HTTP mutation**. The dialogs are fixed-literal
  `osascript`, no shell; the resolved checkout path is the only dynamic value, escaped via
  `asStr()`, never re-run as script.
- The **enumerated confirm (step 1)** fires before any removal; the **data opt-in (step 2)**
  fires only if the user confirmed step 1. A cancel at either changes nothing.
- After a service-remove or a complete uninstall, the badge's loopback read fails → the
  **existing** offline state renders (no fabricated number, no crash); remote-host watching is
  unaffected. After a complete uninstall the wrapper is gone → the badge disappears on the next
  refresh.
- Every removal is **marker-gated** and **honest on partial failure** — the post-uninstall
  message names exactly what did not happen, never claims a removal that didn't occur.

---

## Content Notes

- Copy is honest and consequence-naming throughout — a destructive action never hides behind a
  bare "OK." Every destructive button names what it does (`Uninstall`, `Delete history too`,
  `Remove the service`); the default button is always the safe choice.
- **Preserve-by-default reads as a deliberate kindness:** the database is called out as "the
  only thing here that can't be rebuilt" and kept unless the user explicitly opts in — the
  opt-in dialog names the irreversibility plainly.
- **SwiftBar is never removed** — both the enumeration and the (implied) post-uninstall message
  point the user to `brew uninstall --cask swiftbar` as a manual step; llmdash never runs it.
- Realistic scenario throughout the mockup: a single-host Mac with the service running, and a
  monitoring station whose local service is removed — real machine names, no lorem, no
  fabricated zeros.

---

## Flagged for the user to ratify (Designer-stage decisions)

1. **Uninstall SCOPE + the enumeration copy** — the two tiers and the exact artifact list
   (service+plist, wrapper, checkout, statusline+backup, trust folder). Drawn as the working
   default; ratify the scope and wording.
2. **Data-preserved-by-default** — the DB is kept unless the user opts into `Delete history
   too`, which is warned as irreversible and is never the default button. Ratify this default.
3. **Confirmation copy** — the three dialogs above, verbatim. Ratify or refine wording (the
   enumeration + honesty + the data opt-in + safe-default must be preserved).
4. **Service-item wording + state suffix** — `Install / Remove the local service` +
   `· running` / `· stopped`. Ratify or refine within the xbar-safe grammar.
