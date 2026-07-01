import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// Point every data source at a temp sandbox BEFORE importing (config reads env
// on import). Nothing here touches the real ~/.claude or ~/.codex.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-health-'));
const dataDir = path.join(tmp, 'data');
const codexDir = path.join(tmp, 'codex');
process.env.LLMDASH_DATA_DIR = dataDir;
process.env.LLMDASH_CODEX_DIR = codexDir;
process.env.LLMDASH_CODEX_CMD = path.join(tmp, 'missing', 'codex');

const { resolveCommand, dataSourceHealth, healthLines } = await import('../src/health.js');

test('resolveCommand finds a bare name on the given PATH', () => {
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const tool = path.join(bin, 'mytool');
  fs.writeFileSync(tool, '#!/bin/sh\n');
  fs.chmodSync(tool, 0o755);
  assert.equal(resolveCommand('mytool', bin), tool);
  // Also when the PATH has other (empty/missing) entries around it.
  assert.equal(resolveCommand('mytool', `/nonexistent-dir${path.delimiter}${bin}`), tool);
});

test('resolveCommand returns null for a bare name not on PATH (the launchd failure mode)', () => {
  assert.equal(resolveCommand('mytool', '/usr/bin:/bin:/usr/sbin:/sbin'), null);
  assert.equal(resolveCommand('codex', path.join(tmp, 'empty-path-entry')), null);
});

test('resolveCommand checks an explicit path directly', () => {
  const bin = path.join(tmp, 'bin2');
  fs.mkdirSync(bin, { recursive: true });
  const tool = path.join(bin, 'codex');
  fs.writeFileSync(tool, '#!/bin/sh\n');
  fs.chmodSync(tool, 0o755);
  assert.equal(resolveCommand(tool), tool);
  assert.equal(resolveCommand(path.join(bin, 'nope')), null);
});

test('resolveCommand rejects a non-executable file and an empty command', () => {
  const bin = path.join(tmp, 'bin3');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'plainfile'), 'not a program', { mode: 0o644 });
  assert.equal(resolveCommand('plainfile', bin), null);
  assert.equal(resolveCommand('', bin), null);
  assert.equal(resolveCommand(null, bin), null);
});

test('dataSourceHealth reports the fresh-install state honestly (everything missing)', () => {
  const h = dataSourceHealth();
  assert.equal(h.claudeRatelimits.present, false);
  assert.equal(h.claudeRatelimits.ageMs, null);
  assert.equal(h.codexCmd.resolved, null);
  assert.equal(h.codexSessions.present, false);
});

test('dataSourceHealth sees the sources once they exist, with a sane age', () => {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'claude-ratelimits.json'), '{}');
  fs.mkdirSync(path.join(codexDir, 'sessions'), { recursive: true });
  const h = dataSourceHealth();
  assert.equal(h.claudeRatelimits.present, true);
  assert.ok(Number.isFinite(h.claudeRatelimits.ageMs) && h.claudeRatelimits.ageMs >= 0);
  assert.equal(h.codexSessions.present, true);
});

test('healthLines names each missing source and its fix', () => {
  const out = healthLines({
    claudeRatelimits: { file: '/x/claude-ratelimits.json', present: false, ageMs: null },
    codexCmd: { cmd: 'codex', resolved: null },
    codexSessions: { dir: '/x/sessions', present: false },
  }).join('\n');
  assert.match(out, /no statusline reading yet/);
  assert.match(out, /renders its status line/); // what produces a reading
  assert.match(out, /codex command not found \("codex"\)/);
  assert.match(out, /LLMDASH_CODEX_CMD/); // the fix
  assert.match(out, /no Codex sessions recorded on this machine yet/);
});

test('healthLines reports healthy sources as present/OK', () => {
  const out = healthLines({
    claudeRatelimits: { file: '/x/claude-ratelimits.json', present: true, ageMs: 90_000 },
    codexCmd: { cmd: '/usr/local/bin/codex', resolved: '/usr/local/bin/codex' },
    codexSessions: { dir: '/x/sessions', present: true },
  }).join('\n');
  assert.match(out, /statusline reading present \(updated 1m ago\)/);
  assert.match(out, /codex command OK \(\/usr\/local\/bin\/codex\)/);
  assert.match(out, /sessions dir present/);
});

test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
