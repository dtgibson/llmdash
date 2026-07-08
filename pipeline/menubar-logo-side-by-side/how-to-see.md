# How To See — Menu-Bar Logo Side-By-Side

1. Open the menu-bar badge dropdown.
2. Choose **Display -> Group by -> Tool**.
3. Choose **Display -> Glyph layout -> Side-by-side**.
4. Choose **Display -> Tool marks -> Logos**.

Expected result in SwiftBar: the menu-bar line keeps the readable `◆` / `▲` text
marks and also gets a small paired Claude/OpenAI logo image. Single-tool or
rotating tool views use one smaller 16x16 logo. xbar, or an image-render failure,
continues to show only the neutral `◆` / `▲` text marks.

Fast local check:

```sh
node --test tests/menubar-display.test.js tests/hosts-zerodep.test.js tests/hosts-disclosure.test.js tests/menubar-install.test.js
```
