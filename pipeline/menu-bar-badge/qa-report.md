# QA Report — Menu-Bar Badge

**Date:** 2026-07-02
**Stage:** 6 — The Tester
**Lane:** New Feature (`sessionType: "feature"`)
**Test Runner:** node:test (`npm test` → `node --test`)
**Result:** **PASSED WITH NOTES**

The single note is not a defect: the live in-menu-bar render (FR-02 / QA-02) is
**deploy-deferred** by design — gated on the user ratifying `brew install --cask
swiftbar` — and is marked **Deferred**, not failed, per the PRD and spike report.
Everything host-independent is fully proven, including the real plugin exercised
against both crafted fixtures and the live dashboard.

---

## Test Suite Results

```
ℹ tests     168
ℹ pass      166
ℹ fail        0
ℹ skipped     2
ℹ todo        0
```

**166 passing, 0 failing.** Matches the Engineer's reported baseline exactly.

### Why the 2 skips are graceful (not silent omissions)

Both skips are in `tests/menubar-install.test.js` and both test the **node-unresolved
loud-failure path** of the installer:

- `--resolve-node: exits non-zero when node cannot be resolved (loud failure)`
- `--setup-badge: node unresolved → loud failure with the fix, non-zero, no dead badge`

Each guards with `if (fs.existsSync('/opt/homebrew/bin/node') || fs.existsSync('/usr/local/bin/node')) return t.skip(...)`.
This machine **has** `/opt/homebrew/bin/node` (Homebrew node v26.4.0, verified), so the
installer's `resolve_node` fallback would always find a node — making it impossible to
*honestly* simulate an unresolvable-node environment here. The tests skip rather than
assert a false negative. The skip reason is printed inline
(`# a system-wide node exists on this machine`). The **positive** install paths
(`--resolve-node` from PATH / from `~/.local/bin`; `--setup-badge` bakes the absolute
shebang; `--setup-badge` symlinks into a detected SwiftBar dir without installing
SwiftBar) all **run and pass**. This is a correct, honest skip: the failure path they
cover is unreachable on a machine that has node installed system-wide.

---

## Acceptance Criteria Verification (QA-01 .. QA-24)

Legend: ✓ Pass · ⏳ Deferred (deploy) · evidence one-liner per row.

