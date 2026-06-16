import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { getDb, getLatestPerWindow } from './db.js';
import { readClaudeLimits } from './claude-limits.js';
import { computeActivity, projectFiveHour } from './stats.js';
import { startPoller } from './poller.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

// Baseline hardening headers. Content is first-party and static, so a tight
// default-src 'self' policy is safe and adds defense-in-depth.
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; base-uri 'none'; frame-ancestors 'none'",
};

function serveStatic(res, file, head = false) {
  const fp = path.join(publicDir, file);
  if (!fp.startsWith(publicDir)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(fp, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(head ? undefined : buf);
  });
}

// Assemble everything the dashboard needs in one payload.
export function buildState(nowMs = Date.now()) {
  const live = readClaudeLimits();              // freshest reading (statusline)
  const stored = getLatestPerWindow('claude-code'); // fallback: last persisted
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
      usedPct,
      remainingPct: Math.max(0, 100 - usedPct),
      resetsAt,
      capturedAt,
    };
  }

  const activity = computeActivity(nowMs);
  const projection = windows.five_hour && windows.five_hour.resetsAt
    ? projectFiveHour(windows.five_hour.usedPct, Date.parse(windows.five_hour.resetsAt), nowMs)
    : null;

  const caps = ['five_hour', 'seven_day']
    .map(w => windows[w] && windows[w].capturedAt)
    .filter(Boolean)
    .map(Date.parse);
  const dataAt = caps.length ? new Date(Math.max(...caps)).toISOString() : null;

  return {
    source: 'claude-code',
    limits: windows,
    haveLimits: !!(windows.five_hour || windows.seven_day),
    activity,
    projection,
    dataAt,
    generatedAt: new Date(nowMs).toISOString(),
  };
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
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(head ? undefined : JSON.stringify(buildState()));
  }
  if (url.pathname === '/' || url.pathname === '/index.html') return serveStatic(res, 'index.html', head);
  if (url.pathname === '/styles.css') return serveStatic(res, 'styles.css', head);
  if (url.pathname === '/app.js') return serveStatic(res, 'app.js', head);
  res.writeHead(404);
  res.end(head ? undefined : 'not found');
});

// Only start listening when run directly (lets tests import buildState).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  getDb();
  startPoller();
  server.listen(config.port, config.host, () => {
    console.log(`llmdash running at http://${config.host}:${config.port}`);
    console.log(`On your phone/laptop, open http://<this-machine's-tailscale-name>:${config.port}`);
    if (config.host === '0.0.0.0') {
      console.log('Note: bound to all local interfaces (LAN + tailnet, not the public internet behind NAT). To restrict strictly to the tailnet, set LLMDASH_HOST to your Tailscale IP.');
    }
  });
}

export { server };
