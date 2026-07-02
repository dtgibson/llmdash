# QA Report — Statusline Auto-Refresh (Branch B: honest freshness layer)

**Date:** 2026-07-01
**Test Runner:** node:test (`npm test`)
**Result:** PASSED

Branch B build: the applicable Success Metrics rows are QA-14–QA-21, QA-24,
QA-25, QA-27. All [A]-only rows are inapplicable by design; QA-24 verifies the
[A] machinery is absent. All verification below was performed independently on
a sandboxed live server (port 8897/8896, all data paths redirected via
`LLMDASH_*` env overrides into a scratch directory) — the installed service on
8787, `~/llmdash`, `~/.claude`, and `~/.codex` were never touched (8787
confirmed still serving 200 after QA).

## Test Suite Results

71 tests passing, 0 failing (0 cancelled/skipped). Includes the new
`claude-freshness` (13 tests) and `branch-b-guard` (4 tests) suites, plus the
extended `app-copy`, `health`, and `state-diagnostics` suites.

## Acceptance Criteria Verification

| Criterion | Result | Notes |
|---|---|---|
| QA-14 Health readout: reading age + stale band + manual-refresh reality | ✓ Pass | Live startup log: "statusline reading present (updated under a minute ago; marked stale after 10m) — <file>. Readings refresh only when a real Claude Code session renders its status line." Plus the FR-12 mode line naming `LLMDASH_CLAUDE_MAX_AGE_MS`, the 300000 default, and the 2× rule. |
| QA-15 README: branch-B reality, bands, knob + default, remedy; no auto-spawn claims | ✓ Pass | "Reading freshness" section documents the manual-refresh reality, the 5m/10m bands, the knob with default `300000` and the non-configurable 2× stale band, and the CLI remedy; knob also in the Configuration list. Zero auto-spawn/auto-refresh claims (grep + guard test). |
| QA-16 Fresh band (2m) | ✓ Pass | Real browser: header sub `Max · updated 2m ago`, no pill, no warning styling anywhere in the block, no note, gauges normal (66%/88%). |
| QA-17 Aging band (7m) | ✓ Pass | Real browser: warn pill, DOM text `aging` (uppercased by CSS), header `Max · updated 7m ago [AGING]`. The string "stale" appears nowhere in the block's rendered text **or** its HTML/classes. No note; gauges and pacing untouched. |
| QA-18 Stale band (75m) — real browser render required | ✓ Pass | Verified in a real browser: the word "stale" present in rendered text (crit pill `STALE` + note). Note renders exactly between `.gauges` and `.burn`. Gauges still render 66%/88% with full bars, opacity 1 — never blanked or dimmed. Verified in light and dark (`--crit`/`--crit-bg` tokens flip correctly) and at 375×812 (pill fits, no horizontal overflow, `.tool-head` wraps). No console errors or warnings. |
| QA-19 Nudge names the remedy | ✓ Pass | Stale note copy is the verbatim spec string: "**Stale reading** — updated 1h 15m ago; the limits above may have moved since. Open a Claude Code CLI session to refresh the reading (the desktop app doesn't render the statusline that reports these limits)." Age at hour scale renders h+m per the fmtAge extension. |
| QA-20 `stale-reading` code while gauges render | ✓ Pass | Live `/api/state`: `{reason:"stale-reading", capturedAt, ageMs}` with `haveLimits: true` and the last capture intact in `limits`. `freshness: {capturedAt, freshForMs: 300000, staleAfterMs: 600000}` always present on claude; `null` on codex. |
| QA-21 Exactly one reason code or null | ✓ Pass | Contrived each band live: fresh → `null`, aging → `null` (band is client-derived; server silent), stale → exactly `stale-reading`, no reading ever → exactly `no-statusline-reading` with no stale fields. Precedence/exclusivity also unit-tested with deterministic `nowMs` (boundary exactly `staleAfterMs` is not stale — strict `>`). |
| QA-24 Zero [A] machinery | ✓ Pass | `LLMDASH_CLAUDE_AUTOREFRESH` / `LLMDASH_CLAUDE_REFRESH_TIMEOUT_MS` / `LLMDASH_CLAUDE_CMD` exist nowhere in runtime surfaces (only in the guard test asserting their absence). The only `child_process` site in the codebase is the pre-existing `src/codex-limits.js`. Startup log states the manual-refresh reality. Guard test locks all of this. |
| QA-25 Fresh-install honesty | ✓ Pass | Real browser against a clean data dir: header sub is plan-only (`Max`), no fabricated age, both gauges "waiting for a reading", pacing rows "limit data not available yet", note ends "Open a Claude Code CLI session to capture the first reading." No "stale" anywhere. |
| QA-27 Zero dependencies | ✓ Pass | `package.json` declares no `dependencies` or `devDependencies` keys at all; guard test asserts it stays that way. |
| Regression: Codex block untouched | ✓ Pass | Old (HEAD) vs new `toolHtml` executed on identical `/api/state` payloads with a pinned clock: **byte-identical** codex render in both the cmd-failed state and a synthesized full-data state at minute-scale age (normal operation — the poller refreshes codex every 60s). No pill, no note, no "stale" in the live codex block (`freshness: null`). See Known Limitations for the hour-scale `fmtAge` precision delta. |
| Regression: fresh-state Claude block unchanged | ✓ Pass | Same old-vs-new byte-compare: fresh-state Claude render byte-identical. Only rendered deltas in any state are the age pill and the stale note. |
| Regression: activity stats, trends, serving | ✓ Pass | `src/stats.js`/`src/codex-stats.js`/`src/trends.js`/`src/poller.js` untouched by the diff; `/api/trends` serves; renderer-contract test (stat-set diff) passes. |
| Regression: security headers / 405 / no-store | ✓ Pass | `nosniff`, `referrer-policy`, CSP (`script-src` self, `style-src` inline) on all responses; POST → 405 with `allow: GET, HEAD`; `cache-control: no-store` on static and API; traversal probe → 404. |
| Regression: 1s ticker updates ages live | ✓ Pass | Observed a live fresh → aging crossing: pill appeared while exactly **one** `/api/state` fetch had occurred since page load (i.e. between fetches, on the render tick, no reload). Header age and note age re-derive per tick. |

