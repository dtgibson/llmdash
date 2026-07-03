# QA Report — Multi-Host Badge

**Feature:** multi-host-badge
**Date:** 2026-07-02
**Stage:** 6 — The Tester
**Lane:** New Feature (`sessionType: "feature"`)
**Test Runner:** node:test (`npm test` → `node --test`)
**Result:** **PASSED**

The feature meets every acceptance criterion in the PRD Success Metrics table
(QA-01..QA-28). The full suite is green, and the eight load-bearing behaviors were
re-verified **independently** of the Engineer's own tests — with real scratch
servers, real fake peers, live mid-run file edits, injected/hostile-value edit
round-trips, and captured badge stdout for every key state. No retry rounds were
needed.

---

## Test Suite Results

```
tests 333
pass  331
fail  0
skipped 2
todo  0
```

**331 passing, 0 failing** — exactly the Engineer's reported baseline (333 / 331 /
2). Re-run twice with identical counts.

### Why the 2 skips skip (confirmed, not new omissions)

Both skips are the **pre-existing badge-install node-unresolved tests** in
`tests/menubar-install.test.js`, each guarded by "a system-wide node exists on this
machine":

```
ok 234 - --resolve-node: exits non-zero when node cannot be resolved (loud failure) # SKIP a system-wide node exists on this machine
ok 241 - --setup-badge: node unresolved → loud failure with the fix, non-zero, no dead badge # SKIP a system-wide node exists on this machine
```

They exercise the installer's *failure* path when no node can be resolved. This
machine has a resolvable node (`/Users/developer/.nvm/.../v24.18.0/bin/node`), a
precondition the tests cannot negate in-process, so they self-skip. This is the
shipped, environment-gated skip carried forward from the menu-bar-badge feature —
**not** a multi-host-badge omission. Every new multi-host-badge test **runs and
passes**.

---

## Acceptance Criteria Verification

