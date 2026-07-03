# Spike Report — badge-display-options
**Feature:** badge-display-options
**Date:** 2026-07-03
**Stage:** 3 — The Architect
**Spike:** SPIKE-01 [RENDER] (the alternating mechanism + the compact-glyph rendering) + [CFG] (config location)
**Path:** Incremental
**Budget:** small — reasoning + emitted-stdout prototype over the REAL `computeMultiBadge`; no SwiftBar dir, badge, or service touched.

---

## Verdicts up top

| # | Question | Verdict |
|---|---|---|
| **SPIKE-01 (a)** | "Alternating in place" — SwiftBar native multi-title-line cycling **or** plugin per-tick rotation? | **Per-tick rotation in the plugin is the PRIMARY mechanism.** SwiftBar-native line-cycling is rejected as the primary (visual-only to verify, uncontrollable cadence, SwiftBar-only). Rotation is deterministic, testable via emitted stdout, cadence-controllable, and works on xbar too. |
| **SPIKE-01 (b)** | A compact glyph holding all FIVE honesty states in the xbar-safe floor (text/emoji + `color=`)? | **PROVEN.** A colored **state-marker + number** floor distinguishes fresh / aging / stale / no-reading / offline with NO SwiftBar-only param. `sfimage=` SF Symbols are noted as additive SwiftBar-only polish, never the sole carrier. |
| **[CFG]** | `hosts.conf` `!display-*` directives **or** a sibling prefs file? | **`!display-*` directives in `hosts.conf`** (the PRD default), reusing `host-config.js`'s `!local=` parse. The host-LIST axis is encoded as a **comma-joined** `!display-hosts=host:port,host:port` line — the same comma grammar `LLMDASH_HOSTS`/`hosts.conf` already use. A directive line holds it cleanly; no sibling file needed. |

No real badge, SwiftBar plugin dir (`~/Library/Application Support/SwiftBar/Plugins`), or launchd service was touched. The prototype lives only in the session scratchpad and imports the tracked `scripts/menubar/llmdash.5s.js` read-only. The repo working tree is clean apart from this feature's `pipeline/` folder.

---

## SPIKE-01 (a) — the alternating mechanism: per-tick rotation, decided

### The two candidates, weighed

**SwiftBar-native multi-title-line cycling.** SwiftBar renders the **first** pre-`---`
line as the menu-bar title. Emitting several pre-`---` title lines (with SwiftBar's
`~~~` "streamable/alternate" markers) makes SwiftBar rotate them in the bar. Attractive
because it is zero rendering effort — the plugin emits N lines and SwiftBar animates.

Rejected as the **primary** for four load-bearing reasons:
1. **Visual-only to verify.** The rotation happens inside SwiftBar's render loop. There
   is **nothing in the emitted stdout** that proves the user sees each host in turn — a
   Stage-6 test can only assert "N title lines were emitted," not "the bar cycled." The
   PRD's honesty floor (FR-16) is *"testable against the emitted glyph string"* — a
   SwiftBar-internal animation is not.
2. **Uncontrollable cadence.** The rotation speed is SwiftBar's, not ours. We can't tune
   it, can't sync it to the 5s refresh, and it differs across SwiftBar versions.
3. **SwiftBar-only.** xbar (the documented alternative host, per the plugin header)
   does not carry the same multi-title-line cycling. A SwiftBar-only alternating layout
   violates the "xbar-safe floor" spirit the whole glyph grammar is built on.
4. **Couples the layout to a param we can't fall back from cleanly.** If it doesn't
   animate (version/user config), the user sees a *static* first line silently — a
   dishonest "alternating" that never alternates.

**Plugin per-tick rotation (chosen).** The badge re-runs every 5s (the `.5s.js`
filename convention). The plugin derives a rotation index from the clock over the
selected host set and renders **one host per tick**, advancing across renders. This is
exactly the PRD's named fallback (b) — but the spike **promotes it to primary** because:
- **Deterministic + testable via stdout.** `index = floor(epochMs / 5000) % count`. A
  test injects a fixed epoch and asserts the emitted glyph names host *i* — the
  rotation is proven on the emitted string (Evidence 3).
- **Cadence-controllable.** One host per 5s render (or any multiple), our choice.
- **Host-agnostic.** Works identically on SwiftBar and xbar (it's just a normal single
  title line that happens to show a different host each render).
- **Honest by construction.** Each tick emits a *real* compact glyph for the shown host
  (its own five-state honesty), with a host cue so you know which machine you're seeing.

