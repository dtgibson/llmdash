# Security Review — dashboard-unreachable-in-browser

**Date:** 2026-06-22
**Feature:** dashboard-unreachable-in-browser (fix lane)
**Stack:** node `http` (zero runtime deps), vanilla web UI, served over Tailscale
**Checklist:** No stack-specific checklist matches a raw `node:http` server; reviewed against general web-app + Node hardening and this project's `CLAUDE.md` security conventions.
**Outcome:** PASSED

---

## Summary
The fix is documentation/observability only: a new local-interface read
(`src/net.js`), a startup-log banner change (`src/server.js`), README/installer
text, and a unit test. It adds no HTTP routes, no request-path code, no
user-input handling, no secrets, and no new dependencies. It introduces no new
attack surface or trust-boundary change; the banner change actually improves
honesty about the network-binding posture, which `CLAUDE.md` asks to surface. No
findings.

---

## Findings
No security issues found in this fix.

*Informational (not a finding):* the startup banner now prints the host's own
tailnet IPv4 to the local console/journal. That is the machine's own private
CGNAT-range address, written only to the operator's local log — not exposed over
HTTP and not shipped anywhere — so it is not a disclosure concern.

---

## Checks Performed

| Check | Result |
|---|---|
| New HTTP routes / handlers added | Pass — none; request path untouched |
| User input parsed or trusted | Pass — none added; `tailnetIPv4` reads only `os.networkInterfaces()` |
| Subprocess / command execution on the request path | Pass — interface read runs once at startup, off the request path |
| Shell injection in `install-macos.sh` | Pass — `tailscale ip -4` is a fixed command; `TS_IP` is only echoed, never eval'd; no untrusted interpolation |
| Secrets / credentials in source or logs | Pass — none touched |
| Sensitive-data disclosure via banner/log | Pass — only the host's own private tailnet IP, to the local log (informational) |
| Response security headers / CSP altered | Pass — unchanged (no response or HTML changes) |
| Network bind / exposure changed | Pass — bind behavior unchanged; banner now surfaces the bind posture honestly |
| New dependency / supply-chain surface | Pass — zero new deps; `node:os` builtin only |
| Existing security controls weakened or bypassed | Pass — none removed or altered |
