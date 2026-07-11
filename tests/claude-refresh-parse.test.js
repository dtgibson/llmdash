import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The /usage-pane parser and reset-time conversion, tested against the REAL
// pty captures from the Stage-3 spike (tests/fixtures/usage-pane-{1,2}.txt) —
// never synthetic panes. The parser is the mechanism's fragile surface: a
// layout change must fail loudly (parse-failed), never emit a partial or
// fabricated reading (FR-08, QA-06).
const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => fs.readFileSync(path.join(here, 'fixtures', `usage-pane-${n}.txt`), 'utf8');

const {
  parseUsagePane, resetTextToEpoch, buildReadingPayload, writeReadingIfNewer,
} = await import('../src/claude-refresh.js');

// The moment the spike captured both panes — all epoch expectations anchor here.
const CAPTURE_MS = Date.parse('2026-07-02T06:42:00Z');

test('fixture 1 parses: both contract windows, reset text and IANA zone', () => {
  const r = parseUsagePane(fixture(1));
  assert.equal(r.ok, true);
  assert.deepEqual(r.windows.five_hour, { usedPct: 77, resetText: '12:20am', zone: 'America/Los_Angeles' });
  assert.deepEqual(r.windows.seven_day, { usedPct: 25, resetText: 'Jul 3 at 11pm', zone: 'America/Los_Angeles' });
});

test('fixture 2 parses: the independent capture (live window drained 77→76)', () => {
  const r = parseUsagePane(fixture(2));
  assert.equal(r.ok, true);
  assert.equal(r.windows.five_hour.usedPct, 76);
  assert.equal(r.windows.seven_day.usedPct, 25);
});

test('the Fable model meter is parsed separately, never as an account-wide window', () => {
  for (const n of [1, 2]) {
    const r = parseUsagePane(fixture(n));
    // Only the two account-wide windows exist in the account result…
    assert.deepEqual(Object.keys(r.windows).sort(), ['five_hour', 'seven_day']);
    // …and neither carries the Fable meter's 49%.
    assert.notEqual(r.windows.five_hour.usedPct, 49);
    assert.notEqual(r.windows.seven_day.usedPct, 49);
    const fable = r.modelLimits.find((m) => m.model === 'fable');
    assert.ok(fable, 'Fable cap is present as a model-specific limit');
    assert.equal(fable.source, 'claude-model:fable');
    assert.equal(fable.label, 'Fable');
    assert.equal(fable.window, 'seven_day');
    assert.equal(fable.usedPct, 49);
    assert.equal(fable.resetText, 'Jul 3 at 11pm');
    assert.equal(fable.zone, 'America/Los_Angeles');
  }
});

test('a Sonnet-style model cap parses after the contributing section', () => {
  const pane = 'Current session 42% used Resets 3:05pm (America/Los_Angeles)\n'
    + 'Current week (all models) 10% used Resets Jul 9 at 1am (America/Los_Angeles)\n'
    + "What's contributing to your weekly usage?\n"
    + 'Current week (Sonnet 4.5) 88% used Resets Jul 9 at 1am (America/Los_Angeles)\n';
  const r = parseUsagePane(pane);
  assert.equal(r.ok, true);
  assert.equal(r.windows.seven_day.usedPct, 10);
  assert.deepEqual(r.modelLimits.map((m) => [m.model, m.label, m.usedPct]), [
    ['sonnet-4-5', 'Sonnet 4.5', 88],
  ]);
});

test('reset epochs match the authoritative statusline epochs exactly (the spike cross-check)', () => {
  const r = parseUsagePane(fixture(1));
  const five = resetTextToEpoch(r.windows.five_hour.resetText, r.windows.five_hour.zone, CAPTURE_MS);
  const seven = resetTextToEpoch(r.windows.seven_day.resetText, r.windows.seven_day.zone, CAPTURE_MS);
  assert.equal(five, 1782976800); // 12:20am America/Los_Angeles = 2026-07-02T07:20Z
  assert.equal(seven, 1783144800); // Jul 3 11pm America/Los_Angeles = 2026-07-04T06:00Z
});

