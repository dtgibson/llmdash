import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-codex-window-'));
const fake = path.join(tmp, 'codex');
fs.writeFileSync(fake, [
  '#!/bin/sh',
  'if [ -n "$LLMDASH_FAKE_CODEX_RESPONSE" ]; then',
  `  printf '%s\n' "$LLMDASH_FAKE_CODEX_RESPONSE"`,
  '  sleep 5',
  'fi',
  '',
].join('\n'));
fs.chmodSync(fake, 0o755);

process.env.LLMDASH_DATA_DIR = path.join(tmp, 'data');
process.env.LLMDASH_CLAUDE_DIR = path.join(tmp, 'claude-home');
process.env.LLMDASH_CODEX_DIR = path.join(tmp, 'codex-home');
process.env.LLMDASH_CODEX_CMD = fake;
process.env.LLMDASH_CODEX_TIMEOUT_MS = '1000';

const {
  cachedCodexLimits,
  readCodexLimits,
  windowsFromRateLimits,
} = await import('../src/codex-limits.js');
const { insertSnapshot } = await import('../src/db.js');
const { buildState } = await import('../src/server.js');

function window(usedPercent, windowDurationMins) {
  return { usedPercent, resetsAt: 1_767_225_600, windowDurationMins };
}

function liveResponse(rateLimits) {
  process.env.LLMDASH_FAKE_CODEX_RESPONSE = JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    result: { rateLimits: { planType: 'pro', ...rateLimits } },
  });
}

test('cold-start Codex gauges do not revive independent historical window rows', () => {
  insertSnapshot({
    capturedAt: '2026-01-01T00:00:00.000Z',
    source: 'codex',
    window: 'five_hour',
    usedPct: 99,
    resetsAt: '2026-01-01T05:00:00.000Z',
  });

  const codex = buildState(Date.UTC(2026, 0, 2)).tools.find((tool) => tool.source === 'codex');
  assert.equal(cachedCodexLimits(), null);
  assert.equal(codex.haveLimits, false);
  assert.equal(codex.limits.five_hour, null);
  assert.equal(codex.limits.seven_day, null);
});

test('the current sole-primary 10,080-minute response is weekly and suppresses an obsolete 5-hour DB slot', async () => {
  liveResponse({ primary: window(41, 10_080), secondary: null });

  const live = await readCodexLimits();
  assert.deepEqual(Object.keys(live.windows), ['seven_day']);
  assert.equal(live.windows.seven_day.usedPct, 41);
  assert.equal(live.windows.five_hour, undefined);
  assert.equal(cachedCodexLimits(), live);

  const codex = buildState(Date.UTC(2026, 0, 2)).tools.find((tool) => tool.source === 'codex');
  assert.equal(codex.limits.five_hour, null, 'a historical DB row must not fill a slot missing from the complete live response');
  assert.equal(codex.limits.seven_day.usedPct, 41);

  // A subsequent failed app-server probe retains the last complete response in
  // memory instead of replacing it with older rollout or per-window history.
  process.env.LLMDASH_FAKE_CODEX_RESPONSE = '';
  assert.equal(await readCodexLimits(), live);
  assert.equal(cachedCodexLimits(), live);
});

test('an untimestamped rollout cannot replace a newer live reading after a probe failure', async () => {
  const live = cachedCodexLimits();
  const sessions = path.join(process.env.LLMDASH_CODEX_DIR, 'sessions');
  fs.mkdirSync(sessions, { recursive: true });
  const rollout = path.join(sessions, 'rollout-untimestamped.jsonl');
  fs.writeFileSync(rollout, JSON.stringify({
    token_count: {
      rate_limits: { primary: window(88, 300), secondary: window(77, 10_080) },
    },
  }) + '\n');
  const future = new Date(Date.now() + 60_000);
  fs.utimesSync(rollout, future, future);

  process.env.LLMDASH_FAKE_CODEX_RESPONSE = '';
  assert.equal(await readCodexLimits(), live);
  assert.equal(cachedCodexLimits(), live);
  assert.equal(live.windows.five_hour, undefined);
  assert.equal(live.windows.seven_day.usedPct, 41);
});

