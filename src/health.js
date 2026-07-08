import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { config } from '../config.js';
import { parseHosts, remoteHosts } from './hosts.js';
import { _peek } from './host-cache.js';
import { configFileHealth } from './host-config.js';

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
    claudeCmd: { cmd: config.claudeCmd, resolved: resolveCommand(config.claudeCmd) },
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

// The refresh-mode statement for the startup log (FR-28). States the shipped
// mechanism (the /usage probe), its activity-gated cadence with the one
// freshness knob and its default, the off-switch, and the two disclosed
// Claude-file side effects (surface-defaults convention: loudly, at startup).
export function freshnessModeLine(cfg = config) {
  const threshold = fmtDurShort(cfg.claudeMaxAgeMs);
  const staleBand = fmtDurShort(cfg.claudeStaleAfterMs);
  const bands = `A reading older than ${threshold} shows as aging, older than ${staleBand} as stale `
    + `(LLMDASH_CLAUDE_MAX_AGE_MS, default 300000 ms = 5m; the stale band is always 2x that).`;
  if (!cfg.claudeAutoRefresh) {
    return `Claude limit auto-refresh is OFF (LLMDASH_CLAUDE_AUTOREFRESH=0) — readings arrive only when a real Claude Code session renders its status line; unset the variable and restart to re-enable. ${bands}`;
  }
  return `Claude limit readings auto-refresh: when the reading is older than ${threshold} while Claude has been active within ${staleBand} (newest transcript under ${cfg.projectsDir}), `
    + `llmdash spawns a short-lived Claude Code session in ${cfg.claudeRefreshCwd}, reads its /usage screen, and closes it — no message is sent and no plan usage is consumed. `
    + `Real statusline captures still count and suppress the probe; off-switch: LLMDASH_CLAUDE_AUTOREFRESH=0. `
    + `Heads-up: Claude Code itself keeps a one-time "trust this folder" entry for that directory in ~/.claude.json and appends one line to ~/.claude/history.jsonl per refresh. ${bands}`;
}

// Multi-host startup disclosure (FR-19): how many peers are configured and to
// which host:ports this instance will issue outbound reads — or, when none, the
// single-host / no-outbound reality. Mirrors the network-binding disclosure.
// `parsed` is injectable for tests.
export function peerDisclosureLine(parsed = parseHosts()) {
  const remotes = remoteHosts(parsed);
  if (!remotes.length) {
    return 'Multi-host: no peers configured (LLMDASH_HOSTS unset) — this instance issues no outbound reads (single-host). Set LLMDASH_HOSTS to a comma-separated host[:port][=label] list to aggregate other tailnet machines.';
  }
  const targets = remotes.map((r) => `${r.host}:${r.port}`).join(', ');
  const n = remotes.length;
  let line = `Multi-host: ${n} peer${n === 1 ? '' : 's'} configured — this instance issues a read-only GET /api/state to ${targets} on each ${Math.round(config.pollIntervalMs / 1000)}s poll (tailnet-only, credential-free, no discovery).`;
  if (parsed.errors && parsed.errors.length) {
    const bad = parsed.errors.map((e) => `"${e.entry}" (${e.reason})`).join(', ');
    line += ` Ignored ${parsed.errors.length} malformed entr${parsed.errors.length === 1 ? 'y' : 'ies'}: ${bad} — fix the format (host[:port][=label]) and restart.`;
  }
  return line;
}

// Per-configured-peer health lines for the startup readout (FR-19). Reads each
// peer's LAST cached state (a cheap in-memory read, off the request path — no
// fresh fetch, no subprocess); names reachable/last-error and the fix. Emitted
// only when peers are configured. `parsed`/`peek` injectable for tests.
export function peerHealthLines(parsed = parseHosts(), peek = _peek) {
  const remotes = remoteHosts(parsed);
  const lines = [];
  if (remotes.length) {
    lines.push('Hosts:');
    for (const r of remotes) {
      const entry = peek(r.key);
      const addr = `${r.host}:${r.port}`;
      if (!entry || entry.pending) {
        lines.push(`  ${r.label} (${addr}): not yet polled — reachability fills in after the first poll tick.`);
      } else if (entry.reachable) {
        lines.push(`  ${r.label} (${addr}): reachable — last read ${fmtAge(Date.now() - Date.parse(entry.fetchedAt))}.`);
      } else {
        const d = entry.hostDiagnostic || {};
        lines.push(`  ${r.label} (${addr}): unreachable (${d.reason || 'peer-unreachable'}${d.cause ? ` · ${d.cause}` : ''}) — check the machine is awake and llmdash is running on ${addr}.`);
      }
    }
  }
  for (const e of (parsed.errors || [])) {
    lines.push(`  malformed host entry "${e.entry}" (${e.reason}) — ignored; fix the format host[:port][=label] and restart.`);
  }
  return lines;
}

