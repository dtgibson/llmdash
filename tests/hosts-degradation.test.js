import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePeerState,
  normalizeIso,
  normalizeResetCredits,
  normalizeAccountLimits,
  normalizeDeviceHealth,
} from '../src/hosts.js';
import { setHost, getCombined, _reset } from '../src/host-cache.js';

const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();

const health = (overrides = {}) => ({
  scope: 'device', pollIntervalMs: 60_000,
  cpu: { status: 'available', usedPct: 37.4, capturedAt: iso(-60_000), attemptedAt: iso(-60_000), updateStatus: 'ok', reason: null, intervalMs: 60_003 },
  ram: { status: 'available', usedPct: 68.2, capturedAt: iso(-60_000), attemptedAt: iso(-60_000), updateStatus: 'ok', reason: null },
  disk: { status: 'available', availableBytes: 250 * (1024 ** 3), totalBytes: 1024 ** 4, availablePct: 99, target: '/private/path', capturedAt: iso(-60_000), attemptedAt: iso(-60_000), updateStatus: 'ok', reason: null },
  ...overrides,
});

// ── normalizePeerState — the ingest defense (FR-07 / NFR-03) ─────────────────

test('used-% >100 and <0 are clamped to 0–100 (QA-07)', () => {
  const s = normalizePeerState({ tools: [{ source: 'claude-code', limits: {
    five_hour: { usedPct: 150, resetsAt: iso(3600_000) },
    seven_day: { usedPct: -20, resetsAt: iso(86400_000) },
  } }], generatedAt: iso(0) });
  assert.equal(s.tools[0].limits.five_hour.usedPct, 100);
  assert.equal(s.tools[0].limits.five_hour.remainingPct, 0);
  assert.equal(s.tools[0].limits.seven_day.usedPct, 0);
  assert.equal(s.tools[0].limits.seven_day.remainingPct, 100);
});

test('remainingPct is derived from the clamped used-% (a peer\'s inconsistent value can\'t escape)', () => {
  const s = normalizePeerState({ tools: [{ source: 'codex', limits: {
    five_hour: { usedPct: 30, remainingPct: 999, resetsAt: iso(3600_000) },
  } }] });
  assert.equal(s.tools[0].limits.five_hour.remainingPct, 70);
});

test('a bad/missing timestamp is DROPPED (null), never defaulted to now (QA-07)', () => {
  assert.equal(normalizeIso('not-a-date'), null);
  assert.equal(normalizeIso(undefined), null);
  assert.equal(normalizeIso(''), null);
  const s = normalizePeerState({ tools: [{ source: 'claude-code', limits: {
    five_hour: { usedPct: 40, resetsAt: 'garbage', capturedAt: 'also-garbage' },
  } }], generatedAt: 'nope' });
  assert.equal(s.tools[0].limits.five_hour.resetsAt, null);
  assert.equal(s.tools[0].limits.five_hour.capturedAt, null);
  assert.equal(s.generatedAt, null);
  assert.equal(s.tools[0].dataAt, null); // no valid capture → no dataAt, not "now"
});

test('a valid but skewed capturedAt is preserved as-is, never re-stamped to now (QA-27)', () => {
  const skewed = new Date(Date.now() - 47 * 3600_000).toISOString(); // 47h in the past
  const s = normalizePeerState({ tools: [{ source: 'claude-code', limits: {
    five_hour: { usedPct: 40, resetsAt: iso(3600_000), capturedAt: skewed },
  }, freshness: { capturedAt: skewed, freshForMs: 300_000, staleAfterMs: 600_000 } }] });
  assert.equal(s.tools[0].limits.five_hour.capturedAt, new Date(Date.parse(skewed)).toISOString());
  assert.equal(s.tools[0].freshness.capturedAt, new Date(Date.parse(skewed)).toISOString());
});

test('a non-canonical but parseable ISO string is round-tripped to canonical', () => {
  // The wire always carries ISO strings; a non-canonical offset form normalizes.
  assert.equal(normalizeIso('2026-07-02T12:00:00+00:00'), '2026-07-02T12:00:00.000Z');
  assert.equal(normalizeIso('2026-07-02T05:00:00-07:00'), '2026-07-02T12:00:00.000Z');
});

