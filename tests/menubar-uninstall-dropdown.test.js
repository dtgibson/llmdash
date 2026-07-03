import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  serviceControlActionLines, actionClusterLines, readServiceState,
  computeBadge, computeMultiBadge, emit, emitMulti, remotesFromCombined,
  ABS_NODE,
} from '../scripts/menubar/llmdash.5s.js';
import { loadFixture } from './helpers/menubar-run.js';

// ── The service toggle + Uninstall submenu in BOTH modes (menubar-service-
// controls, FR-01/FR-04/FR-09). Pure over injected state — no real launchctl, no
// real dialog, no HTTP.

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HELPER = 'service-control-action.mjs';

test('service item is state-aware: not-installed → Install; running/stopped → Remove (QA-01)', () => {
  const ni = serviceControlActionLines({ state: 'not-installed' });
  assert.match(ni.serviceLine, /^＋ Install the local service \|/);
  assert.match(ni.serviceLine, /param2=install/);

  const run = serviceControlActionLines({ state: 'running' });
  assert.match(run.serviceLine, /^－ Remove the local service · running \|/);
  assert.match(run.serviceLine, /param2=remove/);

  const stop = serviceControlActionLines({ state: 'stopped' });
  assert.match(stop.serviceLine, /^－ Remove the local service · stopped \|/);
  assert.match(stop.serviceLine, /param2=remove/);
});

test('both uninstall tiers are present, tier 2 carries its own … and its own action (QA-09)', () => {
  const { uninstallLines } = serviceControlActionLines({ state: 'running' });
  const joined = uninstallLines.join('\n');
  assert.match(joined, /^⊘ Uninstall llmdash…$/m);           // the submenu parent
  assert.match(joined, /^--▬ Remove the menu-bar badge only \|.*param2=remove-badge/m);
  assert.match(joined, /^--⊘ Uninstall llmdash completely… \|.*param2=uninstall/m);
});

test('the action cluster orders service → host-config → uninstall (design order)', () => {
  const lines = actionClusterLines({ serviceState: 'running', remotes: [] });
  const iService = lines.findIndex((l) => /Remove the local service/.test(l));
  const iAdd = lines.findIndex((l) => /Add host…/.test(l));
  const iUninstall = lines.findIndex((l) => /Uninstall llmdash…/.test(l));
  assert.ok(iService >= 0 && iAdd >= 0 && iUninstall >= 0);
  assert.ok(iService < iAdd, 'service toggle leads');
  assert.ok(iAdd < iUninstall, 'uninstall submenu is last');
  // The cluster opens ONE group separator, not several stacked ones.
  assert.equal(lines[0], '---');
  assert.equal(lines.filter((l) => l === '---').length, 1, 'a single group separator');
});

test('every service/uninstall action shells to $ABS_NODE against the tracked helper, no HTTP (by inspection)', () => {
  for (const state of ['not-installed', 'running', 'stopped']) {
    const { serviceLine, uninstallLines } = serviceControlActionLines({ state });
    for (const l of [serviceLine, ...uninstallLines]) {
      if (l === '⊘ Uninstall llmdash…') continue; // the submenu parent has no action
      assert.ok(l.includes(`shell="${ABS_NODE}"`), `shells to ABS_NODE: ${l}`);
      assert.ok(l.includes(HELPER), `targets the tracked helper: ${l}`);
      assert.match(l, /terminal=false refresh=true/);
    }
  }
  // ABS_NODE is process.execPath (the absolute node), never a bare "node".
  assert.equal(ABS_NODE, process.execPath);
});

test('the items appear in SINGLE-host mode (state injected), glyph+rows unchanged (QA-01/QA-09)', () => {
  const state = loadFixture('state-fresh');
  const badge = computeBadge(state);
  const running = emit(badge, { host: '127.0.0.1', port: '8787', serviceState: 'running' });
  assert.match(running, /－ Remove the local service · running/);
  assert.match(running, /⊘ Uninstall llmdash…/);
  assert.match(running, /Remove the menu-bar badge only/);
  assert.match(running, /Uninstall llmdash completely…/);
  // not-installed flips the toggle label.
  const ni = emit(badge, { host: '127.0.0.1', port: '8787', serviceState: 'not-installed' });
  assert.match(ni, /＋ Install the local service/);
  // The shipped single-host glyph + per-tool rows are unchanged.
  assert.match(running.split('\n')[0], /^▪ C \d+% \|/);
  assert.match(running, /5-hour:  \d+% · resets/);
});

test('the items appear in MULTI-host mode too (both tiers), glyph unchanged (QA-01/QA-09)', () => {
  // A two-host combined view → multi mode.
  const local = loadFixture('state-fresh');
  const remote = loadFixture('state-fresh');
  const combined = {
    hosts: [
      { host: 'local', label: 'This machine', port: 8787, self: true, reachable: true, hostDiagnostic: null, fetchedAt: new Date().toISOString(), state: local },
      { host: '100.64.0.7', label: 'Desktop', port: 8787, self: false, reachable: true, hostDiagnostic: null, fetchedAt: new Date().toISOString(), state: remote },
    ],
    generatedAt: new Date().toISOString(),
  };
  const multi = computeMultiBadge(combined, { localMode: 'auto' });
  assert.equal(multi.mode, 'multi');
  const remotes = remotesFromCombined(combined);
  const out = emitMulti(multi, { host: '127.0.0.1', port: '8787', remotes, serviceState: 'stopped' });
  assert.match(out, /－ Remove the local service · stopped/);
  assert.match(out, /⊘ Uninstall llmdash…/);
  assert.match(out, /Remove the menu-bar badge only/);
  assert.match(out, /Uninstall llmdash completely…/);
  // The multi-host glyph still carries the host cue (unchanged): `▪ <host>·C <pct>%`.
  assert.match(out.split('\n')[0], /^▪ .+·C \d+% \|/);
});

test('readServiceState is injectable + never faked: fs-presence + launchctl print (QA-04)', () => {
  // not-installed: no plist on disk (nonexistent path).
  assert.equal(readServiceState({ label: 'com.llmdash.spike-x', plistPath: '/nonexistent/x.plist' }), 'not-installed');
  // Build a scratch present-plist; a stub execFile that throws → 'stopped'; that
  // returns → 'running'. The state is DERIVED, never a hardcoded checkmark.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-state-'));
  const plist = path.join(tmp, 'x.plist');
  fs.writeFileSync(plist, '<plist/>');
  const stopped = readServiceState({ label: 'l', plistPath: plist, execFile: () => { throw new Error('not loaded'); } });
  assert.equal(stopped, 'stopped');
  const running = readServiceState({ label: 'l', plistPath: plist, execFile: () => 'ok' });
  assert.equal(running, 'running');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the plugin source wires the service/uninstall actions to the helper, no HTTP mutation (by inspection)', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'scripts', 'menubar', 'llmdash.5s.js'), 'utf8');
  assert.match(src, /service-control-action\.mjs/);
  assert.match(src, /param2=install/);
  assert.match(src, /param2=remove\b/);
  assert.match(src, /param2=remove-badge/);
  assert.match(src, /param2=uninstall/);
  // No HTTP mutation in the plugin (the actions are local launchctl/fs ops).
  assert.doesNotMatch(src, /method:\s*['"]POST['"]|POST \/api|\.post\(/i);
});
