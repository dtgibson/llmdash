import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeMultiBadge, emitMulti, remotesFromCombined } from '../scripts/menubar/llmdash.5s.js';
import { getCombined, setHost, _reset } from '../src/host-cache.js';

// FR-12 / QA-12 — the /api/hosts CONTRACT GUARD. The badge depends on the exact
// HostReading field names (host, label, port, self, reachable, hostDiagnostic,
// fetchedAt, pending, state.{tools,headroom,generatedAt}). A future field rename
// must be caught HERE, not by the badge silently degrading to offline/odd states.
//
// Two halves: (1) a fixture in the shipped /api/hosts shape is parsed correctly by
// computeMultiBadge; (2) the LIVE getCombined() cache producer emits that same
// shape (so the badge's contract and the server's producer can't drift apart).

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, 'fixtures', 'menubar');
function rehydrate(v, now) {
  if (typeof v === 'string' && /^@-?\d+$/.test(v)) return new Date(now + Number(v.slice(1))).toISOString();
  if (Array.isArray(v)) return v.map((x) => rehydrate(x, now));
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = rehydrate(v[k], now); return o; }
  return v;
}
function loadHostsFixture(name, now = Date.now()) {
  return rehydrate(JSON.parse(fs.readFileSync(path.join(fixturesDir, `${name}.json`), 'utf8')), now);
}

// The HostReading fields the badge reads. If the server renames one, the shape
// guard below fails loudly.
const HOST_READING_FIELDS = ['host', 'label', 'port', 'self', 'reachable', 'hostDiagnostic', 'fetchedAt', 'state'];
const STATE_FIELDS = ['tools', 'headroom', 'generatedAt'];

test('the fixture matches the shipped /api/hosts shape (hosts[] + every HostReading field) (QA-12)', () => {
  const combined = loadHostsFixture('hosts-multi');
  assert.ok(Array.isArray(combined.hosts), 'hosts[] present');
  assert.equal(typeof combined.generatedAt, 'string', 'generatedAt present');
  for (const h of combined.hosts) {
    for (const f of HOST_READING_FIELDS) {
      assert.ok(Object.prototype.hasOwnProperty.call(h, f), `HostReading.${f} present`);
    }
    if (h.state) {
      for (const f of STATE_FIELDS) {
        assert.ok(Object.prototype.hasOwnProperty.call(h.state, f), `state.${f} present on a reachable host`);
      }
    }
  }
});

test('the badge parses the fixture into a correct multi-host badge (QA-12)', () => {
  const combined = loadHostsFixture('hosts-multi');
  const multi = computeMultiBadge(combined, { localMode: 'auto' });
  assert.equal(multi.mode, 'multi');
  // Desktop Claude 5-hour (12%) binds; the empty local is auto-de-emphasized.
  assert.equal(multi.pct, 12);
  assert.equal(multi.binding.hostLabel, 'Desktop');
  assert.equal(multi.hostCue, 'Desktop');
  const out = emitMulti(multi, { host: '127.0.0.1', port: '8787', remotes: remotesFromCombined(combined) });
  // Every part of the contract is exercised: the offline host's diagnostic, the
  // per-tool rows, the de-emphasized local note.
  assert.match(out, /Studio VM is unreachable/);
  assert.match(out, /no local activity/);
  assert.match(out, /12% · resets/);
});

test('a renamed HostReading field is CAUGHT (the guard fails, not a silent offline degrade) (QA-12)', () => {
  // Simulate the server renaming `state` → `payload`: the shape guard must fail.
  const combined = loadHostsFixture('hosts-multi');
  const renamed = { hosts: combined.hosts.map((h) => {
    const { state, ...rest } = h; return { ...rest, payload: state };
  }), generatedAt: combined.generatedAt };
  assert.throws(() => {
    for (const h of renamed.hosts) {
      for (const f of HOST_READING_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(h, f)) throw new Error(`missing ${f}`);
      }
    }
  }, /missing state/);
});

test('the LIVE getCombined() producer emits the shape the badge parses (no drift, QA-12)', () => {
  _reset();
  const now = Date.now();
  setHost('local:8787', {
    host: 'local', label: 'This machine', port: 8787, self: true,
    reachable: true, hostDiagnostic: null, fetchedAt: new Date(now).toISOString(),
    state: { tools: [], headroom: null, generatedAt: new Date(now).toISOString() },
  });
  setHost('100.64.0.7:8788', {
    host: '100.64.0.7', label: 'Desktop', port: 8788, self: false,
    reachable: false, hostDiagnostic: { reason: 'peer-unreachable', cause: 'timeout' },
    fetchedAt: new Date(now).toISOString(), state: null,
  });
  const combined = getCombined(now);
  // The badge's consumers must all parse it without throwing.
  const multi = computeMultiBadge(combined);
  const out = emitMulti(multi, { host: '127.0.0.1', port: '8787', remotes: remotesFromCombined(combined) });
  assert.ok(typeof out === 'string' && out.length > 0);
  // Every HostReading field the badge reads is present on the live output.
  for (const h of combined.hosts) {
    for (const f of HOST_READING_FIELDS) {
      assert.ok(Object.prototype.hasOwnProperty.call(h, f), `live getCombined HostReading.${f} present`);
    }
  }
  _reset();
});
