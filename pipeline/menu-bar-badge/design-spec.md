# Design Spec — Menu-Bar Badge

**Feature:** menu-bar-badge
**Stage:** 4 — The Designer
**Status:** APPROVED direction, with the user's one-round refinement applied (no
longer pre-iteration DRAFT). The user approved the five-state model, dropdown layout,
symbol set (`▪` / `⚠` / `—` / `llmdash ⚠`), honesty rules, and most-constrained-window
default as-is, and steered *"it is nice to see more information if it can be presented
cleanly."* That produced two changes, both applied and reflected below: (1) the
**aging** treatment now keeps the number's status color (see the symbol table), and
(2) a compact **binding-tool cue** was evaluated and **adopted** (see its section).
OQ-03 is resolved.
**Host:** SwiftBar (documented default per `spike-report.md`); xbar is best-effort.
**Mockup:** `pipeline/menu-bar-badge/design.html`

---

## Visual Direction

The badge is the dashboard's honesty language miniaturized onto one glyph, designed
entirely *within* the established design system (`pipeline/design-system.md`) — no
new color semantics, no new vocabulary. It reuses the `--good` / `--warn` / `--crit`
status tokens and the freshness-pill grammar (`aging` → warn, `stale` → crit, fresh
→ nothing) that already ship in `public/app.js` / `styles.css`. Fresh looks
confident; degraded is visibly marked; offline and no-reading never show a number.

---

## The glyph — five states (OQ-03 resolved)

**Composition principle:** the glyph reads left to right as
`▪ <tool-cue> <number><marker>`:
- The leading `▪` is a **stable identity mark** — it never changes across states, so
  the badge is always recognizable as llmdash in a crowded menu bar.
- The **tool cue** (`C` / `X`) names *which* tool owns the binding window (see the
  tool-cue section).
- The **number, the trailing marker, and the color** carry the honest state.

This separates "which app is this" (mark) from "which tool is tight" (cue) from "what
state is it in" (number + marker + color), so the honesty signal is never diluted.

The glyph shows the **most-constrained window** — the lowest `remainingPct` across
both tools × both windows that have a reading (FR-07). Its freshness band is the
band of the tool that owns that binding window (FR-09).

### Symbol / Color table — implement verbatim

| State | Glyph line (title) | Number `color=` | Design-system token | Rule enforced |
|---|---|---|---|---|
| **fresh** | `▪ C 46%` | color of the %'s status: `#16a34a` good · `#d97706` warn · `#dc2626` crit | `--good` / `--warn` / `--crit` | Plain & confident; the number's own status color shows through. |
| **aging** | `▪ C 78%·` | **status hue kept** (same good/warn/crit as fresh) — glyph rendered at **~0.82 opacity**; trailing `·` added | `--good`/`--warn`/`--crit` at 0.82 opacity | **Keeps the status color** so "how much" is still legible, but marks the reading with a trailing `·` and a hair of de-emphasis. The **`·` is the load-bearing marker** — it distinguishes aging from fresh in a monochrome bar; the dimming is secondary. An aging reading is still instantly distinct from fresh, and never shown as *confidently* fresh. |
| **stale** | `▪ C 78% ⚠` | `#d97706` (number tinted warn) + `⚠` | `--warn` | Number tinted amber + trailing `⚠`. Present but flagged, never confident. |
| **no-reading** | `▪ —` | `#9b9ea6` | `--muted` | A dash, **never a number**; **no tool cue** (no binding tool to name). Dropdown explains why per tool. |
| **offline / error** | `llmdash ⚠` | `#8b8b8b` (dim) | `--muted` | Wordmark + slash marker, dimmed. **Never a number**, **no tool cue.** "No server" is unmistakable from "lots of headroom." |

**Status thresholds (reused, not reinvented):** remaining ≥50 → good, 20–49 → warn,
<20 → crit — the exact `statusClass()` bands from `public/app.js`.

**Two never-do rules, structural (NFR-03):**
1. An aging/stale reading is **never** shown as confidently fresh — aging adds the
   trailing `·` (and a slight opacity drop), stale marks-and-tints (`⚠` + amber). The
   trailing marker reads even in a monochrome bar, so honesty is **never
   color-alone** and never *opacity*-alone either (the `·` carries it).
2. **No number** is ever emitted in the offline state — the offline branch has no
   number path at all.

---

## The binding-tool cue (evaluated & adopted — the "more info, cleanly" steer)

