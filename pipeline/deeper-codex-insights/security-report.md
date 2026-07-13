# Security Review — Deeper Codex Insights

**Date:** 2026-07-12
**Feature:** deeper-codex-insights
**Stack:** Frontend `vanilla (HTML/CSS/JS, no framework, no build step)`; backend `node http (minimal, few dependencies)`; existing SQLite unchanged
**Checklist:** `reference/checklists/security-react-vite.md` (closest browser checklist), `reference/checklists/security-fastapi.md` (closest HTTP API checklist), generic data-access fallback, and OWASP Top 10
**Outcome:** PASSED WITH NOTES

---

## Summary

The local rollout parser, cached aggregate endpoint, live account-fact observer,
and browser renderer were reviewed end to end. The audit found seven concrete
hardening issues, including two medium-severity availability risks; all were
resolved and independently rechecked. No Critical, High, or open security
finding remains, and the endpoint still returns bounded aggregates without raw
session identifiers, paths, prompts, responses, commands, or tool payloads.

The project has no dedicated checklist for its vanilla frontend or Node `http`
backend. The React/Vite and FastAPI checklists were therefore applied to their
shared browser/API concerns, with framework-only items marked not applicable,
then supplemented by a generic data-access pass and all OWASP Top 10 categories.

---

## Findings

### Malformed request target could terminate the server

**Severity:** Medium
**Location:** `src/server.js:180`
**Description:** Node can accept malformed absolute-form request targets that
the WHATWG URL constructor rejects. The uncaught parser exception escaped the
request callback, so any client able to reach llmdash could terminate the
process with one raw request.
**Remediation:** Guard request-target parsing, return a generic 400 response,
and retain security headers on the rejection path.
**Status:** Resolved — `src/server.js:181-191` now catches parser failures. A
raw-socket regression sends the exact malformed target, receives HTTP 400, and
proves the server remains alive.

### Rollout scan and parsed cache had no finite resource budget

**Severity:** Medium
**Location:** `src/codex-events.js:9-20`, `src/codex-events.js:487-641`
**Description:** The new 30-day startup/poller scan recursively walked the
session tree, read whole files, processed events, and retained normalized
records without hard limits. A corrupted or runaway same-user rollout corpus
could exhaust memory or block the single Node process.
**Remediation:** Bound traversal depth, entries, files, per-file and changed
bytes, per-file and per-scan events, output records, cache files, and cache
records. Stream directory entries, avoid `split()` allocation, and commit cache
changes only after a complete successful scan.
**Status:** Resolved — fixed, content-free `CODEX_SCAN_BUDGET` failures now
preserve the last complete aggregate. Tests prove oversized files are rejected
before reading and a late budget failure cannot replace the prior cache.

### Sparse account facts could outlive an account change indefinitely

**Severity:** Low
**Location:** `src/codex-limits.js:18-31`, `src/codex-limits.js:48-123`
**Description:** Plan, credit status, balance, and reset-credit count were kept
in process with no age limit or account-change invalidation. A logout or account
switch followed by sparse responses could pair old credit facts with a new
account indefinitely.
**Remediation:** Timestamp each accepted fact, expire it after a bounded five
polls (minimum 5 minutes, maximum 30 minutes), and clear all credit facts when
an explicit plan change or unknown plan is observed.
**Status:** Resolved — indefinite retention is closed. A same-plan switch that
emits no identity signal can retain facts only until the bounded TTL; the
app-server rate-limit response exposes no account identifier, and adding a
second account-read path is outside the ratified data contract.

### Opaque credit balance allowed Unicode direction spoofing

**Severity:** Low
**Location:** `src/codex-limits.js:126-133`, `public/app.js:649-654`, `public/styles.css:463`
**Description:** HTML escaping prevented code execution, but Unicode bidi and
format controls could visually reorder the balance and neighboring account
facts.
**Remediation:** Remove control, format, and Unicode line-separator code points
at ingest and render boundaries, retain the 64-code-point bound, and isolate
each account-strip item for bidirectional layout.
**Status:** Resolved — tests cover U+202E, U+202C, and U+2028 through both
normalization layers.

### Out-of-range and noncanonical timestamps could poison trends

**Severity:** Low
**Location:** `src/codex-events.js:97-105`, `public/app.js:684-695`
**Description:** A finite numeric timestamp beyond JavaScript's Date range
survived parsing and later made `/api/trends` throw. The browser also accepted
permissive `Date.parse()` inputs such as `"0"` or noon timestamps as daily UTC
buckets.
**Remediation:** Reject numeric timestamps beyond the JavaScript Date ceiling;
require exact `YYYY-MM-DDT00:00:00.000Z` day strings and an ISO round trip in the
client.
**Status:** Resolved — malformed timestamps degrade to unavailable data rather
than a persistent 500 or misleading chart point.

### Family-prefixed model labels could carry arbitrary text

