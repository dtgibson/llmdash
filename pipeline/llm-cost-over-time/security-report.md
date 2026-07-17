# Security Review — LLM Cost Over Time

**Date:** 2026-07-16
**Feature:** `llm-cost-over-time`
**Stack:** Vanilla HTML/CSS/JavaScript frontend; Node.js built-in `http` backend; SQLite unchanged
**Checklist:** Generic OWASP Top 10 and data-access/local-file trust-boundary fallback, plus `reference/checklists/security-react-vite.md` and `reference/checklists/security-vercel-edge.md` as the closest available browser and JavaScript HTTP checklists. The configured vanilla frontend and Node `http` backend have no dedicated Weft checklists.
**Outcome:** PASSED WITH NOTES

---

## Summary

The full feature was reviewed from owner-edited JSON and provider JSONL ingestion through fixed-point aggregation, immutable caching, the read-only endpoint, and browser/SVG rendering. Three implementation issues found during the audit were remediated and regression-tested; no Critical, High, or open code-level vulnerability remains. The existing unauthenticated `0.0.0.0` LAN/tailnet serving boundary now includes personal spend aggregates and remains an accepted informational exposure.

---

## Findings

### Filesystem safety ceilings were not initially enforced at the actual I/O boundary

**Severity:** Medium
**Location:** `src/bounded-file.js:33`, `src/usage-ledger.js:69`, `src/usage-ledger.js:119`, `src/codex-events.js:225`, `src/codex-events.js:524`, `src/subscriptions.js:150`, `src/rate-card.js:166`
**Description:** The initial implementation checked pathname metadata before whole-file reads, allocated a full Claude directory listing before enforcing the entry cap, allowed one file parser to accumulate more records than the published cap before the outer check, and gave the Codex cost scan no wall-clock deadline. A same-user file replacement or hostile local evidence tree could therefore follow a final symlink race, exceed an advertised allocation/record boundary, delay the poller, or ingest unintended user-readable input. The paths were fixed configuration paths rather than remotely selected paths, so this did not cross an operating-system privilege boundary, but it weakened the feature's core local-file and availability guarantees.

**Remediation:** A shared descriptor-based reader now opens final files with `O_NOFOLLOW`, validates regular-file type and size with `fstat`, compares descriptor identity to the inspected file, reads at most inspected size plus one byte, revalidates after reading, and rejects growth or replacement before publication. Claude discovery uses streamed `opendirSync` iteration, Claude and Codex enforce accepted-record caps inside their parsers, and Codex carries a scan/parser deadline. Static root, directory-entry, and candidate-file symlinks are rejected. Tests cover inode replacement before any read, growth detection, final and candidate symlinks, streamed entry exhaustion, parser-local record exhaustion, and Codex time exhaustion. Concurrent replacement of an ancestor directory is not descriptor-relative in Node's pathname APIs, but remains inside the same-UID trust boundary; that actor can already read and modify the configured sources and application files.

**Status:** Resolved

### Diagnostic copy lookup accepted inherited object properties

**Severity:** Low
**Location:** `public/app.js:1309`, `public/app.js:1427`, `tests/cost-analysis-client.test.js:173`
**Description:** The original diagnostic lookup used truthiness on `COST_REASON_COPY[reason]`. Prototype-like names such as `constructor` could resolve inherited `Object.prototype` values and render misleading text. The final output was HTML-escaped, so this was not an XSS path.

**Remediation:** Both diagnostic lookups now require `Object.hasOwn(COST_REASON_COPY, reason)` and otherwise use fixed fallback copy. A hostile `constructor` regression proves that inherited functions are never rendered.

**Status:** Resolved

### Provenance labels did not reject every display-spoofing Unicode class

**Severity:** Informational
**Location:** `src/rate-card.js:33`, `src/rate-card.js:43`, `tests/rate-card.test.js:70`
**Description:** Rate-source labels initially rejected control characters and explicit bidi override/isolate ranges but did not reject all Unicode format (`Cf`) or line/paragraph separator (`Zl`/`Zp`) characters required by the repository's external-display convention. HTML escaping prevented executable injection, but an owner-edited or compromised rate card could have produced visually confusing provenance.

**Remediation:** `boundedText` now rejects `Cf`, `Zl`, and `Zp` in addition to malformed Unicode and the prior control ranges. Regressions cover zero-width format and line-separator characters.

**Status:** Resolved

### Personal cost aggregates share the existing unauthenticated LAN/tailnet boundary

**Severity:** Informational
**Location:** `config.js:54`, `src/server.js:190`, `src/server.js:238`, `src/server.js:314`, `README.md:499`
**Description:** `/api/cost-analysis` is a read-only, unauthenticated HTTP endpoint and the default host is `0.0.0.0`, which exposes it to reachable LAN and tailnet devices, not only the local browser. It returns configured subscription spend and local API-equivalent aggregates. It does not return raw prompts, responses, paths, session/account identifiers, API keys, invoices, or rate amounts, and it is not included in peer or menu payloads. There is no endpoint-specific rate limiter; requests only select and serialize a bounded immutable cache. This matches the existing dashboard deployment model, where Tailscale/LAN reachability is the access boundary, but the new aggregates may be more privacy-sensitive than quota percentages.

