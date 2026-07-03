# PRD — Multi-Host Badge
**Feature:** multi-host-badge
**Date:** 2026-07-02
**Stage:** 2 — The Planner
**Source:** strategic-brief.md (approved)

---

## Feature Overview

The macOS menu-bar badge grows from watching one machine to watching several,
and gains the ability to be reconfigured live — add, remove, and list monitored
hosts — straight from its own dropdown, with no launchd plist edit and no service
restart. The badge switches its single loopback read from `/api/state` to the
shipped combined `/api/hosts` on its local instance (which already fans out to the
peers), so its glyph reflects the most-constrained window across **all** monitored
machines and its dropdown carries one honest section per host. The watched-host
list becomes runtime-mutable and persisted via a **local config file** that the
interval poller re-reads each tick; the badge edits that file **locally** (a
SwiftBar action → native `osascript` input dialog → sanitize → atomic file write)
— never over HTTP, so the dashboard's serve-only/405 posture is preserved. The
first-class new shape is a **monitoring station**: a Mac that runs the badge but
does no Claude/Codex work itself, watching only its remote peers, with its empty
local reading de-emphasized rather than dominating the glance.

### What this PRD hands to Stage 3 (the Architect)

Two of the three shipped predecessors fixed the plumbing this feature consumes.
The multi-host schema built the poller fan-out, the per-host cache, the hardened
outbound fetch, and `GET /api/hosts`; the menu-bar-badge schema built the badge as
a pure `/api/state` consumer, delivered via a marker-gated wrapper. This feature is
the deferred multi-host-badge follow-on, **plus** two conscious expansions the
brief records: (a) the badge gains a **local config-write capability** (a
deliberate shift from its founded read-only design, scoped to a local file write —
no HTTP write, no dashboard mutation), and (b) a machine can be a **pure monitoring
station**. Both are noted for the record; neither requires editing
`product-brief.md`, though a one-line note there acknowledging the badge's new
local-config capability is flagged for the user.

This PRD pins the requirements and tags the **one genuinely open technical
question** — the feasibility of an `osascript` input dialog launched from a
SwiftBar dropdown action — as a **Stage-3 spike** with a named success signal and a
concrete fallback, so the config-edit affordance ships regardless of the outcome.

### The wire contract the badge consumes (authoritative field names)

The badge reads its **local** instance's combined view, already served and shaped
by `src/host-cache.js` `getCombined()` and normalized by `src/hosts.js`
`normalizePeerState()`. Every field is named exactly as those modules emit it:

```
GET http://127.0.0.1:<port>/api/hosts  →
{ hosts: [ HostReading, … ], generatedAt }

HostReading = {
  host,               // sanitized host string (identity / poll target)
  label,              // operator label (free-form → escape at render); local default "This machine"
  port,               // resolved port (number)
  self,               // true for the local host (in-process reading, never HTTP)
  reachable,          // false ⇒ this host's fetch failed; see hostDiagnostic
  hostDiagnostic: null | { reason: 'peer-unreachable'|'peer-error', cause, detail? },
  fetchedAt,          // ISO — when this host's cache entry was last refreshed/attempted
  pending?,           // true when seeded but not yet polled (health readout distinguishes it)
  state: null | { tools:[…], headroom, generatedAt }   // the peer's /api/state shape, normalized
}
```

`state.tools[]` is the exact `/api/state` shape the badge already parses today
(`source`, `label`, `plan`, `haveLimits`, `limits.{five_hour,seven_day}`,
`projection`, `activity`, `freshness`, `limitsDiagnostic`, `dataAt`). Window keys
on the wire are `five_hour` / `seven_day`; display labels are "5-hour" / "Weekly".
`remainingPct` is already clamped 0–100 server-side, timestamps already normalized
to canonical ISO, every peer field already normalized/clamped at ingest. The badge
treats `hosts[]` as **data** — escape every free-form field at render (the existing
`sanitize()` discipline), recompute no limits.

---

## User Stories

> **US-01** — As someone who codes across several tailnet machines, I want the
> menu-bar badge to watch **all** of them at once — one glyph showing the most-
> constrained window across every monitored machine, and a dropdown with a section
> per machine — so that "all your usage in one glance" holds across machines and I
> stop reading one badge per host.

> **US-02** — As the operator of a monitoring station (a Mac that's always on and
> in front of me), I want to **add a monitored host by hostname or IP straight from
> the badge dropdown**, and remove one, and see it take effect on the next poller
> tick — so that changing what I watch is a two-click menu action, not a plist edit
> plus a service restart.