// Config-file disclosure line (FR-21): which host SOURCE is in effect — the
// hosts.conf FILE, an env seed (LLMDASH_HOSTS, file absent), or neither (single-
// host) — plus the file path, an ignored-LLMDASH_HOSTS-because-file-exists note,
// and any unreadable/malformed-directive state with the fix. A cheap fs check
// (configFileHealth), off the request path. `health` is injectable for tests.
export function hostsConfigLine(health = configFileHealth()) {
  const loc = health.file;
  if (health.error && health.error.reason === 'unreadable') {
    return `Host config: hosts.conf is UNREADABLE (${health.error.detail || 'read failed'}) at ${loc} — `
      + `falling back to LLMDASH_HOSTS/last-good. Fix the file's permissions/contents and it is re-read on the next poll (no restart).`;
  }
  let line;
  if (health.source === 'file') {
    line = `Host config: reading the watched-host list from ${loc} (this file is the runtime source of truth; edited live by the badge or by hand).`;
    if (health.envIgnored) {
      line += ` LLMDASH_HOSTS is set but IGNORED because the file exists (it only seeds the file on first run when absent) — edit ${loc} to change what's watched.`;
    }
  } else if (health.source === 'env-seed') {
    line = `Host config: no hosts.conf yet — seeding it from LLMDASH_HOSTS at ${loc} (once seeded, the file becomes the runtime source of truth; later LLMDASH_HOSTS edits are ignored).`;
  } else {
    line = `Host config: no hosts.conf and LLMDASH_HOSTS unset — single-host (this machine only, no outbound reads). Add a host from the menu-bar badge, or create ${loc} (format host[:port][=label], one per line).`;
  }
  if (health.localMode && health.localMode !== 'auto') {
    line += ` Monitoring-station: !local=${health.localMode} in the config file (local host ${health.localMode === 'exclude' ? 'always de-emphasized' : 'always shown in the glyph/headline'}).`;
  }
  // Badge display prefs (badge-display-options, FR-20): name the current display
  // setting so a badge that isn't showing today's glyph is explained, not a
  // mystery — including the group + tool-mark axes and the ratified default-cue
  // change (the neutral marks ◆/▲ replaced the C/X letters as the default cue).
  line += ` ${displayDisclosure(health.display)}`;
  for (const e of (health.fileErrors || [])) {
    line += ` Ignored a bad directive "${e.entry}" (${e.reason}) — valid: !local=include|exclude|auto, !display-hosts=all|host:port,…, !display-layout=single|side-by-side|alternating, !display-density=wide|compact, !display-group=host|tool, !display-tool-mark=neutral|logo.`;
  }
  return line;
}

// Name the badge display setting for the disclosure line (badge-display-options).
// Default (all/single/wide/host/neutral) reads as "default (today's glyph)"; any
// non-default axis is named. Always notes the ratified default tool cue (◆ Claude
// / ▲ Codex, upgraded from C/X) — a visible default change is never silent.
export function displayDisclosure(display = null) {
  const d = display || {};
  const hosts = d.hosts || 'all';
  const layout = d.layout || 'single';
  const density = d.density || 'wide';
  const group = d.group || 'host';
  const toolMark = d.toolMark || 'neutral';
  const isDefault = (hosts === 'all') && layout === 'single' && density === 'wide'
    && group === 'host' && toolMark === 'neutral';
  const cueNote = 'The default tool cue is the neutral mark ◆ Claude / ▲ Codex (it replaced the C/X letters).';
  if (isDefault) {
    return `Badge display: default glyph (all hosts, single tightest unit, wide text glyph, grouped by host). ${cueNote}`;
  }
  const hostsStr = hosts === 'all' ? 'all hosts' : `hosts ${Array.isArray(hosts) ? hosts.join(',') : hosts}`;
  return `Badge display: glyph group=${group}, ${hostsStr}, layout=${layout}, density=${density}, tool-mark=${toolMark} (glyph only; the dropdown still lists every host in full. Set from the badge's Display submenu or edit the !display-* directives in the config file). ${cueNote}`;
}