**Remediation:** Accepted for this local personal deployment. Users who need a narrower boundary should set `LLMDASH_HOST=127.0.0.1` for local-only access or bind to the machine's Tailscale IP for tailnet-only access; a future broader deployment should add authenticated HTTPS and request throttling before exposing this endpoint.

**Status:** Accepted

---

## Checks Performed

### Closest browser checklist — React + Vite

This repository uses vanilla browser JavaScript, not React or Vite. Every item in the closest checklist was still evaluated for its shared browser concern.

| Check | Result |
|---|---|
| No API keys, tokens, or secrets in browser/source files | Pass |
| Only intentionally public `VITE_` variables used client-side | Pass — not applicable; there is no Vite build or client environment injection |
| `VITE_` values are non-sensitive | Pass — not applicable |
| `.env` and `.env.local` are ignored | Pass |
| No credentials in committed build/config files | Pass |
| Browser API calls use the configured backend | Pass — the cost client calls only same-origin `/api/cost-analysis` |
| API base URLs are configured rather than leaking third-party calls | Pass — same-origin relative URL; no third-party cost request |
| API errors are handled without raw details | Pass — fixed fallback/status copy only |
| Authentication headers are appropriate and bearer tokens avoid storage | Finding — intentional no-auth local-network boundary; see accepted informational finding |
| Authentication tokens avoid local/session storage | Pass — not applicable; no tokens or browser storage |
| Logout clears authentication state | Pass — not applicable |
| Protected routes have server-side validation | Finding — endpoint is intentionally network-boundary protected rather than application-authenticated; see accepted informational finding |
| Token refresh handles expiry | Pass — not applicable |
| Dynamic HTML is sanitized/escaped | Pass — external strings are escaped; SVG attributes are fixed/numeric |
| External URLs are validated before `href`/`src` use | Pass — no dynamic external URL is rendered by this feature |
| State/navigation inputs are validated | Pass — range selection is restricted to `7d`, `30d`, and `90d` |
| No known vulnerable packages | Pass — zero runtime dependencies |
| React/Vite versions are supported | Pass — not applicable |
| Unused dependencies are absent | Pass |
| Production source maps are not exposed | Pass — no build step or generated source maps |
| Sensitive console logging is absent | Pass — only fixed refresh-failure text is logged |
| Development/debug code is absent from production output | Pass |

### Closest backend checklist — Vercel Edge Functions

This backend is Node's built-in `http` server, not Vercel Edge. Every item in the closest JavaScript request-handler checklist was evaluated for its shared server concern.

| Check | Result |
|---|---|
| Endpoints requiring authentication verify the caller | Finding — application auth is intentionally absent; see accepted informational finding |
| JWT verification uses a maintained implementation | Pass — not applicable; no JWTs |
| JWT secrets are environment-provided | Pass — not applicable |
| Unauthenticated protected requests receive 401 | Pass — not applicable under the accepted local-network access model |
| Secrets are stored outside source | Pass — feature has no secrets |
| Production/preview secrets are separated | Pass — not applicable to local LaunchAgent deployment |
| No credentials in Vercel configuration | Pass — not applicable; no Vercel config |
| Runtime secrets are not hardcoded | Pass |
| CORS behavior is explicit | Pass — CORS is intentionally omitted, preserving same-origin browser access |
| `Access-Control-Allow-Origin` is not permissive | Pass — no ACAO header is emitted |
| OPTIONS/preflight behavior is appropriate | Pass — OPTIONS is rejected by the global read-only method gate because cross-origin browser access is unsupported |
| CORS matches frontend needs | Pass — same-origin fetch only |
| Sensitive endpoints are rate-limited | Finding — accepted bounded local-network endpoint has no request limiter; see informational finding |
| Rate-limit responses use 429 and `Retry-After` | Finding — no request limiter is installed; see informational finding |
| Rate limits fit expected traffic | Finding — deployment relies on LAN/tailnet access control and bounded cached serialization |
| Request-body parsing handles malformed JSON | Pass — not applicable; all non-GET/HEAD methods are rejected before body parsing |
| Query parameters are validated and typed | Pass — unknown/prototype-like ranges normalize through an own-key fixed map |
| Upload type and size are validated | Pass — not applicable; no uploads or write endpoint |
| Secret values are not logged | Pass |
| Error responses do not expose environment names/values | Pass — fixed `error`/method text only |
| Global state does not retain secrets between requests | Pass — immutable global cache contains bounded aggregates only |
| Security headers are set | Pass — `nosniff`, `no-referrer`, and restrictive CSP including `frame-ancestors 'none'`; CSP supplies the frame-denial control |
| Response content types are explicit | Pass — cost JSON uses `application/json; charset=utf-8` |
| Dependencies are runtime-compatible | Pass — built-in Node APIs on declared Node 24+ runtime |
| No known vulnerable backend dependencies | Pass — zero runtime dependencies |

