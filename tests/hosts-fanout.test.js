import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchPeerState } from '../src/hosts.js';
import { pollPeers } from '../src/poller.js';
import { _reset, _peek, getCombined } from '../src/host-cache.js';

// A scratch loopback fake peer serving a crafted /api/state — the badge's
// harness pattern, generalized. Runs in THIS process, so callers await against
// a live event loop. Returns { port, close }.
function startPeer(handler, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const srv = http.createServer(handler);
    srv.once('error', reject);
    srv.listen(0, host, () => resolve({ port: srv.address().port, close: () => new Promise((r) => srv.close(r)) }));
  });
}

const FAST = 500; // a tight timeout so timeout tests don't drag
const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();
const validState = () => ({
  tools: [{
    source: 'claude-code', label: 'Claude Code', plan: 'Max', haveLimits: true,
    limits: {
      five_hour: { usedPct: 62, remainingPct: 38, resetsAt: iso(3 * 3600_000), capturedAt: iso(-30_000) },
      seven_day: { usedPct: 36, remainingPct: 64, resetsAt: iso(3 * 86400_000), capturedAt: iso(-30_000) },
    },
    projection: { five_hour: null, seven_day: null },
    activity: { hasData: true, tokens: { last5h: 1, week: 2, today: 3 }, sessionsToday: 1, cacheHitRate: 0.9, tokenMix: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } },
    freshness: { capturedAt: iso(-30_000), freshForMs: 300_000, staleAfterMs: 600_000 },
    limitsDiagnostic: null, dataAt: iso(-30_000),
  }],
  headroom: null, generatedAt: iso(0),
});

test('success: 200 + valid JSON caches a normalized reading', async () => {
  const peer = await startPeer((req, res) => {
    assert.equal(req.url, '/api/state'); // only /api/state is ever requested
    assert.equal(req.method, 'GET');     // read-only
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(validState()));
  });
  const r = await fetchPeerState('127.0.0.1', peer.port, { timeoutMs: FAST });
  await peer.close();
  assert.equal(r.ok, true);
  assert.equal(r.state.tools[0].source, 'claude-code');
  assert.equal(r.state.tools[0].limits.five_hour.usedPct, 62);
});

test('non-200 → peer-error (http-<status>), not a crash (QA-09)', async () => {
  const peer = await startPeer((req, res) => { res.writeHead(500); res.end('boom'); });
  const r = await fetchPeerState('127.0.0.1', peer.port, { timeoutMs: FAST });
  await peer.close();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'peer-error');
  assert.equal(r.cause, 'http-500');
});

test('bad JSON body → peer-error (bad-json) (QA-09)', async () => {
  const peer = await startPeer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{not json'); });
  const r = await fetchPeerState('127.0.0.1', peer.port, { timeoutMs: FAST });
  await peer.close();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'peer-error');
  assert.equal(r.cause, 'bad-json');
});

test('a well-formed JSON with the WRONG shape → peer-error (unusable), never fabricated (QA-22)', async () => {
  const peer = await startPeer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ nope: true })); });
  const r = await fetchPeerState('127.0.0.1', peer.port, { timeoutMs: FAST });
  await peer.close();
  assert.equal(r.ok, false);
  assert.equal(r.cause, 'bad-json');
});

