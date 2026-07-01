# Bug Brief — fresh-install-no-usage-data

## What is broken
A fresh install shows no limit data for either tool and misleading text, all silently. Three stacked causes: (1) the installer falls back to a bare `codex` command in the launchd plist when codex isn't on PATH at install time — under launchd's minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) that spawn can never resolve, and the failure is swallowed with zero logging; (2) Claude limits depend on the Claude Code statusline actually rendering — the installer wires it correctly, but if the user's sessions never invoke it (e.g. desktop app), the gauges stay "waiting for a reading" forever with no explanation anywhere; (3) the Codex empty-activity note lies twice: "it doesn't record usage locally" (Codex does) and "the limits above are live" (they show em-dashes). Claude *activity* stats actually work.

## Steps to reproduce
1. On a Mac where `codex` is not yet on PATH, run `scripts/install-macos.sh` (plist gets `LLMDASH_CODEX_CMD=codex`); install Codex CLI afterwards to `~/.local/bin` but run no Codex session.
2. Use Claude Code only through a client that never renders the CLI statusline, so `data/claude-ratelimits.json` is never written.
3. Open http://localhost:8787 — all four gauges read "— % / waiting for a reading", every pacing row says "limit data not available yet", Codex shows the false "doesn't record usage locally… limits above are live" note.
4. Check `/tmp/llmdash.log` and `/tmp/llmdash.err` — no hint of the codex spawn failure or the missing ratelimits file.

## Expected behavior
Installer warns loudly when `codex` can't be resolved to an absolute path (bare `codex` is guaranteed-dead under launchd) and states that Claude limit gauges stay empty until a statusline-rendering Claude Code session runs. Server startup log surfaces data-source health (ratelimits file missing, codex command unresolvable). UI empty states are honest and actionable: "no reading yet — statusline not reporting" / "codex command not found" / "no Codex sessions recorded yet", never claims live limits that aren't. With a correct absolute codex path, live limits appear (verified: `~/.local/bin/codex app-server` returns `rateLimits` on RPC `account/rateLimits/read`).

## Blast radius
`scripts/install-macos.sh` (codex detection, warnings, end-of-install messaging), `macos/com.llmdash.dashboard.plist.example` comments, `src/codex-limits.js` (surface spawn ENOENT instead of silent null; possibly resolve codex from common install dirs), `src/server.js` startup health log, `public/app.js` `toolHtml`/`gaugeHtml` empty-state copy (keep the honest-UI convention; don't fabricate data), README setup docs, plus tests in `tests/`. The Linux/systemd path shares the absolute-path concern (config.js already hints at it). Diff the rendered stat set when touching the renderer per project convention.

## What done looks like
A simulated fresh install with an unresolvable codex command produces a visible startup-log warning and an honest UI state naming the cause; re-running the installer with codex present bakes the absolute path and live Codex limits render. Claude gauges without a statusline reading say what's missing and how to get it, while Claude activity keeps rendering. The false Codex empty-note copy is gone.
