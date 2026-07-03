# Decisions — badge-display-options

## Stage 4 (Designer review) — 2026-07-03
User approved the design across two rounds ("This all looks great" → round 1;
"Ship it, all as recommended" → round 2, folding in the tool dimension + legend).
All items below are ratified and binding for the Engineer.

### Round 1 — the three display axes (host-oriented)
- **Compact glyph grammar** (all five honesty states legible at icon size, color +
  marker, never a fake number): fresh `46` / aging `46·` / stale `⚠12` (warning
  mark LEADS in compact) / no-reading `—` (no digit) / offline `⊘` (no digit); a
  leading `▪` keeps identity. `sfimage=`/logos are additive polish; the text+color
  floor is the xbar-safe requirement.
- **Layout axis** single | side-by-side | alternating. Side-by-side = ONE menu-bar
  line, **cap = 3** hosts, binding-first, then `+M more` (`+2`); one `color=` per
  line = the binding cell, per-cell state on the marker; grow-prefix host cue
  (`St`/`La`/`De`). **Alternating = the plugin rotates which host it shows per ~5s
  tick, deterministic/stateless** (`floor(epochMs/5000) % count`) — NOT SwiftBar
  cycling.
- **Density axis** wide | compact. Wide single = today's badge, byte-for-byte
  unchanged as the default.
- **Four host presets**: "Most-constrained · wide" (=today) / "Single compact
  icon" / "Compact icons side-by-side" / "Rotate hosts · compact". Axes stay
  individually adjustable under the presets.
- **View filter, not coverage** — choosing which hosts show in the glyph never
  changes what is monitored; the dropdown still lists every host; a selected but
  offline host is still shown/marked in the glyph. `!display-hosts` resolves at the
  BADGE against live hostViews (keeps `host-config.js` pure).
- **`✓` active marker** (with bolding) for the active preset + axis choice; **`🖥`
  Display submenu icon**; the Display submenu lives in the **shared action-lines
  path** (present in single-host AND multi-host modes).

### Round 2 — the tool dimension + the legend (folded in at design, ratified)
- **Group axis: Host | Tool.** Grouped by **Tool**, the badge's units become
  per-tool **aggregates across the selected hosts**: *all-Claude* = the tightest
  Claude window's `%` across the selected machines (carrying that window's state);
  *all-Codex* = the tightest Codex likewise. Rendered with the SAME layout +
  density (single = the most-constrained of the two; side-by-side = the two
  aggregate cells in one item; alternating = rotate Claude/Codex per tick). Two
  units, so **no cap** in tool mode. **Aggregate honesty:** a tool with no reading
  on ANY selected host → `—`; all contributing hosts offline → `⊘`; never a
  fabricated zero.
- **Two tool presets**: "Claude vs Codex · side-by-side" and "Rotate Claude /
  Codex · compact".