> **US-03** — As that operator, I want a hostname/IP I type to be **validated and
> sanitized before it enters the config file, the fetch target, or any rendered
> line** — and a malformed entry rejected with an honest dialog message, never
> silently accepted or fabricated into a reading — so the config-edit affordance
> can't smuggle a bad value into a security-relevant surface.

> **US-04** — As someone running the badge on a machine that does **no** local
> Claude/Codex work, I want that machine's empty local reading **de-emphasized** —
> excluded from the glyph and the dropdown headline — while still honestly labeled
> ("no local activity") and never fabricated into zeros, so the machines I'm
> actually watching are the loudest thing on the badge, not the empty host in front
> of me.

> **US-05** — As someone who trusts this tool because it's honest, I want an
> **unreachable or offline monitored host named in the dropdown** (never a stale-
> as-fresh number, never a fabricated zero) and each host's freshness/diagnostic
> state shown per host, so no machine is silently dropped and the five-state honesty
> model I already trust applies to every host.

> **US-06** — As the owner of a serve-only tailnet tool, I want config edits to
> happen via a **local file the badge writes and the poller re-reads** — never a
> new HTTP write endpoint on the tailnet-exposed bind — so the dashboard stays
> read-only (405 for non-GET/HEAD), no new attack surface appears, and the change
> still applies at runtime without a restart.

> **US-07** — As someone with a single-machine setup, I want an **unconfigured
> badge to behave exactly as it does today** — one host, no host chrome, the same
> glyph and dropdown — so this feature costs me nothing until I actually add a
> second machine.

---

## Functional Requirements

### The runtime-mutable, persisted host-config file (the core new mechanism)

> **FR-01 — A persisted local config file is the runtime host-list layer.** The
> app shall read the watched-host list from a **persisted local file under the data
> dir** (`config.dataDir`; the Architect picks the exact path and format, but it
> shall be **human-readable**, safe to **append/remove a single host** without
> rewriting unrelated entries, and **written atomically**). The file's entries
> shall use the **same per-entry grammar** the existing `LLMDASH_HOSTS` parser
> accepts (`host[:port][=label]`), so one parser serves both surfaces. Where the
> file exists, it is the **runtime source of truth** for the remote-host set.

> **FR-02 — `LLMDASH_HOSTS` becomes a startup seed/override with defined, testable
> precedence.** `LLMDASH_HOSTS` shall no longer be the sole host source; it becomes
> a **startup seed**. The **default precedence** (the Architect confirms or
> overrides with justification, but this is the shipped default and it shall be
> testable): **the config file, once it exists, is the runtime source of truth for
> the remote-host set; `LLMDASH_HOSTS`, when the file is absent, initializes (seeds)
> the file on first run.** There shall be **no dead knob**: with neither the file
> nor `LLMDASH_HOSTS` set, behavior is **byte-for-byte today's single-host install**
> (local host only, no peers, no outbound fetch); the env seed and the file each
> drive real behavior, and the precedence is stated honestly in the README and the
> startup log.

> **FR-03 — The poller re-reads the file each tick and reconciles the host set at
> runtime.** On each interval-poller tick (`src/poller.js` `pollOnce()`, the same
> tick that already re-runs `parseHosts()`, `seedOrder()`, and `retainHosts()`),
> the app shall **re-read the config file** and reconcile the effective host set:
> - A host **added** to the file shall appear in the combined view and be polled
>   **on the next tick** (no restart).
> - A host **removed** from the file shall have its cache entry **cleaned via
>   `retainHosts`** on the next tick — the **same observable outcome as a restart**
>   — and shall no longer appear in the view or be polled.
> The runtime-apply plumbing already exists (the per-tick `parseHosts` +
> `retainHosts` reconciliation); this requirement makes the file its input.

> **FR-04 — A malformed or unreadable config file degrades honestly, never
> crashes.** A config file that is **corrupt, malformed, or unreadable** shall
> **not crash the poller**: the app shall fall back to the **env seed (or the last
> good in-memory host set)**, **log the failure once** (not every tick), and surface
> it in the startup/health readout. A **malformed individual entry** within an
> otherwise-readable file shall be recorded in `errors[]` and surfaced honestly (the
> existing `parseHosts` errors path), **never silently dropped and never fabricated
> into a reading**.

