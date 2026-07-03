# Design Spec — Badge Display Options

**Feature:** badge-display-options
**Stage:** 4 — The Designer
**Status:** **DRAFT · pre-iteration.** First direction for the user to react to. The
five flagged calls (compact markers, preset list/names, side-by-side cap, active
marker, Display icon) are the Designer's within the proven mechanics and are flagged
for user ratification below.
**Host:** SwiftBar (documented default); xbar is best-effort (the whole glyph grammar
holds on xbar — nothing depends on a SwiftBar-only param).
**Mockup:** `pipeline/badge-display-options/design.html`
**Extends:** `pipeline/multi-host-badge/design-spec.md` (the shipped multi-host badge)
and `pipeline/menubar-service-controls/design-spec.md` (the dropdown action cluster) —
this spec adds the three display axes, the compact glyph grammar, and the Display
submenu, reusing everything else verbatim.
**Grounded in:** `schema.md` (the applyDisplay layering, the directives, the cap, the
shared action-lines path) and `spike-report.md` (SPIKE-01 — the proven compact-state
stdout, the stateless rotation, the grow-prefix cue, the one-color-per-line finding).

---

## Visual Direction

Within the established design system, the badge gains display axes — **group (host |
tool) × hosts × layout × density** — set from a new **Display** submenu, plus a
**compact** glyph grammar that miniaturizes the shipped five-state honesty vocabulary
one step further, and a **neutral tool-mark pair** (`◆` Claude / `▲` Codex) that
upgrades the old `C`/`X` letters as the default tool cue. No new color semantics:
`--good`/`--warn`/`--crit` and the `·` aging / `⚠` stale / `—` no-reading markers are
reused. New glyphs: the two tool marks `◆`/`▲`, the compact offline `⊘` (the wide badge
uses a wordmark it has no room for), and the submenu's `✓` active marker. Real product
**logos** are an opt-in template-image on top of the neutral floor. A **Legend** submenu
reveals the full key on demand. With no display config set, the badge is **byte-for-byte
today's** — the default host/all/single/wide routes to the shipped emit path unchanged
(save the C/X→◆/▲ default cue swap, which the user ratified as the new default).

---

## Screens / Views

### 1. The glyph in each display mode

The same fleet throughout — **Studio** (Claude 5-hour 12%, crit, binding), **Laptop**
(Codex 88%, aging), **Desktop** (Codex 63%, fresh) — rendered four ways:

| Mode | Glyph | Notes |
|---|---|---|
| **Wide · single** (today) | `▪ Studio·C 12%` | Unchanged / default. The shipped wide grammar, byte-for-byte. |
| **Compact · single** | `▪ 12` | One cell: mark + number in its status color. No host name, no tool letter. |
| **Compact · side-by-side** | `▪ St12 La88· De63` | Up to 3 cells in one item, grow-prefix cue per cell, one line color = binding. |
| **Compact · side-by-side, capped** | `▪ St12 La88· De63 +2` | >3 selected → cap at 3, then `+M more`. Binding-first hides the least-constrained. |
| **Compact · alternating** | `▪ La88·` (this tick) | One machine per ~5s tick; rotates. The mockup shows 3 frames (`+0s`/`+5s`/`+10s`). |

**Key design decisions:**
- The `▪` mark leads the whole glyph **once** (stable identity), then the cell(s).
- The compact cell **drops the host name AND the tool letter** — the width win is the
  whole point of compact. In multi layouts a **grow-prefix host cue** (`St`/`La`/`De`)
  restores per-host identity; the tool mark is optional in per-host compact (the host cue
  identifies the unit) but **always shown in per-tool compact** (it *is* the unit's identity).
- Side-by-side is **one menu-bar line**. A SwiftBar line carries **one `color=`** for
  the whole run (SPIKE-01), so the line color tracks the **binding** unit and
  per-cell state rides the **marker** — never per-cell color (impossible in the grammar).
- Alternating is **one unit per tick**, so it sidesteps the one-color limit entirely
  (one cell → its own true color). Stateless: `floor(epochMs/5000) % count` — no cursor.

### 1b. The tool mark — neutral default, logos opt-in

The default tool cue upgrades from the `C`/`X` letters to two **neutral glyphs**: `◆`
(Claude) and `▲` (Codex). Chosen because they're **different silhouettes** (diamond vs.
triangle — not one shape re-filled), **solid** (reads better than an outline at menu-bar
size), and monochrome-legible. Used **everywhere the tool is named** — the wide per-host
cue (`▪ Studio·◆ 12%`), and the per-tool aggregate identity below. A gallery shows both
marks wide + compact, and the **opt-in logo** treatment (labeled stand-in shapes; the
Engineer supplies real assets). See the binding spec below.

