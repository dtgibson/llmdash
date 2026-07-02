# Spike Report — Menu-Bar Badge (host choice + plugin format)
**Feature:** menu-bar-badge
**Date:** 2026-07-02
**Stage:** 3 — The Architect
**Path:** Incremental (prior schemas exist; this feature adds no tables/columns; it is a new client of the existing `/api/state` contract)

---

## BRANCH DECISION — [SB] SwiftBar is the documented default

**SwiftBar ships as the documented default host; xbar is a best-effort note, not
built to parity.** SwiftBar is the actively-maintained, notarized, Swift-native
successor in the BitBar lineage; xbar is the older/broader BitBar successor.
They share the classic BitBar plugin contract (first line = menu-bar title;
`---` separator; dropdown lines; `| key=value` params; `href=`/`bash=`/`refresh=`
actions; `~~~`/`--` submenu nesting), so the plugin's **data logic, five-state
model, and honesty copy are host-agnostic** and would render on either. The
[SB]/[XB] deltas are confined to styling-param names, the plugin-dir path, and
the filename cadence convention (delta table below). Default to SwiftBar per
OQ-01; no concrete reason to prefer xbar surfaced.

**FR-04-style note — live in-menu-bar render is DEFERRED TO DEPLOY.** FR-01/FR-02
ask for a *live install* of the host showing the glyph in the actual menu bar.
That requires `brew install --cask swiftbar`, which is **the one decision the
user must ratify** (strategic brief §Key Decisions) and is surfaced at the
Designer stage — *after* this one. So this spike installed **nothing** (see
Budget below) and instead validated the plugin at the **design level**: it was
built and run against the real local `/api/state` and against crafted
`/api/state`-shaped fixtures, and its stdout was checked line-by-line against the
documented SwiftBar/xbar output contract. **The "does it render in the real menu
bar" check (FR-02 capture evidence) is a deploy-stage task, to be done by the
user once they ratify and install SwiftBar.** Everything that does *not* require
the host — the fetch→parse→emit pipeline, all five states, format correctness,
port/env, and the minimal-PATH node question — is fully proven here with real
captured stdout.

---

## What was and wasn't installed (spike budget)

- **Installed: NOTHING.** No `brew install`, no cask, no change to `/Applications`
  or any menu-bar-host plugin directory. Confirmed before and after: no
  SwiftBar/xbar in `/Applications` or `brew list --cask`.
- **Touched on the system: NOTHING persistent.** The live 8787 dashboard service
  was only read (`GET /api/state`, still returns 200 after the spike). A scratch
  fixture server was bound on loopback ports 5599/5601 and torn down; no orphaned
  processes remain. All prototype/fixture files live in the session scratchpad,
  not the repo.
- **Repo:** only `pipeline/menu-bar-badge/` is added (this report + `schema.md`).

---

## Host environment on the target Mac (the FR-13 crux, measured)

| Fact | Value |
|---|---|
| `node` location | `/Users/developer/.nvm/versions/node/v24.18.0/bin/node` (**nvm** — not a stock system path) |
| `node` version | v24.18.0 (satisfies the `node:sqlite` / Node 24+ floor) |
| `node` on a minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) | **NOT FOUND** |
| Dashboard | running on 8787, `/api/state` → 200 (real payload captured) |
| `LLMDASH_PORT` | unset (default 8787 in effect) |

This machine is the **worst case** for interpreter resolution: node is under nvm,
invisible to any minimal-PATH spawn. That makes the FR-13 answer unambiguous
(below).

---

## Per-question findings — with captured real plugin stdout

The prototype (`llmdash.5s.js`, Node-builtins-only: `require('node:http')`) was
run against the **real running dashboard on 8787** for the fresh state, and
against crafted `/api/state`-shaped fixtures served by a scratch loopback server
for the degraded states — exercising the plugin's real `http.get` path, not just
its pure functions. Output quoted verbatim.

### FR-01/FR-02 — the five states render in valid SwiftBar/xbar format

**STATE 1 — FRESH (real server, live 8787 payload):** glyph = the most-constrained
window (Claude Weekly 46%, below Claude 5-hour 65% and both Codex windows 99%).
Plain/confident, no marking.

```
◉ 46%
---
Claude Code | size=13 color=#888888
5-hour:  65% · resets 3h 44m | font=Menlo
Weekly:  46% · resets 1d 11h | font=Menlo
Codex | size=13 color=#888888
5-hour:  99% · resets 4h 56m | font=Menlo
Weekly:  99% · resets 6d 3h | font=Menlo
---
Open dashboard | href=http://127.0.0.1:8787/
Refresh | refresh=true
```

