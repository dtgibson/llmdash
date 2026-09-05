import test from 'node:test';
import assert from 'node:assert/strict';
import { tailnetIPv4 } from '../src/net.js';

test('detects a Tailscale CGNAT (100.64.0.0/10) address among the interfaces', () => {
  const ifaces = {
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    enp0s5: [{ address: '10.211.55.5', family: 'IPv4', internal: false }],
    tailscale0: [{ address: '100.82.9.81', family: 'IPv4', internal: false }],
  };
  assert.equal(tailnetIPv4(ifaces), '100.82.9.81');
});

test('returns null when no tailnet address is present (tunnel down)', () => {
  const ifaces = {
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    enp0s5: [{ address: '10.211.55.5', family: 'IPv4', internal: false }],
  };
  assert.equal(tailnetIPv4(ifaces), null);
});

test('excludes addresses just outside the 100.64.0.0/10 range', () => {
  assert.equal(tailnetIPv4({ x: [{ address: '100.63.255.1', family: 'IPv4', internal: false }] }), null);
  assert.equal(tailnetIPv4({ x: [{ address: '100.128.0.1', family: 'IPv4', internal: false }] }), null);
  // a plain public 100.x outside the CGNAT block must not match
  assert.equal(tailnetIPv4({ x: [{ address: '100.0.0.1', family: 'IPv4', internal: false }] }), null);
});

test('includes the inclusive 100.64.0.0/10 boundary endpoints', () => {
  // Lock in the exact edges so an off-by-one (o2 > 64 or o2 < 127) is caught.
  assert.equal(tailnetIPv4({ x: [{ address: '100.64.0.0', family: 'IPv4', internal: false }] }), '100.64.0.0');
  assert.equal(tailnetIPv4({ x: [{ address: '100.127.255.255', family: 'IPv4', internal: false }] }), '100.127.255.255');
});

test('ignores loopback and IPv6, and accepts the numeric family code', () => {
  const ifaces = {
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    tailscale0: [
      { address: 'fd7a:115c:a1e0::1', family: 'IPv6', internal: false },
      { address: '100.100.50.2', family: 4, internal: false }, // older Node: numeric family
    ],
  };
  assert.equal(tailnetIPv4(ifaces), '100.100.50.2');
});

test('skips a CGNAT-range address flagged internal', () => {
  assert.equal(tailnetIPv4({ weird: [{ address: '100.80.0.1', family: 'IPv4', internal: true }] }), null);
});

// ── tailnet-bind-and-reporting-resilience: the shared address classifier ─────
// canonicalIp / isLoopback / isTailnetIp were lifted from reset-billing-api.js
// (behavior byte-equal); isTrustedConnection is the accept-time gate's pure
// core. The matrix locks the CGNAT edges, the mapped/loopback forms, the
// Tailscale ULA /48, and that RFC1918 + public addresses are refused.
import {
  bindPolicy, canonicalIp, isLoopback, isTailnetIp, isTrustedConnection, isWildcardBind,
  networkScope, networkScopeDisclosure,
} from '../src/net.js';

test('canonicalIp: one canonical form per literal; mapped IPv4 collapses to family 4; non-IPs are null', () => {
  assert.deepEqual(canonicalIp('127.0.0.1'), { family: 4, address: '127.0.0.1' });
  assert.deepEqual(canonicalIp('::ffff:127.0.0.1'), { family: 4, address: '127.0.0.1' });
  assert.deepEqual(canonicalIp('::1'), { family: 6, address: '::1' });
  assert.deepEqual(canonicalIp('FD7A:115C:A1E0:0:0:0:0:1'), { family: 6, address: 'fd7a:115c:a1e0::1' });
  assert.equal(canonicalIp('not-an-ip'), null);
  assert.equal(canonicalIp('localhost'), null);
  assert.equal(canonicalIp(undefined), null);
  assert.equal(canonicalIp(''), null);
});

test('isLoopback: 127/8, ::1, and the mapped form; nothing else', () => {
  for (const v of ['127.0.0.1', '127.255.255.254', '::1', '::ffff:127.0.0.1']) {
    assert.equal(isLoopback(canonicalIp(v)), true, v);
  }
  for (const v of ['128.0.0.1', '126.255.255.255', '::2', '100.64.0.1', '10.0.0.1']) {
    assert.equal(isLoopback(canonicalIp(v)), false, v);
  }
  assert.equal(isLoopback(null), false);
});

test('isTailnetIp: inclusive CGNAT edges, the fd7a:115c:a1e0::/48 ULA, mapped v4; neighbours refused', () => {
  for (const v of ['100.64.0.0', '100.127.255.255', '100.82.9.81', '::ffff:100.64.0.1',
    'fd7a:115c:a1e0::1', 'fd7a:115c:a1e0:ab12::1', 'FD7A:115C:A1E0::']) {
    assert.equal(isTailnetIp(canonicalIp(v)), true, v);
  }
  for (const v of ['100.63.255.255', '100.128.0.0', '100.0.0.1', 'fd7a:115c:a1e1::1', 'fd7a:115c::1',
    '10.0.0.1', '172.16.0.1', '192.168.1.1', '8.8.8.8', '::1', '127.0.0.1']) {
    assert.equal(isTailnetIp(canonicalIp(v)), false, v);
  }
  assert.equal(isTailnetIp(null), false);
});