**Severity:** Low
**Location:** `src/codex-events.js:119-138`, `src/codex-stats.js:3-18`
**Description:** The original family-prefix expression accepted any bounded
suffix after `gpt-`, `codex-`, or `chatgpt-`. A hostile structured model field
could therefore smuggle an arbitrary project-like string into an otherwise
aggregate-only response.
**Remediation:** Share a grammar-based normalizer between scan and aggregation
layers. Preserve known model forms, coarsen unknown GPT suffixes to their
numeric family, and map other unknowns to `Other`.
**Status:** Resolved — regression coverage proves a family-prefixed private
sentinel does not cross the aggregate.

### Deleted rollout roots retained last-good activity

**Severity:** Low
**Location:** `src/codex-events.js:524-575`
**Description:** Once a root had been cached, an authoritative `ENOENT` was
treated like a transient permission failure. Deleted or revoked local logs
could therefore remain visible from memory until restart.
**Remediation:** Distinguish an absent root from transient access failure,
publish an empty scan for `ENOENT`, and prune cached entries on the broad
refresh while retaining last-good behavior for permission/read failures.
**Status:** Resolved — a dedicated deletion test proves the next broad refresh
clears activity.

---

## Trust Boundary and Residual Risk

llmdash deliberately remains a credential-free, GET/HEAD-only personal service
on its existing `0.0.0.0` bind. The deeper endpoint is therefore readable by any
client already able to reach the dashboard over the trusted LAN/tailnet. This is
the project's documented and ratified access boundary, not a new authorization
model; the feature adds no mutation route, peer fan-out, CORS grant, or outbound
request. It must not be exposed directly to the public internet, and operators
who do not trust their LAN should bind `LLMDASH_HOST` to loopback or the machine's
Tailscale address.

The account API does not provide a non-sensitive stable identity alongside the
rate-limit response. Same-plan account switches can therefore retain prior
credit facts for at most the configured internal TTL (5 minutes at the default
poll cadence, capped at 30 minutes), never indefinitely. A safety-budget failure
keeps the last complete in-memory aggregate rather than publishing partial data;
the poller reports the refresh failure locally.

Rollout files are same-user inputs and can grow between the pre-read size check
and `readFileSync`. The post-read byte check rejects that race atomically, but a
single temporary allocation can briefly exceed the configured per-file cap.
Likewise, `credits.balance` remains one deliberately opaque aggregate field: it
is sanitized, isolated for bidirectional layout, and bounded to 64 code points,
but is not reduced to an enum. Canonical daily buckets and known model labels
are produced by the backend; the browser intentionally validates their shape
rather than independently re-deriving the selected range or calendar-validating
a date-shaped model suffix. These are informational constraints, not open
release findings.

---

## Checks Performed

### Closest frontend checklist — React + Vite shared concerns

| Check | Result |
|---|---|
| No API keys, tokens, or secrets in source | Pass — no credential material added or returned |
| Only `VITE_` variables used client-side | Pass / N/A — no Vite or client environment injection |
| Client-prefixed variables are non-sensitive | Pass / N/A — none exist |
| `.env` and `.env.local` ignored | Pass — both are explicitly ignored |
| No credentials in build configuration | Pass — no bundler/build config exists |
| API calls use the configured backend | Pass — insights use a same-origin relative path only |
| API base URL is not a hardcoded third-party origin | Pass — `/api/codex-insights` is same-origin |
| API errors handled without raw details | Pass — one fixed section-level message is rendered |
| Authentication headers/tokens handled safely | Pass / N/A — no app authentication or browser token storage |
| Tokens absent from local/session storage | Pass / N/A — neither storage API is used |
| Logout clears browser auth state | Pass / N/A — no browser auth state exists |
| Protected routes have server enforcement | Pass / N/A — serve-only personal dashboard, no privileged mutation route |
| Token refresh handles expiry | Pass / N/A — Codex owns its authentication outside the browser |
| HTML rendering sanitizes external content | Pass — all external labels are bounded and escaped; fixed templates only |
| External URLs validated before `href`/`src` | Pass / N/A — insight data creates no URL attribute |
| Inputs affecting state/navigation validated | Pass — range values require an own-key allowlist hit |
| No known vulnerable frontend packages | Pass — zero runtime dependencies |
| React/Vite on supported versions | Pass / N/A — neither is used |
| Unused dependencies absent | Pass — package declares none |
| Production source maps disabled | Pass / N/A — no build output or source maps |
| Sensitive console logging removed | Pass — browser code logs no insight/account payload |
| Development-only tooling excluded | Pass — static first-party assets only |

### Closest backend checklist — FastAPI shared concerns

