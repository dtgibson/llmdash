# Security Review - Compact Mode Display Honesty

**Date:** 2026-07-08
**Feature:** compact-mode-display-honesty
**Stack:** Node HTTP, zero runtime dependencies
**Checklist:** Improve-lane focused review; no backend-specific served checklist applies to this Node built-in stack
**Outcome:** PASSED

---

## Summary

Reviewed the menu-bar output formatting changes in `scripts/menubar/llmdash.5s.js`, the Display copy changes in `src/health.js` and `README.md`, and the updated menu-bar tests. The change is presentation-only: it moves existing dropdown text below the SwiftBar/xbar separator and renames constant display labels. No new security issues found.

---

## Findings

No security issues found in this feature.

---

## Checks Performed

| Check | Result |
|---|---|
| Separator change does not introduce a new SwiftBar/xbar action row. | Pass |
| Existing action rows (`shell=`, `href=`, refresh, submenu controls) remain explicitly constructed and unchanged. | Pass |
| Free-form host and diagnostic text remains sanitized before line output. | Pass |
| Watching/unreachable text is inert dropdown text and cannot become a status-bar action param. | Pass |
| Display submenu label changes are constant strings, not user-controlled data. | Pass |
| Health disclosure and README changes do not affect runtime trust boundaries. | Pass |
| No new HTTP endpoint, outbound fetch, file write, subprocess action, or persistence path is introduced. | Pass |
| Compact offline/no-reading states still never fabricate a number. | Pass |
| `git diff --check` reports no whitespace errors. | Pass |
| Full automated test suite passes. | Pass |

---

## Notes

The relevant security boundary is still SwiftBar grammar injection, where visible text and action params share a line format separated by `|`. This change keeps that boundary intact: the newly relocated lines are existing sanitized text rows, and the action rows continue to be built from fixed helpers.