test('a genuinely newer timestamped rollout can advance the last-good reading', async () => {
  const sessions = path.join(process.env.LLMDASH_CODEX_DIR, 'sessions');
  const rollout = path.join(sessions, 'rollout-timestamped.jsonl');
  const eventTime = new Date(Date.now() + 120_000);
  fs.writeFileSync(rollout, JSON.stringify({
    timestamp: eventTime.toISOString(),
    token_count: {
      rate_limits: { primary: window(22, 300), secondary: window(33, 10_080) },
    },
  }) + '\n');
  fs.utimesSync(rollout, eventTime, eventTime);

  process.env.LLMDASH_FAKE_CODEX_RESPONSE = '';
  const advanced = await readCodexLimits();
  assert.equal(advanced.capturedAt, eventTime.toISOString());
  assert.equal(advanced.windows.five_hour.usedPct, 22);
  assert.equal(advanced.windows.seven_day.usedPct, 33);
  assert.equal(cachedCodexLimits(), advanced);
});

test('classic duration-bearing primary/secondary windows map by 300/10,080-minute evidence', () => {
  const parsed = windowsFromRateLimits({
    primary: window(12, 300),
    secondary: { used_percent: 34, window_duration_mins: 10_080 },
  });
  assert.equal(parsed.five_hour.usedPct, 12);
  assert.equal(parsed.seven_day.usedPct, 34);
});

test('an unknown explicit duration is not guessed from primary or secondary position', () => {
  assert.deepEqual(windowsFromRateLimits({
    primary: window(55, 1_440),
    secondary: { usedPercent: 66, window_duration_mins: null },
  }), {});
});

test('legacy no-duration positional responses remain compatible', () => {
  const parsed = windowsFromRateLimits({
    primary: { usedPercent: 21 },
    secondary: { usedPercent: 43 },
  });
  assert.equal(parsed.five_hour.usedPct, 21);
  assert.equal(parsed.seven_day.usedPct, 43);
});

test('explicitly named legacy fields keep their identity even with contradictory durations', () => {
  const parsed = windowsFromRateLimits({
    five_hour: window(17, 10_080),
    weekly: window(29, 300),
  });
  assert.equal(parsed.five_hour.usedPct, 17);
  assert.equal(parsed.seven_day.usedPct, 29);
});

test('a wrapped complete response with no recognized windows is authoritative and empty', async () => {
  liveResponse({ credits: { unlimited: false } });
  const live = await readCodexLimits();
  assert.deepEqual(live.windows, {});
  const codex = buildState().tools.find((tool) => tool.source === 'codex');
  assert.equal(codex.haveLimits, false);
  assert.equal(codex.limits.five_hour, null);
  assert.equal(codex.limits.seven_day, null);
});

// --- tailnet-bind-and-reporting-resilience: Codex resets ---------------------

test('the installed Codex `window_minutes` duration key maps 300 → five_hour and 10,080 → seven_day (FM-X3)', () => {
  // The exact shape every rollout event on this Mac carries (Codex 0.153.0).
  const parsed = windowsFromRateLimits({
    primary: { used_percent: 0.0, window_minutes: 300, resets_at: 1_767_225_600 },
    secondary: { used_percent: 17.5, window_minutes: 10_080, resets_at: 1_767_830_400 },
  });
  assert.deepEqual(Object.keys(parsed).sort(), ['five_hour', 'seven_day']);
  assert.equal(parsed.five_hour.usedPct, 0);
  assert.equal(parsed.seven_day.usedPct, 17.5);
  // A sole primary carrying window_minutes 10,080 is the WEEKLY window, not a 5-hour guess.
  assert.deepEqual(Object.keys(windowsFromRateLimits({ primary: { used_percent: 3, window_minutes: 10_080 } })), ['seven_day']);
  // An unknown explicit window_minutes stays unknown (never mislabeled).
  assert.deepEqual(windowsFromRateLimits({ primary: { used_percent: 3, window_minutes: 1_440 } }), {});
});