**Rotation state across ticks (the one subtlety).** There is no persisted state — the
index is a **pure function of the wall clock**, so two consecutive renders 5s apart
naturally show adjacent hosts, and a missed/extra render just lands on whichever host
the clock points at (no drift, no stored cursor to corrupt). This is the design's
key robustness property: **rotation is stateless.**

### Evidence 3 (captured stdout) — rotation advances one host per render, wraps at the set size

```
=== EVIDENCE 3: per-tick rotation over the selected set (5s cadence, deterministic) ===
  tick 0 (epoch+0s) → ▪ L46· | color=#a0a0a0  [tick→host 1]
  tick 1 (epoch+5s) → ▪ S⚠88 | color=#f0a94b  [tick→host 2]
  tick 2 (epoch+10s) → ▪ S12 | color=#ff6b6b  [tick→host 0]
  tick 3 (epoch+15s) → ▪ L46· | color=#a0a0a0  [tick→host 1]
  tick 4 (epoch+20s) → ▪ S⚠88 | color=#f0a94b  [tick→host 2]
  tick 5 (epoch+25s) → ▪ S12 | color=#ff6b6b  [tick→host 0]
  → index = floor(epochMs/5000) % 3 ; advances one host per render, wraps at the set size.
```

The index cycles 1→2→0→1→2→0 across six 5-second-apart ticks — one host per render,
wrapping at 3. Each shown host carries **its own** state marker/color (host 0 crit-fresh
`12`, host 1 aging `46·`, host 2 stale `⚠88`) — one host's state never leaks into
another's tick. (The `[tick→host i]` annotation is prototype-only; the shipped glyph is
just the `▪ …| color=…` line.)

*(Note: host 0's label was "Studio" and host 2's was "Server" — both start `S`; the
prototype used a bare initial and they collide in the trace. The disambiguation rule
in Evidence 5 fixes this — the shipped cue is a grow-prefix-until-unique cue, not a bare
initial.)*

---

## SPIKE-01 (b) — the compact glyph: all five states in the xbar-safe floor, proven

### The compact grammar (the floor)

The compact cell **drops the host name and the tool letter** to shrink width, keeping a
**colored state-marker + number**. The marker is the load-bearing, monochrome-legible
carrier (it reads even if color is stripped); `color=` reinforces. The five states:

| State | Compact cell | Color | Marker carries it |
|---|---|---|---|
| **fresh** | `46` | status hue (good/warn/crit by pct) | the plain number in its status color |
| **aging** | `46·` | `#a0a0a0` (dim) | trailing `·` age-dot + dim |
| **stale** | `⚠12` | `#f0a94b` (amber) | leading `⚠` + amber |
| **no-reading** | `—` | `#9b9ea6` (muted) | the dash, **never a number** |
| **offline** | `⊘` | `#8b8b8b` (offline grey) | the slash, **never a number** |

These reuse the shipped wide grammar's markers (`·` aging, `⚠` stale, `—` no-reading)
miniaturized, plus a compact offline `⊘` — so the compact surface speaks the **same
honesty vocabulary** as the wide glyph, just denser. No `sfimage=` is required; it is
optional additive polish (a SwiftBar SF Symbol *on top of* the text floor).

### Evidence 1 (captured stdout) — the five states are distinguishable, xbar-safe

```
=== EVIDENCE 1: compact SINGLE glyph, five honesty states (xbar-safe floor) ===
  fresh       → ▪ 46 | color=#f0a94b
  aging       → ▪ 46· | color=#a0a0a0
  stale       → ▪ ⚠12 | color=#f0a94b
  no-reading  → ▪ — | color=#9b9ea6
  offline     → ▪ ⊘ | color=#8b8b8b
```

Every state has a **distinct marker** (none / `·` / `⚠` / `—` / `⊘`) AND a distinct
color — separable in a monochrome bar by the marker alone, reinforced by color. `46`
(fresh) shows amber because 46% is in the warn band (20–49%) — the fresh number keeps its
**status** color; the *absence* of a marker is what distinguishes it from aging's `46·`.
(A Designer note: fresh-warn and stale both read amber; the `⚠` on stale and the bare
number on fresh keep them apart in monochrome — the marker, not the color, is the floor.)

### Evidence 4 (captured stdout) — the never-a-number guard holds

```
=== EVIDENCE 4: never-a-number guards (offline/no-reading carry NO digit) ===
  fresh       text="46"     hasDigit=true  OK
  aging       text="46·"    hasDigit=true  OK
  stale       text="⚠12"    hasDigit=true  OK
  no-reading  text="—"      hasDigit=false  OK
  offline     text="⊘"      hasDigit=false  OK
```

Offline and no-reading carry **no digit** — the structural never-fabricate-a-zero rule
survives compaction (NFR-01, FR-13, FR-16). This is directly testable on the emitted
string (a regex `\d` assertion), exactly as the PRD's legibility floor requires.

