import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// Point storage at a temp dir BEFORE importing db/config (config reads env on import).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-test-'));
process.env.LLMDASH_DATA_DIR = tmp;
process.env.LLMDASH_DEDUP_MS = '300000';

const { insertSnapshot, getLatestPerWindow } = await import('../src/db.js');

test('insertSnapshot dedups unchanged readings, records changes', () => {
  assert.equal(insertSnapshot({ capturedAt: '2026-01-01T00:00:00.000Z', source: 'claude-code', window: 'five_hour', usedPct: 32, resetsAt: null }), true);
  // 1 minute later, identical value => deduped
  assert.equal(insertSnapshot({ capturedAt: '2026-01-01T00:01:00.000Z', source: 'claude-code', window: 'five_hour', usedPct: 32, resetsAt: null }), false);
  // changed value => written
  assert.equal(insertSnapshot({ capturedAt: '2026-01-01T00:02:00.000Z', source: 'claude-code', window: 'five_hour', usedPct: 33, resetsAt: null }), true);

  const fh = getLatestPerWindow('claude-code').find(r => r.window === 'five_hour');
  assert.equal(Number(fh.used_pct), 33);
});

test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
