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
