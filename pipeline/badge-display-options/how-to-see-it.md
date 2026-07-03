# How to see it — badge-display-options

After the installed badge updates (SwiftBar re-runs the plugin every 5s, or click the
badge → **Refresh**), the new controls live in the badge dropdown.

## The Display submenu
1. Click the menu-bar badge to open the dropdown.
2. Open **🖥 Display**. You'll see:
   - **Presets** (six) — pick one to set everything at once, e.g.:
     - *Most-constrained · wide* — today's badge (the default)
     - *Single compact icon* — one tiny icon
     - *Compact icons side-by-side* — a row of machines
     - *Rotate hosts · compact* — one machine at a time, rotating
     - *Claude vs Codex · side-by-side* — the all-Claude / all-Codex view
     - *Rotate Claude / Codex · compact* — the two tools, alternating
   - **Group by** — Host (each unit is a machine) or Tool (all-Claude / all-Codex,
     each the tightest window across your machines).
   - **Hosts** — tick which machines feed the glyph (the dropdown still lists them all;
     this only changes the icon).
   - **Layout** — Single / Side-by-side / Alternating.
   - **Density** — Wide (text) / Compact (icon).
   - **Tool marks** — Neutral (`◆` Claude / `▲` Codex) or Logos.
   Your current choice on each axis is marked with `✓`.

## The Legend
Open **🛈 Legend — what the marks mean** for a full key: the five states
(`46` live · `46·` aging · `⚠12` stale · `—` no reading · `⊘` offline), the good/warn/crit
colors and thresholds, what the number is, both tool marks, the side-by-side host cue and
`+M more`, and the `✓` active marker.

## Two things worth knowing
- **The default tool cue changed** from the letters `C`/`X` to the neutral marks
  `◆` (Claude) / `▲` (Codex) — visible even if you never open the Display menu. This was a
  ratified design change; it's noted in the README and the startup health readout.
- **The "Logos" option currently shows placeholder marks** (a diamond and a triangle),
  not the real Claude/Codex logos. To use the real logos, replace these two files with your
  own monochrome, transparent PNGs (that fair-use decision is yours):
  - `scripts/menubar/assets/claude-mark.png`
  - `scripts/menubar/assets/codex-mark.png`
  The badge always falls back to the `◆`/`▲` marks, so it stays honest either way.

## Nothing about monitoring changed
Choosing which hosts/tools the glyph shows is a **view filter only** — every machine is
still polled, and the dropdown always shows the full picture. The display prefs are stored
as `!display-*` lines in your `hosts.conf`; the badge writes them locally (no network, no
server mutation — the dashboard stays serve-only).
