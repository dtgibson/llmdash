## Dropdown Legibility And Aging Symbols

### What this does
Improves the macOS menu-bar badge dropdown by applying darker text to the top summary, host/tool headers, scope/count rows, and Display/Legend section labels. Replaces the subtle aging dot with a clearer clock-like marker (`◷`) while keeping stale as the stronger warning marker (`⚠`).

### How to test
1. Run `node --test tests/menubar.test.js tests/menubar-display.test.js tests/menubar-multihost.test.js tests/qa-badge-display.test.js`.
2. Run `npm test`.
3. Preview the badge output and confirm aging renders as `◷` while stale still renders as `⚠`.

### Notes for reviewer
This is a presentation-only change in `scripts/menubar/llmdash.5s.js`. It does not change polling, `/api/state`, `/api/hosts`, persistence, display preferences, or action rows.