### 1c. Group by tool — per-tool aggregates across the fleet

A new **Group** axis flips what the glyph counts: **Host** (today, each unit is a
machine) or **Tool** (each unit is a **per-tool aggregate** across the selected hosts).
"All Claude" = the tightest Claude window anywhere in the (selected) fleet; "all Codex" =
the tightest Codex. Layout + density apply identically to the two tool-units:

| Mode (grouped by tool) | Glyph | Notes |
|---|---|---|
| single · wide | `▪ ◆ 12%` | Most-constrained of {all-Claude, all-Codex}. No host cue — the unit is a tool. |
| single · compact | `▪ ◆12` | Same, compact. |
| side-by-side · wide | `▪ ◆ 12% ▲ 63%` | Both aggregates in one item, each its tightest, each its own status color. |
| side-by-side · compact | `▪ ◆12 ▲63` | The compact form the user named. Line color = binding aggregate. |
| alternating · compact | `▪ ◆12` (this tick) | Rotates the two aggregates, one per ~5s tick. A two-beat cycle. |
| aggregate no-reading | `▪ ◆12 ▲—` | A tool with no reading on any machine → dash, never a zero. |

The **Hosts axis still scopes the aggregate** — grouping by tool doesn't discard the host
selection; "all Claude" means tightest Claude across **the selected machines**.

### 2. The five honesty states, compact

A gallery showing each state as a compact cell so the user can judge legibility at a
glance. **This is the hard constraint (FR-16, NFR-01):** all five distinguishable by
marker + color, and **no-reading / offline carry no number**. A sixth card proves it
holds side-by-side (`▪ St12 La⚠88 De⊘` — three independent states, one line).

### 3. The Display submenu (both modes)

A new **🖥 Display** item in the shared action cluster (so it appears in single-host
AND multi-host dropdowns), opening onto (in order):
- **Presets** (the friendly front) — **six** named presets (four host + two tool), each
  with a tiny live glyph preview; the active one bolded with `✓` (active only when every
  axis matches it).
- **Group by** — single-choice (Host / Tool), active marked `✓`. The new top-level unit.
- **Hosts** — a **multi-select toggle** over the monitored machines + "All hosts"; each
  currently-selected machine marked `✓`. Scopes the glyph (and the aggregate when grouped
  by tool).
- **Layout** — single-choice (Single / Side-by-side / Alternating), active marked `✓`.
- **Density** — single-choice (Wide / Compact), active marked `✓`.
- **Tool marks** — single-choice (Neutral / Logos), active marked `✓`.

Shown in the mockup in three contexts: multi-host (all axes set to the side-by-side
preset), single-host (host axis lists the one machine + "All hosts"; side-by-side notes
it reduces to single), and **drifted** (axes no longer match any preset → no preset
marked, but each axis still marks its own value — the menu stays truthful).

### 4. The Legend (both modes)

A **🛈 Legend — what the marks mean** row in the shared action cluster reveals the full
key **on demand** as a SwiftBar **submenu** (native click-to-reveal, no plugin state).
The default dropdown stays clean; clicking Legend pops the complete key. It sits in the
"info / manage" band next to `☰ Watching`, above `⊘ Uninstall`. The key covers **every**
symbol the badge can show (see the Legend copy table below) — one short line each,
scannable, complete by design.

---

## The compact glyph grammar (the binding spec — implement verbatim)

