# QA Report — fresh-install-no-usage-data

**Date:** 2026-07-01
**Test Runner:** node:test (`npm test`)
**Result:** PASSED

## Test Suite Results
48 tests passing, 0 failing, 0 skipped (duration ~5.4s).

Notably, the installer test "exits non-zero when codex cannot be resolved
anywhere" genuinely ran on this machine (its skip guard only fires when a
system-wide codex exists in `/opt/homebrew/bin` or `/usr/local/bin`; neither
does here — the machine's codex lives in `~/.local/bin`, which the test
sandboxes away via a controlled `HOME`).

## Acceptance Criteria Verification

Verified against the bug brief's Steps to reproduce / Expected behavior /
What done looks like. End-to-end runs used sandboxed data dirs, a launchd-like
minimal `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, spare ports (8897–8899), and a
fabricated Claude transcript — the real `~/.claude`, `~/.codex`, `~/llmdash`,
the launchd service, and port 8787 were never touched.

| Criterion | Result | Notes |
|---|---|---|
| Repro step 1–4 rerun: fresh install (bare `codex`, minimal PATH, no statusline reading, no Codex sessions) is no longer silent | ✓ Pass | Live server on :8898: startup stdout prints the 3-line "Data sources:" readout naming every missing source with its fix; stderr has the codex ENOENT line. Nothing is silent anymore. |
| Installer warns loudly when `codex` can't be resolved to an absolute path | ✓ Pass | Resolution logic exercised by 3 real-spawn tests (PATH hit, `~/.local/bin` fallback, nowhere → exit 1). Warning branch text verified by inspection (`scripts/install-macos.sh:66-77`); full installer intentionally not executed (would modify the real service — see Known Limitations). |
| Installer probes `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin` before giving up | ✓ Pass | Probe order confirmed in `resolve_codex()`; `~/.local/bin` fallback proven by test with controlled HOME. |
| `--resolve-codex` hook prints the machine's absolute codex path, read-only | ✓ Pass | Printed `/Users/developer/.local/bin/codex`, exit 0. Real plist mtime+size byte-identical before/after; `launchctl list` state unchanged. Hook exits before any install step. |
| Installer states Claude gauges stay empty until a statusline-rendering session runs | ✓ Pass | End-of-install "What to expect on first run" block (inspection) + README updated to match. |
| Server startup log surfaces data-source health (ratelimits file missing, codex unresolvable, sessions dir missing) | ✓ Pass | Verified live in both directions: fresh install → all three named missing with fixes; healthy → "statusline reading present (updated 1m ago)", "codex command OK (<abs path>)", "sessions dir present". |
| Codex spawn failure logged, once per cause (not every poll) | ✓ Pass | Live server polled every 1.2s for ~8s: exactly 1 `codex limits: cannot run "codex" (ENOENT)` line. Unit test also locks once-per-cause + re-arm on recovery. |
| `/api/state` carries honest per-tool reason codes | ✓ Pass | Fresh: claude `{reason:"no-statusline-reading"}`, codex `{reason:"codex-cmd-failed", cmd:"codex", detail:"ENOENT"}`. Healthy: both `null`. Codex diag correct even before first poll (seeded static check, unit-tested). |
| UI empty states are honest and actionable, naming the cause | ✓ Pass | **Real browser** (embedded preview): Claude note "No statusline reading has arrived yet — …renders its status line…"; Codex note names the exact command, ENOENT, and the `LLMDASH_CODEX_CMD` fix; activity empty state "No Codex sessions have been recorded on this machine yet…". Zero console errors/warnings. |
| The false copy is gone ("doesn't record usage locally", "the limits above are live") | ✓ Pass | Static regression test + absent from both rendered pages. |
| Never claims live limits that aren't | ✓ Pass | Empty gauges say "waiting for a reading"; pacing rows say "limit data not available yet"; no liveness claim anywhere in the fresh state. |
| With a correct absolute codex path, live limits appear | ✓ Pass | Fake app-server at an absolute path answering the documented JSON-RPC: gauges rendered 58%/93% remaining live in the real browser, notes disappeared, diag null, readout OK. (Real `codex app-server` RPC against the user's account deliberately not spawned by QA; the brief records it was verified directly in Stage 1.) |
| Re-running the installer with codex present bakes the absolute path | ✓ Pass | Composite mechanism proven: `resolve_codex` (tested live) → `CODEX_BIN` → `sed s#CODEX_PATH#…#` (`install-macos.sh:87`) → plist placeholder locked by test in both files. Full re-run not executed (real service). |
| Claude activity keeps rendering next to the no-reading note | ✓ Pass | Real browser, fresh state: 23k tokens/hr, 57k tokens (5h/today/week), 2 sessions, 86% cache hit, $0.10 value, full token-mix bar — all real numbers directly under the empty gauges + note. |
| Plist template comments state the absolute-path requirement | ✓ Pass | `macos/com.llmdash.dashboard.plist.example` diff verified; README systemd section states it for Linux too. |

