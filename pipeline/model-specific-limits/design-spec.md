# Design Spec: Model-Specific Limits

## Placement

Model-specific caps render immediately after account-wide gauges, diagnostic notes, and pacing. This keeps them in the limits region while separating them from account-wide windows.

## Component

Use a compact `model-limits` section:

- Section label: `model-specific limits`
- One row/card per model cap.
- Left side: model label and window label.
- Right side: remaining percentage and reset countdown.
- A slim remaining bar uses the same good/warn/crit status colors as account gauges.
- A short note states that model caps are inside the tool and do not add account-wide budget.

## Multi-Host Behavior

- Same-account banner: show model caps once with the shared account limits.
- Same-account host cards: show activity only, as today.
- Distinct-account host cards: show that host's model caps with that host's account limits.

## Visual Constraints

- Reuse existing color tokens and type roles.
- No new charting or decorative elements.
- Dynamic model labels are escaped by the renderer.
