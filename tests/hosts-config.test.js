import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHosts, isLocalHost, sanitizeHostPort, remoteHosts } from '../src/hosts.js';

// parseHosts is pure over (raw, cfg, tailnet). A fixed cfg so config.port /
// config.host don't sway the assertions. No I/O, no fetch.
const cfg = { port: 8787, host: '0.0.0.0' };
const noTailnet = null;
const parse = (raw) => parseHosts(raw, cfg, noTailnet);

test('unset/empty ⇒ exactly the local host, self:true (single-host, QA-02)', () => {
  for (const raw of ['', undefined, null, '   ', ',,']) {
    const { hosts, errors } = parse(raw);
    assert.equal(hosts.length, 1, `raw=${JSON.stringify(raw)}`);
    assert.equal(hosts[0].self, true);
    assert.equal(hosts[0].port, 8787);
    assert.deepEqual(errors, []);
    assert.deepEqual(remoteHosts({ hosts, errors }), []); // no outbound targets
  }
});

test('host only ⇒ port defaults to config.port, label defaults to host (QA-01)', () => {
  const { hosts } = parse('100.64.0.7');
  const peer = hosts.find((h) => !h.self);
  assert.equal(peer.host, '100.64.0.7');
  assert.equal(peer.port, 8787);
  assert.equal(peer.label, '100.64.0.7');
  assert.equal(peer.self, false);
});

test('host:port ⇒ explicit port read (QA-01)', () => {
  const peer = parse('desktop:8790').hosts.find((h) => !h.self);
  assert.equal(peer.host, 'desktop');
  assert.equal(peer.port, 8790);
});

test('host=label and host:port=label parse the label, spaces preserved (QA-01)', () => {
  const a = parse('laptop=Work Laptop').hosts.find((h) => !h.self);
  assert.equal(a.host, 'laptop');
  assert.equal(a.label, 'Work Laptop');
  const b = parse('100.64.0.7:8788=Studio Desktop').hosts.find((h) => !h.self);
  assert.equal(b.port, 8788);
  assert.equal(b.label, 'Studio Desktop');
});

test('a multi-entry list yields that many peers, in order', () => {
  const { hosts } = parse('a=Alpha, b:9000=Bravo, 100.64.0.9=Charlie');
  const peers = hosts.filter((h) => !h.self);
  assert.deepEqual(peers.map((p) => p.label), ['Alpha', 'Bravo', 'Charlie']);
  assert.deepEqual(peers.map((p) => p.port), [8787, 9000, 8787]);
});

test('a present-but-invalid port ⇒ malformed error, NOT a silent coercion (QA-04)', () => {
  for (const bad of ['h:0', 'h:70000', 'h:99999']) {
    const { hosts, errors } = parse(bad);
    assert.equal(hosts.filter((x) => !x.self).length, 0, `${bad} must not become a peer`);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].reason, 'bad-port');
  }
});

test('a non-numeric "port" is treated as part of the host, not an error', () => {
  // The last-colon-only-if-digits rule leaves an IPv6-ish or labelled colon in
  // the host, so "h:abc" is host "h:abc" (sanitized), not a bad port.
  const peer = parse('myhost:abc').hosts.find((h) => !h.self);
  assert.ok(peer, 'should parse as a host with a colon, not error out');
});

test('empty host after sanitize ⇒ malformed error, never fabricated (QA-04)', () => {
  const { hosts, errors } = parse('   =JustALabel');
  assert.equal(hosts.filter((x) => !x.self).length, 0);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].reason, 'empty-host');
});

test('sanitizeHostPort strips whitespace and metacharacters (the fixed-Low class, QA-04)', () => {
  assert.equal(sanitizeHostPort(' 100.64.0.7 '), '100.64.0.7');
  assert.equal(sanitizeHostPort('host name'), 'hostname');
  assert.equal(sanitizeHostPort('h|x;y`z$(w)'), 'hxyzw');
  assert.equal(sanitizeHostPort('a/b\\c'), 'abc');
  assert.equal(sanitizeHostPort(null), '');
  // A parsed entry with whitespace/metachars is sanitized before use.
  const peer = parse(' 100.64.0.7 = My Box ').hosts.find((h) => !h.self);
  assert.equal(peer.host, '100.64.0.7');
  assert.equal(peer.label, 'My Box'); // label trimmed but not metachar-stripped (escaped at render)
});

test('local host listed explicitly ⇒ counted once, self:true, no double-poll (QA-03)', () => {
  for (const raw of ['127.0.0.1', 'localhost', '127.0.0.1:8787']) {
    const { hosts } = parse(raw);
    assert.equal(hosts.length, 1, `${raw} should collapse into the local host`);
    assert.equal(hosts[0].self, true);
    assert.equal(remoteHosts({ hosts, errors: [] }).length, 0, 'no self-HTTP target');
  }
});

test('an explicit label on the local entry overrides the default "This machine" (QA-03)', () => {
  const { hosts } = parse('127.0.0.1=My Mac');
  assert.equal(hosts.length, 1);
  assert.equal(hosts[0].self, true);
  assert.equal(hosts[0].label, 'My Mac');
});

test('duplicate host:port ⇒ counted once (QA-03)', () => {
  const { hosts } = parse('desktop:9000, desktop:9000=Second');
  const peers = hosts.filter((h) => !h.self);
  assert.equal(peers.length, 1);
  assert.equal(peers[0].label, 'Second'); // the later explicit label wins
});

test('the same host on DIFFERENT ports are two peers (a port is part of identity)', () => {
  const peers = parse('box:8787, box:8788').hosts.filter((h) => !h.self);
  assert.equal(peers.length, 2);
});

test('isLocalHost matches loopback/localhost/::1 on config.port, not other ports', () => {
  assert.equal(isLocalHost('127.0.0.1', 8787, cfg, null), true);
  assert.equal(isLocalHost('localhost', 8787, cfg, null), true);
  assert.equal(isLocalHost('::1', 8787, cfg, null), true);
  assert.equal(isLocalHost('127.0.0.1', 8788, cfg, null), false); // different port = different instance
  assert.equal(isLocalHost('example.com', 8787, cfg, null), false);
});

test('isLocalHost matches this machine\'s tailnet IPv4 on config.port (QA-03)', () => {
  const tailnet = '100.64.0.5';
  assert.equal(isLocalHost('100.64.0.5', 8787, cfg, tailnet), true);
  assert.equal(isLocalHost('100.64.0.6', 8787, cfg, tailnet), false); // a DIFFERENT tailnet host is remote
  // A configured entry equal to our tailnet IP collapses into the local host.
  const { hosts } = parseHosts('100.64.0.5=Me', cfg, tailnet);
  assert.equal(hosts.length, 1);
  assert.equal(hosts[0].self, true);
});

test('isLocalHost honors a pinned config.host (not the 0.0.0.0 wildcard)', () => {
  const pinned = { port: 8787, host: '100.64.0.5' };
  assert.equal(isLocalHost('100.64.0.5', 8787, pinned, null), true);
  // With the wildcard bind, config.host must NOT make an arbitrary host local.
  assert.equal(isLocalHost('100.64.0.5', 8787, { port: 8787, host: '0.0.0.0' }, null), false);
});
