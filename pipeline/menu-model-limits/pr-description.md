## Menu Model Limits

### What this does
The macOS menu-bar dropdown now includes Claude model-specific caps, such as Fable and Sonnet, when they are already present in the state payload. The model rows appear under the existing Claude Code account-wide 5-hour and weekly rows, while the menu-bar title glyph and display presets remain unchanged.

### How to test
1. Run `node --test tests/menubar.test.js`.
2. Run `node --test tests/menubar-multihost.test.js`.
3. Run `node --test tests/menubar-display.test.js`.
4. In a live app with Claude `modelLimits` present, open the llmdash menu-bar dropdown and confirm the Claude Code section shows `Model limits` followed by Fable/Sonnet rows.

### Notes for reviewer
This is a presentation-only change in the menu-bar plugin. It does not change `/api/state`, polling, model-limit parsing, dashboard rendering, or any title glyph/display aggregation logic.
