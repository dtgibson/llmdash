import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { getDb, getLatestPerWindow } from './db.js';
import { readClaudeLimits } from './claude-limits.js';
import { getRefreshState } from './claude-refresh.js';
import { codexLimitsDiagnostic } from './codex-limits.js';
import { healthLines, freshnessModeLine, peerDisclosureLine, hostsConfigLine } from './health.js';
import { computeActivity as computeClaudeActivity, projectWindow } from './stats.js';
import { computeCodexActivity } from './codex-stats.js';
import { buildTrends } from './trends.js';
import { startPoller } from './poller.js';
import { tailnetIPv4 } from './net.js';
import { getCombined, setHost } from './host-cache.js';
import { parseHosts } from './hosts.js';
import { readHostsConfig } from './host-config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

// Baseline hardening headers. Content is first-party and static.
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  // style-src allows inline styles (dynamic bar widths / chart colors); script
  // stays locked to 'self' and no user input reaches style values.
  'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
};

function serveStatic(res, file, head = false) {
  const fp = path.join(publicDir, file);
  if (!fp.startsWith(publicDir)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(fp, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {
      'content-type': MIME[path.extname(fp)] || 'application/octet-stream',
      'cache-control': 'no-store', // personal tool — always serve the latest assets
    });
    res.end(head ? undefined : buf);
  });
}

// Assemble one tool's state. `live` is a fresh reading (Claude reads its statusline
// file cheaply per request); pass null to use the last stored snapshot instead
// (Codex, whose live read happens in the poller, not per request).
export function toolWrap(source, label, plan, live, activity, nowMs) {
  const stored = getLatestPerWindow(source);
  const windows = {};
  for (const w of ['five_hour', 'seven_day']) {
    let usedPct = null, resetsAt = null, capturedAt = null;
    if (live && live.windows[w]) {
      ({ usedPct, resetsAt } = live.windows[w]);
      capturedAt = live.capturedAt;
    } else {
      const s = stored.find(r => r.window === w);
      if (s) { usedPct = Number(s.used_pct); resetsAt = s.resets_at; capturedAt = s.captured_at; }
    }
    windows[w] = usedPct == null ? null : {
      usedPct, remainingPct: Math.max(0, 100 - usedPct), resetsAt, capturedAt,
    };
  }
  // Both windows get a pacing projection (5-hour and weekly), shown at once.
  // windowHours is a per-window code constant; project only when a window has a
  // reading and a reset time, else null — an honest "not available", not a guess.
  const projectFor = (w, windowHours) => (windows[w] && windows[w].resetsAt)
    ? projectWindow(windows[w].usedPct, Date.parse(windows[w].resetsAt), nowMs, windowHours)
    : null;
  const projection = { five_hour: projectFor('five_hour', 5), seven_day: projectFor('seven_day', 168) };
  const caps = ['five_hour', 'seven_day']
    .map(w => windows[w] && windows[w].capturedAt).filter(Boolean).map(Date.parse);
  const dataAt = caps.length ? new Date(Math.max(...caps)).toISOString() : null;
  return { source, label, plan, haveLimits: !!(windows.five_hour || windows.seven_day), limits: windows, projection, activity, dataAt };
}

// The cross-tool "where do I switch" cue: fires when a tool's tightest window
// (5-hour OR weekly) is low or maxed and another tool has more headroom.
export function computeHeadroom(tools) {
  const summarize = (t) => {
    let tightest = null, windowName = '';
    for (const [w, name] of [['five_hour', '5-hour'], ['seven_day', 'weekly']]) {
      const win = t.limits[w];
      if (!win) continue;
      if (tightest == null || win.remainingPct < tightest) { tightest = win.remainingPct; windowName = name; }
    }
    return tightest == null ? null : { label: t.label, source: t.source, tightest, windowName };
  };
  const withData = tools.map(summarize).filter(Boolean);
  if (withData.length < 2) return null;
  const low = withData.reduce((a, b) => b.tightest < a.tightest ? b : a);
  const best = withData.reduce((a, b) => b.tightest > a.tightest ? b : a);
  if (low.tightest >= 20 || best.source === low.source) return null;
  return {
    lowLabel: low.label, lowWindow: low.windowName, lowRemaining: Math.floor(low.tightest),
    bestLabel: best.label, bestRemaining: Math.floor(best.tightest),
    maxed: low.tightest <= 0,
  };
}