> **FR-05 — Every host entering the file is sanitized at the door.** Every hostname/
> IP and port that enters the config file — whether typed via the badge, seeded
> from `LLMDASH_HOSTS`, or edited by hand — shall be **validated and sanitized**
> with the `sanitizeHostPort` discipline (strip whitespace and metacharacters; the
> badge's fixed-Low class) **before** it is written, before it becomes a fetch
> target, and before it reaches any rendered or logged surface. A host that is empty
> after sanitize, or a present-but-invalid port, is a **malformed entry** (honest
> error), never a silent coercion.

### The badge consumes `/api/hosts` (the multi-host badge)

> **FR-06 — The badge reads its local `/api/hosts` over loopback.** The badge shall
> switch its single read from `GET /api/state` to **`GET /api/hosts`** on its
> **local** instance over loopback (the primary machine is the one polling the
> remotes; the badge issues **no** outbound fetch of its own to any remote host).
> The badge remains a **pure consumer**: it recomputes no limits and opens no second
> data path — it renders the already-fanned-out combined view. `LLMDASH_BADGE_HOST`
> / `LLMDASH_PORT` still point the badge at whichever instance serves it (default
> loopback).

> **FR-07 — The glyph is the most-constrained window across all monitored hosts.**
> The badge's glyph number shall be the **floor of the minimum `remainingPct` across
> every host × tool × window that has a reading** — extending the existing
> `computeBadge` "min remaining across windows" logic by a **host axis**. A maxed
> window (`remainingPct <= 0`) is a valid binding constraint and reads "limit
> reached." Hosts/windows with no reading are excluded from the min (never counted
> as 0). The glyph's governing freshness band shall be the binding host's tool band
> (falling back to the freshest-applicable band when the binding tool has none, as
> today).

> **FR-08 — The glyph names the binding host (a host cue) alongside the tool cue.**
> When more than the local host is monitored, the glyph and the dropdown headline
> shall name the **binding host** (a short host cue) **alongside** the existing
> binding-tool cue (C = Claude, X = Codex), so the glance says *which machine* and
> *which tool* is the constraint. The exact host-cue treatment (abbreviation, glyph
> composition) is the Designer's within this model; the **observable requirement** is
> that the binding host is identifiable from the glyph/headline in multi-host mode.

> **FR-09 — The dropdown carries one section per host.** The dropdown shall render
> **one section per monitored host**, each with the host's escaped **label**, its
> **per-host freshness/offline state**, and the **existing per-tool rows** (5-hour /
> Weekly, "not available" / "limit reached" / "N% · resets …") the badge renders
> today. The existing **five honesty states** (fresh / aging / stale / no-reading /
> offline) shall apply **per host**. One host aging/offline shall not flag or
> suppress another host's section.

> **FR-10 — Offline/unreachable hosts are named honestly per host.** A host whose
> `HostReading.reachable` is false (or whose `state` is null) shall be rendered in
> the dropdown with a **named offline/error line** carrying **which host and why**
> (from `hostDiagnostic.reason`/`cause`, mapped by **own-key lookup** with `detail`
> sanitized) — **never** a fabricated zero, **never** a stale-as-fresh number, and
> **never** silently dropped. This mirrors the multi-host offline-only treatment
> (`state:null` on failure, no last-known meter shown as fresh).

> **FR-11 — Every peer field is escaped/sanitized at render.** Every free-form field
> from `/api/hosts` (host label, tool label, diagnostic `detail`) shall pass through
> the badge's `sanitize()` (strip `|`, `\r`, `\n`) before it touches a SwiftBar line;
> host/port values on any `href=`/URL surface shall pass through `sanitizeHostPort`.
> No `/api/hosts` field shall be interpolated raw into a line or a param.

> **FR-12 — The badge keeps the `/api/hosts` contract via a parity/contract check.**
> The badge depends on the exact `/api/hosts` field names (`hosts[]`, `HostReading`
> fields, the nested `state` `/api/state` shape). A **fixture-based contract test**
> shall assert the badge parses the shipped `/api/hosts` shape, so a future field
> rename cannot **silently** break the badge into offline/odd states. If the badge
> appears to need a `/api/hosts` field change, that is a flag to raise, not a silent
> coupling. (Extends the badge's existing helper-parity guard against
> `public/app.js`.)

> **FR-13 — Unconfigured / single-host = today's badge, exactly.** When only the
> local host is present (no config file with peers, `LLMDASH_HOSTS` unset), the badge
> shall behave **exactly as today**: one host, **no** host chrome, **no** host cue
> beyond nothing, the same glyph and dropdown as the shipped single-host badge. The
> multi-host presentation (host sections, host cue) shall engage **only** when more
> than the local host is monitored.

### Local-file edit from the menu bar (the headline UX) — [OSA]

