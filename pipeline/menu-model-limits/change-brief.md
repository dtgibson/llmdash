# Change Brief — Menu Model Limits

## What is changing
The macOS menu-bar dropdown should show Claude model-specific limits, such as Fable and Sonnet, when those limits are present in the existing state payload. The account-wide Claude 5-hour and weekly rows stay as they are; model rows are supplemental detail in the same Claude section.

## Why now
The dashboard already shows these model caps, and the user wants the menu dropdown to carry the same useful Fable/Sonnet visibility without opening the dashboard.

## User-facing impact
The existing menu dropdown gains additional Claude detail rows when model-specific limits are available. The menu-bar title glyph, display preferences, polling, dashboard, and data contracts should not change.

## Design pass
Needed — this refines the existing SwiftBar/xbar dropdown layout. The Claude host/tool section should show model-specific limits clearly without crowding the compact menu or weakening the existing account-window hierarchy.

## Decisions touched
- Model-limit detection — preserve active model caps across statusline writes.
- Menu-bar dropdown legibility and complete legend.
- Badge display options — display as a pure presentation layer.

## What done looks like
Fable/Sonnet-style limits appear under Claude in the dropdown when `modelLimits` are present, with reset/remaining copy and readable styling. Existing dropdown states, legend, display presets, and title glyph output continue to pass their tests.