test('malformed/partial input: no crash, no reading — never a fabricated pane', () => {
  assert.deepEqual(parseUsagePane(''), { ok: false, sawPane: false });
  assert.equal(parseUsagePane('random terminal noise [31mreset[0m').ok, false);
  assert.equal(parseUsagePane(null).ok, false);
  // The welcome screen alone (everything before /usage renders) is not a pane.
  const welcomeOnly = fixture(1).slice(0, fixture(1).search(/Current session/));
  const r = parseUsagePane(welcomeOnly);
  assert.equal(r.ok, false);
  assert.equal(r.sawPane, false);
});

test('one window missing → parse fails loudly with sawPane (both windows required)', () => {
  // Cut the capture off before the weekly meter: session meter alone must not ship.
  const full = fixture(1);
  const truncated = full.slice(0, full.indexOf('Current week (all models)'));
  const r = parseUsagePane(truncated);
  assert.equal(r.ok, false);
  assert.equal(r.sawPane, true); // a pane rendered — this is parse-failed territory
});

test('dropped-character tolerance: "Resets" → "Rests" still yields the reset clause', () => {
  const pane = 'Current session ███ 42% used\n Rests 3:05pm (America/Los_Angeles)\n'
    + 'Current week (all models) █ 10% used\n Rests Jul 9 at 1am (America/Los_Angeles)\n';
  const r = parseUsagePane(pane);
  assert.equal(r.ok, true);
  assert.equal(r.windows.five_hour.resetText, '3:05pm');
  assert.equal(r.windows.seven_day.resetText, 'Jul 9 at 1am');
});

test('used% is clamped 0–100 at ingest (externally-sourced percentage)', () => {
  const pane = 'Current session 999% used Resets 1pm (UTC)\n'
    + 'Current week (all models) 25% used Resets Jul 9 at 1am (UTC)\n';
  const r = parseUsagePane(pane);
  assert.equal(r.ok, true);
  assert.equal(r.windows.five_hour.usedPct, 100);
});

// --- resetTextToEpoch ---------------------------------------------------------

test('bare time = next future occurrence in the zone (rolls to tomorrow when past)', () => {
  // At 2026-07-01 23:42 America/Los_Angeles, "12:20am" means tomorrow 00:20.
  assert.equal(resetTextToEpoch('12:20am', 'America/Los_Angeles', CAPTURE_MS), 1782976800);
  // "11pm" (no minutes) is later the same local day.
  assert.equal(resetTextToEpoch('11pm', 'America/Los_Angeles', CAPTURE_MS),
    Date.parse('2026-07-03T06:00:00Z') / 1000);
});

test('dated time = that calendar date in the zone, nearest-future year', () => {
  assert.equal(resetTextToEpoch('Jul 3 at 11pm', 'America/Los_Angeles', CAPTURE_MS), 1783144800);
  // A date already past rolls to next year.
  assert.equal(resetTextToEpoch('Jun 1 at 12pm', 'America/Los_Angeles', CAPTURE_MS),
    Date.parse('2027-06-01T19:00:00Z') / 1000);
});

test('conversion failure returns null — garbage text, bad zone, bad fields', () => {
  assert.equal(resetTextToEpoch('sometime soon', 'America/Los_Angeles', CAPTURE_MS), null);
  assert.equal(resetTextToEpoch('12:20am', 'Not/A_Zone', CAPTURE_MS), null);
  assert.equal(resetTextToEpoch('25:99pm', 'America/Los_Angeles', CAPTURE_MS), null);
  assert.equal(resetTextToEpoch(null, 'America/Los_Angeles', CAPTURE_MS), null);
  assert.equal(resetTextToEpoch('12:20am', null, CAPTURE_MS), null);
});

// --- Payload building + newest-wins write ------------------------------------

test('the payload is the exact statusline shape; capturedAt = the given evidence moment (FR-09)', () => {
  const windows = {
    five_hour: { usedPct: 77, resetText: '12:20am', zone: 'America/Los_Angeles' },
    seven_day: { usedPct: 25, resetText: 'Jul 3 at 11pm', zone: 'America/Los_Angeles' },
  };
  const p = buildReadingPayload(windows, CAPTURE_MS);
  assert.deepEqual(p, {
    rate_limits: {
      five_hour: { used_percentage: 77, resets_at: 1782976800 },
      seven_day: { used_percentage: 25, resets_at: 1783144800 },
    },
    capturedAt: '2026-07-02T06:42:00.000Z',
  });
});