| ID | Result | Evidence |
|---|---|---|
| QA-01 | ✓ Pass | `spike-report.md` records exactly one default host (SwiftBar), the `.5s.` filename-interval convention, the stdout-styling params (`color=`/`font=`/`size=`/`href=`/`refresh=`), and the [SB]/[XB] delta table; xbar is a best-effort note, not built to parity. |
| QA-02 | ⏳ Deferred | Live in-menu-bar render is deploy-gated on the user's `brew install --cask swiftbar` ratification (spike §"deferred to deploy"). Design-level format proof captured instead; the real plugin's stdout is valid SwiftBar grammar (see appendix). **Deploy task, not a Stage-6 blocker.** |
| QA-03 | ✓ Pass | Plugin's only imports are `node:http` (the one loopback GET), plus `node:url`/`node:path` for the entry-point guard. `grep` for `fs`/`sqlite`/`https`/`net.connect`/`spawn`/`exec` finds nothing but two *comments*. No statusline/DB/log read; no second data path. Runtime trace: the scratch server saw exactly one `GET /api/state`. |
| QA-04 | ✓ Pass | `computeBadge` reads `remainingPct`/`resetsAt`/`capturedAt`/`freshness`/`limitsDiagnostic` as given; the only math is `Math.floor(remainingPct)`, the min-selection, `fmtDur`, and `ageBand`. `fmtDur`/`ageBand` are copied verbatim from `public/app.js` and guarded by the parity test. |
| QA-05 | ✓ Pass | Real `http.get` path driven against a scratch loopback server: non-200 (500), malformed JSON, and connection-refused each → `▪ llmdash ⚠`, exit 0, no `%` digit anywhere (`assert.doesNotMatch(/\d+%/)`). A `null` window → the no-reading case, not an error. Captured in appendix State 5. |
| QA-06 | ✓ Pass | Fresh fixture: min(46,61,88,72)=46 → glyph `▪ C 46%`, one number only. Independent cross-tool check: min(80,55,12,40)=12 → glyph binds to **Codex 5-hour** (`cue X`), proving selection is not Claude-biased. Live 8787: min(56,45,99,99)=45 → `▪ C 45%`. |
| QA-07 | ✓ Pass | Maxed fixture: Codex `seven_day: null` renders `Weekly:  not available` (never `0%`) and is excluded from the min. No-reading fixture: all four windows null → glyph `▪ —` (dash, no digit) + per-tool "not available" rows + per-tool diagnostics. |
| QA-08 | ✓ Pass | `ageBand` verbatim from `app.js`; thresholds read off `freshness.freshForMs`/`staleAfterMs`, never hardcoded (`tests: ageBand honors the SERVER thresholds`). Straddle: 1m→fresh, 7m→aging, 30m→stale, `null`/`{capturedAt:null}` (Codex)→no band. Parity test cross-runs app.js's `ageBand` on the same inputs. |
| QA-09 | ✓ Pass | Five glyphs are visibly distinct (appendix): `▪ C 46%` (fresh) · `▪ C 66%·` (aging) · `▪ C 66% ⚠` (stale) · `▪ —` (no-reading) · `▪ llmdash ⚠` (offline). Two never-do rules hold: no aging/stale reading reads confidently fresh (`·`/`⚠` markers carry it in monochrome); no digit ever appears in offline or no-reading. |
| QA-10 | ✓ Pass | Countdowns match `fmtDur`: live captures `2h 26m`, `1d 9h`, `4h 56m`, `6d 2h`; maxed `43m`; `fmtDur` unit test covers `null`→"—", `≤0`→"now", `d h`/`h m`/`m`. Parity test asserts byte + behavioral equality with `app.js`'s `fmtDur`. |
| QA-11 | ✓ Pass | Dropdown lists all four tool×window rows with label + remaining% (or "not available") + `resets <fmtDur>`. Maxed 5-hour reads `limit reached · resets 43m` and is the binding glyph (`▪ C 0%`). `emit: the dropdown lists all four tool×window rows` passes. |
| QA-12 | ✓ Pass | Every captured dropdown ends with `Open dashboard | href=http://<host>:<port>/` and `Refresh | refresh=true`. The href tracks the configured host:port (proven: `localhost`, `192.0.2.1`, scratch ports all reflected). Refresh drives real host re-run (SwiftBar `refresh=true`), not a dead item. |
| QA-13 | ✓ Pass | Positive proof: `LLMDASH_BADGE_HOST=localhost LLMDASH_PORT=<scratch>` → server saw `Host: localhost:57820` **and** the href read `http://localhost:57820/`. Env override drives **both** the real fetch and the href. `LLMDASH_PORT`/`LLMDASH_BADGE_HOST` are the only config surface (no dead knob). |
| QA-14 | ✓ Pass | Minimal-PATH recipe reproduced read-only: `env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin <abs-node> plugin.js` → **renders** `▪ C 45%`, exit 0; bare `node` → `sh: node: command not found`; the checked-in `#!/usr/bin/env node` under minimal PATH → `env: node: No such file or directory` (dead). Confirms why the installer bakes the absolute shebang. Node-builtins-only; no npm; no build step. |
| QA-15 | ✓ Pass | Each of the six reason codes maps to a fixed honest line (unit + parity tests). Unmapped code → `Limit reading unavailable.` `reason`/`cause` never rendered raw. Own-key `hasOwnProperty` lookup: a `__proto__`/`constructor` reason falls through to the generic line (`diagLine: own-key lookup` passes). Free-form `detail` sanitized. |
| QA-16 | ✓ Pass | Stale fixture carries a `stale-reading` diagnostic **and** a live reading: glyph shows the number marked stale (`▪ C 66% ⚠`) AND the dropdown shows both the window rows and the stale note. The window is flagged, never blanked (FR-17). |
| QA-17 | ✓ Pass | Plugin ships at `scripts/menubar/llmdash.5s.js` (the `.5s.` interval-in-filename convention). README §"Menu-bar badge (SwiftBar)" states exactly what to copy/symlink into SwiftBar's plugin dir and to `chmod +x`. |
| QA-18 | ✓ Pass | README names SwiftBar with the exact one-time `brew install --cask swiftbar`, states "llmdash never installs it for you" (prerequisite, not a dependency, never auto-installed), documents `--setup-badge` + the manual symlink path, the `LLMDASH_PORT`/`LLMDASH_BADGE_HOST` config, the C/X cue mapping, and the offline/freshness honesty reality. |
| QA-19 | ✓ Pass | `install-macos.sh` `setup_badge` never installs SwiftBar — it only symlinks into a **detected** dir or prints the `brew install --cask swiftbar` instruction + `does NOT claim to have installed it`. Bakes the absolute node shebang; fails loudly (`node not found` + fix) if unresolved. Install tests confirm both paths. No health-line was added (optional per FR-20); `src/health.js` is unchanged. |
| QA-20 | ✓ Pass | `package.json` has **no `dependencies` block** (runtime deps = 0). No build step (`scripts`: start/statusline/test only). Plugin is Node-builtins-only. |
| QA-21 | ✓ Pass | Runtime trace: exactly one `GET /api/state` per run reached the scratch server. Plugin spawns no subprocess (verified by static grep + the "the plugin spawns nothing" invariant), polls no CLI, scans no disk (`node:fs` never imported). |
| QA-22 | ✓ Pass | Across all five states (appendix): never a stale reading shown as fresh (band markers structural), never a fabricated number when unreachable (offline branch has no number path), never a `0%`/zero where a window has no reading (`null` → "not available", `remainingPct<=0` → "limit reached"). |
| QA-23 | ✓ Pass | Plugin makes only a loopback GET, sends no credentials, writes to no Claude/Codex path, interpolates no payload value into a shell string (spawns nothing). `sanitize()` strips `|`/`\r`/`\n`; the no-reading fixture's injected `detail: "spawn codex ENOENT | rm -rf /"` rendered as `(spawn codex ENOENT   rm -rf /)` — the `|` neutralized, opening no extra SwiftBar param. |
| QA-24 | ✓ Pass | `src/server.js`, `public/app.js`, `config.js`, `src/health.js` are **all unchanged** (git status). Only `README.md` + `scripts/install-macos.sh` are modified — disclosure/install surfaces, not the wire contract. `/api/state` payload, freshness thresholds, and diagnostic reason codes are consumed as-is. |

