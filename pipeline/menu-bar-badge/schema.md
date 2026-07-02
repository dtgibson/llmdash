# Schema / System Design — menu-bar-badge
**Feature:** menu-bar-badge
**Date:** 2026-07-02
**Stage:** 3 — The Architect
**Path:** Incremental (prior schemas exist; **no tables, no columns, no migration**)
**Branch:** [SB] SwiftBar as the documented default per `spike-report.md`

---

## Data layer verdict

**No database change. No `/api/state` change. No new data path.** The badge is a
**pure consumer** of the payload `src/server.js` `buildState()` already serves.
This "schema" is a **system design for one new out-of-process client**, not a data
model change. The only contract it depends on is the existing wire shape (field
names below), consumed unmodified (QA-24).

The badge introduces **zero runtime dependencies and no build step** (NFR-01): the
plugin is Node-builtins-only (`node:http`). `package.json` runtime deps stay at 0.

### The contract it consumes (read-only, unchanged)

```
GET http://127.0.0.1:<port>/api/state  →
{ tools: [ {
    source, label, plan, haveLimits,
    limits: { five_hour: null|{usedPct,remainingPct,resetsAt,capturedAt},
              seven_day: null|{...} },        // remainingPct already clamped 0–100 server-side
    freshness: null | { capturedAt, freshForMs, staleAfterMs },   // Codex: null
    limitsDiagnostic: null | { reason, cause?, cmd?, detail?, capturedAt?, ageMs? },
  } ... ],
  generatedAt }
```

Window keys on the wire: `five_hour` / `seven_day`. Display labels: `5-hour` /
`Weekly` (mirror `public/app.js`).

---

## Where the plugin lives (FR-18)

```
scripts/menubar/llmdash.5s.js      # the plugin — Node-builtins-only, no build step
```

- `.5s.` is the host's **interval-in-filename** convention (re-run every 5s;
  OQ-05). Adjust the *number* (`10s`/`15s`) if the cadence proves noisy, never the
  pattern. 5s only governs how often the badge re-reads an already-served cheap
  endpoint; the dashboard's own reading freshness stays server-side.
- The user copies/symlinks this file into SwiftBar's plugin directory and marks it
  executable (README, FR-19).

---

## Modules

| File | Change |
|---|---|
| `scripts/menubar/llmdash.5s.js` | **New.** The whole plugin: config constant → `http.get(/api/state)` → parse → `computeBadge()` → `emit()` SwiftBar format. Node builtins only. |
| `tests/menubar.test.js` (or per house convention) | **New.** Unit tests for the pure functions (`fmtDur`, `ageBand`, `diagLine`, `sanitize`, `computeBadge`, `emit`) fed by `/api/state` fixtures. `node:test`. |
| `tests/fixtures/state-*.json` | **New.** `/api/state`-shaped fixtures: fresh, aging, stale, no-reading, maxed+partial-null, plus non-200/badjson harness inputs. (Spike prototypes in scratchpad are the seed.) |
| `README.md` | **+section** (FR-19): the SwiftBar prerequisite (user-installed, never auto-installed), the one-time plugin install, port config, and the honest offline/freshness reality. |
| `scripts/install-macos.sh` | **Optional** (FR-20, OQ-04): resolve absolute node + bake it into the plugin shebang; optionally symlink into a detected SwiftBar plugin dir. **Never** installs SwiftBar. Prints what it did + what the user must still do. |
| `src/health.js` `healthLines()` | **Optional** (FR-20): one cheap-fs badge line (host present? plugin linked?) in the existing present/missing form. Off the request path. |

**Untouched:** `src/server.js`, `config.js`, `public/*`, the DB, poller, stats.
The badge adds nothing to the request path beyond one ordinary `GET /api/state`
per host tick (NFR-02).

---

## Plugin structure — the fetch → parse → glyph/dropdown pipeline

