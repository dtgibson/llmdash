import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Guard for the claude-auto-refresh reality (supersedes the branch-B guard:
// the 2026-07-02 spike validated the /usage-scrape probe, so the previously
// reserved knobs and codes are now CONSUMED — and the invariants that still
// bind are locked here instead). NFR-05/06, FR-27's no-dead-knobs honesty,
// and the spawn-surface budget.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

const runtimeSurfaces = [
  'config.js',
  'README.md',
  ...fs.readdirSync(path.join(root, 'src')).map((f) => path.join('src', f)),
  ...fs.readdirSync(path.join(root, 'public')).map((f) => path.join('public', f)),
  ...fs.readdirSync(path.join(root, 'scripts')).filter((f) => f.endsWith('.js')).map((f) => path.join('scripts', f)),
];

test('package.json still declares zero runtime dependencies; pty comes from the OS (NFR-05, QA-34)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0);
  assert.ok(!pkg.devDependencies || Object.keys(pkg.devDependencies).length === 0);
  for (const f of runtimeSurfaces) assert.doesNotMatch(read(f), /node-pty/, f);
});

test('spawn surface budget: child_process only in the codex reader and the claude refresher', () => {
  for (const f of runtimeSurfaces) {
    if (f === path.join('src', 'codex-limits.js')) continue;
    if (f === path.join('src', 'claude-refresh.js')) continue;
    assert.doesNotMatch(read(f), /child_process/, f);
  }
});

test('the runner script is a fixed constant — config enters as positional argv, never interpolated (NFR-06, QA-35)', () => {
  const src = read('src', 'claude-refresh.js');
  const m = src.match(/const RUNNER_SRC = (['"`])([^\n]*)\1;/);
  assert.ok(m, 'RUNNER_SRC constant present');
  assert.ok(!m[2].includes('${'), 'no template interpolation inside the runner script');
  // The spawn passes the script constant with positional args only.
  assert.match(src, /spawn\('\/bin\/sh', \['-c', RUNNER_SRC, 'sh', tsPath, claudePath\]/);
  // The keystrokes are exactly the validated /usage sequence (FR-23): a
  // mechanism that submits a message must never ship. Two printf fragments:
  // the command text and the Enter.
  const runner = m[2].replace(/\\'/g, "'"); // undo JS quote escaping
  assert.match(runner, /printf '\/usage'/);
  assert.match(runner, /printf '\\+r'/); // the Enter keystroke
  assert.equal([...runner.matchAll(/printf/g)].length, 2, 'no other text is ever typed');
});

test('no dead knobs: every shipped env var drives behavior (FR-27, QA-26)', () => {
  const cfg = read('config.js');
  const refresher = read('src', 'claude-refresh.js');
  // The knobs exist in config…
  for (const knob of ['LLMDASH_CLAUDE_AUTOREFRESH', 'LLMDASH_CLAUDE_CMD', 'LLMDASH_CLAUDE_REFRESH_TIMEOUT_MS']) {
    assert.match(cfg, new RegExp(knob), `${knob} parsed in config.js`);
  }
  // …and their config fields are consumed by the mechanism.
  assert.match(refresher, /claudeAutoRefresh/);
  assert.match(refresher, /claudeCmd/);
  assert.match(refresher, /claudeRefreshTimeoutMs/);
  assert.match(refresher, /claudeRefreshCwd/);
});

test('the README documents the shipped mechanism and drops the manual-only claim (FR-30, QA-29)', () => {
  const readme = read('README.md');
  assert.match(readme, /auto-refresh/i);
  assert.match(readme, /\/usage/);
  // Every knob with its default.
  assert.match(readme, /LLMDASH_CLAUDE_AUTOREFRESH/);
  assert.match(readme, /LLMDASH_CLAUDE_CMD/);
  assert.match(readme, /LLMDASH_CLAUDE_REFRESH_TIMEOUT_MS/);
  assert.match(readme, /30000/);
  assert.match(readme, /LLMDASH_CLAUDE_MAX_AGE_MS/);
  assert.match(readme, /300000/);
  // The trust-entry + history disclosure and the dedicated cwd.
  assert.match(readme, /trust this folder/);
  assert.match(readme, /history\.jsonl/);
  assert.match(readme, /claude-refresh-cwd/);
  // The manual remedy remains; the manual-ONLY claim is gone.
  assert.match(readme, /open a\s+Claude Code CLI session/i);
  assert.doesNotMatch(readme, /only when a real Claude Code session renders/);
  // The usage-integrity promise is stated (\s+ tolerates markdown wrapping).
  assert.match(readme, /no plan\s+usage is consumed/);
});

test('the startup log no longer prints the old manual-only line by default (FR-28, QA-27)', () => {
  const health = read('src', 'health.js');
  // The phrase survives ONLY inside the honest disabled/unresolvable variants.
  const defaultBranchesOnly = health
    .split('\n')
    .filter((l) => !l.includes('LLMDASH_CLAUDE_AUTOREFRESH=0') && !l.includes('claude command not found'))
    .join('\n');
  assert.doesNotMatch(defaultBranchesOnly, /refresh only when a real Claude Code session renders/);
});
