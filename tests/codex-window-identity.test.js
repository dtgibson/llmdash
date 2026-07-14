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

test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