**Score: 23 Pass · 1 Deferred (QA-02, deploy-gated) · 0 Fail · 0 Partial.**

---

## Edge Cases Tested Beyond the Table

- **Parity guard tamper-check (drift-risk closure).** On a scratch copy I changed
  the plugin's `fmtDur` `'now'` return to `'zero'`; `tests/menubar-parity.test.js`
  failed loudly on **both** the byte-equality body check and the behavioral
  cross-run check (2 tests failed). Restored byte-exact and re-ran green (7/7).
  Confirms the guard actually catches divergence — the badge cannot silently drift
  from the dashboard's honesty language.
- **Cross-tool most-constrained selection.** A crafted state whose min is a Codex
  window (12%) correctly bound to Codex 5-hour with cue `X` — proving the selection
  is not Claude-biased and the C/X cue names the true binding tool.
- **Band-fallback under a degraded sibling.** A Codex-owned binding window
  (`freshness: null`) with an **aging** Claude sibling read `state: aging`, not
  fresh — a Codex-owned glyph never reads confidently fresh while a sibling is
  degraded (FR-09 freshest-applicable fallback).
- **Bad/unroutable host → offline, not a crash.** `LLMDASH_BADGE_HOST=192.0.2.1`
  (TEST-NET-1, unroutable) → `▪ llmdash ⚠`, exit 0, empty stderr; the offline line
  and href both reflect the configured host.
- **Live-dashboard cross-check.** The real checked-in plugin run against the live
  8787 service (read-only GET) rendered correctly: `▪ C 45%`, binding = Claude
  Weekly 45% = min(56,45,99,99), warn color for the 20–49 band. Honest proof it
  renders against real data, not only fixtures.

---

## Known Limitations

1. **QA-02 live in-menu-bar render is deploy-deferred** (by design). The FR-02
   capture evidence — the glyph updating on-interval in the actual macOS menu bar,
   the SwiftBar dropdown, at least one degraded + the offline state visibly distinct
   — is a **deploy-stage task** the user performs once they ratify and run
   `brew install --cask swiftbar`. The plugin's stdout is valid SwiftBar/xbar grammar
   and every state is proven at the format level; only the "does SwiftBar paint it in
   the bar" check is outstanding, and it is not a Stage-6 blocker.
