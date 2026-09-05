import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// tailnet-bind-and-reporting-resilience, Part 1: the shipped network default
// is TAILNET-ONLY. The server keeps one wildcard listener (badge + deploy
// health check on 127.0.0.1) and, unless LLMDASH_ALLOW_LAN=1 or LLMDASH_HOST
// is pinned, destroys every accepted connection that is not loopback↔loopback
// or tailnet↔tailnet BEFORE any HTTP byte is read. Everything here is hermetic:
// the real-socket test drives the gate through a stubbed classifier (no
// dependency on a live tailnet interface) and the pure classifier is covered
// separately in tests/net.test.js.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-bind-scope-'));
process.env.LLMDASH_DATA_DIR = path.join(tmp, 'data');
process.env.LLMDASH_CLAUDE_DIR = path.join(tmp, 'claude');
process.env.LLMDASH_CODEX_DIR = path.join(tmp, 'codex');
process.env.LLMDASH_CODEX_CMD = path.join(tmp, 'missing', 'codex');
delete process.env.LLMDASH_ALLOW_LAN;
delete process.env.LLMDASH_HOST;

const { config } = await import('../config.js');
const { server, _setConnectionGate } = await import('../src/server.js');
const { bindPolicy, isTrustedConnection, networkScope } = await import('../src/net.js');
const { healthLines, networkScopeLine, networkScopeOf } = await import('../src/health.js');

const here = path.dirname(fileURLToPath(import.meta.url));

function listen() {
  return new Promise((resolve) => {
    const srv = server.listen(0, '127.0.0.1', () => resolve(srv));
  });
}
function close(srv) {
  return new Promise((resolve) => srv.close(() => resolve()));
}

// Write a whole HTTP request over a raw socket and count every byte that comes
// back until the peer closes. A reset (ECONNRESET) is an acceptable refusal
// signal — what matters is that nothing was ever served.
function rawConnect(port, request) {
  return new Promise((resolve) => {
    let bytes = 0;
    let done = false;
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = (closed) => { if (!done) { done = true; resolve({ bytes, closed }); } };
    socket.on('connect', () => socket.write(request));
    socket.on('data', (chunk) => { bytes += chunk.length; });
    socket.on('error', () => {});
    socket.on('close', () => finish(true));
    const t = setTimeout(() => { socket.destroy(); finish(false); }, 3000);
    if (t.unref) t.unref();
  });
}

