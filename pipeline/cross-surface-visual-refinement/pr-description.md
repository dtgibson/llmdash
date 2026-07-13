# Cross-Surface Visual Refinement

## What this does

Refines the existing dashboard and SwiftBar/xbar dropdown as one visual system without adding a feature or changing the data shown. The dashboard now emphasizes account-window gauges, turns pacing into the clear second layer, quiets supporting activity and trends, carries `◆` / `▲` tool identity throughout, and reflows cleanly at phone widths. Trend range controls also have explicit hover, focus, pressed, and `aria-pressed` states.

The dropdown now shares one formatter for account and model window rows in single-host and multi-host modes. Tool marks, indentation, type scale, semantic remaining-state color, nearby diagnostics, and a quieter final action region make the same menu content easier to scan.

## How to test

1. Run `npm test`.
2. Run `npm start` and open <http://localhost:8787>.
3. At a wide viewport (at least 760px), confirm gauges remain the dominant cards, activity/model layers are quieter, and trend cards form two columns.
4. At a 390px viewport, confirm gauges, pacing, tool/reset headers, model limits, hosts, Trends controls, and footer stack without clipping.
5. With the local SwiftBar wrapper installed, refresh SwiftBar and open the llmdash menu. Confirm the summary leads, `◆` / `▲` tool rows contain indented and semantically colored windows, diagnostics sit under the affected tool, and the existing actions remain in their established final order.

## Notes for reviewer

This is presentation-only. `/api/state`, `/api/hosts`, `/api/trends`, stored snapshots, polling, host grouping, limit/activity calculations, menu title glyphs, display preferences, and action commands are unchanged. Generated dashboard inline styles are still used only for data-driven widths; chart and legend colors now use CSS classes. No dependency or repository-wide convention was added.
