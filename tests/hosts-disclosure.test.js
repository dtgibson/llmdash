import test from 'node:test';
import assert from 'node:assert/strict';
import { peerDisclosureLine, peerHealthLines, hostsConfigLine } from '../src/health.js';
import { parseHosts } from '../src/hosts.js';

// FR-19 / QA-19: the peer-list config is disclosed — a startup line stating how
// many peers and to which host:ports outbound reads go (or the single-host / no-
// outbound reality), plus a per-configured-peer health line reading the cache's
// last state (cheap, off the request path). Pure over injected parsed/peek.
const cfg = { port: 8787, host: '0.0.0.0', pollIntervalMs: 60_000 };
const parse = (raw) => parseHosts(raw, cfg, null);

test('no peers ⇒ disclosure states single-host / no-outbound reality (QA-19)', () => {
  const line = peerDisclosureLine(parse(''));
  assert.match(line, /no peers configured/i);
  assert.match(line, /no outbound reads/i);
  assert.match(line, /single-host/i);
  assert.match(line, /LLMDASH_HOSTS/); // names the knob to set
});

test('peers ⇒ disclosure names the count and the outbound host:ports (QA-19)', () => {
  const line = peerDisclosureLine(parse('100.64.0.7=Desktop, 100.64.0.9:8790=Work'));
  assert.match(line, /2 peers configured/);
  assert.match(line, /100\.64\.0\.7:8787/);
  assert.match(line, /100\.64\.0\.9:8790/);
  assert.match(line, /read-only GET \/api\/state/);
  assert.match(line, /tailnet-only/i);
  assert.match(line, /no discovery/i);
});

test('malformed entries are surfaced in the disclosure, never silently dropped (QA-04/QA-19)', () => {
  const line = peerDisclosureLine(parse('good, bad:99999'));
  assert.match(line, /1 peer configured/);
  assert.match(line, /malformed/i);
  assert.match(line, /bad:99999/);
});

test('per-peer health lines name reachable / last-error + the fix (QA-19)', () => {
  const parsed = parse('100.64.0.7=Desktop, 100.64.0.9=Work');
  const now = Date.now();
  const peek = (key) => {
    if (key === '100.64.0.7:8787') return { reachable: true, fetchedAt: new Date(now - 30_000).toISOString(), hostDiagnostic: null };
    if (key === '100.64.0.9:8787') return { reachable: false, fetchedAt: new Date(now - 4 * 60_000).toISOString(), hostDiagnostic: { reason: 'peer-unreachable', cause: 'timeout' } };
    return null;
  };
  const lines = peerHealthLines(parsed, peek).join('\n');
  assert.match(lines, /Hosts:/);
  assert.match(lines, /Desktop \(100\.64\.0\.7:8787\): reachable/);
  assert.match(lines, /Work \(100\.64\.0\.9:8787\): unreachable \(peer-unreachable · timeout\)/);
  assert.match(lines, /check the machine is awake/i);
});

test('a not-yet-polled peer reads honestly (fills in after the first tick)', () => {
  const parsed = parse('100.64.0.7=Desktop');
  const lines = peerHealthLines(parsed, () => null).join('\n');
  assert.match(lines, /not yet polled/);
});

test('no peers ⇒ no per-peer health lines (single-host readout stays as today)', () => {
  const lines = peerHealthLines(parse(''), () => null);
  assert.deepEqual(lines, []);
});

// ── hostsConfigLine — the config-file source disclosure (FR-21 / QA-21) ────────
// Pure over an injected configFileHealth() result, so no real data dir is read.
test('hostsConfigLine: file source names the file as source of truth + the ignored-env note (QA-21)', () => {
  const line = hostsConfigLine({
    file: '/data/hosts.conf', source: 'file', error: null, fileErrors: [],
    localMode: 'auto', envIgnored: true,
  });
  assert.match(line, /\/data\/hosts\.conf/);
  assert.match(line, /runtime source of truth/i);
  assert.match(line, /LLMDASH_HOSTS is set but IGNORED/);
});

test('hostsConfigLine: env-seed source states the seed-once precedence (QA-21)', () => {
  const line = hostsConfigLine({
    file: '/data/hosts.conf', source: 'env-seed', error: null, fileErrors: [],
    localMode: 'auto', envIgnored: false,
  });
  assert.match(line, /seeding it from LLMDASH_HOSTS/);
  assert.match(line, /later LLMDASH_HOSTS edits are ignored/);
});

test('hostsConfigLine: neither ⇒ single-host, names the badge affordance + the file format (QA-21)', () => {
  const line = hostsConfigLine({
    file: '/data/hosts.conf', source: 'none', error: null, fileErrors: [],
    localMode: 'auto', envIgnored: false,
  });
  assert.match(line, /single-host/);
  assert.match(line, /menu-bar badge/);
  assert.match(line, /host\[:port\]\[=label\]/);
});

test('hostsConfigLine: an unreadable file is disclosed with the fix, never silently (QA-04/21)', () => {
  const line = hostsConfigLine({
    file: '/data/hosts.conf', source: 'env-seed',
    error: { reason: 'unreadable', detail: 'EACCES' }, fileErrors: [],
    localMode: 'auto', envIgnored: false,
  });
  assert.match(line, /UNREADABLE/);
  assert.match(line, /EACCES/);
  assert.match(line, /re-read on the next poll/);
});

test('hostsConfigLine: the !local override is disclosed as a real knob (QA-19/21)', () => {
  const line = hostsConfigLine({
    file: '/data/hosts.conf', source: 'file', error: null, fileErrors: [],
    localMode: 'exclude', envIgnored: false,
  });
  assert.match(line, /!local=exclude/);
  assert.match(line, /always de-emphasized/);
});