> **FR-14 [OSA] — Add / Remove / List host actions in the dropdown.** The badge
> dropdown shall carry **config-edit actions**: **Add host…** (collect a
> `host[:port][=label]` string), **Remove host…** (pick or confirm a host to
> remove), and a **listing of the currently monitored hosts**. Each action runs a
> **local helper** (a SwiftBar `bash=`/`shell=` dropdown action) on the **same
> machine**; **no HTTP mutation** is involved. (Tagged **[OSA]** — the exact
> input-collection mechanism depends on the Stage-3 spike, SPIKE-01. The action set
> and its local-file-write outcome are the requirement; the input mechanism has a
> defined fallback.)

> **FR-15 [OSA] — Add host: collect → sanitize → validate → atomic append.** The
> **Add host…** action shall collect a hostname/IP (with optional `:port` and
> `=label`), **sanitize** it (`sanitizeHostPort`, FR-05), **validate** it against the
> same per-entry rules `parseHosts` enforces, and — only if valid — **append** it to
> the config file via an **atomic, local write**. A **malformed entry shall be
> rejected with an honest dialog/message** naming what was wrong, and shall **never**
> be written. A duplicate `host:port` shall be **deduped** (not appended twice),
> honestly reported ("already monitored").

> **FR-16 [OSA] — Remove host: pick/confirm → remove from the file (atomic).** The
> **Remove host…** action shall let the operator identify a currently-monitored host
> and, on confirmation, **remove that entry** from the config file via an atomic
> local write. Removing the **local host** shall not be offered (it is always
> present, FR-02). Removing a host **mid-fetch** shall not crash the poller; its
> cache entry is cleaned on the next tick (FR-03, FR-19).

> **FR-17 — After a write, the badge refreshes and the change applies next tick.**
> After any config-file write, the badge shall **refresh** (SwiftBar `refresh=true`)
> so the dropdown reflects the new host list, and the actual monitoring change shall
> **take effect on the next poller tick** (FR-03) — no restart. The badge shall not
> claim the change is live before the poller has re-read the file; honest copy states
> the change applies "on the next update."

> **FR-18 — Config-edit copy is honest and explicit.** The config-edit actions shall
> use honest, explicit copy. Pinned strings (the Designer refines wording/visuals,
> but the **honesty + validation behavior is pinned**):
> - Add prompt: *"Add a host to watch — hostname or IP, optionally `:port` and
>   `=label` (e.g. `100.64.0.7:8788=Desktop`)."*
> - Invalid entry: *"That doesn't look like a valid host — nothing was added.
>   Expected `host[:port][=label]`."* (names the reason; nothing written)
> - Duplicate: *"That host is already being watched."*
> - Remove confirm: *"Stop watching `<label>` (`<host:port>`)?"*
> - Write failure (FR-20): *"Couldn't save the host list — `<reason>`. Nothing
>   changed."*
> - Post-write: *"Added `<host>` — it'll appear on the next update."*

### Monitoring-station handling

> **FR-19 — Empty-local-with-remotes de-emphasizes the local host (auto-detect
> default).** When the **local host has no readings** (its tools all report no
> limit reading / no activity) **and ≥1 remote host is configured**, the app shall
> **de-emphasize or exclude the local host from the glyph and the dropdown
> headline** — so the empty local reading does not dominate the glance. The
> **shipped default is auto-detect** (empty-local + remotes-present → de-emphasize);
> an **explicit config flag** (a `LLMDASH_*` env or a config-file setting the
> Architect names) is the **override** for operators who want to force-include or
> force-exclude the local host. Both are pinned; auto-detect ships as the default.

