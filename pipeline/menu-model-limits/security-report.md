# Security Review — Menu Model Limits

**Date:** 2026-07-11
**Feature:** menu-model-limits
**Stack:** frontend `vanilla (HTML/CSS/JS, no framework, no build step)`; backend `node http (minimal, few dependencies)`; SwiftBar/xbar menu-bar plugin
**Checklist:** No dedicated Weft checklist exists for this vanilla Node/SwiftBar shape. Used the required generic data-access and OWASP-style review for unmapped stacks.
**Outcome:** PASSED

---

## Summary

Reviewed the menu-bar plugin changes in `scripts/menubar/llmdash.5s.js`, the new tests, and the existing model-limit normalization paths in `src/server.js` and `src/hosts.js`. The change is presentation-only: it adds inert dropdown rows for already-normalized `modelLimits` and does not add network requests, HTTP endpoints, persistence, dependencies, or shell commands. No security issues were found.

---

## Findings

No security issues found in this feature.

---

## Checks Performed

| Check | Result |
|---|---|
| New attack surface: no new HTTP route, fetch path, persistence path, subprocess, dependency, or config knob was added. | Pass |
| SwiftBar command injection: model rows use `menuLine(..., inert default)` which appends the fixed no-op `bash=/usr/bin/true terminal=false refresh=false`; model data is never used in `shell`, `bash`, `param`, or `href` values. | Pass |
| SwiftBar line grammar injection: model labels are interpolated into menu text only, and `menuLine()` sanitizes text through `sanitize()`, stripping `|`, CR, and LF before output. | Pass |
| XSS/HTML injection: the touched code writes SwiftBar text output, not DOM HTML. Existing dashboard model-limit rendering still uses `esc()` in `public/app.js`. | Pass |
| Data normalization: local state and peer state already normalize model-limit percentages and timestamps in `src/server.js` and `src/hosts.js`; the menu-bar layer additionally skips non-finite remaining values and clamps display percentages. | Pass |
| Malformed timestamp degradation: model row reset text now checks `Date.parse()` and renders `—` instead of formatting invalid dates. | Pass |
| Title glyph and binding integrity: model rows are carried separately as `modelRows` and are not used in the binding-min calculation that drives the title glyph. | Pass |
| Authorization/authentication: no new protected surface or remote mutation was introduced. Existing serve-only HTTP behavior is unchanged. | Pass |
| Secrets handling: no secrets, credentials, tokens, or environment variables were added or exposed. | Pass |
| Denial-of-service regression: the new loop is bounded to the already-provided `modelLimits` array, skips invalid entries, and performs only string formatting. No blocking I/O or subprocess work was added. | Pass |
| Dependency vulnerability check: no package dependencies changed. | Pass |
| Regression evidence: `npm test` passed with 482 passing, 0 failing, 2 skipped. | Pass |
