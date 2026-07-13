# Change Brief — Cross-Surface Visual Refinement

## What is changing
Refine the existing dashboard and SwiftBar/xbar dropdown as one presentation pass. Strengthen hierarchy, reduce border clutter, improve responsive/mobile composition, polish chart cards and range controls, and make the native dropdown easier to scan with the established typography, colors, `◆`/`▲` marks, and separator grammar.
This stays in the Improve lane: it reshapes existing presentation only, with no new surface or capability.

## Why now
The product has accumulated capable but visually dense limit, activity, trend, host, diagnostic, and menu sections. A cohesive refinement will make the same information faster to parse on phone, laptop, and the native menu without adding more information or controls.

## User-facing impact
The two current surfaces become calmer, clearer, and more consistent. All data, APIs, calculations, freshness/offline semantics, menu actions, badge preferences, title-glyph behavior, and user-visible capabilities remain unchanged; this adds no surface, capability, or data model.

## Design pass
Needed — this is a cross-surface visual change with responsive layout and hierarchy judgments. The pass must preserve the mobile-first, plain, fast readout character, use the existing token system in light and dark modes, and respect SwiftBar/xbar's native line and submenu constraints.

## Decisions touched
- Menu-bar dropdown legibility and complete legend; Dropdown legibility and aging symbols.
- Status bar popup legibility; Compact mode display honesty.
- Badge display options — presentation-only view, `◆`/`▲` grammar, full dropdown.
- Multi-host — same-account limits and per-machine activity remain semantically distinct.
- Vanilla, zero-dependency stack; Inline-style CSP + no-store static assets.

## What done looks like
Dashboard hierarchy is evident without relying on repeated card borders; gauges, activity, host groups, charts, and controls remain readable at narrow and wide widths in both themes. Single- and multi-host dropdowns scan cleanly from summary to host/tool detail, diagnostics, settings, and actions, while every existing output/action contract and test remains intact.
