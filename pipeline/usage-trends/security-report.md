# Security Review — Usage Trends

**Date:** 2026-06-16
**Method:** focused adversarial multi-agent review (CSP relaxation, /api/trends, chart rendering)
**Outcome:** PASSED WITH NOTES — does not block deployment

## Summary
No Critical, High, or Medium issues. The **CSP relaxation** (`style-src 'self'
'unsafe-inline'`) is confined to styles — `script-src` stays `'self'` with no
inline-script or eval — and every color/style/SVG value reaching `innerHTML` is a
hardcoded token literal or a numerically-coerced value, so the relaxation opens
no exploitable CSS/data-exfil sink. Text fields are escaped via `esc()`. The new
`/api/trends?range=` endpoint allowlists the range with a safe `7d` fallback
before any SQL/fs/cache use, uses bound SQL parameters, and returns only numeric
aggregates and timestamps (no prompts, transcript text, session IDs, paths, or
PII). Method handling, security headers, the static path-traversal guard, and the
per-range cache bound are all intact.

## Findings
### 1. 30d cold-cache reads more transcript files (minor, bounded)
**Severity:** Informational · **Location:** src/trends.js (buildTrends), src/stats.js (readUsageRecords)
**Description:** On a cold/expired cache, a 30d build reads ~4× more historical
transcript files than 7d, on the event loop, uncapped by file count/bytes. The
60s per-range cache caps forced cold computes to ~3/min, and the work is
comparable to the pre-existing `/api/state` path; under the threat model a peer
who can hit `/api/trends` can equally hit `/api/state`, so there is no meaningful
new amplification.
**Status:** **Accepted, not fixed.** A hard file/byte cap would risk silently
dropping the user's *legitimate* logs (they aren't attacker-controlled), which is
worse than the non-issue it addresses. Revisit only if the local corpus ever
grows pathologically large.

## Checks Performed (key)
| Check | Result |
|---|---|
| range allowlisted with safe `7d` fallback before SQL/fs/cache use | Pass |
| No SQL injection via range (computed ISO bound as `?`; window hardcoded) | Pass |
| Response exposes only numeric aggregates + timestamps; no tokens/PII | Pass |
| CSP relaxation confined to style-src; script-src stays `'self'` | Pass |
| Every style/SVG value in innerHTML is a literal token or coerced number | Pass |
| Text escaped via `esc()`; dates consumed via `Date.parse` only | Pass |
| Method/HEAD/500 handling intact; headers + no-store on every response | Pass |
| Static path-traversal guard intact; `/api/trends` is the only new endpoint | Pass |
| Per-range cache bounded (3 keys, 60s TTL); reuses audited readers; no new deps/paths/credential reads | Pass |

## Convention Flags
- Relaxing CSP for style is acceptable only while no untrusted input reaches a
  style attribute; keep style values to literals/coerced numbers and keep
  `script-src` locked.