A per-host **compact cell**. `state ∈ fresh | aging | stale | no-reading | offline`.
Colors are the design-system status tokens lifted for the dark bar (same hue family as
`--good`/`--warn`/`--crit`).

| State | Cell text | Marker | Color | Number? |
|---|---|---|---|---|
| **fresh** | `<pct>` | none (bare number) | status hue `BAR_COLOR[statusClass(pct)]` (`good #5bd88a` / `warn #f0a94b` / `crit #ff6b6b`) | yes |
| **aging** | `<pct>·` | trailing `·` | `#a0a0a0` (dim) | yes |
| **stale** | `⚠<pct>` | **leading** `⚠` | `#f0a94b` (amber) | yes |
| **no-reading** | `—` | `—` dash | `#9b9ea6` (muted) | **NO — dash only** |
| **offline** | `⊘` | `⊘` slash | `#8b8b8b` (grey) | **NO — slash only** |

- The **marker is the load-bearing carrier** — it reads in a monochrome bar even if
  color is stripped. Color reinforces, never carries alone (FR-16, NFR-01).
- **fresh vs. aging** are separated by the *absence* of a marker, not by color alone
  (46% fresh and 46% aging both sit in the warn band; the `·` is the distinction).
- **The never-a-number guard is structural:** the no-reading and offline cells have no
  code path that emits a digit (mirror the shipped `emit`/`emitMulti` structure). A
  selected offline machine is **shown with `⊘`, never dropped, never zeroed** (FR-13).
- `sfimage=` SF Symbols are **additive SwiftBar-only polish** on top of this text floor,
  never the sole carrier of a state — the floor must stand alone on xbar.

### The tool mark (the binding spec — implement verbatim)

The default tool cue is a **neutral glyph pair**, replacing the `C`/`X` letters:

| Tool | Neutral mark | Where |
|---|---|---|
| Claude | `◆` (filled diamond, U+25C6) | per-host cue (`▪ Studio·◆ 12%`) + per-tool aggregate identity |
| Codex | `▲` (filled triangle, U+25B2) | per-host cue (`▪ Laptop·▲ 88%`) + per-tool aggregate identity |

- **Rendered dim** (menu-bar-text-dim, ~0.9 opacity) — a locator like the old letter cue;
  the number still lands first. In a **per-tool aggregate** the mark **leads** the cell and
  is the cell's identity (always shown), not a secondary locator.
- **xbar-safe:** both are plain text glyphs + `color=`, monochrome-legible, and clearly
  different silhouettes (the failure mode to avoid is `◇`/`◆` — same shape, different fill —
  which blurs at menu-bar size). **C/X remains a valid fallback** if a glyph pair isn't
  clearly better (a ratification call — the user approved `◆`/`▲`).
- **The neutral glyph is the state marker's peer, never its replacement** — freshness/
  offline markers (`·`/`⚠`/`—`/`⊘`) still carry state; the tool mark carries *which tool*.
  The two never collide (tool mark leads/precedes the number; the aging `·` trails it).

**Logos (opt-in, off by default) — SwiftBar-only polish.** When **Tool marks: Logos** is
on, the neutral glyph is **replaced** by a small product logo as a **template-image**
(SwiftBar `image=` / `templateImage=` base64), ~**13px**, in the **tool-cue slot** (same
placement as the neutral glyph). The **neutral glyph is always the floor**: on xbar, or if
the image can't render, `◆`/`▲` still name the tool — a logo is never the sole carrier.
The Engineer supplies the assets; the mockup shows only the treatment/size/placement via
labeled stand-in shapes. **Fair-use posture:** opt-in, off by default, neutral floor always
present (flagged for the user + the Engineer/Architect re: the actual asset).

### The per-tool aggregate (grouped by tool — the binding spec)

When Group = Tool, each glyph unit is a **per-tool aggregate** over the selected hosts:

- **Number** = the **minimum remaining** of that tool's windows across the selected hosts
  (the tightest — the same "binding" min the badge already computes, scoped to one tool).
