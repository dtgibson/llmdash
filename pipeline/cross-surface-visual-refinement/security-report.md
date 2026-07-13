# Security Review — Cross-Surface Visual Refinement

**Date:** 2026-07-12  
**Feature:** `cross-surface-visual-refinement`  
**Frontend axis:** vanilla HTML/CSS/JavaScript dashboard plus the SwiftBar/xbar text renderer  
**Backend/data axis:** built-in `node:http` server and SQLite-backed usage data; no backend or database production file changed  
**Checklist:** No dedicated Weft security checklist exists for the configured `vanilla (HTML/CSS/JS, no framework, no build step)` frontend, `node http (minimal, few dependencies)` backend, or SwiftBar/xbar renderer. The required fallback was therefore used: a generic OWASP Top 10 review plus a data-access/privacy pass, augmented by the repository's `CLAUDE.md` trust-boundary conventions and the established menu-bar security checks.  
**Outcome:** **PASSED — no findings**

---

## Summary

The complete production diff in `public/index.html`, `public/styles.css`, `public/app.js`, and `scripts/menubar/llmdash.5s.js` was reviewed together with the unchanged HTTP, peer-normalization, trend, service-control, and host-action boundaries it consumes. The change is presentation-only and does not add an endpoint, fetch target, database operation, file write, subprocess target, dependency, secret, credential, telemetry path, or user-controlled command parameter.

The dashboard refactor preserves the DOM trust boundary: free-form tool, model, host, and diagnostic text remains escaped before an `innerHTML` sink; tool, series, and legend class names come only from closed literal mappings; and generated inline styles remain restricted to normalized numeric widths. Moving chart-series and legend colors to CSS classes reduces the inline-presentation surface. The existing CSP still constrains scripts to first-party `self`, retains its documented inline-style allowance for numeric widths, blocks framing and base-URI changes, and is applied with `nosniff`, `no-referrer`, and `no-store` responses.

The menu refactor also preserves its sharper boundary: all external display text still passes through `sanitize()`/`menuLine()`, which removes SwiftBar's `|`, CR, and LF control grammar. Inert reading rows retain only the fixed `/usr/bin/true` no-op, while executable rows remain explicitly constructed with the same fixed helper paths, closed verbs, sanitized host keys, and separate ARGV fields. The new action styling contributes fixed `size` and `color` parameters only; it does not turn display data into an action or alter any command. Service removal and complete uninstall remain separate submenu actions and retain their downstream confirmation, marker/path checks, data-preservation default, and safe-choice defaults.

No Critical, High, Medium, Low, or Informational security finding was identified. The feature is clear to proceed to deployment review.

---

## Findings

| Severity | Count | Status |
|---|---:|---|
| Critical | 0 | None |
| High | 0 | None |
| Medium | 0 | None |
| Low | 0 | None |
| Informational | 0 | None |

---

## Trust-Boundary and Feature Checks

