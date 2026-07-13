# Design Refinement — Cross-Surface Visual Refinement

## Visual Direction
Keep llmdash calm, technical, and immediate, but replace the accumulated stack of equal-weight bordered boxes with a deliberate reading order. Account limits are the focal point; pacing is the actionable second layer; activity, provenance, and trends recede without becoming faint. The dashboard and menu dropdown share the same `◆` / `▲` identity marks, semantic status colors, compact labels, and honest state language.

## Screens / Views

### Dashboard
- Preserve the existing wordmark and freshness state, but give the page a quiet atmospheric background and a stronger header rhythm.
- Treat each tool as one coherent section instead of a card containing more cards. Use a tinted section rail and tool mark to establish identity.
- Keep the two account-window gauges visually dominant. Reduce borders around secondary activity tiles and token mix so they read as supporting evidence.
- Make pacing a compact full-width band directly beneath the gauges, with window labels aligned and status pills consistently sized.
- Give Trends a single section header, quieter chart frames, clearer legends, and stronger active-range focus treatment.
- At narrow widths, stack gauges, pacing columns, model-limit headers, tool headers, and footer content without clipped resets or cramped labels.

### Menu-bar Dropdown
- Work within SwiftBar/xbar's native line, separator, color, size, font, image, and submenu vocabulary. Do not imitate web cards.
- Lead with the binding percentage and its host/tool/window context, then group by host and tool using indentation, `◆` / `▲`, type size, and separators.
- Apply semantic color to the existing remaining values while retaining words and symbols as the load-bearing state signal.
- Keep diagnostics beneath the readings they qualify. De-emphasize Display, Legend, service, host, uninstall, dashboard, and refresh actions as a final action region without changing order or behavior.
- Use one shared formatter for window rows across single-host and multi-host renderers so hierarchy cannot drift.

## Component Usage
- Existing `.tool`, `.gauges`, `.panel`, `.burn`, `.stat-grid`, `.mix`, `.host`, `.acct`, `.card`, `.range`, and status-pill patterns remain the implementation primitives.
- Evolve `.tool` into the principal visual grouping surface; gauges remain the only strongly elevated metric blocks.
- Use existing SwiftBar `menuLine`, `wrappedMenuLines`, `hostSectionLines`, action-cluster, and submenu helpers. Refactor duplicated limit-row presentation into a shared helper.
- No component library, icon library, runtime dependency, image fetch, or new preference is introduced.

## Design Tokens Applied
- Preserve the established good/warn/critical semantics and thresholds exactly.
- Keep light/dark automatic themes. Tint page atmosphere from the existing accent and panel tokens; all production color values remain CSS variables.
- Retain the established mono figures and system sans body stack. Increase hierarchy through scale, weight, tracking, and whitespace rather than a new font dependency.
- Normalize radii around the existing 10px/12px family and use shadow/depth only on the primary gauge layer.
- Keep the menu's dedicated dark-text dropdown palette and dark-strip status colors; improve application, not token meaning.

## Interaction Notes
- Existing range buttons gain visible hover, keyboard focus, and pressed states without changing their behavior.
- Existing bar and chart updates may use short opacity/width transitions only when values change.
- The mockup's Dashboard/Menu switch exists only to review both target surfaces; it is not a product control.
- Empty, aging, stale, no-reading, offline, binding, and monitoring-station states keep their current text and structural markers.

## Motion Spec
- Gauge/bar value change: `cubic-bezier(.2,.8,.2,1)`, 220ms, left center, instant under reduced motion, CSS.
- Range-control state: ease-out, 160ms, center, instant under reduced motion, CSS.
- Focus ring: ease-out, 120ms, control center, no transition under reduced motion, CSS.
- No entrance animation, pulsing decoration, hover scaling, stagger, bounce, or continuous motion.

## Content Notes
- Keep copy short, specific, and operational. Limits remain explicitly account-wide; activity remains per-machine/local-session evidence.
- Preserve reset times, freshness ages, diagnostic remedies, binding language, host labels, and menu action labels.
- Do not add Codex insights, activity rows to the menu, tooltips, new summaries, or new chart types in this improvement.

## Implementation Invariants
- `/api/state`, `/api/hosts`, `/api/trends`, stored snapshots, limit math, polling, and host fan-out do not change.
- Menu title-glyph output, display axes, logo fallback, action commands, host configuration, service controls, and uninstall safety do not change.
- Single-host, multi-host, same-account collapse, different-account, monitoring-station, and offline render paths all receive the same visual treatment.
- All externally sourced text remains escaped/sanitized; SwiftBar action rows stay explicitly constructed and separate from inert display rows.
- Existing parity, byte-output, security, responsive, render, and host-invocation tests remain authoritative.
