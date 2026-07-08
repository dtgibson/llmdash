## Compact Mode Display Honesty

### What this does
This keeps SwiftBar/xbar status-bar output to exactly one pre-separator line, so multi-host explanatory text such as "Watching 3 machines · 1 not reachable" stays in the dropdown and cannot widen the menu bar. It also clarifies the Display submenu, README, and startup health disclosure so layout and density are described as menu-bar glyph settings, while the dropdown remains the full per-host view.

### How to test
1. Run `node --test tests/menubar.test.js`.
2. Run `node --test tests/menubar-multihost.test.js`.
3. Run `node --test tests/menubar-display.test.js`.
4. Run `node --test tests/hosts-disclosure.test.js`.
5. Run `npm test`.
6. Preview compact display output with an offline remote and confirm the first line is the compact glyph, the second line is `---`, and the watching/unreachable copy appears only after that separator.

### Notes for reviewer
No monitoring, polling, persistence, or API contract changed. The fix is presentation-only: emitted plugin output now has a single title line before the first SwiftBar separator, and Display copy now says "glyph" instead of "icon" where that was misleading.
