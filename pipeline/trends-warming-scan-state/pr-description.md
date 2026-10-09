## Trends warming and Codex scan state

### What this does
`trends-warming-scan-state` caches warming trend replies for two seconds, while
preserving the 60-second ready cache and immediately invalidating on publication,
scan outcome changes and reset. Failed Codex scans now show fixed log-read failure
copy in existing activity, insights and trends; last-good data/time survives retry
until recovery clears the error.

### How to test
Run the focused trends, Codex-insights and Codex-client tests with isolated roots
and no providers/peers: 40/40 passed. Run
`node pipeline/trends-warming-scan-state/verify.mjs` for the isolated real-scanner,
27-request HTTP/render smoke, then use the coordinator's verified bundle preview
to review the existing Trends ranges and Codex panels.

### Notes for reviewer
The Codex status object's identity invalidates all canonical range entries without
a poller hook, including same-timestamp publications. `scanState` is a fixed enum;
`activityGeneratedAt` preserves Codex trend observation time. Parser/ingestion,
bounded partial convergence, style/layout and peer/menu behavior stay intact.
Warming retries retain their existing cadence and stop scheduling for errors.
The full suite runs once at the bundle flush; the current preview awaits the
coordinator's final restart and verification.
