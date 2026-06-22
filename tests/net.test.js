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