| ID | Result | Evidence |
|---|---|---|
| QA-01 | ✓ Pass | `hosts.conf` under `config.dataDir` (`config.hostsFile` getter) in `host[:port][=label]` grammar is read as the remote set; file body ↔ `LLMDASH_HOSTS` parity via one parser (`parseHosts`); atomic temp+rename writes. Independent check §A: file present ⇒ `source:"file"`, `raw:"10.0.0.1:8788=A,10.0.0.2=B"`. |
| QA-02 | ✓ Pass | All precedence corners proven independently: file-present wins (env ignored); file-absent+env ⇒ seed-once (`source:"env-seed"`, file written); **seed-once** (editing `LLMDASH_HOSTS` after the file exists does nothing — file wins); neither ⇒ `source:"none"`, `raw:""` (single-host); **existing-but-empty file ⇒ zero remotes, env does NOT re-seed** (Remove sticks). |
| QA-03 | ✓ Pass | **LIVE** (not restart): same pid 23023 throughout — appended a host to `hosts.conf` mid-run ⇒ it appeared AND was polled (reachable+state) next tick; removed a line ⇒ its `/api/hosts`+cache entry dropped by `retainHosts` next tick. |
| QA-04 | ✓ Pass | Unreadable file ⇒ `error{unreadable}`, falls back to env-seed, **logs exactly ONCE across 3 reads** (module latch), no crash, surfaced in `hostsConfigLine`. A malformed line ⇒ `parseHosts` `errors:[{entry:":99999",reason:"empty-host"}]`, surfaced in disclosure, never fabricated. |
| QA-05 | ✓ Pass | `sanitizeHostPort` scrubs at the door: an out-of-range port (`:99999`) ⇒ `invalid/bad-port` rejection (nothing written), never a coercion; empty-after-sanitize ⇒ `invalid/empty`. Host part of a hostile value came through clean. |
| QA-06 | ✓ Pass | Badge fetches `GET /api/hosts` on its local instance over loopback (`fetchHosts`, line 650-668); only two fetch paths exist (`/api/state`, `/api/hosts`), both local; recomputes no limits (pure consumer — `computeMultiBadge` wraps the shipped `computeBadge` per host). |
| QA-07 | ✓ Pass | Live aggregation of 3 peers: glyph `▪ Desktop·C 12%` = `floor(min remainingPct)` across host×tool×window (Desktop Claude-5h 12% bound over Work-laptop 45% and This-machine). A maxed window binds "limit reached" (unit test); no-reading hosts/windows excluded from the min (never 0 — no `0%` anywhere in output). |
| QA-08 | ✓ Pass | Live glyph names the binding **host** (`Desktop`) + tool cue (`C`) + window; title echo `▪ 12% remaining — Desktop · Claude Code · 5-hour`. 10-char truncation confirmed (`This machi…·C 5%`). |
| QA-09 | ✓ Pass | Live dropdown renders one section per host (Desktop ▸ binding, This machine · you, Work laptop, Studio VM) with per-tool 5-hour/Weekly rows; Studio VM offline does NOT suppress the others; the five honesty states apply per host via reused `ageBand`/`computeBadge`. |
| QA-10 | ✓ Pass | Live offline host named: `Studio VM is unreachable — no response within 3s. Check the machine is awake and llmdash is running on 127.0.0.1:8813. …` — via own-key `hostDiagnostic` map, `detail` sanitized; never a zero, never stale-as-fresh, never dropped (`state:null`, `reachable:false` in `/api/hosts`). |
| QA-11 | ✓ Pass | Every free-form field `sanitize()`d before a line (labels L241/549/679, detail L100/204); host/port `sanitizeHostPort`'d on href/URL (L242/367/550/680). Unit tests: a `|`/newline label cannot break the SwiftBar line grammar; the glyph host cue is sanitized. |
| QA-12 | ✓ Pass | Contract guard genuinely catches drift: the "renamed field is CAUGHT" test simulates `state`→`payload` and asserts `throws(/missing state/)`; a companion test proves the **live `getCombined()` producer** emits every `HostReading` field the badge reads (producer↔consumer, not a static tautology). |
| QA-13 | ✓ Pass | **Byte-for-byte** proven independently against a live scratch server: badge output via `/api/hosts` === `emit(computeBadge(/api/state))`; `/api/hosts` returns one `self` host ("This machine"); no host cue, no "Watching N machines", no "Add host" line in single-host mode; startup log discloses single-host source. |
| QA-14 | ✓ Pass | Live badge dropdown carries `＋ Add host…`, `－ Remove host…` (submenu, one item per removable host), and `☰ Watching: 3 hosts`; each Add/Remove action shells to `$ABS_NODE` against the tracked helper with `terminal=false refresh=true`; **no HTTP mutation** (see QA-22). |
| QA-15 | ✓ Pass | Injected-value round-trip (no dialog): valid `127.0.0.1:9001=Desktop` ⇒ sanitized, validated, atomically appended (`canonical:"127.0.0.1:9001=Desktop"`); malformed (`   `, `:99999`) ⇒ rejected, file unchanged; duplicate ⇒ `{ok:false,reason:"duplicate",detail:"Desktop"}`, appears exactly once. |
| QA-16 | ✓ Pass | Injected-value: `removeHost` drops the matching entry via atomic write, others survive; local host **never removable** (`removeHost('local:8787')` ⇒ `is-local`, `listHosts` never includes self); unknown key ⇒ `not-found`. Mid-fetch safe: `retainHosts` runs **before** `pollPeers` (poller L126 before L128) — same-tick removal never fetched (LIVE-proven under QA-03). |
| QA-17 | ✓ Pass | Every action carries `refresh=true` (dropdown reflects the new list); post-write copy `Added <host> — it'll appear on the next update.` (never "live now"); the actual monitoring change applies next poller tick (QA-03). |
| QA-18 | ✓ Pass | FR-18 copy verbatim in the helper: Add prompt, `That doesn't look like a valid host — nothing was added. Expected host[:port][=label].`, `That host is already being watched …`, `Stop watching <label> (<host:port>)?`, `Couldn't save the host list — <reason>. Nothing changed.`, post-add. Invalid names the reason + writes nothing; write-fail states nothing changed. |
| QA-19 | ✓ Pass | Auto-detect: empty local + remote ⇒ local dropped from glyph/headline (binds Desktop). `!local=include`/`exclude` a **real knob** (proven distinct): with a tight local reading, include glyph `▪ This machi…·C 5%` vs exclude `▪ Desktop·C 22%` — different bindings, no dead knob. Directive parsed by `host-config.js`, echoed onto the local `HostReading` (LIVE test). |
| QA-20 | ✓ Pass | De-emphasized local **retained** in dropdown: `no local activity` idle line + honest note ("This Mac isn't running Claude or Codex — it's watching the machines above. …No reading is fabricated."); no `0%` fabricated; prominence changed, not truth. |
| QA-21 | ✓ Pass | README documents path/format/precedence/local-always/affordance/serve-only + `!local=` (lines 258-289); startup log states the effective source (`Host config: no hosts.conf and LLMDASH_HOSTS unset — single-host …` / seeded / file); `hostsConfigLine` names present/env-seed/missing/unreadable + fix (5 disclosure tests pass). |
| QA-22 | ✓ Pass | Live probe: `/api/hosts` carries baseline headers (nosniff, CSP `default-src 'self'` + `style-src 'unsafe-inline'` + `base-uri 'none'`, referrer-policy) + no-store; POST/PUT/DELETE/PATCH ⇒ 405 `allow: GET, HEAD`; would-be write routes 405 on POST, 404 on GET (no write surface); `server.js` source has no host-config write path. |
| QA-23 | ✓ Pass | Structural anti-injection: only subprocess is `execFileSync('/usr/bin/osascript', ['-e', script])` — ARGV, no shell, no `sh -c`/`exec`/`eval`; AppleScript is fixed literals, `asStr()` applied only to own copy, typed value returns via `text returned of result` on stdout → `addHost` on ARGV. Hostile `| rm -rf ~` ⇒ inert data, **sentinel file survived**, nothing executed; atomic temp+rename, **zero temp leaks** across add/remove. |
| QA-24 | ✓ Pass | Badge issues no outbound fetch (only `/api/state`+`/api/hosts` to the local instance); `src/hosts.js` (parser + hardened `fetchPeerState`) **unchanged** (empty git diff) — configured-hosts-only, credential-free, no redirect-follow, bounded timeout+body-cap all intact; a host reaches the fetch set only via the sanitized config file. |
| QA-25 | ✓ Pass | `package.json` runtime dependencies = `{}` (zero); `scripts.test` = `node --test` (no build step); the multi-host modules import only `node:`/relative; the fan-out uses `node:http`; the edit helper uses `node:child_process` + macOS `osascript` only. |
| QA-26 | ✓ Pass | Config-file read is on the poller tick (`pollOnce` L112, `readHostsConfig`), never the request path; `/api/hosts` is a pure `getCombined()` cache read (no fetch/subprocess/blocking I/O); the config write is in the badge process (out of the server); the request path gains no new work (server tests QA-26). |
| QA-27 | ✓ Pass | The tracked helper `host-config-action.mjs` rides the marker-gated wrapper/absolute-node model; `--setup-badge` does not modify the tracked plugin/helper; the plugin wires Add/Remove to `$ABS_NODE` against the tracked helper; `--remove-badge` reverses symmetrically leaving the tracked helper intact; SwiftBar never auto-installed; the setup message names the `hosts.conf` location. |
| QA-28 | ✓ Pass | Atomic temp+rename (`fs.writeFileSync(tmp,…,{mode:0o600})` then `fs.renameSync`), unique temp suffix (pid+counter) so overlapping writes don't collide; rename failure unlinks the temp then rethrows (honest "Nothing changed"). No partial file observable; last-write-wins, no lock (single-user tool, OQ-06). Zero temp leaks confirmed across every write in the round-trip check. |

