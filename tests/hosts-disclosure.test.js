import test from 'node:test';
import assert from 'node:assert/strict';
import { peerDisclosureLine, peerHealthLines } from '../src/health.js';
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
