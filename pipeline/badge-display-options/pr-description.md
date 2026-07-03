# Add badge display options: layout, density, host/tool grouping, tool marks + legend

## What
The menu-bar badge becomes configurable from its own **🖥 Display** submenu, along five
persisted axes with six friendly presets on top — without changing what's monitored (the
dropdown always shows every host; the display prefs are a **view filter** only).

- **Group** — Host (each unit is a machine) or **Tool** (a per-tool aggregate:
  *all-Claude* / *all-Codex*, each the tightest window across the selected machines).
- **Hosts** — a multi-select filter over which machines feed the glyph.
- **Layout** — single · side-by-side (cap 3, `+M more`, binding-first) · alternating
  (the badge rotates which unit it shows each ~5s tick, deterministic/stateless).
- **Density** — wide (text) · compact (icon). The five honesty states stay legible small:
  `46` live · `46·` aging · `⚠12` stale · `—` no-reading · `⊘` offline (no fabricated
  numbers; a selected offline host still shows `⊘`).
- **Tool marks** — neutral `◆` (Claude) / `▲` (Codex) by default, replacing the old `C`/`X`
  letters; real logos are an opt-in template-image with the neutral marks as the guaranteed
  floor.
- **🛈 Legend** — an on-demand submenu explaining every mark, both modes.

## How
A pure presentation layer over the unchanged `computeMultiBadge`:
- Prefs persist as five `!display-*` directives in the badge's local `hosts.conf`
  (`host-config.js`), written atomically (temp+rename, `0o600`) by a new tracked
  `display-action.mjs` helper under the absolute node — **no `osascript` dialog** (values
  are enumerable menu choices), **no HTTP mutation** (the server stays serve-only, 405 for
  non-GET/HEAD).
- The badge reads the directives on the render tick and applies them via a new pure
  `applyDisplay(multi, display, {epochMs})` (group → view-filter/aggregate → layout →
  density → tool-mark). Unconfigured routes to the shipped emit path **byte-for-byte** —
  save the one ratified change (the `C`/`X`→`◆`/`▲` default cue).

## Notable
- **Ratified default change:** the tool cue is now `◆`/`▲` instead of `C`/`X`, visible even
  when unconfigured. Disclosed in the README and the startup health readout.
- **Logos:** ships with **original neutral placeholder marks** + an honest `LICENSE.md`,
  *not* the real Claude/OpenAI brand art. Opt-in, off by default, neutral floor always
  present. Dropping in real logos later is just replacing two PNGs (an operator fair-use
  choice).
- **QA:** one bug found + fixed — a host view-filter case-sensitivity break (mixed-case
  `.local` names silently ignored); regression test added.
- **Security:** audited **pass** — the write path is local-file-only (no shell, no HTTP,
  atomic, no traversal), SwiftBar-grammar injection blocked, the logo is a passive local
  read, serve-only intact; one defense-in-depth hardening applied (`truncateHostCue`).

## Tests
**464 tests, 462 pass, 0 fail, 2 pre-existing environmental skips** (+69 over the 378
baseline). Zero runtime dependencies, no build step (the tracked PNG marks are source, not
a dependency).
