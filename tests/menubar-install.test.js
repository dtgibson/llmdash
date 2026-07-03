import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// The badge is delivered by a GENERATED WRAPPER written into SwiftBar's plugin
// dir: a small POSIX-sh script that execs an ABSOLUTE node against the TRACKED
// plugin (the host spawns it under a minimal PATH where a bare "node" — esp.
// under nvm — can't resolve; spike-report 2026-07-02). The tracked source is
// NEVER modified, so the installed checkout stays clean and `git pull --ff-only`
// on re-run never aborts. These tests exercise --resolve-node / --setup-badge /
// --remove-badge in a fully sandboxed temp checkout with a scratch SwiftBar dir;
// no real SwiftBar dir and no repo file is touched. The installer NEVER installs
// SwiftBar.
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

// A throwaway "checkout" containing just the plugin (a COPY of the repo's
// scripts/menubar/llmdash.5s.js), so tests act on the copy, never the real repo
// file.
function fakeCheckout() {
  const dir = fs.mkdtempSync(path.join(tmp, 'checkout-'));
  const menubar = path.join(dir, 'scripts', 'menubar');
  fs.mkdirSync(menubar, { recursive: true });
  fs.copyFileSync(path.join(repoRoot, 'scripts', 'menubar', 'llmdash.5s.js'),
    path.join(menubar, 'llmdash.5s.js'));
  // The Add/Remove helper is a TRACKED sibling of the plugin, delivered by the
  // same model (the plugin's actions exec $ABS_NODE against it). Copy it too so
  // the delivery-model tests see the real repo layout.
  fs.copyFileSync(path.join(repoRoot, 'scripts', 'menubar', 'host-config-action.mjs'),
    path.join(menubar, 'host-config-action.mjs'));
  // The service/uninstall helper (menubar-service-controls) is ALSO a tracked
  // sibling delivered by the same model — copy it so the delivery-model tests see it.
  fs.copyFileSync(path.join(repoRoot, 'scripts', 'menubar', 'service-control-action.mjs'),
    path.join(menubar, 'service-control-action.mjs'));
  // The badge display-write helper (badge-display-options) is a tracked sibling.
  fs.copyFileSync(path.join(repoRoot, 'scripts', 'menubar', 'display-action.mjs'),
    path.join(menubar, 'display-action.mjs'));
  // The tracked tool-mark ASSETS travel with the checkout (opt-in logo path reads
  // them from its own plugin dir via import.meta.url). Copy them so the installed
  // badge resolves them the way it does in a real checkout.
  const assets = path.join(menubar, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  for (const a of ['claude-mark.png', 'codex-mark.png']) {
    fs.copyFileSync(path.join(repoRoot, 'scripts', 'menubar', 'assets', a), path.join(assets, a));
  }
  // The badge now reads its display prefs via src/host-config.js (badge-display-
  // options) — it runs IN-PLACE from the live checkout (unlike the self-contained
  // teardown helper), so its real dependency tree (config.js + src/host-config.js
  // + src/hosts.js + src/net.js) must be present, exactly as in a real checkout.
  fs.copyFileSync(path.join(repoRoot, 'config.js'), path.join(dir, 'config.js'));
  const src = path.join(dir, 'src');
  fs.mkdirSync(src, { recursive: true });
  for (const f of ['host-config.js', 'hosts.js', 'net.js']) {
    fs.copyFileSync(path.join(repoRoot, 'src', f), path.join(src, f));
  }
  return dir;
}
const DEV_SHEBANG = '#!/usr/bin/env node';
const WRAPPER_MARKER = 'llmdash-menu-bar-badge';

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

test('--setup-badge: writes a real wrapper (marker + abs-node + tracked path), NOT a symlink', () => {
  const checkout = fakeCheckout();
  const bin = path.join(tmp, 'node-forwrap');
  const nodeFp = fakeBin(bin, 'node');
  const home = path.join(tmp, 'home-wrap');
  const sbDir = path.join(home, 'Library', 'Application Support', 'SwiftBar', 'Plugins');
  fs.mkdirSync(sbDir, { recursive: true });
  const plugin = path.join(checkout, 'scripts', 'menubar', 'llmdash.5s.js');

  const r = run(['--setup-badge', checkout], { PATH: `${bin}:${SYS_PATH}`, HOME: home, LLMDASH_SWIFTBAR_DIR: sbDir });
  assert.equal(r.status, 0, r.stderr);

  const wrapper = path.join(sbDir, 'llmdash.5s.js');
  const lst = fs.lstatSync(wrapper);
  assert.ok(lst.isFile() && !lst.isSymbolicLink(), 'the wrapper is a REAL file, not a symlink');
  const body = fs.readFileSync(wrapper, 'utf8');
  assert.match(body, /^#!\/bin\/sh/);                 // POSIX-sh wrapper
  assert.match(body, new RegExp(WRAPPER_MARKER));      // the unique marker
  assert.ok(body.includes(`exec "${nodeFp}" "${plugin}"`), 'execs abs-node against the TRACKED plugin');
  assert.ok(fs.statSync(wrapper).mode & 0o111, 'the wrapper is executable');
  assert.match(r.stdout, /wrote the menu-bar wrapper/);
});

test('--setup-badge: does NOT modify the tracked plugin (anti-dirty guarantee)', () => {
  const checkout = fakeCheckout();
  const bin = path.join(tmp, 'node-antidirty');
  fakeBin(bin, 'node');
  const home = path.join(tmp, 'home-antidirty');
  const sbDir = path.join(home, 'Library', 'Application Support', 'SwiftBar', 'Plugins');
  fs.mkdirSync(sbDir, { recursive: true });
  const plugin = path.join(checkout, 'scripts', 'menubar', 'llmdash.5s.js');

  const before = fs.readFileSync(plugin, 'utf8');
  assert.equal(before.split('\n')[0], DEV_SHEBANG); // committed shebang before
  const r = run(['--setup-badge', checkout], { PATH: `${bin}:${SYS_PATH}`, HOME: home, LLMDASH_SWIFTBAR_DIR: sbDir });
  assert.equal(r.status, 0, r.stderr);
  const after = fs.readFileSync(plugin, 'utf8');
  // Byte-for-byte identical — the tracked source is untouched, so the checkout
  // stays clean and `git pull --ff-only` never aborts on a re-run.
  assert.equal(after, before, 'the tracked plugin file must be unchanged');
  assert.equal(after.split('\n')[0], DEV_SHEBANG);
});

test('--setup-badge: the generated wrapper actually launches the plugin end-to-end', async () => {
  // Point the wrapper at a REAL node and a scratch dashboard, then run the
  // wrapper the way SwiftBar would and confirm it emits a valid badge line.
  const http = await import('node:http');
  const { loadFixture } = await import('./helpers/menubar-run.js');
  const checkout = fakeCheckout();
  const home = path.join(tmp, 'home-e2e');
  const sbDir = path.join(home, 'Library', 'Application Support', 'SwiftBar', 'Plugins');
  fs.mkdirSync(sbDir, { recursive: true });
  // Bake the REAL node (process.execPath) so the wrapper can actually exec it.
  const bin = path.join(tmp, 'realnode-e2e');
  fs.mkdirSync(bin, { recursive: true });
  fs.symlinkSync(process.execPath, path.join(bin, 'node'));

  const setup = run(['--setup-badge', checkout], { PATH: `${bin}:${SYS_PATH}`, HOME: home, LLMDASH_SWIFTBAR_DIR: sbDir });
  assert.equal(setup.status, 0, setup.stderr);
  const wrapper = path.join(sbDir, 'llmdash.5s.js');

  // A scratch dashboard serving a single-host /api/hosts payload (the badge reads
  // /api/hosts now, FR-06): the shipped /api/state fixture wrapped as the ONE self
  // host → the badge renders byte-for-byte the shipped single-host glyph (FR-13).
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      hosts: [{
        host: 'local', label: 'This machine', port: 8787, self: true,
        reachable: true, hostDiagnostic: null,
        fetchedAt: new Date().toISOString(), state: loadFixture('state-fresh'),
      }],
      generatedAt: new Date().toISOString(),
    }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  // Run the wrapper as SwiftBar does (its own shell), under a MINIMAL PATH so
  // the abs-node baked into the wrapper is the only way node resolves. ASYNC so
  // this event loop stays live to serve the fetch (a blocking spawnSync would
  // freeze the server and the plugin would time out to offline).
  const { spawn } = await import('node:child_process');
  const out = await new Promise((resolve) => {
    const child = spawn('/bin/sh', [wrapper], {
      env: { PATH: '/usr/bin:/bin', LLMDASH_BADGE_HOST: '127.0.0.1', LLMDASH_PORT: String(port) },
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
  await new Promise((r) => server.close(r));
  assert.equal(out.status, 0, out.stderr);
  // The ratified default cue is ◆ (Claude), replacing the old C letter (badge-
  // display-options). A real badge line, not offline.
  assert.match(out.stdout.split('\n')[0], /^▪ ◆ \d+% \|/);
  assert.match(out.stdout, /Open dashboard \| href=http:\/\/127\.0\.0\.1:/);
});

test('--setup-badge: self-heals a baked tracked shebang (restores the committed shebang)', () => {
  const checkout = fakeCheckout();
  const bin = path.join(tmp, 'node-selfheal');
  const nodeFp = fakeBin(bin, 'node');
  const home = path.join(tmp, 'home-selfheal');
  const sbDir = path.join(home, 'Library', 'Application Support', 'SwiftBar', 'Plugins');
  fs.mkdirSync(sbDir, { recursive: true });
  const plugin = path.join(checkout, 'scripts', 'menubar', 'llmdash.5s.js');

  // Simulate the OLD model having baked an absolute-node shebang (dirtying the
  // checkout): replace line 1 with a #!<abspath>/node form.
  const bakedNode = '/opt/somewhere/bin/node';
  const orig = fs.readFileSync(plugin, 'utf8').split('\n');
  orig[0] = `#!${bakedNode}`;
  fs.writeFileSync(plugin, orig.join('\n'));

  const r = run(['--setup-badge', checkout], { PATH: `${bin}:${SYS_PATH}`, HOME: home, LLMDASH_SWIFTBAR_DIR: sbDir });
  assert.equal(r.status, 0, r.stderr);
  // The tracked shebang is restored to the committed form → checkout is clean.
  assert.equal(fs.readFileSync(plugin, 'utf8').split('\n')[0], DEV_SHEBANG);
  assert.match(r.stdout, /restored the tracked plugin shebang/);
});

test('--setup-badge: migrates a legacy symlink to the wrapper model', () => {
  const checkout = fakeCheckout();
  const bin = path.join(tmp, 'node-migrate');
  fakeBin(bin, 'node');
  const home = path.join(tmp, 'home-migrate');
  const sbDir = path.join(home, 'Library', 'Application Support', 'SwiftBar', 'Plugins');
  fs.mkdirSync(sbDir, { recursive: true });
  const plugin = path.join(checkout, 'scripts', 'menubar', 'llmdash.5s.js');
  const dest = path.join(sbDir, 'llmdash.5s.js');
  // The old model: a symlink into the checkout.
  fs.symlinkSync(plugin, dest);
  assert.ok(fs.lstatSync(dest).isSymbolicLink());

  const r = run(['--setup-badge', checkout], { PATH: `${bin}:${SYS_PATH}`, HOME: home, LLMDASH_SWIFTBAR_DIR: sbDir });
  assert.equal(r.status, 0, r.stderr);
  const lst = fs.lstatSync(dest);
  assert.ok(lst.isFile() && !lst.isSymbolicLink(), 'the legacy symlink was replaced by a real wrapper');
  assert.match(fs.readFileSync(dest, 'utf8'), new RegExp(WRAPPER_MARKER));
});

test('--setup-badge: refuses to clobber a real user file (no marker) in the SwiftBar dir', () => {
  const checkout = fakeCheckout();
  const bin = path.join(tmp, 'node-noclobber');
  fakeBin(bin, 'node');
  const home = path.join(tmp, 'home-noclobber');
  const sbDir = path.join(home, 'Library', 'Application Support', 'SwiftBar', 'Plugins');
  fs.mkdirSync(sbDir, { recursive: true });
  const dest = path.join(sbDir, 'llmdash.5s.js');
  fs.writeFileSync(dest, 'a user file that happens to share the name\n');

  const r = run(['--setup-badge', checkout], { PATH: `${bin}:${SYS_PATH}`, HOME: home, LLMDASH_SWIFTBAR_DIR: sbDir });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not a llmdash wrapper/);
  // The user's file is untouched.
  assert.equal(fs.readFileSync(dest, 'utf8'), 'a user file that happens to share the name\n');
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
  // The tracked plugin shebang was NOT rewritten to something dead.
  assert.equal(fs.readFileSync(path.join(checkout, 'scripts', 'menubar', 'llmdash.5s.js'), 'utf8').split('\n')[0],
    DEV_SHEBANG);
});

// ── --remove-badge: the symmetric uninstall ──────────────────────────────────
// Removes the SwiftBar-dir llmdash.5s.js ONLY when it is a marker-carrying
// wrapper (our generated file) OR a legacy symlink. A real file WITHOUT the
// marker is a user's own file and is NEVER deleted. Never uninstalls SwiftBar;
// re-run-safe.

// Build a fake HOME + SwiftBar plugin dir, and drop a llmdash.5s.js of the given
// kind into it: 'wrapper' (a marker-carrying real file, what setup writes),
// 'symlink' (the legacy model), 'realfile' (a user's non-marker file), or 'none'.
function fakeSwiftBarHome(kind) {
  const home = fs.mkdtempSync(path.join(tmp, 'home-rb-'));
  const sbDir = path.join(home, 'Library', 'Application Support', 'SwiftBar', 'Plugins');
  fs.mkdirSync(sbDir, { recursive: true });
  const checkout = fakeCheckout();
  const src = path.join(checkout, 'scripts', 'menubar', 'llmdash.5s.js');
  const dest = path.join(sbDir, 'llmdash.5s.js');
  if (kind === 'wrapper') {
    fs.writeFileSync(dest, `#!/bin/sh\n# ${WRAPPER_MARKER} (generated)\nexec "/abs/node" "${src}" "$@"\n`);
    fs.chmodSync(dest, 0o755);
  } else if (kind === 'symlink') {
    fs.symlinkSync(src, dest);
  } else if (kind === 'realfile') {
    fs.writeFileSync(dest, 'the user put this here\n');
  }
  return { home, sbDir, checkout, src, dest };
}

test('--remove-badge: removes our marker wrapper; the repo plugin source is left intact', () => {
  const { home, sbDir, checkout, src, dest } = fakeSwiftBarHome('wrapper');
  const r = run(['--remove-badge', checkout], { PATH: SYS_PATH, HOME: home, LLMDASH_SWIFTBAR_DIR: sbDir });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(dest), false, 'the wrapper was removed');
  assert.ok(fs.existsSync(src), 'the repo plugin source is untouched');
  assert.match(r.stdout, /removed the menu-bar wrapper/);
  assert.match(r.stdout, /did NOT uninstall SwiftBar/);
  assert.match(r.stdout, /brew uninstall --cask swiftbar/);
});

test('--remove-badge: still handles a legacy symlink (unlinks it, source stays)', () => {
  const { home, sbDir, checkout, src, dest } = fakeSwiftBarHome('symlink');
  assert.ok(fs.lstatSync(dest).isSymbolicLink());
  const r = run(['--remove-badge', checkout], { PATH: SYS_PATH, HOME: home, LLMDASH_SWIFTBAR_DIR: sbDir });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(dest), false, 'the legacy symlink was removed');
  assert.ok(fs.existsSync(src), 'the repo plugin source is untouched (rm did not follow the link)');
  assert.match(r.stdout, /legacy plugin symlink/);
});

test('--remove-badge: no-op (exit 0) when nothing is linked', () => {
  const { home, sbDir, checkout } = fakeSwiftBarHome('none'); // dir exists, nothing there
  const r = run(['--remove-badge', checkout], { PATH: SYS_PATH, HOME: home, LLMDASH_SWIFTBAR_DIR: sbDir });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /nothing to remove/);
});

test('--remove-badge: NEVER deletes a real file WITHOUT our marker', () => {
  const { home, sbDir, checkout, dest } = fakeSwiftBarHome('realfile');
  assert.ok(fs.lstatSync(dest).isFile() && !fs.lstatSync(dest).isSymbolicLink());
  const r = run(['--remove-badge', checkout], { PATH: SYS_PATH, HOME: home, LLMDASH_SWIFTBAR_DIR: sbDir });
  assert.equal(r.status, 0);
  // The user's file is left exactly as it was.
  assert.ok(fs.existsSync(dest), 'the non-marker real file was NOT deleted');
  assert.equal(fs.readFileSync(dest, 'utf8'), 'the user put this here\n');
  assert.match(r.stdout, /not a llmdash wrapper \(no marker\) — leaving it/);
});

test('--remove-badge: no SwiftBar dir → prints where to look, exits 0, deletes nothing', () => {
  const home = fs.mkdtempSync(path.join(tmp, 'home-nosb-'));
  const checkout = fakeCheckout();
  const r = run(['--remove-badge', checkout], { PATH: SYS_PATH, HOME: home }); // NO_SWIFTBAR default
  assert.equal(r.status, 0);
  assert.match(r.stdout, /no SwiftBar plugin directory detected/);
  assert.match(r.stdout, /brew uninstall --cask swiftbar/);
  assert.ok(fs.existsSync(path.join(checkout, 'scripts', 'menubar', 'llmdash.5s.js')));
});

test('setup then remove is symmetric: setup writes the wrapper, remove deletes it, source & tracked shebang survive', () => {
  const bin = path.join(tmp, 'node-roundtrip');
  fakeBin(bin, 'node');
  const home = fs.mkdtempSync(path.join(tmp, 'home-roundtrip-'));
  const sbDir = path.join(home, 'Library', 'Application Support', 'SwiftBar', 'Plugins');
  fs.mkdirSync(sbDir, { recursive: true });
  const checkout = fakeCheckout();
  const src = path.join(checkout, 'scripts', 'menubar', 'llmdash.5s.js');
  const dest = path.join(sbDir, 'llmdash.5s.js');
  const trackedBefore = fs.readFileSync(src, 'utf8');

  const setup = run(['--setup-badge', checkout], { PATH: `${bin}:${SYS_PATH}`, HOME: home, LLMDASH_SWIFTBAR_DIR: sbDir });
  assert.equal(setup.status, 0, setup.stderr);
  assert.ok(fs.lstatSync(dest).isFile() && !fs.lstatSync(dest).isSymbolicLink(), 'setup wrote a real wrapper');
  assert.match(fs.readFileSync(dest, 'utf8'), new RegExp(WRAPPER_MARKER));

  const remove = run(['--remove-badge', checkout], { PATH: SYS_PATH, HOME: home, LLMDASH_SWIFTBAR_DIR: sbDir });
  assert.equal(remove.status, 0, remove.stderr);
  assert.equal(fs.existsSync(dest), false, 'remove deleted the wrapper');
  assert.ok(fs.existsSync(src), 'the plugin source survived the round trip');
  // The tracked source is byte-identical across the whole round trip.
  assert.equal(fs.readFileSync(src, 'utf8'), trackedBefore, 'tracked plugin unchanged across setup+remove');
});

// ── The Add/Remove helper rides the tracked wrapper/absolute-node model (NFR-06) ─
// The helper (host-config-action.mjs) is a TRACKED sibling of the plugin. The
// installer never rewrites it (only the SwiftBar-dir wrapper is generated); the
// plugin's dropdown actions exec $ABS_NODE against the helper at its tracked path.
// --remove-badge removes only the wrapper — the tracked helper (repo source) is
// untouched. (QA-14/QA-27.)

test('--setup-badge: the tracked helper is NOT modified and stays alongside the plugin (QA-27)', () => {
  const checkout = fakeCheckout();
  const bin = path.join(tmp, 'node-helper');
  fakeBin(bin, 'node');
  const home = path.join(tmp, 'home-helper');
  const sbDir = path.join(home, 'Library', 'Application Support', 'SwiftBar', 'Plugins');
  fs.mkdirSync(sbDir, { recursive: true });
  const helper = path.join(checkout, 'scripts', 'menubar', 'host-config-action.mjs');
  const before = fs.readFileSync(helper, 'utf8');

  const r = run(['--setup-badge', checkout], { PATH: `${bin}:${SYS_PATH}`, HOME: home, LLMDASH_SWIFTBAR_DIR: sbDir });
  assert.equal(r.status, 0, r.stderr);
  // The helper is byte-for-byte unchanged (tracked source is never rewritten).
  assert.equal(fs.readFileSync(helper, 'utf8'), before, 'the tracked helper must be unchanged');
  // It still lives in the checkout beside the plugin (the delivery layout).
  assert.ok(fs.existsSync(helper), 'the helper stays alongside the plugin in the checkout');
});

test('the plugin wires its Add/Remove actions to $ABS_NODE against the tracked helper (NFR-06)', () => {
  // A static check on the plugin SOURCE: the action lines exec ABS_NODE (the same
  // absolute node the wrapper bakes, = process.execPath) against the sibling
  // host-config-action.mjs — never a bare "node", never an HTTP mutation.
  const pluginSrc = fs.readFileSync(path.join(repoRoot, 'scripts', 'menubar', 'llmdash.5s.js'), 'utf8');
  assert.match(pluginSrc, /host-config-action\.mjs/);
  assert.match(pluginSrc, /ABS_NODE = process\.execPath/);
  // The action lines shell to ABS_NODE with param2=add / param2=remove.
  assert.match(pluginSrc, /shell="\$\{ABS_NODE\}".*param2=add/);
  assert.match(pluginSrc, /shell="\$\{ABS_NODE\}".*param2=remove/);
  // No HTTP mutation anywhere in the plugin (the actions write a local file only).
  assert.doesNotMatch(pluginSrc, /method:\s*['"]POST['"]|POST \/api|\.post\(/i);
});

test('--remove-badge: leaves the tracked helper intact (symmetric uninstall, QA-27)', () => {
  const { home, sbDir, checkout } = fakeSwiftBarHome('wrapper');
  const helper = path.join(checkout, 'scripts', 'menubar', 'host-config-action.mjs');
  assert.ok(fs.existsSync(helper));
  const before = fs.readFileSync(helper, 'utf8');
  const r = run(['--remove-badge', checkout], { PATH: SYS_PATH, HOME: home, LLMDASH_SWIFTBAR_DIR: sbDir });
  assert.equal(r.status, 0, r.stderr);
  // The tracked helper is the repo source — never removed by --remove-badge.
  assert.ok(fs.existsSync(helper), 'the tracked helper survives --remove-badge');
  assert.equal(fs.readFileSync(helper, 'utf8'), before);
});

test('--setup-badge: the badge-setup message names the hosts.conf location (FR-21)', () => {
  const checkout = fakeCheckout();
  const bin = path.join(tmp, 'node-conf-note');
  fakeBin(bin, 'node');
  const home = path.join(tmp, 'home-conf-note');
  const sbDir = path.join(home, 'Library', 'Application Support', 'SwiftBar', 'Plugins');
  fs.mkdirSync(sbDir, { recursive: true });
  const r = run(['--setup-badge', checkout], { PATH: `${bin}:${SYS_PATH}`, HOME: home, LLMDASH_SWIFTBAR_DIR: sbDir });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /hosts\.conf/);
  assert.match(r.stdout, /no HTTP write/);
});

// ── The service/uninstall helper rides the same wrapper/absolute-node model ────
// (menubar-service-controls, NFR-08 / QA-27.) The tracked service-control helper
// is delivered beside the plugin; the installer never rewrites it, --setup-badge
// leaves it untouched, and --remove-badge (badge only) never deletes it.

test('--setup-badge: the service-control helper is NOT modified and stays beside the plugin (QA-27)', () => {
  const checkout = fakeCheckout();
  const bin = path.join(tmp, 'node-svc-helper');
  fakeBin(bin, 'node');
  const home = path.join(tmp, 'home-svc-helper');
  const sbDir = path.join(home, 'Library', 'Application Support', 'SwiftBar', 'Plugins');
  fs.mkdirSync(sbDir, { recursive: true });
  const helper = path.join(checkout, 'scripts', 'menubar', 'service-control-action.mjs');
  const before = fs.readFileSync(helper, 'utf8');

  const r = run(['--setup-badge', checkout], { PATH: `${bin}:${SYS_PATH}`, HOME: home, LLMDASH_SWIFTBAR_DIR: sbDir });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(helper, 'utf8'), before, 'the tracked service-control helper must be unchanged');
  assert.ok(fs.existsSync(helper), 'it stays alongside the plugin in the checkout');
});

test('--remove-badge: leaves the service-control helper intact (badge-only removal, QA-27)', () => {
  const { home, sbDir, checkout } = fakeSwiftBarHome('wrapper');
  const helper = path.join(checkout, 'scripts', 'menubar', 'service-control-action.mjs');
  const before = fs.readFileSync(helper, 'utf8');
  const r = run(['--remove-badge', checkout], { PATH: SYS_PATH, HOME: home, LLMDASH_SWIFTBAR_DIR: sbDir });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(helper), 'the tracked helper survives --remove-badge (badge-only)');
  assert.equal(fs.readFileSync(helper, 'utf8'), before);
});

