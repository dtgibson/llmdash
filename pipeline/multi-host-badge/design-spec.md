# Design Spec — Multi-Host Badge

**Feature:** multi-host-badge
**Stage:** 4 — The Designer
**Status:** **APPROVED by the user 2026-07-02**, as drawn — all four flagged calls
ratified to the recommended treatments: (1) glyph host-cue = the short machine name
`▪ <host>·<C|X> <pct>` truncated past 10 chars (not initials); (2) monitoring-station
= auto-detect on by default (empty-local + remotes → de-emphasize local from
glyph/headline, retained dimmed + "no local activity" in the dropdown; `!local=`
override in the config file); (3) dropdown ordering = binding (tightest) host first;
(4) Add/Remove/List actions + the osascript dialog as drawn, FR-18 copy verbatim.
**Host:** SwiftBar (documented default); xbar is best-effort.
**Mockup:** `pipeline/multi-host-badge/design.html`
**Extends:** `pipeline/menu-bar-badge/design-spec.md` (the shipped single-host badge) —
this spec adds exactly one axis (HOST) and reuses everything else verbatim.

---

## Visual Direction

Within the established design system, the badge is extended by a single new axis —
**host** — layered in front of the shipped tool axis. No new color semantics, no new
vocabulary: it reuses the `--good` / `--warn` / `--crit` status tokens, the
age-pill grammar (`aging`→warn, `stale`→crit, fresh→nothing), and the `.stale-note`
callout, now applied **per machine** on the menu-bar surface — the same honesty
language the multi-host *dashboard* already uses, miniaturized onto one glyph and one
dropdown. The only new chrome is a host-header row and a host-level freshness/offline
pill. When one machine is watched, none of the host chrome renders and the badge is
byte-for-byte what shipped (FR-13).

---

## The glyph host-cue treatment (OQ-05 — the binding spec)

**Composition (multi-host mode):** the glyph reads left to right as
```
▪ <host>·<C|X> <pct><marker>
```
- **`▪`** — the stable llmdash identity mark, unchanged across every state.
- **`<host>`** — the **new host cue**: the binding host's escaped label, rendered
  at full length up to **10 characters**, then truncated with a trailing `…`
  (e.g. `Studio VM…`). Rendered in the menu-bar text color at ~0.92 opacity — a
  locator, dim enough that the eye still lands on the number. The **dropdown header
  always carries the full escaped label**, so truncation never hides identity.
- **`·`** — a hairline separator (`--menubar-text-dim`) binding host to tool so the
  two read as **one token**. This is *not* a state marker.
- **`<C|X>`** — the shipped tool cue (`C`=Claude, `X`=codeX), unchanged, dim.
- **`<pct><marker>`** — the shipped number + honesty marker + color, unchanged.

**Chosen form vs. alternatives (mockup shows all three):**
- **`<host>·<C|X>` full short label (chosen).** Legible at a glance — you read the
  machine name, not a cipher. One clean token on a narrow bar.
- *Initials (`DT·C`)* — rejected: shortest, but a 2-letter initial is guessable, not
  legible; you re-learn which machine `DT` is. Saves space the bar doesn't need.
- The **10-char truncation rule** handles the long-label case without letting the
  glyph sprawl.

**xbar-safe:** the host cue is plain text + `color=`, exactly like every other glyph
element — nothing depends on a SwiftBar-only param. It is the floor; any SF Symbol is
optional polish.

**The two dots never collide.** The host separator `·` sits **before** the tool cue;
the aging marker `·` sits **after** the number. `▪ Work laptop·X 31%·` is
unambiguous — one binds host→tool, one flags aging.

**Host cue rides the honesty state**, exactly as the tool cue does:
- **fresh** — plain, host cue at full opacity.
- **aging** — host cue kept, whole glyph ~0.82 opacity, trailing `·` after the number.
- **stale** — host cue kept, amber number + trailing `⚠`. *You still know which
  machine is stale.*
- **no-reading** — host cue **omitted** (no binding host to name): `▪ —`.
- **local offline** — host cue **omitted**: `▪ llmdash ⚠`. This is the badge's own
  local llmdash instance being unreachable — **distinct** from a single *remote* host
  being down, which is a per-host dropdown line, never the glyph.

**Single-host / unconfigured = today's badge, exactly (FR-13).** When only the local
host is effectively watched, the entire host cue (label + separator) is **omitted** —
the glyph is `▪ C 46%`, byte-for-byte the shipped single-host badge. Multi-host
chrome engages **only** when effective host count > 1.