> **FR-20 — The empty local reading is retained and honestly labeled, never
> fabricated.** Even when de-emphasized (FR-19), the local host's empty state shall
> be **retained and available in the dropdown**, honestly labeled (e.g. **"no local
> activity"** / "this machine — no reading"), and shall **never** be rendered as
> fabricated zeros and **never** silently dropped. De-emphasis changes **prominence**
> (out of the glyph/headline), not **honesty** (the state is still shown, still
> true).

### Disclosure

> **FR-21 — The config-file mechanism and precedence are disclosed.** Per the
> "surface environmental/security defaults, never silently" convention, the app
> shall disclose: in the **README**, the config-file path and format, the
> file-vs-`LLMDASH_HOSTS` precedence (FR-02), the local-host-always-included rule,
> the badge's config-edit affordance, and the **serve-only/local-file-write posture**
> (no HTTP mutation); in the **startup log**, which host source is in effect (file /
> env seed / neither) and the effective host set; and in **`src/health.js`
> `healthLines()`**, a line naming the config-file state (present / missing / seeded
> from env / malformed) and the fix — a cheap fs check, off the request path,
> extending the existing per-peer health lines.

---

## Non-Functional Requirements

> **NFR-01 — HTTP surface stays read-only (serve-only / 405).** No new HTTP write
> or config-mutation endpoint shall be introduced. Config edits happen **only** via
> the local file the badge writes and the poller re-reads. All HTTP responses
> (including `/api/hosts`) shall keep the **baseline security headers** (`nosniff`,
> CSP `default-src 'self'` / `style-src 'unsafe-inline'` / `script-src 'self'`,
> `Referrer-Policy`), reject **non-GET/HEAD with 405** (`allow: GET, HEAD`), and
> serve static assets `no-store`. The tailnet-exposed `0.0.0.0` bind gains **no**
> write surface.

> **NFR-02 — Security · config-edit + input-sanitization posture (for the Auditor).**
> The config-edit path is a new local-write surface; the following are required:
> - **Sanitize before use, everywhere.** Every entered hostname/IP/port is
>   `sanitizeHostPort`-scrubbed **before** it enters the file, the outbound fetch
>   target, or any rendered/logged surface (FR-05). A malformed entry is an honest
>   rejection, never a coercion or a fabricated reading.
> - **Local, atomic, user-owned write.** The config file is written **atomically**
>   (temp + rename, never a partial file) by the **user-owned badge process on the
>   same machine** — **no network write**, no privileged path, under the data dir.
> - **No new outbound surface.** The badge issues **no** outbound fetch to any
>   remote host (FR-06); llmdash still does the fan-out. The existing hardened peer
>   fetch (configured-hosts-only, credential-free `GET /api/state`, no
>   redirect-follow, bounded timeout + body cap, every field clamped/normalized/
>   escaped) is **unchanged** — this feature adds no host to the fetch set except
>   via the sanitized config file.
> - **`osascript` is macOS-native** (no new dependency). Any string passed to
>   `osascript` or a shell helper is sanitized first (FR-05); no entered value is
>   interpolated unescaped into a shell command or an AppleScript string.

> **NFR-03 — Zero runtime dependencies / no build / Node 24+ / macOS-native.**
> The badge, the config-file read/write, and the `/api/hosts` consumption shall use
> **Node builtins only** (`node:http`, `node:fs`) plus **macOS-native `osascript`**
> for the input dialog — **no** npm runtime dependency, **no** build step.
> `package.json` runtime dependencies stay at **zero**. The config-edit affordance
> is macOS-native (SwiftBar + `osascript` + launchd), matching where the badge lives;
> no Linux/Windows config UI is in scope.

> **NFR-04 — Request-path isolation preserved.** The config-file read happens on the
> **interval poller** (FR-03), never on the HTTP request path; `/api/hosts` stays a
> **pure cache read** (`getCombined`) with no fetch/subprocess/blocking I/O. The
> config-file write happens in the **badge process** (out of the server entirely).
> The server's request path gains no new work.

> **NFR-05 — Honesty (product-core, non-negotiable).** Per host and per tool, the
> badge shall never present a stale/aging reading as fresh, never fabricate a number
> (or a zero) where a host has no reading or is unreachable (FR-10, FR-20), name the
> binding host/tool honestly (FR-07/FR-08), and reject a malformed config entry with
> an honest message rather than silently accepting or coercing it (FR-15/FR-18). The
> monitoring-station de-emphasis (FR-19) changes prominence, never truth.

> **NFR-06 — Delivery model preserved.** The badge shall keep the shipped
> **wrapper-delivery + absolute-node** install model (a marker-gated generated
> wrapper in SwiftBar's plugin dir that execs an absolute node against the
> **tracked** plugin; the tracked source is never rewritten, so `git pull` /
> installer re-run stays clean; `--remove-badge` reverses it symmetrically, deleting
> only a marker-carrying wrapper). Any new helper the config-edit actions require
> shall live in the **tracked** plugin/scripts, delivered by the same non-dirtying
> model. SwiftBar stays a **disclosed user prerequisite**, never auto-installed.

---

## Out of Scope

- **Any new HTTP write endpoint / dashboard config mutation over the network.**
  Config edits happen via the local file the badge writes and the poller re-reads
  — never a POST to the `0.0.0.0` surface. The 405/serve-only posture is preserved
  (NFR-01). Whether the *dashboard* should also gain host-editing later is a
  separate future question, flagged, not built here.
- **Discovery / auto-enumeration of hosts.** Hosts remain the operator's
  explicitly-configured set; no scanning, no host derived from a payload (preserves
  the no-transitive-fan-out, configured-hosts-only posture).
- **Persisting peer *readings*.** Multi-host stays cached-only; this feature changes
  only the *host list*'s persistence (a new file), not peer *readings* (still
  in-memory, still refilled each tick). No cross-host history store.