test('a redirect (3xx) is NOT followed → peer-error (redirect) (QA-24)', async () => {
  let secondHit = false;
  // The redirect target: a second server the read must NEVER reach.
  const evil = await startPeer((req, res) => { secondHit = true; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(validState())); });
  const peer = await startPeer((req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${evil.port}/api/state` });
    res.end();
  });
  const r = await fetchPeerState('127.0.0.1', peer.port, { timeoutMs: FAST });
  await peer.close(); await evil.close();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'peer-error');
  assert.equal(r.cause, 'redirect');
  assert.equal(secondHit, false, 'the redirect target must not be fetched (no bounce to an unconfigured host)');
});

test('an oversized body is aborted at the cap → peer-error (oversized) (QA-25)', async () => {
  // Stream far more than the cap; the fetch must abort, not buffer it all.
  const peer = await startPeer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    const chunk = 'x'.repeat(64 * 1024);
    let sent = 0;
    const pump = () => {
      if (sent > 4 * 1024 * 1024) { res.end(); return; }
      if (!res.write(chunk)) { res.once('drain', pump); } else { sent += chunk.length; setImmediate(pump); }
      sent += chunk.length;
    };
    pump();
  });
  const r = await fetchPeerState('127.0.0.1', peer.port, { timeoutMs: 2000, bodyCapBytes: 16 * 1024 });
  await peer.close();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'peer-error');
  assert.equal(r.cause, 'oversized');
});

test('a hung peer is bounded by the timeout → peer-unreachable (timeout), never hangs (QA-08)', async () => {
  const peer = await startPeer(() => { /* never responds */ });
  const t0 = Date.now();
  const r = await fetchPeerState('127.0.0.1', peer.port, { timeoutMs: FAST });
  const elapsed = Date.now() - t0;
  await peer.close();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'peer-unreachable');
  assert.equal(r.cause, 'timeout');
  assert.ok(elapsed < FAST + 1500, `bounded: took ${elapsed}ms`);
});

test('connection refused (nothing listening) → peer-unreachable (connect) (QA-09)', async () => {
  const peer = await startPeer((req, res) => res.end());
  const deadPort = peer.port;
  await peer.close(); // release the port
  const r = await fetchPeerState('127.0.0.1', deadPort, { timeoutMs: FAST });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'peer-unreachable');
  assert.equal(r.cause, 'connect');
});

test('pollPeers: one slow/hung peer does not stop the fast peers or accumulate in-flight (QA-08, QA-13)', async () => {
  _reset();
  const good = await startPeer((req, res) => { res.writeHead(200); res.end(JSON.stringify(validState())); });
  const hung = await startPeer(() => { /* never responds */ });
  const remotes = [
    { host: '127.0.0.1', port: good.port, label: 'Good', key: `127.0.0.1:${good.port}`, self: false },
    { host: '127.0.0.1', port: hung.port, label: 'Hung', key: `127.0.0.1:${hung.port}`, self: false },
  ];
  // Use the real fetch with a short timeout via a wrapper so the hung peer
  // resolves quickly to unreachable.
  const fetchImpl = (h, p, o) => fetchPeerState(h, p, { ...o, timeoutMs: FAST });
  const t0 = Date.now();
  await pollPeers(remotes, Date.now(), fetchImpl);
  const elapsed = Date.now() - t0;
  await good.close(); await hung.close();
  assert.ok(elapsed < FAST + 2000, `fan-out bounded: ${elapsed}ms`);
  const g = _peek(`127.0.0.1:${good.port}`);
  const h = _peek(`127.0.0.1:${hung.port}`);
  assert.equal(g.reachable, true, 'the fast peer rendered despite the hung one');
  assert.equal(h.reachable, false, 'the hung peer is a named offline state');
  assert.equal(h.hostDiagnostic.reason, 'peer-unreachable');
  assert.equal(h.state, null, 'offline-only: no fabricated reading');
  _reset();
});

test('static assertion: only pollOnce/pollPeers reference fetchPeerState — never an HTTP handler (QA-05/QA-21)', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const server = fs.readFileSync(path.join(here, '..', 'src', 'server.js'), 'utf8');
  const poller = fs.readFileSync(path.join(here, '..', 'src', 'poller.js'), 'utf8');
  assert.doesNotMatch(server, /fetchPeerState/, 'server.js (the request path) must not call fetchPeerState');
  assert.match(poller, /fetchPeerState/, 'the poller owns the fan-out');
  // The /api/hosts handler must be a pure cache read (getCombined), no fetch.
  assert.match(server, /getCombined\(\)/);
});

test('getCombined is a pure cache read (no fetch/subprocess) and reflects setHost writes', async () => {
  _reset();
  const good = await startPeer((req, res) => { res.writeHead(200); res.end(JSON.stringify(validState())); });
  const remotes = [{ host: '127.0.0.1', port: good.port, label: 'Good', key: `127.0.0.1:${good.port}`, self: false }];
  await pollPeers(remotes, Date.now(), (h, p, o) => fetchPeerState(h, p, { ...o, timeoutMs: FAST }));
  await good.close();
  const combined = getCombined();
  assert.ok(Array.isArray(combined.hosts));
  assert.equal(combined.hosts[0].label, 'Good');
  assert.equal(combined.hosts[0].state.tools[0].source, 'claude-code');
  _reset();
});
