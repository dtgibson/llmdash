# Security Review — Usage Coverage Gaps

**Date:** 2026-08-27
**Feature:** `usage-coverage-gaps`
**Lane / stage:** Fix / The Auditor, remediation rerun
**Stack:** Node.js built-in `http`, vanilla browser JavaScript, local JSON/JSONL evidence, zero runtime dependencies
**Checklist:** No dedicated served checklist exists for this vanilla Node/http stack. Applied a generic OWASP Top 10, local-file/data-access, resource-exhaustion, output-minimization, and browser-rendering review, with focused adversarial checks for every trust boundary named in the bug brief.
**Security gate:** **PASS — no Critical or High finding**
**Disposition:** **PASSED** — 0 Critical, 0 High, 0 Medium, and 0 Low findings remain open. One accepted Informational finding documents the existing trusted LAN/tailnet boundary.

---

## Executive Summary

The remediation closes all four findings from the first audit. Streamed descriptor reads now stop at the opened snapshot plus one detection byte and continue to perform final descriptor validation. Oversized Claude rows can be exempted only when an anchored generated top-level user-row grammar is proved. Claude and Codex parsed caches, combined result records, and omission aggregation are bounded before unbounded retention or post-hoc loss can occur. Claude rows with zero cache writes no longer require irrelevant duration evidence.

The broader change closes the reported monitoring gaps without introducing a new HTTP route, mutation, secret, provider request, database migration, subprocess path, or runtime dependency. Reset-less Fable evidence retains its original capture time and expires at an explicit seven-day boundary. Codex rollouts are opened with no-follow descriptor checks, streamed under byte/line/time/record limits, normalized into content-free records, and published through last-good caches. Pricing remains exact-model and effective-dated. Public diagnostics remain bounded aggregate counts and are escaped before browser insertion.

Independent adversarial reproduction and the Tester rerun found no regression or new Critical, High, Medium, or Low issue. The only retained note is the pre-existing unauthenticated personal-dashboard perimeter: a party already able to access the LAN/tailnet listener can read the new aggregate omission counts. No raw evidence, identifier, path, filename, prompt, response, or payload crosses that boundary.

## Severity Summary

| Severity | Open | Resolved in remediation | Accepted |
|---|---:|---:|---:|
| Critical | 0 | 0 | 0 |
| High | 0 | 0 | 0 |
| Medium | 0 | 3 | 0 |
| Low | 0 | 1 | 0 |
| Informational | 0 | 0 | 1 |

---

## Accepted Finding

### F-05 — Precise omission aggregates share the existing unauthenticated network boundary

**Severity:** Informational
**Category:** Privacy / inherited access-control boundary
**Location:** `src/server.js:283-293`; `src/cost-analysis.js:224-350,469-538`; `public/app.js:2146-2171`
**Status:** Accepted existing deployment boundary; non-blocking

`/api/cost-analysis` remains a read-only unauthenticated endpoint on the application's configured LAN/tailnet listener. The new rows disclose only tool, bounded model label, closed reason category, record count, and token count. They do not disclose raw records or identifiers, and no omission data is added to `/api/state`, `/api/hosts`, peer polling, or menu contracts. Server rows are capped, browser notes are capped, fields are validated, and the assembled note is escaped before `innerHTML` insertion.

This is consistent with the project's accepted personal-dashboard perimeter. A future deployment outside a trusted local/tailnet boundary should add authenticated HTTPS and request throttling before exposing these aggregates.

---

## Remediation Verification

### F-01 — Growing streamed files could exceed byte and time ceilings before rejection

**Prior severity:** Medium
**Location:** `src/bounded-file.js:145-240`; consumed by `src/codex-events.js:818-865`
**Status:** **Resolved**

The descriptor loop computes a ceiling of the smaller hard/opened size plus one byte, bounds every `readSync` request to the remaining allowance, invokes the supplied deadline check on each read, and preserves final `fstat`, descriptor identity, and exact-size checks. Concurrent growth is rejected as `BOUNDED_FILE_CHANGED` before an append stream can be drained indefinitely.

Independent adversarial evidence for a one-byte snapshot:

