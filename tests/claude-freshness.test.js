import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// Reading-age freshness (statusline-auto-refresh, branch B). /api/state's
// claude tool carries server-supplied thresholds (`freshness`) and the server
// derives exactly one diagnostic code — or null — from the reading's age.
// Each band is fabricated by writing claude-ratelimits.json with a chosen
// capturedAt into a temp sandbox; buildState() is pure on nowMs.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-fresh-'));
process.env.LLMDASH_DATA_DIR = path.join(tmp, 'data');
process.env.LLMDASH_CLAUDE_DIR = path.join(tmp, 'claude');
process.env.LLMDASH_CODEX_DIR = path.join(tmp, 'codex');
process.env.LLMDASH_CODEX_CMD = path.join(tmp, 'missing', 'codex');
delete process.env.LLMDASH_CLAUDE_MAX_AGE_MS;

const { buildState } = await import('../src/server.js');
const { readClaudeLimits } = await import('../src/claude-limits.js');
const { config } = await import('../config.js');

const NOW = Date.UTC(2026, 6, 1, 12, 0, 0);
const iso = (ms) => new Date(ms).toISOString();

function writeReading({ ageMs, omitCapturedAt = false, capturedAt } = {}) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const body = {
    rate_limits: {
      five_hour: { used_percentage: 30, resets_at: iso(NOW + 3600_000) },
      seven_day: { used_percentage: 12, resets_at: iso(NOW + 86400_000) },
    },
  };
  if (!omitCapturedAt) body.capturedAt = capturedAt ?? iso(NOW - ageMs);
  fs.writeFileSync(config.rateLimitsFile, JSON.stringify(body));
}

const claudeState = () => buildState(NOW).tools.find((t) => t.source === 'claude-code');

test('fresh reading (2m): freshness carried, no diagnostic (QA-16 server side)', () => {
  writeReading({ ageMs: 2 * 60_000 });
  const c = claudeState();
  assert.equal(c.haveLimits, true);
  assert.deepEqual(c.freshness, {
    capturedAt: iso(NOW - 2 * 60_000),
    freshForMs: 300_000,
    staleAfterMs: 600_000,
  });
  assert.equal(c.limitsDiagnostic, null);
});

test('aging reading (7m): still no diagnostic — aging is a client-derived band (QA-17)', () => {
  writeReading({ ageMs: 7 * 60_000 });
  assert.equal(claudeState().limitsDiagnostic, null);
});

test('stale reading (11m): exactly stale-reading with capturedAt and ageMs; gauges intact (QA-18/20)', () => {
  writeReading({ ageMs: 11 * 60_000 });
  const c = claudeState();
  assert.equal(c.haveLimits, true); // flagged, never blanked (FR-17)
  assert.equal(c.limits.five_hour.usedPct, 30); // the last capture still renders
  assert.deepEqual(c.limitsDiagnostic, {
    reason: 'stale-reading',
    capturedAt: iso(NOW - 11 * 60_000),
    ageMs: 11 * 60_000,
  });
});

test('boundary: age exactly staleAfterMs is not yet stale (strict >)', () => {
  writeReading({ ageMs: 600_000 });
  assert.equal(claudeState().limitsDiagnostic, null);
});

test('no reading ever: exactly no-statusline-reading; thresholds still served (QA-25)', () => {
  fs.rmSync(config.rateLimitsFile, { force: true });
  const c = claudeState();
  assert.equal(c.haveLimits, false);
  assert.deepEqual(c.limitsDiagnostic, { reason: 'no-statusline-reading' });
  assert.deepEqual(c.freshness, { capturedAt: null, freshForMs: 300_000, staleAfterMs: 600_000 });
});

test('exactly one reason code or null in every band — never two (QA-21)', () => {
  for (const [ageMs, expected] of [
    [60_000, null], // fresh
    [7 * 60_000, null], // aging
    [3 * 3600_000, 'stale-reading'], // deep stale
  ]) {
    writeReading({ ageMs });
    const d = claudeState().limitsDiagnostic;
    if (expected === null) assert.equal(d, null, `age ${ageMs}ms`);
    else assert.deepEqual(Object.keys(d).includes('reason') && d.reason, expected, `age ${ageMs}ms`);
  }
  fs.rmSync(config.rateLimitsFile, { force: true });
  const d = claudeState().limitsDiagnostic;
  assert.equal(d.reason, 'no-statusline-reading');
  assert.equal('ageMs' in d, false); // no stale fields on the no-reading code
});

