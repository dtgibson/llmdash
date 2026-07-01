# Fix: fresh-install-no-usage-data

## What this does
A fresh install could show four empty gauges and misleading text with zero
explanation anywhere. Three stacked causes, all fixed:

1. **Installer baked a guaranteed-dead `codex` into the launchd plist.** When
   codex wasn't on PATH at install time, `install-macos.sh` fell back to the
   bare name `codex` — which can never resolve under launchd's minimal PATH
   (`/usr/bin:/bin:/usr/sbin:/sbin`). The installer now resolves codex to an
   **absolute path**, probing `~/.local/bin`, `/opt/homebrew/bin`, and
   `/usr/local/bin` when `command -v` fails. If it still can't be found it
   warns loudly, explains why a bare `codex` is dead under launchd, and says
   the fix (install Codex CLI, re-run the installer — safe to re-run). The
   plist template's comments now state the absolute-path requirement for
   hand-installers.
2. **The codex spawn failure was swallowed silently.** `src/codex-limits.js`
   now records a diagnostic (`ok` / `no-reading` / `codex-cmd-failed` with the
   errno) and logs the failure **once per distinct cause**, not every poll.
   `src/server.js` prints a startup **data-source health readout**: statusline
   reading present or not (with age), codex command resolvable or not, Codex
   sessions dir present or not — each missing source with its fix. All checks
   are cheap fs reads on the startup/poller path, never per HTTP request (the
   new `src/health.js` has no subprocess).
3. **The UI empty states lied.** `/api/state` now carries a per-tool
   `limitsDiagnostic`; `public/app.js` maps it to honest, actionable copy:
   Claude → "no statusline reading has arrived yet" plus what produces one
   (worded to stay true whatever the user's client does); Codex → "the
   configured codex command couldn't be run" with the exact env-var fix when
   that's the real cause, or a plain "no reading yet" otherwise. The false
   claims — "it doesn't record usage locally" (Codex does) and "the limits
   above are live" (they weren't) — are gone; the activity empty state now
   says no sessions have been recorded on this machine yet.

The end-of-install message now also sets expectations: Claude gauges stay
empty until a statusline reading arrives; the startup log names anything
missing. README updated to match. The Linux/systemd path had no installer
script to fix; the README's service instructions now state the absolute-path
requirement explicitly.

## How to test
1. `npm test` — 48 tests, including: installer codex resolution via the new
   `--resolve-codex` hook with controlled PATH/HOME; spawn-failure diagnostic
   + once-only logging; live-read happy path against a fake app-server;
   `/api/state` diagnostics; health readout copy; UI copy regression guards.
2. Simulated fresh install (no real dirs touched):
   ```
   mkdir -p /tmp/fresh/{data,claude,codex}
   env -i HOME="$HOME" PATH="/usr/bin:/bin:/usr/sbin:/sbin" \
     LLMDASH_HOST=127.0.0.1 LLMDASH_PORT=8899 \
     LLMDASH_DATA_DIR=/tmp/fresh/data LLMDASH_CLAUDE_DIR=/tmp/fresh/claude \
     LLMDASH_CODEX_DIR=/tmp/fresh/codex \
     "$(command -v node)" src/server.js
   ```
   Expect the "Data sources:" readout naming all three gaps, exactly one
   `codex limits: cannot run "codex" (ENOENT)` line, and at
   http://127.0.0.1:8899 three explanatory notes instead of silence.
3. Same command with `LLMDASH_CODEX_CMD=<absolute path to codex>` → readout
   says "codex command OK", Codex gauges show live percentages.
4. `bash scripts/install-macos.sh --resolve-codex` → prints the machine's
   absolute codex path (read-only; doesn't install anything).

## Seeing it locally (plain English)
1. Open a terminal in your project folder.
2. Run `npm start`.
3. The first lines printed are the new health readout — it tells you exactly
   which data sources are connected and how to fix any that aren't.
4. Open http://localhost:8787 in your browser. Any gauge without data now has
   a sentence under it explaining why and what to do — no more silent dashes.

## Notes for reviewer
- **Decision:** when codex is unresolvable at install time, the installer
  still writes `codex` into the plist (same as the config default) — but no
  longer *silently*: install-time warning + startup-log line + UI note all
  name the cause, and re-running the installer after installing codex bakes
  the absolute path. Leaving the service running-but-honest beats refusing to
  install.
- **Decision:** diagnostic reasons are sent as enum codes (`no-statusline-reading`,
  `codex-cmd-failed`, `no-reading`); the client maps codes to copy. Only `cmd`
  and `detail` (errno) cross as strings, and both are HTML-escaped.
- The Codex diagnostic is seeded from a static PATH check at module load, so
  the very first HTTP request is accurate even before the first poll finishes.
- Renderer diffed old-vs-new per convention (vm harness, stub DOM): full-data
  stat set byte-identical; fresh-install stat set identical, notes only.
- Known limitation: whether the user's Claude client renders the statusline is
  inferred, not proven — all copy says "no reading has arrived yet", which is
  true regardless. If codex exists but its app-server returns nothing, the UI
  says "no reading yet" rather than a false "command failed".
- Deploying to the installed copy (~/llmdash) is intentionally NOT done here —
  that's a later stage with explicit sign-off.