- Exactly one descriptor read was requested, for exactly two bytes.
- Two `fstat` calls occurred, including the final validation.
- The result was `BOUNDED_FILE_CHANGED`.

The Tester also verified deadline injection during an oversized unterminated drain, last-good fallback, no-follow open, regular-file validation, and later convergence.

### F-02 — Claude oversized non-usage proof could match nested discriminator fields

**Prior severity:** Medium
**Location:** `src/usage-ledger.js:193-237,304-357`
**Status:** **Resolved**

The exception now parses a bounded prefix from the beginning and accepts only the known generated top-level property sequence with exact top-level `type: "user"` and `message.role: "user"`. Unanchored nested fragments cannot prove a row is non-usage.

Independent adversarial evidence used an oversized top-level assistant usage row containing nested user discriminators. The scan returned:

```json
{"records":0,"denominatorKnown":false,"reasons":["record_unsupported"]}
```

Genuine generated oversized user rows remain definite non-usage.

### F-03 — Record, parsed-cache, and omission aggregation could amplify heap use

**Prior severity:** Medium
**Location:** `src/usage-ledger.js:8-99`; `src/codex-events.js:42-49,740-865`; `src/cost-analysis.js:10-17,224-350,469-538`
**Status:** **Resolved**

The implementation now applies deterministic pre-insertion bounds to the Claude cache (10,000 files, 175,000 records, 96 MiB estimated), Codex cache (1,100,000 records), and combined usage result (1,250,000 records). Per-tool omission accumulation keeps at most 56 detail rows plus closed per-reason overflow rows. Combined aggregation fairly selects bounded details while reserving exact tool/reason overflow rows, so the 64-row output cap no longer discards counts.

Independent high-cardinality evidence used 100 distinct unknown models per tool with token counts 1 through 100:

| Scope | Output rows | Records reconciled | Tokens reconciled |
|---|---:|---:|---:|
| Claude | 57 | 100 | 5,050 |
| Codex | 57 | 100 | 5,050 |
| Combined | 50 | 200 | 10,100 |

The combined result contained 48 fair detail rows and two overflow rows. Each tool's overflow row reconciled exactly to 76 records and 4,750 tokens. Repeated runs produced the same sorted output; every row had exactly `tool`, `model`, `reason`, `records`, and `tokens`; every reason belonged to the closed eight-value set. Injected raw-content, private-path, and payload sentinels did not appear.

### F-04 — Zero cache-write records required irrelevant duration evidence

**Prior severity:** Low
**Location:** `src/usage-ledger.js:114-147`; `src/cost-analysis.js:289-307`
**Status:** **Resolved**

Normalization records an exact `0/0` cache-duration split when total cache writes are zero. The pricing path requires duration evidence only when `cacheWrite > 0`; positive writes without an exact split still produce `cache_write_ttl_unknown` and are never guessed.

Independent adversarial evidence for input 10, output 2, cache write 0, absent duration detail, and cache read 0 returned:

```json
{"status":"complete","amountMicros":30500000,"omissions":[]}
```

---

## Focused Trust-Boundary Checks

### Descriptor, path, symlink, and race handling

| Check | Result |
|---|---|
| Usage roots are resolved from server configuration, never request input. | Pass |
| Root symlinks are rejected; candidate entries are inspected with `lstat` and symlinks are skipped. | Pass |
| Production opens use `O_NOFOLLOW` where supported. | Pass |
| Opened descriptors must be regular files and match inspected device/inode/size/mtime evidence. | Pass |
| Streamed reads stop at the opened snapshot plus one detection byte and run the deadline callback per read. | Pass — F-01 closed |
| Final `fstat` rejects truncation, replacement, or growth before a new parse is cached. | Pass |
| A growing active file retains the last-good complete parse and converges on a later pass. | Pass |
| Unreadable roots, subtrees, or files produce named incomplete evidence rather than silent completeness. | Pass |

### Bounded parsing, memory, and denial of service

