# Implementation — Menu Model Limits

## Summary
The menu-bar dropdown now shows model-specific Claude limits when the existing `/api/state` tool payload includes `modelLimits`. The rows are supplemental detail under the Claude tool section and do not participate in the title glyph, binding calculation, display presets, host grouping, or polling.

## Code Changes
- `scripts/menubar/llmdash.5s.js`
  - Carries normalized `modelRows` through `computeBadge()`.
  - Renders a `Model limits` sublabel after the account-wide Claude rows when model rows exist.
  - Renders each model row as an inert Menlo SwiftBar row using remaining percent, reset countdown, and the existing dropdown status colors.
  - Reuses the same render helper in single-host and multi-host host sections.
- `tests/menubar.test.js`
  - Covers single-host dropdown output for Fable/Sonnet rows and asserts the title glyph is unchanged.
- `tests/menubar-multihost.test.js`
  - Covers multi-host dropdown placement inside the binding host's Claude section.

## Verification
- `node --test tests/menubar.test.js`
- `node --test tests/menubar-multihost.test.js`
- `node --test tests/menubar-display.test.js`
- `/Users/developer/.weft/bin/weft-design-lint check pipeline/menu-model-limits/design.html scripts/menubar/llmdash.5s.js`

All passed.

## Notes
The model block is omitted when there are no model limits. This preserves the current compact dropdown for accounts or moments where Claude does not report Fable/Sonnet-style caps.
