import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// The installer must bake an ABSOLUTE codex path into the launchd plist — a
// bare "codex" can never resolve under launchd's minimal PATH. These tests
// exercise the resolution logic via the script's --resolve-codex hook, with
// PATH and HOME fully controlled so nothing on the host machine leaks in.
const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'install-macos.sh');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-install-'));
const emptyDir = path.join(tmp, 'empty');
fs.mkdirSync(emptyDir, { recursive: true });

function fakeCodex(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, 'codex');
  fs.writeFileSync(fp, '#!/bin/sh\n');
  fs.chmodSync(fp, 0o755);
  return fp;
}

function resolveCodex(env) {
  return spawnSync('/bin/bash', [script, '--resolve-codex'], {
    env: { HOME: path.join(tmp, 'home-default'), PATH: emptyDir, ...env },
    encoding: 'utf8',
  });
}

test('uses codex from PATH when present', () => {
  const bin = path.join(tmp, 'onpath');
  const fp = fakeCodex(bin);
  const r = resolveCodex({ PATH: `${bin}:${emptyDir}` });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), fp);
});

test('falls back to ~/.local/bin/codex when codex is not on PATH', () => {
  const home = path.join(tmp, 'home-local');
  const fp = fakeCodex(path.join(home, '.local', 'bin'));
  const r = resolveCodex({ HOME: home });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), fp);
});

test('exits non-zero when codex cannot be resolved anywhere', (t) => {
  // The probe list includes real system dirs we can't sandbox; skip on a
  // machine that genuinely has codex there (the resolution would be correct).
  if (fs.existsSync('/opt/homebrew/bin/codex') || fs.existsSync('/usr/local/bin/codex')) {
    return t.skip('a system-wide codex exists on this machine');
  }
  const r = resolveCodex({ HOME: path.join(tmp, 'home-bare') });
  assert.notEqual(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

test('the generated-plist template substitution still targets CODEX_PATH', () => {
  // The installer seds CODEX_PATH into the plist; if the placeholder is renamed
  // in either file the absolute path silently stops being baked in.
  const installer = fs.readFileSync(script, 'utf8');
  const plist = fs.readFileSync(path.join(path.dirname(script), '..', 'macos', 'com.llmdash.dashboard.plist.example'), 'utf8');
  assert.match(installer, /CODEX_PATH/);
  assert.match(plist, /<string>CODEX_PATH<\/string>/);
});

test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