- **State** = the **tightest contributing window's** freshness state (fresh / aging /
  stale). Rendered with the same compact cell grammar (`◆12`, `◆46·`, `◆⚠12`).
- **No reading on any selected host for that tool** → the aggregate is `—` (no-reading),
  **never a fabricated zero** (`▪ ◆12 ▲—`).
- **Every contributing host offline** → the aggregate reads offline `⊘`.
- **Independence:** one tool aggregate's state never flags the other's — same per-unit
  independence as the per-host glyph. In side-by-side the line's one `color=` tracks the
  **binding aggregate** (the tighter of Claude/Codex); alternating gives each its own color.
- **Two units only**, so alternating is a two-beat cycle and side-by-side never needs the
  cap (there is no `+M more` in tool mode).

### Composition per layout

| Layout · density | Glyph | Rule |
|---|---|---|
| single · compact | `▪ 12` | Binding machine only, one cell. Line color = the cell's. |
| side-by-side · compact | `▪ St12 La88· De63` | ≤3 cells, binding-first, grow-prefix cue tight against each number. **One `color=` = binding cell's**; per-cell state on the marker. Cells separated by a single space. |
| side-by-side · capped | `▪ St12 La88· De63 +2` | Cap **N=3**, then ` +M` where `M = shown − 3`. Binding-first hides the least-constrained; never a truncated set that looks complete (FR-17). |
| alternating · compact | `▪ La88·` (this tick) | One machine per tick via `floor(epochMs / 5000) % count`; its own cell + own color. Stateless (SPIKE-01). Bounded by the same cap of 3. |
| single · wide (host) | `▪ Studio·◆ 12%` | **Today's badge** — save the ratified `C`→`◆` default tool-cue swap. host/all/single/wide → the shipped emit path (with the new default cue). |
| single · wide (tool) | `▪ ◆ 12%` | Grouped by tool: the most-constrained aggregate, no host cue. |
| side-by-side · compact (tool) | `▪ ◆12 ▲63` | The two tool aggregates; no cap (two units), line color = binding aggregate. |

### The grow-prefix host cue (multi layouts)

Per SPIKE-01: grow each shown label's prefix (1 → max 4 chars) until all **shown** cues
are distinct; on a persistent collision, append a positional suffix (`Mac`, `Mac2`,
`Mac3`). `sanitize()`-scrubbed, bounded. The cue rides **tight against its number**
(`St12`, not `St 12`) so a cell reads as one token. Wide-density multi keeps the shipped
`truncateHostCue` (≤10 + `…`) — the compact cue is the tighter grow-prefix form.

---

## The Display submenu structure (the layout spec)

A SwiftBar nested submenu (leading `--`), riding the **shared action-lines path**
(`actionClusterLines`), appended after the host-config lines so it appears in **both**
`dropdownLines` and `multiDropdownLines` (mirrors how the service controls were added).

```
🖥 Display                                      ▸
--Presets                          sets every axis at once   (dim header)
--  Most-constrained · wide                     ▪ St·◆ 12%   (preview)
--  Single compact icon                         ▪ 12
--✓ Compact icons side-by-side                  ▪ St12 La88·   (active: every axis matches)
--  Rotate hosts · compact                      ▪ St12 ↻
--  Claude vs Codex · side-by-side              ▪ ◆12 ▲63
--  Rotate Claude / Codex · compact             ▪ ◆12 ↻
-----
--Group by            what each unit is   (dim header)
--✓ Host (machine)
--  Tool (◆ Claude / ▲ Codex)
-----
--Hosts               which machines feed the glyph   (dim header)
--  All hosts
--✓ Studio                          100.64.0.7:8788
--✓ Laptop                          laptop:8787
--✓ Desktop                         100.64.0.9:8790
-----
--Layout
--  Single (most-constrained)
--✓ Side-by-side
--  Alternating
-----
--Density
--  Wide (text)
--✓ Compact (icon)
-----
--Tool marks          neutral floor · logos opt-in   (dim header)
--✓ Neutral (◆ / ▲)
--  Logos
```

