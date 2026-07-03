# PRD — Badge Display Options
**Feature:** badge-display-options
**Date:** 2026-07-03
**Stage:** 2 — The Planner
**Source:** strategic-brief.md (approved)

---

## Feature Overview

The macOS menu-bar badge becomes user-shapeable from its own dropdown. Today the
glyph renders exactly one thing — the single most-constrained host, in one wide
text entry (`▪ Studio·C 12%`) — with no say for the user. This feature lets the
user choose what the ambient glance shows along **three independent display axes**
— **which host(s)** appear in the glyph, the **layout** of the selected hosts
(single / side-by-side / alternating), and the **density** (wide text / compact
icon) — set from a new **"Display" submenu** of enumerable choices in the badge
dropdown, with a small set of **named presets** as the friendly front. The choices
persist in the local config the badge already reads, are written locally (never
over HTTP), and are a **presentation change only**: host selection is a **view
filter on the glyph**, never a change to what is monitored, polled, or shown in the
dropdown. With no display config set, the badge renders **byte-for-byte** as it does
today.

### What this PRD hands to Stage 3 (the Architect)

Every ingredient this feature needs already shipped and is proven. `computeMultiBadge`
(in `scripts/menubar/llmdash.5s.js`) already ranks all hosts, picks the binding one,
and computes a per-host `hostViews` array — showing *several selected* hosts is a
**presentation change over that same data**, not a new data path. The config +
local-edit pattern (`hosts.conf` under the data dir, `!`-directives parsed by
`src/host-config.js`, edited locally via a tracked action-helper under `$ABS_NODE`,
dashboard serve-only/405) is the exact model these display preferences reuse. The
honesty grammar — five states (fresh/aging/stale/no-reading/offline), the C/X tool
cue, the host cue, all xbar-safe (text/emoji + `color=`) — already exists; the
compact and multi layouts carry that same honesty onto a **denser** surface.

This PRD pins the requirements and tags **two load-bearing mechanics** for a
Stage-3 spike (**SPIKE-01 [RENDER]**): whether SwiftBar auto-cycles multiple
pre-`---` title lines (the "alternating in place" mechanism), and what compact
rendering holds all five honesty states while staying xbar-safe. Each has a named
success signal and a concrete fallback, so the layout options ship regardless of
the outcome. It also branch-tags the **config-location** decision (**[CFG]**:
`hosts.conf` directives vs a sibling prefs file) with a default and a fallback.
Requirements that depend on these are tagged so the Stage-3 outcome resolves
cleanly.

### The data the badge already computes (authoritative field names)

This feature adds **no new data path**. It re-lays-out the `hostViews` array
`computeMultiBadge` already returns from the combined `/api/hosts` view. Each
host view carries (verbatim from the shipped code): `label`, `addr`, `self`,
`reachable`, `badge` (the per-host `computeBadge` result, or null when offline),
`hostDiag`, `pending`, `emptyLocal`, `deemph`, `diagLine`. Each per-host `badge`
carries `state` (fresh/aging/stale/no-reading), `pct`, `cue` (C/X), `binding`,
and `toolViews` (the per-tool rows). The `binding` (min `remainingPct` across
host × tool × window with a reading) and the render order (binding host first)
are unchanged. Display preferences select and re-arrange these views for the
glyph; they never re-derive a number, never fabricate one, and never touch the
`/api/hosts` or `/api/state` contract.

---

## User Stories