### Glyph binding table (implement verbatim)

| Mode / state | Glyph | Host cue | Rule |
|---|---|---|---|
| multi · fresh | `▪ Desktop·C 12%` | `<host>·<C\|X>`, ≤10 chars then `…` | Binding host + tool named before the number; number in its own status color. |
| multi · aging | `▪ Work laptop·X 31%·` | kept, glyph ~0.82 opacity | Trailing `·` after the number; host `·` before the tool cue — never collide. |
| multi · stale | `▪ Desktop·C 12% ⚠` | kept | Amber number + trailing `⚠`; still names which machine is stale. |
| multi · no-reading | `▪ —` | omitted | No host on any machine has a reading; dash, never a number. |
| local offline | `▪ llmdash ⚠` | omitted | Local llmdash down; wordmark + slash, never a number. A remote being down is a dropdown line. |
| single-host | `▪ C 46%` | **none** | Byte-for-byte today's badge (FR-13). |

**Colors:** design-system status tokens, lifted for the dark bar (`good #5bd88a`,
`warn #f0a94b`, `crit #ff6b6b`), same hue family as `--good`/`--warn`/`--crit`. The
light dropdown uses the canonical tokens directly.

---

## The dropdown — one section per host (FR-09/FR-10)

SwiftBar renders everything after the first `---` as the dropdown. Top to bottom:

### 1. Title echo + scope line
- **Title echo** — the glyph line repeated, now naming the **binding host + tool +
  window** with full names: `▪ 12% remaining` with a right-aligned binding cue
  `Desktop · Claude · 5-hour`. Marked identically to the glyph (color/marker).
- **Scope line** — `Watching 4 machines · 1 not reachable` (counts **all** monitored
  machines including this one), so the scope is honest before any host section.

### 2. One section per host
Each host section is a **host header** wrapping that host's **existing per-tool rows**:

- **Host header:** escaped `label` (mono, bold) + optional status pill + a right-aligned
  freshness/offline state:
  - `binding` pill (accent) on the host driving the glyph number.
  - `you` pill (muted) on the local host.
  - a **freshness pill** (`aging`→warn, `stale`→crit) or **offline pill**
    (`unreachable`→crit) reusing the age-pill grammar; fresh → a `updated Ns ago`
    with a good pulse dot, **no pill** (escalation is structural).
- **Per-tool rows:** the shipped rows, unchanged — `5-hour` / `Weekly`, indented under
  a small `Claude Code` / `Codex` sub-header, each `N% · resets <fmtDur>`, with the
  honest special cases `not available` (null window) and `limit reached` (maxed),
  **never `0%`**. Remaining % colored by the same `statusClass()` thresholds.

### 3. Ordering
**Binding host first**, then the remaining **reachable** hosts in config order, then
**offline/unreachable** hosts, then the **de-emphasized local host** pinned last.
Rationale: the binding host is why the glyph reads what it reads — it earns the top
slot; the empty local host is the least urgent, so it sits at the bottom. *(This
ordering is a Designer call and a candidate for user feedback — the alternative is
strict config order with only the binding pill for emphasis.)*

### 4. Offline / unreachable host (FR-10)
A host with `reachable:false` / `state:null` renders a **named offline note** reusing
the `.stale-note` grammar (crit-tinted, left accent border) carrying **which host and
why**, mapped by own-key lookup from `hostDiagnostic.reason` with `detail` sanitized —
**never** a fabricated zero, **never** stale-as-fresh, **never** dropped. One host's
offline/degraded state never flags or suppresses another's section.

| `hostDiagnostic.reason` | dropdown line |
|---|---|
| `peer-unreachable` | `<label> is unreachable — no response within 3s. Check the machine is awake and llmdash is running on <host:port>. Its limits aren't shown while it's offline; the other machines are unaffected.` |
| `peer-error` | `<label> returned an error (<cause>).` |
| `pending` | `<label> — not polled yet; fills in on the next update.` |

The reserved codes `auto-refresh-failing` / `auto-refresh-disabled` are **not**
reused for host failures.

---

## Monitoring-station de-emphasis (FR-19/FR-20 — OQ-04)

**Auto-detect default (recommended, shipped):** when the **local host has no readings**
(all tools report no limit reading / no activity) **and ≥1 remote host is configured**,
the local host is **excluded from the glyph and the dropdown headline** — the empty
local reading never dominates the glance. Auto-detected client-side in
`computeMultiBadge`; no server change.

