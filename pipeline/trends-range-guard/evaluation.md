# Evaluation — trends-range-guard

Confirmed on Node v24.18.0 using `node pipeline/trends-range-guard/reproduce.mjs`.
The final run exited 0: 40 observations, 14 HTTP 500 responses, 16 HTTP 200 responses, and six direct-call exceptions.
Full observations are in `evaluation.json`; `reproduce.mjs` retains the isolated procedure for the Engineer and Tester.

| Input | Current GET, cold and published | Intended preserved contract |
| --- | --- | --- |
| `24h`, `7d`, `30d` | 200 JSON with the requested range | Same range, headers, payload and cutoffs |
| omitted, empty, `bogus`, `7D` | 200 JSON with `range: "7d"` | Same fallback |
| `constructor`, `toString`, `__proto__`, `hasOwnProperty`, `__defineGetter__`, `valueOf` | 500, plain `error` | 200 JSON with `range: "7d"` |

`HEAD` with `constructor` returns 500 and no body; `HEAD` with `30d` returns 200 and no body.
Direct `buildTrends` calls with `constructor`, `toString`, and `__proto__` throw `RangeError: Invalid time value`; `bogus` and an omitted argument return canonical `7d`.
Valid responses retain JSON content type, `no-store`, and `nosniff`; the failing route keeps baseline `nosniff` but bypasses its success headers.

## Cause and scope

`src/trends.js` declares a normal object for `RANGES`, then uses `if (!RANGES[range])` as its membership check in `buildTrends`.
An inherited object/function passes the truthiness check, makes `nowMs - RANGES[range]` non-finite, and fails at `new Date(since).toISOString()`.
`src/server.js` catches that exception and sends 500 `error`; this is a request failure, not a process crash.
The fix should replace this membership check with an own-key check, consistent with neighboring range normalizers in `src/codex-stats.js` and `src/cost-analysis.js`.
Preserve the existing fallback to `7d`; adding an HTTP 400 response would change the current contract and is outside the seed's preservation requirement.

The reproduction seeded four distinct snapshot ages in each tool/window and confirmed 1/2/3 retained rows for `24h`/`7d`/`30d`.
It repeated the matrix with both daily caches initially warming and after publishing empty local data.
For regression coverage, pin both direct normalization and real-socket GET/HEAD results; retain the supported-range/default controls.
No warming-response presentation or Codex error-state changes are needed here.

## Isolation and limits

The script clears every inherited `LLMDASH_*` variable before dynamic imports, creates disposable data/Claude/Codex trees, writes an empty host list, disables Claude auto-refresh, and sets Claude/Codex commands to `/usr/bin/false`.
It imports the actual server without invoking its main startup block, starts no poller, binds `127.0.0.1` on port 0, and makes only local HTTP requests.
It closes its listener and SQLite handle and removes its temporary tree on completion.
No live peers, production checkout/service, physical devices, user logs, or user data were accessed.
No source edits, git/state mutations, full test suite, or development preview were required for this evaluation.