// Service-state disclosure line (menubar-service-controls, FR-22 / OQ-05): names
// the launchd agent's on-disk presence and what a complete uninstall would touch,
// stating that llmdash.db is PRESERVED by default. A cheap fs check (plist present?
// + the resolved checkout), off the request path — consistent with the other
// disclosure lines. `probe` is injectable for tests (avoids reading the real
// LaunchAgents dir / homedir). macOS-only surface; on Linux the plist is simply
// absent, which reads honestly as "no launchd agent on this machine".
export function serviceStateLine(probe = null) {
  const label = process.env.LLMDASH_SERVICE_LABEL || 'com.llmdash.dashboard';
  const home = os.homedir();
  const laDir = process.env.LLMDASH_LAUNCH_AGENTS_DIR
    || path.join(home, 'Library', 'LaunchAgents');
  const plist = path.join(laDir, `${label}.plist`);
  const checkout = process.env.LLMDASH_DIR || path.join(home, 'llmdash');
  let present;
  if (probe && typeof probe.plistPresent === 'boolean') present = probe.plistPresent;
  else { try { present = fs.existsSync(plist); } catch { present = false; } }
  const scope = `a complete uninstall (from the menu-bar badge) would remove this checkout (${probe && probe.checkout ? probe.checkout : checkout}), the badge wrapper, the statusline wiring, and the auto-refresh trust folder — preserving llmdash.db by default (deleting it is a separate, explicit opt-in).`;
  return present
    ? `  Service: launchd agent present (${label}, plist at ${plist}) — the menu-bar badge can install/remove or uninstall it; ${scope}`
    : `  Service: no launchd agent plist on disk (${plist}) — the menu-bar badge's "Install the local service" can (re)create it; ${scope}`;
}

// Startup-log lines describing data-source health. Honest and actionable:
// each "missing" line says what is missing, why it matters, and how to fix it.
export function healthLines(h = dataSourceHealth()) {
  const lines = ['Data sources:'];
  lines.push(h.claudeRatelimits.present
    ? `  Claude limits:  statusline reading present (updated ${fmtAge(h.claudeRatelimits.ageMs)}; marked stale after ${fmtDurShort(config.claudeStaleAfterMs)}) — ${h.claudeRatelimits.file}. Readings arrive when a real Claude Code session renders its status line, and via auto-refresh within minutes of Claude activity.`
    : `  Claude limits:  no statusline reading yet — gauges fill in when a Claude Code session renders its status line, or when auto-refresh captures one after Claude activity (writes ${h.claudeRatelimits.file})`);
  lines.push(!config.claudeAutoRefresh
    ? `  Claude refresh: auto-refresh disabled (LLMDASH_CLAUDE_AUTOREFRESH=0) — readings refresh only via real Claude Code sessions; unset the variable and restart to re-enable`
    : h.claudeCmd.resolved
      ? `  Claude refresh: claude command OK (${h.claudeCmd.resolved}) — auto-refresh can probe /usage when the reading goes stale during Claude activity`
      : `  Claude refresh: claude command not found ("${h.claudeCmd.cmd}") — auto-refresh can't run, so a stale reading stays stale until a real CLI session refreshes it. Set LLMDASH_CLAUDE_CMD to the absolute path from 'which claude' and restart (the macOS installer does this when re-run).`);
  lines.push(h.codexCmd.resolved
    ? `  Codex limits:   codex command OK (${h.codexCmd.resolved})`
    : `  Codex limits:   codex command not found ("${h.codexCmd.cmd}") — live limits unavailable. Set LLMDASH_CODEX_CMD to the absolute path from 'which codex' and restart (the macOS installer does this when re-run).`);
  lines.push(h.codexSessions.present
    ? `  Codex activity: sessions dir present (${h.codexSessions.dir})`
    : `  Codex activity: no Codex sessions recorded on this machine yet (${h.codexSessions.dir}) — activity stats fill in after the first Codex session`);
  // Host-config-file state (multi-host-badge): which source is in effect and the
  // fix for an unreadable/misconfigured file. A cheap fs check, off the request path.
  lines.push(`  ${hostsConfigLine()}`);
  // Service-state disclosure (menubar-service-controls): the launchd agent's
  // presence + what a complete uninstall would touch, DB-preserved-by-default.
  lines.push(serviceStateLine());
  // Per-configured-peer reachability (multi-host). Cheap in-memory cache read;
  // empty when no peers are configured (single-host).
  for (const line of peerHealthLines()) lines.push(line);
  return lines;
}