| Check | Result |
|---|---|
| Directory depth/count, entry/file count, per-file bytes, total changed bytes, line/event count, record count, and wall time have explicit ceilings. | Pass |
| Codex's 256 MiB file ceiling and 512 MiB changed-byte ceiling cover the observed rollout while retaining hard limits. | Pass |
| Oversized lines retain only a bounded 64 KiB prefix; marker provenance cannot be spoofed by parsed objects. | Pass |
| Claude cache, Codex cache, and combined result records are bounded before insertion/append. | Pass — F-03 closed |
| Omission detail is accumulated under fixed row/reason bounds and exact overflow counts reconcile at tool and combined scopes. | Pass — F-03 closed |
| Budget failures cannot replace a prior complete cached parse. | Pass |
| Scan failures and parser exceptions expose fixed categories rather than paths or raw content. | Pass |

### Record classification and content minimization

| Check | Result |
|---|---|
| Codex oversized-row classification is anchored to narrow allowlisted top-level header orders. | Pass |
| Claude oversized rows are considered definite non-usage only when the generated top-level user header is proved. | Pass — F-02 closed |
| Unfamiliar or usage-bearing oversized rows weaken the denominator with `record_unsupported`. | Pass |
| Parsed/cache objects retain normalized timestamps, counts, model/effort/category fields only. | Pass |
| Prompt, response, tool payload, request/session ID, raw event, path, and filename are absent from published diagnostics. | Pass |

### Model-limit evidence age and expiry

| Check | Result |
|---|---|
| Account-only writes preserve a model cap's original `captured_at`; evidence is not restamped. | Pass |
| Explicit-reset evidence expires exactly at its reset instant. | Pass |
| Reset-less Fable evidence remains active for strictly less than seven days and expires at the exact TTL boundary. | Pass |
| Reset-less evidence more than five minutes in the future is rejected as implausible clock skew. | Pass |
| Read and merge paths share the same seven-day TTL and five-minute skew constants. | Pass |
| Labels, slugs, percentages, reset instants, and capture instants are normalized/bounded before exposure. | Pass |
| Local writes remain temp-file plus rename; older top-level captures cannot replace newer evidence. | Pass |

### Effective-dated price card and pricing integrity

| Check | Result |
|---|---|
| Rate-card reads are size-bounded and use secure regular-file/parent-identity validation; target symlinks are rejected. | Pass |
| Top-level, source, rate, tier, and channel schemas are closed and depth/count bounded. | Pass |
| Rates use fixed-point `BigInt`; negative, malformed, oversized, missing, or extra channels are rejected. | Pass |
| Rate intervals use exact model IDs and half-open UTC bounds; overlaps are rejected. | Pass |
| Opus 5 begins 2026-07-24; GPT-5.6 alias is bounded to 2026-08-27 through 2026-11-22; no fallback is fabricated. | Pass |
| GPT-5.6 Sol preserves its prior interval; the reviewed promotion applies only in its bounded interval. | Pass |
| The 272,000-token tier boundary remains base-priced; the high tier begins above it. | Pass |
| Positive Claude cache writes require exact 5m/1h evidence; zero writes need no irrelevant split. | Pass — F-04 closed |
| Unknown or model-less usage stays in the known denominator but receives no fabricated rate. | Pass |
| No price scrape, billing-provider request, invoice read, credential, or secret was introduced. | Pass |

### Public output and browser rendering

| Check | Result |
|---|---|
| Omission rows expose exactly five aggregate fields with tool/reason allowlists and safe counts. | Pass |
| Tool scopes and the combined scope contain at most 64 rows and reconcile exact counts through overflow rows. | Pass |
| Browser evidence notes are capped at eight and all assembled text is escaped before `innerHTML`. | Pass |
| Unknown diagnostic codes degrade to fixed copy rather than raw input. | Pass |
| No dynamic URL, style, event-handler, or script sink was added. | Pass |
| Aggregate detail remains inside the existing trusted-network boundary. | Accepted Informational F-05 |

### Endpoint, peer, mutation, secret, and dependency separation