```
llmdash.5s.js
├─ CONFIG (the config surface)
│    HOST = process.env.LLMDASH_BADGE_HOST || '127.0.0.1'  // default loopback; set to a tailnet host/IP
│    PORT = process.env.LLMDASH_PORT || '8787'   // documented one-line constant, env override optional
│    FETCH_TIMEOUT_MS = 2000                       // a hung fetch must never freeze the menu bar
│    // Ratified 2026-07-02 (Stage 4): HOST is configurable (default localhost), so the badge can
│    // read a dashboard running on ANOTHER tailnet machine — still the same /api/state contract,
│    // never a new/second data source. Multi-host (a host LIST) is a deferred follow-on, not this build.
│
├─ PURE PRESENTATION (copied verbatim from public/app.js — never re-derives limits)
│    fmtDur(ms)        // d h / h m / m ; ≤0 → 'now' ; null → '—'                      (FR-11)
│    ageBand(f)        // server thresholds: age>staleAfterMs→stale, >freshForMs→aging (FR-09)
│    diagLine(d)       // reason → fixed line via own-key hasOwnProperty; else generic (FR-16)
│    sanitize(s)       // strip |, \n, \r — the menu-bar analogue of esc()             (NFR-04)
│
├─ computeBadge(state) → { state, pct|null, dropdown[], diag[] }   // pure, testable
│    glyph number = floor(min remainingPct across ALL windows-with-a-reading)          (FR-07)
│    null window excluded from min; shown 'not available' in dropdown                   (FR-08)
│    band = binding tool's ageBand; if null (Codex) → freshest applicable band          (FR-09)
│
├─ emit(badge, {offline}) → string   // SwiftBar/xbar stdout (host format)
│
└─ main()   // http.get; non-200/timeout/error/bad-JSON → emit offline; parse → emit(computeBadge)
```

**Reuse discipline:** `fmtDur` and `ageBand` are copied **verbatim** from
`public/app.js`, and `diagLine` mirrors `limitsNoteHtml`'s reason-mapping
*semantics* (not its HTML). The plugin performs only presentation math the web
client already performs (FR-05). If the web-client helpers change, the plugin's
copies must move in lockstep — see Test seams for the guard.

---

## The five-state model → stdout mapping (FR-10)

`computeBadge()` returns exactly one `state`; `emit()` maps it to a menu-bar title
line. Glyph symbols/colors are the Designer's call within SwiftBar styling (OQ-03);
the **five-state distinctness and the two never-do rules are the requirement**.
Prototype rendering (proven in `spike-report.md`), text/emoji + `color=` so it is
**xbar-safe too** (glyph honesty never depends on a SwiftBar-only param):

| State | Trigger | Title line (proven) |
|---|---|---|
| **fresh** | binding band = fresh, or Codex-owned (no band) | `◉ 78%` (plain/confident) |
| **aging** | binding band = aging | `◉ 78%· \| color=#a0a0a0` (marked/dim) |
| **stale** | binding band = stale | `◉ 78% ⚠ \| color=#c98a1a` (marked stale) |
| **no-reading** | no window on either tool has a reading | `◉ —` (a dash, **not** a number) |
| **offline/error** | fetch failed / timed out / non-200 / bad JSON | `llmdash ✕ \| color=#8b8b8b` (**never** a number) |

Two never-do rules enforced structurally (NFR-03): (a) an aging/stale reading is
never shown as confidently fresh — the band marks the glyph; (b) no number is ever
emitted in the offline state — `emit(null, {offline:true})` has no number branch.

**Optional SwiftBar polish:** the Designer MAY swap the emoji glyph for an
`sfimage=`/`templateImage=` SF Symbol on SwiftBar; keep a text/emoji fallback so
xbar still distinguishes the states.

---

## The dropdown (FR-11, FR-12, FR-15, FR-16)

`emit()` after the `---` separator, one row per tool × window:

- Tool header line (`Claude Code`, `Codex`) with an `(aging)`/`(stale)` tag when
  its `ageBand` is degraded.
- Each window: `<label>:  <remaining>% · resets <fmtDur>` — or **`not available`**
  when `limits[window]===null` (never `0%`), or **`limit reached · resets …`** when
  `remainingPct<=0` (a maxed window is a valid binding constraint for the glyph).
- A `---`-separated **diagnostics block**: each tool's mapped `diagLine` (fixed
  honest copy; `null` diagnostic → nothing).
- Actions: **`Open dashboard | href=http://127.0.0.1:<port>/`** (FR-15, required).
  **`Refresh | refresh=true`** (optional convenience; drives real behavior — the
  host re-runs the plugin — so it is not a dead item).

---

## Freshness-band + diagnostic-code mapping (reused from the web client)

- **Band** (`ageBand`, verbatim): `age = now − Date.parse(freshness.capturedAt)`;
  `> staleAfterMs`→stale, `> freshForMs`→aging, else fresh. `null` freshness or
  absent `capturedAt` (Codex) → **no band treatment**. Thresholds are
  **server-supplied** on the `freshness` object; never hardcoded (FR-09).
