import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Branch B guard (FR-23 / QA-24 / QA-27): the spike killed the auto-spawn
// mechanism, so zero [A] machinery may exist — no claude spawn path, no dead
// config knobs, no auto-refresh claims in the docs — and the package stays
// zero-dependency. QA-24's "zero spawns under any staleness" is vacuous by
// construction; these checks assert the construction.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

const runtimeSurfaces = [
  'config.js',
  'README.md',
  ...fs.readdirSync(path.join(root, 'src')).map((f) => path.join('src', f)),
  ...fs.readdirSync(path.join(root, 'public')).map((f) => path.join('public', f)),
  ...fs.readdirSync(path.join(root, 'scripts')).filter((f) => f.endsWith('.js')).map((f) => path.join('scripts', f)),
];

test('package.json still declares zero runtime dependencies (QA-27)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0);
  assert.ok(!pkg.devDependencies || Object.keys(pkg.devDependencies).length === 0);
});

test('the dropped [A] env knobs exist nowhere — dead knobs are dishonest surface', () => {
  for (const f of runtimeSurfaces) {
    const src = read(f);
    assert.doesNotMatch(src, /LLMDASH_CLAUDE_AUTOREFRESH/, f);
    assert.doesNotMatch(src, /LLMDASH_CLAUDE_REFRESH_TIMEOUT_MS/, f);
    assert.doesNotMatch(src, /LLMDASH_CLAUDE_CMD\b/, f);
  }
});

test('no claude spawn path: the only child_process site is the codex reader (QA-24)', () => {
  for (const f of runtimeSurfaces) {
    if (f === path.join('src', 'codex-limits.js')) continue; // existing codex app-server read
    assert.doesNotMatch(read(f), /child_process/, f);
  }
});

test('the README documents the branch-B reality: manual refresh, the cue, the knob (QA-15)', () => {
  const readme = read('README.md');
  // No auto-spawn claims anywhere.
  assert.doesNotMatch(readme, /auto-?refresh/i);
  assert.doesNotMatch(readme, /spawns? a .{0,40}session/i);
  // The manual-refresh reality and the reading-age cue, with the one knob.
  assert.match(readme, /only when a real Claude Code session renders/);
  assert.match(readme, /LLMDASH_CLAUDE_MAX_AGE_MS/);
  assert.match(readme, /300000/);
  assert.match(readme, /aging/);
  assert.match(readme, /stale/);
});
