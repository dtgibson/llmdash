# Schema / System Design — multi-host-badge
**Feature:** multi-host-badge
**Date:** 2026-07-02
**Stage:** 3 — The Architect
**Path:** Incremental (prior `multi-host` + `menu-bar-badge` schemas exist; **no tables, no columns, no migration** — the host list is a config *file*, peers stay cache-only)
**Config-file call:** a **line-oriented text file** `hosts.conf` under `config.dataDir` (OQ-02)
**Precedence call:** **file-once-it-exists is the runtime source of truth; `LLMDASH_HOSTS` seeds it on first run when absent; neither = today's single-host** (OQ-03, the PRD default — confirmed, testable)
**Input mechanism call:** **`osascript display dialog` from a SwiftBar `shell=` action** (SPIKE-01 PASS) — fallback retained but not primary
**SPIKE-01:** PASS — see `spike-report.md`

---

## Data layer verdict

**No database change.** This feature persists exactly one new thing — the
**watched-host list** — and it persists it as a **file**, not a table, precisely
because the `multi-host` schema already settled that *peer readings* stay
cached-only (in-memory, refilled each tick, never SQLite). The out-of-scope
"cross-host history store" is still out of scope. `usage_snapshots`,
`insertSnapshot`, dedup, trends, `getLatestPerWindow` are **untouched** and remain
local-host-only. This "schema" is therefore a **system design**: a config-file
read/merge layer, a poller re-read, the badge's switch to `/api/hosts` + a host
axis, local-file-edit actions, monitoring-station de-emphasis, and disclosure — not
a data-model change.

**Zero runtime dependencies, no build step** (NFR-03). The config-file layer is
`node:fs` only; the badge is `node:http` (+ `node:child_process`/`node:fs` for the
edit helper); the input dialog is macOS-native `osascript`. `package.json` runtime
deps stay at **0**.

**Why a file, not a table (OQ-02 confirmed).** The host list has *no other history*
worth keeping — it is a small mutable set the operator edits, and the poller needs
to *re-read* it each tick (FR-03). A file is the natural fit: human-readable
(FR-01), hand-editable, append/remove-safe with an atomic temp+rename, and it slots
into the existing per-tick `parseHosts()` reconciliation by simply making the file
its input string. A SQLite table would buy nothing (no trend/dedup value), add a
write path on the badge's side (the badge doesn't touch the DB), and fight the
"persist only what has no other history" convention. **File.**

---

## The config file (FR-01, OQ-02)

### Path
```
config.dataDir / hosts.conf          # default: <repo>/data/hosts.conf, or $LLMDASH_DATA_DIR/hosts.conf
```
Alongside `claude-ratelimits.json` and `llmdash.db` — outside any git checkout when
`LLMDASH_DATA_DIR` is set (the installed service sets the data dir under the
checkout by default, but the file is git-ignored data, never tracked). Exposed as a
new `config.hostsFile` getter (mirroring `rateLimitsFile`/`dbPath`):
```js
get hostsFile() { return path.join(this.dataDir, 'hosts.conf'); }
```

### Format — **line-oriented text**, one `host[:port][=label]` per line
```
# llmdash watched hosts — one per line, format: host[:port][=label]
# Lines starting with # are comments. Edited live by the badge (Add/Remove) or by hand.
100.64.0.7:8788=Desktop
laptop=Work Laptop
100.64.0.9:8790
```
Chosen over a JSON array:
- **Append/remove-safe without rewriting unrelated entries** (FR-01): adding a host
  is appending a line; removing is dropping a line. A JSON array forces a full
  parse+reserialize on every edit (fine, but noisier and easier to corrupt by hand).
- **Human-readable and hand-editable** (FR-01, the fallback path): a plain list with
  a comment header is the least-surprising thing to open in an editor.
- **One parser serves both surfaces (FR-01).** Each non-comment, non-blank line is
  **exactly one `LLMDASH_HOSTS` entry** — so the file body maps to the env grammar
  by joining lines with commas. `parseHosts` is reused verbatim; no second grammar.

**Line ↔ env-entry mapping (the load-bearing reuse):** `LLMDASH_HOSTS` is a
**comma**-separated list of `host[:port][=label]` (comma chosen so labels may contain
spaces). The file is **newline**-separated for append/remove-safety. The reader
strips comments/blanks and **joins the remaining lines with `,`** to produce the same
string `parseHosts` already consumes — one parser, one grammar, both surfaces
(FR-01/QA-01). Labels may contain spaces and `=` (first `=` splits host from label,
per `parseHosts`); a label may **not** contain a newline (the line *is* the record
delimiter) — the writer strips `\r\n` from a label before writing.

### Atomic write
Every write is **temp + rename** on the same filesystem (`fs.writeFileSync(tmp,
…, {mode:0o600}); fs.renameSync(tmp, hostsFile)`), so no partial file is ever
observable and concurrent writes are last-write-wins without corruption (OQ-06 —
no lock; the atomic rename suffices for a single-user tool). Proven in SPIKE-01.

---

## Precedence — file vs. `LLMDASH_HOSTS` (FR-02, OQ-03) — **confirmed, testable**

The PRD default is confirmed. Stated as three testable rules:

