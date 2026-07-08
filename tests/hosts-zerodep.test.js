import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// NFR-01 / QA-20: multi-host adds zero runtime dependencies and no build step;
// the fan-out uses node:http only. Lock it structurally so a future refactor
// can't sneak in an npm dependency or a non-builtin.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

test('package.json has zero runtime dependencies and no build step (QA-20)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.dependencies || {}, {}, 'no runtime deps');
  assert.deepEqual(pkg.devDependencies || {}, {}, 'no dev deps either (zero-dep tool)');
  assert.ok(!pkg.scripts || !pkg.scripts.build, 'no build step');
});

test('the multi-host modules import only Node builtins (node: or relative)', () => {
  const files = [
    // src/
    path.join(root, 'src', 'hosts.js'),
    path.join(root, 'src', 'host-cache.js'),
    path.join(root, 'src', 'host-view.js'),
    path.join(root, 'src', 'poller.js'),
    path.join(root, 'src', 'host-config.js'),            // multi-host-badge: the config-file layer
    // the badge plugin + its Add/Remove helper (multi-host-badge)
    path.join(root, 'scripts', 'menubar', 'llmdash.5s.js'),
    path.join(root, 'scripts', 'menubar', 'host-config-action.mjs'),
    // the Display-write helper (badge-display-options) — node builtins + host-config.js
    path.join(root, 'scripts', 'menubar', 'display-action.mjs'),
    // the service/uninstall helper (menubar-service-controls) — self-contained,
    // node: builtins only (so its detached temp copy needs nothing from the checkout).
    path.join(root, 'scripts', 'menubar', 'service-control-action.mjs'),
  ];
  for (const fp of files) {
    const src = fs.readFileSync(fp, 'utf8');
    const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    for (const spec of imports) {
      const ok = spec.startsWith('node:') || spec.startsWith('.') || spec.startsWith('/');
      assert.ok(ok, `${path.basename(fp)} imports a non-builtin: ${spec}`);
    }
  }
});

test('the fan-out uses node:http (not an npm http client)', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'hosts.js'), 'utf8');
  assert.match(src, /import http from 'node:http'/);
});

// badge-display-options: the tracked tool-mark PNG assets are SOURCE, not a
// dependency (package.json runtime deps stay 0); the logo read is node:fs; no
// build step is introduced by shipping them.
test('the tracked tool-mark PNGs are source (not a dependency), read via node:fs, no build step', () => {
  const assets = path.join(root, 'scripts', 'menubar', 'assets');
  for (const a of ['claude-mark.png', 'codex-mark.png']) {
    const fp = path.join(assets, a);
    assert.ok(fs.existsSync(fp), `${a} is tracked source`);
    const b = fs.readFileSync(fp);
    assert.ok(b.slice(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${a} is a PNG`);
  }
  // package.json still has zero runtime deps (the PNGs are not a package).
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.dependencies || {}, {});
  // The badge reads the asset with node:fs (readFileSync), never a fetch/npm loader.
  const plugin = fs.readFileSync(path.join(root, 'scripts', 'menubar', 'llmdash.5s.js'), 'utf8');
  assert.match(plugin, /readFileSync|_readFileSync/);
  assert.match(plugin, /new URL\(`\.\/assets\//); // resolved via import.meta.url
  assert.doesNotMatch(plugin, /https?:\/\/.*logo/i);
  const license = fs.readFileSync(path.join(assets, 'LICENSE.md'), 'utf8');
  assert.match(license, /Source pages:/);
  assert.match(license, /trademark/i);
});

// menubar-service-controls: the detached teardown copies the helper to a temp dir
// and runs it AFTER the checkout is deleted — so it must import NOTHING from the
// checkout (../../src, ../../config). A lazy checkout import would throw
// ERR_MODULE_NOT_FOUND (spike Hazard E). Lock it: node: builtins only.
test('the service-control helper imports only node: builtins — nothing from the checkout (Hazard E)', () => {
  const fp = path.join(root, 'scripts', 'menubar', 'service-control-action.mjs');
  const src = fs.readFileSync(fp, 'utf8');
  // Every static import specifier is a node: builtin (no ../../src, no ../../config).
  const specs = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
  for (const spec of specs) {
    assert.ok(spec.startsWith('node:'), `service-control-action imports a non-builtin: ${spec}`);
  }
  // No dynamic import() from the checkout either.
  assert.doesNotMatch(src, /import\(\s*['"]\.\.?\//, 'no dynamic import from the checkout');
  assert.doesNotMatch(src, /require\(/, 'no require of a checkout module');
});
