# PRD — Menu-Bar Badge
**Feature:** menu-bar-badge
**Date:** 2026-07-02
**Stage:** 2 — The Planner
**Source:** strategic-brief.md (approved)

---

## Feature Overview

A macOS menu-bar badge that keeps the current remaining AI-coding-usage
percentage glanceable in the corner of the screen, with a dropdown carrying the
full picture (both tools × both windows, reset countdowns, freshness). It is a
**pure consumer** of the dashboard's existing `/api/state` payload: llmdash ships
one tiny **zero-dependency plugin script** that a user-installed menu-bar host
(SwiftBar or xbar) executes on an interval and renders. llmdash itself gains
**zero runtime dependencies and no build step**; the menu-bar host is a disclosed
external prerequisite the user installs once, not an llmdash dependency.

### The host-choice spike (decided by Stage 3)

The brief settles the *mechanism* (a menu-bar-host plugin, not a native compiled
app) but leaves **which host is the documented default** open. Stage 3 resolves
it with a small spike (FR-01). Requirement tags:

- **untagged** — applies to whichever host ships (the plugin's stdout contract,
  the data logic, the honesty model, the docs). This is the bulk of the PRD.
- **[SB]** — SwiftBar-specific (the recommended-primary host in the brief).
- **[XB]** — xbar-specific.