function hit(srv, pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path: pathname }, (res) => {
      let body = ''; res.setEncoding('utf8');
      res.on('data', (c) => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

// ── (a) THE PIN ──────────────────────────────────────────────────────────────
test('PIN: with LLMDASH_ALLOW_LAN and LLMDASH_HOST unset the shipped policy is tailnet-only and the gate is armed', () => {
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.allowLan, false);
  assert.equal(networkScope(config), 'tailnet-only');
  assert.equal(networkScopeOf(config), 'tailnet-only');
  const policy = bindPolicy(config);
  assert.equal(policy.gate, true);
  assert.equal(policy.allowLan, false);
  assert.equal(policy.allowLanIgnored, false);
  // The gate is wired on `connection` (accept time), ahead of the request
  // parser — a static guard so a refactor can't quietly move it to the
  // request callback (where bytes would already have been read).
  const src = fs.readFileSync(path.join(here, '..', 'src', 'server.js'), 'utf8');
  assert.match(src, /server\.on\('connection', \(socket\) => \{\s*if \(!connectionGate\(socket\)\) socket\.destroy\(\);/);
  assert.match(src, /const BIND_POLICY = bindPolicy\(config\);/);
});

test('LLMDASH_ALLOW_LAN parsing: only "1" / "true" (any case) enable it; everything else keeps tailnet-only', async () => {
  for (const [raw, expected] of [
    [undefined, false], ['', false], ['0', false], ['false', false], ['yes', false], ['on', false], ['2', false],
    ['1', true], ['true', true], ['TRUE', true], ['True', true],
  ]) {
    if (raw === undefined) delete process.env.LLMDASH_ALLOW_LAN;
    else process.env.LLMDASH_ALLOW_LAN = raw;
    const { config: c } = await import(`../config.js?allowlan=${encodeURIComponent(raw ?? 'unset')}`);
    assert.equal(c.allowLan, expected, `raw=${JSON.stringify(raw)}`);
    assert.equal(networkScope(c), expected ? 'lan-and-tailnet' : 'tailnet-only', `raw=${JSON.stringify(raw)}`);
  }
  delete process.env.LLMDASH_ALLOW_LAN;
});

// ── (b) real socket: refused at accept, zero response bytes ─────────────────
test('an untrusted connection is destroyed at accept with ZERO response bytes (stubbed classifier, hermetic)', async () => {
  const seen = [];
  _setConnectionGate((socket) => {
    seen.push({ local: socket.localAddress, remote: socket.remoteAddress });
    return false; // stand in for a LAN↔LAN pair on this loopback-only test box
  });
  try {
    const srv = await listen();
    const { bytes, closed } = await rawConnect(srv.address().port,
      'GET /api/state HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
    assert.equal(bytes, 0, 'no status line, no headers, no body — nothing was served');
    assert.equal(closed, true, 'the socket was closed by the server, not left hanging');
    assert.equal(seen.length, 1, 'the gate ran exactly once, at accept');
    assert.ok(seen[0].local && seen[0].remote, 'both socket addresses were available to the classifier at accept time');
    await close(srv);
  } finally {
    _setConnectionGate(null); // restore the real classifier
  }
});

test('with the real classifier a loopback request is served normally, and a LAN-shaped pair is refused (pure)', async () => {
  const srv = await listen();
  const r = await hit(srv, '/api/state');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(JSON.parse(r.body).tools));
  await close(srv);
  const policy = bindPolicy(config);
  assert.equal(isTrustedConnection({ localAddress: '127.0.0.1', remoteAddress: '127.0.0.1' }, policy), true);
  assert.equal(isTrustedConnection({ localAddress: '100.70.220.2', remoteAddress: '100.82.9.81' }, policy), true);
  assert.equal(isTrustedConnection({ localAddress: '192.168.1.5', remoteAddress: '192.168.1.9' }, policy), false);
  assert.equal(isTrustedConnection({ localAddress: '192.168.1.5', remoteAddress: '100.82.9.81' }, policy), false,
    'a tailnet peer that reaches this machine via its LAN address is refused — it must use the tailnet IP / MagicDNS name');
});

// ── (c) the two ways to turn the gate off, each named in the disclosure ─────
test('LLMDASH_ALLOW_LAN=1 disables the gate and the disclosure line names it', () => {
  const cfg = { host: '0.0.0.0', port: 8787, allowLan: true };
  assert.equal(networkScope(cfg), 'lan-and-tailnet');
  const policy = bindPolicy(cfg);
  assert.equal(policy.gate, false);
  assert.equal(isTrustedConnection({ localAddress: '192.168.1.5', remoteAddress: '192.168.1.9' }, policy), true);
  const line = networkScopeLine(cfg, '100.70.220.2');
  assert.match(line, /^Network: bound to 0\.0\.0\.0:8787 with LLMDASH_ALLOW_LAN=1/);
  assert.match(line, /reachable from the LAN and the tailnet/);
  assert.match(line, /not the public internet behind NAT/);
  assert.match(line, /no connect-time gate/);
  assert.match(line, /Unset LLMDASH_ALLOW_LAN to return to the tailnet-only default/);
});

test('a pinned LLMDASH_HOST keeps its exact meaning (no gate) and a set LLMDASH_ALLOW_LAN is named as IGNORED', () => {
  for (const host of ['127.0.0.1', '100.70.220.2', '192.168.1.5', 'localhost']) {
    const policy = bindPolicy({ host, port: 8787, allowLan: false });
    assert.equal(policy.scope, `pinned:${host}`);
    assert.equal(policy.gate, false, host);
    assert.equal(isTrustedConnection({ localAddress: '192.168.1.5', remoteAddress: '192.168.1.9' }, policy), true, host);
  }
  const ignored = networkScopeLine({ host: '192.168.1.5', port: 8787, allowLan: true }, null);
  assert.match(ignored, /^Network: bound to 192\.168\.1\.5:8787 \(LLMDASH_HOST pinned\)/);
  assert.match(ignored, /LLMDASH_ALLOW_LAN is set but IGNORED because LLMDASH_HOST is pinned/);
  const loopback = networkScopeLine({ host: '127.0.0.1', port: 8787, allowLan: false }, null);
  assert.match(loopback, /local-only \(this machine\)/);
  assert.doesNotMatch(loopback, /IGNORED/);
  const tailnet = networkScopeLine({ host: '100.70.220.2', port: 8787, allowLan: false }, '100.70.220.2');
  assert.match(tailnet, /that Tailscale address only/);
});

test('the tailnet-only disclosure states the scope, the tailnet-down fallback, and both knobs — and healthLines() carries it', () => {
  const cfg = { host: '0.0.0.0', port: 8787, allowLan: false };
  const up = networkScopeLine(cfg, '100.70.220.2');
  assert.match(up, /^Network: bound to 0\.0\.0\.0:8787, TAILNET-ONLY \(the default\)/);
  assert.match(up, /arrives on a loopback or Tailscale address from a loopback or Tailscale source/);
  assert.match(up, /LAN device that is not on the tailnet is refused at connect time \(no HTTP response\)/);
  assert.match(up, /If the Tailscale tunnel is down, only local \(127\.0\.0\.1\) clients can connect/);
  assert.match(up, /no restart needed/);
  assert.match(up, /Tailnet address now: 100\.70\.220\.2\./);
  assert.match(up, /set LLMDASH_ALLOW_LAN=1/);
  assert.match(up, /set LLMDASH_HOST \(127\.0\.0\.1 = local-only\)/);
  const down = networkScopeLine(cfg, null);
  assert.match(down, /No Tailscale address is up right now, so only local \(127\.0\.0\.1\) clients can connect/);
  assert.doesNotMatch(down, /Tailnet address now/);
  // The startup readout carries the line (the hostsConfigLine precedent).
  const lines = healthLines();
  assert.ok(lines.some((l) => /^ {2}Network: bound to 0\.0\.0\.0:\d+, TAILNET-ONLY/.test(l)),
    `healthLines() must carry the network-scope line; got:\n${lines.join('\n')}`);
});

test('the README and the plist example disclose the default and the opt-out', () => {
  const readme = fs.readFileSync(path.join(here, '..', 'README.md'), 'utf8');
  assert.match(readme, /tailnet-only by default/i);
  assert.match(readme, /LLMDASH_ALLOW_LAN=1/);
  assert.match(readme, /`LLMDASH_ALLOW_LAN` \(default unset = tailnet-only\)/);
  assert.doesNotMatch(readme, /reachable on your LAN and tailnet, but not the public internet/,
    'the pre-gate LLMDASH_HOST description must not survive');
  const plist = fs.readFileSync(path.join(here, '..', 'macos', 'com.llmdash.dashboard.plist.example'), 'utf8');
  assert.match(plist, /TAILNET-ONLY by default/);
  assert.match(plist, /LLMDASH_ALLOW_LAN/);
});

test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
