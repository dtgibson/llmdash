# Schema / System Design — badge-display-options
**Feature:** badge-display-options
**Date:** 2026-07-03
**Stage:** 3 — The Architect
**Path:** Incremental (prior `menu-bar-badge` + `multi-host-badge` + `menubar-service-controls` schemas exist; **no tables, no columns, no migration** — the display prefs are three new `!display-*` directives in the existing `hosts.conf`, and the badge re-lays-out `computeMultiBadge`'s existing `hostViews`)
**Config-location call [CFG]:** `!display-hosts=` / `!display-layout=` / `!display-density=` directives in `hosts.conf`, parsed by `src/host-config.js` alongside `!local=` (OQ-02 default confirmed; sibling prefs file NOT needed — the host list comma-joins cleanly)
**Host-list encoding:** `!display-hosts=host:port,host:port` — comma-joined sanitized keys, reusing the `hosts.conf` comma grammar; `all`/absent = every host; `local:<port>` is the local sentinel (OQ-06)
**Alternating-mechanism call [RENDER]:** **plugin per-tick rotation** (stateless, `floor(epochMs/5000) % count`), NOT SwiftBar-native line-cycling — see `spike-report.md` SPIKE-01 (a)
**Compact-glyph call [RENDER]:** a colored **state-marker + number** floor distinguishes all five states, xbar-safe; `sfimage=` is additive polish only — see SPIKE-01 (b)
**SPIKE-01 [RENDER] + [CFG]:** RESOLVED — see `spike-report.md`

---

## Data layer verdict

**No database change. No tables, no columns, no migration. No `/api` change.** This
feature persists exactly three new values — the display axes — and it persists them as
**three directive lines in the existing `hosts.conf`**, the same file the badge already
reads on the render tick and edits atomically. `usage_snapshots`, `insertSnapshot`,
dedup, trends, `getLatestPerWindow`, `src/db.js`, `host-cache.js`, and the whole peer
fetch/cache layer are **untouched**. `/api/state` and `/api/hosts` are **byte-for-byte
unchanged** — this is a **presentation change over `computeMultiBadge`'s existing per-host
`hostViews`** (NFR-03). This "schema" is therefore a **system design**: a directive
reader, a view-filter + layout + density extension to the badge render, a compact glyph
grammar, the Display submenu in the shared action-lines path, a display-write helper, and
disclosure — not a data-model change.

**Zero runtime dependencies, no build step** (NFR-05). The directive read/write is
`node:fs` only (via the existing `host-config.js`); the badge is `node:http`
(+ `node:child_process`/`node:fs` for the write helper); any SF-Symbol polish is
SwiftBar's native `sfimage=` (no asset toolchain). `package.json` runtime deps stay at
**0**.

**Why directives, not a sibling prefs file (OQ-02 confirmed).** The `!local=` precedent
already gives us a directive parser (`splitFileText`), a once-latch for degradation, a
read on the poller tick, and an atomic writer that preserves directives across host
edits. The host-LIST axis — the one the PRD flagged as possibly needing richer structure
— **comma-joins cleanly** into one directive line using the grammar `hosts.conf` already
speaks (Evidence 6/7 in the spike). A prefs file would add a second file, a second
parser, and a second write path for **zero** benefit. **Directives in `hosts.conf`.**

---

## The three display directives (FR-01, FR-03) [CFG]

### The file surface

Three new `!`-directive lines in `hosts.conf` (alongside `!local=`), each parsed by
`src/host-config.js`'s `splitFileText` (last-one-wins, like `!local=`):

```
# hosts.conf — host entries one per line; optional directives below
!local=auto                                   # (existing) monitoring-station emphasis
!display-hosts=100.64.0.7:8788,laptop:8787    # selected glyph hosts, comma-joined keys — OR "all"
!display-layout=side-by-side                  # single | side-by-side | alternating
!display-density=compact                      # wide | compact
```

| Directive | Grammar | Default (absent / unknown → this) |
|---|---|---|
| `!display-hosts=` | `all` **or** comma-joined sanitized `host:port` keys | `all` (every host) |
| `!display-layout=` | `single` \| `side-by-side` \| `alternating` | `single` |
| `!display-density=` | `wide` \| `compact` | `wide` |

**All three absent ⇒ byte-for-byte today's badge** (`all` / `single` / `wide`) — the
view filter is identity, layout is single, density is wide, so the render routes to the
**shipped** emit path unchanged (FR-02, Evidence 6).

### The host-list encoding (the load-bearing [CFG] sub-decision)

- `!display-hosts=` is a **comma-joined list of sanitized `host:port` keys**, reusing the
  same comma grammar `LLMDASH_HOSTS`/the file body already use (comma so entries never
  collide with anything in a key). Parse is `value.split(',').map(trim).filter(Boolean)`.
- Each key is the **exact sanitized `host:port` identity** the badge already produces
  (`computeMultiBadge`'s per-host `addr` = `` `${sanitizeHostPort(h.host)}:${sanitizeHostPort(h.port)}` ``,
  and `remotesFromCombined`'s `key`). **Never a free-form string** (NFR-04). The stored
  keys are validated against that vocabulary at read (unknown keys dropped, FR-04).
- The **local host** is addressable by the stable sentinel `local:<port>` (OQ-06) — the
  same key `removeHost` already refuses and `parseHosts`/`isLocalHost` already produce.
  "Select the local host for the glyph" is expressible even on a monitoring station.
- `all` (a literal token) or an **absent** directive = every host (the default). The empty
  string is treated as `all` too (never an empty glyph).

### Reading the directives — `src/host-config.js` (extend the existing parser)

`splitFileText` already returns `{ entryLines, localMode, directiveErrors }`. Extend it to
also return the three display axes, mirroring the `!local=` branch exactly:

```js
// src/host-config.js — new constants alongside DIRECTIVE_LOCAL / LOCAL_MODES
const DIRECTIVE_DISPLAY_HOSTS   = '!display-hosts';
const DIRECTIVE_DISPLAY_LAYOUT  = '!display-layout';
const DIRECTIVE_DISPLAY_DENSITY = '!display-density';
const LAYOUTS   = new Set(['single', 'side-by-side', 'alternating']);
const DENSITIES = new Set(['wide', 'compact']);

// splitFileText() gains a `display` accumulator with the axis defaults:
//   display = { hosts: 'all', layout: 'single', density: 'wide' }
// In the directive branch, alongside the !local= case:
//   name === '!display-layout'  → LAYOUTS.has(value)   ? display.layout  = value
//                                                       : directiveErrors.push({entry:line, reason:'bad-display-layout'})
//   name === '!display-density' → DENSITIES.has(value) ? display.density = value
//                                                       : directiveErrors.push({entry:line, reason:'bad-display-density'})
//   name === '!display-hosts'   → display.hostsRaw = value   // raw string; resolved against the
//                                                            // live host set later (see resolution)
// (unknown '!display-*' → the existing 'unknown-directive' error path — surfaced, never
//  silently reinterpreted, FR-04.)
```

`readHostsConfig` then returns `display` in its result object (`{ source, raw, localMode,
display, error, fileErrors }`). `configFileHealth` surfaces the display axes + any
`bad-display-*` errors for the health line (FR-20).

**Resolution of `!display-hosts` against the live set (where the VIEW FILTER binds).**
The directive stores raw `host:port` keys, but which hosts actually exist is only known
at render from `/api/hosts`. So the badge, not `host-config.js`, resolves the selection:
`host-config.js` parses the raw list of keys; the **badge** intersects it with the live
`hostViews` addrs (dropping unknown keys), and if the intersection is empty falls back to
`all` (FR-04/FR-19). This keeps `host-config.js` pure (no `/api/hosts` dependency) and
puts the view filter where the data is (the badge render).

### Honest degradation (FR-04) — reuse the shipped once-latch

- **Unknown `!display-*` directive** (typo) → the existing `unknown-directive` error path
  (surfaced in health, never a silent host entry).
- **Bad value** (`!display-layout=diagonal`) → `bad-display-layout` error, axis falls to
  its **default**, surfaced in health.
- **`!display-hosts` resolving to zero live hosts** (all keys unknown/removed) → fall back
  to `all` (never an empty glyph).
- **Logged once, not every tick** — the display errors ride the same `directiveErrors`
  array the `!local=` errors already do; the whole-file once-latch (`loggedConfigErrors`)
  covers the unreadable-file case. A per-tick directive error is surfaced via the
  health/startup readout (a cheap fs check), not re-logged every render.

---

## The badge render extension — `scripts/menubar/llmdash.5s.js` (FR-11–FR-19) [RENDER]

The badge stays a **pure consumer**. The change is **three presentation axes applied over
the existing `hostViews`** — no new fetch, no limit recomputation, no `/api/hosts` field.

### Where the axes plug in (the pipeline)

```
main()  [unchanged fetch]
├─ combined = fetchHosts(HOST, PORT)              /api/hosts — UNCHANGED
├─ localMode = localModeFromCombined(combined)    UNCHANGED
├─ display   = displayFromConfig()   ← NEW: read !display-* from hosts.conf (render tick, off request path)
├─ multi = computeMultiBadge(combined, { localMode })   UNCHANGED — still ranks ALL hosts, binding-first
│         // hostViews is the FULL per-host array (binding first). The dropdown uses it whole (FR-12).
├─ view  = applyDisplay(multi, display, { nowMs, epochMs })   ← NEW: filter + layout + density → a RENDER view
└─ emit the RENDER view:
      display default (all/single/wide) → the SHIPPED emit()/emitMulti() path, byte-for-byte (FR-02)
      otherwise                          → the new compact/side-by-side/alternating glyph (FR-14/15)
   (the DROPDOWN is ALWAYS the full multi.hostViews — the glyph is the filtered view; FR-12)
```

- `computeMultiBadge` is **unchanged** — it still computes the full binding-first
  `hostViews` over **all** hosts. The display axes are applied **after** it, in a new pure
  `applyDisplay` step, so the poller/`/api/hosts`/binding logic are all untouched.
- **The dropdown never filters.** `multiDropdownLines`/`dropdownLines` render the **full**
  `multi.hostViews` (every monitored host, full per-tool picture) regardless of the
  `hosts` selection (FR-12). Only the **glyph** (the title line) uses the filtered view.

### `displayFromConfig()` — read the directives on the render tick (NEW)

A small badge-side reader (off the HTTP request path, in the badge process — NFR-06):

```js
// scripts/menubar/llmdash.5s.js
import { readDisplayConfig } from '../../src/host-config.js';  // thin wrapper over readHostsConfig().display
export function displayFromConfig(read = readDisplayConfig) {
  try { return read(); }            // { hosts: 'all'|[keys], layout, density }
  catch { return { hosts: 'all', layout: 'single', density: 'wide' }; }  // never crash → today's badge
}
```

`readDisplayConfig` is a named export of `host-config.js` returning the parsed `display`
(with defaults already applied), so the badge has one import and the parse is unit-tested
in `host-config.js`'s own suite. A thrown read → the all/single/wide default (byte-for-
byte today) — honest degradation, never a crash (FR-04).

### `applyDisplay(multi, display, { nowMs, epochMs })` — the pure axis-applier (NEW)

The heart of the feature — **pure and injectable** (clock injected for rotation tests):

```
applyDisplay(multi, display, { nowMs, epochMs }) → {
  mode,            // 'single' | 'multi-glyph'  — 'single' when the effective shown count === 1
  glyph,           // the render descriptor the emitter turns into the title line (below)
  hostViews,       // the FULL multi.hostViews (unchanged) — the dropdown still renders all
  display,         // echoed for the Display-submenu active-marking
}
```

Three axes, applied in order:

1. **hosts (the VIEW FILTER over hostViews — glyph only, FR-11).**
   - `display.hosts === 'all'` → the shown set is **`multi.hostViews`** (identity — the
     byte-for-byte guard, Evidence 6).
   - a key list → the shown set is `multi.hostViews.filter(v => selected.has(v.addr))`,
     **preserving binding-first order**. An empty result → fall back to `all` (FR-04/19).
   - **A selected host that is offline/no-reading STAYS in the shown set** (FR-13) — it
     is filtered *in* by its key and rendered with its offline/no-reading marker, never
     dropped, never a fabricated zero.
   - The **dropdown is not filtered** — `hostViews` stays the full array (FR-12).

2. **layout (over the shown set).**
   - `single` → the **binding** shown host (the shown set's most-constrained, which is
     `shown[0]` since the set stays binding-first). One cell.
   - `side-by-side` → up to **N** shown hosts (the cap, below) composed into one line,
     binding-first, `+M more` when the set exceeds N (FR-17, Evidence 7).
   - `alternating` → **one** shown host per render, chosen by the stateless rotation
     index `floor(epochMs / ROTATE_MS) % shownCount` (FR-18, Evidence 3). `ROTATE_MS`
     defaults to the render interval (5000). The cap bounds the rotation set too.
   - **Degenerate reduction (FR-19):** `side-by-side`/`alternating` of a **single
     effective host** (one selected, or only one monitored) reduces to the `single`
     glyph; `compact` still applies. A zero-host selection already fell back to `all`.

3. **density (over whatever layout produced).**
   - `wide` → the **shipped** wide grammar (`▪ <host>·<C|X> <pct>%` in multi,
     `▪ <C|X> <pct>%` in single) — for `single`+`all`+`wide` this is literally the
     existing `emit`/`emitMulti` path (FR-02).
   - `compact` → the compact grammar (below): drop host name + tool letter, keep the
     colored marker + number; a compact host cue (grow-prefix) for multi layouts.

**The glyph descriptor** `applyDisplay` returns is a small structured object the emitter
renders (so the emitter stays the one place that writes SwiftBar lines):

```
glyph = { layout, density, cells: [ { cue, state, pct, marker, color }, … ], more, color }
   // single      → cells:[oneCell], more:0
   // side-by-side→ cells:[capped cells], more:M
   // alternating → cells:[theOneRotatedCell], more:0   (rotation chose it)
   // color = the line color (binding cell's color; a single line carries ONE color=)
```

### The compact glyph grammar (FR-14/FR-16) [RENDER] — proven in SPIKE-01 (b)

A per-host **compact cell** (the spike's proven floor), reusing the shipped markers
miniaturized. `state ∈ fresh|aging|stale|no-reading|offline`:

| State | cell text | color | never-a-number |
|---|---|---|---|
| fresh | `<pct>` | status hue (`BAR_COLOR[statusClass(pct)]`) | has number (fresh) |
| aging | `<pct>·` | `COLOR_AGING` `#a0a0a0` | has number + `·` |
| stale | `⚠<pct>` | `COLOR_STALE` `#f0a94b` | has number + `⚠` |
| no-reading | `—` | `COLOR_MUTED` `#9b9ea6` | **dash, NO number** |
| offline | `⊘` | `COLOR_OFFLINE` `#8b8b8b` | **slash, NO number** |

- **`▪` leads the whole glyph once** (the stable identity mark), then the cell(s).
- **Single compact:** `▪ <cell> | color=<cellColor>` — drops host name AND tool letter.
- **Side-by-side compact:** `▪ <cue><cell> <cue><cell> … [+M] | color=<bindingColor>` —
  each cell prefixed by a **grow-prefix host cue** (Evidence 5) so per-host identity
  survives; the **line's single `color=` is the binding host's** (a SwiftBar line carries
  one color — spike finding), and each cell's state rides its **marker** (monochrome-
  legible), not per-cell color.
- **Alternating compact:** `▪ <cue><cell> | color=<cellColor>` — one host this tick, its
  own color (one cell → one color, no compromise). The cue names which host is showing.
- **`sfimage=` is additive polish only** (SwiftBar-only) — layered on top of the text
  floor for the marker, never the sole carrier of a state (FR-14). The Engineer may add it
  behind a "SwiftBar only" guard; xbar/the floor must stand alone.

**The honesty-per-state floor (FR-16, NFR-01) is testable on the emitted string:** all
five markers distinct, offline/no-reading carry no digit (Evidence 4), per-host identity
via the cue, one host's state never suppresses another's (each cell independent).

### The host cue — grow-prefix-until-unique (SPIKE-01 finding)

For multi layouts (side-by-side / alternating), the per-cell host cue is computed over the
**shown** labels: grow each label's prefix (1 → max 4 chars) until all shown cues are
distinct; on a persistent collision, append a positional suffix (`Mac`, `Mac2`, `Mac3`).
sanitize()-scrubbed, bounded. Wide-density multi keeps the shipped `truncateHostCue`
(≤10 + `…`) — the compact cue is the tighter grow-prefix form.

### Bounds — the cap shared by side-by-side and alternating (FR-17/FR-18)

```js
const SIDE_BY_SIDE_CAP = 3;   // OQ-05 default (Designer ratifies 3–4). ONE cap for both layouts.
```
- **side-by-side:** show the first `SIDE_BY_SIDE_CAP` shown hosts (binding-first), then a
  `+M more` affordance where `M = shown.length - cap`. Binding-first order means `+M`
  hides the **least**-constrained — the tightest machine is always visible (Evidence 7).
  The cap never presents a truncated set as complete.
- **alternating:** the rotation set is the shown hosts, **bounded by the same cap** — an
  unwieldy selection cycles at most `cap` hosts (the binding-first `cap`), never a runaway
  list.
- **The exact N and the overflow treatment** (`+M more` vs. fall-back-to-most-constrained)
  are the **Designer's** within this bound; the default is `N=3`, `+M more`.

### The rotation is STATELESS (SPIKE-01 finding — the one subtlety)

`floor(epochMs / ROTATE_MS) % shownCount` is a pure function of the wall clock. **No
cursor is persisted** — the plugin re-spawns every render, so a stored counter is
unnecessary and a corruption risk. Two renders `ROTATE_MS` apart naturally show adjacent
hosts; a missed/extra render lands on whichever host the clock points at (no drift). The
clock is **injected** in tests (`epochMs`) so rotation is deterministic (QA-18).

### The byte-for-byte guard (FR-02, QA-02) — the split

```
applyDisplay(multi, {hosts:'all', layout:'single', density:'wide'}, …)
   ⇒ mode:'single', glyph over the SHIPPED path
   ⇒ main() renders via the EXISTING emit()/emitMulti() unchanged
```
When all three axes are default, `applyDisplay` returns a descriptor that routes to the
**existing** emit path (single-host → `emit(computeBadge(...))`, multi-host →
`emitMulti(multi)`), so the output is **byte-for-byte** the shipped badge in both modes.
The new compact/side-by-side/alternating rendering engages **only** when an axis is
non-default. This extends the shipped "byte-for-byte when unconfigured" guard from
"single host" to "**glyph unchanged when no display config is set**," across both modes.

### Escaping / sanitization at render (NFR-04)

Every host cue passes through `sanitize()` (strip `|\r\n`) before a line; host/port on the
`Open dashboard` href stays `sanitizeHostPort` (unchanged). The compact markers
(`·`/`⚠`/`—`/`⊘`) and colors are **literals**; `pct` is a coerced number. No display value
is interpolated raw into a line or a style — the axis vocabularies are enumerable
(unknown → default), and the host keys are sanitized `host:port` identities.

---

## The Display submenu (FR-05–FR-10) — the shared action-lines path, BOTH modes

The Display submenu rides the **same shared helper** the host-config + service items use,
so it appears in **single-host AND multi-host** dropdowns. The precedent is
`actionClusterLines` (called from both `dropdownLines` and `multiDropdownLines`). The
Display submenu is a **new sibling block** appended in that shared path.

### The submenu structure (FR-07/FR-09)

SwiftBar nested items via a leading `--`; the active choice on each axis and the active
preset marked live (read from the config on this render). The **presets** are the friendly
front; the **per-axis** choices are the truth underneath.

```
🖥 Display
--Presets                                                    (a header row, dim)
--✓ Most-constrained · wide        | shell=…display-action.mjs param2=preset param3=most-constrained-wide …
--  All hosts · compact · side-by-side | shell=… param2=preset param3=all-compact-sbs …
--  Rotate hosts · compact         | shell=… param2=preset param3=rotate-compact …
--  Single compact icon            | shell=… param2=preset param3=single-compact …
-----                                                        (submenu separator)
--Hosts                                                      (axis header, dim)
--✓ All hosts                       | shell=… param2=hosts param3=all …
--  Studio (100.64.0.7:8788)        | shell=… param2=hosts param3=100.64.0.7:8788 …
--  Laptop (laptop:8787)            | shell=… param2=hosts param3=laptop:8787 …
--Layout
--✓ Single (most-constrained)       | shell=… param2=layout param3=single …
--  Side-by-side                    | shell=… param2=layout param3=side-by-side …
--  Alternating                     | shell=… param2=layout param3=alternating …
--Density
--✓ Wide (text)                     | shell=… param2=density param3=wide …
--  Compact (icon)                  | shell=… param2=density param3=compact …
```

- **`✓` marks the active value, read LIVE** from the config on this render (FR-09). A
  **preset** is marked active **only when all three axes exactly match** its combination;
  when the axes have drifted, no preset is marked but each axis still marks its own value
  (FR-09). The exact marker glyph is the Designer's; the observable requirement is that the
  current setting is identifiable.
- **Host choices enumerate the currently monitored hosts** from the combined view the
  badge already fetched (`remotesFromCombined` + the local host + "All hosts") — no second
  data path (FR-07). Each choice passes the **sanitized `host:port` key** on ARGV.
- **Present in both modes** — the submenu block is emitted in the shared action-lines path
  (see wiring below), so single-host and multi-host dropdowns both carry it (FR-07, QA-07).

### The hosts axis is multi-select (a toggle per host)

`!display-hosts` is a LIST, so the Hosts axis choices **toggle** a host in/out of the
selection (not radio-select). "All hosts" is the sentinel that clears the list to `all`.
The helper (below) reads the current selection, toggles the passed key, and writes the new
comma-joined list — or sets `all`. When a toggle empties the list, it writes `all` (never
an empty selection → never an empty glyph). The `✓` marks each currently-selected host
(and "All hosts" when the axis is `all`).

### Presets → axes mapping (FR-05) — the shipped set

The preset table (a pure map, in the badge for the submenu + in the helper for the write):

| Preset id | Label (Designer refines) | `{ hosts, layout, density }` |
|---|---|---|
| `most-constrained-wide` | Most-constrained · wide (today) | `{ all, single, wide }` |
| `single-compact` | Single compact icon | `{ all, single, compact }` |
| `all-compact-sbs` | All hosts · compact · side-by-side | `{ all, side-by-side, compact }` |
| `rotate-compact` | Rotate hosts · compact | `{ all, alternating, compact }` |

- The shipped set **includes at least** the four the PRD names (FR-05): today's default,
  a **single-compact-icon** (`single`+`compact`), a **compact-side-by-side**
  (`side-by-side`+`compact`), and a **rotate/alternating** preset. The exact list + names
  are the **Designer's** (OQ-03, flagged for user ratification).
- Selecting a preset **writes the three axes** to its combination (FR-05). **The axes stay
  individually adjustable underneath** — adjusting one axis after a preset changes only
  that axis; the other two keep the preset's values (FR-06). A preset is a starting point,
  not a lock: after drift, no preset reads active but each axis marks its own value.

### The display-write helper — `scripts/menubar/display-action.mjs` (NEW, tracked)

**A new tracked sibling** of `host-config-action.mjs` / `service-control-action.mjs`,
delivered by the **same** marker-gated wrapper / absolute-node model (NFR-07). **Chosen
over extending `host-config-action.mjs`** because: (a) it keeps the host-list-editing
concern (Add/Remove *monitored* hosts) cleanly separate from the display-*view*-selection
concern — different vocabularies, different write shapes; (b) it needs **no `osascript`
dialog at all** (the inputs are enumerable menu choices written directly — FR-08), whereas
`host-config-action.mjs` is built around a typed-text dialog; (c) a dedicated helper is a
smaller, more auditable surface. The write logic itself lives in `host-config.js` (below),
so the helper is thin.

```
node display-action.mjs preset  <preset-id>   → writeDisplayConfig({ ...preset[id] })            (atomic)
node display-action.mjs layout   <value>       → writeDisplayConfig(current with layout=value)    (atomic)
node display-action.mjs density  <value>       → writeDisplayConfig(current with density=value)   (atomic)
node display-action.mjs hosts    <key|all>     → toggle <key> in the current selection (or set all) (atomic)
node display-action.mjs <verb> <v> --file=<scratch>   (test seam: point at a scratch hosts.conf)
```

- **No `osascript` text dialog** (FR-08, NFR-04) — the value is an **enumerable menu
  choice** passed on ARGV (`param3`), written **directly**. No typed input, no injection
  surface. Simpler than the Add-host flow (which needs typed input).
- **Local, atomic write** — delegates to `host-config.js`'s `writeDisplayConfig` (temp +
  rename, `0o600`, no partial file), the **same** atomic discipline as `writeHostsConfig`.
  **No HTTP mutation** (NFR-02) — the dashboard's serve-only/405 posture is untouched.
