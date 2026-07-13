# Seeing the Cross-Surface Visual Refinement Locally

No deployment has occurred yet. The steps below run the dashboard and verify the installed menu wrapper only on this Mac.

## Dashboard

1. In Terminal, start the current checkout and leave it running:

   ```sh
   cd /Users/developer/devwork/llmdash
   npm start
   ```

2. Open <http://localhost:8787>.

3. Verify the wide layout with the browser viewport at 1024px wide:

   - The page sits in a centered shell with a quiet tinted background.
   - Each tool has a colored rail and its `◆` or `▲` mark.
   - The two account-window gauges sit side by side and remain the strongest visual layer.
   - Pacing spans the width beneath the gauges; activity, token mix, and model limits read as supporting layers rather than nested cards.
   - Trends has one heading/range control and uses two chart columns above 760px.

4. In browser developer tools, enable responsive mode and set the viewport to 390px wide. Verify:

   - Gauges stack in one column.
   - Tool metadata, reset labels, pacing rows/status pills, model-limit metrics, host headers, Trends controls, and footer copy wrap or stack without clipping.
   - The selected trend range remains obvious; keyboard Tab shows a visible focus ring and changing ranges updates the pressed state.

5. If available in the browser developer tools, preview both light and dark color schemes. Status colors, tool rails, text, gauges, and charts should remain legible in each.

## Installed SwiftBar wrapper and menu

1. Keep `npm start` running. SwiftBar must already be installed and configured with a plugin folder. If the folder is the standard location, verify it exists:

   ```sh
   test -d "$HOME/Library/Application Support/SwiftBar/Plugins"
   ```

2. Install or refresh the local llmdash wrapper from this checkout:

   ```sh
   cd /Users/developer/devwork/llmdash
   ./scripts/install-macos.sh --setup-badge
   ```

   The installer prints the exact wrapper path. For a nonstandard SwiftBar plugin folder, set `LLMDASH_SWIFTBAR_DIR` to that folder when running the command.

3. For the standard folder, verify that the generated wrapper is executable, carries llmdash's marker, and runs the tracked plugin:

   ```sh
   test -x "$HOME/Library/Application Support/SwiftBar/Plugins/llmdash.5s.js"
   grep -F 'llmdash-menu-bar-badge' "$HOME/Library/Application Support/SwiftBar/Plugins/llmdash.5s.js"
   "$HOME/Library/Application Support/SwiftBar/Plugins/llmdash.5s.js" | sed -n '1,50p'
   ```

   If SwiftBar uses another folder, substitute the wrapper path printed by the installer.

4. In SwiftBar, refresh all plugins or wait about five seconds, then click the llmdash badge. Verify:

   - The top summary names the binding percentage and its current host/tool/window context, with status color reinforcing the text.
   - Tool groups use `◆ Claude Code` and `▲ Codex`; their account and model windows are indented, Menlo-styled, and colored by the existing good/warn/critical thresholds.
   - Aging/stale words and diagnostic remedies remain present, and a diagnostic appears directly under the readings it qualifies.
   - In multi-host mode, host sections retain the same marked and indented tool hierarchy as single-host mode.
   - Display, Legend, service, host, uninstall, Open dashboard, and Refresh remain in the final action region and still perform their existing actions. Do not invoke uninstall merely to verify styling.

These steps are local verification only: neither `npm start` nor `--setup-badge` publishes or deploys llmdash, and no deployment has been performed for this refinement.
