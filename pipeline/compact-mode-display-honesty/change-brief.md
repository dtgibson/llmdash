# Change Brief - Compact Mode Display Honesty

## What is changing
The macOS menu-bar badge should emit exactly one status-bar title line, with all explanatory multi-host copy below the SwiftBar/xbar separator. Compact display mode should stay compact in the bar, and the Display submenu / docs should describe the glyph axes clearly: layout controls which units appear, density controls how terse each glyph cell is, and the dropdown still carries full host detail.

## Why now
The bar can occasionally become very wide and show copy like "Watching 2 machines, 1 not reachable" even when compact mode is selected. That violates the display contract users choose from the menu and makes compact mode feel dishonest.

## User-facing impact
The menu-bar glyph becomes predictably compact. Display labels and docs become clearer, but no new controls, monitored hosts, dashboard data, or API payloads are introduced.

## Decisions touched
- Badge display options - display remains a pure presentation layer over `computeMultiBadge`; this tightens the glyph-only contract and keeps the dropdown full.
- Status bar popup legibility - explanatory/offline text remains readable in the dropdown, but it must not leak into the menu-bar title area.

## What done looks like
SwiftBar/xbar output has exactly one line before the first `---` separator across single-host, multi-host, and non-default display modes. Compact side-by-side/alternating/single glyphs stay bounded and never include the watching summary. Tests cover the separator contract and the clearer Display labels.
