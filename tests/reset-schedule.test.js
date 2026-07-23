import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createIntlTimeZoneAdapter,
  normalizeResetSchedule,
  resolveConfiguredReset,
  selectReset,
  validateCanonicalTimeZone,
} from '../src/reset-schedule.js';

const PACIFIC = Object.freeze({
  isoWeekday: 5,
  localTime: '23:00',
  timeZone: 'America/Los_Angeles',
});

test('canonical IANA validation rejects aliases, offsets, POSIX zones, and controls', () => {
  assert.equal(validateCanonicalTimeZone('America/Los_Angeles'), true);
  assert.equal(validateCanonicalTimeZone('UTC'), true);
  for (const value of [
    'US/Pacific', 'america/los_angeles', '+05:30', 'EST5EDT',
    'America/Los_Angeles\n', '', 'x'.repeat(129),
  ]) assert.equal(validateCanonicalTimeZone(value), false, value);
});

test('schedule normalization is exact-keyed and immutable', () => {
  const normalized = normalizeResetSchedule(PACIFIC);
  assert.deepEqual(normalized, PACIFIC);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(normalizeResetSchedule({ ...PACIFIC, extra: true }), null);
  assert.equal(normalizeResetSchedule({ ...PACIFIC, isoWeekday: 0 }), null);
  assert.equal(normalizeResetSchedule({ ...PACIFIC, localTime: '3:00' }), null);
  assert.equal(normalizeResetSchedule({ ...PACIFIC, timeZone: 'US/Pacific' }), null);
});

test('Friday 23:00 Pacific resolves by local calendar date, not fixed UTC offset', () => {
  const now = Date.parse('2026-07-23T18:00:00.000Z'); // Thursday morning PDT
  assert.equal(resolveConfiguredReset(PACIFIC, now), '2026-07-25T06:00:00.000Z');

  const winterNow = Date.parse('2026-12-03T18:00:00.000Z');
  assert.equal(resolveConfiguredReset(PACIFIC, winterNow), '2026-12-05T07:00:00.000Z');
});

test('an exact scheduled instant advances seven local calendar days', () => {
  const exact = Date.parse('2026-07-25T06:00:00.000Z');
  assert.equal(resolveConfiguredReset(PACIFIC, exact), '2026-08-01T06:00:00.000Z');
});

test('weekly recurrence crosses DST by calendar date rather than adding 168 hours', () => {
  const schedule = {
    isoWeekday: 7,
    localTime: '03:30',
    timeZone: 'America/Los_Angeles',
  };
  const afterPriorOccurrence = Date.parse('2026-03-01T12:00:00.000Z');
  assert.equal(resolveConfiguredReset(schedule, afterPriorOccurrence),
    '2026-03-08T10:30:00.000Z');
});

test('DST overlap chooses the earlier possible instant', () => {
  const schedule = {
    isoWeekday: 7,
    localTime: '01:30',
    timeZone: 'America/Los_Angeles',
  };
  const now = Date.parse('2026-11-01T07:00:00.000Z');
  // 01:30 occurs at both 08:30Z (PDT) and 09:30Z (PST).
  assert.equal(resolveConfiguredReset(schedule, now), '2026-11-01T08:30:00.000Z');
});

test('DST gap advances minute-by-minute to the first valid local instant', () => {
  const schedule = {
    isoWeekday: 7,
    localTime: '02:30',
    timeZone: 'America/Los_Angeles',
  };
  const now = Date.parse('2026-03-08T08:00:00.000Z');
  // The 02:00–02:59 wall-clock hour does not exist; 03:00 is first valid.
  assert.equal(resolveConfiguredReset(schedule, now), '2026-03-08T10:00:00.000Z');
});

test('non-hour DST gaps also advance to their first valid minute', () => {
  const schedule = {
    isoWeekday: 7,
    localTime: '02:15',
    timeZone: 'Australia/Lord_Howe',
  };
  const now = Date.parse('2026-10-03T14:00:00.000Z');
  // Lord Howe skips 02:00–02:29; the first valid wall time is 02:30.
  assert.equal(resolveConfiguredReset(schedule, now), '2026-10-03T15:30:00.000Z');
});