test('model-specific caps are written as an optional statusline extension', () => {
  const windows = {
    five_hour: { usedPct: 77, resetText: '12:20am', zone: 'America/Los_Angeles' },
    seven_day: { usedPct: 25, resetText: 'Jul 3 at 11pm', zone: 'America/Los_Angeles' },
  };
  const p = buildReadingPayload(windows, CAPTURE_MS, [
    { model: 'fable', label: 'Fable', window: 'seven_day', usedPct: 49, resetText: 'Jul 3 at 11pm', zone: 'America/Los_Angeles' },
  ]);
  assert.deepEqual(p.model_limits, [{
    source: 'claude-model:fable',
    provider: 'claude-code',
    model: 'fable',
    label: 'Fable',
    window: 'seven_day',
    used_percentage: 49,
    resets_at: 1783144800,
    captured_at: '2026-07-02T06:42:00.000Z',
  }]);
});

test('a failed reset conversion ships the reading with resets_at null — never drops it', () => {
  const windows = {
    five_hour: { usedPct: 150, resetText: 'unreadable', zone: 'America/Los_Angeles' }, // also clamps
    seven_day: { usedPct: 25, resetText: null, zone: null },
  };
  const p = buildReadingPayload(windows, CAPTURE_MS);
  assert.equal(p.rate_limits.five_hour.used_percentage, 100);
  assert.equal(p.rate_limits.five_hour.resets_at, null);
  assert.equal(p.rate_limits.seven_day.resets_at, null);
  assert.equal(p.capturedAt, '2026-07-02T06:42:00.000Z');
});

