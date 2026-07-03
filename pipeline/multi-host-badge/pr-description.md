## Multi-Host Badge

### What this does
The macOS menu-bar badge grows from watching one machine to watching several, and
becomes reconfigurable live from its own dropdown — no plist edit, no restart. The
badge switches its single loopback read from `/api/state` to the shipped combined
`/api/hosts` on its local instance (which already fans out to the peers), so its
glyph reads the most-constrained window across **all** monitored machines and names
which machine binds (`▪ Desktop·C 12%`), with one honest section per host in the
dropdown. The watched-host list is now a runtime-mutable local file (`hosts.conf`
under the data dir) that the interval poller re-reads each tick; the badge edits
that file **locally** via a native `osascript` dialog → sanitize → atomic write —
never over HTTP, so the dashboard's serve-only/405 posture is preserved. A machine
that does no Claude/Codex work of its own (a monitoring station) has its empty local
reading de-emphasized but never faked. When only one machine is watched, the badge
is byte-for-byte the shipped single-host badge.

### How to test
Automated: `npm test` — 333 tests, 331 pass, 2 pre-existing skips (0 failures; up
from the 262/260 baseline, +71 new tests). New/extended suites:
- `tests/hosts-config-file.test.js` — the config-file layer: parse/merge, the
  seed-once precedence, the empty-vs-absent corner, malformed line → errors[],
  unreadable file → last-good + log-once + no crash, the `!local=` directive.
- `tests/host-config-edit.test.js` — the Add/Remove round-trip driven with INJECTED
  values (no real dialog): valid → atomic append, malformed → nothing written,
  duplicate → deduped, local never removable, a hostile `| rm -rf ~` value is inert
  data, and the structural anti-injection assertions (execFileSync/ARGV-only,
  fixed-literal AppleScript).
- `tests/menubar-multihost.test.js` — `computeMultiBadge` over `/api/hosts`
  fixtures: min across host×tool×window, binding host cue, per-host sections + five
  states per host, offline named via own-key map, `|`/newline labels neutralized,
  single-host = byte-for-byte today's badge, monitoring-station auto-detect +
  `!local` override.
- `tests/menubar-hosts-contract.test.js` — the `/api/hosts` contract guard (a field
  rename is caught by the test, not a silent degrade).
- `tests/hosts-retain-live.test.js` — the poller re-reads the file each tick: a host
  added appears next tick; a host removed has its cache entry dropped next tick
  (ghost cleanup on a LIVE edit, not just restart); `!local` echo drives the badge.
- Extended: `tests/server.test.js` (no HTTP write endpoint / 405), `tests/hosts-
  disclosure.test.js` (config-file source disclosure), `tests/menubar-install.test.js`
  (the helper rides the wrapper model; `--remove-badge` symmetric), `tests/menubar-
  config.test.js` (badge reads `/api/hosts`), `tests/hosts-zerodep.test.js`.

Manual: see `pipeline/multi-host-badge/how-to-see-it.md`.

### Notes for reviewer
- **HTTP stays read-only.** No new write endpoint. Config edits are the local
  `hosts.conf` the badge writes (atomic temp+rename, mode 0o600) and the poller
  re-reads; the server request path gains no new work. A static test asserts
  `src/server.js` contains no host-config write path.
- **Seed-once precedence.** Once `hosts.conf` exists it is the runtime source of
  truth; `LLMDASH_HOSTS` seeds it once when absent, then is ignored (stated in the
  startup log). Neither set = byte-for-byte today's single-host install. The
  env-does-NOT-re-seed-an-empty-file corner is what makes Remove actually stick.
- **Anti-injection (for the Auditor).** The `osascript` dialog is a FIXED-LITERAL
  AppleScript; the typed value leaves osascript via `text returned of result` and is
  passed to the file layer only as ARGV/captured stdout — never concatenated into
  AppleScript or a shell command, never `sh -c`/`eval`. `execFileSync` (ARGV array,
  no shell) throughout. Proven with a hostile `| rm -rf ~` input.
- **The badge opens no outbound connection** — it reads its local `/api/hosts`; the
  hardened peer fetch (`src/hosts.js`) is unchanged. A host reaches the fetch set
  only via the sanitized config file.
- **`retainHosts` now runs on a live file edit**, not only on restart — proven live
  in `hosts-retain-live.test.js`. It runs BEFORE `pollPeers` so a same-tick removal
  is never fetched.
- **Zero new runtime dependencies, no build step** (Node builtins + macOS
  `osascript` only). `package.json` deps stay at 0; the zero-dep guard now covers
  the new modules.
- **The `/api/state` and `/api/hosts` contracts are unchanged** (the golden
  `state-unchanged` test still passes). The badge adds one OPTIONAL `localMode`
  field on the local `HostReading` (a config echo for the monitoring-station
  override) — additive, never on `/api/state`.

### Files
New: `src/host-config.js`, `scripts/menubar/host-config-action.mjs`,
`tests/hosts-config-file.test.js`, `tests/host-config-edit.test.js`,
`tests/menubar-multihost.test.js`, `tests/menubar-hosts-contract.test.js`,
`tests/hosts-retain-live.test.js`, `tests/fixtures/menubar/hosts-multi.json`.
Changed: `config.js` (hostsFile getter), `src/poller.js` (file re-read + localMode
echo), `src/server.js` (file-derived startup + disclosure), `src/health.js`
(hostsConfigLine), `src/host-cache.js` (retainHosts comment),
`scripts/menubar/llmdash.5s.js` (host axis + actions), `scripts/install-macos.sh`
(hosts.conf note), `README.md`, and the extended tests above.
