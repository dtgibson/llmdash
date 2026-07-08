# Change Brief - Menu-Bar Dropdown Legibility And Legend

## What is changing
The macOS SwiftBar/xbar badge dropdown should use readable dark text for normal informational rows instead of faint gray. The badge legend should explain every symbol the badge can show, including host markers, tool markers, freshness markers, no-reading/offline markers, active-choice checkmarks, overflow markers, and service/host action symbols.

## Why now
The previous legibility pass darkened some top rows, but the live dropdown still reads as light and gray in important places. The menu-bar glyph also contains symbols, such as the small square host marker, that are not explained clearly in the legend.

## User-facing impact
The dropdown should be easier to scan, and the legend should make the badge grammar self-explanatory. The status-bar glyph may use clearer host/tool separator spacing or symbols only if needed to match the legend, but monitoring coverage and behavior do not change.

## Decisions touched
- Dropdown legibility and aging symbols - keep the darker dropdown direction, but broaden it so the live dropdown is genuinely readable.
- Badge display options - keep the neutral `◆`/`▲` tool marks and on-demand legend, but make the legend complete for every visible mark.
- Compact mode display honesty - preserve exactly one status-bar title line before the first `---`.

## What done looks like
Live plugin output uses dark, readable colors for normal dropdown text and section labels, reserving lighter gray only for genuinely de-emphasized or unavailable state.
The legend names every symbol used by the badge output, including `▪`, `◆`, `▲`, `◷`, `⚠`, `—`, `⊘`, `✓`, `+N`, `＋`, `－`, `☰`, and `🖥`.
Focused menu-bar tests and the full test suite pass, and the installed SwiftBar output is previewed before deployment.
