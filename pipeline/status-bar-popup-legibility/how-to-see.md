# Seeing Status Bar Popup Legibility Locally

1. Open a terminal in the project folder.

2. Preview the badge in its normal offline state:

   ```sh
   LLMDASH_BADGE_HOST=127.0.0.1 LLMDASH_PORT=1 node scripts/menubar/llmdash.5s.js
   ```

3. Check the output. The first line should still be the offline menu-bar glyph, and the dropdown should include a readable "Dashboard offline" line plus Open dashboard and Refresh actions.

4. Preview a long unavailable-server value:

   ```sh
   LLMDASH_BADGE_HOST='this-is-a-very-long-unavailable-dashboard-host-name-that-used-to-force-a-wide-popup.example' LLMDASH_PORT=8787 node scripts/menubar/llmdash.5s.js
   ```

5. Check the output. The unavailable-server message should be split across multiple bounded rows instead of one huge row, and the Open dashboard action should still be a single inert `href=` action.

6. To check the live badge, let SwiftBar refresh the installed `llmdash.5s.js` wrapper. The pop-up should keep the same glyph and menu actions, but long unavailable-server explanations should no longer stretch the menu wide.