**28 / 28 criteria PASS. 0 Fail, 0 Partial, 0 Deferred.**

---

## Independent Verification (the load-bearing behaviors)

The Engineer proved these via the harness; the Tester re-verified each with its own
scratch servers/peers/files under the session scratchpad — never touching `~/llmdash`,
the live 8787 service, or the real SwiftBar plugin dir.

1. **Single-host byte-for-byte (QA-13):** booted a real scratch server (port 8899,
   scratch data dir, no `hosts.conf`, `LLMDASH_HOSTS` unset), ran the real badge
   against it, and compared its `/api/hosts`-driven output to the shipped
   `emit(computeBadge(/api/state))` path → **byte-for-byte match**; `/api/hosts`
   returned one `self` host; no host chrome.

2. **Multi-host aggregation + glyph (QA-07/08/09/10):** booted two real fake peers
   (loopback, one binding at Claude-5h 12%, one at 45%) + an offline peer (dead
   port), wrote a scratch `hosts.conf`, booted the real aggregator, ran the real
   badge → glyph `▪ Desktop·C 12%`, binding-host-first, one section per host, offline
   host **named** ("Studio VM is unreachable — no response within 3s …"), no `0%`.

3. **Retain-on-live-removal LIVE (QA-03/16):** with the aggregator running (pid
   unchanged), a mid-run **append** to `hosts.conf` made the host appear+polled next
   tick; a mid-run **removal** dropped its cache entry next tick — proven live (file
   edited while the process ran), not a restart.