- **Glyph's governing band:** the band of the tool that owns the binding window
  (FR-07). If that tool has no band (Codex, `freshness:null`), fall back to the
  **freshest applicable** tool band (order fresh < aging < stale).
- **Diagnostic codes** → fixed lines, own-key (`hasOwnProperty`) lookup only:

  | reason (enum, from the wire) | tool | dropdown line (semantics from `limitsNoteHtml`) |
  |---|---|---|
  | `auto-refresh-failing` | Claude | "Auto-refresh is failing — open a Claude Code CLI session to refresh manually." |
  | `auto-refresh-disabled` | Claude | "Auto-refresh is off (LLMDASH_CLAUDE_AUTOREFRESH=0) — unset it to re-enable, or open a CLI session." |
  | `stale-reading` | Claude | "Stale reading — the limits may have moved since; open a Claude Code CLI session to refresh." |
  | `no-statusline-reading` | Claude | "No statusline reading yet — open a Claude Code CLI session to capture the first reading." |
  | `codex-cmd-failed` | Codex | "The codex command couldn’t be run — set LLMDASH_CODEX_CMD to the absolute path and restart." (+ sanitized `detail`) |
  | `no-reading` | Codex | "No Codex limit reading yet." |
  | *(unmapped)* | any | generic honest fallback: "Limit reading unavailable." |

  `reason`/`cause` are **never rendered raw** (own-key mapping). Free-form `cmd`/
  `detail` go through `sanitize()` (strip `|`/newlines) before display — the
  menu-bar analogue of `esc()`. FR-17: `stale-reading` coexists with a rendered
  reading — the glyph shows the number *marked stale* AND the note appears; the
  window is flagged, never blanked.

---

## Port / node-resolution design

- **Port (FR-14, OQ-02):** `PORT = process.env.LLMDASH_PORT || '8787'` — a single
  documented one-line constant, env override optional. This is the **only** config
  surface and it drives the fetch URL for real (no dead knob). SwiftBar does not
  reliably pass arbitrary user env to plugins, so the guaranteed surface is the
  README-documented one-line edit; the env var is a bonus when present. Both paths
  proven in the spike.
- **Interpreter (FR-13):** invoke via an **absolute node path baked at install**,
  mirroring how the installer resolves `codex`/`claude` for launchd's minimal
  PATH. Measured: `#!/usr/bin/env node` **fails** under a minimal PATH on this Mac
  (node under nvm) → dead badge; an absolute node path works. Install step:
  `readlink -f "$(command -v node)"` → rewrite the plugin's line-1 shebang to
  `#!/<abs-node>`. An unresolved node is an **install-time failure surfaced with
  the fix** (FR-13), never a silently dead badge. The checked-in file may carry a
  portable `#!/usr/bin/env node` for dev-on-PATH use; the install rewrites it.

---

## Error / degradation handling (FR-06, NFR-05)

`main()` routes every failure to the offline state, never a crash, never a
fabricated number:

```
http.get(HOST:PORT/api/state, timeout=2000)
  res.statusCode !== 200        → emit(offline)
  JSON.parse throws             → emit(offline)
  req 'timeout'                 → req.destroy() → 'error' → emit(offline)
  req 'error' (ECONNREFUSED …)  → emit(offline)
  emit(computeBadge(state)) throws → emit(offline)   // last-resort guard
  else                          → emit(computeBadge(state))
```

A `null` window is the honest **no-reading** case for that window (FR-08), not an
error. A crashing plugin (host shows its own error state) is an acceptable
last resort but never the normal failure path — hence the `try/catch` around
`emit(computeBadge(...))`.

---

## Config / env (no dead knobs)

| Surface | Value | Drives |
|---|---|---|
| `HOST` constant (line-level, README-documented) | `127.0.0.1` default | the fetch URL + the Open-dashboard/href URL |
| `LLMDASH_BADGE_HOST` env (optional override) | when present | same — a tailnet host/IP, overrides the constant |
| `PORT` constant (line-level, README-documented) | `8787` default | the fetch URL + the Open-dashboard/href URL |
| `LLMDASH_PORT` env (optional override) | when present | same — overrides the constant |
| `FETCH_TIMEOUT_MS` | 2000 | the fetch bound (menu-bar responsiveness) |

`HOST` defaults to loopback (the common case: badge and server on the same Mac) but is
**configurable** to a tailnet host/IP so the badge can read a dashboard on another machine
(ratified Stage 4). This is **not** a second data path (FR-04) — it is the same `/api/state`
contract, just possibly on a different host instance; the badge still recomputes nothing.
The host/port also drives the `Open dashboard` href so the link matches what the badge reads.
Multi-host (a host *list* with per-host dropdown + glyph selection) is a **deferred
follow-on**, out of scope for this build.

