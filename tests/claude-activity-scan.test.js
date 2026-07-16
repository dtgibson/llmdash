import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CLAUDE_ACTIVITY_SCAN_LIMITS,
  _resetRefreshState,
  maybeRefreshClaude,
  newestTranscriptMtimeMs,
} from '../src/claude-refresh.js';

const MIN = 60_000;
const T0 = Date.UTC(2026, 6, 16, 21, 0, 0);

function fixture(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-nested-activity-'));
  const projectsDir = path.join(tmp, 'projects');
  fs.mkdirSync(projectsDir);
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const write = (relative, mtimeMs) => {
    const file = path.join(projectsDir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, ''); // contents are irrelevant; the scanner reads metadata only
    const at = new Date(mtimeMs);
    fs.utimesSync(file, at, at);
    return file;
  };
  return { tmp, projectsDir, write };
}

test.beforeEach(() => _resetRefreshState());

test('advancing depth-6 subagent activity recovers after timeout without duplicate probes', async (t) => {
  const fx = fixture(t);
  fx.write('project/direct.jsonl', T0 - 30 * MIN);
  const nested = fx.write('project/session/subagents/workflows/wf_active/agent-a1.jsonl', T0 - MIN);
  const attemptCalls = [];
  const attempt = async () => {
    attemptCalls.push(1);
    return attemptCalls.length === 1 ? { ok: false, cause: 'timeout' } : { ok: true };
  };
  const cfg = {
    projectsDir: fx.projectsDir,
    claudeMaxAgeMs: 5 * MIN,
    claudeStaleAfterMs: 10 * MIN,
    claudeCmd: 'claude',
  };
  const args = (now) => ({
    now,
    disabled: false,
    readReading: () => ({ capturedAt: new Date(T0 - 60 * MIN).toISOString() }),
    newestActivityMs: newestTranscriptMtimeMs,
    attempt,
    cfg,
  });

  assert.equal(newestTranscriptMtimeMs(cfg), T0 - MIN);
  assert.equal(await maybeRefreshClaude(args(T0)), 'failed');
  assert.equal(await maybeRefreshClaude(args(T0 + MIN)), 'waiting');

  // The first timeout set failure backoff, but a real nested write can open one
  // retry at the ordinary five-minute cadence.
  fs.utimesSync(nested, new Date(T0 + 4 * MIN), new Date(T0 + 4 * MIN));
  assert.equal(await maybeRefreshClaude(args(T0 + 5 * MIN)), 'refreshed');
  assert.equal(await maybeRefreshClaude(args(T0 + 6 * MIN)), 'waiting');
  assert.equal(attemptCalls.length, 2, 'nested activity opens one retry, not a probe storm');
});

test('stale direct and nested transcripts preserve the idle gate and spawn nothing', async (t) => {
  const fx = fixture(t);
  fx.write('project/direct.jsonl', T0 - 30 * MIN);
  fx.write('project/session/subagents/workflows/wf_old/agent-a1.jsonl', T0 - 11 * MIN);
  let attempts = 0;
  const cfg = {
    projectsDir: fx.projectsDir,
    claudeMaxAgeMs: 5 * MIN,
    claudeStaleAfterMs: 10 * MIN,
    claudeCmd: 'claude',
  };
  assert.equal(await maybeRefreshClaude({
    now: T0,
    disabled: false,
    readReading: () => ({ capturedAt: new Date(T0 - 60 * MIN).toISOString() }),
    newestActivityMs: newestTranscriptMtimeMs,
    attempt: async () => { attempts++; return { ok: true }; },
    cfg,
  }), 'idle');
  assert.equal(attempts, 0);
});