**Active-marking (FR-09):**
- `✓` marks the active choice on **each axis** (group / hosts / layout / density / tool
  marks), read **live** from the config on this render. Inactive rows carry an **empty
  aligned slot** (same width) so labels line up — the macOS checkmark-menu convention.
- A **preset** is marked `✓` **only when every axis exactly matches** its combination.
  When the axes drift, **no preset is marked** but each axis still marks its own value —
  the menu never claims a preset you've moved away from.
- The active row is also **bolded** (belt-and-braces: the mark reads even if the ✓ glyph
  renders faintly on a given system).

**Single-choice vs. multi-select.** Group / Layout / Density / Tool marks are **radio**
(exactly one active). **Hosts** is **multi-select** (`!display-hosts` is a list): each
machine **toggles** in/out; "All hosts" is the sentinel that clears the list to `all`. A
toggle that empties the list writes `all` (never an empty selection → never an empty
glyph). Host choices enumerate the currently monitored machines from the combined view the
badge already fetched (`remotesFromCombined` + the local host + "All hosts") — no second
data path. **The Hosts axis stays meaningful when grouped by tool** — it scopes which
machines feed the aggregate.

**Presets → axes map (the shipped six — four host + two tool):**

| Preset | `{ group, hosts, layout, density }` |
|---|---|
| Most-constrained · wide (today) | `{ host, all, single, wide }` |
| Single compact icon | `{ host, all, single, compact }` |
| Compact icons side-by-side | `{ host, all, side-by-side, compact }` |
| Rotate hosts · compact | `{ host, all, alternating, compact }` |
| Claude vs Codex · side-by-side | `{ tool, all, side-by-side, compact }` |
| Rotate Claude / Codex · compact | `{ tool, all, alternating, compact }` |

(Tool marks — Neutral / Logos — is orthogonal to the presets: presets set the four layout
axes; the tool-mark choice persists across preset changes.)

Selecting a preset **writes the axes**; the axes stay **individually adjustable**
underneath (FR-06). A preset is a starting point, not a lock.

Every Display choice writes the local config directly (atomic temp+rename) via the
tracked helper under `$ABS_NODE` — **no `osascript` text dialog** (the values are
enumerable menu choices), **no HTTP mutation**. `refresh=true` re-renders so the glyph
and the `✓` marks update on the next render.

---

## How each of the five honesty states reads compact

- **fresh** — `▪ 46`, number in its status color, no marker. Confident.
- **aging** — `▪ 46·`, trailing `·`, whole cell dimmed grey. Older than `freshForMs`.
- **stale** — `▪ ⚠12`, **leading** `⚠`, amber. Older than `staleAfterMs`; the warning
  hits the eye before the value. *(Designer's call — the wide badge trails `⚠`; compact
  leads it so the flag registers first in the tighter space. Flagged to ratify.)*
- **no-reading** — `▪ —`, muted dash, **no number**. No reading captured yet.
- **offline** — `▪ ⊘`, offline-grey slash, **no number**. A **selected** offline machine
  shown with this marker in the glyph it was selected for — marked, never dropped (FR-13).

Side-by-side keeps each cell independent — one host's state never suppresses another's;
the line color tracks the binding machine, each cell's state rides its own marker.

---

## Copy / Symbol table — every new user-facing string and glyph

