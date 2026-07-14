# Security & Privacy Review — Dashboard Tool Grouping

**Date:** 2026-07-13
**Outcome:** PASSED — no Critical, High, Medium, or Low findings

## Scope and Method

Reviewed the changed dashboard, Codex limit parser, state assembly, tests, and
release artifacts for the configured vanilla HTML/CSS/JavaScript frontend and
Node `http` backend. Neither configured stack has a dedicated project security
checklist, so this audit used the generic OWASP Top 10 together with a generic
local data-access, browser-injection, privacy, and trust-boundary review.

This change does not add an endpoint, mutation path, dependency, database
schema, authentication mechanism, external destination, or subprocess command.
It reorganizes existing local state and tightens how current Codex windows are
identified and selected.

## Review Results

| Area | Result | Evidence |
|---|---|---|
| Authentication, authorization, and trust boundaries | Pass | Existing local/Tailscale access model is unchanged. No endpoint or privileged action was added. |
| Input and DOM injection | Pass | Provider, host, diagnostic, model, and reset text continue through the shared HTML-escaping helper before interpolation. No dynamic script or event-handler construction was introduced. |
| CSS/style injection | Pass | Dynamic meter widths are derived from finite, clamped numeric percentages. The existing CSP permits only the inline style needed for these numeric widths. |
| Browser security headers | Pass | Existing `default-src 'self'`, `script-src 'self'`, locked object/base/form/frame directives, `nosniff`, and no-referrer policy remain in place. |
| Subprocess execution | Pass | Codex continues to launch with a configured executable plus fixed `app-server` argument through `spawn` without a shell. This change adds no command construction. |
| Provider and rollout parsing | Pass | Window fields use own-property checks; percentages are normalized and bounded; explicit recognized duration controls identity; unknown explicit durations are not promoted into a current slot. |
| Historical data isolation | Pass | Independent database rows cannot repopulate current Codex gauges, including at cold start. A complete live response is authoritative for present windows, while history remains read-only trend evidence. |
| Database and query safety | Pass | No query, schema, migration, write path, or dynamic SQL changed. |
| SSRF and outbound access | Pass | No URL, remote fetch, redirect, proxy, or outbound destination was added or changed. |
| Sensitive data and privacy | Pass | The UI continues to expose only existing local usage metadata. No prompt, response content, credential, token, or new telemetry field is collected or rendered. |
| Error handling and diagnostics | Pass | Existing diagnostic content remains display-only and escaped. Missing Codex windows render an explicit unavailable state without fabricating a value. |
| Resource exhaustion and availability | Pass | Existing polling cadence, probe timeout, response caching, and fallback behavior are unchanged. The new rendering work is fixed-size per tool/window and does not create an unbounded collection. |
| Dependencies and supply chain | Pass | No dependency or lockfile changed; the production dependency tree remains empty. |
| Cross-surface compatibility | Pass | Menu-bar source and payload contracts are unchanged; its regression suite passes. |

## Verification

- Full test suite: 552 tests, 550 passed, 0 failed, 2 environment-dependent
  skips.
- Focused dashboard/client suite: 47 passed, 0 failed.
- Independent security-focused suite: 117 peer-normalization,
  state-contract, Codex-window, and menu-bar tests passed.
- Design lint: 3 public files scanned, 0 findings.
- Whitespace validation: `git diff --check` clean.
- Independent frontend review found no remaining security issue after the
  comparison-order and accessibility fixes.

## Findings

No security or privacy findings were identified in the changed surface.

The pre-existing Codex last-known-reading freshness policy is unchanged. It is
documented in QA as a product limitation, not introduced by this change and not
a security regression.

The credential-free HTTP service also continues to rely on loopback/Tailscale
network isolation. Binding it to all interfaces retains its pre-existing LAN
visibility assumption; this change does not alter that boundary.

## Security Conventions Confirmed

- Treat explicit provider window duration as identity evidence, and do not let
  historical per-window rows override a complete current response.
- Escape all provider, peer, model, and diagnostic strings before HTML
  interpolation; keep dynamic style values numeric, finite, and bounded.
