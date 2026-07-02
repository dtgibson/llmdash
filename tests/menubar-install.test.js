import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// The badge plugin's INSTALLED artifact must carry an ABSOLUTE node path in its
// shebang — the host spawns it under a minimal PATH where a bare "node" (esp.
// under nvm) can't resolve → a dead badge (spike-report 2026-07-02). These
// tests exercise the installer's --resolve-node and --setup-badge hooks in a
// fully sandboxed temp checkout: no real SwiftBar dir and no repo file is
// touched. The installer NEVER installs SwiftBar.
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repoRoot, 'scripts', 'install-macos.sh');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-badge-install-'));
const emptyDir = path.join(tmp, 'empty');
fs.mkdirSync(emptyDir, { recursive: true });

function fakeBin(dir, name) {
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, name);
  fs.writeFileSync(fp, '#!/bin/sh\n');
  fs.chmodSync(fp, 0o755);
  return fp;
}

// A throwaway "checkout" containing just the plugin, so --setup-badge rewrites
// a COPY, never the repo's real scripts/menubar/llmdash.5s.js.
function fakeCheckout() {
  const dir = fs.mkdtempSync(path.join(tmp, 'checkout-'));
  const menubar = path.join(dir, 'scripts', 'menubar');
  fs.mkdirSync(menubar, { recursive: true });
  fs.copyFileSync(path.join(repoRoot, 'scripts', 'menubar', 'llmdash.5s.js'),
    path.join(menubar, 'llmdash.5s.js'));
  return dir;
}

// setup_badge shells out to coreutils (tail/mv/ln/chmod/defaults), so the base
// PATH includes the system dirs; a caller prepends a fake-node dir to control
// resolution. resolve_node checks PATH first, so a fake node in front wins over
// any real /usr/bin/node. (The resolve-only hooks keep the stricter empty PATH.)
const SYS_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
// Hermetic by default: point SwiftBar-dir detection at a NON-EXISTENT scratch
// path so the installer never reads the dev machine's real SwiftBar prefs
// (`defaults read` ignores $HOME). Tests that want a DETECTED dir override
// LLMDASH_SWIFTBAR_DIR with their own scratch sbDir.
const NO_SWIFTBAR = path.join(tmp, 'no-swiftbar-dir');
function run(args, env) {
  return spawnSync('/bin/bash', [script, ...args], {
    env: { HOME: path.join(tmp, 'home'), PATH: emptyDir, LLMDASH_SWIFTBAR_DIR: NO_SWIFTBAR, ...env },
    encoding: 'utf8',
  });
}

test('--resolve-node: uses node from PATH when present', () => {
  const bin = path.join(tmp, 'node-onpath');
  const fp = fakeBin(bin, 'node');
  const r = run(['--resolve-node'], { PATH: `${bin}:${emptyDir}` });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), fp);
});

test('--resolve-node: falls back to ~/.local/bin/node off PATH', () => {
  const home = path.join(tmp, 'home-localnode');
  const fp = fakeBin(path.join(home, '.local', 'bin'), 'node');
  const r = run(['--resolve-node'], { HOME: home });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), fp);
});

