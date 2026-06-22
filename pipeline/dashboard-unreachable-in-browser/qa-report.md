# QA Report — dashboard-unreachable-in-browser

**Date:** 2026-06-22
**Test Runner:** node:test
**Result:** PASSED

## Test Suite Results
27 tests passing, 0 failing — including the 5 new `tailnetIPv4` detector tests
(with inclusive CGNAT boundary assertions). No regressions in the existing
server, stats, codex, db, trends, or headroom suites.

## Bug Reproduction (from bug-brief.md)
The original failure: the host's Tailscale IP timed out (~4s, code=000) while
loopback and LAN served 200. Re-ran the reproduction against the live service
on `:8787`:

| Probe | At diagnosis | Now | Result |
|---|---|---|---|
| `curl http://127.0.0.1:8787/` | 200 | 200 in 3.4ms | ✓ |
| `curl http://10.211.55.5:8787/` (LAN) | 200 | 200 in 0.8ms | ✓ |
| `curl http://100.82.9.81:8787/` (tailnet) | timeout, code=000 | 200 in 1.0ms | ✓ Fixed |

`tailscale0` is UP; `llmdash.service` is active. The user separately confirmed
the dashboard loads in a browser from the peer (hephaestus).

## Acceptance Criteria Verification

| Criterion | Result | Notes |
|---|---|---|
| Dashboard reachable on the tailnet IP | ✓ Pass | 200 in ~1ms (was a 4s timeout) |
| Banner prints a real reachable URL, not a placeholder | ✓ Pass | `http://100.82.9.81:<port>` |
| Banner states http-not-https | ✓ Pass | "(use http, not https)" appended |
| Banner honest across bind modes | ✓ Pass | `0.0.0.0` + tailnet-IP bind print the URL; loopback-only stays silent |
| README + installer placeholders fixed | ✓ Pass | Both `<…tailscale-name>` spots replaced; installer derives the real IP |
| No new dependencies | ✓ Pass | `src/net.js` uses `node:os` only |

## Edge Cases Tested
- Detector at the inclusive CGNAT edges (100.64.0.0, 100.127.255.255) and just
  outside (100.63.x, 100.128.x, 100.0.x).
- IPv6 and loopback skipped; numeric vs string `family` both handled.
- Banner across three binds: `0.0.0.0` (prints URL), `127.0.0.1` (silent —
  honest), `100.82.9.81` (prints URL).
- Tunnel-down path: detector returns null → banner falls back to the generic
  hint, no fabricated URL.

## Known Limitations
- The underlying outage was operational (`tailscale0` went DOWN); whether it
  recurs after a reboot is unresolved and outside this repo change. Tracked as a
  follow-up.
- The live `:8787` service still runs the pre-fix binary; the new banner appears
  on its next restart. HTTP/serving behavior is unchanged, so reachability is
  unaffected.
