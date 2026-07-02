import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fmtDur, ageBand, diagLine } from '../scripts/menubar/llmdash.5s.js';

// The badge plugin can't import browser JS, so it copies public/app.js's
// presentation helpers (fmtDur, ageBand) VERBATIM and mirrors limitsNoteHtml's
// diagnostic-copy SEMANTICS. If the web client's honesty language drifts and
// the plugin's copy doesn't move with it, the badge silently diverges from the
// dashboard. This guard fails loudly when that happens. (Risk #3 in schema.md.)
const here = path.dirname(fileURLToPath(import.meta.url));
const appJs = fs.readFileSync(path.join(here, '..', 'public', 'app.js'), 'utf8');
const pluginJs = fs.readFileSync(path.join(here, '..', 'scripts', 'menubar', 'llmdash.5s.js'), 'utf8');

// Normalize whitespace so an incidental reindent doesn't fail the guard, while
// a real change to the logic still does.
const norm = (s) => s.replace(/\s+/g, ' ').trim();

// Pull a function's source body out of a file by its declaration header.
function extractFn(src, header) {
  const start = src.indexOf(header);
  assert.notEqual(start, -1, `could not find "${header}"`);
  // Walk braces from the first { after the header to its match.
  const open = src.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

// ── fmtDur parity ────────────────────────────────────────────────────────────
test('parity: the plugin fmtDur body is verbatim from public/app.js', () => {
  const appFn = extractFn(appJs, 'function fmtDur(ms)');
  // The plugin declares it as `export function fmtDur(ms)`.
  const pluginFn = extractFn(pluginJs, 'export function fmtDur(ms)').replace(/^export /, '');
  assert.equal(norm(pluginFn), norm(appFn));
});

test('parity: fmtDur produces identical output to app.js across the band boundaries', () => {
  // Re-declare app.js's fmtDur inline from its extracted body to run it here.
  const appFmtDur = new Function('return (' + extractFn(appJs, 'function fmtDur(ms)') + ')')();
  for (const ms of [null, 0, -1, 1000, 59_000, 60_000, 90 * 60000, 24 * 3600000, 36 * 3600000, 7 * 86400000]) {
    assert.equal(fmtDur(ms), appFmtDur(ms), `fmtDur(${ms}) diverged`);
  }
});

// ── ageBand parity ───────────────────────────────────────────────────────────
test('parity: the plugin ageBand body is verbatim from public/app.js', () => {
  const appFn = extractFn(appJs, 'function ageBand(f)');
  const pluginFn = extractFn(pluginJs, 'export function ageBand(f)').replace(/^export /, '');
  assert.equal(norm(pluginFn), norm(appFn));
});

test('parity: ageBand produces identical bands to app.js across the thresholds', () => {
  const appAgeBand = new Function('return (' + extractFn(appJs, 'function ageBand(f)') + ')')();
  const now = Date.now();
  const mk = (ageMs) => ({ capturedAt: new Date(now - ageMs).toISOString(), freshForMs: 300000, staleAfterMs: 600000 });
  for (const f of [null, { capturedAt: null }, mk(0), mk(300001), mk(600001), mk(60_000)]) {
    assert.equal(ageBand(f), appAgeBand(f), `ageBand diverged for ${JSON.stringify(f)}`);
  }
});

// ── diagnostic-copy parity (semantics, not HTML) ─────────────────────────────
// The plugin's diagLine mirrors limitsNoteHtml's reason mapping: each reason
// that app.js recognizes must produce a non-generic line, and the load-bearing
// remedy keywords (the env vars / CLI-session verbs the dashboard names) must
// survive into the badge copy.
test('parity: every diagnostic reason app.js handles is mapped (non-generic) in the plugin', () => {
  const GENERIC = 'Limit reading unavailable.';
  for (const reason of [
    'auto-refresh-failing', 'auto-refresh-disabled', 'stale-reading',
    'no-statusline-reading', 'codex-cmd-failed', 'no-reading',
  ]) {
    const line = diagLine({ reason });
    assert.ok(line && line !== GENERIC, `reason "${reason}" fell through to the generic fallback`);
  }
});

test('parity: the plugin diagnostic copy keeps the dashboard\'s remedy keywords', () => {
  // codex-cmd-failed names the same env var the dashboard names.
  assert.match(diagLine({ reason: 'codex-cmd-failed' }), /LLMDASH_CODEX_CMD/);
  assert.match(appJs, /LLMDASH_CODEX_CMD/);
  // auto-refresh-disabled names the same off-switch.
  assert.match(diagLine({ reason: 'auto-refresh-disabled' }), /LLMDASH_CLAUDE_AUTOREFRESH=0/);
  assert.match(appJs, /LLMDASH_CLAUDE_AUTOREFRESH=0/);
  // The Claude reasons point at a CLI session (the dashboard's remedy verb).
  assert.match(diagLine({ reason: 'stale-reading' }), /Claude Code CLI session/);
  assert.match(diagLine({ reason: 'no-statusline-reading' }), /Claude Code CLI session/);
});

test('parity: the plugin uses the SAME own-key hasOwnProperty guard app.js uses', () => {
  // Both map reason/cause enums via Object.prototype.hasOwnProperty.call — an
  // inherited-key ('__proto__'/'constructor') reason can't bypass the fallback.
  assert.match(pluginJs, /Object\.prototype\.hasOwnProperty\.call\(DIAG_LINES, d\.reason\)/);
  assert.match(appJs, /Object\.prototype\.hasOwnProperty\.call\(AUTOREFRESH_CAUSE_SENTENCES, d\.cause\)/);
});