**Presentation of the retained local section (the honesty floor, FR-20):** the local
host is **still shown** as its own dropdown section, **pinned last**, at **~0.72
opacity**, with:
- a muted **`no local activity`** idle pill on its header (not a freshness/offline
  pill — it isn't stale or unreachable, it's honestly idle),
- a muted note: *"This Mac isn't running Claude or Codex — it's watching the machines
  above. Kept out of the glyph so the machines you're watching stay loudest. No
  reading is fabricated."*

De-emphasis changes **prominence** (out of glyph/headline, dimmed, last), never
**honesty** (the section is present and true; no zeros are invented).

**Explicit override (real knob, no dead knob):** the in-file `!local=` directive —
`exclude` (always de-emphasize) / `include` (always show in glyph/headline, defeat
auto-detect) / `auto` (default). It lives in `hosts.conf` alongside the host list the
operator already edits from the badge, so no plist edit + restart is needed to change
it.

---

## The Add / Remove / List actions (FR-14 — the headline UX)

Appended to the dropdown after the shipped `Open dashboard` / `Refresh`, above them a
`---` separator:

```
＋ Add host…                 → osascript dialog → sanitize/validate/dedupe → atomic append
－ Remove host…      ▸        → submenu: one item per REMOVABLE host (never "This machine")
       ↳ Stop watching Desktop…      100.64.0.7:8788
       ↳ Stop watching Work laptop…  laptop:8787
       ↳ Stop watching Studio VM…    100.64.0.9:8790
☰ Watching: 3 hosts          → a live listing of the current remote set (escaped labels)
```

- **Layout:** small leading glyph icon (`＋` / `－` / `☰`), the label, a right-aligned
  submenu caret (`▸`) on Remove. `Watching: N hosts` is a non-interactive listing line
  (muted), a real affordance (counts the configured **remotes**; the title echo's
  "N machines" includes this machine, so `Watching: 3 hosts` ↔ "Watching 4 machines").
- **Remove submenu** lists only `!self` hosts, each with its `host:port` address; the
  local host is **never** offered.