| String / glyph | When it appears | Reuse / new |
|---|---|---|
| `🖥 Display` | Submenu parent, both modes (trailing `▸`). | New row; matches the `▸`-submenu grammar of Remove host…/Uninstall…. |
| `Presets` | Submenu group header (dim). | New. |
| `Most-constrained · wide` | Preset — `all/single/wide` (today). | New. |
| `Single compact icon` | Preset — `all/single/compact`. | New (a form the user named). |
| `Compact icons side-by-side` | Preset — `host/all/side-by-side/compact`. | New (a form the user named). |
| `Rotate hosts · compact` | Preset — `host/all/alternating/compact`. | New. |
| `Claude vs Codex · side-by-side` | Preset — `tool/all/side-by-side/compact`. | New (tool group). |
| `Rotate Claude / Codex · compact` | Preset — `tool/all/alternating/compact`. | New (tool group). |
| `Group by` | Axis header; single-choice (Host / Tool). | New (top-level unit axis). |
| `Host (machine)` / `Tool (◆ Claude / ▲ Codex)` | Group choices. | New. |
| `Hosts` | Axis header; multi-select toggle. Scopes the glyph (and the aggregate in tool mode). | New. |
| `All hosts` | Hosts sentinel — clears to every machine (default). | New. |
| `Layout` | Axis header; single-choice. | New. |
| `Single (most-constrained)` / `Side-by-side` / `Alternating` | Layout choices. | New. |
| `Density` | Axis header; single-choice. | New. |
| `Wide (text)` / `Compact (icon)` | Density choices. | New. |
| `Tool marks` | Axis header; single-choice (Neutral / Logos). | New. |
| `Neutral (◆ / ▲)` / `Logos` | Tool-marks choices. Neutral = default floor; Logos = opt-in template-images. | New. |
| `✓` | Active-marker on each axis's active choice + the active preset; empty aligned slot when inactive. | New (submenu marker). |
| `🛈 Legend — what the marks mean` | Legend row (submenu), shared action cluster, both modes. | New row. |
| `Watching N machines · showing all N` / `· showing K in the glyph` | Dropdown scope line — honest about watched vs. shown-in-glyph. | Extends the shipped `Watching N machines` scope line. |
| `◆` (tool mark) | **Claude** default tool cue — replaces the old `C` letter. Per-host + per-tool. | **New glyph** (upgrades `C`). |
| `▲` (tool mark) | **Codex** default tool cue — replaces the old `X` letter. Per-host + per-tool. | **New glyph** (upgrades `X`). |
| `▪ <pct>` (marker: none) | Compact **fresh** cell. | Reuses the shipped fresh number + status color. |
| `▪ <pct>·` (marker: trailing `·`) | Compact **aging** cell. | Reuses the shipped aging `·`, miniaturized. |
| `▪ ⚠<pct>` (marker: leading `⚠`) | Compact **stale** cell. | Reuses the shipped `⚠`; leads in compact (flagged). |
| `▪ —` (dash, **no number**) | Compact **no-reading** cell. | Reuses the shipped `—`. |
| `▪ ⊘` (slash, **no number**) | Compact **offline** cell. | **New glyph** — the wide badge uses a wordmark with no room here. |
| `▪ ◆12 ▲63` | Tool-grouped side-by-side compact — the two aggregates. | New (composition). |
| `▪ ◆12 ▲—` | Tool aggregate no-reading — a tool with no reading anywhere → dash, no zero. | New (honesty). |
| `St` / `La` / `De` (grow-prefix cue) | Per-host cue in side-by-side / alternating. | New (the compact cue form; SPIKE-01). |
| ` +M` (e.g. `+2`) | Side-by-side overflow beyond the cap of 3 (host mode only; tool mode has two units). | New. |

### Legend copy table (the Engineer's exact strings — one line per symbol, complete)

The Legend submenu names **every** symbol the badge can show. Format: a menu-bar-styled
sample + a short gloss. (Sample rendered in the same glyph colors as the bar.)

| Section | Sample | Gloss |
|---|---|---|
| Freshness | `46` | **Live** — a fresh reading. |
| Freshness | `46·` | **Aging** — reading is getting old. |
| Freshness | `⚠12` | **Stale** — too old to trust; may have moved. |
| Freshness | `—` | **No reading** — no data yet (never a fake number). |
| Freshness | `⊘` | **Offline** — host unreachable (never a number). |
| Color | `good` (green) | 50%+ remaining — plenty of room. |
| Color | `warn` (amber) | 20–49% — getting tight. |
| Color | `crit` (red) | under 20% — nearly out. |
| Number | `12` | **% remaining** in the tightest tracked window (5-hour or weekly). Single view shows the binding host/tool. |
| Tool | `◆` | **Claude** — which tool this reading is. |
| Tool | `▲` | **Codex**. (Logos, if on, mean the same.) |
| Side-by-side | `St`12 | **Host cue** — short machine name (grown until unique). |
| Side-by-side | `+2` | **+M more** — hosts beyond the cap of 3 (least-tight hidden). |
| This menu | `✓` | **Active** — your current choice on each axis. |

