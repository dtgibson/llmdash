# Change Brief - Status Bar Popup Legibility

## What is changing
Improve the existing SwiftBar/xbar menu-bar pop-up so it is easier to read and long unavailable-server messages do not force the dropdown to become excessively wide. The likely work is in the badge output helpers: shared readable text sizing, bounded diagnostic/offline line lengths, and wrapped follow-up lines where SwiftBar would otherwise keep one long row.

## Why now
The menu-bar badge is now a primary operating surface, but its dropdown is barely legible. A server-unavailable state can also emit a long single-line explanation, making the pop-up huge and hard to use.

## User-facing impact
The existing pop-up becomes more legible and keeps unavailable-server explanations within a sane width. No new menu item, monitored data, preference axis, or dashboard behavior is introduced.

## Decisions touched
- Badge display options: display remains a pure presentation layer over the existing badge views; the dropdown still lists the full monitored state.
- Multi-host badge: unavailable hosts are still named honestly and never converted into fake readings.
- Menu-bar badge: the SwiftBar/xbar plugin remains zero-dependency and must be verified through the real host-style invocation path.

## What done looks like
The unavailable local-dashboard and remote-host messages render as bounded, readable dropdown text instead of one very wide line.
The normal single-host, multi-host, and display-option badge glyphs stay compatible with the existing output contract.
Focused menu-bar tests cover long unavailable-server copy and the real plugin invocation still emits valid SwiftBar lines.