The glyph shows the *tightest* number but not *which* tool it belongs to. A single
muted letter after the mark answers that at a glance:

- **`C` = Claude Code, `X` = codeX.** A fixed two-tool set, documented; `X` for
  Codex is unambiguous and stays one character.
- The cue is the **binding tool** — the tool that owns the most-constrained window
  driving the glyph number (FR-07). It is **derived**, not a new payload field.
- **Rendered muted** (`--muted` / `#9b9ea6` on the dark bar) so the eye still lands
  on the percentage first — the cue is a label, not the headline.
- It **rides the glyph's honesty state**: dimmed with the rest of the glyph on aging,
  present on stale. It is **omitted** in **no-reading** and **offline** (there is no
  binding tool to name).
- **xbar-safe:** the letter is plain text — the floor. On SwiftBar an SF Symbol tool
  glyph is *optional* polish, never a state distinction xbar would lose.

Verdict: **adopted.** On a narrow bar the cue stays a single clean token
(`▪C 46%` / `▪X 12%`), never busy, and it carries genuinely useful information —
*which* tool is about to throttle you — which is exactly the "more info, cleanly"
the user asked for. The alternative (no cue) was cleaner by one character but hid
which tool was tight until the dropdown was opened; the cue wins the trade because
it stays clean.

**Color note for the menu bar:** the menu bar is a dark strip, so the *rendered*
number values use lifted variants of the same hue for contrast (`good #5bd88a`,
`warn #f0a94b`, `crit #ff6b6b`) — same hue family as the design-system tokens, just
readable on dark. In the light dropdown the canonical tokens (`#16a34a` / `#d97706`
/ `#dc2626`) are used directly. The Engineer picks the exact `color=` per SwiftBar's
rendering; the **token mapping** (good/warn/crit/muted) is the binding contract.

---

## The dropdown (FR-11, FR-12, FR-15, FR-16)

SwiftBar renders everything after the first `---` as the dropdown. Layout, top to
bottom:

### 1. Title echo line
The glyph's title repeats as the first dropdown line: `▪ 46% remaining` with a
right-aligned **binding cue** naming which tool·window is the constraint
(`Claude · 5-hour`), and — when degraded — the band (`Claude · Weekly · stale`).
Marked identically to the glyph (status color kept + trailing `·` when aging,
amber+⚠ when stale). This is SwiftBar's natural behavior (the title line reappears at
the dropdown top) and it tells the user *why* the glyph reads what it reads. The
right-aligned binding cue also carries the full tool name (`Claude` / `Codex`), so
the letter cue is a glyph-only device — the dropdown has room to spell it out.

### 2. Per-tool groups → per-window rows (FR-12)
One group per tool (`Claude Code`, `Codex`), each with two window rows. Row grammar:

```
<window label>            <remaining>%   resets <fmtDur>
```

- **Window label** — `5-hour` / `Weekly` (the display labels; wire keys are
  `five_hour` / `seven_day`).
- **Remaining** — integer `remainingPct`, colored by status (good/warn/crit). Two
  honest special cases, **never `0%`**:
  - `limits[window] === null` → **`not available`** (muted), reset cell `—` (FR-08).
  - `remainingPct <= 0` → **`limit reached`** (crit), reset cell still shows the
    countdown. A maxed window is a valid binding constraint for the glyph (FR-12).
- **Reset** — `resets <fmtDur(resetsAt − now)>`: `d h` / `h m` / `m`, `≤0` → `now`,
  missing → `—` (FR-11). Reflects the moment the plugin last ran; needn't tick
  between runs.

### 3. Freshness tag on the tool header (FR-09)
A tool whose band is degraded gets an inline tag on its header line, reusing the
dashboard's **age-pill** vocabulary:
- `aging` → warn tag (`--warn` on `--warn-bg`)
- `stale` → crit tag (`--crit` on `--crit-bg`)
- fresh → **no tag at all** (escalation is structural, never color-alone — the tag
  word carries the meaning first).
- **Codex never gets a tag** (`freshness: null` — no band treatment).

### 4. Diagnostics block (FR-16)
Below a tool's rows, its `limitsDiagnostic` maps to one fixed honest line. Reason
codes are enums mapped via own-key (`hasOwnProperty`) lookup — **never rendered
raw**; free-form `cmd`/`detail` are sanitized (`|`, newlines stripped) first. Copy
mirrors `limitsNoteHtml`'s semantics (lead words bolded):