- Each action runs a **local helper** under the wrapper's absolute node
  (`terminal=false`, `refresh=true`) — **no HTTP mutation**. After a write the badge
  refreshes so the dropdown reflects the new list; the monitoring change applies on
  the **next poller update** (the copy never claims it's live before then).

### The osascript dialog copy (FR-18 — verbatim, honest + validating)

| Moment | String |
|---|---|
| **Add prompt** | `Add a machine to watch. Enter its Tailscale hostname or IP — optionally host:port or host=Label (e.g. 100.64.0.7:8788=Desktop).` |
| **Invalid** (nothing written) | `That doesn't look like a valid host — nothing was added. Expected host[:port][=label].` |
| **Duplicate** (deduped) | `That host is already being watched. <label> (<host:port>) is already in your list — nothing changed.` |
| **Post-add** | `Added <host> — it'll appear on the next update.` |
| **Remove confirm** | `Stop watching <label> (<host:port>)?` — buttons `Cancel` / `Stop watching`. |
| **Write failure** | `Couldn't save the host list — <reason>. Nothing changed.` |

The AppleScript is a **fixed literal**; the typed value leaves `osascript` via
`text returned of result` on ARGV/stdout only — never string-concatenated into
AppleScript or a shell command.

---

## Copy table — every new user-facing string

| String | When it appears |
|---|---|
| `Watching N machines · M not reachable` | Dropdown scope line, under the title echo. Counts all monitored machines incl. this one. |
| `<host> · <Tool> · <window>` | Title-echo binding cue (full names, not the C/X glyph letter). |
| `binding` | Pill on the host header driving the glyph number. |
| `no local activity` | Idle pill on the de-emphasized local host (auto-detected). |
| `This Mac isn't running Claude or Codex — it's watching the machines above. Kept out of the glyph so the machines you're watching stay loudest. No reading is fabricated.` | The de-emphasized local host's note. |
| `<label> is unreachable — no response within 3s. Check the machine is awake and llmdash is running on <host:port>. Its limits aren't shown while it's offline; the other machines are unaffected.` | Per-host offline note (`peer-unreachable`). |
| `<label> returned an error (<cause>).` | Per-host error note (`peer-error`). |
| `<label> — not polled yet; fills in on the next update.` | Per-host pending note. |
| `Add host…` | Edit action. |
| `Add a machine to watch. Enter its Tailscale hostname or IP — optionally host:port or host=Label (e.g. 100.64.0.7:8788=Desktop).` | osascript add prompt. |
| `That doesn't look like a valid host — nothing was added. Expected host[:port][=label].` | Invalid rejection (nothing written). |
| `That host is already being watched. <label> (<host:port>) is already in your list — nothing changed.` | Duplicate rejection (deduped). |
| `Added <host> — it'll appear on the next update.` | Post-add confirmation. |
| `Remove host…` | Edit action (opens submenu). |
| `Stop watching <label>…` | Submenu item, one per removable host. |
| `Stop watching <label> (<host:port>)?` | Remove confirm dialog. |
| `Watching: N hosts` | Live listing line (current remote set). |
| `Couldn't save the host list — <reason>. Nothing changed.` | Write failure. |

---

## Component Usage — reuse vs. new chrome

| Element | Source | Reuse / new |
|---|---|---|
| Glyph five-state grammar, tool cue, colors, markers | shipped badge spec | **Reused verbatim.** |
| Status tokens `--good`/`--warn`/`--crit` + thresholds | design system | **Reused.** Host pills, remaining %, glyph. |
| Age-pill grammar (`pill-warn`/`pill-crit`) | design system | **Reused** for per-host freshness + offline pills. |
| `.stale-note` callout | design system | **Reused** for the per-host offline note + the de-emphasized-local note. |
| Per-tool rows (`N% · resets …`, `not available`, `limit reached`) | shipped badge | **Reused verbatim** inside each host section. |
| `fmtDur` / `ageBand` / `sanitize` / `sanitizeHostPort` | shipped badge | **Reused verbatim** (already in the plugin). |
| **Host header row** (escaped label + address + status pill) | — | **New chrome** — mirrors the multi-host dashboard's `.host-head`. |
| **Host-level freshness/offline pill** | — | **New chrome** — the age-pill grammar at host scope, mirrors dashboard `.host-pill`. |
| **`no local activity` idle pill + de-emphasis** | — | **New chrome** — muted pill + ~0.72-opacity section (monitoring station). |
| **Add / Remove / List actions + submenu** | — | **New chrome** — SwiftBar action items + a Remove submenu + the osascript dialog. |

**Design-system extension: minimal.** No new tokens, no new color semantics. The new
chrome is structural (a host header, a host pill, the edit actions) built entirely
from existing tokens and the dashboard's own host-group vocabulary.

---

## Interaction Notes (for the Engineer)

- The glyph is a static stdout line re-rendered each interval; no live tick between runs.
- Host sections, pills, and the offline/de-emphasis notes are derived from `/api/hosts`
  fields — **no new payload field** (monitoring-station de-emphasis is a client-side
  derivation in `computeMultiBadge`; the `!local=` override is the only config input).
- The Remove submenu is built from the `!self` hosts in the current list; each item
  passes the host **key** to the remove helper on ARGV.
- Every free-form field (host/tool label, diagnostic detail) is `sanitize()`d before a
  line; host/port on any `href=` is `sanitizeHostPort`'d. The `Open dashboard` href
  uses **this machine's** loopback, never a peer's.
- After a config write: `refresh=true` re-renders the dropdown; the monitoring change
  applies on the next poller tick. Copy says "on the next update," never "live now."

---

## Content Notes

- Realistic scenario throughout: a monitoring station watching **Desktop** (Claude 5h
  12%, the binder), **Work laptop** (Codex 5h 88% / weekly 61%, Claude not available),
  **Studio VM** (unreachable), and **This machine** (no local activity). No lorem, no
  placeholder names, no fabricated zeros.
- Window display labels `5-hour` / `Weekly` (mirror the dashboard), never wire keys.
- Copy is terse and honest — a menu-bar line has no room for hedging — and every
  degraded/offline/empty state names the machine and the remedy.

---

## xbar-safe floor vs SwiftBar polish

- **Floor (always ships, xbar + SwiftBar):** every glyph state — including the host
  cue — is text/emoji + `color=`. The host separator `·`, the aging `·`, `⚠`, `—`,
  the offline wordmark, and the `C`/`X` cue all read in a monochrome bar.
- **SwiftBar polish (optional):** the leading `▪` or the tool cue MAY be swapped for a
  monochrome SF Symbol; never a state distinction xbar would lose. The host cue stays
  text (a machine name has no universal glyph).