**STATE 2 — AGING** (Claude reading 7m old; `freshForMs=300000`, so
5m<age<10m → aging band). Number kept, **marked** (dot suffix + dim color), tool
header tagged `(aging)`:

```
◉ 46%· | color=#a0a0a0
---
Claude Code  (aging) | size=13 color=#888888
5-hour:  65% · resets 3h 43m | font=Menlo
Weekly:  46% · resets 1d 10h | font=Menlo
...
```

**STATE 3 — STALE** (Claude reading 30m old → stale band; **plus** a
`stale-reading` diagnostic coexisting with the still-rendered reading, FR-17).
Number kept, marked `⚠` + warn color; the stale note is listed AND the window is
never blanked:

```
◉ 46% ⚠ | color=#c98a1a
---
Claude Code  (stale) | size=13 color=#888888
5-hour:  65% · resets 3h 43m | font=Menlo
Weekly:  46% · resets 1d 10h | font=Menlo
Codex | size=13 color=#888888
5-hour:  99% · resets 4h 55m | font=Menlo
Weekly:  99% · resets 5d 23h | font=Menlo
---
Stale reading — the limits may have moved since; open a Claude Code CLI session to refresh. | size=12 color=#c98a1a
---
Open dashboard | href=http://127.0.0.1:5599/
Refresh | refresh=true
```

**STATE 4 — NO-READING** (both tools, all windows `null`). Glyph = **`◉ —`**
(a dash, NOT a number, NOT `0%`); each window "not available"; per-tool
diagnostics explain why. **Note the security proof:** the fixture injected
`detail: "spawn codex ENOENT | rm -rf /"`; the plugin's `sanitize()` stripped the
`|` to a space so it can neither open a second SwiftBar param nor form a shell
string — rendered as `(spawn codex ENOENT   rm -rf /)`:

```
◉ —
---
Claude Code | size=13 color=#888888
5-hour:  not available | font=Menlo
Weekly:  not available | font=Menlo
Codex | size=13 color=#888888
5-hour:  not available | font=Menlo
Weekly:  not available | font=Menlo
---
No statusline reading yet — open a Claude Code CLI session to capture the first reading. | size=12 color=#c98a1a
The codex command couldn’t be run — set LLMDASH_CODEX_CMD to the absolute path and restart. (spawn codex ENOENT   rm -rf /) | size=12 color=#c98a1a
---
Open dashboard | href=http://127.0.0.1:5599/
Refresh | refresh=true
```

**STATE 5 — OFFLINE/ERROR** — three failure modes, all landing on the same
unmistakable no-number glyph, no crash (exit 0):
- non-200 (500 response),
- malformed JSON body,
- connection refused (nothing listening).

```
llmdash ✕ | color=#8b8b8b
---
Dashboard offline — no server on 127.0.0.1:5601
Open dashboard | href=http://127.0.0.1:5601/
Refresh | refresh=true
```

**BONUS — LIMIT-REACHED + partial-null** (Claude 5-hour maxed at 0% remaining;
Codex weekly `null`). Confirms FR-08 + FR-12: `◉ 0%` is a valid binding glyph, the
maxed row reads "limit reached", and the `null` Codex weekly shows "not available"
— never `0%`:

```
◉ 0%
---
Claude Code | size=13 color=#888888
5-hour:  limit reached · resets 44m | font=Menlo
Weekly:  46% · resets 1d 10h | font=Menlo
Codex | size=13 color=#888888
5-hour:  99% · resets 4h 55m | font=Menlo
Weekly:  not available | font=Menlo
---
Open dashboard | href=http://127.0.0.1:5599/
Refresh | refresh=true
```

### FR-07 — most-constrained glyph (verified)
Fresh capture: four windows-with-a-reading (65/46/99/99); glyph shows floor of the
min (46). Maxed fixture: 0 is included and binds. Null windows are excluded from
the min and shown "not available", never `0%`.

### FR-09 — freshness band from server-supplied thresholds (verified)
`ageBand` is copied verbatim from `public/app.js` (thresholds read off
`freshness.freshForMs`/`staleAfterMs`, never hardcoded). A pure-function seam
check straddled the thresholds: 1m→fresh, 7m→aging, 30m→stale, `null`/Codex-shaped
`{capturedAt:null}`→no band. Codex's `freshness:null` yields no band treatment; the
glyph's band then falls back to the freshest applicable tool band (FR-09).