---

## Disclosure surfaces (FR-19, FR-20)

- **README** (FR-19, prominent, per the "surface prerequisites, never silently"
  convention): SwiftBar is a **user-installed third-party app** — exact one-time
  command `brew install --cask swiftbar`, stated as a prerequisite, **not** an
  llmdash dependency and **never** auto-installed. The one-time plugin install
  (copy/symlink `scripts/menubar/llmdash.5s.js` into SwiftBar's plugin dir, mark
  executable, point SwiftBar at the dir). The port config (the one-line edit / env
  var). The honest reality: the badge shows an **offline** state when the
  dashboard isn't running and reflects the same freshness/diagnostic states as the
  dashboard — it is not a second, independent reading.
- **Installer** (FR-20, optional): MAY bake the absolute node path + symlink the
  plugin into a detected SwiftBar dir; **never** installs SwiftBar; prints exactly
  what it did and what the user must still do. If it touches the plugin, a
  `healthLines()` line MAY note the badge prerequisite (host present? plugin
  linked?) as a cheap fs check, off the request path.

---

## Test seams (Stage-6 QA table)

The plugin is structured so every requirement maps to a **pure-function** test fed
by `/api/state` fixtures — no live server needed for the logic (the spike proved
this with in-isolation assertions).

- **`fmtDur`** — `null`→"—", `≤0`→"now", `d h`/`h m`/`m` (QA-10). Copied from
  `public/app.js`; a guard test asserts parity with the web-client values.
- **`ageBand`** — feed `freshness` objects straddling `freshForMs`/`staleAfterMs`;
  assert fresh/aging/stale; `null`/`{capturedAt:null}`→null (Codex) (QA-08).
- **`diagLine`** — each reason code → its fixed line; unmapped → generic; own-key
  (`hasOwnProperty`) so a `__proto__`/`constructor` reason can't bypass the
  fallback; `detail` with a `|` is sanitized (QA-15, QA-23).
- **`sanitize`** — `|`, `\n`, `\r` → space; the security seam (QA-23, NFR-04).
- **`computeBadge`** — per fixture: fresh→number+fresh; aging/stale→number+band;
  all-null→`no-reading`+`◉ —`; maxed→`0`-binding + "limit reached"; partial-null→
  window "not available" (QA-05, QA-06, QA-07, QA-09, QA-16).
- **`emit`** — assert the exact SwiftBar line grammar (title `| params`, `---`,
  `href=`/`refresh=`); assert no number appears in the offline branch and `◉ —`
  (not a number) in no-reading (QA-09, QA-11, QA-12, QA-22).
- **Fetch/degradation** — a scratch loopback fixture server (the spike's harness)
  fed non-200 / bad-JSON / connection-refused → offline, no crash, exit 0 (QA-05,
  NFR-05). Bounded by `FETCH_TIMEOUT_MS`.
- **Interpreter-under-minimal-PATH** (QA-14) — scripted at Stage 6 on this machine:
  `env -i PATH=/usr/bin:/bin ... <abs-node> plugin.js` renders; `env node` fails —
  reuse the spike's recipe.

## Risks the Engineer inherits

1. **Live in-menu-bar render (FR-02 capture) is deferred to deploy** — gated on the
   user ratifying `brew install --cask swiftbar` at the Designer stage. The
   Engineer builds and unit-proves everything host-independent; the real
   menu-bar screenshot is a deploy-time task, not a Stage-6 blocker.
2. **Node-under-host minimal PATH** — `env node` produces a dead badge (measured).
   The install step MUST resolve+bake an absolute node path and fail loudly if
   node is unresolved. Don't ship a bare-`env node` plugin as the installed artifact.
3. **Helper drift** — `fmtDur`/`ageBand`/diagnostic copy are duplicated from
   `public/app.js` (the plugin can't import browser JS). Keep the guard test that
   asserts parity, or the badge silently diverges from the dashboard's honesty.
4. **Glyph honesty must stay xbar-safe** — don't let the five-state distinctness
   depend on a SwiftBar-only `sfimage`; keep the text/emoji + `color` floor.
5. **Contract coupling** — the badge assumes the exact `/api/state` field names.
   If a future feature renames a field, the badge breaks silently into offline/odd
   states; a fixture-based contract test catches it. The badge must never trigger a
   payload change (QA-24) — if it seems to need one, raise a flag.
