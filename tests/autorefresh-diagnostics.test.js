import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// /api/state's claude diagnostic with the auto-refresh reason codes.
// Precedence (FR-18): auto-refresh-failing > auto-refresh-disabled >
// stale-reading / no-statusline-reading — exactly one code (or null), decided
// by the server. The refresh state is injected via buildState's second
// parameter; the default parameter is the live mechanism state (QA-18's
// first-run honesty is asserted through that default too).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-autorefresh-diag-'));
process.env.LLMDASH_DATA_DIR = path.join(tmp, 'data');
process.env.LLMDASH_CLAUDE_DIR = path.join(tmp, 'claude');
process.env.LLMDASH_CODEX_DIR = path.join(tmp, 'codex');
process.env.LLMDASH_CODEX_CMD = path.join(tmp, 'missing', 'codex');
process.env.LLMDASH_CLAUDE_CMD = path.join(tmp, 'missing', 'claude');
delete process.env.LLMDASH_CLAUDE_MAX_AGE_MS;
delete process.env.LLMDASH_CLAUDE_AUTOREFRESH;

const { buildState } = await import('../src/server.js');
const { config } = await import('../config.js');

const NOW = Date.UTC(2026, 6, 2, 12, 0, 0);
const iso = (ms) => new Date(ms).toISOString();

function writeReading(ageMs) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(config.rateLimitsFile, JSON.stringify({
    rate_limits: {
      five_hour: { used_percentage: 30, resets_at: iso(NOW + 3600_000) },
      seven_day: { used_percentage: 12, resets_at: iso(NOW + 86400_000) },
    },
    capturedAt: iso(NOW - ageMs),
  }));
}
const noReading = () => { fs.rmSync(config.rateLimitsFile, { force: true }); };

// A contrived mechanism state; defaults are the healthy enabled baseline.
const rs = (over = {}) => ({
  disabled: false, inFlight: false, lastAttemptAt: null, nextAttemptAt: null,
  consecutiveFailures: 0, lastFailureCause: null, ...over,
});
const claudeOf = (refresh) => buildState(NOW, refresh).tools.find((t) => t.source === 'claude-code');

test('stale reading + 3 consecutive failures → auto-refresh-failing with cause, age fields, gauges intact (QA-15)', () => {
  writeReading(47 * 60_000);
  const c = claudeOf(rs({ consecutiveFailures: 3, lastFailureCause: 'timeout' }));
  assert.deepEqual(c.limitsDiagnostic, {
    reason: 'auto-refresh-failing',
    cause: 'timeout',
    capturedAt: iso(NOW - 47 * 60_000),
    ageMs: 47 * 60_000,
  });
  assert.equal(c.haveLimits, true); // flagged, never blanked
  assert.equal(c.limits.five_hour.usedPct, 30);
});

test('no reading ever + 3 failures → auto-refresh-failing without fabricated age fields', () => {
  noReading();
  const c = claudeOf(rs({ consecutiveFailures: 3, lastFailureCause: 'spawn-error' }));
  assert.deepEqual(c.limitsDiagnostic, { reason: 'auto-refresh-failing', cause: 'spawn-error' });
});

test('2 failures is not yet failing — the plain stale code holds until the 3rd (FR-16)', () => {
  writeReading(20 * 60_000);
  const c = claudeOf(rs({ consecutiveFailures: 2, lastFailureCause: 'timeout' }));
  assert.equal(c.limitsDiagnostic.reason, 'stale-reading');
});

test('stale reading + disabled → auto-refresh-disabled with age fields (QA-16)', () => {
  writeReading(3 * 3600_000);
  const c = claudeOf(rs({ disabled: true }));
  assert.deepEqual(c.limitsDiagnostic, {
    reason: 'auto-refresh-disabled',
    capturedAt: iso(NOW - 3 * 3600_000),
    ageMs: 3 * 3600_000,
  });
});

test('no reading ever + disabled → auto-refresh-disabled without age fields', () => {
  noReading();
  const c = claudeOf(rs({ disabled: true }));
  assert.deepEqual(c.limitsDiagnostic, { reason: 'auto-refresh-disabled' });
});

test('precedence: failing beats disabled beats stale — exactly one code (FR-18, QA-17)', () => {
  writeReading(60 * 60_000);
  const c = claudeOf(rs({ disabled: true, consecutiveFailures: 5, lastFailureCause: 'parse-failed' }));
  assert.equal(c.limitsDiagnostic.reason, 'auto-refresh-failing');
  assert.equal(c.limitsDiagnostic.cause, 'parse-failed');
});

test('the new codes never fire while the reading is fresh or aging — whatever the mechanism state', () => {
  for (const ageMs of [2 * 60_000, 7 * 60_000]) { // fresh band, aging band
    writeReading(ageMs);
    assert.equal(claudeOf(rs({ consecutiveFailures: 9, lastFailureCause: 'timeout' })).limitsDiagnostic, null, `failing suppressed at age ${ageMs}`);
    assert.equal(claudeOf(rs({ disabled: true })).limitsDiagnostic, null, `disabled suppressed at age ${ageMs}`);
  }
});

test('first-run honesty via the LIVE default state: zero attempts ⇒ the existing code (FR-19, QA-18)', () => {
  noReading();
  // No refresh state injected — buildState falls back to the real mechanism
  // state, which has performed zero attempts in this process.
  const c = buildState(NOW).tools.find((t) => t.source === 'claude-code');
  assert.deepEqual(c.limitsDiagnostic, { reason: 'no-statusline-reading' });
});

test('stale reading with a healthy enabled mechanism keeps the existing stale-reading code', () => {
  writeReading(11 * 60_000);
  const c = claudeOf(rs());
  assert.deepEqual(c.limitsDiagnostic, {
    reason: 'stale-reading',
    capturedAt: iso(NOW - 11 * 60_000),
    ageMs: 11 * 60_000,
  });
});

test('the cause crosses the wire as the enum value — /api/state carries no free-form failure text', () => {
  writeReading(60 * 60_000);
  const payload = JSON.stringify(buildState(NOW, rs({ consecutiveFailures: 4, lastFailureCause: 'no-reading-produced' })));
  assert.ok(payload.includes('"cause":"no-reading-produced"'));
  // The wire never carries the console log's prose (the client maps the enum).
  assert.ok(!payload.includes('probe sessions'), 'no log prose on the wire');
});

test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