- **ARGV-only, no shell** — `execFileSync`-free on the write path (it's a pure fs write);
  the value reaches `host-config.js` only as a captured ARGV token, constrained to the
  enumerable axis vocabulary (unknown → default, FR-04). Runs under `process.execPath` /
  `$ABS_NODE` (a bare `node` is dead under the minimal spawn PATH — the standing lesson).
- **`refresh=true`** on every action so the badge re-renders and the glyph + submenu
  markers reflect the new setting on the next render — no restart (FR-10). The write is
  **presentation-only**: no poller reconfiguration, no change to the monitored set (FR-10).

### The write in `host-config.js` — `writeDisplayConfig` (NEW, atomic, preserves everything)

`writeHostsConfig` already rewrites `hosts.conf` from the entry list **and preserves the
`!local` directive**. Extend it (or add a sibling `writeDisplayConfig`) to **round-trip the
`!display-*` directives too**, so a display write preserves the host entries + `!local`,
and a host add/remove preserves the `!display-*` directives:

```js
// host-config.js — the writer now round-trips ALL directives, not just !local.
// readEntries() → { entries, localMode, display }  (display added)
// writeHostsConfig(file, entries, { fs, localMode, display })  →
//    header
//    !local=<mode>            (when non-default, as today)
//    !display-hosts=<all|k,k> (when non-default)
//    !display-layout=<v>      (when non-default)
//    !display-density=<v>     (when non-default)
//    <entry lines…>
// writeDisplayConfig(file, nextDisplay, { fs }) reads current entries+localMode,
//    then writes with the new display — so a display edit NEVER disturbs the host
//    list or !local, and an Add/Remove NEVER disturbs the display axes.
```

This is the **one** wiring change to the existing writer: it must preserve `!display-*`
across host edits and `!local`/entries across display edits (round-trip all directives).
Default-valued axes are **omitted** from the file (so an unconfigured file stays clean and
the byte-for-byte-today guard holds at the file level too).

### Wiring into the shared action-lines path (FR-07, both modes)

`displayActionLines({ display, hosts, presets })` returns the submenu block; it is appended
in `actionClusterLines` (the shared helper) right after the host-config lines, so it rides
into **both** `dropdownLines` and `multiDropdownLines` — one source, both modes (mirrors
how `serviceControlActionLines` was added). `DISPLAY_ACTION = ${PLUGIN_DIR}/display-action.mjs`,
execed via `ABS_NODE`, exactly like `HOST_CONFIG_ACTION`/`SERVICE_CONTROL_ACTION`.

---

## Data flow (end to end)

```
badge dropdown "🖥 Display ▸ Compact"  (shell=$ABS_NODE display-action.mjs density compact, terminal=false refresh=true)
   → display-action.mjs: writeDisplayConfig(current.display with density='compact')
        → host-config.js: atomic temp+rename rewrite of hosts.conf — preserves host entries + !local + other !display-*
        → NO HTTP, NO osascript dialog (enumerable value, written directly)
   → SwiftBar refresh=true  (badge re-renders immediately)
   ─────────────────────────  (this render tick)  ─────────────────────────
   → main(): fetchHosts (/api/hosts UNCHANGED) → computeMultiBadge (ALL hosts, binding-first, UNCHANGED)
   → displayFromConfig(): read !display-* from hosts.conf  (render tick, off request path)
   → applyDisplay(multi, display, {epochMs}):  VIEW FILTER (glyph only) → layout → density → glyph descriptor
        default all/single/wide → the SHIPPED emit()/emitMulti() path, byte-for-byte
        otherwise               → compact / side-by-side / alternating glyph
   → the DROPDOWN renders the FULL multi.hostViews (every host, full per-tool) — glyph is filtered, dropdown is not
   → the Display submenu marks the active axes + active preset LIVE from the config just read
```

The poller and `/api/hosts` are **untouched** — the poller still reads the full host set
and polls every host (FR-11); `/api/hosts` stays a pure cache read. HTTP is **read-only**
throughout — the only write is the badge's local `hosts.conf` temp+rename (NFR-02).

---

## Modules

| File | Change |
|---|---|
| `src/host-config.js` | **+`!display-*` parse** in `splitFileText` (three axes + `bad-display-*`/`unknown-directive` errors, defaults `all`/`single`/`wide`, host-list `.split(',')` of sanitized keys); **+`display` in `readHostsConfig`/`configFileHealth` results**; **+`readDisplayConfig()`** (named export the badge imports); **+`writeDisplayConfig()`** and extend `writeHostsConfig`/`readEntries` to **round-trip `!display-*`** (preserve display across host edits + host list across display edits). Pure/injectable (fs injected). `node:fs` only. |
| `scripts/menubar/llmdash.5s.js` | **+`displayFromConfig()`** (render-tick read, degrade→default); **+`applyDisplay(multi, display, {nowMs, epochMs})`** (pure: view-filter over `hostViews` glyph-only, layout single/side-by-side/alternating, density wide/compact, compact cell grammar, grow-prefix host cue, stateless rotation, cap + `+M more`, byte-for-byte guard for default axes); **+the compact/side-by-side/alternating emit** (extend the emitter; default axes route to the existing `emit`/`emitMulti`); **+`displayActionLines()`** in `actionClusterLines` (both modes, presets + per-axis, active-marked live). `computeMultiBadge`, the fetch, the dropdown-shows-all-hosts, and the wide grammar all **unchanged**. |
| `scripts/menubar/display-action.mjs` | **New, tracked.** The display-write helper the SwiftBar actions invoke under `$ABS_NODE`: `preset`/`layout`/`density`/`hosts` verbs → `host-config.js writeDisplayConfig` (atomic). **No `osascript` dialog** (enumerable values written directly). ARGV-only, no shell, `process.execPath`. Injectable `--file=` scratch seam. |
| `src/health.js` | **+display-preference disclosure** in `hostsConfigLine` (FR-20): name the current display setting (or "default / unconfigured") + surface any `bad-display-*`/`unknown` directive with the fix. A cheap fs check, off the request path — extends the existing `!local=`/config-file line. |
| `config.js` | **Unchanged.** `hostsFile`/`dataDir` reused; the display axes live in `hosts.conf`, not env — **no dead knob**, no new env var (a display env var would mean a plist edit + restart, exactly the friction this feature removes). |
| `src/server.js` | **Unchanged.** `/api/state` + `/api/hosts` contracts, 405-for-non-GET/HEAD, baseline headers, static `no-store` all stay; **no new endpoint** (NFR-02/NFR-03). |
| `scripts/install-macos.sh` | **+one note line** in the badge-setup message: the `!display-*` directives live in `hosts.conf` (the display prefs surface). The wrapper/absolute-node delivery is otherwise unchanged (the tracked helper rides the same model). |
| `README.md` | **+display-preferences section** (FR-20): the three axes + directives, the host-list encoding, the Display submenu (presets + axes), the view-filter-not-monitoring split, the compact/side-by-side/alternating layouts + the honesty floor, the serve-only/local-write posture, byte-for-byte-when-unconfigured. |
| `tests/menubar-display.test.js`, `tests/host-config-display.test.js`, `tests/menubar-display-action.test.js` (new); extend `tests/hosts-config-file.test.js`, `tests/hosts-disclosure.test.js`, `tests/menubar-multihost.test.js`, `tests/server.test.js` | **New/extended.** (See *Test seams*.) |

**Untouched:** `src/db.js`, `src/stats.js`, `src/codex-stats.js`, `src/trends.js`, the
`usage_snapshots` schema, `getCombined`/`host-cache.js`, `src/hosts.js` (the parser),
`src/poller.js` (the host set + fan-out), `fetchPeerState`/the outbound posture, the
`/api/state` + `/api/hosts` **contracts**, the freshness thresholds/bands, the diagnostic
reason codes, `computeMultiBadge`'s binding/ordering logic, the wide glyph grammar.

---

## Security / posture (NFR-02, NFR-04 — for the Auditor)

- **HTTP stays read-only (NFR-02/QA-22).** No new HTTP write/mutation endpoint. Display
  edits are **only** the local `hosts.conf` the badge writes + the badge re-reads on the
  render tick. All responses (incl. `/api/hosts`) keep the baseline headers, reject
  non-GET/HEAD with 405 (`allow: GET, HEAD`), serve static `no-store`. The `0.0.0.0` bind
  gains **no** write surface.
- **No typed input, no injection surface (NFR-04/QA-23).** Display choices are
  **enumerable menu values** (`preset`/`layout`/`density` from fixed sets; `hosts` from
  the sanitized `host:port` keys the badge already produces) written **directly** — there
  is **no `osascript` text dialog** and no free-form typed value on this path. An unknown
  value degrades to the axis default (FR-04). A host key is a sanitized identity, never a
  free-form string.
- **Local, atomic, user-owned write (NFR-04).** temp+rename on the same filesystem
  (`mode 0o600`), by the user-owned badge process, under the data dir — no network write,
  no privileged path, no partial file ever observable. The `host-config.js` write
  discipline reused verbatim.
- **Every rendered value escaped (NFR-04).** Host cues pass through `sanitize()`; the
  markers/colors are literals; `pct` is a coerced number. No display value is interpolated
  raw into a line or a style.
- **Request-path isolation (NFR-06).** The display read is on the **badge render tick**
  (badge process); the write is in the **badge process**; `/api/hosts` stays a pure cache
  read; the poller reads the **full** host set unchanged. The server request path gains no
  new work.
- **Contracts untouched, no new data (NFR-03).** No `/api/state`/`/api/hosts` field added
  or changed; the feature reads only `computeMultiBadge`'s existing `hostViews`. The
  shipped `state-unchanged.test.js` + the `/api/hosts` contract guard stay green. **If the
  feature appears to need a contract field, that is a flag to raise, not a silent
  coupling.**

---

## Disclosure (FR-20)

- **README:** the three display axes + the `!display-*` directives; the host-list
  encoding; the Display submenu (presets + per-axis); the **view-filter-not-monitoring**
  split (glyph filtered, dropdown full, polling unchanged); the compact / side-by-side /
  alternating layouts + the honesty floor; the **serve-only / local-file-write** posture;
  byte-for-byte-when-unconfigured.
- **Startup / `healthLines()`:** the config-file line (`hostsConfigLine`) names the
  **current display setting** (or "default / unconfigured") alongside the existing
  `!local=`/host-source disclosure, and surfaces a malformed/unknown `!display-*` value
  with the fix — a cheap fs check, off the request path.

---

## Config / directives (no dead knobs)

| Surface | Value | Drives |
|---|---|---|
| `!display-hosts=` (in `hosts.conf`) | `all` (default) / comma-joined `host:port` keys | the **glyph** view filter (never polling, never the dropdown) |
| `!display-layout=` (in `hosts.conf`) | `single` (default) / `side-by-side` / `alternating` | the glyph layout of the selected hosts |
| `!display-density=` (in `hosts.conf`) | `wide` (default) / `compact` | the glyph density |
| Display submenu (badge) | preset + per-axis choices | writes the three directives (atomic, local) |

All three absent ⇒ **byte-for-byte today's badge** — the view filter is identity, layout
single, density wide, routed to the shipped emit path (FR-02). No env knob (the display
prefs live with the host list the operator already edits, not a plist-edit-and-restart env
var) — no dead knob.

---

## Test seams (Stage-6 QA table)

Every row maps to a **pure or injectable** test — no live tailnet peer, no real menu bar,
no real `osascript` (there is none on this path). The live in-menu-bar render + any
`sfimage=` polish are deploy-time captures, per the badge's shipped deferral.

- **Directive parse / defaults / degradation** (`tests/host-config-display.test.js`, pure,
  fs injected): `!display-hosts`/`-layout`/`-density` parse to the three axes; **defaults**
  `all`/`single`/`wide` when absent; the **host list `.split(',')`** of sanitized keys;
  an **unknown value** → default + `bad-display-*` error (surfaced, not crash); an
  **unknown `!display-*` directive** → `unknown-directive` error; a **zero-live-host**
  selection → `all` (resolution tested at the badge); **write round-trips all directives**
  (a display write preserves host entries + `!local`; an Add/Remove preserves `!display-*`)
  (QA-01/QA-03/QA-04). Default-valued axes **omitted** from the written file (byte-for-byte
  file guard).
- **`applyDisplay` over injected `/api/hosts` fixtures** (`tests/menubar-display.test.js`,
  pure over fixtures + injected clock):
  - **byte-for-byte** — `{all,single,wide}` (or absent) → the emitted glyph + dropdown are
    byte-for-byte the shipped badge in **single-host AND multi-host** modes; the view
    filter is **identity** for `all` (QA-02).
  - **view filter** — a `hosts` subset keeps only selected views in the **glyph**,
    binding-first; the **dropdown still renders every host** in full; a selected offline
    host **stays** in the glyph with its offline marker; an all-unknown selection → `all`
    (QA-11/QA-12/QA-13/QA-19).
  - **compact five states** — the compact cell distinguishes fresh/aging/stale/no-reading/
    offline via marker + color; offline/no-reading carry **no digit**; `sfimage=` (if
    present) is additive, never the sole carrier (QA-14/QA-16).
  - **side-by-side / alternating** — per-host identity via the grow-prefix cue; each cell's
    own state; one host's state never suppresses another's; a maxed window binds per host
    (QA-15). The line carries one binding color; markers carry per-cell state.
  - **rotation** — injected `epochMs` → `floor(epochMs/ROTATE_MS)%count` names host *i*;
    advances one host per render, wraps at the (capped) set size; **stateless** (QA-18).
  - **cap + overflow** — side-by-side caps at N with a `+M more` (binding-first hides the
    least-constrained); alternating cycles at most the capped set (QA-17/QA-18).
  - **degenerate reduction** — side-by-side/alternating of one effective host → single;
    single+compact → the single compact icon; zero-host → `all`; unconfigured → today
    (QA-19).
- **Display submenu — both modes, active-marked, presets** (`tests/menubar-display.test.js`
  over injected display + hosts): the **Display submenu appears in single-host AND
  multi-host** dropdowns (shared action-lines path); per-axis enumerable choices + the four
  presets; host choices enumerate the monitored hosts + "All hosts"; the **active axis
  value and active preset are marked live** from the injected config; a preset is active
  **only when all three axes match**, drifted axes show no active preset but each axis marks
  its own value (QA-05/QA-06/QA-07/QA-09).
- **Display-write helper — round-trip, no dialog** (`tests/menubar-display-action.test.js`,
  drive with `--file=<scratch>` + ARGV verbs): `preset`/`layout`/`density`/`hosts` each
  write the directive **atomically** (temp+rename, `0o600`); a `hosts` toggle adds/removes a
  key (empty → `all`); a preset writes all three axes; **no `osascript`**, **no HTTP**,
  serve-only/405 preserved; the write **preserves** host entries + `!local` + other
  `!display-*` (QA-05/QA-08/QA-10/QA-23). By inspection: ARGV-only, no shell, `process.execPath`.
- **Post-write refresh, presentation-only** (`tests/menubar-display-action.test.js` +
  `tests/menubar-display.test.js`): each action carries `refresh=true`; the write triggers
  **no** poller reconfiguration and **no** change to the monitored set (the host entries in
  the file are unchanged after a display write) (QA-10/QA-11).
- **Contracts untouched** (`tests/state-unchanged.test.js` + the `/api/hosts` contract
  guard stay green, unmodified): no `/api/state`/`/api/hosts` field added/changed; the
  badge reads only `hostViews` (QA-21).
- **HTTP read-only preserved** (extend `tests/server.test.js`): all responses carry the
  baseline headers, non-GET/HEAD → 405 (`allow: GET, HEAD`), static `no-store`; **no new
  write endpoint**; the request path does no display work (QA-22/QA-25).
- **Zero deps / no build / macOS-native** (extend `tests/hosts-zerodep.test.js`):
  `package.json` runtime deps still 0; the display read/write, submenu, and glyph use
  `node:fs`/`node:http`/`node:child_process` + SwiftBar (`sfimage=` native) only; no build
  step (QA-24).
- **Delivery model preserved** (extend `tests/menubar-install.test.js`): the tracked
  `display-action.mjs` rides the marker-gated wrapper/absolute-node model; `--remove-badge`
  reverses symmetrically; SwiftBar never auto-installed (QA-26).
- **Disclosure** (extend `tests/hosts-disclosure.test.js`): README documents the axes /
  directives / submenu / view-filter split / serve-only posture; `healthLines()` names the
  current display setting (or "default/unconfigured") + surfaces a bad `!display-*` with the
  fix (QA-20).

---

## Risks the Engineer inherits

1. **A SwiftBar line carries ONE `color=` (SPIKE-01).** Side-by-side composes cells into
   **one** binding-colored line; per-cell state rides the **marker**, not per-cell color.
   Do not attempt per-cell color on one line — impossible in the grammar. Alternating
   (one host/tick) sidesteps it (one cell → one color).
2. **The rotation is STATELESS (SPIKE-01).** `floor(epochMs/ROTATE_MS)%count` — a pure
   function of the clock. Do **not** persist a cursor (no file, no counter surviving a
   render). Inject the clock for tests.
3. **The byte-for-byte guard is a routing split (FR-02).** `{all,single,wide}` (or absent)
   MUST route to the **existing** `emit`/`emitMulti` path unchanged. Only a non-default
   axis engages the new rendering. Assert byte-for-byte in **both** modes; and default-valued
   axes are **omitted** from the written file so an unconfigured file stays byte-for-byte too.
4. **The VIEW FILTER is glyph-only (FR-11/FR-12).** The `hosts` selection filters the
   **glyph's** shown set; the **dropdown renders the full `hostViews`** and the **poller
   reads the full host set** — never filtered. A selected offline host **stays** in the
   glyph (filtered in by key), marked, never dropped or zeroed (FR-13).
5. **The writer must round-trip ALL directives (the one wiring change).** A display write
   preserves host entries + `!local`; a host Add/Remove preserves `!display-*`. `writeHostsConfig`
   currently preserves only `!local` — extend it (and `readEntries`) to carry `display` too.
6. **`!display-hosts` resolves against the LIVE set at the badge, not in `host-config.js`.**
   `host-config.js` parses the raw keys (stays pure, no `/api/hosts` dep); the **badge**
   intersects with the live `hostViews` addrs and falls back to `all` on empty. Don't put
   the live-set intersection in the config layer.
7. **No `osascript`, no HTTP, enumerable-only (FR-08/NFR-02/NFR-04).** The display write is
   a direct fs write of an enumerable ARGV value — no dialog, no shell, no network. The host
   key is a sanitized `host:port` identity, never free-form. Runs under `$ABS_NODE`.
8. **The cap bounds BOTH side-by-side and alternating (FR-17/FR-18).** One `SIDE_BY_SIDE_CAP`
   (default 3), binding-first, `+M more` — so the tightest machine is always shown and an
   unwieldy selection never sprawls or cycles a runaway list.

## Open sub-decisions left to the Designer / user (FLAGS)

- **Preset list + naming + axis-vs-preset framing (OQ-03)** — the four-preset default is
  settled as the floor; the exact set, names, and submenu shape are the **Designer's**, and
  the **preset list + framing are flagged for the user to ratify at the Designer stage**.
- **The exact compact glyph look + per-state compact reading (OQ-04)** — the marker+color
  floor is proven (SPIKE-01); the exact glyph look (marker glyphs, the `sfimage=` polish,
  the side-by-side separator, the active-marker glyph) is the **Designer's** within the
  FR-16 floor, **flagged for user ratification**.
- **The side-by-side cap value + overflow treatment (OQ-05)** — `N=3`, `+M more` is the
  default within the bound; the exact N (3–4) and treatment (`+M more` vs. fall-back-to-
  most-constrained) are the **Designer's**.
- **`ROTATE_MS` cadence** — defaults to the 5s render interval (one host/tick); a slower
  cadence (a multiple of the interval) is the Designer's call within the stateless model.
- **`sfimage=` SF-Symbol polish** — additive, SwiftBar-only, on top of the text floor; the
  Engineer may add it behind a "SwiftBar only" guard, never as the sole state carrier.

---

# Round-2 Addendum — the tool dimension, tool marks + logos, the legend
**Date:** 2026-07-03 · folded in at the Designer stage (ratified by the user: "Ship
it, all as recommended"). This addendum EXTENDS the design above — nothing above is
retracted. It adds a **Group axis** (host | tool), a **Tool-mark axis** (neutral |
logo), a **Legend** submenu, two tool presets, and it records the one ratified change
to the shipped default badge (the `C`/`X` → `◆`/`▲` tool-cue swap). Binding spec is
`design-spec.md` (round 2); this is the system-side design the Engineer builds from.

## Two more `!display-*` directives (now five total) [CFG]

```
!display-group=tool                  # host (default) | tool
!display-tool-mark=logo              # neutral (default) | logo
```

| Directive | Grammar | Default (absent / unknown → this) |
|---|---|---|
| `!display-group=` | `host` \| `tool` | `host` |
| `!display-tool-mark=` | `neutral` \| `logo` | `neutral` |

- Same parse/degrade discipline as the round-1 axes: parsed in `splitFileText` against
  a fixed `Set` (`GROUPS`, `TOOL_MARKS`); an **unknown value** → the default + a
  `bad-display-group` / `bad-display-tool-mark` error (surfaced in health, never a
  crash); an **unknown `!display-*` directive** → the existing `unknown-directive` path.
- `readHostsConfig().display` now carries **five** axes:
  `{ hosts, layout, density, group, toolMark }` with defaults
  `{ 'all', 'single', 'wide', 'host', 'neutral' }`.
- **Default-valued axes are omitted from the file** (unchanged rule). So `group=host`
  and `toolMark=neutral` write nothing; `logo` requires an explicit
  `!display-tool-mark=logo` line — **logos are opt-in at the file level too**.

## The ratified default-cue change (`C`/`X` → `◆`/`▲`) — the one break in byte-for-byte

The neutral tool marks are the **default** (`toolMark=neutral`), and the default is
applied **wherever the tool is named — including the shipped wide badge**. So an
**unconfigured** badge changes: `▪ Studio·C 12%` → `▪ Studio·◆ 12%`,
`▪ Laptop·X 88%` → `▪ Laptop·▲ 88%` (and the single-host `▪ C 12%` → `▪ ◆ 12%`).

- **This is intentional and user-ratified**, not a regression. The round-1 "byte-for-
  byte when unconfigured" guard is **updated** to: *layout / density / group / host-
  select are byte-for-byte the shipped badge when unconfigured; the tool cue is the
  ratified neutral glyph.* Everything except the two-character cue is unchanged.
- **Engineer + Tester, read this:** the shipped `menubar-*` tests that assert the `C` /
  `X` cue (wide single + multi) must have their **expected strings updated to `◆` / `▲`**.
  That diff is the ratified change landing — **do not "fix" it by reverting to `C`/`X`**,
  and do not treat it as a byte-for-byte violation. Add a test that pins the new default
  cue (`◆`/`▲`) so a future silent revert is caught.
- **Disclose it** (it changes every current user's always-on glyph): a line in the
  README display section and in `healthLines()` noting the default tool cue is now the
  neutral mark (`◆` Claude / `▲` Codex), and a changelog/PR note. Honesty rule — a
  visible default change is never silent.

## `applyDisplay` — the group axis + the tool mark (extends the pure applier)

`applyDisplay(multi, display, { nowMs, epochMs })` gains **group** (applied first, it
decides what the *units* are) and **toolMark** (carried on each cell for the emitter):

```
axis order:  group  →  (host: view-filter over hostViews) | (tool: per-tool aggregate)
                     →  layout (single | side-by-side | alternating)
                     →  density (wide | compact)
                     →  toolMark (neutral ◆/▲  |  logo template-image, neutral floor)
```

### group = host (default) — unchanged
The round-1 pipeline exactly: view-filter over `hostViews` (glyph only), each unit a
host, its cell cued by a **grow-prefix host cue** and marked by the host's **binding
tool** (`◆`/`▲`, replacing `C`/`X`).

### group = tool — per-tool aggregates over the SELECTED hosts (NEW)
The units become **two tool aggregates** derived at the badge from the existing
`hostViews` (no new payload field, NFR-03) over the **host-selected** set (the Hosts
axis still scopes — `!display-hosts` filters which machines feed the aggregate):

```
for tool T in [claude, codex]:
  windows = every selected host's T windows that HAVE A READING       // 5h + weekly
  if windows is empty:
     if every selected host that tracks T is offline → cell = { state:'offline' }  // ⊘, no digit
     else                                            → cell = { state:'no-reading' } // —,  no digit
  else:
     w = the window with the LEAST remaining (the tightest — the same binding-min the
         badge already computes per host×tool, now taken across the selected hosts)
     cell = { pct: w.remainingPct, state: w.freshnessState, mark: toolGlyph(T) }
units = [claudeCell, codexCell] ordered BINDING-FIRST (tighter remaining first)
```

- **State = the tightest contributing window's freshness** (fresh / aging / stale),
  rendered with the compact cell grammar (`◆12`, `◆46·`, `◆⚠12`). Honest degradation is
  structural: no reading anywhere → `—` (never a fabricated zero, `▪ ◆12 ▲—`); all
  contributing hosts offline → `⊘`.
- **The tool mark is the unit's identity** (always shown, leads the cell) — `◆`=Claude,
  `▲`=Codex. There is **no host cue** in tool mode (the unit is a tool, not a machine).
- **Exactly two units** → **no cap, no `+M more`** in tool mode; `side-by-side` shows both
  (line color = the **binding** aggregate, per-cell state on the marker — the one-color-
  per-line rule); `alternating` is a **two-beat** rotation (`floor(epochMs/ROTATE_MS)%2`);
  `single` shows the binding aggregate.
- **Independence:** one aggregate's state never flags the other's (same per-unit
  independence as per-host).
- **Degenerate:** a fleet with only one tool present still yields two cells — the absent
  tool reads `—` (honest), it is not dropped.

### toolMark — carried on every cell, resolved by the emitter (NEW)
`applyDisplay` sets each cell's `mark` to the neutral glyph (`◆`/`▲`) and echoes
`display.toolMark`. The **emitter** decides the rendering:
- `neutral` (default) → emit the `◆`/`▲` glyph (text + `color=`), the xbar-safe floor.
- `logo` → emit the neutral glyph **as the floor** AND, behind a **SwiftBar-only guard**,
  layer the product logo as a `templateImage=` (below). On xbar / if the image can't
  render, `◆`/`▲` still names the tool — **the logo is never the sole carrier** (mirror
  the `sfimage=` polish rule).

## The opt-in logos — asset, delivery, fair-use (NEW engineering surface)

- **What:** two small **monochrome template images** (`templateImage=` base64) — the
  Claude mark and the Codex/OpenAI mark — ~**13px**, rendered in the **tool-cue slot**
  in place of the neutral glyph, **only** when `toolMark=logo` **and** the host is
  SwiftBar. Template images adapt to the menu-bar fg color (light/dark) automatically.
- **Where the asset lives:** tracked source files beside the plugin —
  `scripts/menubar/assets/claude-mark.png` and `.../codex-mark.png` (small, monochrome,
  transparent). The badge reads them with `node:fs` and base64-encodes at render **only
  when `toolMark=logo`** (no read on the default path — zero cost when off). **No build
  step, no runtime dep** (a tracked PNG is source, not a dependency). Resolve the path
  from the plugin's **own** location via `new URL('./assets/…', import.meta.url)` — ESM
  de-symlinks `import.meta.url`, so it resolves correctly under the wrapper/symlink
  (the shipped run-guard lesson). Cache the encoded string per process (the plugin
  re-spawns each tick; encode once per run).
- **Delivery:** the assets travel with the checkout (tracked), so the installed badge —
  invoked through the marker-gated wrapper under `$ABS_NODE` — reads them from its own
  plugin dir. No installer change beyond the existing wrapper model; `--remove-badge`
  removes only the marker-carrying wrapper (the tracked assets belong to the checkout).
- **Fair-use posture (product decision, ratified):** opt-in, **off by default**; the
  **neutral glyph is always the floor** and the badge's honesty/state reading never
  depends on a logo rendering; the marks are used **nominatively** to identify the actual
  tools being monitored, monochrome, small, with **no endorsement/affiliation implied**.
  **For the Auditor:** confirm (a) the neutral floor is emitted unconditionally (logo is
  pure additive polish), (b) the asset read is local `node:fs` only (no network fetch, no
  eval, a passive image param), (c) off by default, and (d) the licensing/attribution
  note is acceptable for a personal open-source project (nominative fair use; the repo
  ships the neutral floor as the guaranteed alternative). The asset itself + its license
  line are the **Engineer's** to supply; flag if the marks can't be shipped cleanly →
  fall back to neutral-only (the floor already covers it).

## The Legend submenu (NEW) — static, both modes, on demand

A `🛈 Legend — what the marks mean` row in the **shared action-lines path**
(`actionClusterLines`), so it appears in single-host AND multi-host dropdowns. It is a
**SwiftBar submenu** (native click-to-reveal — **zero plugin state**, chosen over a
toggle-expand that would need a `legendOpen` marker round-trip + whole-dropdown re-
render; the submenu also works identically on xbar).

- **Content = the Legend copy table in `design-spec.md`, verbatim** — every symbol the
  badge can show, one line each: the five states (`46`/`46·`/`⚠12`/`—`/`⊘`), the three
  colors + thresholds, the number's scope, both tool marks (`◆`/`▲`, "logos mean the
  same"), the side-by-side host cue + `+M`, and the `✓` active marker.
- **Fully static** — literal `sample + gloss` rows, **no config read, no dynamic data**,
  so there is **no escaping concern** (every value is a literal). The sample cell is
  colored via a literal `color=` where it aids reading. Placed in the info/manage band
  (near `☰ Watching`, above `⊘ Uninstall`). Present in both modes (QA: assert it appears
  in single + multi, and that the key enumerates all five states + both tool marks).

## Display submenu — the two new axes + two presets (extends the round-1 submenu)

The submenu (shared action-lines path, both modes) gains a **Group by** axis and a
**Tool marks** axis, and the preset list grows to **six**:

- **Group by** (radio): `Host (machine)` | `Tool (◆ Claude / ▲ Codex)`, active `✓`-marked
  live. It is the **top-level unit** axis.
- **Tool marks** (radio): `Neutral (◆ / ▲)` | `Logos`, active `✓`-marked. **Orthogonal to
  presets** — presets set the four layout axes; the tool-mark choice **persists** across
  preset changes.
- **Presets now map FOUR axes** `{ group, hosts, layout, density }` (tool-mark excluded):

  | Preset id | Label | `{ group, hosts, layout, density }` |
  |---|---|---|
  | `most-constrained-wide` | Most-constrained · wide (today) | `{ host, all, single, wide }` |
  | `single-compact` | Single compact icon | `{ host, all, single, compact }` |
  | `all-compact-sbs` | Compact icons side-by-side | `{ host, all, side-by-side, compact }` |
  | `rotate-compact` | Rotate hosts · compact | `{ host, all, alternating, compact }` |
  | `tool-sbs` | Claude vs Codex · side-by-side | `{ tool, all, side-by-side, compact }` |
  | `tool-rotate` | Rotate Claude / Codex · compact | `{ tool, all, alternating, compact }` |

- **Active-marking:** a preset is `✓` **only when all FOUR** of its axes match; a drifted
  axis leaves no preset marked but each axis still marks its own value. The **Hosts axis
  stays meaningful in tool mode** — it scopes which machines feed the aggregate.

## `display-action.mjs` + `writeDisplayConfig` — two more verbs, round-trip five axes

- **New verbs** (enumerable, ARGV-only, no dialog, no HTTP, atomic — same as round 1):
  `node display-action.mjs group <host|tool>` and
  `node display-action.mjs tool-mark <neutral|logo>`. The **`preset` verb now writes four
  axes** (`group,hosts,layout,density`), leaving `toolMark` as-is (orthogonal).
- **`writeDisplayConfig` / `writeHostsConfig` / `readEntries` round-trip all five
  `!display-*` directives** (+ `!local` + entries): a display edit never disturbs the host
  list or `!local`; an Add/Remove never disturbs any display axis; default-valued axes
  omitted. This is a superset of the round-1 round-trip requirement (Risk 5 above).

## Modules — round-2 deltas (add to the table above)

| File | Round-2 change |
|---|---|
| `src/host-config.js` | **+`!display-group` / `!display-tool-mark` parse** (`GROUPS`/`TOOL_MARKS` sets, `bad-display-group`/`bad-display-tool-mark` errors, defaults `host`/`neutral`); `display` result gains `group`,`toolMark`; `writeDisplayConfig`/`writeHostsConfig`/`readEntries` round-trip **all five** `!display-*`. |
| `scripts/menubar/llmdash.5s.js` | **+group axis in `applyDisplay`** (per-tool aggregate over selected `hostViews`: tightest-window min per tool, state carry, no-reading→`—`, all-offline→`⊘`, two units binding-first, no cap); **+toolMark on every cell** and the emitter's neutral-vs-logo resolution (`◆`/`▲` floor; `templateImage=` behind a SwiftBar-only guard); **the default cue is `◆`/`▲`** (the ratified `C`/`X` swap — update the wide/multi grammar constants); **+Group + Tool-marks axes + two tool presets** in `displayActionLines`; **+`legendLines()`** (static submenu) in `actionClusterLines`; **+logo asset read/encode** (`node:fs` via `import.meta.url`, only when `toolMark=logo`, cached per run). |
| `scripts/menubar/assets/claude-mark.png`, `codex-mark.png` | **New, tracked.** Small monochrome transparent template marks; read + base64 only when `toolMark=logo`. Ship a LICENSE/attribution note; neutral floor is the guaranteed alternative. |
| `scripts/menubar/display-action.mjs` | **+`group` / `tool-mark` verbs**; `preset` writes four axes. |
| `src/health.js` | Display line also names the **group** + **tool-mark** setting and notes the default cue is now `◆`/`▲`; surfaces `bad-display-group`/`bad-display-tool-mark`. |
| `README.md` | **+group / per-tool aggregate, +tool marks (neutral default, logos opt-in + fair-use), +Legend**, and the **`C`/`X`→`◆`/`▲` default-cue change** disclosed. |
| tests | **+group-aggregate, +tool-mark (neutral floor + logo template-image + asset resolves under the wrapper), +Legend, +the two axes/presets in the submenu, +the updated default-cue expectations** (see round-2 seams below). |

## Round-2 test seams (add to the Stage-6 QA table)

- **Directive parse (round 2)** (`tests/host-config-display.test.js`): `!display-group` /
  `!display-tool-mark` parse to `host`/`tool` and `neutral`/`logo`; defaults when absent;
  unknown value → default + `bad-display-*` error; the writer round-trips **all five**
  `!display-*` (display edit preserves entries+`!local`+other axes; Add/Remove preserves
  all five); default axes omitted (`group=host`/`toolMark=neutral` write nothing).
- **Group = tool aggregate** (`tests/menubar-display.test.js`, over injected `/api/hosts`
  fixtures): per-tool **min-remaining across the SELECTED hosts**, carrying the tightest
  window's state; **no reading anywhere → `—`** (no digit); **all contributing hosts
  offline → `⊘`** (no digit); **two units, no cap / no `+M`**; binding-first order; the
  Hosts selection **scopes** the aggregate; per-aggregate independence; alternating = two-
  beat; side-by-side line color = binding aggregate; the tool mark leads each cell.
- **Tool marks** (`tests/menubar-display.test.js`): **default `◆`/`▲` everywhere incl. the
  wide/default badge** (the ratified cue — the updated expected strings; a pin test guards
  against a silent revert to `C`/`X`); `toolMark=logo` → the neutral glyph is **still
  emitted** (floor) AND a `templateImage=` is layered **only** under the SwiftBar guard;
  **xbar / no-image path emits `◆`/`▲` alone**; the **asset resolves via `import.meta.url`
  and encodes** (a symlink/wrapper-path test — the shipped run-guard lesson — so the logo
  path works the way the host actually runs the plugin, not just under `node <realpath>`);
  the asset is read **only** when `toolMark=logo`.
- **Legend** (`tests/menubar-display.test.js`): the Legend submenu appears in **single-host
  AND multi-host** dropdowns; the key enumerates **all five states + both tool marks +
  the colors + the `✓` marker** (complete); it is fully **static** (no config read); a
  byte check that its rows are literals (no interpolated value).
- **Display submenu (round 2)** (`tests/menubar-display.test.js`): the **Group by** and
  **Tool marks** axes appear + are `✓`-active-marked live in both modes; **six** presets;
  a preset is active only when **all four** layout axes match; **tool-mark persists** across
  a preset write (orthogonality); host choices still enumerate the monitored hosts.
- **Display-write helper (round 2)** (`tests/menubar-display-action.test.js`): `group` /
  `tool-mark` verbs write atomically (temp+rename, `0o600`); `preset` writes four axes and
  leaves `toolMark` untouched; no `osascript`, no HTTP, serve-only/405 preserved; all five
  `!display-*` round-tripped.
- **Byte-for-byte (updated)** (`tests/menubar-display.test.js` + update the shipped
  `menubar-*` expectations): unconfigured → today's layout/density/group with the **`◆`/`▲`
  cue** (the sole ratified change); every other character unchanged in **both** modes; the
  updated `C`/`X`→`◆`/`▲` diff is asserted as **intended**, not reverted.
- **Disclosure (round 2)** (`tests/hosts-disclosure.test.js`): README documents the group /
  per-tool aggregate / tool marks (neutral default + logos opt-in + fair-use) / Legend and
  the **default-cue change**; `healthLines()` names the group + tool-mark setting.
- **Zero deps / no build (round 2)** (`tests/hosts-zerodep.test.js`): the tracked PNG assets
  are **source, not a dependency** (`package.json` runtime deps still 0); the logo read is
  `node:fs`; no build step introduced.

## Round-2 risks the Engineer inherits (add to the list above)

9.  **The `C`/`X`→`◆`/`▲` cue swap is the one ratified break in byte-for-byte.** Update the
    shipped `menubar-*` test expectations to `◆`/`▲` (do **not** revert), pin the new
    default cue, and **disclose** the change (README + health + changelog). A visible
    default change is never silent.
10. **The logo is additive polish over an always-present neutral floor.** Emit `◆`/`▲`
    unconditionally; layer the `templateImage=` only under the SwiftBar guard, only when
    `toolMark=logo`. xbar / a failed image must still name the tool. Resolve the asset via
    `import.meta.url` (works under the wrapper/symlink) and read it only when opted in.
    If the marks can't be shipped with a clean license, fall back to neutral-only.
11. **The per-tool aggregate is a presentation regroup over `hostViews`, scoped to the
    selected hosts** — no new `/api` field, no poller change. Tightest-window min per tool;
    honest `—`/`⊘`; exactly two units (no cap); binding-first.
12. **Tool-mark is orthogonal to presets** — a preset writes only `{group,hosts,layout,
    density}`; `toolMark` persists. Active-marking: preset ✓ needs all four axes; tool-mark
    marks itself independently.
13. **The Legend is static** — literal rows only; keep it that way (no dynamic value → no
    escaping surface), and keep it complete (every symbol the badge can emit).
