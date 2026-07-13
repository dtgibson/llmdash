import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { toolWrap, server } from '../src/server.js';

const iso = (ms) => new Date(ms).toISOString();

// One request against the real server, on an ephemeral port. Returns
// { status, headers, body }.
function hit(pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const srv = server.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      const req = http.request({ host: '127.0.0.1', port, path: pathname, method }, (res) => {
        let body = ''; res.setEncoding('utf8');
        res.on('data', (c) => body += c);
        res.on('end', () => srv.close(() => resolve({ status: res.statusCode, headers: res.headers, body })));
      });
      req.on('error', reject); req.end();
    });
  });
}

// Send an exact request over a socket so malformed request-targets are not
// normalized or rejected by the higher-level HTTP client first.
function rawHit(request) {
  return new Promise((resolve, reject) => {
    const srv = server.listen(0, '127.0.0.1', () => {
      const socket = net.createConnection({ host: '127.0.0.1', port: srv.address().port });
      let response = '';
      socket.setEncoding('utf8');
      socket.on('connect', () => socket.end(request));
      socket.on('data', (chunk) => { response += chunk; });
      socket.on('end', () => srv.close(() => resolve(response)));
      socket.on('error', (error) => srv.close(() => reject(error)));
    });
  });
}

test('malformed request targets return 400 instead of escaping the request callback', async () => {
  const response = await rawHit('GET http://[::1 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
  assert.match(response, /^HTTP\/1\.1 400 Bad Request\r\n/);
  assert.match(response.toLowerCase(), /x-content-type-options: nosniff/);
});

test('/api/hosts carries the baseline security headers and is no-store (QA-26)', async () => {
  const r = await hit('/api/hosts');
  assert.equal(r.status, 200);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['referrer-policy'], 'no-referrer');
  assert.match(r.headers['content-security-policy'], /default-src 'self'/);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.match(r.headers['content-type'], /application\/json/);
});

test('/api/hosts rejects non-GET/HEAD with 405 (QA-26)', async () => {
  const r = await hit('/api/hosts', 'POST');
  assert.equal(r.status, 405);
  assert.equal(r.headers['allow'], 'GET, HEAD');
});

test('/api/hosts returns the combined shape (hosts[] + generatedAt), a pure cache read', async () => {
  const r = await hit('/api/hosts');
  const body = JSON.parse(r.body);
  assert.ok(Array.isArray(body.hosts));
  assert.equal(typeof body.generatedAt, 'string');
});

test('/api/codex-insights is a bounded local-machine cache endpoint', async () => {
  const r = await hit('/api/codex-insights?range=24h');
  assert.equal(r.status, 200);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['referrer-policy'], 'no-referrer');
  assert.match(r.headers['content-security-policy'], /object-src 'none'/);
  assert.match(r.headers['content-security-policy'], /form-action 'none'/);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.match(r.headers['content-type'], /application\/json/);
  const body = JSON.parse(r.body);
  assert.equal(body.source, 'codex');
  assert.equal(body.scope, 'local-machine');
  assert.equal(body.range, '24h');
  assert.equal(typeof body.hasData, 'boolean');
  assert.equal(body.account.scope, 'account-wide');
  assert.ok(body.summary && body.mix && body.context && body.latency);
});

test('/api/codex-insights normalizes unknown ranges and supports HEAD', async () => {
  const bad = await hit('/api/codex-insights?range=constructor');
  assert.equal(JSON.parse(bad.body).range, '7d');
  const head = await hit('/api/codex-insights?range=30d', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
});

// ── HTTP stays read-only: NO config-write endpoint (NFR-01 / QA-22) ───────────
// multi-host-badge edits the host list via a LOCAL FILE the badge writes and the
// poller re-reads — never over HTTP. The tailnet-exposed bind must gain NO write
// surface: every mutating method on the plausible config paths is 405, and no
// write/mutation route exists.
test('no HTTP config-mutation endpoint: mutating methods on host paths are 405 (QA-22)', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    for (const p of ['/api/hosts', '/api/hosts/add', '/api/hosts/remove', '/api/config', '/api/state']) {
      const r = await hit(p, method);
      assert.equal(r.status, 405, `${method} ${p} must be 405 (read-only)`);
      assert.equal(r.headers['allow'], 'GET, HEAD');
    }
  }
});

test('the would-be write routes are not even GET-served (no write surface exists, QA-22)', async () => {
  // A GET to a made-up write route is a plain 404 — there is no add/remove handler
  // hiding behind a different method; the server never mutates config.
  for (const p of ['/api/hosts/add', '/api/hosts/remove', '/api/config']) {
    const r = await hit(p, 'GET');
    assert.equal(r.status, 404, `${p} must not exist as any handler`);
  }
});

