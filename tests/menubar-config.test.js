import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, runPlugin, loadFixture } from './helpers/menubar-run.js';

// Configurable host/port (FR-14 + the Stage-4 configurable-HOST addition):
// LLMDASH_BADGE_HOST and LLMDASH_PORT are the ONLY config surface, and each
// drives BOTH the fetch target and the Open-dashboard href for real (no dead
// knob). Verified end to end: the plugin is pointed at a scratch server on the
// overridden host:port and its emitted output is read back. The plugin is
// spawned async so this process's event loop stays live to serve the fetch.

test('LLMDASH_PORT drives BOTH the fetch target and the Open-dashboard href', async () => {
  let hitPath = null;
  const srv = await startServer((req, res) => {
    hitPath = req.url;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(loadFixture('state-fresh')));
  });
  const r = await runPlugin({ LLMDASH_BADGE_HOST: '127.0.0.1', LLMDASH_PORT: String(srv.port) });
  await srv.close();
  assert.equal(r.status, 0);
  assert.equal(hitPath, '/api/state');                       // fetch hit the overridden port
  assert.match(r.stdout.split('\n')[0], /^▪ C \d+% \|/);     // rendered a real reading, not offline
  assert.match(r.stdout, new RegExp(`Open dashboard \\| href=http://127\\.0\\.0\\.1:${srv.port}/`)); // href matches
});

test('LLMDASH_BADGE_HOST override changes both the fetch target and the href', async () => {
  // 127.0.0.2 is a loopback alias on macOS; bind the scratch server there and
  // point the badge host at it — proving the host override drives the real fetch.
  const HOST = '127.0.0.2';
  let served = false;
  let srv;
  try {
    srv = await startServer((req, res) => {
      served = true;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(loadFixture('state-fresh')));
    }, HOST);
  } catch {
    // Platform can't bind the alias: still prove HOST drives the href via the
    // offline path (a dead port) rather than skipping the coverage entirely.
    const r = await runPlugin({ LLMDASH_BADGE_HOST: HOST, LLMDASH_PORT: '65533' });
    assert.match(r.stdout, /href=http:\/\/127\.0\.0\.2:65533\//);
    return;
  }
  const r = await runPlugin({ LLMDASH_BADGE_HOST: HOST, LLMDASH_PORT: String(srv.port) });
  await srv.close();
  assert.equal(r.status, 0);
  assert.ok(served, 'the scratch server on the overridden host was actually hit');
  assert.match(r.stdout, new RegExp(`Open dashboard \\| href=http://127\\.0\\.0\\.2:${srv.port}/`));
});

test('the default host is 127.0.0.1 when LLMDASH_BADGE_HOST is unset/empty', async () => {
  // Point at a definitely-dead port so it lands offline, and read the href — it
  // reflects the DEFAULT host (127.0.0.1) and the given port, proving the
  // `|| '127.0.0.1'` fallback drives the URL.
  const r = await runPlugin({ LLMDASH_BADGE_HOST: '', LLMDASH_PORT: '65534' });
  assert.match(r.stdout, /href=http:\/\/127\.0\.0\.1:65534\//);
});