### FR-11 — countdowns match `fmtDur` (verified)
`fmtDur` copied verbatim. Seam check: `null`→"—", `0`/negative→"now",
`90m`→"1h 30m", `36h`→"1d 12h", `45m`→"45m". Live captures show `3h 44m`,
`1d 11h`, `6d 3h`, `44m` — all `fmtDur`-shaped.

### FR-16/NFR-04 — diagnostic mapping + escaping (verified)
Reason codes map to fixed lines via **own-key lookup** (`hasOwnProperty`,
mirroring the shipped convention); an unmapped code falls back to a generic honest
line. Free-form `detail` is passed through `sanitize()` (strips `|`/newlines)
before display — proven with the `rm -rf /` injection above. No payload value is
ever interpolated into a shell string (the plugin spawns nothing).

### FR-06/NFR-05 — defensive parse (verified)
Non-200, malformed JSON, and connection-refused each yield the offline glyph, exit
0, no partial/fabricated number. A `null` window is the no-reading case, not an
error. Fetch is bounded by a 2s `http.get` timeout so a hung server can't freeze
the menu bar.

---

## Port / env decision (FR-14, OQ-02) — with justification

**Decision: a single documented one-line constant `PORT` at the top of the
plugin, optionally overridden by `LLMDASH_PORT` if the host passes it through.
This is the *only* config surface and it drives the fetch URL for real (no dead
knob).**