test('codex carries no freshness treatment (not retrofitted)', () => {
  writeReading({ ageMs: 60_000 });
  const codex = buildState(NOW).tools.find((t) => t.source === 'codex');
  assert.equal(codex.freshness, null);
});

test('a future capturedAt (clock skew) is never stale', () => {
  writeReading({ ageMs: -120_000 }); // 2m in the future
  assert.equal(claudeState().limitsDiagnostic, null);
});

test('missing capturedAt falls back to file mtime — never re-stamped to now (honesty fix)', () => {
  writeReading({ omitCapturedAt: true });
  const mtime = new Date(NOW - 20 * 60_000);
  fs.utimesSync(config.rateLimitsFile, mtime, mtime);
  assert.equal(readClaudeLimits().capturedAt, mtime.toISOString());
  // The derived state flags it stale — a malformed file must not read as
  // eternally fresh (the pre-fix behavior re-stamped it "now" on every read).
  assert.equal(claudeState().limitsDiagnostic.reason, 'stale-reading');
});

test('an unparseable capturedAt falls back to mtime too', () => {
  writeReading({ capturedAt: 'not-a-date' });
  const mtime = new Date(NOW - 15 * 60_000);
  fs.utimesSync(config.rateLimitsFile, mtime, mtime);
  assert.equal(readClaudeLimits().capturedAt, mtime.toISOString());
});

test('capturedAt is re-serialized to canonical ISO at ingest — hostile strings never survive', () => {
  // V8's Date.parse accepts arbitrary parenthesized content, so this string
  // parses to a finite timestamp; the raw form must still never leave the
  // reader (it would cross the tailnet on /api/state and be persisted to
  // SQLite by the poller — a latent stored XSS).
  writeReading({ capturedAt: '2026 (<img src=x onerror=alert(1)>)' });
  const out = readClaudeLimits().capturedAt;
  assert.match(out, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/); // canonical ISO only
  const payload = JSON.stringify(buildState(NOW));
  assert.ok(!payload.includes('<img'), 'no markup in the /api/state payload');
  assert.ok(!payload.includes('onerror'), 'no handler text in the /api/state payload');
});

test('a valid but non-ISO capturedAt is normalized to canonical ISO', () => {
  writeReading({ capturedAt: 'Wed, 01 Jul 2026 11:58:00 GMT' });
  assert.equal(readClaudeLimits().capturedAt, iso(NOW - 2 * 60_000));
});

// --- Knob parsing (clamp convention for externally-sourced values) ----------
// config.js evaluates env at module load; re-import with a query string to get
// a fresh evaluation per case (the singleton above is untouched).

test('LLMDASH_CLAUDE_MAX_AGE_MS: garbage/zero/negative fall back to 300000; huge values clamp to the 7-day ceiling', async () => {
  for (const [raw, expected] of [
    ['garbage', 300_000],
    ['0', 300_000],
    ['-5000', 300_000],
    ['', 300_000],
    ['120000', 120_000],
    ['Infinity', 300_000], // non-finite → default
    ['9e307', 604_800_000], // near-MAX_VALUE would overflow 2× to Infinity (JSON null) → ceiling
    ['604800001', 604_800_000], // just past the ceiling → clamped
    ['604800000', 604_800_000], // at the ceiling → kept
  ]) {
    process.env.LLMDASH_CLAUDE_MAX_AGE_MS = raw;
    const { config: c } = await import(`../config.js?maxage=${encodeURIComponent(raw) || 'empty'}`);
    assert.equal(c.claudeMaxAgeMs, expected, `raw="${raw}"`);
    assert.equal(c.claudeStaleAfterMs, expected * 2, `raw="${raw}" (stale = derived 2x)`);
    assert.ok(Number.isFinite(c.claudeStaleAfterMs), `raw="${raw}" (staleAfterMs stays finite on the wire)`);
  }
  delete process.env.LLMDASH_CLAUDE_MAX_AGE_MS;
});

test('LLMDASH_CLAUDE_MAX_AGE_MS unset: default 300000, stale derived 600000', async () => {
  delete process.env.LLMDASH_CLAUDE_MAX_AGE_MS;
  const { config: c } = await import('../config.js?maxage=unset');
  assert.equal(c.claudeMaxAgeMs, 300_000);
  assert.equal(c.claudeStaleAfterMs, 600_000);
});

test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