test('missing/extra fields → a partial reading, never a crash (QA-22, FR-20)', () => {
  // Extra fields ignored; missing fields degrade honestly.
  const s = normalizePeerState({ tools: [{ source: 'claude-code', somethingNew: 42, limits: {
    five_hour: { usedPct: 20, resetsAt: iso(3600_000) },
    // seven_day absent
  } }], extraTopLevel: 'x' });
  assert.equal(s.tools[0].limits.seven_day, null);
  assert.equal(s.tools[0].haveLimits, true);
  assert.ok(!('somethingNew' in s.tools[0]), 'unknown fields are not passed through the tool shape');
});

test('a top-level non-object or a payload with no tools array → null (offline, not junk)', () => {
  assert.equal(normalizePeerState(null), null);
  assert.equal(normalizePeerState('a string'), null);
  assert.equal(normalizePeerState({ nope: 1 }), null);
  assert.equal(normalizePeerState({ tools: 'not an array' }), null);
});

test('legacy or invalid device health stays null without invalidating a reachable peer', () => {
  assert.equal(normalizeDeviceHealth(undefined), null);
  assert.equal(normalizeDeviceHealth({ scope: 'host', pollIntervalMs: 60_000 }), null);
  assert.equal(normalizeDeviceHealth({ scope: 'device', pollIntervalMs: Infinity }), null);
  const legacy = normalizePeerState({ tools: [], generatedAt: iso(0) });
  assert.equal(legacy.deviceHealth, null);
  assert.deepEqual(legacy.tools, []);
});

test('peer device health is detached, timestamp-normalized, clamped, and path-free', () => {
  const raw = health();
  raw.cpu.usedPct = 150;
  raw.ram.usedPct = -5;
  raw.cpu.capturedAt = raw.cpu.capturedAt.replace('Z', '+00:00');
  const normalized = normalizeDeviceHealth(raw);
  assert.equal(normalized.cpu.usedPct, 100);
  assert.equal(normalized.ram.usedPct, 0);
  assert.match(normalized.cpu.capturedAt, /\.\d{3}Z$/);
  assert.equal(normalized.disk.availablePct, 24.4140625);
  assert.equal(normalized.disk.target, 'data-volume');
  assert.ok(!JSON.stringify(normalized).includes('/private/path'));
  raw.cpu.usedPct = 1;
  assert.equal(normalized.cpu.usedPct, 100);
});

test('hostile health values degrade only their metric and bounded reasons never pass through', () => {
  const raw = health({
    cpu: { status: 'available', usedPct: NaN, capturedAt: iso(0), attemptedAt: '<script>', updateStatus: 'future', reason: '<img>', intervalMs: -1 },
    ram: { status: 'unsupported', usedPct: null, capturedAt: null, attemptedAt: iso(0), updateStatus: 'unsupported', reason: 'future-enum' },
    disk: { status: 'available', availableBytes: 11, totalBytes: 10, availablePct: 100, target: '<script>', capturedAt: iso(0), attemptedAt: iso(0), updateStatus: 'ok', reason: 'unknown' },
  });
  const normalized = normalizeDeviceHealth(raw);
  assert.equal(normalized.cpu.status, 'unavailable');
  assert.equal(normalized.cpu.capturedAt, null);
  assert.equal(normalized.cpu.reason, null);
  assert.equal(normalized.ram.status, 'unsupported');
  assert.equal(normalized.ram.reason, 'unsupported-platform');
  assert.equal(normalized.disk.status, 'unavailable');
  assert.equal(normalized.disk.target, 'data-volume');
  assert.doesNotMatch(JSON.stringify(normalized), /script|img|future-enum|unknown/);
});