test('depth 6 covers the current workflow layout and excludes a fresher depth-7 file', (t) => {
  const fx = fixture(t);
  const inBudgetAt = T0 - 2 * MIN;
  fx.write('project/session/subagents/workflows/wf_ok/agent-a1.jsonl', inBudgetAt);
  fx.write('project/session/subagents/workflows/wf_ok/extra/too-deep.jsonl', T0);

  assert.equal(newestTranscriptMtimeMs({ projectsDir: fx.projectsDir }), inBudgetAt);
  assert.equal(newestTranscriptMtimeMs({ projectsDir: fx.projectsDir }, { maxDepth: 5 }), null);
  assert.equal(CLAUDE_ACTIVITY_SCAN_LIMITS.maxDepth, 6);
});

test('directory, file, and streamed-entry budgets are finite hard ceilings', (t) => {
  const fx = fixture(t);
  const a = fx.write('project/a.jsonl', T0 - 2 * MIN);
  const b = fx.write('project/b.jsonl', T0 - MIN);

  assert.equal(newestTranscriptMtimeMs({ projectsDir: fx.projectsDir }, { maxDirectories: 1 }), null,
    'root-only directory budget cannot reach project files');
  assert.equal(newestTranscriptMtimeMs({ projectsDir: fx.projectsDir }, { maxEntries: 1 }), null,
    'one streamed root entry can enqueue but not scan the project');

  let jsonlStats = 0;
  const countingFs = {
    opendirSync: fs.opendirSync,
    lstatSync(file) {
      if (file === a || file === b) jsonlStats++;
      return fs.lstatSync(file);
    },
  };
  const found = newestTranscriptMtimeMs(
    { projectsDir: fx.projectsDir },
    { maxFiles: 1 },
    countingFs,
  );
  assert.equal(jsonlStats, 1);
  assert.ok(found === T0 - 2 * MIN || found === T0 - MIN);

  // Test-only requests cannot expand the production ceilings.
  assert.deepEqual(CLAUDE_ACTIVITY_SCAN_LIMITS, {
    maxDepth: 6,
    maxDirectories: 512,
    maxFiles: 10_000,
    maxEntries: 20_000,
  });
});

test('unreadable and racing entries are isolated while another transcript still supplies activity', (t) => {
  const fx = fixture(t);
  const goodAt = T0 - 3 * MIN;
  const good = fx.write('project/good.jsonl', goodAt);
  const racingFile = fx.write('project/racing.jsonl', T0);
  const racingDir = path.join(fx.projectsDir, 'project', 'racing-dir');
  fx.write('project/racing-dir/newer.jsonl', T0);

  const racingFs = {
    opendirSync(dir) {
      if (dir === racingDir) throw new Error('directory disappeared');
      return fs.opendirSync(dir);
    },
    lstatSync(file) {
      if (file === racingFile) throw new Error('file disappeared');
      return fs.lstatSync(file);
    },
  };
  assert.equal(newestTranscriptMtimeMs({ projectsDir: fx.projectsDir }, {}, racingFs), goodAt);
  assert.ok(fs.existsSync(good));
});

test('file and directory symlinks are never followed outside the projects tree', (t) => {
  const fx = fixture(t);
  const localAt = T0 - 4 * MIN;
  fx.write('project/local.jsonl', localAt);
  const outsideFile = path.join(fx.tmp, 'outside.jsonl');
  fs.writeFileSync(outsideFile, '');
  fs.utimesSync(outsideFile, new Date(T0), new Date(T0));
  const outsideDir = path.join(fx.tmp, 'outside-dir');
  fs.mkdirSync(outsideDir);
  const outsideNested = path.join(outsideDir, 'nested.jsonl');
  fs.writeFileSync(outsideNested, '');
  fs.utimesSync(outsideNested, new Date(T0), new Date(T0));
  fs.symlinkSync(outsideFile, path.join(fx.projectsDir, 'project', 'linked-file.jsonl'));
  fs.symlinkSync(outsideDir, path.join(fx.projectsDir, 'project', 'linked-dir'));

  assert.equal(newestTranscriptMtimeMs({ projectsDir: fx.projectsDir }), localAt);
});