// badge-display-options adds NO HTTP write endpoint either: the display prefs are
// written by the badge to the LOCAL hosts.conf (display-action.mjs), never over
// HTTP. Any plausible display-write route stays 405 (mutating method) / 404 (GET).
test('no HTTP display-mutation endpoint: display write paths are 405/404 (serve-only preserved)', async () => {
  for (const p of ['/api/display', '/api/display/set', '/api/config/display']) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const r = await hit(p, method);
      assert.equal(r.status, 405, `${method} ${p} must be 405 (read-only)`);
      assert.equal(r.headers['allow'], 'GET, HEAD');
    }
    const g = await hit(p, 'GET');
    assert.equal(g.status, 404, `${p} must not exist as any handler`);
  }
});

// Static source guard: the server source references no fs write of the host
// config — the only host-config writer is the badge process (host-config.js
// atomic write), never an HTTP handler (QA-22 / NFR-04).
test('server.js source contains no host-config write path (write lives in the badge, QA-22)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(here, '..', 'src', 'server.js'), 'utf8');
  assert.doesNotMatch(src, /writeHostsConfig|addHost|removeHost|writeFileSync/,
    'the server must not write the host config; that is the badge process only');
});

// ── menubar-service-controls: HTTP stays read-only, NO service/uninstall endpoint
// (NFR-04 / QA-24 / QA-28). Every mutation is a local launchctl/fs op in the badge
// process — the server grows no endpoint and never runs launchctl/uninstall work.
test('no HTTP service/uninstall endpoint: mutating methods on service paths are 405 (QA-24)', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    for (const p of ['/api/service', '/api/uninstall', '/api/service/install', '/api/service/remove']) {
      const r = await hit(p, method);
      assert.equal(r.status, 405, `${method} ${p} must be 405 (read-only)`);
      assert.equal(r.headers['allow'], 'GET, HEAD');
    }
  }
});

test('the would-be service/uninstall routes are not GET-served either (no such handler, QA-24)', async () => {
  for (const p of ['/api/service', '/api/uninstall', '/api/service/status']) {
    const r = await hit(p, 'GET');
    assert.equal(r.status, 404, `${p} must not exist as any handler`);
  }
});

test('server.js source runs no launchctl / uninstall work on the request path (QA-28)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(here, '..', 'src', 'server.js'), 'utf8');
  assert.doesNotMatch(src, /launchctl|bootout|bootstrap|service-control-action|--service|--uninstall/,
    'the server never touches launchctl or the uninstall path; that is the badge process only');
});

test('toolWrap exposes a per-window projection (five_hour + seven_day shown at once)', () => {
  const now = Date.UTC(2026, 0, 4, 0, 0, 0);
  const live = {
    capturedAt: iso(now),
    windows: {
      five_hour: { usedPct: 50, resetsAt: iso(now + 3 * 3600_000) },
      seven_day: { usedPct: 90, resetsAt: iso(now + 2 * 24 * 3600_000) },
    },
  };
  const t = toolWrap('claude-code', 'Claude Code', 'Max', live, { hasData: false }, now);
  assert.ok(t.projection && typeof t.projection === 'object');
  assert.ok('five_hour' in t.projection && 'seven_day' in t.projection);
  assert.equal(typeof t.projection.five_hour.hitsBeforeReset, 'boolean');
  assert.equal(typeof t.projection.seven_day.hitsBeforeReset, 'boolean');
});

test('a window with no reset time yields a null projection for that window only', () => {
  const now = Date.UTC(2026, 0, 4, 0, 0, 0);
  const live = {
    capturedAt: iso(now),
    windows: {
      five_hour: { usedPct: 40, resetsAt: iso(now + 3 * 3600_000) },
      seven_day: { usedPct: 88, resetsAt: null }, // a reading, but no reset time
    },
  };
  const t = toolWrap('codex', 'Codex', 'ChatGPT Plus', live, { hasData: false }, now);
  assert.ok(t.projection.five_hour); // has a reading + reset → projected
  assert.equal(t.projection.seven_day, null); // no reset → honest null, not a guess
});

test('toolWrap exposes model-specific limits without affecting account windows', () => {
  const now = Date.UTC(2026, 0, 4, 0, 0, 0);
  const reset = iso(now + 2 * 24 * 3600_000);
  const live = {
    capturedAt: iso(now),
    windows: {
      five_hour: { usedPct: 40, resetsAt: iso(now + 3 * 3600_000) },
      seven_day: { usedPct: 20, resetsAt: reset },
    },
    modelLimits: [{
      source: 'claude-model:sonnet',
      provider: 'claude-code',
      model: 'sonnet',
      label: 'Sonnet',
      window: 'seven_day',
      usedPct: 95,
      remainingPct: 999,
      resetsAt: reset,
      capturedAt: iso(now),
    }],
  };
  const t = toolWrap('claude-code', 'Claude Code', 'Max', live, { hasData: false }, now);
  assert.equal(t.limits.seven_day.usedPct, 20, 'account-wide weekly reading stays account-wide');
  assert.deepEqual(t.modelLimits, [{
    source: 'claude-model:sonnet',
    provider: 'claude-code',
    model: 'sonnet',
    label: 'Sonnet',
    window: 'seven_day',
    usedPct: 95,
    remainingPct: 5,
    resetsAt: reset,
    capturedAt: iso(now),
  }]);
});