test('a complete response that omits a previously reported window yields window-not-reported with lastSeenAt, no backfill, ONE stderr line (FM-X1)', async () => {
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try {
    liveResponse({ primary: window(5, 300), secondary: window(9, 10_080) });
    const both = await readCodexLimits();
    assert.deepEqual(Object.keys(both.windows).sort(), ['five_hour', 'seven_day']);
    let codex = buildState(Date.parse(both.capturedAt) + 1000).tools.find((tool) => tool.source === 'codex');
    assert.equal(codex.limitsDiagnostic, null, 'both windows reported → no diagnostic');
    assert.equal(logged.length, 0);

    // The next complete response carries only the weekly window.
    liveResponse({ primary: window(9, 10_080), secondary: null });
    const weeklyOnly = await readCodexLimits();
    assert.deepEqual(Object.keys(weeklyOnly.windows), ['seven_day']);
    codex = buildState(Date.parse(weeklyOnly.capturedAt) + 1000).tools.find((tool) => tool.source === 'codex');
    assert.equal(codex.haveLimits, true);
    assert.equal(codex.limits.five_hour, null, 'the omitted slot stays empty — historical DB rows never fill it');
    assert.equal(codex.limits.seven_day.usedPct, 9);
    assert.deepEqual(codex.limitsDiagnostic, {
      reason: 'window-not-reported',
      window: 'five_hour',
      lastSeenAt: both.capturedAt, // the previous complete in-process reading that carried it
    });
    assert.equal(logged.length, 1, 'exactly one stderr line on the present→omitted transition');
    assert.match(logged[0], /^codex limits: the latest complete rate-limit response omits five_hour/);
    assert.doesNotMatch(logged[0], /seven_day/);
    assert.doesNotMatch(logged[0], /\d+%|usedPct|resets/i, 'slot key names only — no values');

    // The same omission on the next poll: still named, still no second line.
    liveResponse({ primary: window(11, 10_080), secondary: null });
    const again = await readCodexLimits();
    codex = buildState(Date.parse(again.capturedAt) + 1000).tools.find((tool) => tool.source === 'codex');
    assert.equal(codex.limitsDiagnostic.reason, 'window-not-reported');
    assert.equal(codex.limitsDiagnostic.lastSeenAt, both.capturedAt);
    assert.equal(logged.length, 1);

    // The window comes back → diagnostic clears; a later omission logs again (a new transition).
    liveResponse({ primary: window(2, 300), secondary: window(12, 10_080) });
    const back = await readCodexLimits();
    codex = buildState(Date.parse(back.capturedAt) + 1000).tools.find((tool) => tool.source === 'codex');
    assert.equal(codex.limitsDiagnostic, null);
    liveResponse({ primary: window(12, 10_080), secondary: null });
    const omittedAgain = await readCodexLimits();
    codex = buildState(Date.parse(omittedAgain.capturedAt) + 1000).tools.find((tool) => tool.source === 'codex');
    assert.equal(codex.limitsDiagnostic.lastSeenAt, back.capturedAt, 'lastSeenAt advances to the newest sighting');
    assert.equal(logged.length, 2);
  } finally {
    console.error = orig;
  }
});

test('after a failed poll the retained reading carries freshness whose age bands aging then stale (FM-X2)', async () => {
  const retained = cachedCodexLimits();
  assert.ok(retained && retained.capturedAt);
  // Earlier cases planted a timestamped rollout; the existing "a genuinely
  // newer rollout may advance the fallback" rule is not under test here, so
  // clear it and exercise the pure app-server-timeout path.
  fs.rmSync(path.join(process.env.LLMDASH_CODEX_DIR, 'sessions'), { recursive: true, force: true });
  process.env.LLMDASH_FAKE_CODEX_RESPONSE = ''; // the app-server times out this poll
  assert.equal(await readCodexLimits(), retained, 'the last complete reading is retained');
  const at = Date.parse(retained.capturedAt);
  const pollMs = 60_000; // LLMDASH_POLL_MS unset in this sandbox
  const codex = (nowMs) => buildState(nowMs).tools.find((tool) => tool.source === 'codex');
  const band = (f, nowMs) => {
    const age = nowMs - Date.parse(f.capturedAt);
    return age > f.staleAfterMs ? 'stale' : age > f.freshForMs ? 'aging' : 'fresh';
  };
  const f1 = codex(at + 60_000).freshness;
  assert.deepEqual(f1, { capturedAt: retained.capturedAt, freshForMs: 2 * pollMs, staleAfterMs: 5 * pollMs });
  assert.equal(band(f1, at + 60_000), 'fresh');
  assert.equal(band(codex(at + 3 * pollMs).freshness, at + 3 * pollMs), 'aging');
  assert.equal(band(codex(at + 6 * pollMs).freshness, at + 6 * pollMs), 'stale');
  // The capture time is the retained reading's own — never restamped by the failed poll.
  assert.equal(codex(at + 6 * pollMs).freshness.capturedAt, retained.capturedAt);
  assert.equal(codex(at + 6 * pollMs).limits.seven_day.usedPct, retained.windows.seven_day.usedPct, 'gauges keep rendering — flagged, never blanked');
});

test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