**Legend mechanism: a submenu, not a toggle-expand.** SwiftBar submenus are the native
click-to-reveal and need **no plugin state** — a toggle-expand would need a `legendOpen`
marker written/read each render (more state to round-trip, a whole-dropdown re-render). The
submenu keeps the default dropdown clean, is instant, and works identically on xbar.

**Design-system extension: minimal.** No new tokens, no new color semantics. New glyphs:
the two tool marks `◆`/`▲` (upgrading `C`/`X`), the compact offline `⊘`, and the submenu
`✓`. Logos are an opt-in template-image (an asset, not a token). Everything else is the
shipped honesty vocabulary miniaturized and the shipped action grammar extended by the
Display + Legend rows.

---

## Component Usage — reuse vs. new chrome

| Element | Source | Reuse / new |
|---|---|---|
| Glyph five-state markers, colors, `▪` mark, `statusClass` thresholds | shipped badge | **Reused**, miniaturized to the compact cell. |
| Wide glyph (`▪ <host>·<C\|X> <pct>%`) | shipped multi-host badge | **Reused verbatim** (the wide/default path). |
| Dropdown chrome, host sections, per-tool rows, freshness/offline pills | shipped multi-host badge | **Reused verbatim** (the dropdown never filters). |
| `＋ / － / ☰ / ⊘` action grammar + submenu affordance | shipped service-controls | **Reused** — Display is a new row in that vocabulary. |
| `sanitize` / `sanitizeHostPort` / `fmtDur` / `ageBand` | shipped badge | **Reused verbatim.** |
| **Compact cell grammar** (marker + number, no host/tool text) | SPIKE-01 | **New** — proven xbar-safe floor for all five states. |
| **Neutral tool marks `◆` / `▲`** | — | **New glyphs** — upgrade the shipped `C`/`X` letters as the default tool cue. |
| **Opt-in logos** (`image=`/`templateImage=`) | — | **New** — SwiftBar-only polish over the neutral floor; off by default. |
| **Group (host/tool) axis + per-tool aggregate** | — | **New** — re-groups the glyph units; aggregate = tightest-window min + state, over `hostViews`. |
| **Compact offline `⊘`** | — | **New glyph** (wide badge has no compact offline form). |
| **Grow-prefix host cue** | SPIKE-01 | **New** — per-cell identity for side-by-side / alternating. |
| **`🖥 Display` submenu** (6 presets + group/hosts/layout/density/tool-marks, `✓` active-marked) | — | **New chrome** — a new sibling in the shared action-lines path. |
| **`🛈 Legend` submenu** (full key, on demand) | — | **New chrome** — a new sibling in the shared action-lines path; no plugin state. |
| **`✓` active marker + empty aligned slot** | — | **New** (macOS checkmark-menu convention). |
| **`+M more` overflow / stateless rotation** | schema.md / SPIKE-01 | **New** logic, presented in the glyph. |

---

## Interaction Notes (for the Engineer)

- The glyph is a static stdout line re-rendered each 5s interval — no live tick between
  runs. Alternating rotates **across** renders (stateless clock function), not within one.
- **The dropdown never filters and never re-groups.** Only the **glyph** uses the
  filtered/laid-out/grouped view; `multiDropdownLines`/`dropdownLines` render the full
  `hostViews` regardless (FR-12).
- **The view filter is glyph-only and resolved at the badge** (intersect selected keys
  with the live `hostViews` addrs; empty → fall back to `all`). A selected offline machine
  is filtered **in** by its key and rendered with `⊘` (FR-13).
- **The per-tool aggregate is derived at the badge** over the existing `hostViews` (no new
  payload field): for each tool, the **min remaining** across the selected hosts' windows
  with a reading, carrying that window's freshness state; no reading anywhere → `—`; all
  contributing hosts offline → `⊘`. This is the same binding-min the badge already
  computes, scoped to one tool — a presentation regroup, not a new data path (NFR-03).