test('non-number peer CPU and RAM percentages never fabricate zero readings', () => {
  const nonNumbers = [null, false, '', [], {}];
  for (const metricName of ['cpu', 'ram']) {
    for (const usedPct of nonNumbers) {
      const raw = health();
      raw[metricName].usedPct = usedPct;
      const state = normalizePeerState({
        tools: [{ source: 'codex', limits: {} }],
        deviceHealth: raw,
        generatedAt: iso(0),
      });
      const affected = state.deviceHealth[metricName];
      const siblingName = metricName === 'cpu' ? 'ram' : 'cpu';

      assert.equal(affected.status, 'unavailable', `${metricName} ${JSON.stringify(usedPct)}`);
      assert.equal(affected.usedPct, null, `${metricName} ${JSON.stringify(usedPct)}`);
      assert.equal(affected.capturedAt, null, `${metricName} ${JSON.stringify(usedPct)}`);
      assert.equal(state.deviceHealth[siblingName].status, 'available');
      assert.equal(state.tools[0].source, 'codex', 'the reachable peer state survives');
    }
  }
});

test('valid last-good peer health survives a failed latest attempt', () => {
  const raw = health();
  raw.cpu.updateStatus = 'failed';
  raw.cpu.reason = 'counter-reset';
  raw.cpu.attemptedAt = iso(0);
  const normalized = normalizeDeviceHealth(raw);
  assert.equal(normalized.cpu.status, 'available');
  assert.equal(normalized.cpu.updateStatus, 'failed');
  assert.equal(normalized.cpu.reason, 'counter-reset');
  assert.notEqual(normalized.cpu.capturedAt, normalized.cpu.attemptedAt);
});

test('a tool with no source is dropped (can\'t be rendered honestly), others survive', () => {
  const s = normalizePeerState({ tools: [
    { limits: { five_hour: { usedPct: 10, resetsAt: iso(3600_000) } } }, // no source
    { source: 'codex', limits: {} },
  ] });
  assert.equal(s.tools.length, 1);
  assert.equal(s.tools[0].source, 'codex');
});

test('an activity with no data → hasData:false (honest not-available, never fabricated zeros) (QA-14)', () => {
  const s = normalizePeerState({ tools: [{ source: 'codex', limits: {}, activity: { hasData: false } }] });
  assert.equal(s.tools[0].activity.hasData, false);
  const s2 = normalizePeerState({ tools: [{ source: 'codex', limits: {} }] }); // activity missing
  assert.equal(s2.tools[0].activity.hasData, false);
});

test('a limitsDiagnostic crosses the wire with reason + raw free-form fields (for render-time escape)', () => {
  const s = normalizePeerState({ tools: [{ source: 'codex', limits: {}, limitsDiagnostic: {
    reason: 'codex-cmd-failed', cmd: 'codex', detail: '<script>' } }] });
  const d = s.tools[0].limitsDiagnostic;
  assert.equal(d.reason, 'codex-cmd-failed');
  assert.equal(d.detail, '<script>'); // raw — the CLIENT esc()s it
});

test('freshness with non-finite thresholds → null (no band), a valid one is preserved (QA-10)', () => {
  const bad = normalizePeerState({ tools: [{ source: 'claude-code', limits: {}, freshness: { freshForMs: 'x', staleAfterMs: 'y' } }] });
  assert.equal(bad.tools[0].freshness, null);
  const good = normalizePeerState({ tools: [{ source: 'claude-code', limits: {}, freshness: { capturedAt: iso(-30_000), freshForMs: 300_000, staleAfterMs: 600_000 } }] });
  assert.deepEqual(Object.keys(good.tools[0].freshness).sort(), ['capturedAt', 'freshForMs', 'staleAfterMs']);
});

test('model-specific limits from peers are clamped, timestamp-normalized, and raw-label safe', () => {
  const s = normalizePeerState({ tools: [{ source: 'claude-code', limits: {}, modelLimits: [{
    source: 'claude-model:fable<script>',
    provider: 'claude-code',
    model: 'Fable',
    label: '<img src=x onerror=alert(1)>',
    window: 'weekly',
    usedPct: 150,
    remainingPct: 999,
    resetsAt: '2026-07-02T05:00:00-07:00',
    capturedAt: 'not-a-date',
    extra: '<script>',
  }] }] });
  const m = s.tools[0].modelLimits[0];
  assert.equal(m.source, 'claude-model:fablescript');
  assert.equal(m.model, 'fable');
  assert.equal(m.label, '<img src=x onerror=alert(1)>'); // raw; the CLIENT esc()s it
  assert.equal(m.window, 'seven_day');
  assert.equal(m.usedPct, 100);
  assert.equal(m.remainingPct, 0);
  assert.equal(m.resetsAt, '2026-07-02T12:00:00.000Z');
  assert.equal(m.capturedAt, null);
  assert.ok(!('extra' in m), 'unknown peer model-limit fields are dropped');
});

