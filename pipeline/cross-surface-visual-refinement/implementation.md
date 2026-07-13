# Implementation — Cross-Surface Visual Refinement

## Summary

The dashboard and SwiftBar/xbar dropdown received one presentation-only refinement. The dashboard now has a clearer account-limits-first hierarchy, quieter supporting activity and trend layers, and explicit narrow-screen, focus, theme, and reduced-motion treatment. The dropdown now uses the same marked, indented, semantically colored limit-row presentation in single-host and multi-host modes, with diagnostics attached to the tool they qualify and existing actions visually de-emphasized at the end.

## Changes

- `public/index.html`
  - Adds the centered page shell and a semantic Trends section.
  - Removes static inline presentation styles from the Trends heading.
  - Adds the range-control label and initial `aria-pressed` state.
- `public/styles.css`
  - Extends the existing light/dark token set for the page atmosphere, tool accents, gauge elevation, and focus treatment.
  - Makes `.tool` the principal grouping surface with Claude `◆` and Codex `▲` rails, while preserving the gauges as the elevated metric layer.
  - Flattens supporting activity, token mix, model-limit, host, account, and trend presentation to reduce nested-card clutter.
  - Adds stronger active, hover, focus, and pressed states to the existing range controls; keeps value motion short and disables it under reduced motion.
  - Adds explicit reflow below 620px and 430px for gauges, pacing rows, tool/reset headers, model limits, hosts, trends, and the footer.
- `public/app.js`
  - Centralizes the fixed tool mark/tone mapping and applies it to single-host, account-limit, activity-only, full-host, and trend render paths.
  - Moves SVG series and legend colors from generated inline styles to CSS classes; data-driven meter widths remain the only generated inline styles.
  - Synchronizes `aria-pressed` whenever the selected trend range changes.
- `scripts/menubar/llmdash.5s.js`
  - Adds one shared `windowRowLine()` formatter for account and model windows across single-host and multi-host dropdowns.
  - Adds shared tool grouping so `◆` / `▲`, type size, indentation, semantic remaining-state color, model rows, and nearby diagnostics cannot drift between render paths.
  - Applies the binding status color to the dropdown summary and a consistent quieter style to the existing service, host, Display, Legend, uninstall, dashboard, and refresh action region.
  - Keeps actions explicitly constructed and separate from inert display rows.

## Invariants Preserved

- No API, persistence, polling, host fan-out, limit math, activity calculation, trend calculation, or data-model behavior changed.
- Existing tool/window copy, reset countdowns, freshness and offline semantics, diagnostic remedies, title-glyph computation, display preferences, host configuration, service controls, and uninstall behavior remain intact.
- Single-host, multi-host, same-account, different-account, monitoring-station, no-reading, stale, and offline paths still use their existing data and action contracts.
- Externally sourced dashboard text remains HTML-escaped, and menu text remains sanitized before entering SwiftBar/xbar grammar.
- The zero-dependency vanilla HTML/CSS/JavaScript runtime and current CSP/no-store posture are unchanged.

## Tests

- Added `tests/dashboard-refinement.test.js` for class-only static presentation, hierarchy, identity marks, range accessibility, responsive breakpoints, both themes, and reduced motion.
- Updated `tests/hosts-client.test.js` to cover the dashboard tool identity mark without weakening the existing single-host rendering assertions.
- Updated `tests/menubar.test.js` and `tests/menubar-multihost.test.js` to cover the shared window formatter, semantic colors, marks, indentation, model-row placement, diagnostic placement, and quiet action styling.
- Updated `tests/menubar-config.test.js`, `tests/menubar-degradation.test.js`, `tests/menubar-install.test.js`, and `tests/menubar-uninstall-dropdown.test.js` for the presentation parameters added to unchanged actions.

Verification: `npm test` passed with 488 tests total: 486 passed, 0 failed, and 2 environment-dependent negative-path tests skipped because a system-wide Node binary is available.

## Conventions

No new repository-wide convention or dependency was introduced. The implementation continues to use the existing CSS variables, renderer primitives, SwiftBar helpers, and test style; the new formatter and tool-mark mapping are local consolidations for this refinement.
