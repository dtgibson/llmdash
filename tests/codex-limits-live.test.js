import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// The happy path with an ABSOLUTE codex path (what the installer bakes in):
// a fake app-server answers the JSON-RPC read, the windows parse, and the
// diagnostic reads 'ok'. Separate file from codex-limits.test.js because
// config freezes LLMDASH_CODEX_CMD at import (one scenario per process).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-codexlive-'));
const fake = path.join(tmp, 'codex');
// Emits one rateLimits result (codex-cli 0.142.x shape: usedPercent + epoch-
// second resetsAt), then lingers briefly so stdout is read before exit.
fs.writeFileSync(fake, [
  '#!/bin/sh',
  `echo '{"jsonrpc":"2.0","id":2,"result":{"rateLimits":{"primary":{"usedPercent":42,"resetsAt":1767225600},"secondary":{"usedPercent":7,"resetsAt":1767830400}}}}'`,
  'sleep 5',
  '',
].join('\n'));
fs.chmodSync(fake, 0o755);

process.env.LLMDASH_DATA_DIR = path.join(tmp, 'data');
process.env.LLMDASH_CODEX_DIR = path.join(tmp, 'codex-home'); // keep off the real ~/.codex
process.env.LLMDASH_CODEX_CMD = fake;
process.env.LLMDASH_CODEX_TIMEOUT_MS = '4000';

const { readCodexLimits, codexLimitsDiagnostic } = await import('../src/codex-limits.js');

test('a working absolute codex path yields live windows and an ok diagnostic', async () => {
  const live = await readCodexLimits();
  assert.ok(live, 'expected a live reading');
  assert.equal(live.source, 'codex');
  assert.equal(live.windows.five_hour.usedPct, 42);
  assert.equal(live.windows.seven_day.usedPct, 7);
  assert.equal(live.windows.five_hour.resetsAt, new Date(1767225600 * 1000).toISOString());
  assert.equal(codexLimitsDiagnostic().reason, 'ok');
});

test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