## Edge Cases Tested

- **Malformed `capturedAt`** (missing or `"not-a-date"`): falls back to file
  mtime, never re-stamped to "now" — a 20-minute-old malformed file reads
  `stale-reading` at the API (live + unit). The pre-fix eternal-freshness bug
  is dead.
- **Knob garbage/zero/negative** (`garbage`, `0`, `-5000`): live server serves
  `freshForMs: 300000 / staleAfterMs: 600000` and the startup line says 5m/10m.
  Custom `120000` honored (120000/240000, startup line "older than 2m … 4m"
  with the default still stated).
- **Clock skew (future `capturedAt`, +5m):** server diagnostic `null`; UI
  renders "just now" (header and page-level age), no pill, no negative age
  anywhere.
- **Band boundary:** age exactly `staleAfterMs` is not stale (strict `>`,
  deterministic unit test).
- **File deleted after snapshots exist:** `toolWrap` falls back to the stored
  SQLite snapshot with its own `capturedAt`, and the freshness treatment
  applies to that age — the "no reading ever" state is correctly reserved for
  genuinely fresh installs. Honest, coherent fallback.

## Known Limitations

Observations, not blockers:

- **Note lags pill by up to 60s** (approved contract): the pill crosses bands
  on the 1s tick; the stale note appears/disappears on the 60s fetch because
  the server owns the diagnostic.
- **`fmtAge` hour-scale precision is shared:** the spec-mandated h+m extension
  ("updated 2h 35m ago") also applies to the Codex header sub and the
  page-level freshness indicator when a reading is over an hour old. At
  minute-scale ages (normal operation) the Codex render is byte-identical;
  the PR's "byte-identical" claim holds everywhere except this hour-scale
  wording, which is a precision improvement, not a staleness retrofit.
- **Startup health readout ages by file mtime** (pre-existing behavior): in
  real operation mtime equals capture time; only a hand-fabricated file can
  diverge the two. The API/UI path uses `capturedAt` proper.
- **Pre-existing, out of scope (already flagged by the Engineer as a separate
  task):** the empty headroom strip renders as a visible empty bar when
  `hidden` (`.headroom { display: flex }` defeats the attribute). Present at
  HEAD before this change; visible in QA screenshots.

## Convention Flags

- When a shared formatting helper changes (e.g. `fmtAge`), verify every call
  site's rendered surface — this feature's Claude-focused age-format extension
  also reaches the Codex header sub and the page-level freshness indicator.
  A "diff the rendered stat set" pass should enumerate helper call sites, not
  just the feature's own block.
