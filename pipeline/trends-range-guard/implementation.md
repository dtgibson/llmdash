# Implementation — trends-range-guard

`buildTrends` now checks `Object.hasOwn(RANGES, range)` before selecting a duration. Inherited names such as `constructor` and `__proto__` follow the existing `7d` fallback instead of producing an invalid timestamp and HTTP 500. The guard matches neighboring range normalizers.

The production change is one line in `src/trends.js`. No route, response, range duration, cache, snapshot, daily aggregation, warming state, UI, provider, or persistence contract changed.

## Verification

- Node v24.18.0: focused `node --test tests/trends.test.js tests/server.test.js` passed **32/32**, zero failures.
- Direct regression compares inherited names, omitted/empty input, `bogus`, and `7D` with the complete canonical `7d` payload before and after both daily caches publish. Supported ranges retain their identities.
- Real-socket smoke exercises **52 requests**: 13 inputs × GET/HEAD × cold/published. Every response is HTTP 200; HEAD is bodyless; JSON content type, `no-store`, `nosniff`, referrer policy, and CSP remain intact.
- Four seeded snapshot ages per tool/window retain **1 / 2 / 3 rows** for `24h` / `7d` / `30d`. Fallback inputs retain the seven-day two-row cutoff.
- Existing focused checks for scan-free requests, Claude range/daily parity, atomic publication, last-good preservation, bounded scanning, and Codex cached-record parity pass.
- `node --check` passed for the production file and both test files; `git diff --check` passed.

Tests run with inherited `LLMDASH_*` removed, temporary data/Claude/Codex roots, an empty `hosts.conf`, disabled auto-refresh, `/usr/bin/false` provider commands, and an ephemeral loopback listener. The server is imported without its main startup path, so no poller runs. Fixtures are removed after verification; the server test now owns and closes its temporary SQLite fixture.

The original `evaluation.json` and reproduction remain unchanged as pre-fix evidence. The full suite is reserved for the bundled flush. No git/state transition, production deployment, peer/device access, or user-log scan was performed.

## Review access

The bundle preview is `https://hephaestus-developer.giraffe-chuckwalla.ts.net:8982/`. The Guide will restart and verify the final bundle before handing over this preview; this stage does not claim that the current preview already runs the guard.

No new conventions or infrastructure were introduced. This fix has no separate UI design pass.
