# How To See — Menu-Bar Logo Assets

1. Install or refresh the menu-bar badge from the app if needed.
2. Open the menu-bar badge dropdown.
3. Choose **Display -> Tool marks -> Logos**.
4. Use a single-tool glyph mode, such as **Display -> Most constrained, compact**,
   or **Display -> Group by -> Tool** with **Glyph layout -> Single**.

Expected result: SwiftBar layers the bundled Claude or OpenAI/Codex template image
over the existing neutral glyph floor. xbar, or any image-render failure, still
shows the neutral `◆` / `▲` glyph.

Fast local check:

```sh
node --test tests/menubar-display.test.js tests/hosts-zerodep.test.js tests/hosts-disclosure.test.js tests/menubar-install.test.js
```