4. **Edit round-trip + hostile value (QA-15/16/23):** drove `addHost`/`removeHost`
   with injected values (no dialog) against a scratch file — valid append, malformed
   rejected (nothing written), duplicate deduped, local never removable, and a
   `| rm -rf ~` value **inert** (a sentinel file survived; nothing executed; zero
   temp leaks). Confirmed by inspection the AppleScript is a fixed literal and the
   value is ARGV-only.

5. **Precedence corners (QA-01/02/04):** drove `readHostsConfig` directly — file
   wins, seed-once, neither ⇒ single-host, empty-file ⇒ zero-remotes-no-reseed,
   malformed ⇒ `errors[]`, unreadable ⇒ env-seed fallback + log-once + no crash.

6. **Monitoring-station (QA-19/20):** drove `computeMultiBadge`/`emitMulti` over
   fixtures — auto-detect de-emphasizes an empty local (retained + "no local
   activity", never zeros); `include`/`exclude` produce different bindings (a real
   knob).

7. **Serve-only (QA-22/26):** live-probed the scratch server — headers present,
   POST/PUT/DELETE/PATCH → 405 `allow: GET, HEAD`, no write endpoint.

8. **/api/hosts contract guard (QA-12):** reasoned through the guard — it fails on a
   `state`→`payload` rename and asserts the **live producer** matches the consumer,
   so a field rename can't silently degrade the badge.

---

## Render Check

Per the project's "verify it RENDERS, not just loads" convention: the badge is a
**menu-bar stdout surface**, not a web page, so "render" here means the emitted
SwiftBar text is correct for each state. Captured stdout for **single-host**,
**multi-host binding**, **offline host**, and **monitoring-station** — all correct
(appended below). The dashboard's own multi-host web view is **unchanged** by this
feature (badge-only; `public/` untouched, `/api/state` byte-identical with/without
peers), so no browser sanity check was required. The **live in-menu-bar SwiftBar
render** and the **real `osascript` dialog** are deploy-time captures, deferred per
the badge's shipped delivery model (SPIKE-01 proved the mechanism; the in-menu-bar
screenshot is a post-ratification deploy step).

---

## Edge Cases Tested (beyond the core criteria)

- **Existing-but-empty `hosts.conf`** ⇒ zero remotes, env does NOT resurrect removed
  hosts (Remove genuinely sticks) — the corner that makes seed-once honest.
- **Unreadable file logs exactly ONCE** across repeated ticks (module latch), then
  re-arms on recovery — no per-tick log spam, no crash.
- **10-char host-cue truncation** in the glyph (`This machi…`), full label in the
  dropdown header — identity never hidden.
- **`!local=include`/`exclude` bind differently** with a tight local reading, proving
  the override is a real knob, not decorative.