test('legacy peers and hostile reset-credit values degrade to the fixed unsupported shape', () => {
  const unsupported = {
    available: false,
    status: 'unsupported',
    availableCount: null,
    expirations: [],
    missingExpirationCount: 0,
    capturedAt: null,
  };
  assert.deepEqual(normalizeAccountLimits(undefined), {
    scope: 'account-wide', resetCredits: unsupported,
  });
  assert.deepEqual(normalizeAccountLimits({ scope: 'machine', resetCredits: {} }), {
    scope: 'account-wide', resetCredits: unsupported,
  });
  for (const value of [
    null,
    [],
    { available: true, status: 'future-enum', availableCount: 3, capturedAt: iso(0) },
    { available: true, status: 'available', availableCount: '<img>', capturedAt: iso(0) },
    { available: true, status: 'available', availableCount: 3, capturedAt: 'bad-date' },
    { available: false, status: 'available', availableCount: 3, capturedAt: iso(0) },
  ]) assert.deepEqual(normalizeResetCredits(value), unsupported);

  const legacy = normalizePeerState({ tools: [{ source: 'codex', limits: {} }] });
  assert.deepEqual(legacy.tools[0].accountLimits, {
    scope: 'account-wide', resetCredits: unsupported,
  });
});

test('peer reset credits are detached, canonical, bounded, and time-aware', () => {
  const now = Date.UTC(2026, 6, 30, 12, 0, 0);
  const first = new Date(now + 60_000).toISOString();
  const sharedOffset = new Date(now + 2 * 60_000).toISOString().replace('Z', '+00:00');
  const raw = {
    available: true,
    status: 'partial',
    availableCount: 4,
    expirations: [
      new Date(now - 1).toISOString(),
      sharedOffset,
      first,
      sharedOffset,
      'not-a-date',
      { nested: true },
    ],
    missingExpirationCount: -999,
    capturedAt: '2026-07-30T05:00:00-07:00',
    id: 'drop-me',
    title: '<img src=x>',
  };
  const normalized = normalizeResetCredits(raw, now);
  assert.deepEqual(normalized, {
    available: true,
    status: 'available',
    availableCount: 3,
    expirations: [
      first,
      new Date(Date.parse(sharedOffset)).toISOString(),
      new Date(Date.parse(sharedOffset)).toISOString(),
    ],
    missingExpirationCount: 0,
    capturedAt: '2026-07-30T12:00:00.000Z',
  });
  raw.expirations[1] = 'mutated';
  normalized.expirations[0] = 'also-mutated';
  const again = normalizeResetCredits({
    ...raw,
    expirations: [new Date(now - 1).toISOString(), sharedOffset, first, sharedOffset],
  }, now);
  assert.equal(again.expirations[0], first);
  assert.ok(!('id' in again) && !('title' in again));

  const atFirstBoundary = normalizeResetCredits({
    available: true,
    status: 'available',
    availableCount: 2,
    expirations: [first, sharedOffset],
    capturedAt: iso(0),
  }, Date.parse(first));
  assert.equal(atFirstBoundary.availableCount, 1);
  assert.deepEqual(atFirstBoundary.expirations, [new Date(Date.parse(sharedOffset)).toISOString()]);
});

test('peer model-limit collections and display strings are bounded before rendering', () => {
  const modelLimits = Array.from({ length: 140 }, (_, index) => ({
    source: `claude-model:cap-${index}`,
    model: `cap-${index}`,
    provider: `Claude\u202e${'x'.repeat(120)}`,
    label: `Cap\u0000${index}${'y'.repeat(120)}`,
    window: 'weekly',
    usedPct: 10,
    capturedAt: iso(0),
  }));
  const state = normalizePeerState({ tools: [{ source: 'claude-code', limits: {}, modelLimits }] });
  assert.equal(state.tools[0].modelLimits.length, 128);
  assert.ok([...state.tools[0].modelLimits[0].provider].length <= 96);
  assert.ok([...state.tools[0].modelLimits[0].label].length <= 96);
  assert.doesNotMatch(state.tools[0].modelLimits[0].provider, /\u202e/u);
  assert.doesNotMatch(state.tools[0].modelLimits[0].label, /\u0000/u);
});

