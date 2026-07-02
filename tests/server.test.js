import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
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