### Evidence 2 (captured stdout) — side-by-side: per-host identity + independent states in ONE item

```
=== EVIDENCE 2: side-by-side compact — one item, per-host identity + states ===
  ▪ S12 L46· S⊘ | color=#ff6b6b
  (S=Studio 12 crit-fresh · L=Laptop 46· aging · V=Server ⊘ offline — three states, one line)
```

Three hosts, three **independent** states (`12` crit-fresh, `46·` aging, `⊘` offline) in
one menu-bar item, each with a host cue. **This trace also surfaced the finding below.**

### The load-bearing finding — a SwiftBar line carries ONE `color=`, so side-by-side needs a per-cell color strategy

A single SwiftBar/xbar title line has **one** `color=` param for the whole run. Composing
several hosts' cells into one line therefore **cannot** color each cell independently. The
resolution (design decision, folded into schema.md):

- **Per-cell state is carried by the MARKER** (`·`/`⚠`/`—`/`⊘`), which is monochrome and
  survives a single line color. The line's `color=` is the **binding host's** color (the
  most-constrained shown), so the line's hue tracks the tightest machine — honest, since
  side-by-side's whole point is "how are my machines doing" and the binding is the answer.
- Evidence 2's line is `#ff6b6b` (crit) — Studio's crit color — while Laptop's `·` and
  Server's `⊘` still read their own states via markers. **No state is lost**, only the
  per-cell *color* is subordinated to the binding; the marker preserves the distinction.
- The alternative (one SwiftBar line *per host* via multiple pre-`---` lines) is exactly
  the SwiftBar-native-cycling path rejected in (a) — so side-by-side stays **one line,
  binding-colored, marker-per-cell**. This is the honest, xbar-safe composition.

### The second finding — the host cue must disambiguate, not just take an initial

Evidence 3/2 showed "Studio" and "Server" both → `S`. A bare initial is ambiguous.

### Evidence 5 (captured stdout) — grow-prefix-until-unique host cue

```
=== (5) host-cue disambiguation (grow prefix until unique) ===
  [Studio, Server, Laptop] → [ 'St', 'Se', 'La' ]
  [Studio, Studio2]        → [ 'Stud', 'Stud2' ]
  [Mac, Mac, Mac]          → [ 'Mac', 'Mac2', 'Mac3' ]
```

The cue grows the label prefix (1→max 4 chars) until all **shown** cues are distinct;
still-colliding labels get a positional suffix. Deterministic, bounded, sanitize()-safe.
This is the compact host cue for side-by-side and rotation (schema.md §compact grammar).

---

## [CFG] — config location: `!display-*` directives in `hosts.conf`, with the host list comma-joined

### The decision

**`hosts.conf` `!display-*` directives** (the PRD default), NOT a sibling prefs file. The
`!local=` precedent in `src/host-config.js`'s `splitFileText` already parses `!`-directive
lines (last-one-wins, unknown→surfaced-error), reads on the poller tick, and writes
atomically via `writeHostsConfig` (which already **preserves** the `!local` directive
across host add/remove). Three new directives ride that exact machinery:

```
!display-hosts=host:port,host:port     # comma-joined selected keys, OR "all" (default)
!display-layout=single|side-by-side|alternating
!display-density=wide|compact
```

### The host-LIST encoding — the one axis that could resist a flat directive line

The `hosts` axis is a **list**, which the PRD flagged as the axis that "may not fit a flat
directive line cleanly." The spike confirms it **does** fit, using the comma grammar
`hosts.conf` already speaks:

- `LLMDASH_HOSTS` / the file body are already a **comma**-separated list of host entries
  (comma chosen precisely so labels may contain spaces). `!display-hosts=` reuses that:
  the value is a **comma-joined list of sanitized `host:port` keys**, e.g.
  `!display-hosts=100.64.0.7:8788,laptop:8787`.
