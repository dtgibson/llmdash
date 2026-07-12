# Design Refinement — Menu Model Limits

## Visual Direction
Keep the menu dropdown utilitarian and scan-first. Model-specific caps are supplemental Claude detail, not new headline constraints, so they sit inside the existing Claude section beneath the account-wide 5-hour and weekly rows.

## Screens / Views

### SwiftBar/xbar Dropdown
- In each host's Claude Code section, render the existing account windows first.
- When `modelLimits` has rows, add a small `Model limits` label directly under the account windows.
- Render each model cap as a Menlo row: `[Label]:  NN% · resets [duration]`.
- Use the same percentage/status color rules as account rows: remaining `>=50` good, `20-49` warn, `<20` crit.
- Do not show a model block when there are no model limits. Do not add placeholder rows.
- Do not change the title glyph, display presets, host grouping, tool grouping, or the Legend.

## Component Usage
This is SwiftBar/xbar line output, not DOM UI. Use existing helpers for menu rows, status color, reset duration, text sanitization, and non-action rows.

## Design Tokens Applied
- Section labels use the existing dropdown muted color `#333333`.
- Model rows use the existing dropdown body color/status colors and `font=Menlo`.
- No new colors or symbols.

## Interaction Notes
The rows are inert display rows with `bash=/usr/bin/true terminal=false refresh=false`, matching existing account-window rows. They should appear in single-host and multi-host dropdowns anywhere a Claude tool block is rendered.

## Motion Spec
- Menu rows: no motion; host-controlled SwiftBar/xbar dropdown.

## Content Notes
Use model labels exactly as normalized by the API, sanitized for SwiftBar grammar. Use “Model limits” as the sublabel because it reads clearly beside account-wide “5-hour” and “Weekly” rows.
