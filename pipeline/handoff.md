## What We Accomplished
The dashboard had become unreachable over Tailscale from other devices. We traced
it to the host's Tailscale tunnel being down (an operational issue, not a bug in
llmdash) — and by the time we picked it back up, the tunnel had recovered and
reachability was restored. To make a future tunnel-down day obvious instead of
looking like a wrong URL, we made the startup banner and docs honest: they now
print the real reachable tailnet URL (auto-detected, zero new dependencies) and
say to use http, not https.

## What Has Been Saved
- Code: `src/net.js` (new tailnet-IP detector), `src/server.js` (honest banner),
  `README.md`, `scripts/install-macos.sh`, `tests/net.test.js` (new) — 27 tests
  passing.
- Pipeline record: `pipeline/dashboard-unreachable-in-browser/bug-brief.md`,
  `qa-report.md`, `security-report.md`.
- Decision log: an entry in `DECISIONS.md`.
- Committed and pushed to `main` (`48e9266`, `b69b0e1`); the live service was
  restarted onto the new code.

## Where We Are
Fix complete and shipped. Pipeline idle.

## Resume Prompt

Run `/weft` to start the next thing.