- **Local host resolving from a typed `127.0.0.1`** is refused as a duplicate ("always
  included") rather than file-listed.
- **Offline host coexists** with reachable hosts — one host's degraded state never
  suppresses another's section, and the scope line counts it honestly ("Watching 4
  machines · 1 not reachable").

---

## Known Limitations (observations, not blockers)

- **The live in-menu-bar SwiftBar render + real `osascript` dialog are
  deploy-deferred** — verified via stdout and the SPIKE-01 detached-context proof,
  not a live menu-bar screenshot. This matches the badge's shipped deferral model;
  the Deployer should capture the in-menu-bar states after the user ratifies SwiftBar.
- **Concurrent-edit last-write-wins is by design (OQ-06)** — a lost concurrent add is
  acceptable and honest for a single-user tool (atomic rename guarantees no partial
  file; the badge refreshes to the current file). No lock; not a defect.
- **Monitoring-station de-emphasis ordering** places a reachable-with-reading local
  host (not an empty one) in the reachable batch, so on a normal (non-station) Mac
  "This machine" can appear second (right after the binding host) rather than in
  strict config order. This is consistent with the shipped ordering rule (binding
  first, then reachable, then offline, then de-emphasized-local last) — the
  de-emphasis-to-last only applies when the local host is actually de-emphasized.
  Noted for the record; the design spec flagged strict-config-order as a possible
  future user-feedback tweak.

---

## Convention Flags

Nothing new to standardize. The feature already honors the standing conventions it
touches (honest degradation, sanitize-at-the-door, clamp/normalize externally-sourced
values, serve-only/405, source-aware shared path, escape-at-render, zero-dep). The
one reusable QA discipline it exercises — proving `retainHosts` fires on a **live file
edit** and not only on restart — is already pinned as a risk the schema called out and
is covered by `tests/hosts-retain-live.test.js`; no CLAUDE.md change is warranted.

---

## Appendix — captured badge stdout (key states)

### Single-host / unconfigured (QA-13) — byte-for-byte today's badge

```
▪ X 99% | color=#5bd88a
▪ 99% remaining — Codex · 5-hour
---
Claude Code | size=13 color=#888888
5-hour:  not available | font=Menlo
Weekly:  not available | font=Menlo
---
Codex | size=13 color=#888888
5-hour:  99% · resets 4h 59m | font=Menlo
Weekly:  99% · resets 5d 20h | font=Menlo
---
Open dashboard | href=http://127.0.0.1:8899/
Refresh | refresh=true
```
(No host cue, no "Watching N machines", no Add/Remove actions — multi-host chrome is
off. Matches `emit(computeBadge(/api/state))` byte-for-byte.)

### Multi-host: Desktop binding + Work laptop + Studio VM offline (QA-07/08/09/10)

```
▪ Desktop·C 12% | color=#ff6b6b
▪ 12% remaining — Desktop · Claude Code · 5-hour
Watching 4 machines · 1 not reachable | size=12 color=#999999
---
Desktop  ▸ binding | size=13 color=#cccccc
Claude Code | size=12 color=#999999
5-hour:  12% · resets 2h 59m | font=Menlo
Weekly:  61% · resets 4d 3h | font=Menlo
Codex | size=12 color=#999999
5-hour:  88% · resets 3h 59m | font=Menlo
Weekly:  61% · resets 4d 23h | font=Menlo
---
This machine  · you | size=13 color=#cccccc
… (Claude not available / Codex rows) …
---
Work laptop | size=13 color=#cccccc
… (per-tool rows) …
---
Studio VM | size=13 color=#cccccc
Studio VM is unreachable — no response within 3s. Check the machine is awake and llmdash is running on 127.0.0.1:8813. Its limits aren't shown while it's offline; the other machines are unaffected. | size=12 color=#f0a94b
---
＋ Add host… | shell="…/node" param1="…/host-config-action.mjs" param2=add terminal=false refresh=true
－ Remove host…
--Stop watching Desktop (127.0.0.1:8811) | shell="…/node" param1="…/host-config-action.mjs" param2=remove param3="127.0.0.1:8811" terminal=false refresh=true
--Stop watching Work laptop (127.0.0.1:8812) | …
--Stop watching Studio VM (127.0.0.1:8813) | …
☰ Watching: 3 hosts | color=#999999
---
Open dashboard | href=http://127.0.0.1:8898/
Refresh | refresh=true
```

### Monitoring-station: empty local de-emphasized (QA-19/20)

```
▪ Desktop·C 22% | color=#f0a94b        ← binds the remote; empty local out of the glyph
… host sections …
This machine (pinned last, dimmed)
no local activity | size=12 color=#888888
This Mac isn't running Claude or Codex — it's watching the machines above. Kept out of the glyph so the machines you're watching stay loudest. No reading is fabricated. | size=11 color=#888888
```
(Retained + honestly labeled, never zeros. `!local=include` pulls it back into the
glyph; `!local=exclude` forces it out even with a reading — a real knob.)

### Local llmdash offline (server down) — never a number

```
▪ llmdash ⚠ | color=#8b8b8b
```
(Distinct from a single *remote* being down, which is a per-host dropdown line.)
