# Bug Brief — trends-range-guard

## What is broken
`GET /api/trends?range=constructor` returns HTTP 500 with plain `error` instead of the existing unknown-range fallback.
`buildTrends` accepts inherited keys through `RANGES[range]`; subtracting the inherited value creates an invalid timestamp and throws `RangeError: Invalid time value`.
The same failure affects `toString`, `__proto__`, `hasOwnProperty`, `__defineGetter__`, and `valueOf`, before and after caches publish.

## Steps to reproduce
1. On the development Mac, run `node pipeline/trends-range-guard/reproduce.mjs` from this checkout.
2. The script clears inherited `LLMDASH_*`, uses temporary data/log trees and empty `hosts.conf`, disables auto-refresh, sets both CLI commands to `/usr/bin/false`, and listens only on ephemeral loopback without a poller.
3. Inspect `evaluation.json`: inherited range names yield 500; omitted, empty, ordinary unknown, and supported names yield 200; direct inherited-name calls throw.

## Expected behavior
Validate range membership using own keys; inherited names follow the existing unknown-range fallback to canonical `7d` with HTTP 200 JSON.
Preserve explicit `24h`, `7d`, and `30d`, plus omitted/empty/ordinary-unknown behavior, GET/HEAD handling, and existing response headers and shape.

## Blast radius
Scoped to range validation in `src/trends.js`, exercised through `/api/trends`; add focused regressions in `tests/trends.test.js` and `tests/server.test.js`.
Both tools share this selector; keep their range cutoffs, snapshots, daily aggregates, cache behavior, and warming states unchanged.
No new error contract, UI, peer, persistence, provider probing, or warming-response/Codex error-state work belongs in this fix.

## What done looks like
Inherited-key and ordinary-unknown direct calls normalize to `7d`; GET returns 200 canonical JSON and HEAD returns 200 without a body in cold and published states.
Regression checks retain distinct `24h`/`7d`/`30d` snapshot cutoffs and all current defaults, with no request-path scan; focused checks pass and the whole suite remains reserved for the bundled flush.