| reason | line |
|---|---|
| `stale-reading` | **Stale reading** — updated <age> ago; the limits may have moved since. Open a Claude Code CLI session to refresh. |
| `auto-refresh-failing` | **Auto-refresh is failing** — open a Claude Code CLI session to refresh manually. |
| `auto-refresh-disabled` | **Auto-refresh is off** (`LLMDASH_CLAUDE_AUTOREFRESH=0`) — unset it to re-enable, or open a CLI session. |
| `no-statusline-reading` | **No statusline reading yet** — open a Claude Code CLI session to capture the first reading. |
| `codex-cmd-failed` | **The codex command couldn't be run** — set `LLMDASH_CODEX_CMD` to the absolute path and restart. (+ sanitized `detail`) |
| `no-reading` (Codex) | No Codex limit reading yet. |
| *(unmapped)* | Limit reading unavailable. |

A `null` diagnostic renders nothing. A `stale-reading` **coexists** with a rendered
reading (FR-17): the glyph shows the number marked stale AND this note appears — the
window is flagged, never blanked.

### 5. Actions (FR-15)
- **`Open dashboard`** → `href=http://127.0.0.1:<port>/` (required).
- **`Refresh`** → `refresh=true` (re-runs the plugin; real behavior, not a dead
  item; optional convenience).

---

## Component Usage (design-system reuse)

| Design-system element | How the badge reuses it |
|---|---|
| Status tokens `--good` / `--warn` / `--crit` | Glyph number color, dropdown remaining % color, freshness tags. Same `statusClass()` thresholds (≥50 / 20–49 / <20). |
| Age-pill grammar (`.age-pill` + `pill-warn` / `pill-crit`) | The dropdown's per-tool freshness tag (aging → warn, stale → crit, fresh → none). Miniaturized: mono, uppercase, 999px radius, tinted bg. |
| Stale-note grammar (`.stale-note`) | The diagnostics block — lead words bolded, states the problem + names the remedy, crit/warn tinted. |
| `--muted` / `--faint` | The tool cue, no-reading dash, offline wordmark, secondary dropdown text. (Aging keeps its status hue at 0.82 opacity — it does *not* go muted.) |
| `fmtDur` / `ageBand` (from `app.js`) | Reset countdowns and band derivation — **copied verbatim** into the plugin, never re-derived. |

**No new tokens, no new patterns, no new dependencies.** The only additions are the
menu-bar/dropdown *chrome* colors, which are the OS's surfaces (a dark bar, a light
vibrancy panel), not llmdash's — the badge glyph and dropdown content live entirely
in the design system.

---

## Interaction Notes (for the Engineer)

- The glyph is a static stdout line re-rendered every 5s by the host (FR-18); no
  live tick between runs is required.
- Dropdown rows are non-interactive except the two actions; SwiftBar highlights the
  hovered row (system behavior — the mockup shows the accent highlight for realism,
  not a thing the plugin styles).
- The binding-cue on the title line — and the glyph's `C`/`X` tool cue — are both
  **derived** from the `min remainingPct` owner, not new payload fields.
- Aging's de-emphasis is a **single opacity drop on the whole glyph (~0.82)** plus
  the trailing `·`; do not re-color the number (it keeps its good/warn/crit hue).

---

## Content Notes

- All figures are realistic (Claude 5-hour 46% · Weekly 61%; Codex 5-hour 88% ·
  Weekly 72%); no lorem, no placeholder names.
- Copy is terse and honest — a menu-bar dropdown line has no room for hedging.
- Window display labels are `5-hour` / `Weekly` (mirror `public/app.js`), never the
  wire keys.
- Tool cue letters: `C` = Claude Code, `X` = Codex. Document them in the README so
  the mapping is learnable (`X` for code**X**).

---

## xbar-safe floor vs SwiftBar polish

- **Floor (always ships, xbar + SwiftBar):** every state is carried by **text/emoji
  + `color=`**. The trailing `·` (aging), `⚠` (stale), `—` (no-reading), the offline
  wordmark, and the `C`/`X` tool cue all read in a **monochrome** menu bar — the
  honesty is never color-alone, and aging is never *opacity*-alone (the `·` carries
  it even where opacity is imperceptible).
- **SwiftBar polish (optional):** the leading `▪` mark — or the `C`/`X` tool cue —
  MAY be swapped for a monochrome `sfimage=` / `templateImage=` SF Symbol on
  SwiftBar. The text forms are the floor and always ship; any SF Symbol is pure
  polish and never carries a state distinction xbar would lose.
