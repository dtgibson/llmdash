import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
