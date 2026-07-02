import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

// Resolve a command the way spawn() will: a path (contains a separator) is
// checked directly; a bare name is searched on PATH. Returns the resolved
// path or null. Pure fs checks — no subprocess — so it is safe on the
// startup/poller path (and is exactly why a bare "codex" under launchd's
// minimal PATH resolves to null: the binary isn't in /usr/bin:/bin:...).
export function resolveCommand(cmd, envPath = process.env.PATH || '') {
  if (!cmd) return null;
  if (cmd.includes(path.sep)) {
    try { fs.accessSync(cmd, fs.constants.X_OK); return cmd; } catch { return null; }
  }
  for (const dir of envPath.split(path.delimiter)) {
    if (!dir) continue;
    const fp = path.join(dir, cmd);
    try { fs.accessSync(fp, fs.constants.X_OK); return fp; } catch {}
  }
  return null;
}

// One honest snapshot of where each data source stands. Cheap fs checks only;
// meant for the startup log (and tests) — not for the HTTP request path.
export function dataSourceHealth(nowMs = Date.now()) {
  let ratelimits = { present: false, ageMs: null };
  try {
    const st = fs.statSync(config.rateLimitsFile);
    ratelimits = { present: true, ageMs: Math.max(0, nowMs - st.mtimeMs) };
  } catch {}
  let sessionsPresent = false;
  try { sessionsPresent = fs.statSync(config.codexSessionsDir).isDirectory(); } catch {}
  return {
    claudeRatelimits: { file: config.rateLimitsFile, ...ratelimits },
    codexCmd: { cmd: config.codexCmd, resolved: resolveCommand(config.codexCmd) },
    codexSessions: { dir: config.codexSessionsDir, present: sessionsPresent },
  };
}

function fmtAge(ms) {
  if (ms == null) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'under a minute ago';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Compact duration for threshold copy ("5m", "10m", "1h 30m").
function fmtDurShort(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return `${Math.round(ms / 1000)}s`;
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

// The branch-B refresh-mode statement for the startup log (FR-12). States the
// manual-refresh reality and surfaces the one freshness knob with its default
// and the derived stale band (surface-defaults convention). There is no
// auto-refresh: the spike showed a prompt-free session never reports limits.
export function freshnessModeLine(cfg = config) {
  return `Claude limit readings refresh only when a real Claude Code session renders its status line (the desktop app doesn't). `
    + `A reading older than ${fmtDurShort(cfg.claudeMaxAgeMs)} shows as aging, older than ${fmtDurShort(cfg.claudeStaleAfterMs)} as stale `
    + `(LLMDASH_CLAUDE_MAX_AGE_MS, default 300000 ms = 5m; the stale band is always 2x that).`;
}

// Startup-log lines describing data-source health. Honest and actionable:
// each "missing" line says what is missing, why it matters, and how to fix it.
export function healthLines(h = dataSourceHealth()) {
  const lines = ['Data sources:'];
  lines.push(h.claudeRatelimits.present
    ? `  Claude limits:  statusline reading present (updated ${fmtAge(h.claudeRatelimits.ageMs)}; marked stale after ${fmtDurShort(config.claudeStaleAfterMs)}) — ${h.claudeRatelimits.file}. Readings refresh only when a real Claude Code session renders its status line.`
    : `  Claude limits:  no statusline reading yet — gauges stay empty until a Claude Code session renders its status line (writes ${h.claudeRatelimits.file})`);
  lines.push(h.codexCmd.resolved
    ? `  Codex limits:   codex command OK (${h.codexCmd.resolved})`
    : `  Codex limits:   codex command not found ("${h.codexCmd.cmd}") — live limits unavailable. Set LLMDASH_CODEX_CMD to the absolute path from 'which codex' and restart (the macOS installer does this when re-run).`);
  lines.push(h.codexSessions.present
    ? `  Codex activity: sessions dir present (${h.codexSessions.dir})`
    : `  Codex activity: no Codex sessions recorded on this machine yet (${h.codexSessions.dir}) — activity stats fill in after the first Codex session`);
  return lines;
}