- **The badge polling remotes itself / becoming a second aggregator.** The badge
  reads its local instance's `/api/hosts`; llmdash does the fan-out. The badge opens
  no outbound connection to any remote machine.
- **Cross-platform config UI.** The edit affordance is macOS-native (SwiftBar +
  `osascript` + launchd). No Linux/Windows config UI.
- **Limit alerts / notifications across hosts.** A separate roadmap item built on
  the same plumbing; not this feature.
- **Changing the shipped `/api/hosts` or `/api/state` contract's existing fields,
  the hardened peer-fetch posture, the freshness thresholds/bands, or the existing
  diagnostic reason codes.** The badge consumes `/api/hosts` unchanged; a contract
  test guards it (FR-12). New copy for config-edit and monitoring-station states is
  additive.
- **Editing peer *readings* or pushing config to peers.** No control plane; the
  badge edits only the **local** instance's host list.

---

## Open Questions

> **SPIKE-01 [OSA] — Is an `osascript` input dialog reliably launchable from a
> SwiftBar dropdown `bash=` action?** The headline UX (FR-14/FR-15/FR-16) assumes a
> SwiftBar dropdown action can (a) launch an `osascript` `display dialog` that
> captures a typed hostname/IP, and (b) run a helper that writes the config file —
> reliably, with `terminal=false` so no terminal window flashes, and `refresh=true`
> so the badge updates after. **This is the one genuinely open technical question and
> is tagged for a Stage-3 spike.**
> - **What to resolve:** the exact SwiftBar action syntax (`bash=`/`shell=` + args +
>   `terminal=false` + `refresh=true`), whether the spawned process can invoke
>   `osascript display dialog … default answer ""`, capture the typed value, and pass
>   it to a helper that appends to / removes from the config file — from within a
>   SwiftBar-spawned context (launchd/`open`-parented, possibly without a controlling
>   TTY or full user session env).
> - **Success signal + evidence:** a scratch SwiftBar plugin whose dropdown action
>   pops the dialog, and a captured value round-trips through `sanitizeHostPort` into
>   a written config file, verified by reading the file back — recorded in a
>   `spike-report.md` (the house discipline).
> - **Fallback if `osascript`-from-SwiftBar proves unreliable (feature still ships):**
>   the config-edit action instead **opens the config file directly** (SwiftBar
>   `href=`/`open`-style action to the file under the data dir, so the operator edits
>   it in their editor) **and/or** runs a **helper script** that performs the
>   add/remove non-interactively (e.g. an "Add host…" action that opens a small
>   documented editor flow), **and/or** the dropdown shows an **instructions pane**
>   naming the file path and the `host[:port][=label]` format. In every fallback the
>   file remains the runtime source of truth (FR-01), the poller still re-reads it
>   (FR-03), and edits still apply next tick with no restart — the runtime-config
>   mechanism is **independent of** the input-dialog mechanism, so the feature's core
>   value (live, restart-free host config) ships regardless.
>
> **Default assumption pending the spike:** proceed as if the `osascript`-from-
> SwiftBar dialog works (the primary FR-14/15/16 path); the Architect confirms at
> Stage 3 and adopts the fallback if the spike refutes it.

> **OQ-02 — Config-file path and format.**
> **Default assumption:** a human-readable file under `config.dataDir` (alongside
> `claude-ratelimits.json` / `llmdash.db`), entries in the existing
> `host[:port][=label]` grammar (one per line or a small JSON array — the Architect
> picks, optimizing for append/remove-safe atomic writes and one shared parser with
> `LLMDASH_HOSTS`). It shall be documented (FR-21) and outside any git checkout (the
> data dir already is).

> **OQ-03 — File-vs-env precedence exact rule.**
> **Default assumption (FR-02):** the file, once it exists, is the runtime source of
> truth; `LLMDASH_HOSTS` seeds the file on first run when the file is absent. The
> Architect confirms or overrides (e.g. a documented merge) with justification, and
> the shipped rule shall be **testable** and stated honestly. Neither set = today's
> single-host behavior (no dead knob).

> **OQ-04 — Monitoring-station override flag name/shape.**
> **Default assumption (FR-19):** auto-detect (empty-local + remotes-present →
> de-emphasize) ships as the default; an explicit override (a `LLMDASH_*` env or a
> config-file setting) lets the operator force-include or force-exclude the local
> host. The Architect names the flag and confirms it's a real knob (no dead knob).
> **The de-emphasis presentation and the auto-detect default are flagged for the
> user to ratify at the Designer stage.**

> **OQ-05 — Host-cue treatment in the glyph.**
> **Default assumption:** the glyph names the binding host alongside the C/X tool cue
> (FR-08); the exact abbreviation/composition (short label, initial, truncation) is
> the **Designer's**, kept **xbar-safe** (text/emoji + `color=`, never dependent on a
> SwiftBar-only param), consistent with the shipped five-state glyph grammar.

