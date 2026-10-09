## trends-range-guard

### What this does
Trends range validation now accepts only the range table's own keys. Inherited names such as `constructor` and `__proto__` return the existing canonical seven-day JSON response instead of HTTP 500; `24h`, `7d`, `30d`, and other fallback behavior remain unchanged.

### How to test
Run the isolated focused checks for `tests/trends.test.js` and `tests/server.test.js`. They cover direct normalization, cold/published caches, GET/HEAD, response headers, and both tools' snapshot cutoffs; all 32 tests passed on Node v24.18.0. Syntax and diff checks also passed.

### Notes for reviewer
The production diff is one own-key membership guard. Server regressions use temporary data/log fixtures and start no poller. Full-suite execution and final tailnet preview verification belong to the bundled flush; pre-fix evaluation evidence is preserved.