test('the Intl adapter caches formatter and local-day offset work', () => {
  const adapter = createIntlTimeZoneAdapter({ maxCacheEntries: 4 });
  resolveConfiguredReset(PACIFIC, Date.parse('2026-07-23T18:00:00.000Z'), { adapter });
  const first = adapter.cacheSizes();
  resolveConfiguredReset(PACIFIC, Date.parse('2026-07-23T19:00:00.000Z'), { adapter });
  assert.deepEqual(adapter.cacheSizes(), first);
  assert.equal(first.formatters, 1);
  assert.ok(first.offsetDays >= 1);
});

test('a current successful future live account reset wins over configuration', () => {
  const now = Date.parse('2026-07-23T18:00:00.000Z');
  const freshness = Object.freeze({
    capturedAt: '2026-07-23T17:59:00.000Z',
    band: 'fresh',
  });
  const liveAccountReset = Object.freeze({
    current: true,
    successful: true,
    resetsAt: '2026-07-24T20:00:00.000Z',
    freshness,
  });
  const result = selectReset({ nowMs: now, liveAccountReset, configuredSchedule: PACIFIC });
  assert.deepEqual(result, {
    source: 'live',
    label: 'Live',
    nextResetAt: '2026-07-24T20:00:00.000Z',
    liveStatus: 'usable',
    configuredStatus: 'usable',
    corroboratedByModelCap: false,
  });
  assert.deepEqual(liveAccountReset.freshness, freshness, 'freshness is untouched');
  assert.equal(Object.isFrozen(result), true);
});

test('expired, invalid, missing, and non-current live evidence falls back to configured', () => {
  const now = Date.parse('2026-07-23T18:00:00.000Z');
  const cases = [
    [{ current: true, successful: true, resetsAt: '2026-07-23T17:00:00.000Z' }, 'expired'],
    [{ current: true, successful: true, resetsAt: 'not-a-date' }, 'invalid'],
    [{ current: true, successful: true, resetsAt: null }, 'missing'],
    [{ current: false, successful: true, resetsAt: '2026-07-24T20:00:00.000Z' }, 'not-current'],
  ];
  for (const [liveAccountReset, status] of cases) {
    const result = selectReset({ nowMs: now, liveAccountReset, configuredSchedule: PACIFIC });
    assert.equal(result.source, 'configured');
    assert.equal(result.liveStatus, status);
    assert.equal(result.nextResetAt, '2026-07-25T06:00:00.000Z');
  }
});

test('model-cap evidence can corroborate configuration but can never select a reset', () => {
  const now = Date.parse('2026-07-23T18:00:00.000Z');
  const modelLimits = [{
    source: 'claude-model:fable',
    window: 'seven_day',
    resetsAt: '2026-07-25T06:00:00.000Z',
  }];
  const configured = selectReset({
    nowMs: now,
    liveAccountReset: null,
    configuredSchedule: PACIFIC,
    modelLimits,
  });
  assert.equal(configured.source, 'configured');
  assert.equal(configured.corroboratedByModelCap, true);

  const modelOnly = selectReset({
    nowMs: now,
    liveAccountReset: null,
    configuredSchedule: null,
    modelLimits,
  });
  assert.deepEqual(modelOnly, {
    source: 'unavailable',
    label: 'Unavailable',
    nextResetAt: null,
    liveStatus: 'missing',
    configuredStatus: 'missing',
    corroboratedByModelCap: false,
  });
});

test('invalid configuration remains unavailable rather than using model-cap timing', () => {
  const result = selectReset({
    nowMs: Date.parse('2026-07-23T18:00:00.000Z'),
    configuredSchedule: { ...PACIFIC, timeZone: 'US/Pacific' },
    modelLimits: [{ window: 'seven_day', resetsAt: '2026-07-25T06:00:00.000Z' }],
  });
  assert.equal(result.source, 'unavailable');
  assert.equal(result.configuredStatus, 'invalid');
  assert.equal(result.nextResetAt, null);
});