Justification: SwiftBar runs plugins in a login-shell-ish environment, but plugin
authors **cannot reliably count on arbitrary user env vars** reaching a plugin
(it depends on the user's shell rc wiring and how SwiftBar was launched). Relying
solely on `LLMDASH_PORT` would be a knob that silently does nothing for many
users — exactly the "dead knob" the constitution forbids. So the **guaranteed**
surface is the one-line constant the README tells the user to edit once; the env
var is a *bonus* that works when present. In the prototype this is:

```js
const PORT = process.env.LLMDASH_PORT || '8787';
```

Proven both ways: the fresh capture used the default 8787 against the real server;
every fixture capture set `LLMDASH_PORT=5599`/`5601` and the plugin fetched the
overridden port. One surface, real effect, honest default. (If the Engineer
prefers the constant to be literally a hardcoded line the user edits, `|| '8787'`
becomes the documented editable literal — same single surface either way.)

## Interpreter / node-resolution decision (FR-13) — measured, not assumed

**Decision: the plugin must be invoked via an ABSOLUTE node path baked at
install time — NOT a bare `#!/usr/bin/env node` shebang.** Mirror how the
installer already resolves `codex`/`claude` to absolute paths for the launchd
minimal-PATH problem (DECISIONS.md 2026-07-01; config.js `codexCmd`/`claudeCmd`).

Measured on this machine (node under nvm — the worst case):

```
minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin) → command -v node → NODE NOT FOUND
env node shebang under minimal PATH          → env: node: No such file or directory   (DEAD badge)
/Users/developer/.nvm/.../bin/node plugin.js → renders correctly                       (WORKS)
```

So `#!/usr/bin/env node` is **unsafe** — under the host's minimal spawn PATH it
produces a dead badge (or the host's own error state), the precise
codex/claude launchd lesson. The install step must resolve node (`readlink -f
"$(command -v node)"`) and bake it in — via one of:
- **Shebang rewrite** at install: `#!/absolute/path/to/node` on line 1 (SwiftBar
  honors the plugin's own shebang). Simplest; the installer edits line 1.
- **Shell shim** plugin (`llmdash.5s.sh`) that `exec`s `"$ABS_NODE" llmdash.js` —
  keeps the JS un-rewritten but adds a second file.

Recommended: **shebang rewrite of the single `.js` file at install** (one file,
one edited line, matches FR-18's `scripts/menubar/llmdash.5s.js`). An unresolved
node at install time is an **install-time failure surfaced with the fix**, never
a silently dead badge (FR-13). This is a deploy/install concern the Engineer
wires into `scripts/install-macos.sh` (FR-20, optional convenience) and documents
in the README (FR-19); the checked-in file can carry a portable
`#!/usr/bin/env node` for dev-on-PATH use, with the install step rewriting it.

---

## SwiftBar vs xbar delta table (what later stages must respect)

| Concern | [SB] SwiftBar (default) | [XB] xbar (best-effort note) |
|---|---|---|
| Output contract | Classic BitBar format (title / `---` / dropdown / `| key=value`) | **Same** classic BitBar format |
| Refresh interval | In filename: `name.5s.js` (`s/m/h/d`) | **Same** filename convention |
| Plugin directory | User-chosen dir set in SwiftBar prefs (commonly `~/Library/Application Support/SwiftBar/Plugins` or a folder the user picks) | `~/Library/Application Support/xbar/plugins` |
| Install command (user-ratified) | `brew install --cask swiftbar` | `brew install --cask xbar` |
| Color param | `color=#rrggbb` or named | **Same** |
| Font/size | `font=`, `size=` | **Same** |
| SF Symbols / template image | `sfimage=`, `templateImage=` (SwiftBar extension — nicer glyphs) | Not supported (xbar predates it) — plain text/emoji glyph only |
| `href=` / `bash=` / `refresh=true` | Supported | Supported |
| Maintenance / notarization | Actively maintained, notarized, Swift-native | Older, broader ecosystem, less active |

**The plugin ships glyphs in plain text/emoji + `color=`** (works on both hosts).
`sfimage`/`templateImage` are a SwiftBar-only *polish* the Designer MAY add for a
crisper glyph — but the honest five-state distinctness must not depend on a
SwiftBar-only param (keep a text/emoji fallback so xbar still distinguishes the
states). This is the only styling delta that reaches the emitter.

---

## Findings later stages must honor

1. **Live in-menu-bar render (FR-02 capture) is deferred to deploy**, gated on the
   user ratifying `brew install --cask swiftbar` (Designer stage). Everything
   host-independent is proven here.
2. **Absolute node path, baked at install** — not `env node`. Measured dead-badge
   failure under minimal PATH. Installer must resolve+bake and fail loudly if node
   is unresolved.
3. **Port = one-line constant (`|| '8787'`), env override optional.** The only
   config surface; drives the URL for real. Don't rely on the host passing env.
4. **Glyph honesty must not depend on SwiftBar-only params.** Text/emoji + `color`
   is the floor (xbar-safe); `sfimage` is optional SwiftBar polish.
5. **`sanitize()` (strip `|`/newlines) is the menu-bar analogue of `esc()`** — the
   security seam for free-form diagnostic fields. Own-key lookup for reason codes.
6. **The plugin is a pure consumer** — one loopback `GET /api/state`, no second
   data path, no limit recomputation. It reuses `ageBand`/`fmtDur`/diagnostic
   semantics from `public/app.js` verbatim; if those change, the plugin's copies
   must be kept in lockstep (a test-seam concern — see schema.md).
7. **`/api/state` needs NO change.** The badge consumes the existing contract as-is
   (QA-24). If it ever appears to need a payload change, that's a flag to raise.

---

## QA coverage proven at spike time

| QA | Status at Stage 3 |
|---|---|
| QA-01 (host decided) | ✅ SwiftBar default; delta table + conventions recorded |
| QA-02 (live install evidence) | ⏳ **deferred to deploy** (host install is user-ratified) — design-level format proof captured instead |
| QA-03 (single data source) | ✅ only `GET /api/state`; no other read |
| QA-04 (no recomputation) | ✅ reads `remainingPct` etc. as given; helpers copied from web client |
| QA-05 (defensive parse) | ✅ 500 / bad JSON / refused → offline, no crash; `null`→no-reading |
| QA-06 (most-constrained glyph) | ✅ floor of min; null excluded; one number |
| QA-07 (no-reading) | ✅ null window "not available"; all-null → `◉ —` + per-tool why |
| QA-08 (band derivation) | ✅ straddle test 1m/7m/30m; server thresholds; Codex null→no band |
| QA-09 (five distinct states) | ✅ fresh/aging/stale/no-reading/offline all visibly distinct |
| QA-10 (countdown fmt) | ✅ matches `fmtDur` |
| QA-13 (port drives fetch) | ✅ default + `LLMDASH_PORT` override both proven |
| QA-14 (minimal-PATH interpreter) | ✅ absolute node works; `env node` fails — fix identified |
| QA-15/16 (diagnostics + coexistence) | ✅ mapping, own-key, escaping, stale+reading |
| QA-20/21 (zero-dep / isolation) | ✅ Node builtins only; one GET; no subprocess/disk |
| QA-22/23 (honesty + security) | ✅ never-fake/never-stale-as-fresh; `|` injection neutralized |
