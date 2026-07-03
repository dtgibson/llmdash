import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.js';
import { pollOnce } from '../src/poller.js';
import { _reset, _peek, getCombined } from '../src/host-cache.js';
import { _resetConfigErrorLatch } from '../src/host-config.js';

// FR-03 / QA-03 / QA-16 — the runtime-apply half: the poller re-reads the hosts.conf
// FILE each tick, so a LIVE file edit reconciles the host set without a restart.
// This is THE behavior schema.md pins as "prove it fires on a live edit, not just
// restart": add a host to the file → polled + present next tick; remove one → its
// cache entry dropped by retainHosts next tick, no longer polled.
//
// Driven against a scratch data dir (config.dataDir repointed) and REAL loopback
// peer servers (the same real-http path the fan-out uses), so pollOnce's real
// readHostsConfig → parseHosts → seedOrder → retainHosts → pollPeers chain runs
// end to end. The real data dir, the live service, and SwiftBar are never touched.

// A minimal /api/state peer so a live loopback host actually returns a reading.
function startPeer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/api/state') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({
          tools: [{
            source: 'claude-code', label: 'Claude Code', plan: 'Max',
            limits: { five_hour: { usedPct: 40, remainingPct: 60, resetsAt: null, capturedAt: null } },
            freshness: null,
          }],
          headroom: null, generatedAt: new Date().toISOString(),
        }));
      }
      res.writeHead(404); res.end('nope');
    });
    server.listen(0, '127.0.0.1', () => resolve({
      port: server.address().port,
      close: () => new Promise((r) => server.close(r)),
    }));
  });
}

test('retain-on-live-removal: add to the file ⇒ polled next tick; remove ⇒ cache entry dropped next tick (QA-03/16)', async () => {
  const savedDataDir = config.dataDir;
  const savedHostsRaw = config.hostsRaw;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-retain-'));
  const file = path.join(dir, 'hosts.conf');
  const peerA = await startPeer();
  const peerB = await startPeer();
  const keyA = `127.0.0.1:${peerA.port}`;
  const keyB = `127.0.0.1:${peerB.port}`;

  try {
    _reset();
    _resetConfigErrorLatch();
    config.dataDir = dir;      // config.hostsFile getter now points at our scratch file
    config.hostsRaw = '';      // no env seed — the FILE is the sole source

    // Tick 1: only peer A in the file.
    fs.writeFileSync(file, `127.0.0.1:${peerA.port}=Alpha\n`);
    await pollOnce();
    let combined = getCombined();
    let keys = combined.hosts.map((h) => h.host === 'local' ? 'local' : `${h.host}:${h.port}`);
    assert.ok(_peek(keyA), 'peer A is cached after tick 1');
    assert.ok(!_peek(keyB), 'peer B is not yet in the set');
    assert.equal(_peek(keyA).reachable, true, 'peer A polled successfully (live loopback)');

    // Live ADD: append peer B to the file (no restart). Next tick polls it.
    fs.writeFileSync(file, `127.0.0.1:${peerA.port}=Alpha\n127.0.0.1:${peerB.port}=Bravo\n`);
    await pollOnce();
    assert.ok(_peek(keyA), 'peer A still cached after the add');
    assert.ok(_peek(keyB), 'peer B appeared on the next tick (added live, no restart)');
    assert.equal(_peek(keyB).reachable, true, 'peer B polled successfully');

    // Live REMOVE: drop peer A from the file. Next tick, retainHosts cleans the ghost.
    fs.writeFileSync(file, `127.0.0.1:${peerB.port}=Bravo\n`);
    await pollOnce();
    assert.ok(!_peek(keyA), 'peer A cache entry was DROPPED on the live removal (ghost cleanup)');
    assert.ok(_peek(keyB), 'peer B is unaffected by A being removed');
    combined = getCombined();
    assert.ok(!combined.hosts.some((h) => `${h.host}:${h.port}` === keyA),
      'the removed host no longer appears in the combined view');
  } finally {
    config.dataDir = savedDataDir;
    config.hostsRaw = savedHostsRaw;
    await peerA.close();
    await peerB.close();
    fs.rmSync(dir, { recursive: true, force: true });
    _reset();
    _resetConfigErrorLatch();
  }
});

test('!local directive is echoed onto the local HostReading (a real knob for the badge, QA-19)', async () => {
  const savedDataDir = config.dataDir;
  const savedHostsRaw = config.hostsRaw;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-local-'));
  const file = path.join(dir, 'hosts.conf');
  const peer = await startPeer();
  try {
    _reset();
    config.dataDir = dir;
    config.hostsRaw = '';
    fs.writeFileSync(file, `!local=exclude\n127.0.0.1:${peer.port}=Alpha\n`);
    await pollOnce();
    const combined = getCombined();
    const self = combined.hosts.find((h) => h.self);
    assert.equal(self.localMode, 'exclude', 'the !local=exclude directive is echoed onto the local reading');
    // Change it live to include; next tick reflects it.
    fs.writeFileSync(file, `!local=include\n127.0.0.1:${peer.port}=Alpha\n`);
    await pollOnce();
    assert.equal(getCombined().hosts.find((h) => h.self).localMode, 'include', 'a live directive edit is applied next tick');
  } finally {
    config.dataDir = savedDataDir;
    config.hostsRaw = savedHostsRaw;
    await peer.close();
    fs.rmSync(dir, { recursive: true, force: true });
    _reset();
  }
});

test('empty hosts.conf ⇒ single-host: no peers polled, only the local host cached (QA-02)', async () => {
  const savedDataDir = config.dataDir;
  const savedHostsRaw = config.hostsRaw;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-retain2-'));
  const file = path.join(dir, 'hosts.conf');
  try {
    _reset();
    config.dataDir = dir;
    config.hostsRaw = '';
    fs.writeFileSync(file, '# no peers\n');
    await pollOnce();
    const combined = getCombined();
    const remotes = combined.hosts.filter((h) => h.host !== 'local' && !h.self);
    assert.equal(remotes.length, 0, 'an empty file yields no remote hosts');
    assert.ok(combined.hosts.some((h) => h.self), 'the local host is still present');
  } finally {
    config.dataDir = savedDataDir;
    config.hostsRaw = savedHostsRaw;
    fs.rmSync(dir, { recursive: true, force: true });
    _reset();
  }
});
