# How To See — Menu-Bar Logo Drop-In

1. Open the menu-bar badge dropdown.
2. Choose **Display -> Group by -> Tool**.
3. Choose **Display -> Glyph layout -> Side-by-side**.
4. Choose **Display -> Tool marks -> Logos**.

Expected result in SwiftBar: the status-bar title uses logo art instead of the
visible `◆` / `▲` tool glyphs. The text numbers and freshness marks remain, and
the logo color matches the title state color. Single-tool or rotating tool views
use one 16x16 logo. xbar, or an image-render failure, continues to show the
neutral `◆` / `▲` text marks.

Fast local check:

```sh
node --test tests/menubar-display.test.js tests/hosts-zerodep.test.js tests/hosts-disclosure.test.js tests/menubar-install.test.js
```