- Each key is the **same sanitized `host:port` identity** the badge already produces
  (`remotesFromCombined` / `computeMultiBadge`'s `addr`), never a free-form string
  (NFR-04). The local host uses its stable sentinel key `local:<port>` (OQ-06) — the same
  key `removeHost` already refuses to remove, so it's an established sanitized identity.
- `all` (or an absent directive) is the sentinel for "every host" — the default, and the
  byte-for-byte-today path (Evidence 6).
- **Parse is a `.split(',')` over sanitized tokens** — no nesting, no escaping, no JSON.
  A directive line holds it cleanly. **A sibling prefs file buys nothing** and would add a
  second file, a second parser, and a second write path the badge doesn't already have.

### Evidence 6 (captured stdout) — the view filter is identity for `all` (byte-for-byte guard)

```
=== (6) view filter identity for hosts=all (byte-for-byte guard) ===
  hosts=all → identity? true (same array ⇒ downstream unchanged)
  hosts=[studio] → kept [ 'Studio' ]
  hosts=[ghost] (unknown) → falls back to all? true (never an empty glyph)
```

When `hosts=all` (the default / unconfigured), the host filter returns the **same array**
`computeMultiBadge` produced — so `single`+`wide` downstream is the shipped emit path,
**unchanged** (FR-02). A subset keeps only the selected views; an all-unknown selection
**falls back to `all`** (FR-04/FR-19) — never an empty glyph. All three provable on the
emitted structure.

### Evidence 7 (captured stdout) — side-by-side cap + honest "+M more"

```
=== (7) side-by-side cap (N=3) + "+M more" honest overflow ===
  5 selected, cap 3 → ▪ A50 B50 C50 +2
  (binding-first order means the "+M more" hides the LEAST-constrained, never the tightest)
```

A 5-host selection with cap N=3 renders `▪ A50 B50 C50 +2` — three cells then a `+2`
overflow affordance (FR-17). Because `computeMultiBadge` already orders **binding host
first**, the hidden `+M` are the *least*-constrained — the tightest machine is always
shown, never truncated away. The cap never presents a truncated set as complete.

---

## Findings later stages must honor

1. **Per-tick rotation is stateless — a pure function of the wall clock**
   (`floor(epochMs/intervalMs) % count`). Do **not** persist a rotation cursor (no file,
   no in-process counter that survives a render) — the plugin process is re-spawned every
   render; a stored cursor is both unnecessary and a corruption risk. Inject the clock for
   tests (QA-18).
2. **A SwiftBar line carries ONE `color=`.** Side-by-side composes cells into **one**
   binding-colored line; per-cell state rides the **marker** (`·`/`⚠`/`—`/`⊘`), not
   per-cell color. Do not attempt per-cell color on one line — it is impossible in the
   grammar. (Alternating sidesteps this: one host per tick → one color, the shown host's.)
3. **The compact never-a-number guard is structural.** offline → `⊘`, no-reading → `—`;
   neither branch has a number path (mirror the shipped `emit`/`emitMulti` structure).
   A selected offline host is **shown with its marker**, never dropped (FR-13).
4. **The host cue disambiguates by grow-prefix-until-unique** over the SHOWN set (bounded
   to ~4 chars + positional suffix on collision), sanitize()-scrubbed. A bare initial is
   insufficient (Studio/Server collide).
5. **`!display-hosts=` is a comma-joined list of sanitized `host:port` keys** (reusing the
   `hosts.conf` comma grammar); `all`/absent = every host. `local:<port>` is the local
   sentinel. Parse is `.split(',')`; write preserves it alongside `!local` in
   `writeHostsConfig` (extend that writer to round-trip `!display-*` the same way).
6. **The view filter is identity for `all`** — the byte-for-byte-today guard rests on
   this. `single`+`wide`+`all` MUST route to the existing single/multi emit path
   unchanged; only a non-default axis engages the new rendering (FR-02, QA-02).
7. **Unknown/empty resolves to the axis default** (unknown layout/density → default;
   all-unknown host keys → `all`; never an empty glyph), logged **once** via the existing
   `host-config.js` once-latch, surfaced in health (FR-04, QA-04).
8. **Side-by-side and the rotation set share ONE cap** (default N=3–4, Designer ratifies)
   so an unwieldy selection neither sprawls the bar nor cycles a runaway list (FR-17/18).

---

## What was (not) touched — non-pollution statement

- **Not touched:** the real SwiftBar plugin dir (`~/Library/Application Support/SwiftBar/
  Plugins/llmdash.5s.js` — present on this machine, left as-is), the real badge wrapper,
  the launchd service, and the real `data/hosts.conf` (absent — not created). No scratch
  SwiftBar plugin was needed: per-tick rotation being the primary made an empirical
  SwiftBar-cycling capture unnecessary, and I decided on that basis (SPIKE-01 (a)).
- **Touched (scratchpad only, discarded):** two prototype `.mjs` files under the session
  scratchpad that `import` the tracked `computeMultiBadge` read-only and print the
  evidence above. They wrote nothing into the repo or any real config/dir. The repo
  working tree is clean apart from `pipeline/badge-display-options/`.
- **Read-only:** `scripts/menubar/llmdash.5s.js`, `src/host-config.js`, `config.js`,
  `src/health.js`, the two helper `.mjs` files, and the two reference schemas.
