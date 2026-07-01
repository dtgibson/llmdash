import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// public/app.js is a browser script (no exports), so its empty-state copy is
// locked with static checks: the two false Codex claims must never come back,
// and the client must keep mapping the server's diagnostic reasons.
const appJs = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'app.js'), 'utf8');

test('the false Codex empty-state claims are gone', () => {
  // Codex DOES record usage locally (~/.codex/sessions rollout logs).
  assert.doesNotMatch(appJs, /doesn't record usage locally/);
  // Never claim live limits when the gauges may be showing em-dashes.
  assert.doesNotMatch(appJs, /limits above are live/i);
});

test('the client maps the server-provided limit diagnostics', () => {
  assert.match(appJs, /no-statusline-reading/);
  assert.match(appJs, /codex-cmd-failed/);
  assert.match(appJs, /LLMDASH_CODEX_CMD/); // the fix is named in the UI copy
});

test('the per-gauge empty state is unchanged (stat-set diff: nothing dropped)', () => {
  assert.match(appJs, /waiting for a reading/);
  assert.match(appJs, /limit data not available yet/); // pacing row empty state
});
