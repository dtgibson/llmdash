# Security Review — Codex Usage

**Date:** 2026-06-16
**Method:** focused adversarial multi-agent review of the increment (subprocess, new file reads, multi-source refactor)
**Outcome:** PASSED WITH NOTES — does not block deployment

## Summary
No Critical, High, or Medium issues. The Codex integration is read-only and
well-contained: `spawn()` runs without a shell with fixed literal args and a
trusted operator-configured command (`LLMDASH_CODEX_CMD`), no attacker-controlled
data reaches the subprocess, the subprocess runs only on the 60s poller (never per
HTTP request) and is time-bounded and killed, all `JSON.parse` calls are guarded,
no credentials or transcript content are read or emitted, and all server-derived
strings rendered to `innerHTML` are HTML-escaped. Three raw findings were
dismissed on verification as out-of-threat-model. The two genuine low/info items
were fixed during the review.

## Findings
### 1. No range clamp on `used_pct` from local files
**Severity:** Low · **Location:** src/codex-limits.js (mapWindow), src/claude-limits.js
**Status:** Resolved — `used_pct` is now clamped to 0–100 in both readers, so a
malformed or hostile local file can't push out-of-range values into snapshots or
projections (garbage-in/garbage-out display only; no crash or injection). Fixed
the pre-existing Claude path too, for parity.

### 2. SIGTERM-only kill on subprocess timeout
**Severity:** Informational · **Location:** src/codex-limits.js
**Status:** Resolved — added a SIGKILL fallback after a short grace period if the
app-server ignores SIGTERM. Not exploitable under the threat model; process
hygiene.

## Dismissed on verification (out of threat model)
- Unbounded `readFileSync` of rollout files, uncapped directory walk, and
  app-server stdout buffer growth — each requires a privileged local writer or a
  misbehaving trusted binary; the in-scope no-auth GET peer cannot trigger or
  amplify any of them.

## Checks Performed (key)
| Check | Result |
|---|---|
| spawn() without shell; fixed args; trusted command; no attacker data to stdin | Pass |
| Subprocess poller-only (not per request), time-bounded, killed; degrades to null | Pass |
| SIGKILL escalation after SIGTERM | Resolved |
| All JSON.parse guarded; no prototype pollution; no ReDoS | Pass |
| NaN/Infinity blocked; finite-but-out-of-range now clamped | Resolved |
| No auth.json/credential reads; no token/account/PII in /api/state or logs | Pass |
| innerHTML strings HTML-escaped; untrusted inputs coerced to numbers | Pass |
| Refactor integrity: security headers, 405/HEAD, path-traversal guard intact; no new endpoints; sources not confusable; Claude path unchanged | Pass |

## Convention Flags
- Clamp externally-sourced percentages to their valid range before storing or
  deriving from them.