The [SB]/[XB] deltas are deliberately **small**: both hosts execute a script and
render its stdout as a menu-bar line plus a `---`-delimited dropdown, and both
read the refresh interval from the plugin **filename** (`name.<interval>.js`).
They differ only in per-line styling parameter names/support and packaging
details. One host ships as the documented default; the other is a
best-effort note, not a maintained parallel target (brief: "pick one as the
documented default, don't try to support both perfectly").

### The wire contract this plugin consumes (authoritative field names)

Every field below is named exactly as `src/server.js` `buildState()` emits it and
exactly as `public/app.js` reads it. The plugin **mirrors the web client's
logic** (`ageBand`, `fmtDur`, the `limitsDiagnostic` reason mapping); it does not
reinvent or recompute anything.

- `state.tools[]` — array; each tool object has:
  - `source` (`"claude-code"` | `"codex"`), `label` (`"Claude Code"` | `"Codex"`), `plan`.
  - `haveLimits` (bool).
  - `limits.five_hour` and `limits.seven_day` — each **either `null`** (no reading)
    **or** `{ usedPct, remainingPct, resetsAt, capturedAt }`. `remainingPct` is
    already `Math.max(0, 100 - usedPct)` and server-clamped; the plugin reads it,
    never recomputes it.
  - `freshness` — Claude: `{ capturedAt, freshForMs, staleAfterMs }`; **Codex: `null`**.
  - `limitsDiagnostic` — `null`, or `{ reason, … }` (see reason codes below).
  - `dataAt` (newest capturedAt across that tool's windows, or `null`), `plan`.
- `state.generatedAt` — ISO timestamp of the payload.
- Window keys on the wire are **`five_hour`** and **`seven_day`**; the display
  labels are **"5-hour"** and **"Weekly"** (mirror `public/app.js`).
- Diagnostic `reason` values that already cross the wire (do not invent new ones):
  `auto-refresh-failing` (carries `cause`), `auto-refresh-disabled`,
  `no-statusline-reading`, `stale-reading` (carries `capturedAt`, `ageMs`) — Claude;
  `codex-cmd-failed` (carries `cmd`, `detail`), `no-reading` — Codex.

### Defaults decided here (at a glance)

| Decision | Default | Justification |
|---|---|---|
| Data source | `GET http://127.0.0.1:<port>/api/state` | The one existing payload; loopback because the plugin runs on the same Mac as the server. Never a second data path. |
| Port / base URL | `8787`, overridable | Honors the shipped `LLMDASH_PORT` convention (FR-14) so a non-default dashboard still works. |
| Glyph number | Lowest `remainingPct` among windows-with-a-reading, across both tools (the most-constrained window) | The binding constraint is what causes a lockout; matches `computeHeadroom`'s "tightest window" framing (brief Key Decisions). |
| Refresh interval | ~5 s, encoded in the plugin **filename** (`llmdash.5s.js`) | The host re-runs the script on this cadence; 5 s is glance-fresh without hammering loopback. The dashboard's own reading freshness is governed server-side, not by this cadence. |
| Fetch timeout | short (≤ ~2 s) | A hung fetch must never freeze the menu bar; timeout → the offline/error state. |
| Interpreter | absolute `node` path resolved at install (or a shebang the host env can honor) | The host spawns with a **minimal PATH**, mirroring the codex/claude launchd-PATH lesson (FR-13). |

---

## User Stories

> **US-01** — As someone pacing AI-coding work across Claude Code and Codex, I
> want the most-constrained remaining-usage % sitting in my menu bar and updating
> on its own, so that pacing becomes ambient and I never have to open the
> dashboard just to check whether I'm about to be throttled.

> **US-02** — As that same user, I want to open the badge's dropdown and see the
> full picture — both tools, both windows, remaining % and reset countdowns —
> so that when the one-glance number is low I immediately know which tool still
> has room and when the tight window resets.

> **US-03** — As someone who trusts this tool *because* it is honest, I want a
> stale, aging, or unavailable reading to look visibly different from a fresh one
> in the menu bar itself, so that I am never shown a confident number that is
> secretly hours old.

> **US-04** — As that user, I want the badge to degrade honestly when the
> dashboard isn't running — an "offline"/"—" state, never a fabricated or
> last-cached-as-if-fresh number — so that "no server" is unmistakable from "lots
> of headroom."

> **US-05** — As the owner of this zero-dependency tool, I want the badge to add
> **no runtime dependency and no build step** to llmdash, and I want its one
> external requirement (the menu-bar host) disclosed loudly in the README and
> install path — not silently assumed — so the badge doesn't betray the
> constitution or spring a surprise install on me.

> **US-06** — As a user who runs the dashboard on a non-default port, I want the
> badge to honor `LLMDASH_PORT` (or a single documented one-line edit), so the
> badge works with my actual setup and I'm never handed a knob that drives
> nothing.

---

## Functional Requirements

### The host-choice spike (Stage 3) — every outcome

> **FR-01** — Stage 3 shall resolve **which host is the documented default**
> ([SB] or [XB]) with a small spike **before the plugin's stdout format is
> committed**, by actually installing the candidate host, dropping the plugin in
> its plugin directory, and verifying the host renders the plugin's output format
> correctly: the menu-bar line, the `---`-delimited dropdown, and every honest
> state (fresh / aging / stale / no-reading / offline) all display as intended.
> Exactly one host is chosen as the default; the other is documented as a
> best-effort note, not built to parity.

> **FR-02** — The spike's **success signal** is a working install of the chosen
> host on the target Mac showing: (a) the glyph updating on the filename-encoded
> interval, (b) the dropdown rendering both tools × both windows, and (c) at
> least the offline state and one degraded (aging/stale) state visibly distinct
> from fresh — evidenced by capture (screenshot or described observation) in the
> spike record. The spike shall also confirm the plugin runs under the host's
> **spawn environment** (minimal PATH), resolving the interpreter question of
> FR-13 concretely for the chosen host.

> **FR-03** — Spike budget and record: the spike is a single host install plus a
> handful of plugin-format iterations on one machine (no multi-host parity work,
> no unrelated exploration). It shall record, in
> `pipeline/menu-bar-badge/spike-report.md` (or the architecture doc), the chosen
> host, the evidence for FR-02, the exact plugin-filename interval convention and
> stdout-styling parameters the chosen host honors, and any [SB]/[XB] delta later
> stages must respect.

### Data source & pure-consumer contract — every host

> **FR-04** — The plugin shall obtain its data **solely** by fetching
> `http://127.0.0.1:<port>/api/state` (default port `8787`, per FR-14) over plain
> HTTP using Node builtins (`http.get`) or a POSIX equivalent. It shall introduce
> **no second data path**: it never reads the statusline file, the SQLite DB,
> Claude/Codex logs, or any source the dashboard reads — only the assembled
> payload the server already serves.

> **FR-05** — The plugin shall **not recompute or re-derive limit numbers**. It
> reads `remainingPct` (already clamped 0–100 server-side), `resetsAt`,
> `capturedAt`, `freshness`, and `limitsDiagnostic` as given. It performs only
> presentation math the web client already performs: selecting the minimum
> `remainingPct`, deriving the freshness band from server-supplied thresholds
> (FR-09), and formatting countdowns (FR-11).

> **FR-06** — The plugin shall parse the payload defensively: a non-200 response,
> a connection failure/timeout, or malformed/unparseable JSON shall be treated as
> the **server-offline/error** state (FR-10) — never a crash, never a partial or
> fabricated reading. A field absent or `null` where a reading is expected is the
> honest "no reading" case for that window (FR-08), not an error.

### The menu-bar glyph — every host

> **FR-07** — When at least one window across the tools has a reading, the
> menu-bar glyph shall show the **most-constrained window**: the **lowest
> `remainingPct` among all windows (both tools × both windows) that have a
> reading**, rendered as an integer percentage with a compact cue
> (e.g. `◉ 78%`). Windows whose `limits[window]` is `null` are excluded from the
> minimum. The dropdown (FR-12) carries the full breakdown; the glyph shall not
> attempt to show both tools inline.

> **FR-08** — Per-window and whole-badge no-reading handling:
> - A single window with `limits[window] === null` is **excluded** from the
>   glyph minimum (FR-07) and shown as **"not available"** for that window in the
>   dropdown (FR-12) — never rendered as `0%` or any fabricated number.
> - When **no window on either tool** has a reading (both tools have no limit
>   data), the glyph shall show the honest **no-data** state (e.g. `◉ —`, not a
>   number), and the dropdown shall explain per tool why (mapped from each tool's
>   `limitsDiagnostic`, FR-16).

> **FR-09** — The plugin shall derive the freshness band exactly as the web
> client does (`ageBand` in `public/app.js`), using the **server-supplied
> thresholds** on the tool's `freshness` object, never hardcoded values: with
> `age = now − Date.parse(freshness.capturedAt)`, `age > staleAfterMs` → **stale**,
> `age > freshForMs` → **aging**, otherwise **fresh**; a `null` `freshness` or
> absent `capturedAt` (Codex has no freshness) → **no band treatment**. The band
> governing the glyph is the band of the tool that owns the glyph's binding
> window (FR-07); the freshest applicable band is used when the binding window's
> tool has none.

> **FR-10** — The glyph shall render **five visibly distinct states**, and the
> plugin shall never show a confident number that is secretly stale or fabricate a
> number when the server is unreachable:
>
> | State | Trigger | Glyph shows |
> |---|---|---|
> | **fresh** | binding window's band = fresh (or Codex-owned, no band) | the number, plain/confident: `◉ 78%` |
> | **aging** | binding band = aging | the number, marked: e.g. `◉ 78%·` or a dimmed/`~`-prefixed variant |
> | **stale** | binding band = stale | the number, clearly marked stale: e.g. `◉ 78% ⚠` or dimmed |
> | **no-reading** | no window on either tool has a reading (FR-08) | `◉ —` (a dash, not a number) |
> | **offline/error** | fetch failed / timed out / bad JSON (FR-06) | `◉ ✕` or `llmdash —` (unmistakably "no server", never a number) |
>
> Exact glyph symbols and any dim/color treatment are the Designer's call within
> the chosen host's styling capabilities; the **five-state distinctness and the
> two never-do rules are the requirement.**

### The dropdown — every host

> **FR-11** — Reset countdowns in the dropdown shall be formatted with the same
> rules the web client uses (`fmtDur` in `public/app.js`): `resetsAt − now`
> rendered as `d h`, `h m`, or `m`, with `≤ 0` shown as **"now"** and a missing
> `resetsAt` shown as **"—"**. Countdowns need not tick between the host's script
> re-runs; each render reflects the moment the script ran.

> **FR-12** — The dropdown shall list, for **each tool (Claude Code, Codex) and
> each window (5-hour, Weekly)**, a row carrying: the tool label, the window
> label, `remainingPct` (integer) or **"not available"** when that window has no
> reading, and the reset countdown (FR-11). A window at `remainingPct <= 0` shall
> read **"limit reached"** (mirroring the web client's maxed-window copy), and its
> tool/window is a valid binding constraint for the glyph (FR-07). The dropdown
> shall also surface each tool's freshness/diagnostic state (FR-16) and at minimum
> an **"Open dashboard"** action (FR-15).

### Diagnostics & honesty copy — every host

> **FR-16** — Each tool's `limitsDiagnostic` shall be mapped to **short honest
> dropdown copy**, reusing the web client's mapping *semantics* (not its HTML):
> `stale-reading` / `auto-refresh-failing` / `auto-refresh-disabled` /
> `no-statusline-reading` (Claude) and `codex-cmd-failed` / `no-reading` (Codex)
> each map to a fixed short line naming the state and, where the web client does,
> the remedy. The `reason` code and `cause` category cross the wire as enums and
> shall be mapped, **never rendered raw**; an unmapped code falls back to a
> generic honest line. Any free-form field (`cmd`, `detail`) shall be **escaped or
> omitted** before display — a menu-bar line has no HTML, but untrusted text is
> still never rendered blindly (own-key lookup only, per the shipped
> `hasOwnProperty` convention). A `null` diagnostic renders no note.

> **FR-17** — A non-null diagnostic that **coexists with a rendered reading**
> (`stale-reading`: gauges keep rendering the last capture) shall behave the same
> in the badge: the glyph still shows the number **marked stale** (FR-10), and the
> dropdown shows both the number and the stale note. The badge never blanks a
> window that still has a last capture; it flags it.

### Actions — every host

> **FR-15** — The dropdown shall include an **"Open dashboard"** item that opens
> the dashboard URL (`http://127.0.0.1:<port>/`, or the tailnet/localhost URL the
> user browses) in the default browser via the host's link mechanism
> (`href=`/`| href=…` param). A **"Refresh"** item (re-runs the plugin) MAY be
> included if the chosen host supports it cheaply (`refresh=true`); it is optional
> convenience, not required, and drives real behavior if present (no dead item).

### Configuration — every host

> **FR-14** — The plugin shall honor the dashboard's configured port so a
> non-default `LLMDASH_PORT` still works, with **no dead knob**. The Architect
> shall pick the honest-simplest mechanism that actually works under the host's
> spawn environment, and justify it: **either** the plugin reads `LLMDASH_PORT`
> from its environment (only viable if the host reliably passes the user's env to
> plugins — to be confirmed in the FR-01 spike), **or** a single clearly-labeled
> one-line constant at the top of the plugin file (documented in the install
> steps) that the user edits once. If env-reading is unreliable under the chosen
> host, the documented one-line edit is the default. Whatever ships, it shall be
> the *only* config surface and it shall drive the fetch URL for real.

### Zero-dependency, no-build, host environment — every host

> **FR-13** — The plugin shall be **Node-builtins-only** (`http.get` to loopback;
> no npm packages) **or** POSIX shell using tools present on a stock macOS, with
> **no build step**. Because the menu-bar host spawns the plugin under a **minimal
> PATH** (the same class of problem as the codex/claude launchd-PATH lesson —
> DECISIONS.md 2026-07-01), the plugin shall be invocable without relying on a
> user login PATH: its shebang/interpreter shall resolve `node` via an **absolute
> path** (baked at install, mirroring how the installer resolves codex/claude) or
> a host-honored mechanism the FR-01 spike confirms. An unresolved interpreter is
> an install-time failure surfaced with the fix — never a silently dead badge.

### Disclosure, install & docs — every host

> **FR-18** — The plugin shall ship in the repo at a **SwiftBar/xbar-convention
> path and filename** that encodes its refresh interval — default
> `scripts/menubar/llmdash.5s.js` (the `.5s.` segment is the host's
> interval convention; adjust the number, not the pattern, if the spike picks a
> different cadence). The location is documented so the user knows exactly what to
> copy/symlink into the host's plugin directory.

> **FR-19** — The README shall document the badge honestly and prominently, per
> the "surface environmental prerequisites, never silently" convention:
> - The menu-bar host is a **user-installed third-party app** — name the chosen
>   default host and the exact one-time command (e.g.
>   `brew install --cask swiftbar`), stated as a prerequisite the user installs,
>   **not** an llmdash dependency and **never** auto-installed.
> - The one-time plugin install: copy or symlink `scripts/menubar/llmdash.5s.js`
>   into the host's plugin directory, mark it executable, and point the host at
>   that directory.
> - The port config (FR-14): how the badge learns the port and what to change for
>   a non-default `LLMDASH_PORT`.
> - The honest reality that the badge shows an **offline** state when the
>   dashboard service isn't running, and reflects the same freshness/diagnostic
>   states as the dashboard (it is not a second, independent reading).

> **FR-20** — The macOS installer (`scripts/install-macos.sh`) **MAY** optionally
> offer to set up the plugin (e.g. symlink it into a detected SwiftBar/xbar plugin
> directory and bake the absolute `node` path per FR-13), but shall **never
> auto-install SwiftBar/xbar itself** — installing the third-party host stays the
> user's explicit action. Any such convenience shall be opt-in and print exactly
> what it did and what the user must still do (install the host, if absent). If
> the installer touches the plugin at all, a new **data-source health line**
> (`healthLines()` in `src/health.js`) MAY note the badge's prerequisite (host
> present? plugin linked?) in the honest present/missing form the readout already
> uses; this is optional and, if added, stays a cheap fs check off the request
> path.

---

## Non-Functional Requirements

> **NFR-01 — Zero runtime dependencies / no build:** The feature shall add **no**
> npm runtime dependency to llmdash and **no** build step. The plugin uses Node
> builtins or stock POSIX shell only. `package.json` runtime dependencies stay at
> zero.

> **NFR-02 — Request-path & resource isolation:** The plugin runs out-of-process
> under the menu-bar host on its own interval; it adds **no** work to the
> dashboard's HTTP request path beyond one ordinary `GET /api/state` per host
> tick (an already-served, cheap endpoint). The plugin does no subprocess spawning
> of its own, no polling of tool CLIs, and no disk scanning.

> **NFR-03 — Honesty (product-core, non-negotiable):** The badge shall never
> present a stale/aging reading as confidently fresh, never fabricate a number
> when the server is unreachable, and never show `0%`/a zero where a window simply
> has no reading. Every degraded state (aging, stale, no-reading, offline) is
> visibly distinct in the glyph (FR-10) and named in the dropdown (FR-12, FR-16).

> **NFR-04 — Security & untrusted-text handling:** Diagnostic `reason`/`cause`
> codes are treated as enums mapped to fixed copy (own-key lookup only); free-form
> payload fields (`cmd`, `detail`) are escaped or omitted before display. The
> plugin makes only a loopback GET, sends no credentials, and writes nothing to
> Claude/Codex-owned paths. It performs no shell interpolation of any payload
> value.

> **NFR-05 — Resilience:** A slow or unreachable dashboard shall never hang the
> menu bar: the fetch is bounded by a short timeout (FR-06) and any failure lands
> in the offline/error state. A malformed payload never crashes the plugin (a
> crashing plugin makes the host show its own error state, which is acceptable as
> a last resort but shall not be the plugin's normal failure path).

> **NFR-06 — Platform:** macOS is the validation target (the deployment reality:
> launchd service, `macos/`, `install-macos.sh`; SwiftBar/xbar are macOS hosts).
> The plugin's data logic is host-agnostic and would port to a future
> Linux/tmux/tray consumer, but no non-macOS surface is built or validated here.

---

## Out of Scope

- **A native Swift/AppKit or Electron menu-bar app.** The rejected mechanism
  (brief §Mechanism 2); it introduces a build step and an off-stack language and
  would only be reconsidered as a founding-brief-level reversal.
- **Any new data path, poller, or limit recomputation.** The badge is a pure
  consumer of `/api/state`; it never forks the store, re-reads the raw sources,
  or re-derives limits.
- **Alerts / notifications when running low.** That is Up Next item 2 ("Limit
  alerts"), a separate feature; the badge is passive/glanceable, not a push.
- **Full parity of the dashboard's activity stats, trends, or charts** in the
  badge. The badge is limits-remaining + freshness only; the dashboard stays the
  place for the deep view.
- **The `tmux` / terminal statusline consumer.** Noted as a cheap follow-on that
  reuses the same emitter logic, but explicitly not built here (must not expand
  this feature's scope).
- **Cross-platform menu-bar / tray support (Windows/Linux).** macOS only; a Linux
  tray is a possible later source-aware-style follow-on.
- **Bundling or auto-installing SwiftBar/xbar.** llmdash documents the
  prerequisite and may optionally symlink the plugin; it never vendors or silently
  installs the third-party host (FR-20).
- **Maintaining both SwiftBar and xbar to full parity.** One host is the
  documented default (FR-01); the other is a best-effort note.
- **Any change to the `/api/state` payload, the freshness bands/thresholds, or
  the diagnostic reason codes.** The badge consumes the existing contract
  unmodified; if the badge appears to need a payload change, that is a flag to
  raise, not a silent extension.

---

## Open Questions

> **OQ-01 — Which host is the default, SwiftBar or xbar?**
> **Default assumption:** SwiftBar — the brief's recommended primary (more
> actively maintained, notarized, Swift-native successor). The FR-01 spike may
> pick xbar if SwiftBar fails to render the plugin's format cleanly on the target
> Mac; either way exactly one ships as the documented default and the PRD is
> complete for whichever it is (the [SB]/[XB] deltas are confined to styling
> params and packaging).

> **OQ-02 — How does the plugin learn the port (env var vs one-line edit)?**
> **Default assumption:** the plugin reads `LLMDASH_PORT` from its environment
> *if* the FR-01 spike confirms the chosen host reliably passes the user's env to
> plugins; otherwise a single documented one-line constant at the top of the
> plugin file is the shipped mechanism. Default port `8787` in either case. No
> other config surface, and whatever ships drives the fetch URL for real (FR-14).

> **OQ-03 — Exact glyph composition (symbols, dim vs prefix, tool cue).**
> **Default assumption:** deferred to the Designer within the chosen host's
> styling capabilities. The requirement is the five-state distinctness of FR-10
> and the two never-do rules of NFR-03 — a specific symbol set
> (`◉`/`⚠`/`—`/`✕`) is a reasonable starting palette but not mandated.

> **OQ-04 — Does the installer symlink the plugin (FR-20 optional convenience)?**
> **Default assumption:** documentation-first — the README's one-time steps are
> the guaranteed path. An optional installer hook that detects the host's plugin
> dir and symlinks the plugin (baking the absolute `node` path) is a nice-to-have
> the Architect/Engineer may add if cheap; it is never a silent host install and
> never blocks the manual path.

> **OQ-05 — Refresh cadence (the filename interval).**
> **Default assumption:** `5s` (`llmdash.5s.js`) — glance-fresh without hammering
> loopback. This governs only how often the badge re-reads an already-served
> cheap endpoint; the dashboard's own reading freshness is governed server-side
> and is unaffected. Adjustable to `10s`/`15s` if the spike finds 5 s noisy on the
> chosen host; adjust the number, not the pattern (FR-18).

---

## Success Metrics

Every functional requirement maps to at least one QA check. The **Host** column
notes host-specificity; untagged rows apply to whichever host ships. All rows are
verified on macOS (NFR-06).

| ID | What's Being Verified | Pass Condition |
|---|---|---|
| QA-01 | Host spike decided (FR-01, FR-03) | `pipeline/menu-bar-badge/spike-report.md` (or the arch doc) records exactly one chosen default host, the filename-interval and stdout-styling conventions it honors, and any [SB]/[XB] delta; the other host is a best-effort note, not built to parity. |
| QA-02 | Spike evidence (FR-02) | The record shows the chosen host installed on the target Mac rendering: the glyph updating on interval, the dropdown with both tools × both windows, and offline + at least one degraded state visibly distinct from fresh — with capture evidence; it confirms the plugin runs under the host's minimal-PATH spawn env. |
| QA-03 | Single data source (FR-04) | Static inspection + runtime trace show the plugin's only external read is `GET http://127.0.0.1:<port>/api/state`; it opens no statusline file, DB, or tool log, and no second network/data path exists. |
| QA-04 | No recomputation (FR-05) | The plugin reads `remainingPct`/`resetsAt`/`capturedAt`/`freshness`/`limitsDiagnostic` as given; it contains no limit re-derivation, and glyph/countdown/band math matches the web client's helpers. |
| QA-05 | Defensive parse (FR-06, NFR-05) | Fed a non-200, a refused/timed-out connection, and malformed JSON in turn: each yields the offline/error glyph state, no crash, no partial/fabricated number; a `null` window yields the no-reading case, not an error. |
| QA-06 | Most-constrained glyph (FR-07) | With readings present, the glyph shows the integer floor of the lowest `remainingPct` among all windows-with-a-reading across both tools; a `null` window is excluded from the minimum; only one number (not both tools) appears inline. |
| QA-07 | No-reading handling (FR-08) | A single `null` window is excluded from the glyph and shows "not available" in its dropdown row (never `0%`); with every window `null` on both tools, the glyph shows the no-data dash and the dropdown explains why per tool. |
| QA-08 | Freshness band derivation (FR-09) | The plugin's band matches `ageBand`: computed from the tool's server-supplied `freshness.freshForMs`/`staleAfterMs` (no hardcoded thresholds); a `null` freshness (Codex) yields no band treatment. Verified by feeding readings straddling `freshForMs` and `staleAfterMs`. |
| QA-09 | Five distinct glyph states (FR-10, NFR-03) | Fresh, aging, stale, no-reading, and offline each render a visibly distinct glyph; a stale/aging reading is never shown as confidently fresh, and no number is ever shown in the offline state. |
| QA-10 | Countdown formatting (FR-11) | Dropdown reset countdowns match `fmtDur`: `d h` / `h m` / `m`, `≤ 0` → "now", missing `resetsAt` → "—". |
| QA-11 | Full dropdown breakdown (FR-12) | The dropdown lists all four tool×window rows with label, remaining % (or "not available"), and reset countdown; a `remainingPct <= 0` window reads "limit reached" and can be the glyph's binding window. |
| QA-12 | Open-dashboard action (FR-15) | The dropdown has an "Open dashboard" item that opens the dashboard URL in the browser; if a "Refresh" item is present it actually re-runs the plugin (no dead item). |
| QA-13 | Port config drives fetch (FR-14, OQ-02) | With the dashboard on a non-default port, the shipped mechanism (env `LLMDASH_PORT` or the documented one-line edit) makes the badge fetch the correct port; there is exactly one config surface and it drives the URL. |
| QA-14 | Interpreter under minimal PATH (FR-13, NFR-01) | The plugin runs correctly when spawned by the host with a minimal PATH (absolute `node` or spike-confirmed mechanism); it uses only Node builtins / stock POSIX tools, no npm package, no build step; an unresolved interpreter surfaces as an install-time error with the fix, not a silently dead badge. |
| QA-15 | Diagnostic mapping & escaping (FR-16, NFR-04) | Each of `stale-reading`, `auto-refresh-failing`, `auto-refresh-disabled`, `no-statusline-reading`, `codex-cmd-failed`, `no-reading` maps to a fixed honest dropdown line; an unmapped code falls back generically; `reason`/`cause` are never rendered raw; free-form `cmd`/`detail` are escaped or omitted (own-key lookup only). |
| QA-16 | Diagnostic-with-reading coexistence (FR-17) | A `stale-reading` payload (reading still present) shows the glyph number marked stale AND the dropdown shows both the number and the stale note; the window is flagged, never blanked. |
| QA-17 | Plugin location & filename (FR-18) | The plugin ships at `scripts/menubar/llmdash.<interval>.js` with the host's interval-in-filename convention; the README states exactly what to copy/symlink into the host's plugin dir. |
| QA-18 | README disclosure (FR-19) | The README names the chosen host, its exact one-time install command (stated as a user-installed prerequisite, not an llmdash dependency, never auto-installed), the one-time plugin install, the port config, and the honest offline/freshness reality. |
| QA-19 | Installer never auto-installs host (FR-20) | The installer does not install SwiftBar/xbar; any plugin-setup convenience is opt-in, prints what it did and what the user must still do, and (if present) bakes the absolute `node` path; any added health line is a cheap fs check off the request path. |
| QA-20 | Zero deps / no build (NFR-01) | `package.json` runtime dependencies remain zero; there is no build step for the plugin; the plugin is Node-builtins or stock POSIX only. |
| QA-21 | Request-path isolation (NFR-02) | The plugin adds no work to the dashboard beyond one ordinary `GET /api/state` per host tick; it spawns no subprocess, polls no tool CLI, and scans no disk. |
| QA-22 | Honesty invariants (NFR-03) | Across fresh/aging/stale/no-reading/offline, the badge never shows a stale reading as fresh, never fabricates a number when unreachable, and never shows a zero where a window has no reading. |
| QA-23 | Security / untrusted text (NFR-04) | The plugin makes only a loopback GET with no credentials, writes to no Claude/Codex-owned path, interpolates no payload value into a shell string, and escapes/omits free-form diagnostic fields before display. |
| QA-24 | Contract unmodified (Out of Scope) | The feature ships with no change to the `/api/state` payload, the freshness thresholds/bands, or the diagnostic reason codes; the badge consumes the existing contract as-is. |