test('newest-capturedAt-wins: older evidence never regresses the reading (FR-10, QA-08)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-refresh-write-'));
  const cfg = { dataDir: tmp, rateLimitsFile: path.join(tmp, 'claude-ratelimits.json') };
  const at = (iso, pct) => ({
    rate_limits: { five_hour: { used_percentage: pct, resets_at: null }, seven_day: { used_percentage: 1, resets_at: null } },
    capturedAt: iso,
  });
  // First write lands (no current file).
  assert.equal(writeReadingIfNewer(at('2026-07-02T06:00:00.000Z', 10), cfg), true);
  // An OLDER capture is skipped, file untouched.
  assert.equal(writeReadingIfNewer(at('2026-07-02T05:00:00.000Z', 99), cfg), false);
  let cur = JSON.parse(fs.readFileSync(cfg.rateLimitsFile, 'utf8'));
  assert.equal(cur.capturedAt, '2026-07-02T06:00:00.000Z');
  assert.equal(cur.rate_limits.five_hour.used_percentage, 10);
  // An equal capture is also skipped (strictly newer wins).
  assert.equal(writeReadingIfNewer(at('2026-07-02T06:00:00.000Z', 50), cfg), false);
  // A NEWER capture replaces it.
  assert.equal(writeReadingIfNewer(at('2026-07-02T06:42:00.000Z', 77), cfg), true);
  cur = JSON.parse(fs.readFileSync(cfg.rateLimitsFile, 'utf8'));
  assert.equal(cur.rate_limits.five_hour.used_percentage, 77);
  // No temp-file droppings left behind (atomic temp+rename).
  assert.deepEqual(fs.readdirSync(tmp), ['claude-ratelimits.json']);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('newer account-only writes preserve active model caps without restamping them', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-refresh-merge-'));
  const cfg = { dataDir: tmp, rateLimitsFile: path.join(tmp, 'claude-ratelimits.json') };
  fs.writeFileSync(cfg.rateLimitsFile, JSON.stringify({
    rate_limits: { five_hour: { used_percentage: 10, resets_at: null }, seven_day: { used_percentage: 1, resets_at: null } },
    capturedAt: '2026-07-02T06:00:00.000Z',
    model_limits: [{
      source: 'claude-model:fable',
      provider: 'claude-code',
      model: 'fable',
      label: 'Fable',
      window: 'seven_day',
      used_percentage: 49,
      resets_at: Date.parse('2026-07-03T06:00:00.000Z') / 1000,
    }],
  }));

  assert.equal(writeReadingIfNewer({
    rate_limits: { five_hour: { used_percentage: 20, resets_at: null }, seven_day: { used_percentage: 2, resets_at: null } },
    capturedAt: '2026-07-02T07:00:00.000Z',
  }, cfg), true);

  const cur = JSON.parse(fs.readFileSync(cfg.rateLimitsFile, 'utf8'));
  assert.equal(cur.rate_limits.five_hour.used_percentage, 20);
  assert.deepEqual(cur.model_limits, [{
    source: 'claude-model:fable',
    provider: 'claude-code',
    model: 'fable',
    label: 'Fable',
    window: 'seven_day',
    used_percentage: 49,
    resets_at: Date.parse('2026-07-03T06:00:00.000Z') / 1000,
    captured_at: '2026-07-02T06:00:00.000Z',
  }]);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('new model rows replace matching old rows while other active model caps remain', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-refresh-model-merge-'));
  const cfg = { dataDir: tmp, rateLimitsFile: path.join(tmp, 'claude-ratelimits.json') };
  fs.writeFileSync(cfg.rateLimitsFile, JSON.stringify({
    rate_limits: { five_hour: { used_percentage: 10, resets_at: null }, seven_day: { used_percentage: 1, resets_at: null } },
    capturedAt: '2026-07-02T06:00:00.000Z',
    model_limits: [
      { source: 'claude-model:fable', provider: 'claude-code', model: 'fable', label: 'Fable', window: 'seven_day', used_percentage: 49, resets_at: Date.parse('2026-07-03T06:00:00.000Z') / 1000 },
      { source: 'claude-model:sonnet-4-5', provider: 'claude-code', model: 'sonnet-4-5', label: 'Sonnet 4.5', window: 'seven_day', used_percentage: 88, resets_at: Date.parse('2026-07-03T06:00:00.000Z') / 1000 },
    ],
  }));

  assert.equal(writeReadingIfNewer({
    rate_limits: { five_hour: { used_percentage: 20, resets_at: null }, seven_day: { used_percentage: 2, resets_at: null } },
    capturedAt: '2026-07-02T07:00:00.000Z',
    model_limits: [{
      source: 'claude-model:fable',
      provider: 'claude-code',
      model: 'fable',
      label: 'Fable',
      window: 'seven_day',
      used_percentage: 52,
      resets_at: Date.parse('2026-07-03T06:00:00.000Z') / 1000,
    }],
  }, cfg), true);

  const cur = JSON.parse(fs.readFileSync(cfg.rateLimitsFile, 'utf8'));
  assert.deepEqual(cur.model_limits.map((m) => [m.model, m.used_percentage, m.captured_at]), [
    ['fable', 52, '2026-07-02T07:00:00.000Z'],
    ['sonnet-4-5', 88, '2026-07-02T06:00:00.000Z'],
  ]);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('expired preserved model caps are dropped on the next newer write', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-refresh-expired-model-'));
  const cfg = { dataDir: tmp, rateLimitsFile: path.join(tmp, 'claude-ratelimits.json') };
  fs.writeFileSync(cfg.rateLimitsFile, JSON.stringify({
    rate_limits: { five_hour: { used_percentage: 10, resets_at: null }, seven_day: { used_percentage: 1, resets_at: null } },
    capturedAt: '2026-07-02T06:00:00.000Z',
    model_limits: [{
      source: 'claude-model:fable',
      provider: 'claude-code',
      model: 'fable',
      label: 'Fable',
      window: 'seven_day',
      used_percentage: 49,
      resets_at: Date.parse('2026-07-02T06:30:00.000Z') / 1000,
    }],
  }));

  assert.equal(writeReadingIfNewer({
    rate_limits: { five_hour: { used_percentage: 20, resets_at: null }, seven_day: { used_percentage: 2, resets_at: null } },
    capturedAt: '2026-07-02T07:00:00.000Z',
  }, cfg), true);

  const cur = JSON.parse(fs.readFileSync(cfg.rateLimitsFile, 'utf8'));
  assert.equal(cur.model_limits, undefined);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('a payload with an unparseable capturedAt is never written', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-refresh-badts-'));
  const cfg = { dataDir: tmp, rateLimitsFile: path.join(tmp, 'claude-ratelimits.json') };
  const p = { rate_limits: { five_hour: { used_percentage: 5, resets_at: null } }, capturedAt: 'not-a-date' };
  assert.equal(writeReadingIfNewer(p, cfg), false);
  assert.equal(fs.existsSync(cfg.rateLimitsFile), false);
  fs.rmSync(tmp, { recursive: true, force: true });
});
