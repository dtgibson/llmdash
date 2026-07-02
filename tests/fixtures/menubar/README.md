# menu-bar-badge test fixtures

`/api/state`-shaped payloads for the menu-bar badge plugin's pure-function
tests (`tests/menubar.test.js`). Seeded from the Stage-3 spike's scratchpad
fixtures.

Freshness bands and reset countdowns are **relative to now**, so the fixtures
can't hardcode absolute ISO timestamps (they'd age and make band assertions
non-deterministic). Instead, any string of the form `"@<ms>"` in a `capturedAt`
or `resetsAt` field is a placeholder the loader (`loadFixture` in the test file)
rehydrates to `new Date(Date.now() + <ms>).toISOString()` at load time:

- `"@-60000"`  → captured/resets 1 minute in the PAST
- `"@7200000"` → resets 2 hours in the FUTURE

So `state-aging.json` sets `capturedAt: "@-420000"` (7 minutes ago) — with the
server's `freshForMs: 300000` / `staleAfterMs: 600000`, that is always the
`aging` band whenever the test runs.

Non-timestamp fields (`usedPct`, `remainingPct`, thresholds) are literal.
`remainingPct` is pre-clamped 0–100 (as the server emits it); the plugin reads
it, never recomputes it.

The `harness-*` fixtures are raw response bodies (not state objects) for the
degradation tests: a non-200 body and a malformed-JSON body.
