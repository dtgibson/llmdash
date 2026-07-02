## Menu-bar badge (SwiftBar)

### What this does
Adds a macOS menu-bar badge that keeps the most-constrained remaining-usage %
glanceable in the corner of the screen, with a dropdown carrying the full
picture (both tools × both windows, reset countdowns, freshness, diagnostics).
It ships as one tiny **zero-dependency Node plugin** (`scripts/menubar/llmdash.5s.js`)
that a user-installed menu-bar host (SwiftBar, the documented default; xbar
works too) runs on a 5-second interval. The plugin is a **pure consumer** of the
dashboard's existing `/api/state` payload — no new data path, no limit
recomputation, no change to the server, and **zero new runtime dependencies /
no build step** for llmdash. SwiftBar is a disclosed, user-installed
prerequisite, never auto-installed.

The badge miniaturizes the dashboard's honesty language onto one glyph: **fresh**
shows a plain confident number; **aging** keeps the number with a trailing `·`
and a slight dim; **stale** tints it amber with a `⚠`; **no-reading** shows a
dash (never a number); **offline** shows `▪ llmdash ⚠` (never a number). A muted
`C`/`X` cue names which tool is tightest (C = Claude Code, X = codeX).

### How to test
1. Run the full suite — it stays green and adds the badge's coverage:
   ```
   npm test
   ```
   Expect **175 tests, 173 pass, 0 fail, 2 skipped** (the 2 skips are the
   node-resolution tests that skip when a system `node` exists — the established
   installer-test convention).
2. Preview the plugin's output without SwiftBar, against your live dashboard:
   ```
   node scripts/menubar/llmdash.5s.js
   ```
   You should see a valid SwiftBar title line (`▪ C 45% | color=…`), a `---`
   separator, both tool groups with two window rows each, and the
   `Open dashboard`/`Refresh` actions.
3. Verify the minimal-PATH interpreter fix (the load-bearing install step):
   ```
   # dev shebang under a minimal PATH → dead badge:
   env -i PATH=/usr/bin:/bin scripts/menubar/llmdash.5s.js        # env: node: No such file or directory
   # after baking the absolute node path, it renders:
   scripts/install-macos.sh --setup-badge /path/to/a/scratch/checkout
   ```
4. Verify the config knobs drive the fetch and the href — point the badge at a
   scratch server on a non-default port/host (covered by
   `tests/menubar-config.test.js`).

### Notes for reviewer
- **Module system:** the plugin is an ES module (the repo's `package.json` sets
  `"type":"module"`, and the SwiftBar `.5s.js` interval convention fixes the
  extension). It imports only Node builtins (`node:http`, plus `node:url`/`node:path`
  for the entry-point guard).
- **Reuse discipline / parity guard:** `fmtDur` and `ageBand` are copied
  **verbatim** from `public/app.js` (the plugin can't import browser JS), and the
  diagnostic copy mirrors `limitsNoteHtml`'s semantics. `tests/menubar-parity.test.js`
  fails loudly if the plugin's copies drift from the web client — including a
  behavioral cross-check and the shared own-key `hasOwnProperty` guard.
- **Security seam:** free-form diagnostic fields (`cmd`/`detail`) go through
  `sanitize()` (strips `|`/newlines — the menu-bar analogue of `esc()`), and
  reason codes map via own-key `hasOwnProperty` lookup so a `__proto__`/`constructor`
  reason can't bypass the generic fallback. Proven with a `| rm -rf /` injection
  fixture.
- **Interpreter under minimal PATH:** the installed artifact needs an **absolute
  node path** baked into its shebang — `#!/usr/bin/env node` produces a dead
  badge under the host's minimal spawn PATH (measured; node is under nvm here).
  `scripts/install-macos.sh --setup-badge` resolves + bakes it and **fails loudly**
  if node is unresolved. The checked-in file keeps a portable dev shebang.
- **Symmetric uninstall:** `scripts/install-macos.sh --remove-badge` mirrors
  `--setup-badge`. It removes **only the symlink** setup created — verified to be
  a symlink before `rm`, so it can never delete a real user file and never
  follows the link to delete its target (the repo source is untouched). It never
  uninstalls SwiftBar (it prints `brew uninstall --cask swiftbar` for the user to
  run by choice), and is re-run-safe (a friendly "nothing to remove", exit 0).
- **Configurable host (Stage-4 addition):** `LLMDASH_BADGE_HOST` (default
  `127.0.0.1`) lets the badge read a dashboard on another tailnet machine —
  still the same `/api/state`, not a second data path. It drives both the fetch
  and the *Open dashboard* href. Multi-host (a host *list*) is deliberately
  deferred; the fetch+compute is shaped as a function of `(host, port)` so a
  list could slot in later.
- **Deferred to deploy:** the live in-menu-bar screenshot (FR-02 capture) is
  gated on the user's `brew install --cask swiftbar`. Everything host-independent
  is unit-proven here; the plugin's stdout was also captured against the real
  running dashboard.
- **Deliberately not added:** a `healthLines()` badge line (FR-20 optional) — the
  health readout is about data sources feeding the dashboard, not an
  out-of-process consumer of it, and the README + installer output already
  disclose the prerequisite. Flagged, not silently dropped.
