# Security Review — Weekly Limit Predictor & Codex Stats

**Date:** 2026-06-17
**Feature:** weekly-limit-predictor-and-codex-stats
**Stack:** vanilla `node:http`, zero runtime deps (no preset framework checklist applies)
**Checklist:** general web-app review (XSS/injection, parsing safety, file handling, subprocess, secrets, data exposure, DoS, network surface) — run as a two-lens adversarial audit
**Outcome:** PASSED WITH NOTES

---

## Summary
Independent two-lens adversarial review (injection/client-side, and server/data/network) of the changed code. No Critical or High findings — deployment is not blocked. Two low/informational items that touched this feature's code were fixed and re-verified; one pre-existing low item is documented and accepted. NFR-04 (no credential reuse, no unsupported APIs, no public network exposure) holds.

---

## Findings

### 1. A malformed `null` JSONL log line crashed `/api/state` and `/api/trends` — RESOLVED
**Severity:** Low
**Location:** `src/codex-stats.js` — `modelFromEvent`, `usageFromEvent`, `readUsageRecords` per-line loop
**Description:** The per-line loop wrapped only `JSON.parse` in try/catch. A line of exactly `null` is valid JSON; the newly added `modelFromEvent(o)` then dereferenced `o.payload` before its own guard, throwing. The error escaped to the HTTP layer, so both endpoints returned 500 while the offending line stayed within the 7-day window (the poller swallows it, so the process survived). Impact is local-only (the input is the user's own `~/.codex` log), hence Low.
**Remediation:** Added an object-shape guard after `JSON.parse` in `readUsageRecords` (`if (!o || typeof o !== 'object') continue;`) and a null-safe guard at the top of `usageFromEvent` and `modelFromEvent`. Added a regression test asserting `usageFromEvent` returns null (no throw) on `null`/number/string/array input.
**Status:** Resolved — `npm test` 21/21.

### 2. `esc()` did not escape quote characters — RESOLVED (hardening)
**Severity:** Informational
**Location:** `public/app.js` — `esc()`
**Description:** `esc()` escaped only `& < >`, not `"`/`'`. Not exploitable today: every escaped value (tool label/plan, headroom labels) is a hardcoded server-side literal interpolated only into element text content, never an attribute. Flagged as a latent footgun if a label ever lands in an attribute or becomes log-derived.
**Remediation:** Extended `esc()` to also escape `"` → `&quot;` and `'` → `&#39;`. Visually identical in text content; future-proofs attribute contexts.
**Status:** Resolved.

### 3. Unbounded `readFileSync` of local log files — ACCEPTED (pre-existing)
**Severity:** Low
**Location:** `src/codex-stats.js` / `src/stats.js` `readUsageRecords`
**Description:** Each in-window log file is read in full (no per-file byte cap), bounded only by mtime filtering. A multi-GB local log touched within the window would load entirely into memory on a poll. DoS-on-self only — the files are the user's own local logs behind the Tailscale boundary; repeated walks are bounded by the 30s/60s caches. This feature did not introduce or worsen it (the new code only adds a bounded `reasoning` field per record).
**Remediation:** Optional future hardening — skip/stream files above a size cap in the directory walk. Out of scope for this feature.
**Status:** Accepted (pre-existing).

---

## Checks Performed

| Check | Result |
|---|---|
| XSS — trace every value in new/changed render paths to source | Pass (all string labels are server-side literals + `esc()`; window names are literals) |
| XSS — could a crafted log field (e.g. model name) reach `innerHTML` | Pass (log-derived `model` is used only for pricing; never serialized to the client) |
| Inline-style / CSP — dynamic style values are literals or coerced numbers | Pass (widths are arithmetic/`Math`-derived; colors are `var(--…)` literals) |
| Prototype pollution in parsing | Pass (read-only access; no merge/assign of parsed objects) |
| Adversarial number coercion of token fields | Pass (`Number(x ?? 0) || 0`) |
| ReDoS / unsafe regex | Pass (only `esc()`'s linear character class) |
| Malformed JSONL robustness | Finding → **Resolved** (null/primitive lines now skipped) |
| Crash containment | Pass (process survives; endpoints hardened) |
| Path traversal — `serveStatic` | Pass (called only with 3 hardcoded names; `startsWith(publicDir)` guard intact) |
| Path traversal / symlink — log directory walks | Pass (fixed operator-configured dirs; no request-controlled path) |
| Subprocess / command injection (`codex app-server`) | Pass (not in this diff; fixed arg array, no shell; off the request path) |
| Secrets / credentials / PII in source or diff | Pass (none; pricing tables are public estimates) |
| Data exposure via `/api/state` & `/api/trends` | Pass (only numeric aggregates of the user's own local usage; no raw logs/prompts/paths) |
| DoS via large local log file | Finding (Low) → **Accepted** (pre-existing, self-only, cache-bounded) |
| Network surface — new listener/port/inbound | Pass (no new listener; `0.0.0.0` bind pre-existing + documented) |
| Clamping of externally-sourced percentages | Pass (clamped at the limit-reader layer; `Math.max(0,…)` in new mix math) |
| Test suite regression | Pass (21/21) |

---

## Convention Flags
- Keep tool `label` / `plan` / chart `source` strings as hardcoded server-side
  literals (never derived from a log or limit file). If that ever changes, the
  value must flow through the (now quote-safe) `esc()` and never into a style or
  attribute unescaped.
