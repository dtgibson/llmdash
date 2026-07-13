# QA Report — Cross-Surface Visual Refinement

**Date:** 2026-07-12  
**Stage:** 4 — Tester  
**Verdict:** PASS

## Test Results

- Full configured suite (`npm test`): **488 tests total, 486 passed, 0 failed, 2 skipped** in 9.09s.
- The two skips are environment-dependent negative-path installer checks: this machine has a system-wide Node binary, so the tests cannot create the intended “Node cannot be resolved” condition. Neither skip is introduced by this change.
- Focused dashboard/client run: **14 passed, 0 failed, 0 skipped**.
- Focused menu-bar run: **176 tests total, 174 passed, 0 failed, 2 skipped** (the same two environment skips).
- Syntax checks: `public/app.js` and `scripts/menubar/llmdash.5s.js` both passed `node --check`.
- Design lint: **3 production UI files scanned, 0 findings**.
- Patch hygiene: `git diff --check` passed.

## Acceptance Criteria Verification

| Criterion | Result | Evidence |
|---|---|---|
| The work remains a presentation-only Improve change. | Pass | Product changes are confined to dashboard markup/styles/render presentation and the menu renderer. No backend, API, persistence, polling, host fan-out, package, dependency, or data-model file changed. |
| Dashboard hierarchy is clear without repeated equal-weight card borders. | Pass | Tool sections use `◆` / `▲` identity marks and tinted rails; account-window gauges retain the only strong elevation; activity, mix, model, host, account, and trend layers use flatter dividers and soft surfaces. Focused structural tests and design lint pass. |
| Gauges remain primary and pacing remains the actionable second layer. | Pass | The existing gauge data and calculation paths are unchanged. Pacing is a compact full-width band immediately below the gauges, with aligned window labels and fixed-size semantic pills. |
| Trends are calmer and their existing controls are clearer and accessible. | Pass | Trends now have one semantic section header, quieter chart framing, class-based series/legend colors, hover/active/focus treatment, and synchronized `aria-pressed` state. Existing range behavior and trend fetch paths are unchanged. |
| Dashboard composes at wide and narrow widths in both automatic themes. | Pass | Main-agent browser QA covered desktop and narrow layouts. Source and regression checks confirm explicit 620px/430px reflow for gauges, pacing, reset/model/host headers, trends, and footer; light/dark token branches and reduced-motion behavior remain explicit. |
| Single-host dropdown scans from binding summary through tool readings, diagnostics, settings, and actions. | Pass | Direct current-checkout render inspection shows the semantic summary, `◆ Claude Code` / `▲ Codex` headers, indented account/model rows, diagnostic immediately below its qualifying tool, and the existing final action region in its established order. |
| Multi-host dropdown uses the same hierarchy while retaining host context. | Pass | Direct current-checkout render inspection shows binding host first, full host headers, marked and indented tool/window rows, local/remote context, per-tool diagnostics, and the same quiet action treatment. Multi-host, same-account, different-account, monitoring-station, and offline regression tests all pass. |
| Remaining-state color reinforces rather than replaces honest text. | Pass | Fresh/warn/critical/muted row colors are derived from existing thresholds, while `N%`, `limit reached`, `not available`, aging/stale labels, `—`, and `⊘` remain the load-bearing signals. No-reading and offline states still emit no fabricated digit. |
| Single- and multi-host row presentation cannot drift. | Pass | Both render paths call the shared `pushToolLines()` / `windowRowLine()` formatter, including model rows, indentation, type size, semantic color, and diagnostic placement. Focused formatter and cross-mode tests pass. |
| Existing menu actions, ordering, commands, and safety boundaries remain intact. | Pass | Service → host configuration → Display → Legend → uninstall → dashboard → refresh ordering remains covered. Actions still use explicit fixed commands/ARGV, retain `terminal=false` / `refresh=true`, and are not routed through inert display-row helpers. Host and label injection tests pass. |
| Existing copy and state contracts remain intact. | Pass | Reset countdowns, freshness/stale language, diagnostic remedies, host labels, account-vs-machine scope, title glyphs, display preferences, logo fallback, and service/uninstall semantics all pass the full regression suite. |
| No additional Codex insight or new capability leaked into this refinement. | Pass | No new stat, API field, chart type, menu preference, storage shape, or user action was added. The separately planned Codex-insights work remains out of scope. |

## Edge Cases Verified

- Fresh, warning, critical, maxed, aging, stale, no-reading, and offline menu states.
- Maxed windows retain “limit reached”; missing readings retain “not available”; malformed reset timestamps degrade to `—`.
- Model-specific rows remain under their owning tool and before the next tool section.
- Single-host, multi-host, same-account collapse, different-account, monitoring-station, selected-offline-host, and one-host-degenerate paths.
- Host/tool independence: one stale or unreachable source does not suppress healthy readings elsewhere.
- Host labels, model labels, diagnostic details, and configured hosts containing SwiftBar/HTML metacharacters remain escaped or sanitized.
- Dashboard generated inline styles remain limited to numeric meter/segment widths; chart and legend presentation is class-based.
- Keyboard focus, pressed range state, 620px/430px reflow, automatic dark theme tokens, and reduced-motion overrides.
- Installer wrapper creation/removal, service controls, display actions, and uninstall safety regressions remain green.

## Known Limitations / Deployment Check

- The installed SwiftBar wrapper intentionally still targets a separate installed checkout and was not mutated before deployment approval. Current-checkout renderer output is verified, but the final live SwiftBar visual smoke must occur after the approved checkout/wrapper refresh.
- The two Node-unresolved negative-path tests cannot run on this machine because a system-wide Node binary is available; all surrounding installer and wrapper tests pass.

## Convention Flags

None. The change introduces no dependency or repository-wide convention.
