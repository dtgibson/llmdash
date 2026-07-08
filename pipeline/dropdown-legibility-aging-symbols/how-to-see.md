## Seeing Dropdown Legibility And Aging Symbols locally

1. Open a terminal in the project folder.

2. Run the focused menu-bar tests:
   `node --test tests/menubar.test.js tests/menubar-display.test.js tests/menubar-multihost.test.js tests/qa-badge-display.test.js`

3. Start llmdash if you want to inspect it through SwiftBar/xbar:
   `npm start`

4. Refresh the menu-bar badge.

5. Open the badge dropdown and check that the top summary and section labels are darker and easier to read. Aging readings should use `◷`; stale readings should still use `⚠`.