test('--resolve-node: exits non-zero when node cannot be resolved (loud failure)', (t) => {
  if (fs.existsSync('/opt/homebrew/bin/node') || fs.existsSync('/usr/local/bin/node')) {
    return t.skip('a system-wide node exists on this machine');
  }
  const r = run(['--resolve-node'], { HOME: path.join(tmp, 'home-bare') });
  assert.notEqual(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

test('--setup-badge: bakes the absolute node path into the plugin shebang', () => {
  const checkout = fakeCheckout();
  const bin = path.join(tmp, 'node-forbake');
  const nodeFp = fakeBin(bin, 'node');
  const plugin = path.join(checkout, 'scripts', 'menubar', 'llmdash.5s.js');

  // Before: the checked-in dev shebang.
  assert.match(fs.readFileSync(plugin, 'utf8').split('\n')[0], /^#!\/usr\/bin\/env node$/);

  const r = run(['--setup-badge', checkout], { PATH: `${bin}:${SYS_PATH}`, HOME: path.join(tmp, 'home-nosb') });
  assert.equal(r.status, 0, r.stderr);
  // After: line 1 is the ABSOLUTE node path; the rest of the file is intact.
  const after = fs.readFileSync(plugin, 'utf8');
  assert.equal(after.split('\n')[0], `#!${nodeFp}`);
  assert.match(after, /export function computeBadge/); // body preserved
  // It marks the plugin executable.
  assert.ok(fs.statSync(plugin).mode & 0o111);
  // With no SwiftBar dir, it names SwiftBar as a user-installed prerequisite and
  // does NOT claim to have installed it.
  assert.match(r.stdout, /brew install --cask swiftbar/);
  assert.doesNotMatch(r.stdout, /installed SwiftBar/i);
});

test('--setup-badge: symlinks into a DETECTED SwiftBar plugin dir, never installs SwiftBar', () => {
  const checkout = fakeCheckout();
  const bin = path.join(tmp, 'node-forsymlink');
  fakeBin(bin, 'node');
  const home = path.join(tmp, 'home-withsb');
  const sbDir = path.join(home, 'Library', 'Application Support', 'SwiftBar', 'Plugins');
  fs.mkdirSync(sbDir, { recursive: true });

  const r = run(['--setup-badge', checkout], { PATH: `${bin}:${SYS_PATH}`, HOME: home, LLMDASH_SWIFTBAR_DIR: sbDir });
  assert.equal(r.status, 0, r.stderr);
  const link = path.join(sbDir, 'llmdash.5s.js');
  assert.ok(fs.existsSync(link), 'plugin symlinked into the detected SwiftBar dir');
  assert.equal(fs.realpathSync(link), fs.realpathSync(path.join(checkout, 'scripts', 'menubar', 'llmdash.5s.js')));
  assert.match(r.stdout, /symlinked the plugin into SwiftBar/);
});

test('--setup-badge: node unresolved → loud failure with the fix, non-zero, no dead badge', (t) => {
  if (fs.existsSync('/opt/homebrew/bin/node') || fs.existsSync('/usr/local/bin/node')) {
    return t.skip('a system-wide node exists on this machine');
  }
  const checkout = fakeCheckout();
  const r = run(['--setup-badge', checkout], { HOME: path.join(tmp, 'home-bare2'), PATH: emptyDir });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /node not found/);
  assert.match(r.stderr, /install Node 24\+/i);
  // The plugin shebang was NOT rewritten to something dead.
  assert.match(fs.readFileSync(path.join(checkout, 'scripts', 'menubar', 'llmdash.5s.js'), 'utf8').split('\n')[0],
    /^#!\/usr\/bin\/env node$/);
});

// ── --remove-badge: the symmetric uninstall ──────────────────────────────────
// Removes ONLY the symlink setup created. It is symlink-only (never deletes a
// real file), never follows the link to delete its target (the repo source
// stays), never uninstalls SwiftBar, and is re-run-safe.

// Build a fake HOME with a SwiftBar plugin dir; optionally symlink or drop a
// real file named llmdash.5s.js into it. Returns { home, sbDir, checkout }.
function fakeSwiftBarHome(kind) {
  const home = fs.mkdtempSync(path.join(tmp, 'home-rb-'));
  const sbDir = path.join(home, 'Library', 'Application Support', 'SwiftBar', 'Plugins');
  fs.mkdirSync(sbDir, { recursive: true });
  const checkout = fakeCheckout();
  const src = path.join(checkout, 'scripts', 'menubar', 'llmdash.5s.js');
  const link = path.join(sbDir, 'llmdash.5s.js');
  if (kind === 'symlink') fs.symlinkSync(src, link);
  else if (kind === 'realfile') fs.writeFileSync(link, 'the user put this here\n');
  return { home, sbDir, checkout, src, link };
}

test('--remove-badge: unlinks the symlink; the repo plugin source is left intact', () => {
  const { home, sbDir, checkout, src, link } = fakeSwiftBarHome('symlink');
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  const r = run(['--remove-badge', checkout], { PATH: SYS_PATH, HOME: home, LLMDASH_SWIFTBAR_DIR: sbDir });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(link), false, 'the symlink was removed');
  assert.ok(fs.existsSync(src), 'the repo plugin source is untouched (rm did not follow the link)');
  assert.match(r.stdout, /unlinked the plugin symlink from SwiftBar/);
  // Discloses the SwiftBar symmetry: it did NOT uninstall the host.
  assert.match(r.stdout, /did NOT uninstall SwiftBar/);
  assert.match(r.stdout, /brew uninstall --cask swiftbar/);
});

test('--remove-badge: no-op (exit 0) when nothing is linked', () => {
  const { home, sbDir, checkout } = fakeSwiftBarHome('none'); // dir exists, nothing linked
  const r = run(['--remove-badge', checkout], { PATH: SYS_PATH, HOME: home, LLMDASH_SWIFTBAR_DIR: sbDir });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /nothing to remove/);
});

test('--remove-badge: NEVER deletes a non-symlink file named llmdash.5s.js', () => {
  const { home, sbDir, checkout, link } = fakeSwiftBarHome('realfile');
  assert.ok(fs.lstatSync(link).isFile() && !fs.lstatSync(link).isSymbolicLink());
  const r = run(['--remove-badge', checkout], { PATH: SYS_PATH, HOME: home, LLMDASH_SWIFTBAR_DIR: sbDir });
  assert.equal(r.status, 0);
  // The real file is left exactly as it was.
  assert.ok(fs.existsSync(link), 'the real file was NOT deleted');
  assert.equal(fs.readFileSync(link, 'utf8'), 'the user put this here\n');
  assert.match(r.stdout, /is NOT a symlink — leaving it untouched/);
});

test('--remove-badge: no SwiftBar dir → prints where to look, exits 0, deletes nothing', () => {
  // A HOME with NO SwiftBar plugin dir at all.
  const home = fs.mkdtempSync(path.join(tmp, 'home-nosb-'));
  const checkout = fakeCheckout();
  const r = run(['--remove-badge', checkout], { PATH: SYS_PATH, HOME: home });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /no SwiftBar plugin directory detected/);
  assert.match(r.stdout, /brew uninstall --cask swiftbar/);
  // The repo source is untouched.
  assert.ok(fs.existsSync(path.join(checkout, 'scripts', 'menubar', 'llmdash.5s.js')));
});

test('setup then remove is symmetric: setup links it, remove unlinks it, source survives both', () => {
  const bin = path.join(tmp, 'node-sym');
  fakeBin(bin, 'node');
  const home = fs.mkdtempSync(path.join(tmp, 'home-roundtrip-'));
  const sbDir = path.join(home, 'Library', 'Application Support', 'SwiftBar', 'Plugins');
  fs.mkdirSync(sbDir, { recursive: true });
  const checkout = fakeCheckout();
  const src = path.join(checkout, 'scripts', 'menubar', 'llmdash.5s.js');
  const link = path.join(sbDir, 'llmdash.5s.js');

  const setup = run(['--setup-badge', checkout], { PATH: `${bin}:${SYS_PATH}`, HOME: home, LLMDASH_SWIFTBAR_DIR: sbDir });
  assert.equal(setup.status, 0, setup.stderr);
  assert.ok(fs.lstatSync(link).isSymbolicLink(), 'setup created a symlink');

  const remove = run(['--remove-badge', checkout], { PATH: SYS_PATH, HOME: home, LLMDASH_SWIFTBAR_DIR: sbDir });
  assert.equal(remove.status, 0, remove.stderr);
  assert.equal(fs.existsSync(link), false, 'remove unlinked it');
  assert.ok(fs.existsSync(src), 'the plugin source survived the round trip');
});

test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
