## Seeing Menu-Bar Dropdown Legibility And Legend Locally

1. Open a terminal in the project folder.

2. Print the SwiftBar/xbar plugin output:

   ```sh
   node scripts/menubar/llmdash.5s.js
   ```

3. In the output, look below the first `---`. Normal dropdown rows should use dark readable colors such as `#111111`, `#1f1f1f`, and `#333333`.

4. Find the `🛈 Legend — what the marks mean` section. It should explain the `▪` llmdash mark, host/tool separator, binding marker, freshness symbols, tool marks, multi-host cues, and menu/action symbols.

5. In the live menu bar, open the llmdash dropdown and hover or open the legend submenu. The text should no longer read as faint gray, and the square marker to the left of the percentages should be explained as the llmdash mark.