> **OQ-06 — Concurrent badge edits.**
> **Default assumption:** the atomic write (temp + rename) makes concurrent edits
> **last-write-wins** without corruption; a lost concurrent add is acceptable and
> honest (the badge refreshes and shows the current file). The Architect confirms no
> partial file is ever observable and decides whether any lightweight lock is worth
> it (default: no lock, atomic rename suffices for a single-user tool).

---

## Success Metrics

Every functional requirement maps to at least one QA check. **[OSA]** rows are
verified against whichever input mechanism Stage 3's spike (SPIKE-01) settles on
(the primary `osascript` path or the named fallback); the file-write **outcome** and
its **runtime apply** are verified regardless. Logic is exercised by pure/injectable
tests over `/api/hosts` fixtures and a scratch config file — no live tailnet peer or
real menu bar needed for the Stage-6 logic checks (the live in-menu-bar render and
the real `osascript` dialog are deploy-time captures, per the badge's shipped
deferral).

| ID | What's Being Verified | Pass Condition |
|---|---|---|
| QA-01 | Config file is the runtime host layer (FR-01) | A persisted file under the data dir, in the `host[:port][=label]` grammar, is read as the remote-host set; it is human-readable and edited via atomic writes. Its entries parse through the same parser as `LLMDASH_HOSTS`. |
| QA-02 | File-vs-env precedence + no dead knob (FR-02) | With the file present, it is the runtime source of truth; with the file absent and `LLMDASH_HOSTS` set, the env seed initializes the file; with **neither** set, behavior is byte-for-byte today's single-host install (local host only, no peers, no outbound fetch). The precedence is testable and matches the documented default. |
| QA-03 | Poller re-reads file + reconciles at runtime (FR-03) | Adding a host to the file makes it appear in `/api/hosts` and be polled on the **next tick** (no restart); removing a host cleans its cache entry via `retainHosts` on the next tick (same outcome as a restart) and it no longer appears or is polled. |
| QA-04 | Malformed/unreadable file degrades honestly (FR-04) | A corrupt/unreadable file does **not** crash the poller — the app falls back to the env seed / last-good set, logs the failure **once**, and surfaces it in health. A malformed single entry lands in `errors[]` and is surfaced honestly, never dropped or fabricated. |
| QA-05 | Sanitize at the door (FR-05, NFR-02) | A host/port with whitespace or metacharacters is `sanitizeHostPort`-scrubbed before it is written, before it becomes a fetch target, and before any rendered/logged surface; an empty-after-sanitize host or invalid port is an honest error, never coerced. |
| QA-06 | Badge reads local `/api/hosts` over loopback (FR-06) | The badge fetches `GET /api/hosts` on its configured local instance (default loopback), issues **no** outbound fetch to any remote host, and recomputes no limits (pure consumer). |
| QA-07 | Glyph = most-constrained across all hosts (FR-07) | Given a multi-host `/api/hosts` fixture, the glyph number is `floor(min remainingPct)` across every host × tool × window with a reading; a maxed window binds as "limit reached"; no-reading hosts/windows are excluded from the min (never 0); the governing band is the binding host's. |
| QA-08 | Binding host named in the glyph (FR-08) | In multi-host mode, the glyph/headline names the binding **host** (a host cue) alongside the C/X tool cue; the binding machine + tool + window are identifiable from the glance. |
| QA-09 | Dropdown: one section per host, five states per host (FR-09) | The dropdown renders one section per monitored host with the escaped label, per-host freshness/offline state, and the existing per-tool rows; the five honesty states apply per host; one host's degraded state does not flag or suppress another's. |
| QA-10 | Offline hosts named, never fabricated (FR-10, NFR-05) | A host with `reachable:false` / `state:null` shows a named offline/error line (which host + why, from `hostDiagnostic` via own-key lookup, `detail` sanitized) — never a fabricated zero, never stale-as-fresh, never silently dropped. |
| QA-11 | Peer fields escaped/sanitized at render (FR-11, NFR-02) | Every free-form `/api/hosts` field (host/tool label, diagnostic `detail`) passes through `sanitize()` before a SwiftBar line; host/port on any href/URL passes through `sanitizeHostPort`; no field is interpolated raw. A hostile label containing `|`/newlines cannot break the line grammar. |
| QA-12 | `/api/hosts` contract guard (FR-12) | A fixture-based contract test asserts the badge parses the shipped `/api/hosts` shape (`hosts[]`, `HostReading` fields, nested `state`); a renamed/removed field is caught by the test rather than silently degrading the badge to offline. |
| QA-13 | Single-host/unconfigured = today's badge (FR-13, NFR-05) | With only the local host present, the badge is byte-for-byte today's single-host badge: one host, no host chrome, no host cue, the same glyph and dropdown. Multi-host chrome engages only when >1 host is monitored. |
| QA-14 | Add/Remove/List actions present (FR-14) [OSA] | The dropdown carries Add host…, Remove host…, and a current-host listing; each runs a local helper on the same machine with **no** HTTP mutation. (Verified against the spike-settled mechanism.) |
| QA-15 | Add: sanitize → validate → atomic append, reject malformed (FR-15) [OSA] | A valid `host[:port][=label]` entered via Add is sanitized, validated, and atomically appended to the file; a malformed entry is rejected with an honest message and **never** written; a duplicate `host:port` is deduped and honestly reported. |
| QA-16 | Remove: pick/confirm → atomic remove, mid-fetch safe (FR-16) [OSA] | Remove host… removes the chosen entry from the file via an atomic write; the local host is never offered for removal; removing a host mid-fetch does not crash the poller (its cache entry cleans next tick). |
| QA-17 | Post-write refresh + next-tick apply (FR-17) | After a config write, the badge refreshes (dropdown reflects the new list) and the monitoring change takes effect on the next poller tick — no restart; copy states the change applies "on the next update," never claiming it is live before the poller re-reads. |
| QA-18 | Config-edit copy is honest + validating (FR-18) | The Add/invalid/duplicate/remove-confirm/write-failure/post-write strings are present and honest; an invalid entry names the reason and writes nothing; a write failure states nothing changed. |
| QA-19 | Monitoring-station de-emphasis, auto-detect default (FR-19) | With the local host empty and ≥1 remote configured, the local host is excluded from the glyph and the dropdown headline by default (auto-detect); the explicit override flag can force-include or force-exclude it (a real knob, no dead knob). |
| QA-20 | Empty local retained + honestly labeled, never fabricated (FR-20, NFR-05) | Even when de-emphasized, the empty local host remains in the dropdown, honestly labeled ("no local activity"), never rendered as zeros and never silently dropped; de-emphasis changes prominence, not the shown truth. |
| QA-21 | Disclosure (FR-21) | The README documents the config-file path/format, the file-vs-env precedence, the local-host-always-included rule, the config-edit affordance, and the serve-only/local-write posture; the startup log states the effective host source + set; `healthLines()` names the config-file state (present/missing/seeded/malformed) and the fix. |
| QA-22 | HTTP stays read-only / 405 (NFR-01) | No new HTTP write/mutation endpoint exists; `/api/hosts` and all responses carry the baseline headers, reject non-GET/HEAD with 405 (`allow: GET, HEAD`), and static assets stay `no-store`; the `0.0.0.0` bind gains no write surface. |
| QA-23 | Config-edit security posture (NFR-02) | Every entered host/IP/port is sanitized before file/fetch/render (QA-05); the file write is atomic (temp+rename, no partial file ever observable) and local/user-owned (no network write); no entered value is interpolated unescaped into a shell command or AppleScript string. |
| QA-24 | Outbound-fetch posture unchanged (NFR-02) | The badge issues no outbound fetch to any remote (QA-06); the existing hardened peer fetch (configured-hosts-only, credential-free `GET /api/state`, no redirect-follow, bounded timeout + body cap, every field clamped/normalized/escaped) is unchanged; a host reaches the fetch set only via the sanitized config file. |
| QA-25 | Zero deps / no build / macOS-native (NFR-03) | `package.json` runtime dependencies remain zero; no build step is added; the badge, file I/O, and `/api/hosts` consumption use Node builtins (`node:http`, `node:fs`) + macOS-native `osascript` only. |
| QA-26 | Request-path isolation preserved (NFR-04) | The config-file read is on the interval poller (never the request path); `/api/hosts` is a pure `getCombined()` cache read (no fetch/subprocess/blocking I/O); the config write is in the badge process, out of the server; the server request path gains no new work. |
| QA-27 | Delivery model preserved (NFR-06) | Any new config-edit helper lives in the tracked plugin/scripts, delivered by the marker-gated wrapper/absolute-node model (tracked source not rewritten; `git pull`/re-run stays clean; `--remove-badge` reverses symmetrically); SwiftBar stays a disclosed prerequisite, never auto-installed. |
| QA-28 | Concurrent edits are safe (OQ-06) | Two overlapping config writes never produce a partial/corrupt file (atomic rename); the outcome is last-write-wins, honestly reflected after refresh. |
