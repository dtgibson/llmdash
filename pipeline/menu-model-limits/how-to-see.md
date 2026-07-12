# Seeing Menu Model Limits Locally

1. Open a terminal in the project folder.

2. Start llmdash:
   `npm start`

3. Make sure the menu-bar badge is installed or already running in SwiftBar/xbar.

4. Open the llmdash menu-bar dropdown.

5. In the Claude Code section, look below the existing `5-hour` and `Weekly` rows. When the current Claude reading includes model-specific caps, the dropdown shows a `Model limits` label followed by rows such as `Fable: 84% · resets 5d 8h` or `Sonnet 4.5: 34% · resets 5d 8h`.

6. If no model-specific cap is currently reported by Claude, the dropdown intentionally omits the `Model limits` block.