// `refresh` is injectable for tests; the default is the live auto-refresh
// mechanism state maintained by the poller (src/claude-refresh.js).
export function buildState(nowMs = Date.now(), refresh = getRefreshState()) {
  const claude = toolWrap('claude-code', 'Claude Code', 'Max',
    readClaudeLimits(), { ...computeClaudeActivity(nowMs), hasData: true }, nowMs);
  const codex = toolWrap('codex', 'Codex', 'ChatGPT Plus',
    null, computeCodexActivity(nowMs), nowMs);
  // Reading-age freshness (claude only; codex is not retrofitted). The client
  // derives the fresh/aging/stale band live from these server-supplied
  // thresholds — the thresholds live here, the ticking happens there. Cheap
  // date math only: no subprocess, no poller work on this path.
  claude.freshness = {
    capturedAt: claude.dataAt,
    freshForMs: config.claudeMaxAgeMs,
    staleAfterMs: config.claudeStaleAfterMs,
  };
  codex.freshness = null;
  // When a tool has no limit data — or the data it has is stale — say WHY (the
  // server knows; the client shouldn't guess). Exactly one reason code or null,
  // in precedence order (FR-18): auto-refresh-failing > auto-refresh-disabled >
  // stale-reading / no-statusline-reading. The auto-refresh codes fire only
  // while the reading is stale or absent AND their condition holds — 3+
  // consecutive probe failures, or the off-switch. Zero attempts means zero
  // failures, so a fresh install still shows the existing codes (first-run
  // honesty, FR-19). Gauges keep rendering the last capture in every state —
  // flagged, never blanked. Codex's diagnostic is maintained by the poller
  // (no subprocess on this path).
  {
    const ageMs = claude.dataAt ? nowMs - Date.parse(claude.dataAt) : null;
    const staleReading = ageMs != null && ageMs > config.claudeStaleAfterMs;
    const staleOrAbsent = !claude.haveLimits || staleReading;
    const ageFields = claude.haveLimits && claude.dataAt ? { capturedAt: claude.dataAt, ageMs } : {};
    if (staleOrAbsent && refresh.consecutiveFailures >= 3) {
      claude.limitsDiagnostic = { reason: 'auto-refresh-failing', cause: refresh.lastFailureCause, ...ageFields };
    } else if (staleOrAbsent && refresh.disabled) {
      claude.limitsDiagnostic = { reason: 'auto-refresh-disabled', ...ageFields };
    } else if (!claude.haveLimits) {
      claude.limitsDiagnostic = { reason: 'no-statusline-reading' };
    } else {
      claude.limitsDiagnostic = staleReading
        ? { reason: 'stale-reading', capturedAt: claude.dataAt, ageMs }
        : null;
    }
  }
  if (codex.haveLimits) {
    codex.limitsDiagnostic = null;
  } else {
    const d = codexLimitsDiagnostic();
    codex.limitsDiagnostic = d.reason === 'codex-cmd-failed'
      ? { reason: d.reason, cmd: d.cmd, detail: d.detail }
      : { reason: 'no-reading' };
  }
  const tools = [claude, codex];
  return { tools, headroom: computeHeadroom(tools), generatedAt: new Date(nowMs).toISOString() };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    return res.end('method not allowed');
  }
  const head = req.method === 'HEAD';

  if (url.pathname === '/api/state') {
    let body;
    try { body = JSON.stringify(buildState()); }
    catch (e) { res.writeHead(500); return res.end('error'); }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(head ? undefined : body);
  }
  if (url.pathname === '/api/trends') {
    const range = url.searchParams.get('range') || '7d';
    let body;
    try { body = JSON.stringify(buildTrends(range)); }
    catch (e) { res.writeHead(500); return res.end('error'); }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(head ? undefined : body);
  }
  // Multi-host combined view. A PURE cache read (getCombined) — no peer fetch,
  // no subprocess, no blocking I/O on the request path (the poller maintains the
  // cache). /api/state above is untouched. When no peers are configured the
  // cache holds one host (the local one), so this returns single-host data.
  if (url.pathname === '/api/hosts') {
    let body;
    try { body = JSON.stringify(getCombined()); }
    catch (e) { res.writeHead(500); return res.end('error'); }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(head ? undefined : body);
  }
  if (url.pathname === '/' || url.pathname === '/index.html') return serveStatic(res, 'index.html', head);
  if (url.pathname === '/styles.css') return serveStatic(res, 'styles.css', head);
  if (url.pathname === '/app.js') return serveStatic(res, 'app.js', head);
  res.writeHead(404);
  res.end(head ? undefined : 'not found');
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  getDb();
  // Data-source health readout: which sources are feeding the dashboard and,
  // when one isn't, why and how to fix it. Startup-only cheap fs checks —
  // never on the HTTP request path.
  for (const line of healthLines()) console.log(line);
  // Surface-defaults convention: state the refresh reality and the freshness
  // knob (with its default and the derived stale band) loudly at startup.
  console.log(freshnessModeLine());
  // Host-config disclosure (multi-host-badge): which host SOURCE is in effect
  // (the hosts.conf file / an env seed / neither), the file path, and the
  // ignored-LLMDASH_HOSTS-because-file-exists note — stated honestly at startup.
  console.log(hostsConfigLine());
  // Multi-host disclosure: how many peers are configured and to which host:ports
  // outbound reads will go (or the single-host / no-outbound reality). Derived
  // from the config FILE (seed-once precedence) so it matches what the poller
  // reads from tick zero, not config.hostsRaw directly.
  const startupCfg = readHostsConfig();
  const startupParsed = parseHosts(startupCfg.raw);
  console.log(peerDisclosureLine(startupParsed));
  // Seed the local host into the combined-view cache synchronously so
  // /api/hosts is never briefly empty before the first poller tick lands. Echo the
  // !local= directive onto the local reading so the badge's monitoring-station
  // override is live from tick zero.
  {
    const local = startupParsed.hosts.find((h) => h.self);
    if (local) setHost(local.key, {
      host: local.host, label: local.label, port: local.port, self: true,
      reachable: true, hostDiagnostic: null,
      fetchedAt: new Date().toISOString(),
      localMode: startupCfg.localMode || 'auto',
      state: buildState(),
    });
  }
  startPoller();
  server.listen(config.port, config.host, () => {
    console.log(`llmdash running at http://${config.host}:${config.port}`);
    const tailnetIp = tailnetIPv4();
    // Only advertise the tailnet URL when the bind actually serves it: all
    // interfaces (0.0.0.0), or a host explicitly pinned to the tailnet IP.
    // Bound to loopback or a LAN IP, the tailnet address is unreachable, so
    // stay silent rather than print a real-looking but dead URL.
    if (config.host === '0.0.0.0' || config.host === tailnetIp) {
      console.log(tailnetIp
        ? `On another tailnet device, open http://${tailnetIp}:${config.port} (use http, not https)`
        : `On another tailnet device, open http://<your-tailscale-ip>:${config.port} (find the IP with 'tailscale ip -4'; use http, not https)`);
    }
    if (config.host === '0.0.0.0') {
      console.log('Note: bound to all local interfaces (LAN + tailnet, not the public internet behind NAT). To restrict to the tailnet, set LLMDASH_HOST to your Tailscale IP.');
    }
  });
}

export { server };