### Generic OWASP Top 10 fallback

| Check | Result |
|---|---|
| A01 Broken Access Control | Finding — accepted LAN/tailnet perimeter; no HTTP mutation, peer propagation, or menu exposure |
| A02 Cryptographic Failures | Finding — endpoint uses existing plain HTTP; Tailscale encrypts tailnet transport, while LAN privacy depends on the local network |
| A03 Injection | Pass — closed JSON schemas, no SQL/shell/template execution, escaped browser output, numeric SVG geometry |
| A04 Insecure Design | Pass — background bounded scan, atomic immutable cache, cold/stale failure states, and separate evidence status |
| A05 Security Misconfiguration | Finding — default all-interface binding is explicitly documented and accepted; security headers and `no-store` are present |
| A06 Vulnerable and Outdated Components | Pass — zero runtime dependencies and Node 24+ engine declaration |
| A07 Identification and Authentication Failures | Finding — intentional no-auth personal deployment; see accepted informational finding |
| A08 Software and Data Integrity Failures | Pass — tracked rate card, exact schemas, overlap rejection, no-follow descriptor reads, and last-good atomic replacement |
| A09 Security Logging and Monitoring Failures | Pass — failures are category-only; raw paths/content/errors never enter responses or UI |
| A10 Server-Side Request Forgery | Pass — cost analysis performs no outbound request and accepts no URL/host input |

### Generic data-access and local-file trust-boundary fallback

| Check | Result |
|---|---|
| Queries are parameterized/no SQL injection | Pass — feature adds no database query, table, or migration |
| Connection secrets are not client-exposed | Pass — feature uses no database/provider credentials |
| Authorization is server-enforced | Finding — intentionally delegated to the local-network perimeter; see accepted informational finding |
| Row-level access is scoped to the caller | Pass — not applicable; no new persisted or multi-user records |
| Request input cannot select filesystem paths | Pass — all roots/files come from server configuration |
| Root and candidate symlinks are rejected | Pass |
| Final-file replacement is rejected by descriptor identity | Pass — resolved during audit |
| Actual bytes are bounded before allocation/publication | Pass — resolved during audit |
| Directory/file/line/record/time budgets degrade honestly | Pass — resolved during audit; exhausted denominators never produce percentages |
| JSON/JSONL schema depth, count, numeric, date, and text bounds are closed | Pass |
| Prototype-like values remain inert | Pass — own-key maps and exact-key validation |
| Malformed Unicode and bidi/format separators remain inert | Pass — malformed UTF-16, controls, `Cf`, `Zl`, and `Zp` rejected for display provenance |
| Raw prompts, responses, paths, parser text, and IDs are excluded | Pass |
| BigInt cannot escape into JSON and serialized amounts are safe integers/null | Pass |

### Feature-specific endpoint, cache, privacy, and compatibility checks

| Check | Result |
|---|---|
| Cost route accepts only GET/HEAD under the global method gate | Pass |
| Cost route is a pure cache selection/serialization path | Pass |
| Cost responses are `no-store` and carry baseline security headers | Pass |
| Response size is bounded to three scopes and at most 90 daily/cumulative rows each | Pass |
| Range keys use own-key validation, including `constructor` fallback | Pass |
| Refresh publishes all ranges atomically and freezes nested values | Pass |
| Refresh failure retains the last-good generation instant and fixed stale reason | Pass |
| Browser discards stale range responses | Pass |
| Browser external values are escaped before HTML/SVG insertion | Pass |
| No billing API, invoice, API key, runtime price scrape, or provider network call exists | Pass |
| Cost data is absent from `/api/state`, `/api/hosts`, peer polling, SwiftBar badge, and dropdown | Pass |
| Existing account-limit and Codex-insight contracts remain compatible | Pass — full shared regression suite passed |

---

## Verification Evidence

- Security-focused feature/shared-scanner run: **82 passed, 0 failed, 0 skipped**.
- Full repository run after remediation: **616 total, 614 passed, 0 failed, 2 pre-existing environment-conditional skips**.
- `git diff --check`: clean.
- Static inspection found no cost-analysis outbound HTTP, subprocess, billing/API-key path, raw-content serialization, or peer/menu propagation.
- Adversarial regressions cover descriptor inode swaps, file growth, static/final/candidate symlinks, streamed directory exhaustion, parser-local record exhaustion, Codex time exhaustion, inherited diagnostic names, and hostile provenance Unicode.

## Convention Flags

- Keep all new local JSON/JSONL readers on the descriptor-verified bounded-file path; enforce directory and accepted-record budgets before allocation or cache insertion.
- Treat `LLMDASH_HOST=0.0.0.0` as LAN plus tailnet exposure, not tailnet-only exposure, when adding privacy-sensitive aggregates.
- Keep external display maps own-key-only and reject Unicode control/format/line-separator characters before rendering provenance or labels.