| Check | Result |
|---|---|
| No new route or request parameter was added; the server diff only passes `nowMs` into `readClaudeLimits`. | Pass |
| Global method handling limits the cost endpoint to GET/HEAD; no new mutation is remotely callable. | Pass |
| `/api/cost-analysis` remains an immutable-cache read with `no-store`; no scan, write, subprocess, price lookup, or peer request runs on the request path. | Pass |
| Cost/omission data is absent from `/api/state`, `/api/hosts`, remote peer normalization, host cache, menu bar, and dropdown contracts. | Pass |
| The offline peer remains a separate `peer-unreachable`/`timeout` operational diagnostic and does not alter local usage denominators. | Pass |
| No environment file, credential, token, package manifest, lockfile, runtime dependency, database migration, or CI/deployment state changed. | Pass |
| No SQL, shell command, subprocess argument, URL fetch, unsafe deserialization, or prototype mutation was introduced. | Pass |

---

## Generic OWASP Review

| Area | Result |
|---|---|
| A01 Broken Access Control | No new endpoint or mutation. Accepted inherited personal-dashboard perimeter only (F-05). |
| A02 Cryptographic Failures | No credential or cryptographic material added; local HTTP/Tailscale boundary unchanged. |
| A03 Injection | Pass: no SQL/shell/template execution; closed schemas, bounded text, own-key reason lookup, and HTML escaping remain in place. |
| A04 Insecure Design | Pass: prior resource and coverage edge cases F-01 through F-04 are closed; last-good and honest-unavailable semantics remain. |
| A05 Security Misconfiguration | No listener, CORS, or header change. Existing CSP, `nosniff`, no-referrer, same-origin browser access, and trusted-network model remain. |
| A06 Vulnerable and Outdated Components | Pass: no dependencies added; Node 24+ remains the declared runtime. |
| A07 Identification and Authentication Failures | Accepted inherited no-auth personal-dashboard boundary only (F-05). |
| A08 Software and Data Integrity Failures | Pass: exact effective dates, descriptor identity, and anchored oversized-row classification verified. |
| A09 Security Logging and Monitoring Failures | Pass: diagnostics are bounded categories/counts and exclude raw evidence. |
| A10 Server-Side Request Forgery | Pass: no new outbound request or host/URL input; peer polling remains pre-existing and separately bounded. |

---

## Verification Evidence

- Auditor remediation rerun, broader affected suite: **132 passed, 0 failed, 0 skipped**.
- Tester full suite: **813 total; 811 passed, 0 failed, 2 skipped, 0 cancelled, 0 todo**. The two skips are environment-dependent negative-path checks for an unresolved Node binary; this machine has a system-wide Node installation.
- `git diff --check`: clean.
- F-01 adversarial descriptor check: one two-byte request for a one-byte snapshot, two `fstat` calls, `BOUNDED_FILE_CHANGED`.
- F-02 adversarial oversized assistant row: 0 records, unknown denominator, `record_unsupported`.
- F-03 high-cardinality checks: Claude 57 rows / 100 records / 5,050 tokens; Codex 57 / 100 / 5,050; combined 50 / 200 / 10,100. Exact reconciliation, row shape, reason closure, deterministic order, repeat stability, and sentinel exclusion all passed.
- F-04 zero-write check: complete, 30,500,000 micros, no omissions.
- Fresh-process Codex analytics published 219 parsed files / 63,524 normalized records in 10.256 seconds; forced-GC memory was 13.4 MiB heap and 244.0 MiB RSS.
- Fresh production-style cost analysis converged on pass 21 after bounded partial results on passes 1–20. The 30-day combined view contained 204,006 recognized records / 36,293,385,630 tokens and 194,872 comparable records / 35,085,790,727 tokens.
- The current-corpus pricing gap reconciled exactly: Codex `gpt-5.6` before its reviewed interval accounted for 6,223 records / 787,914,623 tokens (`rate_missing`), and unknown Codex model context accounted for 2,911 records / 419,680,280 tokens (`unknown_model`). No rate was fabricated.
- Converged cache occupancy remained below configured limits: Claude 1,174 files / 127,651 records / 63,783,758 estimated bytes; Codex 1,047 files / 1,001,544 records. Forced-GC convergence memory was 170.2 MiB heap used, 315.3 MiB heap total, and 912.6 MiB RSS.

## Final Decision

**PASS.** F-01 through F-04 are resolved, no new Critical/High/Medium/Low issue was identified, and F-05 remains an accepted Informational statement of the existing trusted-network deployment boundary. The change is ready to proceed to the next Weft gate from a security perspective.