2. **`127.0.0.2` loopback alias not bindable on this machine.** The
   configurable-host test's positive-fetch assertion falls back to its href-only path
   here (`EADDRNOTAVAIL`). I closed the gap with an **independent positive proof**
   using `LLMDASH_BADGE_HOST=localhost` (a distinct host string that resolves to
   loopback): the scratch server saw the fetch and the href matched. The env-override
   mechanism is fully proven end-to-end; only the specific alias is an environment
   limitation, not a plugin defect.
3. **Two install-failure-path tests skip on this machine** (system-wide node present)
   — see the suite section. Honest, guarded skips; the positive install paths pass.

---

## Convention Flags

- **Copied-helper parity is a standing pattern worth a rule.** `fmtDur`/`ageBand`
  are duplicated from `public/app.js` because the plugin can't import browser JS,
  guarded by `tests/menubar-parity.test.js` (byte + behavioral equality, verified to
  fail on divergence). Any future consumer that must mirror the dashboard's honesty
  helpers (the noted `tmux`/terminal statusline follow-on, a Linux tray) should copy
  the helper **and** add the same parity guard in the same commit — never a bare
  copy. This mirrors the existing CLAUDE.md multi-source discipline ("when a shared
  formatting helper changes, the diff must enumerate the helper's call sites"); the
  extension is: **call sites outside the app bundle need a parity test, not just a
  diff.** Stage 9 to apply the decision filter.

---

## Appendix — Captured real plugin stdout (the honest render proof)

All output below is the **real checked-in plugin** (`scripts/menubar/llmdash.5s.js`)
run as a child process (env-driven, exactly as SwiftBar spawns it) against crafted
`/api/state` fixtures served through a real loopback server on a scratch port. No
`~/llmdash`, no live service mutated. Timestamps are relative-to-now (fixtures use
`@<ms>` placeholders), so countdowns vary by run.

### State 1 — FRESH
```
▪ C 46% | color=#f0a94b
▪ 46% remaining — Claude Code · 5-hour
---
Claude Code | size=13 color=#888888
5-hour:  46% · resets 3h 11m | font=Menlo
Weekly:  61% · resets 2d 3h | font=Menlo
---
Codex | size=13 color=#888888
5-hour:  88% · resets 4h 39m | font=Menlo
Weekly:  72% · resets 5d 8h | font=Menlo
---
Open dashboard | href=http://127.0.0.1:57787/
Refresh | refresh=true
```
Binding = Claude 5-hour 46% (min of 46/61/88/72); `C` cue; warn color (20–49 band); one number inline. exit 0; server saw `GET /api/state`.

### State 2 — AGING (Claude captured 7m ago; 5m<age<10m)
```
▪ C 66%· | color=#a0a0a0
▪ 66% remaining — Claude Code · Weekly · aging
---
Claude Code  (aging) | size=13 color=#888888
5-hour:  78% · resets 2h 46m | font=Menlo
Weekly:  66% · resets 3d 0h | font=Menlo
---
Codex | size=13 color=#888888
5-hour:  88% · resets 4h 39m | font=Menlo
Weekly:  72% · resets 5d 8h | font=Menlo
---
Auto-refresh is failing — open a Claude Code CLI session to refresh manually. | size=12 color=#f0a94b
---
Open dashboard | href=http://127.0.0.1:57789/
Refresh | refresh=true
```
Number **kept** with trailing `·` and dim `#a0a0a0` — **not** greyed to a dash. Tool header tagged `(aging)`. Never-do rule held: aging is not shown as confidently fresh.

### State 3 — STALE (Claude captured 30m ago; + `stale-reading` diagnostic)
```
▪ C 66% ⚠ | color=#f0a94b
▪ 66% remaining — Claude Code · Weekly · stale
---
Claude Code  (stale) | size=13 color=#888888
5-hour:  78% · resets 2h 46m | font=Menlo
Weekly:  66% · resets 3d 0h | font=Menlo
---
Codex | size=13 color=#888888
5-hour:  99% · resets 4h 39m | font=Menlo
Weekly:  99% · resets 5d 8h | font=Menlo
---
Stale reading — the limits may have moved since; open a Claude Code CLI session to refresh. | size=12 color=#f0a94b
---
Open dashboard | href=http://127.0.0.1:57791/
Refresh | refresh=true
```
Number **kept**, amber + trailing `⚠`; the stale note appears AND the window is never blanked (FR-17 coexistence).

### State 4 — NO-READING (all windows null both tools; Codex `detail` carries a `|` injection)
```
▪ — | color=#9b9ea6
▪ no reading yet
---
Claude Code | size=13 color=#888888
5-hour:  not available | font=Menlo
Weekly:  not available | font=Menlo
---
Codex | size=13 color=#888888
5-hour:  not available | font=Menlo
Weekly:  not available | font=Menlo
---
No statusline reading yet — open a Claude Code CLI session to capture the first reading. | size=12 color=#f0a94b
The codex command couldn’t be run — set LLMDASH_CODEX_CMD to the absolute path and restart. (spawn codex ENOENT   rm -rf /) | size=12 color=#f0a94b
---
Open dashboard | href=http://127.0.0.1:57793/
Refresh | refresh=true
```
Glyph is `▪ —` — a dash, **NO digit**, no tool cue. Security proof: the injected `detail: "spawn codex ENOENT | rm -rf /"` rendered as `(spawn codex ENOENT   rm -rf /)` — the `|` stripped to spaces, opening no extra SwiftBar param.

### State 5 — OFFLINE (all three failure modes)
```
--- 5a: non-200 (500) ---          --- 5b: malformed JSON body ---      --- 5c: connection refused ---
▪ llmdash ⚠ | color=#8b8b8b        ▪ llmdash ⚠ | color=#8b8b8b          ▪ llmdash ⚠ | color=#8b8b8b
---                                ---                                  ---
Dashboard offline — no server on   Dashboard offline — no server on     Dashboard offline — no server on
  127.0.0.1:57795                    127.0.0.1:57797                      127.0.0.1:57799
Open dashboard | href=...          Open dashboard | href=...            Open dashboard | href=...
Refresh | refresh=true             Refresh | refresh=true               Refresh | refresh=true
```
All three land on the identical no-number glyph, exit 0, no crash. **NO digit** anywhere.

### Bonus — MAXED + partial-null
```
▪ C 0% | color=#ff6b6b
▪ 0% remaining — Claude Code · 5-hour
---
Claude Code | size=13 color=#888888
5-hour:  limit reached · resets 43m | font=Menlo
Weekly:  46% · resets 2d 10h | font=Menlo
---
Codex | size=13 color=#888888
5-hour:  99% · resets 4h 39m | font=Menlo
Weekly:  not available | font=Menlo
---
No Codex limit reading yet. | size=12 color=#f0a94b
---
Open dashboard | href=http://127.0.0.1:57801/
Refresh | refresh=true
```
`0%` is a valid binding glyph (crit red `#ff6b6b`); the maxed row reads `limit reached`; the `null` Codex weekly reads `not available` — never `0%`.

### Configurable-host positive proof
```
LLMDASH_BADGE_HOST=localhost LLMDASH_PORT=<scratch>
→ scratch server saw:  Host: localhost:57820
→ glyph:               ▪ C 46% | color=#f0a94b
→ href:                Open dashboard | href=http://localhost:57820/
```
The env override drove **both** the real fetch (server saw the `localhost` Host header) and the Open-dashboard href.

### Live-dashboard cross-check (read-only GET against the running 8787 service)
```
▪ C 45% | color=#f0a94b
▪ 45% remaining — Claude Code · Weekly
---
Claude Code | size=13 color=#888888
5-hour:  56% · resets 2h 26m | font=Menlo
Weekly:  45% · resets 1d 9h | font=Menlo
---
Codex | size=13 color=#888888
5-hour:  99% · resets 4h 56m | font=Menlo
Weekly:  99% · resets 6d 2h | font=Menlo
---
Open dashboard | href=http://127.0.0.1:8787/
Refresh | refresh=true
```
Real payload: binding = Claude Weekly 45% = min(56,45,99,99); C cue; warn color. The badge renders correctly against real data.
