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

test('missing account windows stay explicit and never become zero gauges', () => {
  assert.match(appJs, /No current window reading/);
  assert.match(appJs, /No short-window reading/);
  assert.match(appJs, /limit-unavailable">Unavailable/);
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

test('the first-run copy states BOTH arrival paths (the deferred one-clause truth update)', () => {
  assert.match(appJs, /auto-refresh also captures one automatically within a few minutes of Claude activity/);
});

// --- Auto-refresh diagnostic notes (claude-auto-refresh) ---------------------
// The copy table in pipeline/claude-auto-refresh/design-spec.md is verbatim-
// binding; these checks lock the fixed strings and the enum→sentence mapping.

test('the client maps both auto-refresh reason codes with the verbatim lead words', () => {
  assert.match(appJs, /auto-refresh-failing/);
  assert.match(appJs, /auto-refresh-disabled/);
  assert.match(appJs, /<strong>Auto-refresh is failing<\/strong>/);
  assert.match(appJs, /<strong>Auto-refresh is off<\/strong> \(<code>LLMDASH_CLAUDE_AUTOREFRESH=0<\/code>\)/);
});

test('each failure cause maps to its fixed sentence; unmapped causes fall back — never rendered raw', () => {
  // spawn-error (full env-var remedy inline, codex-cmd-failed precedent):
  assert.match(appJs, /The <code>claude<\/code> command couldn't be run: set <code>LLMDASH_CLAUDE_CMD<\/code> to the absolute path from <code>which claude<\/code> and restart the service, or open a Claude Code CLI session to \$\{remedy\}\./);
  // timeout:
  assert.match(appJs, /Refresh attempts are timing out before a reading arrives — open a Claude Code CLI session to \$\{remedy\}\./);
  // parse-failed:
  assert.match(appJs, /The <code>\/usage<\/code> screen couldn't be read \(a Claude Code update may have changed it\) — open a Claude Code CLI session to \$\{remedy\}\./);
  // no-reading-produced:
  assert.match(appJs, /Refresh attempts finish without producing a reading — open a Claude Code CLI session to \$\{remedy\}\./);
  // unmapped fallback:
  assert.match(appJs, /Refresh attempts keep failing — open a Claude Code CLI session to \$\{remedy\}\./);
  // The mapping is an OWN-KEY lookup with a fallback — the raw cause never
  // reaches HTML, and inherited Object keys ('constructor', '__proto__')
  // can't bypass the fallback (2026-07-02 security review).
  assert.match(appJs, /Object\.prototype\.hasOwnProperty\.call\(AUTOREFRESH_CAUSE_SENTENCES, d\.cause\)/);
  assert.doesNotMatch(appJs, /AUTOREFRESH_CAUSE_SENTENCES\[d\.cause\] \|\|/);
  assert.doesNotMatch(appJs, /esc\(d\.cause\)/);
});

test('the two opening fragments and the remedy-verb swap (reading present vs no reading ever)', () => {
  assert.match(appJs, /; the limits above may have moved since\./); // stale opening (age via fmtAge)
  assert.match(appJs, /— no reading has arrived yet\./); // no-reading opening
  assert.match(appJs, /'refresh the reading manually'/);
  assert.match(appJs, /'capture the first reading manually'/);
});

test('the disabled note names the re-enable path verbatim', () => {
  assert.match(appJs, /Unset the variable and restart to re-enable, or open a Claude Code CLI session to \$\{remedy\}\./);
});

test('both notes render with the shipped data-quality component (zero new CSS)', () => {
  // The new branches reuse .stale-note; no new class names were invented.
  const noteBranch = appJs.slice(appJs.indexOf('auto-refresh-failing'), appJs.indexOf("d.reason === 'stale-reading'"));
  assert.match(noteBranch, /class="stale-note"/);
  assert.doesNotMatch(noteBranch, /class="(?!stale-note)/);
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