| Check | Result |
|---|---|
| Protected endpoints verify JWT/API key | Pass / N/A — existing network boundary, no privileged write endpoint |
| JWT validation uses a trusted library | Pass / N/A — no JWT handling |
| JWT secret loaded from environment | Pass / N/A — no JWT secret |
| Token expiry enforced | Pass / N/A — no app token |
| Endpoint role/permission checks applied | Pass / N/A — no role model or mutation surface |
| Stored API keys are hashed | Pass / N/A — no API-key storage |
| Database queries parameterized | Pass / N/A — feature performs no query or database write |
| Request input excluded from eval/exec/subprocess | Pass — no eval; request path launches no process; Codex spawn uses fixed argv without a shell |
| Request-derived file paths sanitized | Pass — no request value reaches a filesystem path |
| XML parser disables external entities | Pass / N/A — no XML input |
| Dependency versions pinned | Pass / N/A — no third-party runtime dependency |
| No known vulnerable backend packages | Pass — Node built-ins only |
| Unused dependencies absent | Pass |
| Development dependencies excluded from production | Pass / N/A — none declared |
| Request bodies schema-validated | Pass / N/A — non-GET/HEAD methods are rejected and no body is consumed |
| Query/path parameters typed and validated | Pass — `range` canonicalizes through an own-key allowlist |
| Upload content validated | Pass / N/A — no upload route |
| Request size bounded | Pass — no request body; Node bounds headers and the endpoint is a cache read |
| Unhandled exceptions return generic 500 | Pass — API handlers return `error`, never stack/detail |
| Validation errors avoid implementation detail | Pass — malformed request target returns fixed 400; unknown range normalizes |
| Database errors hidden from clients | Pass / N/A — no insight database access |
| Debug mode disabled | Pass — no debug response mode |
| Application secrets not hardcoded | Pass — none used |
| Database URL kept server-side | Pass / N/A — local SQLite path only, unchanged and never sent |
| No credentials in committed files | Pass |
| Local environment files ignored | Pass |
| Development/production secrets separated | Pass / N/A — no application secrets |
| CORS origins restricted | Pass — no `Access-Control-Allow-Origin`; same-origin browser reads only |
| Security headers set | Pass — CSP, `nosniff`, `no-referrer`, frame/base/object/form restrictions |
| HTTPS enforced where required | Pass under the ratified deployment model — Tailnet transport supplies encryption; app HTTP must remain trusted-network only |
| Authentication endpoints rate-limited | Pass / N/A — none exist |
| Compute/external-call endpoints rate-limited | Pass — insight endpoint is bounded cache serialization; scan/process/network work stays off request path |

### Generic data-access fallback

| Check | Result |
|---|---|
| SQL construction and injection | Pass / N/A — no query added; SQLite schema and writes unchanged |
| Connection secrets kept out of clients | Pass / N/A — no connection secret exists |
| Authorization enforced server-side for protected data | Pass under the existing trusted-network/read-only boundary |
| Row-level access scoped to caller | Pass / N/A — no multi-user row store or caller identity |
| Insight persistence semantics | Pass — no insight row enters `usage_snapshots`; aggregates remain in memory |

### OWASP Top 10

| Check | Result |
|---|---|
| A01 Broken Access Control | Pass under the documented LAN/tailnet boundary; no new mutation, peer merge, or ID-addressable resource |
| A02 Cryptographic Failures | Pass — no secret/credential enters the response; trusted tailnet supplies transport encryption |
| A03 Injection | Pass — raw JSON is explicitly reduced, strings are normalized/escaped, style/SVG values are finite numbers, subprocess uses fixed argv |
| A04 Insecure Design | Pass — aggregate-only schema, per-capability availability, cache-only HTTP, bounded parser, and local scope are explicit |
| A05 Security Misconfiguration | Pass — strict methods, no-store, no CORS wildcard, CSP, nosniff, no-referrer, frame/base/object/form restrictions |
| A06 Vulnerable and Outdated Components | Pass — zero runtime dependencies and no remote client assets |
| A07 Identification and Authentication Failures | Pass / N/A — no application identity flow; existing trusted-network boundary unchanged |
| A08 Software and Data Integrity Failures | Pass — no dynamic code, plugin load, remote package, or unsafe object merge from rollout data |
| A09 Security Logging and Monitoring Failures | Pass — failures are category-only and local; raw event content and paths are not logged by the insight path |
| A10 Server-Side Request Forgery | Pass — insight collection adds no fetch, URL target, peer fan-out, or request-controlled outbound operation |

---

## Verification Evidence

- Definitive regression after all audit fixes: **539 tests total, 537 passed,
  0 failed, 2 pre-existing environment-conditional skips**.
- Independent focused re-audits passed 48 backend/security tests and 63
  frontend/account tests with no release blocker.
- A fresh installed-data 30-day probe produced 13,558 usage rows, 411 explicit
  completions, 92 compactions, and 4,397 classified tool invocations before
  aggregation, with all six capabilities detected inside the configured safety
  budgets.
- Endpoint inspection found no forbidden content/identifier keys, raw session or
  turn IDs, path-shaped values, or Unicode controls; output remained bounded and
  `cache-control: no-store`.
- The raw malformed request-target reproduction returns HTTP 400 and retains the
  hardening headers.
- Weft design lint reports 0 findings; `git diff --check` is clean; `.env` and
  `.env.local` are ignored.

## Convention Flags

- Every local structured-log scanner must have finite traversal, byte, event,
  result, and cache budgets, and must commit a refreshed cache atomically only
  after a complete successful parse.
- Sparse account-side facts need their own evidence age and expiry; an explicit
  account/plan change must clear facts that could belong to the prior account.
- Display-bound external strings must remove Unicode format/direction controls
  as well as HTML metacharacters; adjacent account facts should use bidi
  isolation.