> **US-01** — As someone who watches two build machines side by side, I want to
> choose **which monitored host(s)** the badge glyph shows — all (today's default),
> a specific machine, or a chosen subset — so the ambient glance shows the machines
> *I* care about, not whichever host happens to be tightest that minute.

> **US-02** — As that same user, I want to choose a **layout** for the selected
> hosts — single (most-constrained), side-by-side (all selected at once in one
> menu-bar item), or alternating (cycling in place) — so I can see my two build
> machines together at a glance, with the layout honest about which mechanism it
> uses.

> **US-03** — As someone on a crowded menu bar, I want a **compact icon+number**
> density option (dropping the host name / tool letter to shrink the width) as well
> as today's wide text — with a **single compact icon** and **compact icons
> side-by-side** both rendering legibly — so the badge is a quick color-coded pulse
> when I want one and a full readout when I don't.

> **US-04** — As someone who likes glance-friendly defaults, I want a small set of
> **named presets** in the Display submenu (e.g. "Most-constrained · wide" = today,
> "All hosts · compact · side-by-side", "Rotate hosts · compact") that set the axes
> for me, with the individual axes still adjustable underneath — so I get a
> one-click sensible layout without fiddling with three separate menus.

> **US-05** — As someone who sets a preference and expects the menu to tell the
> truth, I want the **active choice on each axis (and the active preset) marked** in
> the dropdown, read **live from the config** — so the menu never lies about my
> current setting.

> **US-06** — As someone who trusts this tool because it's honest, I want **every
> honesty state and each host's identity to survive the denser surface** — all five
> states and per-host identity legible in a compact icon and in side-by-side /
> alternating layout, carried by color plus a marker even without full text — and an
> **offline *selected* host still shown/marked** in the glyph it was selected for,
> never a fabricated zero.

> **US-07** — As someone who monitors everything but glances at a subset, I want host
> selection to be a **view filter on the glyph only** — polling still covers the full
> `hosts.conf` set, the dropdown still shows every monitored host with its full
> per-tool picture — so choosing what the glance shows never stops a machine being
> watched.

> **US-08** — As the owner of a serve-only tailnet tool, I want display preferences
> to be a **local config write in the badge process** (like Add/Remove host), never
> a new HTTP endpoint — so the dashboard stays read-only (405 for non-GET/HEAD) and
> no new attack surface appears.

> **US-09** — As a single-machine user, I want an **unconfigured badge to behave
> exactly as it does today** — most-constrained, single, wide, byte-for-byte — so
> this feature costs me nothing until I choose to shape the glance.

---

## Functional Requirements

### The three display axes (the config schema)

> **FR-01 — Three independent display axes, each an enumerable value in the local
> config.** The app shall model badge display as **three independent axes**, each
> persisted as a value in the local config the badge already reads:
> - **hosts** — `all` (default) | a list of one or more host keys (the sanitized
>   `host:port` identities the badge already uses, e.g. from `remotesFromCombined`);
>   the local host is addressable by a stable sentinel key.
> - **layout** — `single` (default) | `side-by-side` | `alternating`.
> - **density** — `wide` (default) | `compact`.
> The three axes compose **independently** (any hosts × any layout × any density).
> The default of every axis (`all` / `single` / `wide`) reproduces today's badge.

> **FR-02 — The default of every axis reproduces today's badge, byte-for-byte.**
> When the config sets **no** display preferences (all axes at their default, or the
> directives/prefs absent), the badge shall render **byte-for-byte** as it does today:
> the single most-constrained host, `single` layout, `wide` density — the shipped
> single-host and multi-host glyph and dropdown, unchanged. This extends the shipped
> "byte-for-byte when unconfigured" guard from "single host" to "**glyph unchanged
> when no display config is set**," across single-host *and* multi-host modes.

> **FR-03 [CFG] — Display preferences persist in the local config the badge reads.**
> The app shall persist the three axes in the **local config under the data dir**
> that the badge already reads on the render tick. **Default:** new `!`-directives in
> `hosts.conf` (`!display-hosts=`, `!display-layout=`, `!display-density=`), parsed by
> `src/host-config.js` alongside the existing `!local=` directive (the `!local=`
> precedent — one file, one parser, one place to hand-edit). **Fallback:** a small
> sibling prefs file under the data dir, **if** the Architect finds a directive line
> too thin to hold the host-subset selection cleanly (a subset is a list, which a
> single directive line holds less comfortably than `!local=`'s single enum). The
> Architect confirms the location and the directive/field shape at Stage 3. Either
> way the value is read on the render tick, written atomically (temp+rename, `0o600`),
> and outside any git checkout. *(Tagged **[CFG]**; see Open Questions OQ-02.)*

> **FR-04 — A malformed or unknown display value degrades honestly to the default,
> logged once.** An invalid or unknown value for any display directive/field (an
> unrecognized layout, a `hosts` list naming a key not in `hosts.conf`, a malformed
> directive line) shall **not crash the badge**: the app shall fall back to that
> axis's **default**, **log the failure once** (not every render tick, mirroring
> `host-config.js`'s once-latch), and surface it in the startup/health readout. An
> unknown `!display-*` directive is an honest error (surfaced), never silently
> reinterpreted. A `hosts` list that, after dropping unknown keys, is empty shall
> fall back to `all` (never an empty glyph).

### Named presets (the friendly front)

> **FR-05 — A small set of named presets maps to axis combinations.** The Display
> submenu shall offer a **small set of named presets**, each mapping to a specific
> `{hosts, layout, density}` combination. Selecting a preset **sets the three axes**
> to that combination (a write to the same config as the raw axes). The presets are
> the glance-friendly surface; **the axes are the truth in the config file.** The two
> forms the user named — **single compact icon** (`single` + `compact`) and **compact
> icons side-by-side** (`side-by-side` + `compact`) — shall each be reachable as a
> preset. The exact preset list and names are the **Designer's** within this model;
> the shipped set shall include at least: "Most-constrained · wide" (today's default),
> a single-compact-icon preset, a compact-side-by-side preset, and a rotate/alternating
> preset. *(The preset list + naming are flagged for user ratification at Designer,
> see Open Questions.)*

> **FR-06 — The axes remain individually adjustable after a preset is chosen.**
> Selecting a preset shall **not** lock the axes. The individual axis choices shall
> remain adjustable underneath, so a preset is a starting point, not a mode. Adjusting
> one axis after selecting a preset shall change only that axis (the other two keep
> the preset's values) and update the config accordingly.

### The Display submenu (the config surface)

> **FR-07 — A "Display" submenu of enumerable choices in the badge dropdown.** The
> badge dropdown shall carry a **"Display" submenu** exposing, per axis, the
> enumerable set of choices (FR-01) plus the presets (FR-05). It shall be present in
> **both** single-host and multi-host dropdown modes, delivered via the **shared
> action-lines path** (the pattern `actionClusterLines` / `hostConfigActionLines`
> already use to appear in both `dropdownLines` and `multiDropdownLines`). The
> host-selection choices shall enumerate the **currently monitored** hosts (from the
> combined view the badge already fetched — no second data path), plus an "All hosts"
> choice.

> **FR-08 — Each choice is a SwiftBar action writing the value directly — no
> `osascript` text dialog.** Each Display choice shall be a **SwiftBar action** that
> shells to a **tracked helper under `$ABS_NODE`** which writes the chosen value
> **directly** to the config (atomic write). Because the inputs are **enumerable menu
> choices** (not typed text), the actions set the value directly — **no `osascript`
> text-entry dialog** is used (simpler than the Add-host dialog, which needs typed
> input). The helper shall be **tracked** (a new `scripts/menubar/display-action.mjs`,
> **or** an extension of an existing helper — the Architect/Engineer decide),
> delivered by the same wrapper/absolute-node model as the shipped helpers, with the
> same atomic-write + serve-only posture. The write is **local**; **no HTTP mutation**.

> **FR-09 — The active choice on each axis (and the active preset) is marked, read
> live.** For each axis and for the presets, the Display submenu shall **mark the
> active choice** (a checkmark / dot / equivalent SwiftBar marker) read **live from
> the config** at render time — so the menu never lies about the current setting. A
> preset shall read as active only when the config's three axes **exactly match** its
> combination; when the axes have drifted from any named preset, no preset is marked
> active (the axes still each show their own active mark). The exact marker glyph is
> the Designer's; the observable requirement is that the current setting is
> identifiable from the submenu.

> **FR-10 — After a Display write, the badge refreshes and the change is reflected.**
> After any Display config write, the badge shall **refresh** (SwiftBar
> `refresh=true`) so the glyph and the Display submenu markers reflect the new setting
> on the next render — no restart. The write applies to **presentation only**; it
> triggers no poller reconfiguration and no change to the monitored set.

### Host selection is a VIEW FILTER, not a monitoring change (hard split)

> **FR-11 — Host-display-selection filters ONLY the glyph.** The `hosts` axis shall
> select which monitored hosts appear **in the glyph** and the glyph-driving binding
> computation. It shall **not** change which hosts are polled: the poller shall
> continue to poll the **full `hosts.conf` set** every tick, unchanged. This is a
> presentation filter over the already-fetched `hostViews`, applied in the badge
> render, never a change to the host list the poller reads.

> **FR-12 — The dropdown still renders every monitored host, in full.** Regardless of
> the `hosts` display selection, the badge dropdown shall continue to render **one
> section per monitored host** with its **full per-tool picture** (the shipped
> `hostSectionLines` output) — the dropdown is the **full picture**; the glyph is the
> **filtered view**. A host excluded from the glyph by the display selection shall
> still appear, in full, in the dropdown.

> **FR-13 — A selected host that goes offline is still shown/marked in the glyph,
> never dropped.** A host the user selected for the glyph that becomes offline /
> unreachable / no-reading shall **still be represented in the glyph** for the layout
> it was selected for — shown with its offline/no-reading state (via color + a marker,
> per FR-16), **never silently dropped** from the selection and **never a fabricated
> zero**. (An unselected host that goes offline is a dropdown-section concern only,
> per the shipped per-host offline handling.)

### Honesty on the denser surface (compact + multi)

> **FR-14 — The compact density renders an icon+number glyph carrying all five honesty
> states.** The `compact` density shall render a **shorter glyph** (dropping the host
> name and/or tool letter to shrink width) that still distinguishes **all five honesty
> states** (fresh / aging / stale / no-reading / offline). The compact glyph shall
> stay **xbar-safe**: honesty carried by **text/emoji + `color=`** (the shipped floor
> — a colored dot/emoji + number), with an `sfimage=` SF Symbol permitted only as
> **SwiftBar-only polish on top of** that floor, never as the sole carrier of a state.
> The exact compact look is the **Designer's** (SPIKE-01 [RENDER] proves a viable
> rendering); the **observable requirement** is that all five states are
> distinguishable in a monochrome/xbar-safe compact glyph.

> **FR-15 — Side-by-side and alternating layouts preserve per-host identity and the
> five states.** In `side-by-side` (multiple selected hosts' glyphs composed in one
> menu-bar item) and `alternating` (cycling through the selected hosts in place), each
> shown host shall remain **identifiable** (a host cue / marker) and shall carry its
> **own honesty state** — one host's aging/stale/offline state shall **not** flag or
> suppress another's (the shipped per-window/per-host independence, extended to the
> multi-host glyph). Each maxed window reads "limit reached" and binds **per host**.

> **FR-16 — The legibility floor: all five states distinguishable, per-host identity
> legible, with color + a marker even without full text.** Across compact density and
> side-by-side / alternating layout, the honesty floor shall be: **all five states
> distinguishable** and **per-host identity legible** using **color plus a marker**,
> without depending on full host-name/tool-letter text and without depending on a
> SwiftBar-only param. An **offline selected host** shall be shown with an offline
> marker (never a number, never a zero); a **no-reading** host shall show the
> no-reading marker (a dash, never a number). The Designer refines the exact look; the
> requirement — five states distinguishable, per-host identity legible — is **testable**
> against the emitted glyph string. *(Depends on SPIKE-01 [RENDER] for the proven
> compact rendering.)*

### Bounds and graceful reduction

> **FR-17 — Side-by-side is width-bounded with honest overflow.** The `side-by-side`
> layout shall **cap** how many hosts it composes into one menu-bar item before the
> item grows unwieldy. When the selected set exceeds the cap, the badge shall reduce
> **honestly** — the default treatment is to render up to **N** hosts then a **"+M
> more"** affordance (the exact N and the treatment — "+M more" vs. fall back to
> most-constrained — are the **Designer's** within this bound; **pin a sane default
> cap**, e.g. N = 3–4). The cap shall never produce a silently-truncated set that
> looks complete.

> **FR-18 — Alternating cycles the selected set; the cycle is bounded.** The
> `alternating` layout shall cycle through **the selected hosts** in place (via the
> mechanism SPIKE-01 [RENDER] settles — SwiftBar's multi-title-line cycling if it
> exists, else the named per-tick rotation fallback). The cycle set is the selected
> hosts, bounded by the same sane cap as side-by-side so an unwieldy selection never
> cycles a runaway list. *(Depends on SPIKE-01 [RENDER].)*

> **FR-19 — Degenerate combinations reduce sensibly.** Degenerate axis combinations
> shall reduce without breaking the glyph:
> - `side-by-side` or `alternating` of a **single effective host** (one selected, or
>   only one monitored) reduces to the **single** glyph; `compact` still applies.
> - `single` layout with `compact` density is the **single compact icon** (a named
>   preset form, FR-05).
> - A `hosts` selection that resolves to zero hosts (all keys unknown/removed) falls
>   back to `all` (FR-04) — never an empty glyph.
> - Any unconfigured / default combination is today's badge (FR-02).

### Disclosure

> **FR-20 — The display-preference surface is disclosed in the README and the startup
> health line.** Per the "surface configuration defaults, never silently" convention,
> the app shall document the display-preference config surface — the directives (or
> sibling prefs file, per [CFG]) and the Display submenu — in the **README**, and
> shall name the current display setting (or "default / unconfigured") in the
> **startup health readout** (`src/health.js`, alongside the existing `hosts.conf`
> disclosure line). A malformed/unknown display value (FR-04) is surfaced there with
> the fix — a cheap fs check, off the request path.

---

## Non-Functional Requirements

> **NFR-01 — Honesty (product-core, non-negotiable).** No display combination shall
> break the honesty grammar. The badge shall never present a stale/aging reading as
> fresh, never fabricate a number (or a zero) for a host with no reading or that is
> offline (FR-13, FR-16), and shall keep all five honesty states and per-host identity
> legible on the compact and multi-host surfaces (FR-14–FR-16). Density and layout
> change **presentation**, never **truth**.

> **NFR-02 — HTTP surface stays read-only (serve-only / 405).** No new HTTP write or
> config-mutation endpoint shall be introduced. Display-preference edits happen **only**
> via the local config the badge writes on the same machine. All HTTP responses shall
> keep the baseline security headers (`nosniff`, CSP `default-src 'self'` / `style-src
> 'unsafe-inline'` / `script-src 'self'`, `Referrer-Policy`), reject non-GET/HEAD with
> **405** (`allow: GET, HEAD`), and serve static assets `no-store`. The `0.0.0.0`
> tailnet bind gains **no** write surface.

> **NFR-03 — The `/api/hosts` and `/api/state` contracts are untouched — no new data.**
> This feature is a **presentation change over `computeMultiBadge`'s existing per-host
> `hostViews`**. It shall introduce **no** new field on `/api/hosts` or `/api/state`
> and change **no** existing field; the shipped contract-guard tests
> (`state-unchanged.test.js` and the `/api/hosts` contract guard) shall stay green. If
> the feature appears to need a contract field, **that is a flag to raise, not a silent
> coupling.**

> **NFR-04 — Security · local-write + enumerable-input posture (for the Auditor).**
> - **No typed input, no injection surface.** Display choices are **enumerable menu
>   values** written directly — there is **no `osascript` text dialog** and no
>   free-form typed value on this path. The written values are constrained to the
>   enumerable axis vocabularies (an unknown value degrades to default, FR-04), and
>   any host key on the `hosts` axis is a **sanitized `host:port` identity** the badge
>   already produces, never a free-form string.
> - **Local, atomic, user-owned write.** The display config is written **atomically**
>   (temp + rename, `0o600`, no partial file) by the **user-owned badge process on the
>   same machine** — no network write, no privileged path, under the data dir (the
>   `host-config.js` write discipline reused).
> - **Every rendered value escaped.** Any label/marker text placed on a SwiftBar line
>   passes through the badge's `sanitize()` (strip `|`, `\r`, `\n`); host/port on any
>   `href=`/URL surface passes through `sanitizeHostPort`. Style/marker values stay
>   literals or coerced numbers.

> **NFR-05 — Zero runtime dependencies / no build / Node 24+ / macOS-native.** The
> display-config read/write, the Display submenu, and the glyph rendering shall use
> **Node builtins only** (`node:fs`, `node:http`, `node:child_process`) plus the
> SwiftBar host — **no** npm runtime dependency, **no** build step. `package.json`
> runtime dependencies stay at **zero**. Any SF Symbol polish uses SwiftBar's native
> `sfimage=` (no asset toolchain).

> **NFR-06 — Request-path isolation preserved.** The display-config read happens on
> the **badge render tick** (in the badge process), never on the HTTP request path;
> the write happens in the **badge process** (out of the server). `/api/hosts` stays a
> pure cache read; the poller reads the **full** host set unchanged (FR-11). The server
> request path gains no new work.

> **NFR-07 — Delivery model preserved.** Any new display-edit helper (or extension)
> shall live in the **tracked** plugin/scripts, delivered by the shipped **marker-gated
> wrapper + absolute-node** model (the tracked source is never rewritten; `git pull` /
> installer re-run stays clean; removal reverses symmetrically). SwiftBar stays a
> **disclosed user prerequisite**, never auto-installed.

---

## Out of Scope

- **Any change to which hosts are monitored, polled, or shown in the dropdown.** Host
  *selection* here filters the **glyph only** (FR-11/FR-12). Adding/removing monitored
  hosts stays the existing Add/Remove flow (multi-host-badge). The poller reads the
  full `hosts.conf` set unchanged.
- **Any change to `/api/state` or `/api/hosts`, or a new HTTP endpoint** (NFR-02,
  NFR-03). The badge stays a pure consumer; preferences are a local config write. A
  contract field need is a flag, not a silent coupling.
- **A settings screen on the dashboard web UI.** The configuration surface is the badge
  dropdown (and hand-editing the config), consistent with how hosts, the service
  toggle, and uninstall are managed. A web settings page is a larger, separate surface.
- **New honesty states, new color semantics, or new data.** This feature re-lays-out
  existing readings; it invents no new meter, cue, or state. The five states and the
  C/X cue are reused, not extended.
- **Per-tool display filtering** (e.g. "show only Claude, hide Codex" in the glyph). The
  axes here are host / layout / density; a tool-selection axis is a possible future
  addition, not this feature.
- **The tmux/terminal statusline emitter** (a separate roadmap item) — though it would
  likely reuse whatever display-preference model this feature establishes.
- **A typed-text config path for display choices.** Display inputs are enumerable menu
  values written directly; there is deliberately **no** `osascript` text-entry dialog
  on this path (that is the Add-host flow's mechanism, not this one).

---

## Open Questions

> **SPIKE-01 [RENDER] — The SwiftBar cycling + compact-rendering mechanism (Stage-3,
> for the Architect).** Two mechanics are load-bearing and shall be confirmed before
> the layout/density treatments are finalized:
> **(a) Does SwiftBar auto-cycle multiple pre-`---` title lines?** — the likely native
> mechanism for `alternating` "in place" (a single pre-`---` line is one menu-bar item;
> `side-by-side` is one line concatenating several hosts' compact glyphs).
> **(b) What compact rendering holds all five honesty states while staying xbar-safe?**
> — an `sfimage=` SF Symbol (SwiftBar-only polish) vs. a text-glyph floor (colored dot
> + number), given the xbar-safe floor requirement (FR-14).
> - **Success signal:** (a) **captured SwiftBar behavior** — a scratch plugin emitting
>   multiple pre-`---` lines, recorded as to whether SwiftBar rotates them
>   automatically and at what cadence; and (b) a **compact-glyph rendering proven to
>   distinguish all five states** (fresh / aging / stale / no-reading / offline) in a
>   **monochrome / xbar-safe floor** (color + text/emoji marker), with the SF-Symbol
>   variant noted as optional polish on top.
> - **Evidence:** recorded in a `spike-report.md` (the house discipline) — the observed
>   SwiftBar cycling behavior, and the compact-glyph samples for all five states shown
>   distinguishable without a SwiftBar-only param.
> - **Budget:** a focused Stage-3 spike (a few hours), against a scratch SwiftBar plugin
>   — no live tailnet peer needed.
> - **Fallback (a) — SwiftBar does NOT auto-cycle multiple title lines:** `alternating`
>   is driven by a **per-tick rotation in the plugin itself**. The badge re-runs every
>   5s (the `llmdash.5s.js` interval); the plugin can **rotate which selected host it
>   shows across ticks** (a rotation index derived from the tick/clock over the selected
>   set), so "alternating" is the plugin cycling one host per render rather than SwiftBar
>   cycling lines within one render. Name this the **per-tick rotation fallback**;
>   it ships the alternating option regardless of SwiftBar's title-line behavior.
> - **Fallback (b) — no xbar-safe compact rendering distinguishes all five states:**
>   compact reduces to the **most legible xbar-safe subset** that still never lies
>   (e.g. keep the number + a colored state marker; if a state can't be shown compactly,
>   that host's glyph **falls back to wide** for that state rather than dropping the
>   distinction) — honesty is never traded for compactness.
> - **Default assumption pending the spike:** proceed as if SwiftBar cycles multiple
>   pre-`---` title lines (the primary `alternating` path) and a colored-dot + number
>   text floor distinguishes the five compact states; the Architect confirms at Stage 3
>   and adopts the named fallback(s) if the spike refutes either.
> **Requirements depending on this spike:** FR-14, FR-15, FR-16, FR-18 (tagged
> **[RENDER]** where the mechanism is load-bearing).

> **OQ-02 [CFG] — Config location + directive/field shape (FR-03).** **Default
> assumption:** new `!display-hosts=` / `!display-layout=` / `!display-density=`
> directives in `hosts.conf`, parsed by `src/host-config.js` alongside `!local=` (one
> file, one parser, one hand-edit surface — the `!local=` precedent). **Fallback:** a
> small sibling prefs file under the data dir **if** the host-subset selection (a list)
> needs richer structure than a single directive line comfortably holds. The Architect
> confirms the location and shape at Stage 3; either way the value is read on the render
> tick, written atomically, and documented (FR-20). *(Tagged **[CFG]**.)*

> **OQ-03 — The preset list, preset naming, and the axis-vs-preset framing.** **Default
> assumption:** the shipped set includes at least "Most-constrained · wide" (today), a
> single-compact-icon preset, a compact-side-by-side preset, and a rotate/alternating
> preset; the axes stay individually adjustable underneath (FR-05/FR-06). The exact set,
> names, and submenu shape are the **Designer's**, and **the preset list + the
> axis-vs-preset framing are flagged for the user to ratify at the Designer stage** (a
> visual/UX call).

> **OQ-04 — The exact compact glyph look and how each honesty state reads compact.**
> **Default assumption:** color + a marker (colored dot/emoji + number) distinguishes
> all five states in the compact glyph, with the wide grammar's markers miniaturized
> (the `·` aging marker, the `⚠` stale marker, the `—` no-reading dash, the offline
> treatment). The **Designer owns the exact compact look and per-state reading**, within
> the FR-16 legibility floor; **flagged for user ratification at the Designer stage.**

> **OQ-05 — The side-by-side cap value and the overflow treatment.** **Default
> assumption:** a sane default cap (N ≈ 3–4 hosts) with a **"+M more"** affordance when
> the selection exceeds it (FR-17); the exact N and the treatment ("+M more" vs. fall
> back to most-constrained) are the **Designer's** within the bound. The cap shall never
> present a truncated set as complete.

> **OQ-06 — The host-selection sentinel key for the local host.** **Default
> assumption:** the `hosts` axis addresses the local host by a **stable sentinel key**
> (e.g. the `local:<port>` identity the host-config layer already uses), so "select the
> local host for the glyph" is expressible even on a monitoring station. The Architect
> confirms the exact key at Stage 3; it shall be a sanitized identity, never a free-form
> string (NFR-04).

---

## Success Metrics

Every functional requirement maps to at least one QA check. **[RENDER]** rows are
verified against whichever mechanism SPIKE-01 settles on (the primary SwiftBar
title-line cycling / xbar-safe compact floor, or the named per-tick rotation /
wide-fallback); the **presentation outcome** (which hosts, which layout, which
density, honesty preserved) is verified regardless. **[CFG]** rows are verified
against whichever config location Stage 3 settles on; the **read/write outcome** is
verified regardless. Logic is exercised by pure/injectable tests over `/api/hosts`
fixtures and a scratch config file — no live tailnet peer or real menu bar needed
for the Stage-6 logic checks (the live in-menu-bar render and any SF-Symbol polish
are deploy-time captures, per the badge's shipped deferral).

| ID | What's Being Verified | Pass Condition |
|---|---|---|
| QA-01 | Three independent axes in the config (FR-01) | The config models `hosts` (`all` \| a list of host keys), `layout` (`single`\|`side-by-side`\|`alternating`), and `density` (`wide`\|`compact`) as three independent values; any combination is expressible; the defaults are `all`/`single`/`wide`. |
| QA-02 | Unconfigured = today's badge, byte-for-byte (FR-02, NFR-01) | With no display config set (all axes default or directives absent), the emitted glyph + dropdown are byte-for-byte the shipped badge in **both** single-host and multi-host modes. The "byte-for-byte when unconfigured" guard now covers "glyph unchanged when no display config set." |
| QA-03 | Preferences persist in the local config (FR-03) [CFG] | The three axes are read on the render tick from the local config under the data dir (directives in `hosts.conf` per the default, or the sibling prefs file per the fallback) and are written atomically (temp+rename, `0o600`), outside any checkout. |
| QA-04 | Malformed/unknown display value degrades honestly (FR-04) | An unrecognized layout/density, an unknown `!display-*` directive, or a `hosts` list with only unknown keys falls back to the axis default (or `all` for an empty host set), logs once (not every tick), surfaces in health, and never crashes the badge. |
| QA-05 | Presets map to axis combos; the two named forms exist (FR-05) | Selecting a preset writes the three axes to its `{hosts,layout,density}` combination; the shipped set includes "Most-constrained · wide", a single-compact-icon preset (`single`+`compact`), a compact-side-by-side preset (`side-by-side`+`compact`), and a rotate/alternating preset. |
| QA-06 | Axes stay adjustable after a preset (FR-06) | After selecting a preset, changing one axis updates only that axis in the config (the other two keep the preset's values); a preset is a starting point, not a lock. |
| QA-07 | Display submenu present in both modes, enumerable (FR-07) | A "Display" submenu appears in single-host **and** multi-host dropdowns (via the shared action-lines path) with per-axis enumerable choices + the presets; the host-selection choices enumerate the currently monitored hosts plus "All hosts". |
| QA-08 | Each choice writes directly, no text dialog, local-only (FR-08, NFR-02, NFR-04) | Each Display choice is a SwiftBar action shelling a tracked helper under `$ABS_NODE` that writes the value directly (no `osascript` text dialog); the write is atomic, local, user-owned; no HTTP mutation; serve-only/405 preserved. |
| QA-09 | Active choice + active preset marked, read live (FR-09) | Each axis's active value and the active preset are marked in the submenu, read live from the config; a preset reads active only when all three axes match its combo; drifted axes show no active preset but each axis still marks its own value. |
| QA-10 | Post-write refresh, presentation-only (FR-10) | After a Display write, the badge refreshes (`refresh=true`) and the glyph + submenu markers reflect the new setting on the next render — no restart, no poller reconfiguration, no change to the monitored set. |
| QA-11 | Host selection filters ONLY the glyph (FR-11, US-07) | With a `hosts` subset selected, the poller still polls the full `hosts.conf` set every tick (unchanged); the selection is a presentation filter over `hostViews` in the badge render, never a change to the poller's host list. |
| QA-12 | Dropdown still shows every monitored host in full (FR-12) | Regardless of the `hosts` display selection, the dropdown renders one full per-tool section per monitored host; a host excluded from the glyph still appears, in full, in the dropdown. |
| QA-13 | Selected offline host still shown/marked in the glyph (FR-13, NFR-01) | A selected host that goes offline/unreachable/no-reading is still represented in the glyph for its layout, marked with its offline/no-reading state (color + marker), never a fabricated zero and never silently dropped from the selection. |
| QA-14 | Compact glyph distinguishes all five states, xbar-safe (FR-14) [RENDER] | The compact density emits a shorter glyph distinguishing all five honesty states via text/emoji + `color=` (the xbar-safe floor); any `sfimage=` SF Symbol is only additive polish, never the sole state carrier. (Verified against the SPIKE-01 rendering / fallback.) |
| QA-15 | Side-by-side / alternating preserve per-host identity + states (FR-15) [RENDER] | In side-by-side and alternating, each shown host is identifiable (host cue/marker) and carries its own honesty state; one host's aging/stale/offline does not flag or suppress another's; a maxed window binds per host. |
| QA-16 | The legibility floor is testable on the emitted glyph (FR-16, NFR-01) [RENDER] | On the emitted glyph string, all five states are distinguishable and per-host identity is legible using color + a marker, without full text and without a SwiftBar-only param; an offline selected host shows an offline marker (no number), a no-reading host shows a dash (no number). |
| QA-17 | Side-by-side is width-bounded with honest overflow (FR-17) | Side-by-side caps at the default N hosts; a selection exceeding N reduces honestly ("+M more" or the ratified treatment), never presenting a truncated set as complete. |
| QA-18 | Alternating cycles the selected set, bounded (FR-18) [RENDER] | Alternating cycles the selected hosts via the SPIKE-01 mechanism (SwiftBar title-line cycling or the per-tick rotation fallback), bounded by the same cap; the cycle set is exactly the selected hosts. |
| QA-19 | Degenerate combos reduce sensibly (FR-19) | Side-by-side/alternating of one effective host reduces to the single glyph (compact still applies); single+compact is the single compact icon; a zero-host selection falls back to `all`; unconfigured is today's badge — none break the glyph. |
| QA-20 | Disclosure (FR-20) | The README documents the display-preference config surface (directives / prefs file + the Display submenu); the startup health readout names the current display setting (or "default/unconfigured") alongside the `hosts.conf` line and surfaces a malformed/unknown value with the fix — a cheap fs check, off the request path. |
| QA-21 | Contracts untouched, no new data (NFR-03) | The shipped `state-unchanged.test.js` and the `/api/hosts` contract guard stay green; no `/api/state` or `/api/hosts` field is added or changed; the feature reads only `computeMultiBadge`'s existing `hostViews`. |
| QA-22 | HTTP stays read-only / 405 (NFR-02) | No new HTTP write/mutation endpoint exists; all responses carry the baseline headers, reject non-GET/HEAD with 405 (`allow: GET, HEAD`), static assets stay `no-store`; the `0.0.0.0` bind gains no write surface. |
| QA-23 | Local-write + enumerable-input security posture (NFR-04) | Display values are enumerable (unknown → default); host keys on the `hosts` axis are sanitized `host:port` identities, never free-form; the write is atomic/local/user-owned (no partial file, no network write); every rendered marker/label passes `sanitize()` / `sanitizeHostPort`; no typed value and no injection sink on this path. |
| QA-24 | Zero deps / no build / macOS-native (NFR-05) | `package.json` runtime dependencies remain zero; no build step is added; the display config read/write, submenu, and glyph use Node builtins (`node:fs`/`node:http`/`node:child_process`) + SwiftBar (`sfimage=` native) only. |
| QA-25 | Request-path isolation preserved (NFR-06) | The display-config read is on the badge render tick; the write is in the badge process (out of the server); `/api/hosts` stays a pure cache read; the poller reads the full host set unchanged; the server request path gains no new work. |
| QA-26 | Delivery model preserved (NFR-07) | Any new display-edit helper (or extension) lives in the tracked plugin/scripts, delivered by the marker-gated wrapper/absolute-node model (tracked source not rewritten; `git pull`/re-run stays clean; removal reverses symmetrically); SwiftBar stays a disclosed prerequisite, never auto-installed. |