| Check | Result | Evidence |
|---|---|---|
| Production scope | Pass | The production diff is limited to dashboard markup/styles/render presentation and the menu renderer. No `src/`, config, database, package, installer, or action-helper production file changed. |
| New attack surface | Pass | No HTTP route, method, fetch destination, storage shape, file write, subprocess, config knob, environment variable, dependency, or telemetry path was added. |
| Dashboard HTML escaping | Pass | The new `toolNameHtml()` escapes `tool.label`; existing model labels, host labels/addresses, plans, command details, and peer diagnostics remain escaped with `esc()` before reaching an `innerHTML` sink. Focused hostile-label/model tests pass. |
| Tool identity classes | Pass | `toolToneClass()` is a closed mapping that returns only `tool-claude`, `tool-codex`, or an empty string. No external `source` string is interpolated directly into a class or style attribute. |
| SVG series classes | Pass | The new `lineSVG()` class argument has only literal in-module call sites (`series-accent`, `series-teal`, `series-good`); peer/API text cannot reach it. Point coordinates and labels are produced by numeric/date formatters. |
| Legend classes | Pass | `legendHtml()` receives only fixed literal class suffixes and labels from its in-module call sites. The previous generated background style was removed. |
| Generated style values | Pass | Static HTML has no inline `style`. Generated `style` attributes are width-only meter/segment values. Local values are numeric at source and peer values are finite/clamped at ingest in `src/hosts.js`; no host, tool, model, diagnostic, or other string enters a style value. |
| CSS/external-resource surface | Pass | `public/styles.css` adds tokenized colors, layout, media queries, gradients, and transitions only. It adds no `@import`, remote font, `url()`, external image, executable CSS construct, or data-bearing selector. |
| CSP compatibility | Pass | `src/server.js` still applies `default-src 'self'`, `style-src 'self' 'unsafe-inline'`, `base-uri 'none'`, and `frame-ancestors 'none'`. Application-generated `style` attributes remain limited to numeric widths, and the change reduces chart/legend inline presentation. No inline script was added. |
| Static/API cache policy | Pass | Static assets and `/api/state`, `/api/hosts`, and `/api/trends` retain `cache-control: no-store`; client reads also use `{ cache: 'no-store' }`. No service worker or client persistence was introduced. |
| External tool/model labels in the menu | Pass | `pushToolLines()` and shared `windowRowLine()` end at `menuLine()`, so tool/model labels cannot inject `|`, CR, or LF into SwiftBar grammar. Rows are indented before model labels and carry only fixed font/size/color/no-op params. |
| Menu diagnostics | Pass | Diagnostics are still produced from own-key reason maps, free-form details are sanitized, wrapped lines are bounded, and each line is emitted through `menuLine()`. Moving diagnostics beneath their owning tool does not change their trust level. |
| SwiftBar line-grammar injection | Pass | `sanitize()` strips every parameter delimiter/newline from visible text. Hostile host-label and diagnostic tests confirm one legitimate `|` delimiter per rendered line and no injected action fields. |
| Display-row/action separation | Pass | Informational rows use `menuLine()` and the fixed `bash=/usr/bin/true terminal=false refresh=false` readability no-op. Actions use the separate `actionLine()`/`submenuActionLine()` path and never inherit that no-op. No data row gained `shell`, `href`, `paramN`, or `refresh=true`. |
| New action styling | Pass | `DROPDOWN_ACTION_STYLE` contains fixed `size=12` and `color=#4a4a4a` values. It precedes, but does not interpolate into or replace, the existing action parameter string. |
| Action call-site closure | Pass | Every `actionLine()` call was inspected. Parameters are either fixed `refresh=true`, a `baseUrl()` built from sanitized host/port, or fixed `$ABS_NODE` plus a tracked helper, closed verb, and sanitized host key. Free-form labels occur only in the sanitized text half. |
| URL/host construction | Pass | `baseUrl()` still passes both host and port through `sanitizeHostPort()`, which removes whitespace and `|` so a value cannot open a second SwiftBar parameter. The refactor adds no new URL or peer target. |
| Host-removal boundary | Pass | Remove actions continue to pass the sanitized `host:port` identity on `param3`, never a free-form label. The local host remains absent from the removable set, and the host-config helper remains unchanged. |
| Command/ARGV boundary | Pass | Service, host, uninstall, and display actions still invoke the absolute current Node binary with the tracked helper as `param1` and closed verbs/values in separate parameters. The unchanged helpers use ARGV-oriented `execFileSync`/`spawn`, not user-built `sh -c`, `eval`, or command interpolation. |
| Service-control safety | Pass | Only the visual prefix of the existing install/remove service rows changed. The live-state decision, helper target, `install`/`remove` verb, `terminal=false`, and `refresh=true` contracts are unchanged. |
| Uninstall safety | Pass | Badge-only removal and complete uninstall remain distinct nested actions. The unchanged complete-uninstall helper retains an enumerated confirmation with Cancel as the safe default, opt-in history deletion with Keep as the safe default, marker/path-gated cleanup, self-detached teardown, and data preservation by default. |
| Display actions | Pass | The existing Display submenu remains enum-driven and points to the same `display-action.mjs` helper. This refinement only de-emphasizes its parent label; it does not change values, host selection, or mutation behavior. |
| HTTP method/access boundary | Pass | The server remains read-only over HTTP and rejects non-GET/HEAD methods with 405. The visual change does not create an authorization-sensitive mutation surface or broaden the documented tailnet deployment boundary. |
| SSRF/outbound reads | Pass | No fetch code changed or was added. Peer reads remain limited to explicitly configured hosts, fixed `GET /api/state`, no redirect following, bounded timeout/body, and no credentials; the badge still reads its local instance. |
| Data normalization | Pass | Peer percentages, timestamps, projections, activity aggregates, and model limits continue to be coerced/normalized in `src/hosts.js` before rendering. The shared menu formatter consumes the same normalized rows and does not re-open a raw payload path. |
| SQLite/data access | Pass | No SQL, query parameter, schema, retention, snapshot, or persistence path changed. The dashboard and menu remain read-only consumers of the existing state/trend contracts. |
| Privacy/data minimization | Pass | No additional Codex insight, raw prompt/session content, user identifier, path, token, credential, or usage field is exposed. The same local usage summaries are rearranged visually; no analytics or third-party transmission was added. |
| Secrets/credentials | Pass | Diff scan found no key, secret, password, authorization header, cookie, or credential addition. Peer requests remain credential-free. |
| Dependency/supply-chain risk | Pass | `package.json` still contains no runtime or development dependencies, and no lockfile or remote asset was added. There is no new component to audit for a published CVE. |
| Error/failure behavior | Pass | Offline, stale, aging, no-reading, and malformed-reset paths remain text-first and do not create executable output. Refactoring preserves generic fallbacks for unmapped diagnostic codes and never renders a fabricated reading. |
| Denial-of-service regression | Pass | The change adds only bounded formatting/layout work over existing tool/model/host arrays. It adds no request-path I/O, polling, recursion, unbounded network body, expensive selector, or animation loop. Reduced-motion behavior is explicit. |

