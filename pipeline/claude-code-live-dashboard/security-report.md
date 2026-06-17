# Security Review — Claude Code Live Dashboard

**Date:** 2026-06-16
**Feature:** claude-code-live-dashboard
**Stack:** vanilla Node (node:http + node:sqlite), zero dependencies
**Method:** adversarial multi-agent review (6 dimensions, each finding independently verified)
**Outcome:** PASSED WITH NOTES — does not block deployment

---

## Summary
A full security review across HTTP routing, injection, secret exposure, network
access, resource use, and supply chain found **no Critical, High, Medium, or Low
issues** after adversarial verification. Every genuine finding resolved to
Informational, and three reported items were dismissed as false positives. The
strongest properties hold: the app is read-only with no user input, no
path-traversal vector reaches the filesystem, all SQL is parameterized, there is
no eval/child_process/dynamic require/ReDoS, all JSON parsing is guarded, no
credential files are read, the server makes zero outbound requests, and no tokens
or transcript text appear in any response or log.

Threat model in scope: a no-auth same-LAN/tailnet peer, a malformed local
statusline/transcript file, and resource exhaustion. Public-internet attackers
are out of scope (machine behind NAT, no port forwarding).

The cheap, worthwhile notes were fixed during this review; the rest are accepted
as documented design or low-priority robustness.

---

## Findings

### 1. Default bind is 0.0.0.0 (LAN-reachable, no auth)
**Severity:** Informational · **Location:** config.js, src/server.js
**Description:** Binds all local interfaces, so a same-LAN peer can read
`/api/state`. Exposed data is low-sensitivity usage telemetry only (usage %,
reset times, token counts, cache rate, estimated value) — no credentials,
tokens, transcripts, or PII.
**Status:** Accepted — by design (Tailscale is the access boundary), documented,
with an `LLMDASH_HOST=<tailscale IP>` mitigation and a startup banner.

### 2. Non-numeric rate-limit value could throw on insert (contained)
**Severity:** Informational · **Location:** src/claude-limits.js
**Description:** A non-numeric `used_percentage` became NaN and was rejected by
the NOT NULL column (caught by the poller's try/catch; only the user's own file
could trigger it).
**Status:** Resolved — now guarded with `Number.isFinite`; bad windows are skipped.

### 3. Transcript files read fully into memory
**Severity:** Informational · **Location:** src/stats.js
**Description:** `readFileSync` + `split` with no per-file byte cap (bounded only
by the 7-day mtime filter and 30s cache). Input is the user's own logs, not
attacker-controlled.
**Status:** Accepted — robustness only; revisit with streaming if logs grow huge.

### 4. No retention policy on the snapshots table
**Severity:** Informational · **Location:** src/db.js
**Description:** Slow unbounded growth (kilobytes/day), not attacker-driven.
**Status:** Accepted — left unbounded on purpose so feature 3's charts keep full
history; a prune can be added later if needed.

### 5. Request method was not validated
**Severity:** Informational · **Location:** src/server.js
**Status:** Resolved — non-GET/HEAD now returns 405 with `Allow: GET, HEAD`; HEAD
sends headers only.

### 6. Missing baseline security headers
**Severity:** Informational · **Location:** src/server.js
**Status:** Resolved — added `X-Content-Type-Options: nosniff`, a restrictive
`Content-Security-Policy` (`default-src 'self'`), and `Referrer-Policy`.

### 7. Stray vitest cache in node_modules
**Severity:** Informational · **Location:** node_modules/.vite
**Description:** An inert, gitignored cache from an accidental `npx vitest run`.
**Status:** Resolved — `node_modules` removed; the project has zero dependencies
and tests run on `node:test`.

### 8. Broader ~/.claude harness flags (out of scope)
**Severity:** Informational · **Location:** ~/.claude/settings.json
**Description:** The statusLine wiring this project added is sound. Noted only for
completeness: the user's pre-existing settings also carry `autoUpdate: true` on
an external marketplace and `skipDangerousModePermissionPrompt: true` — broader
host trust decisions unrelated to this feature.
**Status:** Accepted — out of scope; surfaced for the user's awareness only.

---

## Dismissed on verification (false positives)
- `publicDir` traversal guard is dead code (all static call sites pass constant literals) — not reachable.
- "Concurrent stats recompute race" — the handler is fully synchronous; no race exists.
- World-readable data files — non-secret contents on a single-user host.

---

## Checks Performed
| Check | Result |
|---|---|
| Path traversal — no user-controlled path reaches the filesystem | Pass |
| `/api/state` built from a fixed numeric/ISO field whitelist; no CORS; no secrets | Pass |
| Request-method handling (405 / HEAD) | Resolved |
| Baseline security headers (nosniff / CSP / Referrer-Policy) | Resolved |
| SQL fully parameterized; static DDL only | Pass |
| JSON parsing guarded with try/catch (rate-limit file + every transcript line) | Pass |
| No prototype pollution; no eval / child_process / dynamic require / ReDoS | Pass |
| Reads no credential/token files; reads scoped to projects, rate-limit file, public/ | Pass |
| No tokens / transcript text / PII in responses or logs; zero outbound requests | Pass |
| Network bind exposes only low-sensitivity telemetry; LLMDASH_HOST honored | Accepted (note 1) |
| Per-request transcript scan bounded by mtime filter + 30s cache | Pass |
| Malformed JSONL / rate-limit JSON handled safely; NaN window guarded | Resolved |
| Transcript memory read unbounded by file size (user's own logs) | Accepted (note 3) |
| Snapshot table dedup present; no retention policy | Accepted (note 4) |
| Zero declared dependencies; node:sqlite is a genuine Node 24 builtin; engines pins Node >=24 | Pass |
| Stray vitest cache removed | Resolved |
| statusline.js fails closed, runs no third-party code, persists no credentials | Pass |
| .gitignore excludes node_modules/, data/, *.db, *.log | Pass |

## Convention Flags
- Surface security-relevant defaults (network binding, etc.) in the README and the startup log, never silently.
- Default new HTTP responses to the baseline security headers established here.
