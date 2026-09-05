import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeReadingIfNewer } from '../src/claude-refresh.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('statusline captures account windows without erasing active model caps', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-statusline-merge-'));
  const rateLimitsFile = path.join(tmp, 'claude-ratelimits.json');
  fs.writeFileSync(rateLimitsFile, JSON.stringify({
    rate_limits: {
      five_hour: { used_percentage: 10, resets_at: null },
      seven_day: { used_percentage: 1, resets_at: null },
    },
    capturedAt: '2001-01-01T00:00:00.000Z',
    model_limits: [{
      source: 'claude-model:sonnet-4-5',
      provider: 'claude-code',
      model: 'sonnet-4-5',
      label: 'Sonnet 4.5',
      window: 'seven_day',
      used_percentage: 88,
      resets_at: Date.parse('2099-01-01T00:00:00.000Z') / 1000,
    }],
  }));

  const input = JSON.stringify({
    model: { display_name: 'Claude' },
    workspace: { current_dir: '/tmp/example-project' },
    rate_limits: {
      five_hour: { used_percentage: 20, resets_at: null },
      seven_day: { used_percentage: 2, resets_at: null },
    },
  });
  const res = spawnSync(process.execPath, [path.join(root, 'scripts', 'statusline.js')], {
    input,
    encoding: 'utf8',
    env: { ...process.env, LLMDASH_DATA_DIR: tmp },
  });

  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, 'Claude · example-project · 5h 80% left');
  const cur = JSON.parse(fs.readFileSync(rateLimitsFile, 'utf8'));
  assert.equal(cur.rate_limits.five_hour.used_percentage, 20);
  assert.deepEqual(cur.model_limits, [{
    source: 'claude-model:sonnet-4-5',
    provider: 'claude-code',
    model: 'sonnet-4-5',
    label: 'Sonnet 4.5',
    window: 'seven_day',
    used_percentage: 88,
    resets_at: Date.parse('2099-01-01T00:00:00.000Z') / 1000,
    captured_at: '2001-01-01T00:00:00.000Z',
  }]);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// FM-C2 (tailnet-bind-and-reporting-resilience): the probe captured its pane,
// then the statusline wrote (winning the newest-capturedAt race) before the
// probe's own write landed. The ACCOUNT windows keep the newer organic capture,
// but the probe's model caps — the only producer of model_limits — must still
// reach the file instead of being dropped with the skipped write.
test('a probe capture that lost the timestamp race to a statusline write still lands its model caps (FM-C2)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-statusline-race-'));
  const rateLimitsFile = path.join(tmp, 'claude-ratelimits.json');
  const cfg = { dataDir: tmp, rateLimitsFile };
  // The real statusline writer lands first (stamped "now").
  const res = spawnSync(process.execPath, [path.join(root, 'scripts', 'statusline.js')], {
    input: JSON.stringify({
      model: { display_name: 'Claude' },
      rate_limits: {
        five_hour: { used_percentage: 20, resets_at: null },
        seven_day: { used_percentage: 2, resets_at: null },
      },
    }),
    encoding: 'utf8',
    env: { ...process.env, LLMDASH_DATA_DIR: tmp },
  });
  assert.equal(res.status, 0, res.stderr);
  const organic = JSON.parse(fs.readFileSync(rateLimitsFile, 'utf8'));
  assert.equal(organic.model_limits, undefined, 'the statusline never writes model caps');

  // The probe's pane was captured one second EARLIER — it loses the race.
  const probeCapturedAt = new Date(Date.parse(organic.capturedAt) - 1000).toISOString();
  const cap = {
    source: 'claude-model:fable', provider: 'claude-code', model: 'fable', label: 'Fable',
    window: 'seven_day', used_percentage: 100, resets_at: null, captured_at: probeCapturedAt,
  };
  const probe = {
    rate_limits: {
      five_hour: { used_percentage: 99, resets_at: null }, // must NOT replace the newer organic windows
      seven_day: { used_percentage: 98, resets_at: null },
    },
    capturedAt: probeCapturedAt,
    model_limits: [cap],
  };
  assert.equal(writeReadingIfNewer(probe, cfg), true, 'the caps are new evidence, so the file is written');
  const merged = JSON.parse(fs.readFileSync(rateLimitsFile, 'utf8'));
  assert.equal(merged.capturedAt, organic.capturedAt, 'the newer organic capture time stays');
  assert.deepEqual(merged.rate_limits, organic.rate_limits, 'the account windows are the statusline\'s, not the older probe\'s');
  assert.deepEqual(merged.model_limits, [cap], 'the probe\'s cap landed');

  // Replaying the same older probe payload changes nothing (no fresher evidence).
  assert.equal(writeReadingIfNewer(probe, cfg), false);
  // An older ACCOUNT-only payload is still skipped outright (FR-10 unchanged).
  assert.equal(writeReadingIfNewer({ rate_limits: probe.rate_limits, capturedAt: probeCapturedAt }, cfg), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(rateLimitsFile, 'utf8')), merged);
  // A newer cap for the same key from a later probe replaces it; an older one never regresses it.
  const newer = { ...cap, used_percentage: 97, captured_at: new Date(Date.parse(organic.capturedAt) + 60_000).toISOString() };
  assert.equal(writeReadingIfNewer({ rate_limits: probe.rate_limits, capturedAt: newer.captured_at, model_limits: [newer] }, cfg), true);
  assert.equal(JSON.parse(fs.readFileSync(rateLimitsFile, 'utf8')).model_limits[0].used_percentage, 97);
  assert.equal(writeReadingIfNewer(probe, cfg), false, 'the stale probe cap does not regress the newer one');
  assert.equal(JSON.parse(fs.readFileSync(rateLimitsFile, 'utf8')).model_limits[0].used_percentage, 97);
  fs.rmSync(tmp, { recursive: true, force: true });
});