| State | Effective remote-host source | Behavior |
|---|---|---|
| **File exists** (readable) | **the file** — runtime source of truth | `LLMDASH_HOSTS` is ignored for the remote set (it already seeded the file, or the operator edited the file). |
| **File absent**, `LLMDASH_HOSTS` set | the env seed | On first read, **seed the file** from `LLMDASH_HOSTS` (write it once, atomically), then the file is authoritative thereafter. |
| **File absent**, `LLMDASH_HOSTS` unset | none | **Byte-for-byte today's single-host install**: local host only, no peers, no outbound fetch. |

**No dead knob (FR-02):** the file drives the runtime host set; `LLMDASH_HOSTS`
drives the first-run seed; with neither set, nothing changes vs. today. Both drive
real behavior; the precedence is stated honestly in the README and the startup log
(FR-21).

**Seed-once semantics (the honest, testable rule).** The seed is a **first-run
initialization**, not a per-tick merge: when the file does not exist and
`LLMDASH_HOSTS` is set, the reader writes the file from the env seed **once** (the
normalized `host[:port][=label]` lines), and from then on the file is the source of
truth. This makes "change what I watch" a file edit (via the badge or by hand), and
means editing `LLMDASH_HOSTS` after the file exists **does nothing to the remote set**
— which the startup log states honestly ("host source: config file (…); LLMDASH_HOSTS
seed ignored because the file exists"). Rationale for seed-once over per-tick-merge:
a per-tick merge would make a host removed via the badge **reappear** every tick if it
was also in `LLMDASH_HOSTS` (the operator could never remove it) — a dishonest,
un-removable ghost. Seed-once is the only rule under which Remove (FR-16) actually
removes.

**Corner: empty file vs. absent file.** An **absent** file with `LLMDASH_HOSTS` set
→ seed. An **empty/comment-only** file (the operator removed every peer) → **zero
remotes**, single-host — the file exists, so it wins, and its emptiness is honest
(the operator chose to watch nothing remote). The env seed does **not** re-seed an
existing-but-empty file (that would resurrect removed hosts). Tested (QA-02).

---

## Reading & merging the file — where it lives (FR-01/FR-03/FR-04)

A small new module owns the file layer; `parseHosts` stays the pure per-entry parser.

```
src/host-config.js   (new)
  readHostsConfig({ hostsFile, hostsRaw, fs }) → { source, raw, error }
     // source ∈ 'file' | 'env-seed' | 'none'
     // raw    = the comma-joined host[:port][=label] string to feed parseHosts
     // error  = null | { reason: 'unreadable'|'malformed-file', detail }   (FR-04)
  seedHostsConfigIfAbsent({ hostsFile, hostsRaw, fs }) → boolean   // first-run seed
  writeHostsConfig(hostsFile, entries[], { fs })                   // atomic temp+rename
  addHost(hostsFile, entry, { fs })    → { ok, canonical } | { ok:false, reason }   // FR-15
  removeHost(hostsFile, key,  { fs })  → { ok } | { ok:false, reason }              // FR-16
  listHosts(hostsFile, { fs }) → entries[]                                          // FR-14
```

- `readHostsConfig` is **pure/injectable** (fs injected) so the parse/merge/precedence
  is unit-testable without touching the real data dir (QA-01/QA-02/QA-05).
- It reuses `sanitizeHostPort` + the `parseHosts` per-entry grammar from `src/hosts.js`
  for `add`/`remove`/validation — **one parser, one sanitizer** (FR-01/FR-05). The
  add/remove helpers import `src/hosts.js`; nothing is copied.

**Where `parseHosts` gets the raw string (the one wiring change).** Today
`parseHosts(raw = config.hostsRaw)` reads the env var. The change is: the **poller**
(and the server's startup seed) call `parseHosts(readHostsConfig(...).raw, …)` — i.e.
the *file-or-seed* string, not `config.hostsRaw` directly. `parseHosts` itself is
**unchanged** (still pure, still per-entry). This keeps the local-host-always-prepended
+ dedup + `isLocalHost` logic exactly as shipped; only its **input** now comes from
the file layer.

### Honest degradation (FR-04)
- **Unreadable/corrupt file** (permission error, IO error): `readHostsConfig` returns
  `error:{reason:'unreadable'}` and **falls back to the last-good in-memory host set**
  (or the env seed on first tick); the poller **logs the failure once** (a module-level
  `loggedConfigError` latch, mirroring `claude-refresh`'s once-latch), not every tick;
  the failure surfaces in `healthLines()`. **The poller never crashes.**
- **A malformed *individual* line** within an otherwise-readable file: it flows through
  `parseHosts` into `errors[]` (the existing path) and is surfaced honestly in the
  startup log + health — **never silently dropped, never fabricated into a reading**
  (FR-04, reuses the shipped `peerDisclosureLine`/`peerHealthLines` malformed-entry
  lines).

---

## The poller re-read + live reconciliation (FR-03) — **the runtime-apply half**

The plumbing already exists (`pollOnce()` already runs `parseHosts` → `seedOrder` →
`retainHosts` every tick). The change makes the **file** its input:

```
pollOnce()                                              [src/poller.js]
├─ (existing) claude/codex poll + stat caches                       (LOCAL, unchanged)
├─ cfg = readHostsConfig({ hostsFile, hostsRaw, fs })   [NEW — file-or-seed, per tick]
│     unreadable → log once, reuse last-good raw
├─ parsed = parseHosts(cfg.raw)                          [input now the file string]
├─ writeLocalHost(nowMs)  → setHost(local, in-process buildState)   (unchanged)
├─ seedOrder(parsed.hosts)                               (unchanged)
├─ retainHosts(parsed.hosts.map(h => h.key))   ← GHOST CLEANUP fires on a FILE edit
└─ pollPeers(remoteHosts(parsed))                        (unchanged bounded fan-out)
```

- **Add** (a line appears in the file): the new host is in `parsed.hosts` next tick →
  `seedOrder` places it → `pollPeers` fetches it → it appears in `/api/hosts`. **No
  restart** (FR-03/QA-03).
- **Remove** (a line disappears from the file): the key is no longer in
  `parsed.hosts` → `retainHosts` **deletes its cache entry** (and its order slot) →
  it no longer appears or is polled — **the same observable outcome as a restart**,
  now on a **live file edit**, not just a process restart (FR-03/QA-03). This is the
  key verification the QA table pins: `retainHosts` already cleans ghosts on a
  changed host-set; this feature proves it fires on a **file change mid-run**, not
  only on restart. The `retainHosts` comment ("normally the process restarts") is now
  literally exercised at runtime — the Engineer updates that comment to say so.
- **Mid-fetch removal safety (FR-16):** a host removed while its fetch is in flight
  does not crash the poller — the in-flight `setHost(key, …)` for a now-removed key
  writes a cache entry that the **next** tick's `retainHosts` immediately drops (or
  the removal tick's `retainHosts` runs before the fan-out, so the removed key is
  never fetched that tick). Either way: no crash, no ghost (QA-16). The Engineer
  should run `retainHosts` **before** `pollPeers` within the tick (it already does),
  so a same-tick removal is never fetched.

**Cost note (request-path isolation, NFR-04):** the file read is one cheap
`fs.readFileSync` on the **poller** tick, never on the HTTP request path.
`/api/hosts` stays a pure `getCombined()` cache read. The config **write** happens in
the **badge process**, entirely out of the server.

---

## The badge goes multi-host (FR-06 – FR-13) — `scripts/menubar/llmdash.5s.js`

The badge is still a **pure consumer**; the change is **one endpoint switch + one new
axis (host)** wrapping the existing per-tool logic. It recomputes no limits and opens
no outbound fetch of its own.

### Endpoint switch (FR-06)
`fetchState(host, port)` → **`fetchHosts(host, port)`**: same hardened loopback
`http.get` shape, path **`/api/hosts`** instead of `/api/state`. The badge reads its
**local** instance's combined view over loopback (the local machine already fanned
out to the peers); `LLMDASH_BADGE_HOST`/`LLMDASH_PORT` still point it at whichever
instance serves it (default loopback). No second data path; no per-remote badge
fetch (NFR-02/QA-06/QA-24). The offline branch (server down) is unchanged — a failed
`/api/hosts` fetch → the existing offline glyph.

### The wire shape the badge consumes (authoritative, from `host-cache.js`/`hosts.js`)
```
GET /api/hosts → { hosts: [ HostReading, … ], generatedAt }
HostReading = { host, label, port, self, reachable,
                hostDiagnostic: null|{reason,cause,detail?},
                fetchedAt, pending?, state: null|{ tools:[…], headroom, generatedAt } }
```
`state.tools[]` is the **exact `/api/state` shape** the badge parses today. The badge
treats every `HostReading` field as **data** — `sanitize()` every free-form field
(host/tool `label`, diagnostic `detail`) before it touches a SwiftBar line;
`sanitizeHostPort` any host/port on an `href=`/URL surface (FR-11/QA-11).

### The multi-host glyph (FR-07/FR-08) — extend `computeBadge` by a host axis
`computeBadge` today takes one `/api/state` and finds the min `remainingPct` across
**tool × window**. The new **`computeMultiBadge(combined)`** wraps it with a **host**
axis:

```
computeMultiBadge({ hosts }) → { state, pct, cue, hostCue, binding, hostViews, mode }
  mode = 'single' | 'multi'                       // 'single' when effective host count === 1 (FR-13)
  hostViews = hosts (after monitoring-station de-emphasis, FR-19) each carrying:
             { label, self, reachable, hostDiagnostic, band(per host), toolViews (existing) }
  binding   = the min remainingPct across HOST × tool × window that has a reading
              (floor); a maxed window (remainingPct<=0) binds as "limit reached";
              hosts/windows with no reading are EXCLUDED from the min (never 0)   (FR-07)
  cue       = binding tool's C/X cue (existing)
  hostCue   = the binding host's short cue (multi mode only; FR-08)               [Designer owns exact form]
  band      = the binding host's binding-tool band; fallback freshest-applicable  (existing rule, per host)
```

- The existing per-tool `computeBadge` internals are **reused per host** (the
  `toolViews` mapping is unchanged); the host axis is an **outer loop** — the renderer
  and the min-search gain one dimension, nothing is forked. The proven
  most-constrained-window logic (menu-bar spike) extends by one axis exactly as the
  multi-host schema's "host × tool" modeling call anticipated.
- **Host cue (FR-08).** In `mode:'multi'`, the glyph and the dropdown headline name
  the **binding host** alongside the C/X tool cue, so the glance says *which machine*
  and *which tool* bind. The exact treatment (short label / initial / truncation,
  glyph composition) is the **Designer's within this model** (OQ-05) — kept
  **xbar-safe** (text/emoji + `color=`, never a SwiftBar-only param), consistent with
  the shipped five-state glyph grammar. The **observable requirement**: the binding
  host is identifiable from the glyph/headline in multi-host mode. A candidate that
  stays in the shipped grammar: `▪ Desktop·C 12%` (host cue · tool cue · pct) — final
  form is the Designer's.
- **Single-host / unconfigured = today's badge, exactly (FR-13/QA-13).** When the
  effective host count is 1 (only the local host), `computeMultiBadge` returns
  `mode:'single'` and the emitter renders **byte-for-byte the shipped single-host
  glyph + dropdown** — no host cue, no host chrome. `/api/hosts` in that state returns
  one `self` host, so the badge unwraps `hosts[0].state` and runs the **existing**
  `computeBadge`/`emit` path unchanged. Multi-host presentation engages **only** when
  effective host count > 1.

### The dropdown: one section per host (FR-09/FR-10)
`emit()` gains a host loop: for each `hostView`, a **host header** (escaped `label` +
its per-host freshness/offline state) wrapping the **existing per-tool rows** (5-hour
/ Weekly; "not available" / "limit reached" / "N% · resets …"). The shipped **five
honesty states** (fresh / aging / stale / no-reading / offline) apply **per host** via
the existing `ageBand`/`computeBadge` internals — one host aging/offline never flags
or suppresses another's section (FR-09/QA-09).

- **Offline/unreachable host (FR-10/QA-10).** A `HostReading` with `reachable:false`
  or `state:null` renders a **named offline/error line** carrying *which host and why*
  — mapped from `hostDiagnostic.reason`/`cause` via **own-key (`hasOwnProperty`)
  lookup** with `detail` `sanitize()`d — **never** a fabricated zero, **never**
  stale-as-fresh, **never** silently dropped. This reuses the badge's existing
  own-key `DIAG_LINES` discipline; add host-level codes:

  | `hostDiagnostic.reason` | badge line (own-key mapped, `detail` sanitized) |
  |---|---|
  | `peer-unreachable` | "`<label>` is unreachable (`<cause>`) — check the machine is awake and llmdash is running." |
  | `peer-error` | "`<label>` returned an error (`<cause>`)." |
  | `pending` (a seeded, not-yet-polled host) | "`<label>` — not polled yet; fills in on the next update." |

  The reserved codes `auto-refresh-failing`/`auto-refresh-disabled` are **not reused**
  for host failures (CLAUDE.md). Per-host freshness thresholds are **server-supplied**
  on each host's tool `freshness` (already normalized by the peer path); the badge
  derives bands live via the existing `ageBand` — never hardcoded.

### Escaping / sanitization at render (FR-11/QA-11)
Every free-form `/api/hosts` field passes through `sanitize()` (strip `|\r\n`) before
a SwiftBar line; host/port on any `href=`/URL passes through `sanitizeHostPort`. No
field is interpolated raw. A hostile label (`|`/newlines) cannot break the line
grammar — the exact security seam the menu-bar spike already proved for `detail`, now
applied to host/tool labels too. The `Open dashboard` href uses the badge's own
local host/port (loopback), not a peer's.

### Contract guard (FR-12/QA-12)
A **fixture-based contract test** asserts the badge parses the shipped `/api/hosts`
shape (`hosts[]`, every `HostReading` field, the nested `state` `/api/state` shape).
A future field rename is caught by the test, not by the badge silently degrading to
offline/odd states. Extends the badge's existing helper-parity guard against
`public/app.js`. **If the badge appears to need an `/api/hosts` field change, that is
a flag to raise, not a silent coupling** — the server contract stays as shipped
(out-of-scope: changing the `/api/hosts`/`/api/state` contract).

---

## Monitoring-station handling (FR-19/FR-20)

**Auto-detect default (FR-19/QA-19):** when the **local host has no readings** (its
tools all report no limit reading / no activity — `self:true` + every tool
`haveLimits:false` and activity `hasData:false`) **and ≥1 remote host is configured**,
the badge **de-emphasizes/excludes the local host from the glyph and the dropdown
headline** — the empty local reading does not dominate the glance. The exclusion is
**client-side in `computeMultiBadge`** (the local host is dropped from the binding-min
search and from the headline when the auto-detect condition holds), not a server
change — a pure derivation over `/api/hosts` (no new server field).

**Explicit override (FR-19, real knob, no dead knob):** a config-file directive is the
override, so the operator controls it from the same surface they edit hosts:
```
# hosts.conf — an optional directive line (parsed by host-config.js, not a host entry)
!local=exclude      # force-exclude the local host from glyph/headline always
!local=include      # force-include the local host always (defeat auto-detect)
!local=auto         # (default) auto-detect empty-local + remotes-present
```
The `!local=` directive is read by `host-config.js` and passed to the badge via a
small field on the local `HostReading` **or** derived client-side from a config echo —
Engineer's call, but it must be a **real knob** (drives the include/exclude decision;
tested QA-19). Chosen over a `LLMDASH_*` env because (a) it lives with the host list
the operator already edits from the badge, and (b) an env var means a plist edit +
restart — exactly the friction this feature removes. **The de-emphasis presentation
and the auto-detect default are flagged for the user to ratify at the Designer stage
(OQ-04).**

