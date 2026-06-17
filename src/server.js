import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { getDb, getLatestPerWindow } from './db.js';
import { readClaudeLimits } from './claude-limits.js';
import { computeActivity as computeClaudeActivity, projectWindow } from './stats.js';
import { computeCodexActivity } from './codex-stats.js';
import { buildTrends } from './trends.js';
import { startPoller } from './poller.js';

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

export function buildState(nowMs = Date.now()) {
  const claude = toolWrap('claude-code', 'Claude Code', 'Max',
    readClaudeLimits(), { ...computeClaudeActivity(nowMs), hasData: true }, nowMs);
  const codex = toolWrap('codex', 'Codex', 'ChatGPT Plus',
    null, computeCodexActivity(nowMs), nowMs);
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
  if (url.pathname === '/' || url.pathname === '/index.html') return serveStatic(res, 'index.html', head);
  if (url.pathname === '/styles.css') return serveStatic(res, 'styles.css', head);
  if (url.pathname === '/app.js') return serveStatic(res, 'app.js', head);
  res.writeHead(404);
  res.end(head ? undefined : 'not found');
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  getDb();
  startPoller();
  server.listen(config.port, config.host, () => {
    console.log(`llmdash running at http://${config.host}:${config.port}`);
    console.log(`On your phone/laptop, open http://<this-machine's-tailscale-name>:${config.port}`);
    if (config.host === '0.0.0.0') {
      console.log('Note: bound to all local interfaces (LAN + tailnet, not the public internet behind NAT). To restrict to the tailnet, set LLMDASH_HOST to your Tailscale IP.');
    }
  });
}

export { server };