// ── getCombined / the /api/hosts payload — per-host independence (FR-13) ──────

test('getCombined carries every host\'s full per-tool picture + freshness/offline state (QA-06)', () => {
  _reset();
  const at = iso(0);
  setHost('local:8787', { host: 'local', label: 'This machine', port: 8787, self: true, reachable: true, hostDiagnostic: null, fetchedAt: at, state: normalizePeerState({ tools: [{ source: 'claude-code', limits: { five_hour: { usedPct: 62, resetsAt: iso(3600_000), capturedAt: iso(-30_000) } }, freshness: { capturedAt: iso(-30_000), freshForMs: 300_000, staleAfterMs: 600_000 } }] }) });
  setHost('100.64.0.7:8787', { host: '100.64.0.7', label: 'Desktop', port: 8787, self: false, reachable: true, hostDiagnostic: null, fetchedAt: at, state: normalizePeerState({ tools: [{ source: 'claude-code', limits: { five_hour: { usedPct: 62, resetsAt: iso(3600_000), capturedAt: iso(-30_000) } } }] }) });
  const c = getCombined();
  assert.equal(c.hosts.length, 2);
  assert.equal(c.hosts[0].self, true);
  assert.ok(c.hosts[0].state.tools[0].freshness, 'each host carries its own freshness');
  assert.ok(typeof c.generatedAt === 'string');
  _reset();
});

test('one offline host does not flag or suppress another (independent per host, QA-13)', () => {
  _reset();
  const at = iso(0);
  setHost('local:8787', { host: 'local', label: 'This machine', port: 8787, self: true, reachable: true, hostDiagnostic: null, fetchedAt: at, state: normalizePeerState({ tools: [{ source: 'claude-code', limits: { five_hour: { usedPct: 10, resetsAt: iso(3600_000), capturedAt: iso(-30_000) } } }] }) });
  setHost('100.64.0.9:8787', { host: '100.64.0.9', label: 'Work laptop', port: 8787, self: false, reachable: false, hostDiagnostic: { reason: 'peer-unreachable', cause: 'timeout', detail: 'no response within 3000ms' }, fetchedAt: at, state: null });
  const c = getCombined();
  const local = c.hosts.find((h) => h.self);
  const off = c.hosts.find((h) => h.label === 'Work laptop');
  assert.equal(local.reachable, true);
  assert.ok(local.state.tools[0].limits.five_hour, 'the reachable host is unaffected');
  assert.equal(off.reachable, false);
  assert.equal(off.state, null, 'offline-only: no fabricated reading');
  assert.equal(off.hostDiagnostic.reason, 'peer-unreachable');
  _reset();
});

test('the new peer reason codes never reuse the reserved auto-refresh names', () => {
  // Enumerate the codes this feature emits (from hosts.js/poller.js) and assert
  // the reserved names are not among them.
  const reserved = ['auto-refresh-failing', 'auto-refresh-disabled'];
  const peerReasons = ['peer-unreachable', 'peer-error'];
  for (const r of peerReasons) assert.ok(!reserved.includes(r));
});

test('host ordering is stable (offline hosts stay in place, not sorted to the bottom)', () => {
  _reset();
  const at = iso(0);
  setHost('local:8787', { host: 'local', label: 'This machine', port: 8787, self: true, reachable: true, hostDiagnostic: null, fetchedAt: at, state: normalizePeerState({ tools: [] }) });
  setHost('a:8787', { host: 'a', label: 'A', port: 8787, self: false, reachable: false, hostDiagnostic: { reason: 'peer-unreachable', cause: 'timeout' }, fetchedAt: at, state: null });
  setHost('b:8787', { host: 'b', label: 'B', port: 8787, self: false, reachable: true, hostDiagnostic: null, fetchedAt: at, state: normalizePeerState({ tools: [] }) });
  const labels = getCombined().hosts.map((h) => h.label);
  assert.deepEqual(labels, ['This machine', 'A', 'B'], 'insertion order preserved, offline A not moved');
  _reset();
});