- **Tool marks — default NEUTRAL, opt-in LOGOS** (user's explicit choice):
  - **Neutral (default): `◆` = Claude, `▲` = Codex** — chosen as distinct
    *silhouettes* (diamond vs triangle), solid, monochrome-legible at bar size
    (rejected same-shape/different-fill pairs as too similar). These REPLACE the
    `C`/`X` letters as the default tool cue in BOTH per-host (which tool binds) and
    per-tool (which aggregate this is) modes. Text/emoji floor → xbar-safe.
  - **Logos (opt-in, OFF by default): real Claude + Codex/OpenAI marks** as small
    template images (SwiftBar `image=`/`templateImage=`, ~13px in the tool-cue
    slot). **The neutral glyph is ALWAYS the fallback floor** — honesty/state
    reading never depends on an image rendering (xbar / template-image failure
    still reads correctly).
  - **Tool-marks toggle** "Neutral · Logos" in the Display submenu (`✓`-marked).
  - **Fair-use posture:** opt-in + neutral floor is the product decision. The
    Engineer/Architect confirm the actual asset + licensing (a personal-project
    nominative-fair-use basis; the repo ships the neutral glyph as the guaranteed
    floor; the logo asset treatment must not imply endorsement and must degrade to
    the neutral glyph).
- **Legend — a `🛈 Legend — what the marks mean ▸` submenu** (SwiftBar-native
  reveal; chosen over toggle-expand because it needs **zero plugin state** — no
  `legendOpen` marker round-trip, no whole-dropdown re-render — and works on xbar).
  Progressive disclosure (not expanded by default; the default dropdown stays
  clean). Present in single + multi modes (shared action-lines path). The key is
  **complete**: all five states (compact form + meaning), the three colors +
  thresholds (headroom in the tightest window), what the `%` number is (tightest of
  the tracked windows) + the binding host/tool, both neutral tool marks (and that
  logos mean the same when enabled), the side-by-side cue + `+M more`, and the `✓`
  active marker — one scannable line each. The legend copy table in design-spec.md
  is verbatim-binding for the Engineer.

### Bindings for later stages
- `computeMultiBadge` stays UNCHANGED; a new pure `applyDisplay(multi, display,
  {epochMs})` is the presentation layer that applies group → view-filter → layout →
  density → tool-mark; the default axes (all/host/single/wide/neutral) route to the
  shipped `emit`/`emitMulti` **byte-for-byte**.
- Prefs persist as `!display-*` directives in `hosts.conf` (seed-once precedence
  family), written atomically (temp+rename, `0o600`) via a new `writeDisplayConfig`
  in `host-config.js` (kept pure); the badge writes via a new
  `scripts/menubar/display-action.mjs` under `$ABS_NODE` — **NO** osascript text
  dialog (choices are enumerable), **NO** HTTP mutation (server stays serve-only).
- schema.md is extended (this stage) to cover the tool dimension, the tool-mark
  axis + logo asset mechanics + the neutral-floor invariant, the legend, and the
  two tool presets, BEFORE the Engineer builds — so the system design matches the
  ratified design.

## Stage 5 (Engineer) — 2026-07-03
- **Built** per schema.md + design-spec.md. `npm test` → 447 tests, 445 pass, 0 fail,
  2 pre-existing env skips (+69). The five `!display-*` axes, `applyDisplay` (group
  host|tool → per-tool aggregate, layout, density, tool-mark), the ratified `C`/`X`→
  `◆`/`▲` default cue (shipped test expectations UPDATED not reverted + a pin test +
  disclosed in README/health/install), `display-action.mjs`, the Display + Legend
  submenus in the shared action-lines path (both modes), the round-trip writer.
- **Logo asset call:** the Engineer shipped **original neutral placeholder marks**
  (26×26 monochrome diamond/triangle) at `scripts/menubar/assets/{claude,codex}-mark.png`
  + `LICENSE.md`, **NOT** the real Claude/OpenAI brand art (trademark/licensing it
  couldn't cleanly resolve by generating art). The logo code path is complete +
  tested (opt-in, neutral `◆`/`▲` floor always present, `node:fs` read only when
  `toolMark=logo`, resolved via `import.meta.url` so it works under the wrapper/
  symlink). **Dropping in the real logos is just replacing two PNGs — the fair-use
  call on the real art stays the user's** (surface at the deploy gate).

## Stage 6 (Tester) — 2026-07-03
- **Verdict: pass-with-findings.** One MAJOR bug, everything else clean (five honesty
  states + no fabricated zeros, byte-for-byte-save-cue, the per-tool aggregate math +
  honest `—`/`⊘`, the view-filter split, the layouts, the submenu/Legend, the write
  path, serve-only, zero-deps, disclosure — all verified, including through the real
  symlink invocation path).
- **The MAJOR bug (fixed in-stage):** the host view-filter was **case-broken** — the
  read path lowercased stored host keys (`host-config.js` `parseDisplayHosts` line 68 +
  the blanket directive-value `.toLowerCase()` line 98) while the write path and the
  badge's `addr` (via case-preserving `sanitizeHostPort`) kept case. A mixed-case key
  (e.g. `Studio.local:8788` — a `.local` Bonjour name) selected in the submenu wrote
  case-preserved, read lowercased, failed the intersection, and **silently fell back
  to `all`** (glyph showed the wrong host). **Fix:** `!display-hosts` now parses the
  **case-preserved** value (the enum axes still lowercase-match; the `all` sentinel is
  case-insensitive); all three sides (read/write/addr) are now case-consistent. Full
  suite green: **464 tests, 462 pass, 0 fail, 2 skip.** The Tester's hermetic
  reproduction suite (`tests/qa-badge-display.test.js`, 17 tests incl. the mixed-case
  regression guard) is **kept as permanent regression coverage**.
- **Real install confirmed untouched** by the Tester (scratch dirs/labels only; the
  pre-existing Jul-2 plugin + service were neither created nor modified).

## Stage 7 (Auditor) — 2026-07-03
- **Verdict: pass.** No exploitable issues within the tailnet/serve-only threat model.
  Every posture invariant confirmed: (a) no-shell/no-osascript/atomic-`0o600`/no-
  traversal local write (7-attack PoC all neutralized — a crafted `!display-hosts`
  toggle can't smuggle a `!local=`/second line/host entry; `../../etc/passwd` preset
  id → `unknown-preset`, no file); (b) the case-preservation fix did NOT weaken the
  `[A-Za-z0-9._:\-\[\]]` sanitizer; (c) SwiftBar-grammar injection blocked (the first
  `|` on every line is code-authored; a hostile label is `sanitize()`-quarantined in
  the text half, never the params half — no rogue `bash=`/`shell=`); (d) the logo is a
  passive/local/opt-in `templateImage=` with the neutral `◆`/`▲` floor emitted
  unconditionally; (e) serve-only/405/headers intact, `server.js` unmodified, no new
  HTTP write surface; (f) externally-sourced data stays coerced/`sanitize()`'d to the
  render sink; (g) disclosure honest (README + `healthLines()` + install echoes).
- **INFO-3 hardening applied in-stage:** `truncateHostCue` now defensively
  `sanitize()`s its input (symmetry with `growPrefixCues`) so a future un-ingested
  caller can't reopen the menu-bar-grammar injection class. Safe today (inputs are
  ingest-sanitized); this closes the latent coupling. Full suite green after:
  **464 tests, 462 pass, 0 fail, 2 skip.**
- **INFO-1 (logo fair-use):** as shipped there is **no** trademark exposure (original
  placeholder marks + honest `LICENSE.md` + opt-in + neutral floor). The Auditor's
  read: a clean, honest posture for a personal open-source project; **ship with the
  placeholders**; "drop in real brand marks" is a separate explicit operator choice to
  own later (the code's honesty invariants hold either way). Surfaced at the deploy gate.
- **INFO-2:** inert-by-design stored-key garbage (self-neutralizes at the badge) — no
  impact, matches the ratified "unknown keys resolve at the badge" design.
- **Real install confirmed untouched** by the Auditor (tmp scratch only; the pre-
  existing Jul-1/Jul-2 `~/.llmdash`/plugin/plist all predate the session, unmodified).

## Convention note (for Stage 9 — CLAUDE.md)
- The Auditor suggests tightening the shipped SwiftBar-line render rule to also say
  *"sanitize at the cue helper, not only at ingest"* (the INFO-3 lesson — now
  reflected in `truncateHostCue`). Fold into the conventions update at close-out.

## Stage 8 (Deployer) — 2026-07-03
- **User approved the deploy ("Ship it").** Shipped:
  - Commit `07682e2` on `origin/main` (feature + artifacts + docs).
  - Installed `~/llmdash` checkout fast-forwarded `35c3cbf → 07682e2` (clean ff).
  - `com.llmdash.dashboard` restarted in the **user domain** (`launchctl kickstart -k
    gui/<uid>/…`, no sudo); `state = active`, port 8787.
  - **Health-checked live:** `GET /api/state` 200, `GET /api/hosts` 200, `POST /api/hosts`
    **405** (`allow: GET, HEAD`) — serve-only preserved.
  - **Real-invocation verified:** ran the installed badge through its actual SwiftBar
    **wrapper** (`~/Library/Application Support/SwiftBar/Plugins/llmdash.5s.js` → abs-node
    → `~/llmdash/scripts/menubar/llmdash.5s.js`); it renders live with the new cue —
    `▪ This machi…·◆ 24% | color=#f0a94b` (the ratified `C`→`◆` swap is live; glyph
    populated, dropdown full). Not blank, not just "loads."
- **Logo asset shipped as placeholders** (per the Auditor + user gate) — real brand art
  is a later drop-in-two-PNGs operator choice.
- All build/QA/security verification stayed scratch-only; the real service/checkout/data
  were verified untouched before the deploy and healthy after.
