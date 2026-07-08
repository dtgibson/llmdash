## Menu-Bar Dropdown Legibility And Legend

### What this does
The SwiftBar/xbar badge dropdown now uses an explicit dark dropdown palette for normal informational rows instead of relying on faint gray or menu-bar colors. The on-demand legend now documents the full badge grammar, including the `▪` llmdash mark, host/tool separators, binding-host marker, freshness states, tool marks, compact host cues, overflow, and menu/action symbols.

### How to test
Run the focused menu-bar suites:

```sh
node --test tests/menubar.test.js
node --test tests/menubar-multihost.test.js
node --test tests/menubar-display.test.js
node --test tests/qa-badge-display.test.js
```

Then run the full suite:

```sh
npm test
```

Preview the installed-style plugin output:

```sh
node scripts/menubar/llmdash.5s.js
```

Check that normal dropdown rows use dark colors (`#111111`, `#1f1f1f`, `#333333`) and the legend explains `▪`, `◆`, `▲`, `◷`, `⚠`, `—`, `⊘`, `✓`, `＋`, `－`, `☰`, `🖥`, `🛈`, and `▬`.

### Notes for reviewer
This is presentation-only. It does not change `/api/state`, `/api/hosts`, polling, persistence, display preferences, service controls, or any helper command targets.
