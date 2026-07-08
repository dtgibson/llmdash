# Security Review - Status Bar Popup Legibility

**Date:** 2026-07-08
**Feature:** status-bar-popup-legibility
**Stack:** Node HTTP, zero runtime dependencies
**Checklist:** Improve-lane focused review; no backend-specific served checklist applies to this Node built-in stack
**Outcome:** PASSED

---

## Summary

Reviewed the new menu-bar dropdown formatting path in `scripts/menubar/llmdash.5s.js`, plus the updated menu-bar tests. The change formats existing display text only: it does not add any HTTP route, subprocess action, persistence, peer fetch, or new trust boundary. No security issues found.

---

## Findings

No security issues found in this feature.

---

## Checks Performed

| Check | Result |
|---|---|
| Free-form dropdown text is sanitized before reaching SwiftBar/xbar line output. | Pass |
| Wrapped diagnostic rows cannot preserve an injected `|` delimiter from user/config/peer text. | Pass |
| Wrapped rows emit only controlled `size`, `color`, and `font` params. | Pass |
| The existing `Open dashboard` `href=` path still uses `sanitizeHostPort`. | Pass |
| No new `shell=`, `bash=`, `terminal=`, or action params are introduced by the wrapping helpers. | Pass |
| No new HTTP endpoint, write path, service control, or peer fetch is introduced. | Pass |
| Offline/no-reading semantics still never fabricate a percentage. | Pass |
| Long-token wrapping does not create a new SwiftBar action line or submenu control. | Pass |
| `git diff --check` reports no whitespace errors. | Pass |
| Full automated test suite passes. | Pass |

---

## Notes

The main risk in this surface is SwiftBar grammar injection: display text and action params share a line format separated by `|`. The new helpers keep that boundary intact by sanitizing text before adding a fresh delimiter and by using only constant params. Existing action lines remain separate and unchanged.