---

## Generic OWASP Top 10 and Data-Access Fallback Coverage

| Area | Result | Review conclusion |
|---|---|---|
| A01 Broken Access Control | Pass | No new protected or mutating resource; GET/HEAD-only HTTP behavior and the existing tailnet scope are unchanged. |
| A02 Cryptographic Failures | Pass / not expanded | No cryptographic, credential, session, cookie, or secret-handling path exists in this presentation change. No sensitive field is newly exposed. |
| A03 Injection | Pass | DOM escaping, closed class/style mappings, SwiftBar grammar sanitization, fixed action parameters, sanitized host keys, and ARGV process boundaries were traced end to end. |
| A04 Insecure Design | Pass | Presentation data and executable actions remain separate; destructive operations remain enumerated, nested, confirmed, and safe-defaulted. |
| A05 Security Misconfiguration | Pass | CSP, `nosniff`, `no-referrer`, frame/base restrictions, MIME types, method lock, and `no-store` remain active. No external resource or relaxed directive was added. |
| A06 Vulnerable and Outdated Components | Pass / not applicable | The project has zero npm dependencies and the change adds none. |
| A07 Identification and Authentication Failures | Pass / not expanded | No identity, login, session, or privilege flow changed; no new remote mutation relies on authentication. |
| A08 Software and Data Integrity Failures | Pass | No fetched code, third-party script/style/font, package, update channel, or deserialization-to-execution path was added. JSON remains data only. |
| A09 Security Logging and Monitoring Failures | Pass / not expanded | No logging, error disclosure, or telemetry behavior changed. The feature emits no new sensitive value to logs. |
| A10 Server-Side Request Forgery | Pass | No new server-side request construction. Existing peer targets remain operator-configured, sanitized, fixed-path, redirect-denying, bounded, and credential-free. |
| Data-access / SQL injection | Pass | No database file or query changed; no new input reaches SQLite. API responses remain read-only and non-cacheable. |
| Data retention / privacy | Pass | Storage, retention, and uninstall history-preservation semantics are unchanged; no new data is collected, persisted, or transmitted. |

---

## Verification Evidence

- Security-focused renderer run: **86 tests passed, 0 failed, 0 skipped**, covering DOM escaping, generated-style constraints, SwiftBar sanitization, hostile host values, command/action contracts, service/uninstall rows, single/multi-host paths, diagnostics, and malformed states.
- Stage 4 full configured suite: **488 tests total, 486 passed, 0 failed, 2 environment-dependent skips**.
- `git diff --check`: passed.
- Dependency inspection: zero `dependencies`, zero `devDependencies`, and no lockfile.
- Diff secret scan: no credential or private-key pattern found.

## Convention Flags

None. The change relies on existing repository conventions—escape at DOM render, sanitize at SwiftBar render, normalize external numbers at ingest, keep display and action rows separate, and use fixed helpers plus ARGV for local mutations—and introduces no new security convention.