## Edge Cases Tested
- **Out-of-range external percentages clamped end to end:** fake codex reporting
  `usedPercent: 250` and `-5` → `/api/state` shows 100/0 and 0/100. Live server, not just unit level.
- **Maxed window is binding per window:** with five_hour clamped to 100 (0 remaining),
  the seven_day projection was still produced — one maxed window does not suppress the other.
- **Once-per-cause logging under repeated polls:** ~8 poll cycles, one log line.
- **Security/regression sweep on the changed server:** `nosniff`, `no-referrer` CSP
  (`script-src` still effectively `'self'` via `default-src`), `cache-control: no-store` on
  HTML/JS/API; POST and DELETE → 405 with `allow: GET, HEAD`; unknown path → 404;
  `/api/trends` 200 with real per-day data (the 57k day renders as labeled SVG bars — the
  blank-bar regression class checked in a real browser, not a page-loads check).
- **No dependency / build-step creep:** package.json has no dependencies section at all;
  scripts unchanged (`start`/`statusline`/`test`).
- **Renderer stat-set diff:** locked by the new renderer-contract test; full-data render
  visually confirmed identical stat set with notes only added in empty states.

## Known Limitations
- **Pre-existing cosmetic bug (not a regression):** an empty amber headroom strip renders
  below the header even when `#headroom` has `hidden` set, because
  `.headroom { display: flex; … }` (`public/styles.css:129`) overrides the UA `[hidden]`
  rule. `public/styles.css` is untouched by this fix; the strip appears identically pre-fix.
  Worth a one-line follow-up (`#headroom[hidden] { display: none; }` or a class toggle).
- The full installer was **not executed end to end** — it writes the real plist and
  reloads the real launchd service, which QA is barred from touching. The unresolvable-codex
  warning branch is verified by inspection plus tested resolution logic, not by execution.
- Live Codex limits were proven against a **fake app-server** speaking the documented
  protocol at an absolute path, not the real codex binary (avoids QA touching the real
  ChatGPT account). Stage 1 verified the real binary's RPC directly.
- Whether a user's Claude client renders the statusline remains inferred, not proven —
  the shipped copy ("no reading has arrived yet") stays true either way, as designed.
- QA harness note: the real-browser check used the embedded preview harness, which requires
  a `.claude/launch.json` in the repo; it was created temporarily and deleted, and
  `git status` afterward shows exactly the Engineer's change set and nothing else.

## Convention Flags
- Diagnostic reasons cross the API as **enum reason codes** (`no-statusline-reading`,
  `codex-cmd-failed`, `no-reading`) with the client mapping codes to copy, and only
  escaped `cmd`/`detail` strings crossing as text. This pattern (server knows the cause,
  client never guesses, no prose over the wire) is worth adopting as a standing rule for
  any future empty/error state in the multi-source UI.