- **Tool marks** are literal glyphs (`◆`/`▲`); the logo variant swaps a `templateImage=`
  base64 asset **only** when Tool marks = Logos; the neutral glyph is emitted as the floor
  regardless so xbar / no-image still names the tool.
- **Active-marking is read live** from the config on the render tick. A preset is active
  only when **every** axis matches; drifted axes each still mark their own value.
- **The Legend is static** — a fixed submenu of literal sample+gloss rows; no config read,
  no state. Present in both modes via the shared action-lines path.
- Every host cue passes through `sanitize()`; markers/colors/tool-marks are literals; `pct`
  is a coerced number. No display value is interpolated raw into a line or a style (NFR-04).
- After a Display write: `refresh=true` re-renders; the write is **presentation-only** —
  no poller reconfiguration, no change to the monitored set (FR-10).
- Side-by-side cap and the alternating rotation set share **one** cap (`SIDE_BY_SIDE_CAP
  = 3`), binding-first — **host mode only**; tool mode has exactly two units (no cap).

---

## Content Notes

- Realistic fleet throughout: **Studio** (Claude 5h 12%, the binder), **Laptop** (Codex
  88%, aging), **Desktop** (Codex 63%, fresh). No lorem, no placeholder names, no
  fabricated zeros. Real `host:port` keys in the Hosts axis.
- Copy is terse and honest — a menu-bar line has no room for hedging. Every degraded
  state names its marker and never invents a number.
- Window display labels `5-hour` / `Weekly` in the dropdown (mirror the dashboard).

---

## Ratified (approved by the user, round 1 — keep as drawn)

These five stand, ratified: (1) the compact markers, with stale's `⚠` **leading** in
compact; (2) the (host) preset list + names; (3) side-by-side cap = 3 with `+M more`;
(4) the `✓` active marker; (5) the `🖥` Display icon. No change — carried forward.

## Flagged for user ratification (the tool dimension — round 2, the Designer's calls)

1. **The neutral tool-mark pair** — `◆` Claude / `▲` Codex. Different silhouettes, solid,
   monochrome-legible. Do they read at a glance, and are they **clearly better** than the
   old `C`/`X` letters? If not clearly better, `C`/`X` is a fine fallback — a "clearly
   better or keep letters" call.
2. **The tool-group presets + the Group axis** — two new presets (`Claude vs Codex ·
   side-by-side`, `Rotate Claude / Codex · compact`) and the Group (Host | Tool) axis.
   Right names? Right two?
3. **The per-tool aggregate reads honestly** — "all Claude" = tightest Claude across the
   selected machines, carrying that window's state; a tool with no reading anywhere → `—`,
   never a zero. Does that match the expected meaning of the aggregate?
4. **Logos: opt-in, off by default, neutral floor always present** — treatment is a small
   (~13px) `templateImage=` in the tool-cue slot, replacing the neutral glyph only when
   enabled. Ratify the treatment. **For the Engineer/Architect:** the fair-use posture is
   opt-in + a neutral floor that never depends on the logo rendering; the actual asset +
   licensing is theirs to confirm.
5. **The Legend is a submenu** (`🛈 Legend — what the marks mean ▸`), not a toggle-expand —
   SwiftBar's native reveal, zero plugin state. Is the key **complete and scannable** as
   drawn (every symbol, one line each)?

## xbar-safe floor vs. SwiftBar polish

- **Floor (always ships, xbar + SwiftBar):** every compact state and **both tool marks
  (`◆`/`▲`)** are text/emoji + `color=`; they read in a monochrome bar. The grow-prefix
  cue, `+M`, the `✓` marker, and the Legend rows are all plain text.
- **SwiftBar polish (optional):** an `sfimage=` SF Symbol MAY reinforce a marker, and the
  **opt-in logos** render as `image=`/`templateImage=` — both behind a "SwiftBar only"
  guard, both **on top of** the neutral floor, never the sole carrier of a state or a
  tool identity xbar would lose.
