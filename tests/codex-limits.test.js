import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// The fresh-install failure mode: the configured codex command cannot be run
// (e.g. a bare "codex" under launchd's minimal PATH). The read must degrade to
// null, but never silently: the diagnostic names the cause and the failure is
// logged exactly ONCE (not every poll interval).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-codexdiag-'));
process.env.LLMDASH_DATA_DIR = path.join(tmp, 'data');
process.env.LLMDASH_CODEX_DIR = path.join(tmp, 'codex'); // empty → no rollout fallback
process.env.LLMDASH_CODEX_CMD = path.join(tmp, 'missing', 'codex'); // guaranteed-dead
process.env.LLMDASH_CODEX_TIMEOUT_MS = '4000';

const { readCodexLimits, codexLimitsDiagnostic } = await import('../src/codex-limits.js');

test('diagnostic already names the dead command before the first poll (static PATH check)', () => {
  const d = codexLimitsDiagnostic();
  assert.equal(d.reason, 'codex-cmd-failed');
  assert.equal(d.cmd, process.env.LLMDASH_CODEX_CMD);
});

test('spawn failure → null limits, ENOENT diagnostic, logged once across polls', async () => {
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.join(' '));
  try {
    assert.equal(await readCodexLimits(), null);
    assert.equal(await readCodexLimits(), null); // second poll: same cause, no re-log
  } finally {
    console.error = orig;
  }
  const d = codexLimitsDiagnostic();
  assert.equal(d.reason, 'codex-cmd-failed');
  assert.equal(d.detail, 'ENOENT');
  assert.equal(logged.length, 1, `expected one log line, got: ${JSON.stringify(logged)}`);
  assert.match(logged[0], /cannot run/);
  assert.match(logged[0], /LLMDASH_CODEX_CMD/); // the fix is in the message
});

test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
