# PR — Statusline Auto-Refresh (Branch B): honest reading-age treatment

## Statusline reading freshness (Branch B)

### What this does

Makes the age of the Claude limit reading impossible to miss. The Stage 3
spike killed the auto-spawn mechanism (a prompt-free Claude Code session never
receives `rate_limits` in its statusline payload — see `spike-report.md`), so
per the approved plan this ships the Branch B subset: the reading-age cue, the
`stale-reading` diagnostic, the manual-refresh nudge, and honest
startup/README statements. Zero spawn machinery exists in this build.

The Claude block now shows the reading's age in the header
(`Max · updated 7m ago`) and flags it as it crosses the bands — a warn "aging"
pill past 5 minutes, a crit "stale" pill past 10 plus a crit-tinted note under
the gauges stating the live age and the remedy (open a Claude Code CLI
session). Gauges keep rendering the last capture — flagged, never blanked.
Codex is untouched.

### How to test

1. `npm test` — 71 tests, all passing (includes the new freshness,
   knob-parsing, copy-lock, and branch-B-guard suites).
2. For a live look, see "Seeing it locally" below.
3. Contract check: `curl -s localhost:8899/api/state` — the claude tool
   carries `freshness: {capturedAt, freshForMs: 300000, staleAfterMs: 600000}`
   always, and `limitsDiagnostic` is exactly one of `null` /
   `{reason: "stale-reading", capturedAt, ageMs}` /
   `{reason: "no-statusline-reading"}`. Codex's `freshness` is `null`.

### Notes for reviewer

- **One knob:** `LLMDASH_CLAUDE_MAX_AGE_MS` (default `300000` = 5m; non-finite
  or ≤ 0 falls back to the default). Stale is always derived as 2×. The
  dropped Branch A knobs (`LLMDASH_CLAUDE_AUTOREFRESH`,
  `LLMDASH_CLAUDE_REFRESH_TIMEOUT_MS`, `LLMDASH_CLAUDE_CMD`) do **not** exist
  anywhere — a test asserts that.
- **Honesty fix in the reader:** `readClaudeLimits()` used to default a
  missing `capturedAt` to `new Date()` on every read, making a malformed file
  eternally fresh. It now falls back to the file's mtime (and an unparseable
  `capturedAt` string gets the same treatment — a small extension of the
  specified fix, recorded as a decision).
- **Contract shift:** the diagnostic note now renders whenever
  `limitsDiagnostic` is non-null — including while `haveLimits` is true
  (stale). Previously non-null diagnostic implied empty gauges.
- **Bands are client-derived, live:** the client computes the band each 1s
  render tick from the *server-supplied* thresholds; nothing is hardcoded
  client-side (a test asserts the absence of the threshold constants in
  `public/app.js`). Verified in a real browser: the pill appears mid-tick as
  a reading crosses 5m, without a reload or refetch.
- **Rendered stat-set diff:** the full-data fresh-state Claude block and the
  entire Codex block render **byte-identical** before and after this change
  (captured in a real browser pre-change and diffed). The only rendered deltas
  in any state are the age pill and the stale note.
- **Known limitation (accepted):** the stale *note* appears/disappears on the
  60s fetch (the server decides the diagnostic), while the *pill* crosses
  bands live on the 1s tick — so the note can lag the pill by up to a minute.
  This is the approved contract (pill flags, note explains).
- **Pre-existing bug found, not fixed here (out of scope):** the empty
  headroom strip renders even when hidden (`.headroom { display: flex }`
  defeats the `hidden` attribute). Flagged as a separate task.
- **Security hardening (Auditor findings, both resolved):** (1) `capturedAt`
  is re-serialized to canonical ISO at ingest — V8's `Date.parse` accepts
  arbitrary parenthesized content, so the raw string (a latent stored-XSS
  vector via `/api/state` and the SQLite snapshots) never leaves
  `readClaudeLimits()`; the mtime fallback already emits canonical ISO.
  (2) `LLMDASH_CLAUDE_MAX_AGE_MS` now also clamps to a 7-day ceiling
  (`604800000`) so the derived 2× `staleAfterMs` can't overflow to
  `Infinity` (which JSON-serializes as `null` and would make the client flag
  every reading stale while the server never emits the stale note). Both
  behaviors are test-locked; the clamp is documented in the README knob row.

## Seeing it locally

1. Open a terminal in your project folder.

2. Start the dashboard on a spare port:
   `LLMDASH_PORT=8899 npm start`

3. Open your browser and go to: `http://localhost:8899`

4. What you see depends on how old your Claude reading is. To see each state
   on demand, point the app at a scratch data folder and fabricate a reading
   age (run each line, then refresh the browser):

   ```
   mkdir -p /tmp/llmdash-demo
   # a reading 15 minutes old (the "stale" state):
   node -e 'const fs=require("fs");fs.writeFileSync("/tmp/llmdash-demo/claude-ratelimits.json",JSON.stringify({rate_limits:{five_hour:{used_percentage:16,resets_at:new Date(Date.now()+72e5).toISOString()},seven_day:{used_percentage:3,resets_at:new Date(Date.now()+36e6).toISOString()}},capturedAt:new Date(Date.now()-9e5).toISOString()}))'
   LLMDASH_PORT=8899 LLMDASH_DATA_DIR=/tmp/llmdash-demo npm start
   ```

   Change `9e5` (15 minutes in milliseconds) to `42e4` (7 minutes) for the
   "aging" pill, or `12e4` (2 minutes) for the plain fresh state. Delete the
   file to see the "no reading yet" state.

5. What to look for:
   - Fresh (≤ 5m): `Max · updated 2m ago` in the Claude header — no pill,
     nothing else changed.
   - Aging (5–10m): a small amber `AGING` pill joins the age. Nothing else
     changes, and the word "stale" appears nowhere.
   - Stale (> 10m): a red `STALE` pill, plus a red-tinted note under the
     gauges: "Stale reading — updated … ago; the limits above may have moved
     since. Open a Claude Code CLI session to refresh the reading…". The
     gauges still show the last numbers.
   - No reading: header shows just `Max`; the gauges wait; the note ends with
     "Open a Claude Code CLI session to capture the first reading."
   - The startup log states the refresh reality and the
     `LLMDASH_CLAUDE_MAX_AGE_MS` knob with its default.
   - Leave the page open: the ages tick live, and a reading crosses bands
     before your eyes without a refresh.
