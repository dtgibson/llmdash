## Codex Usage

### What this does
Adds Codex (ChatGPT Plus) to the dashboard at parity with Claude Code: its 5-hour
and weekly limit gauges (with reset countdowns and a burn projection) and its
activity stats, shown in a per-tool block beside Claude. A new "headroom strip"
fires when one tool runs low and points to the tool with the most room left — the
feature's reason for being. The backend is refactored to be source-aware; the
schema is unchanged (Codex is a new `source` value).

### How to test
1. `npm test` — 12 tests (adds Codex stats parsing, OpenAI pricing, headroom logic).
2. Restart the service (or `npm start`) and open the dashboard. Claude renders as
   before; Codex appears as a second tool.
3. Confirm Codex limits populate after the poller's first successful app-server
   read (see "Notes" — needs a real shell where `codex` runs).

### Notes for reviewer
- **Footprint:** the Codex app-server is queried by the poller on an interval,
  NOT per request, so `/api/state` stays cheap (NFR-03).
- **Graceful degradation:** if the app-server can't run or Codex has no logs, the
  Codex block shows "waiting"/empty and Claude is unaffected (FR-04, FR-12, FR-14,
  verified).
- **Environment limitation:** `codex app-server` could not be exercised in the
  build sandbox (it needs bubblewrap user namespaces the sandbox blocks), and
  there were no Codex session logs to test activity against. The code is written
  to Codex's documented protocol and degrades safely; the *live* Codex read and
  the activity-log parsing need a one-time confirmation in a real shell where
  `codex` runs. Everything else (two-tool layout, gauges, projection, headroom,
  Claude unaffected) is verified.
- **Pricing:** Codex estimated value uses a separate OpenAI rate table in
  `config.js`.
- No credentials are read or transmitted by the dashboard; the codex binary holds
  its own auth.