test('the plugin wires the service/uninstall actions to $ABS_NODE against the service-control helper (NFR-08)', () => {
  const pluginSrc = fs.readFileSync(path.join(repoRoot, 'scripts', 'menubar', 'llmdash.5s.js'), 'utf8');
  assert.match(pluginSrc, /service-control-action\.mjs/);
  assert.match(pluginSrc, /SERVICE_CONTROL_ACTION = /);
  assert.match(pluginSrc, /shell="\$\{ABS_NODE\}".*param2=install/);
  assert.match(pluginSrc, /shell="\$\{ABS_NODE\}".*param2=uninstall/);
  // No HTTP mutation added by these actions.
  assert.doesNotMatch(pluginSrc, /method:\s*['"]POST['"]|POST \/api|\.post\(/i);
});

// SwiftBar is NEVER uninstalled by any llmdash path (QA-15) — extend the guard to
// the service-control helper: it points to the manual brew step, never runs it.
test('no code path uninstalls SwiftBar; the copy points to the manual brew step (QA-15)', () => {
  const installer = fs.readFileSync(script, 'utf8');
  const helper = fs.readFileSync(path.join(repoRoot, 'scripts', 'menubar', 'service-control-action.mjs'), 'utf8');
  for (const [name, src] of [['installer', installer], ['service-control helper', helper]]) {
    // Never RUNS `brew uninstall … swiftbar`.
    assert.doesNotMatch(src, /execFileSync\([^)]*brew|spawn[^)]*brew|brew uninstall --cask swiftbar['"]\s*\]/,
      `${name} must not run brew uninstall swiftbar`);
  }
  // Both surfaces DO point the user to the manual step in copy.
  assert.match(installer, /brew uninstall --cask swiftbar/);
  assert.match(helper, /brew uninstall --cask swiftbar/);
});

test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