test('isTrustedConnection: both ends loopback-or-tailnet under the gate; anything else refused; missing fails closed', () => {
  const gated = { gate: true };
  const ok = [
    ['127.0.0.1', '127.0.0.1'],
    ['::1', '::1'],
    ['::ffff:127.0.0.1', '::ffff:127.0.0.1'],
    ['100.70.220.2', '100.82.9.81'],
    ['100.64.0.0', '100.127.255.255'],
    ['fd7a:115c:a1e0::2', 'fd7a:115c:a1e0:ab12::3'],
    ['::ffff:100.70.220.2', '::ffff:100.82.9.81'],
  ];
  for (const [localAddress, remoteAddress] of ok) {
    assert.equal(isTrustedConnection({ localAddress, remoteAddress }, gated), true, `${localAddress} ← ${remoteAddress}`);
  }
  const refused = [
    ['192.168.1.5', '192.168.1.9'], // LAN ↔ LAN
    ['192.168.1.5', '100.82.9.81'], // arrived on the LAN address (a tailnet peer using the .local name)
    ['100.70.220.2', '192.168.1.9'], // LAN source
    ['10.0.0.5', '10.0.0.9'],
    ['172.16.0.5', '172.16.0.9'],
    ['100.70.220.2', '8.8.8.8'], // public source
    ['100.63.255.255', '100.63.255.254'], // just below the CGNAT block
    ['100.128.0.1', '100.128.0.2'], // just above it
    ['fd7a:115c:a1e1::1', 'fd7a:115c:a1e1::2'], // neighbouring ULA
  ];
  for (const [localAddress, remoteAddress] of refused) {
    assert.equal(isTrustedConnection({ localAddress, remoteAddress }, gated), false, `${localAddress} ← ${remoteAddress}`);
  }
  // Missing / undefined / non-IP addresses fail closed.
  assert.equal(isTrustedConnection({ localAddress: '127.0.0.1' }, gated), false);
  assert.equal(isTrustedConnection({ remoteAddress: '127.0.0.1' }, gated), false);
  assert.equal(isTrustedConnection({}, gated), false);
  assert.equal(isTrustedConnection(undefined, gated), false);
  assert.equal(isTrustedConnection({ localAddress: 'localhost', remoteAddress: '127.0.0.1' }, gated), false);
  // An absent or malformed policy is GATED, never open; only gate:false opens.
  assert.equal(isTrustedConnection({ localAddress: '192.168.1.5', remoteAddress: '192.168.1.9' }, undefined), false);
  assert.equal(isTrustedConnection({ localAddress: '192.168.1.5', remoteAddress: '192.168.1.9' }, {}), false);
  assert.equal(isTrustedConnection({ localAddress: '192.168.1.5', remoteAddress: '192.168.1.9' }, { gate: false }), true);
  assert.equal(isTrustedConnection({}, { gate: false }), true);
});

test('isWildcardBind: exactly 0.0.0.0 / :: (and bracketed/mapped forms); a pinned address or host name is not', () => {
  for (const v of ['0.0.0.0', '::', '[::]', '::ffff:0.0.0.0']) assert.equal(isWildcardBind(v), true, v);
  for (const v of ['127.0.0.1', '100.70.220.2', '192.168.1.5', 'localhost', 'mymac.local', '', undefined, null]) {
    assert.equal(isWildcardBind(v), false, String(v));
  }
});

test('networkScope / bindPolicy: tailnet-only | lan-and-tailnet | pinned:<host>, and the ignored-knob flag', () => {
  assert.equal(networkScope({ host: '0.0.0.0', allowLan: false }), 'tailnet-only');
  assert.equal(networkScope({ host: '::', allowLan: false }), 'tailnet-only');
  assert.equal(networkScope({ host: '0.0.0.0', allowLan: true }), 'lan-and-tailnet');
  assert.equal(networkScope({ host: '127.0.0.1', allowLan: false }), 'pinned:127.0.0.1');
  assert.equal(networkScope({ host: '100.70.220.2', allowLan: true }), 'pinned:100.70.220.2');
  assert.equal(networkScope({ host: 'localhost', allowLan: false }), 'pinned:localhost');
  assert.deepEqual(bindPolicy({ host: '0.0.0.0', port: 8787, allowLan: false }), {
    scope: 'tailnet-only', host: '0.0.0.0', port: 8787, gate: true, allowLan: false, allowLanIgnored: false,
  });
  assert.equal(bindPolicy({ host: '0.0.0.0', port: 8787, allowLan: true }).gate, false);
  const pinned = bindPolicy({ host: '192.168.1.5', port: 8787, allowLan: true });
  assert.equal(pinned.gate, false);
  assert.equal(pinned.allowLanIgnored, true, 'LLMDASH_ALLOW_LAN drives nothing on a pinned bind — named, not silent');
  assert.equal(bindPolicy({ host: '192.168.1.5', port: 8787, allowLan: false }).allowLanIgnored, false);
  // A truthy-but-not-boolean allowLan does not open the gate (config only ever sets a boolean).
  assert.equal(bindPolicy({ host: '0.0.0.0', port: 8787, allowLan: '1' }).gate, true);
});

test('networkScopeDisclosure never prints a fabricated tailnet address', () => {
  const cfg = { host: '0.0.0.0', port: 8787, allowLan: false };
  assert.match(networkScopeDisclosure(cfg, '100.70.220.2'), /Tailnet address now: 100\.70\.220\.2\./);
  assert.match(networkScopeDisclosure(cfg, null), /No Tailscale address is up right now/);
  assert.doesNotMatch(networkScopeDisclosure(cfg, null), /100\.\d+\.\d+\.\d+/);
});
