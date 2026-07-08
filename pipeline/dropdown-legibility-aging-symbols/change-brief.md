# Change Brief - Dropdown Legibility And Aging Symbols

## What is changing
The macOS menu-bar badge dropdown will use darker, more readable text for its top summary and section/header rows. The reading-age glyphs will also become more intuitive: aging should look like a clock/state-of-time marker, while stale remains a stronger warning state.

## Why now
The top of the dropdown is currently too light gray to scan comfortably, and the aging marker is only a trailing dot, which is easy to miss and does not clearly communicate that a reading is getting old.

## User-facing impact
Existing badge behavior stays the same, but the dropdown reads with better contrast and the status-bar glyphs communicate fresh, aging, stale, no-reading, and offline states more clearly.

## Decisions touched
- Compact mode display honesty - the glyph remains exactly one status-bar title line before the first separator, and explanatory copy stays in the dropdown.
- Status bar popup legibility - this extends the readable-row work to the top summary and state/header rows while keeping action rows explicitly constructed.
- Badge display options - this changes display grammar only; polling, `/api/state`, `/api/hosts`, and display preferences stay unchanged.

## What done looks like
The badge output uses darker dropdown text for the top summary/header rows without adding new action surfaces. Aging and stale symbols are visually distinct and named in the legend. Focused menu-bar tests and the full suite pass.
