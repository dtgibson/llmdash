# Security Review - Menu-Bar Dropdown Legibility And Legend

**Date:** 2026-07-08
**Feature:** menubar-dropdown-legibility-legend
**Stack:** vanilla Node, zero runtime dependencies
**Checklist:** Improve-lane presentation/security-surface review
**Outcome:** PASSED

---

## Summary

This change only adjusts SwiftBar/xbar presentation output: fixed dropdown colors, static legend copy, and tests/docs around those strings. It does not add or modify HTTP routes, persistence, polling, outbound fetches, subprocess calls, AppleScript, template images, or action command targets.

---

## Findings

No security issues found in this improvement.

---

## Checks Performed

| Check | Result |
|---|---|
| No new HTTP route or mutation endpoint | Pass |
| No new persistence or config write path | Pass |
| No new peer fetch, poller behavior, or request-path work | Pass |
| No new subprocess, shell, launchctl, osascript, or helper target | Pass |
| No new SwiftBar `shell=`, `bash=`, `href=`, or action-param surface from user-controlled text | Pass |
| Legend copy is static and sanitized through the existing `menuLine`/`submenuLine` path | Pass |
| Wrapped diagnostics remain sanitized and bounded | Pass |
| `git diff --check` | Pass |
| Dependency audit | Not applicable: no lockfile and no dependency sections in `package.json` |

---

## Notes

The diff inspection command searched added renderer lines for new action or IO surfaces (`shell=`, `bash=`, `href=`, `exec`, `spawn`, `http`, `fetch`, `write`, `rename`, `osascript`, `templateImage`, and `paramN=`) and found no new additions. Existing action rows remain explicitly constructed and continue to point at the same checked-in helpers.