**Empty local retained, honestly labeled (FR-20/QA-20):** even when de-emphasized, the
local host stays in the **dropdown** as its own section, honestly labeled (e.g. **"no
local activity"** / "This machine — no reading"), **never** fabricated zeros, **never**
silently dropped. De-emphasis changes **prominence** (out of glyph/headline), not
**honesty** (the section is still there, still true). This is a presentation rule in
`emit()`, not a data drop.

---

## Local-file edit from the menu bar (FR-14 – FR-18) — [OSA], SPIKE-01 PASS

### The actions (FR-14) — SwiftBar dropdown, no HTTP mutation
Appended to the badge's dropdown (after the existing Open-dashboard / Refresh):
```
---
Add host…    | shell="$ABS_NODE" param1="<plugin-dir>/host-config-action.mjs" param2=add    terminal=false refresh=true
Remove host… | (submenu: one item per current remote host)
  ↳ Stop watching <label>… | shell="$ABS_NODE" param1="…/host-config-action.mjs" param2=remove param3="<key>" terminal=false refresh=true
Watching: <N> host(s)   | (a listing — the current monitored set, escaped labels)     (FR-14 List)
```
- **`shell=`/`bash=`** runs a **tracked helper** under the **baked absolute node**
  (the wrapper's `$ABS_NODE`, NFR-06 — a bare `node` is dead under the minimal spawn
  PATH). `terminal=false` (windowless), `refresh=true` (dropdown reflects the new
  list; FR-17).
- **No HTTP mutation** (NFR-01/QA-22): the helper writes the **local** file; the
  server's request path is untouched, still 405 for non-GET/HEAD, still read-only.
- **List** is a rendered listing of the current hosts (escaped labels) — a real
  affordance, not a dead item.

### The helper the actions invoke — `scripts/menubar/host-config-action.mjs` (new, tracked)
Runs under the wrapper's absolute node. Node-builtins + `osascript` only.
```
node host-config-action.mjs add                 → osascript Add dialog → sanitize → validate → atomic append
node host-config-action.mjs remove <key>        → confirm dialog → atomic remove
node host-config-action.mjs remove <key> --yes  → (test seam: skip dialog, drive by injected value)
```
- **Add (FR-15/QA-15):** launch the `osascript` `display dialog` (prompt copy FR-18)
  via `child_process.execFileSync('osascript', ['-e', <FIXED literal AppleScript>,
  '-e', 'text returned of result'])`; capture the value; hand it to
  `host-config.js addHost()` which **sanitizes** (`sanitizeHostPort`), **validates**
  (`parseHosts` per-entry grammar), **dedupes** (`host:port` — "already monitored"),
  and only-if-valid **atomically appends** the canonical line. A malformed entry is
  **rejected with an honest dialog message naming the reason** and **never written**;
  a duplicate is **deduped and honestly reported**. (Full round-trip proven in
  SPIKE-01, including hostile input.)
- **Remove (FR-16/QA-16):** a confirm dialog (`display dialog "Stop watching <label>
  (<host:port>)?"`), then `host-config.js removeHost(key)` via an atomic write.
  **The local host is never offered for removal** (it is always present, FR-02 — the
  Remove submenu lists only `!self` hosts). Removing mid-fetch is poller-safe (above).
- **Anti-injection (SPIKE-01, for the Auditor):** the AppleScript string is a **fixed
  literal**; the entered value leaves `osascript` via `text returned of result` and is
  passed to the helper **only on ARGV / captured stdout** — **never** string-concatenated
  into AppleScript or a shell command. No `sh -c`, no `eval` of any entered value. The
  value is data end-to-end (QA-23).
- **Test seam (no real dialog):** the helper's sanitize/validate/atomic-write logic
  lives in `host-config.js` and is driven **directly with an injected value** (no
  dialog) in tests — the dialog is a thin front end the tests bypass (QA-15/QA-16).

### Post-write behavior (FR-17/QA-17)
After any write the action's `refresh=true` re-runs the badge so the dropdown reflects
the new list; the **actual monitoring change applies on the next poller tick** (FR-03).
The copy states the change applies "on the next update" — it **never claims the change
is live before the poller has re-read the file**.

### Config-edit copy (FR-18/QA-18) — honesty + validation pinned (Designer refines wording)
The pinned strings (from the PRD) are honest and validating:
- Add prompt · Invalid ("…nothing was added. Expected `host[:port][=label]`.") ·
  Duplicate ("already being watched.") · Remove confirm · Write failure ("…Nothing
  changed.") · Post-write ("…it'll appear on the next update."). An invalid entry
  **names the reason and writes nothing**; a write failure **states nothing changed**.

---

## Delivery model preserved (NFR-06)

The new helper `scripts/menubar/host-config-action.mjs` is a **tracked** file,
delivered by the **same** marker-gated wrapper / absolute-node model as the badge:
the SwiftBar-dir wrapper execs `$ABS_NODE` against the tracked plugin, and the tracked
plugin's Add/Remove actions exec `$ABS_NODE` against the tracked helper (the installer
already resolves and knows `$ABS_NODE` and the plugin dir). The tracked source is
never rewritten (so `git pull` / installer re-run stays clean); `--remove-badge`
reverses symmetrically (it removes the wrapper; the tracked helper is repo source,
untouched). SwiftBar stays a **disclosed user prerequisite**, never auto-installed.
The installer's badge-setup message gains a one-line note of the `hosts.conf` default
location (`config.dataDir/hosts.conf`) so the operator knows where the list lives.

---

## Data flow (end to end)

```
badge dropdown "Add host…"  (shell=$ABS_NODE host-config-action.mjs add, terminal=false refresh=true)
   → host-config-action.mjs launches osascript display dialog  (FIXED-literal AppleScript)
   → captured value (ARGV/stdout, never re-interpolated)
   → host-config.js addHost():  sanitizeHostPort → parseHosts per-entry validate → dedupe
        valid   → atomic temp+rename append to  config.dataDir/hosts.conf
        invalid → honest dialog message, NOTHING written
   → SwiftBar refresh=true  (dropdown reflects the new list immediately)
   ─────────────────────────  (next poller tick, ≤ pollIntervalMs)  ─────────────────────────
   → poller: readHostsConfig(hostsFile) → parseHosts(raw) → seedOrder + retainHosts + pollPeers
        added host   → polled, appears in the cache
        removed host → retainHosts drops its cache entry (ghost cleanup on a LIVE edit)
   → GET /api/hosts  (pure getCombined() cache read, off the request path)
   → badge fetchHosts() → computeMultiBadge() → emit()  (multi-host glyph + host cue + per-host sections)
```

HTTP stays **read-only** throughout — the only write is the badge's local
`hosts.conf` temp+rename; the server never mutates config and never grows a write
endpoint (NFR-01/QA-22).

---

## Modules

| File | Change |
|---|---|
| `src/host-config.js` | **New.** `readHostsConfig` (file→raw + precedence + degradation), `seedHostsConfigIfAbsent` (first-run seed from `LLMDASH_HOSTS`), `writeHostsConfig`/`addHost`/`removeHost`/`listHosts` (atomic temp+rename, reuse `sanitizeHostPort`+`parseHosts`), the `!local=` directive parse. Pure/injectable (fs injected). `node:fs` only. |
| `src/hosts.js` | **Unchanged parser.** `parseHosts`/`sanitizeHostPort`/`isLocalHost`/`remoteHosts` reused verbatim by `host-config.js`. (No change to the module itself — its *input string* now comes from the file layer via the caller.) |
| `src/poller.js` | **+file read per tick.** `pollOnce()` calls `readHostsConfig(...)` and feeds its `raw` to `parseHosts` (instead of `config.hostsRaw`); log-once latch on an unreadable file; `retainHosts` now exercised on a **live** file edit (update its comment). Fan-out/single-flight unchanged. |
| `config.js` | **+`hostsFile` getter** (`dataDir/hosts.conf`). `hostsRaw` (`LLMDASH_HOSTS`) stays — now the **seed** input, not the runtime source. No new knob unless the Engineer adds one; the `!local=` override lives in the file, not env. |
| `src/server.js` | **Startup seed uses the file layer.** The synchronous local-host seed + `startPoller` path already exists; the one change is the startup host source is `readHostsConfig(...)`-derived (so `/api/hosts` reflects the file from tick zero). `/api/hosts` handler + 405/read-only posture **unchanged**. |
| `src/health.js` | **+config-file health line** (FR-21): present / missing / seeded-from-env / malformed + the fix (a cheap fs check, off the request path); the startup disclosure states the effective host **source** (file / env-seed / neither) + the effective set. Extends `healthLines`/`peerDisclosureLine`. |
| `scripts/menubar/llmdash.5s.js` | **+host axis.** `fetchHosts` (`/api/hosts`), `computeMultiBadge` (host×tool×window min + host cue + monitoring-station de-emphasis), per-host dropdown sections, host-level `hostDiagnostic` own-key lines, the Add/Remove/List actions. `mode:'single'` = byte-for-byte today's badge. |
| `scripts/menubar/host-config-action.mjs` | **New, tracked.** The Add/Remove helper the SwiftBar actions invoke under `$ABS_NODE`: launch `osascript` dialog (fixed-literal) → `host-config.js` sanitize/validate/atomic-write. Driveable with an injected value (tests/fallback). |
| `scripts/install-macos.sh` | **+one note line** in the badge-setup message: the `hosts.conf` default location. The wrapper/absolute-node model is otherwise unchanged (the tracked helper rides the same delivery). |
| `README.md` | **+config-file section** (FR-21): path/format, the file-vs-`LLMDASH_HOSTS` precedence, local-host-always-included, the badge's config-edit affordance, the serve-only/local-write posture, the `!local=` monitoring-station override. |
| `tests/hosts-config-file.test.js`, `tests/host-config-edit.test.js`, `tests/menubar-multihost.test.js`, `tests/menubar-hosts-contract.test.js`, `tests/fixtures/hosts-*.json`, `tests/fixtures/hosts.conf.*` | **New.** (See *Test seams*.) |

**Untouched:** `src/db.js`, `src/stats.js`, `src/codex-stats.js`, `src/trends.js`,
the `usage_snapshots` schema, `getCombined`/`host-cache.js` (consumed as-is),
`fetchPeerState`/the hardened outbound posture, the `/api/state` + `/api/hosts`
**contracts**, the freshness thresholds/bands, the existing diagnostic reason codes.

---

## Security / sanitization (NFR-01, NFR-02 — for the Auditor)

- **HTTP stays read-only (NFR-01/QA-22).** No new HTTP write/mutation endpoint.
  Config edits are **only** the local file the badge writes + the poller re-reads.
  All responses (incl. `/api/hosts`) keep the baseline headers, reject non-GET/HEAD
  with 405 (`allow: GET, HEAD`), serve static `no-store`. The `0.0.0.0` bind gains
  **no** write surface.
- **Sanitize before use, everywhere (FR-05/QA-05/QA-23).** Every entered host/IP/port
  is `sanitizeHostPort`-scrubbed **before** the file, the fetch target, or any
  rendered/logged surface; an empty-after-sanitize host or an out-of-range port is an
  **honest rejection**, never a coercion. Labels are `sanitize()`d at render (badge)
  and newline-stripped at write.
- **No AppleScript/shell injection (SPIKE-01/QA-23).** Fixed-literal AppleScript +
  ARGV-only value passing; no entered value is compiled back into AppleScript or a
  shell command. `osascript` is macOS-native (Standard Additions `display dialog` — no
  TCC/Automation prompt). Proven with a `| rm -rf ~` hostile input.
- **Local, atomic, user-owned write (NFR-02/QA-23/QA-28).** temp+rename on the same
  filesystem (`mode 0o600`), by the user-owned badge process, under the data dir — no
  network write, no privileged path, no partial file ever observable, last-write-wins
  on concurrency (no lock).
- **No new outbound surface (NFR-02/QA-24).** The badge issues **no** outbound fetch to
  any remote host (it reads local `/api/hosts`); the hardened peer fetch
  (configured-hosts-only, credential-free `GET /api/state`, no redirect-follow,
  bounded timeout + body cap, every field clamped/normalized/escaped) is **unchanged**
  — a host reaches the fetch set only via the sanitized config file.
- **Request-path isolation (NFR-04/QA-26).** Config-file read is on the poller;
  `/api/hosts` is a pure `getCombined` cache read; the write is in the badge process.
  The server request path gains no new work.

---

## Disclosure (FR-21/QA-21)

- **README:** the `hosts.conf` path + format; the file-vs-`LLMDASH_HOSTS` precedence
  (seed-once, file authoritative); the local-host-always-included rule; the badge's
  Add/Remove/List affordance; the **serve-only / local-file-write** posture (no HTTP
  mutation); the `!local=` monitoring-station override.
- **Startup log:** which host **source** is in effect (config file / env-seed /
  neither) + the effective host set; an ignored-`LLMDASH_HOSTS`-because-file-exists
  note when applicable; malformed entries with the fix (reuses `peerDisclosureLine`).
- **`healthLines()`:** a **config-file line** naming the state (present / missing /
  seeded-from-env / malformed / unreadable) + the fix — a cheap fs check, off the
  request path, extending the existing per-peer lines.

---

## Config / env (no dead knobs)

| Surface | Value | Drives |
|---|---|---|
| `hosts.conf` (file) | `config.dataDir/hosts.conf` | the **runtime** remote-host set (poller re-read → fan-out + `/api/hosts`) |
| `LLMDASH_HOSTS` (env) | seed on first run when the file is absent | initializes the file once; ignored once the file exists (stated honestly) |
| `!local=` directive (in-file) | `auto` (default) / `include` / `exclude` | the monitoring-station de-emphasis decision (a real knob, QA-19) |
| `LLMDASH_BADGE_HOST` / `LLMDASH_PORT` | loopback default | which instance the badge reads `/api/hosts` from (unchanged) |
| `peer*` fetch bounds | as shipped (multi-host) | the fan-out (unchanged) |

Neither the file nor `LLMDASH_HOSTS` set ⇒ **byte-for-byte today's single-host
install** (FR-02) — no dead knob.

---

## Test seams (Stage-6 QA table)

Every row maps to a **pure or injectable** test — no live tailnet peer, no real menu
bar, no real `osascript` dialog needed for the logic checks (the live in-menu-bar
render + real dialog are deploy-time captures, per the badge's shipped deferral).

- **Config-file parse/merge/precedence** (`tests/hosts-config-file.test.js`, pure, fs
  injected): file present → its lines are the remote set; file body ↔ `LLMDASH_HOSTS`
  grammar parity via `parseHosts` (QA-01); **precedence** — file-present wins,
  file-absent+env → seed-once then file authoritative, neither → single-host
  byte-for-byte (QA-02); an **existing-but-empty** file → zero remotes, env does NOT
  re-seed (QA-02 corner); comment/blank lines ignored; a **malformed line** →
  `errors[]`, surfaced, not fabricated (QA-04); an **unreadable** file → fall back to
  last-good/env-seed, **log once**, no crash, surfaced in health (QA-04). Sanitize
  strips whitespace/metacharacters before write/fetch/render (QA-05).
- **Add/Remove helper — sanitize + atomic write, no real dialog**
  (`tests/host-config-edit.test.js`, drive `host-config.js` with an **injected value**):
  valid `host[:port][=label]` → sanitized, validated, atomically appended (canonical
  line); malformed → rejected, **nothing written**; duplicate `host:port` → deduped,
  honestly reported (QA-15). Remove → entry gone via atomic write; **local host never
  removable**; a temp file never leaks; **no partial file** on a simulated mid-write
  (QA-16/QA-23/QA-28). The literal-AppleScript / ARGV-only structure asserted by
  inspection (no value concatenated into the `-e` string) (QA-23).
- **Badge multi-host glyph over injected `/api/hosts` fixtures**
  (`tests/menubar-multihost.test.js`, pure over fixtures): `computeMultiBadge` glyph =
  `floor(min remainingPct)` across **host × tool × window** with a reading; a maxed
  window binds "limit reached"; no-reading hosts/windows excluded (never 0) (QA-07);
  the **binding host** named in glyph/headline (host cue) (QA-08); **one section per
  host**, five states **per host**, one host's degraded state doesn't suppress another
  (QA-09); an offline host → named line via own-key `hostDiagnostic` map, `detail`
  sanitized, never a zero/stale-as-fresh (QA-10); every free-form field `sanitize()`d —
  a `|`/newline label can't break the line grammar (QA-11); **single-host fixture =
  byte-for-byte today's badge output** (QA-13).
- **Monitoring-station auto-detect** (`tests/menubar-multihost.test.js`): empty-local +
  ≥1 remote → local excluded from glyph/headline, **retained in the dropdown** honestly
  labeled, never zeros (QA-19/QA-20); `!local=include`/`exclude` override each a real
  knob (QA-19).
- **`/api/hosts` contract guard** (`tests/menubar-hosts-contract.test.js`): a fixture
  asserts the badge parses the shipped `/api/hosts` shape (`hosts[]`, every
  `HostReading` field, nested `state`); a renamed/removed field is **caught by the
  test**, not by a silent offline degrade (QA-12). Extends the badge's helper-parity
  guard.
- **Retain-on-live-removal** (poller integration, injected fs + injected fetch): a host
  in the file at tick N and gone at tick N+1 → its cache entry is dropped by
  `retainHosts` **on tick N+1** (same outcome as a restart, but live) and it is no
  longer polled (QA-03/QA-16). A host added to the file → polled + present next tick,
  no restart (QA-03).
- **HTTP read-only preserved** (extend `tests/server.test.js`): `/api/hosts` + all
  responses carry the baseline headers, non-GET/HEAD → 405 (`allow: GET, HEAD`),
  static `no-store`; **no new write endpoint exists** (QA-22). Request path does no
  peer fetch/subprocess (QA-26).
- **Zero deps / no build / macOS-native** (QA-25): `package.json` runtime deps still 0;
  the config layer + badge use `node:fs`/`node:http`/`node:child_process` + macOS
  `osascript` only; no build step.
- **Delivery model preserved** (extend `tests/menubar-install.test.js`): the tracked
  helper rides the marker-gated wrapper/absolute-node model; `--remove-badge` reverses
  symmetrically; SwiftBar never auto-installed (QA-27).
- **Disclosure** (`tests/hosts-disclosure.test.js` extend): README documents path /
  precedence / local-always / affordance / serve-only posture; startup log states the
  source + set; `healthLines()` names the config-file state + the fix (QA-21).

---

## Risks the Engineer inherits

1. **The `/api/hosts` contract coupling (FR-12).** The badge depends on exact
   `HostReading`/nested-`state` field names. Keep the contract test as the guard; the
   badge must **never** trigger a contract change — if it seems to need one, raise a
   flag (out-of-scope: changing the contract).
2. **Retain-on-live-removal (FR-03/FR-16).** `retainHosts` must run **before**
   `pollPeers` within the tick so a same-tick removal is never fetched; a mid-fetch
   removal must not crash (the in-flight write is dropped next tick). This is the one
   behavior that must be proven **live** (not just on restart) — the QA table pins it.
3. **The node/PATH reality for the Add/Remove helper (NFR-06/SPIKE-01).** The helper
   runs under the wrapper's **absolute node** — a bare `node` in the SwiftBar action is
   dead under the minimal spawn PATH. Wire the `shell=` executable to `$ABS_NODE`, not
   `node`.
4. **Seed-once, not per-tick-merge (FR-02).** Editing `LLMDASH_HOSTS` after the file
   exists does nothing — the file wins. Do **not** merge the env into the file every
   tick (that resurrects removed hosts, un-removable). The startup log must state the
   source honestly.
5. **Anti-injection is structural (SPIKE-01/NFR-02).** Fixed-literal AppleScript +
   ARGV-only value passing. Never concatenate an entered value into AppleScript or a
   shell command; never `sh -c`/`eval` it.
6. **Label is data (FR-11).** `sanitize()` a host/tool label at render; newline-strip a
   label at write. A `|` in a stored label is inert only because it is scrubbed at
   render — don't skip that.
7. **`config.hostsRaw` still exists** (the seed). Don't remove it; repoint the
   *runtime* source to the file layer while keeping the env as the first-run seed.

## Open sub-decisions left to the Engineer / Designer

- **Host-cue treatment (OQ-05)** — short label / initial / truncation + glyph
  composition is the **Designer's**, within the xbar-safe five-state grammar. The
  observable requirement (binding host identifiable in multi mode) is settled.
- **Monitoring-station presentation + auto-detect default (OQ-04)** — the de-emphasis
  visual and the auto-detect default are **flagged for the user to ratify at the
  Designer stage**; the honesty floor (empty local retained + honestly labeled, never
  zeros) is settled.
- **`!local=` plumbing** — a field on the local `HostReading` vs a config echo the
  badge reads — Engineer's call; it must be a real knob (QA-19).
- **Fallback affordance shape** — open-file vs instructions-pane — Designer's, only if
  a deploy environment ever refuses the dialog; not the primary path (SPIKE-01 PASS).
