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

// --- Reading-age treatment (statusline-auto-refresh, branch B) --------------

test('band pills are text-first and the aging band never says "stale" (QA-16/17/18)', () => {
  assert.match(appJs, /age-pill pill-warn">aging</); // warn tint, the word "aging"
  assert.match(appJs, /age-pill pill-crit">stale</); // crit tint, the word "stale"
  // The thresholds come from the server (freshness.freshForMs / staleAfterMs),
  // derived live each render tick — never hardcoded client-side.
  assert.match(appJs, /freshForMs/);
  assert.match(appJs, /staleAfterMs/);
  assert.doesNotMatch(appJs, /\b(?:300|600)_?000\b/);
});

test('stale note copy is the approved verbatim, age interpolated live (QA-18/19/20)', () => {
  assert.match(appJs, /<strong>Stale reading<\/strong>/);
  assert.match(appJs, /the limits above may have moved since\. Open a Claude Code CLI session to refresh the reading \(the desktop app doesn't render the statusline that reports these limits\)\./);
});

test('the no-reading state names the capture remedy (QA-19/25)', () => {
  assert.match(appJs, /Open a Claude Code CLI session to capture the first reading\./);
});

test('the diagnostic note renders on the diagnostic, not on empty gauges (QA-20 contract shift)', () => {
  // The old guard returned '' whenever limits existed; with stale-reading the
  // note and the rendered gauges coexist — stale gauges stay visible.
  assert.doesNotMatch(appJs, /if \(tool\.haveLimits\) return ''/);
  assert.match(appJs, /stale-reading/);
});

test('ages re-derive live and clamp negative to "just now"', () => {
  assert.match(appJs, /'just now'/);
  // Hour-scale ages keep minutes via fmtDur ("updated 1h 24m ago").
  assert.match(appJs, /'updated ' \+ fmtDur\(ms\) \+ ' ago'/);
});
