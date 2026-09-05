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
// Keep the auto-refresh state at its enabled zero-attempt baseline so the
// band-derived codes (stale-reading etc.) are the ones under test here.
delete process.env.LLMDASH_CLAUDE_AUTOREFRESH;

const { buildState } = await import('../src/server.js');
const {
  readClaudeLimits, expiredModelCap, MODEL_LIMIT_EXPIRED_DISCLOSURE_MS,
} = await import('../src/claude-limits.js');
const { insertSnapshot } = await import('../src/db.js');
const { config } = await import('../config.js');

const NOW = Date.UTC(2026, 6, 1, 12, 0, 0);
const iso = (ms) => new Date(ms).toISOString();

function writeReading({ ageMs, omitCapturedAt = false, capturedAt, modelLimits } = {}) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const body = {
    rate_limits: {
      five_hour: { used_percentage: 30, resets_at: iso(NOW + 3600_000) },
      seven_day: { used_percentage: 12, resets_at: iso(NOW + 86400_000) },
    },
  };
  if (modelLimits) body.model_limits = modelLimits;
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

test('codex carries poll-derived freshness thresholds (FM-X2, ratified): fresh ≤ 2 polls, stale > 5; no fabricated capture', () => {
  writeReading({ ageMs: 60_000 });
  const codex = buildState(NOW).tools.find((t) => t.source === 'codex');
  assert.deepEqual(codex.freshness, {
    capturedAt: null, // no Codex reading in this sandbox — the client renders no band
    freshForMs: 2 * config.pollIntervalMs,
    staleAfterMs: 5 * config.pollIntervalMs,
  });
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

test('local provider model caps are bounded and formatting controls are stripped before state assembly', () => {
  const modelLimits = Array.from({ length: 140 }, (_, index) => ({
    source: `claude-model:cap-${index}${'s'.repeat(140)}`,
    model: `cap-${index}${'m'.repeat(140)}`,
    label: `Cap\u0000\u202e${index}${'x'.repeat(140)}`,
    window: 'seven_day',
    used_percentage: 49,
    resets_at: iso(NOW + 86400_000),
  }));
  writeReading({ ageMs: 60_000, modelLimits });
  const limits = readClaudeLimits(NOW).modelLimits;
  assert.equal(limits.length, 128);
  assert.ok(limits.every((limit) => [...limit.label].length <= 96));
  assert.ok(limits.every((limit) => limit.model.length <= 96));
  assert.ok(limits.every((limit) => limit.source.length <= 110));
  assert.doesNotMatch(limits[0].label, /[\u0000\u202e]/u);
  assert.doesNotMatch(JSON.stringify(claudeState().modelLimits), /[\u0000\u202e]/u);
});

test('reset-less model caps keep independent evidence age and expire after one weekly window', () => {
  const capturedAt = iso(NOW - 60_000);
  writeReading({
    capturedAt,
    modelLimits: [{
      source: 'claude-model:fable', model: 'fable', label: 'Fable',
      window: 'seven_day', used_percentage: 49, resets_at: null,
      captured_at: capturedAt,
    }],
  });
  assert.equal(readClaudeLimits(NOW).modelLimits.length, 1);
  assert.equal(readClaudeLimits(NOW + 6 * 86400_000).modelLimits[0].resetsAt, null);
  assert.equal(readClaudeLimits(NOW + 7 * 86400_000).modelLimits.length, 0);
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

// --- tailnet-bind-and-reporting-resilience: Claude model caps ----------------
// These run LAST in the file: the model-cap-expired case seeds the sandbox DB
// with a stored cap row, and earlier cases assert a null diagnostic.

test('a model cap whose reset passed within the 5-minute clock-skew grace is still active; past it, it expires (FM-C3)', () => {
  const cap = (resetOffsetMs) => [{
    source: 'claude-model:fable', model: 'fable', label: 'Fable', window: 'seven_day',
    used_percentage: 100, resets_at: iso(NOW + resetOffsetMs), captured_at: iso(NOW - 3600_000),
  }];
  writeReading({ ageMs: 60_000, modelLimits: cap(-2 * 60_000) });
  assert.equal(readClaudeLimits(NOW).modelLimits.length, 1, 'reset 2m ago (inside the skew grace) is still active');
  assert.equal(readClaudeLimits(NOW).modelLimits[0].resetsAt, iso(NOW - 2 * 60_000));
  writeReading({ ageMs: 60_000, modelLimits: cap(-(5 * 60_000 - 1)) });
  assert.equal(readClaudeLimits(NOW).modelLimits.length, 1, 'just inside the grace');
  writeReading({ ageMs: 60_000, modelLimits: cap(-5 * 60_000) });
  assert.equal(readClaudeLimits(NOW).modelLimits.length, 0, 'at the grace boundary it has expired');
  writeReading({ ageMs: 60_000, modelLimits: cap(-6 * 60_000) });
  assert.equal(readClaudeLimits(NOW).modelLimits.length, 0, 'reset 6m ago is expired');
});

test('an aged-out model cap is disclosed as model-cap-expired (lowest precedence) with its last observation, never a value (FM-C1)', () => {
  const lastCapturedAt = iso(NOW - 11 * 3600_000);
  // The poller stored this cap while it was active; its reset has since passed.
  insertSnapshot({ capturedAt: lastCapturedAt, source: 'claude-model:fable', window: 'seven_day', usedPct: 100, resetsAt: iso(NOW - 3600_000) });
  writeReading({ ageMs: 60_000 }); // a fresh account reading with no caps
  const c = claudeState();
  assert.equal(c.haveLimits, true);
  assert.deepEqual(c.modelLimits, [], 'the expired cap is not revived as a value');
  assert.deepEqual(c.limitsDiagnostic, { reason: 'model-cap-expired', model: 'fable', lastCapturedAt });
  assert.equal('cause' in c.limitsDiagnostic, false, 'no probe failure established → no cause field');

  // Once the probe has failed 3+ times the cause rides along (own-key enum on the client).
  const failing = buildState(NOW, {
    disabled: false, inFlight: false, lastAttemptAt: null, nextAttemptAt: null,
    consecutiveFailures: 3, lastFailureCause: 'parse-failed',
  }).tools.find((t) => t.source === 'claude-code');
  assert.deepEqual(failing.limitsDiagnostic, { reason: 'model-cap-expired', model: 'fable', lastCapturedAt, cause: 'parse-failed' });
  const twoFailures = buildState(NOW, {
    disabled: false, inFlight: false, lastAttemptAt: null, nextAttemptAt: null,
    consecutiveFailures: 2, lastFailureCause: 'timeout',
  }).tools.find((t) => t.source === 'claude-code');
  assert.equal('cause' in twoFailures.limitsDiagnostic, false, 'the same 3-failure threshold as auto-refresh-failing');

  // An ACTIVE cap for the same model+window in the reading → nothing has expired.
  writeReading({ ageMs: 60_000, modelLimits: [{
    source: 'claude-model:fable', model: 'fable', label: 'Fable', window: 'seven_day',
    used_percentage: 40, resets_at: iso(NOW + 86400_000), captured_at: iso(NOW - 60_000),
  }] });
  assert.equal(claudeState().limitsDiagnostic, null);
  assert.equal(claudeState().modelLimits.length, 1);

  // Precedence: a stale reading outranks it (the gauges themselves are old).
  writeReading({ ageMs: 11 * 60_000 });
  assert.equal(claudeState().limitsDiagnostic.reason, 'stale-reading');
  // …and no-statusline-reading outranks it.
  fs.rmSync(config.rateLimitsFile, { force: true });
  assert.deepEqual(claudeState().limitsDiagnostic, { reason: 'no-statusline-reading' });
});

test('expiredModelCap is bounded and pure: newest observation wins, still-active rows and old history are not named', () => {
  const rows = [
    { source: 'claude-model:fable', window: 'seven_day', resets_at: iso(NOW - 3600_000), captured_at: iso(NOW - 2 * 3600_000) },
    { source: 'claude-model:sonnet-4-5', window: 'seven_day', resets_at: iso(NOW - 3600_000), captured_at: iso(NOW - 3 * 3600_000) },
    { source: 'claude-model:opus', window: 'seven_day', resets_at: iso(NOW + 3600_000), captured_at: iso(NOW - 60_000) }, // still active by time — absent from the reading, but nothing is guessed
    { source: 'claude-model:haiku', window: 'seven_day', resets_at: null, captured_at: iso(NOW - MODEL_LIMIT_EXPIRED_DISCLOSURE_MS - 1) }, // beyond the disclosure window
    { source: 'claude-code', window: 'seven_day', resets_at: iso(NOW - 3600_000), captured_at: iso(NOW - 60_000) }, // account window, not a cap
    { source: 'claude-model:future', window: 'seven_day', resets_at: iso(NOW - 3600_000), captured_at: iso(NOW + 3600_000) }, // future-dated evidence is not trusted
  ];
  assert.deepEqual(expiredModelCap([], NOW, rows), { model: 'fable', window: 'seven_day', lastCapturedAt: iso(NOW - 2 * 3600_000) });
  // An active cap for fable in the reading → sonnet is the newest EXPIRED one.
  assert.deepEqual(expiredModelCap([{ model: 'fable', window: 'seven_day' }], NOW, rows),
    { model: 'sonnet-4-5', window: 'seven_day', lastCapturedAt: iso(NOW - 3 * 3600_000) });
  assert.equal(expiredModelCap([], NOW, []), null);
  assert.equal(expiredModelCap([], NOW, null), null);
  assert.equal(expiredModelCap([], NOW, [{ source: 'claude-model:x', window: 'seven_day', captured_at: 'garbage' }]), null);
  // Within the skew grace a passed reset is still active — not expired.
  assert.equal(expiredModelCap([], NOW, [{ source: 'claude-model:fable', window: 'seven_day', resets_at: iso(NOW - 2 * 60_000), captured_at: iso(NOW - 3600_000) }]), null);
});

test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
