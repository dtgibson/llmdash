# Seeing Model Limit Detection Locally

1. Open a terminal in the project folder.

2. Run the focused regression tests:

   ```sh
   node --test tests/claude-refresh-parse.test.js
   ```

3. Run the statusline overwrite regression:

   ```sh
   node --test tests/statusline-model-merge.test.js
   ```

4. Run the full suite:

   ```sh
   npm test
   ```

5. After deployment, let SwiftBar refresh the menu-bar badge. When Claude reports model-specific limits, the Claude section should keep Fable/Sonnet rows after normal Claude Code statusline activity instead of dropping them intermittently.
