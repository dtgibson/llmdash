# Security Review — Model Limit Detection

**Date:** 2026-07-11
**Feature:** model-limit-detection
**Stack:** node http (minimal, few dependencies), vanilla frontend not touched
**Checklist:** No dedicated checklist for this stack; generic file/JSON/subprocess/trust-boundary review
**Outcome:** PASSED

---

## Summary

Reviewed the Claude statusline capture path, `/usage` auto-refresh capture loop, and local JSON write/merge logic added for model-specific limits. The fix does not add a new HTTP route, dependency, external network call, credential surface, or user-triggered shell command. No security issues found.

---

## Findings

No security issues found in this feature.

---

## Checks Performed

| Check | Result |
|---|---|
| No new runtime dependency or package install was introduced. | Pass |
| No new HTTP endpoint, mutation route, or remotely callable action was added. | Pass |
| The existing `/usage` runner remains a fixed shell constant; config values still enter as positional arguments, not interpolation. | Pass |
| The refresh subprocess still uses the existing allowlisted environment and dedicated refresh cwd. | Pass |
| The change does not send any user/model/statusline content to a shell command. | Pass |
| The statusline script still treats malformed stdin as non-fatal and never breaks Claude's status line on write errors. | Pass |
| Local JSON writes remain atomic via temp file plus rename. | Pass |
| A malformed or missing current reading file is handled as absent data, not as a crash. | Pass |
| Preserved model-limit rows are only carried forward when their reset time parses and is still in the future. | Pass |
| Preserved model-limit rows keep their original `captured_at` rather than being restamped by an account-only statusline write. | Pass |
| Incoming model-limit rows still pass through the existing slug, clamp, reset conversion, and canonical timestamp path. | Pass |
| Peer/UI exposure remains through existing normalization and escaping paths; no raw label/style interpolation was added. | Pass |
| `git diff --check` passed. | Pass |
| Focused regression tests and full `npm test` passed. | Pass |

---

## Notes

The only meaningful trust boundary touched here is the local `data/claude-ratelimits.json` file. The merge logic copies active local model rows forward, but downstream readers still normalize percentages, timestamps, labels, and sources before serving or rendering them.
