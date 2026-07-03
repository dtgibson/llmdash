## Last shipped: badge-display-options (2026-07-03) — CLOSED OUT

The menu-bar badge is now user-configurable from its own **🖥 Display** submenu along
five persisted axes — Group (host | tool), Hosts (multi-select view filter), Layout
(single | side-by-side | alternating), Density (wide | compact), Tool marks (neutral
`◆`/`▲` | opt-in logos) — with six presets and an on-demand **🛈 Legend**. Grouping by
Tool gives an all-Claude / all-Codex view (each the tightest window across the selected
machines). Pure presentation layer over the unchanged `computeMultiBadge`: prefs persist
as `!display-*` directives written atomically to `hosts.conf` by `display-action.mjs`
(no osascript, no HTTP — serve-only intact). The default tool cue changed `C`/`X`→`◆`/`▲`
(ratified, disclosed). Logos ship as honest original placeholders; real logos are a
drop-in-two-PNGs operator choice.

- Commit `07682e2` (feature) + `fe20ee9` (context update) + this close-out, on origin/main.
- Installed `~/llmdash` fast-forwarded, service restarted, health-checked (serve-only 405
  preserved), badge verified rendering live with the `◆` cue through its real wrapper.
- Build 464/462/0/2; QA pass (one case bug fixed in-stage + regression guard); Security
  pass (one hardening applied). Real install untouched throughout.

## Status: idle — no active feature
Pipeline is clean and reset. Run `/weft` to start the next lane.

## Roadmap (open)
- **Up Next:** Limit alerts — notify before a window is exhausted.
- **On the Horizon:** a tmux / terminal statusline (would reuse the compact glyph cell
  grammar this feature established).
