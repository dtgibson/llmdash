import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeBadge, emit, fmtDur, ageBand, sanitize, diagLine, statusClass, baseUrl,
  sanitizeHostPort, wrapMenuText,
} from '../scripts/menubar/llmdash.5s.js';

// ── fixture loader ──────────────────────────────────────────────────────────
// Rehydrates "@<ms>" timestamp placeholders to ISO strings relative to now, so
// freshness bands and reset countdowns are deterministic whenever the test runs
// (see tests/fixtures/menubar/README.md).
const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'menubar');
function rehydrate(v, now) {
  if (typeof v === 'string' && /^@-?\d+$/.test(v)) {
    return new Date(now + Number(v.slice(1))).toISOString();
  }
  if (Array.isArray(v)) return v.map((x) => rehydrate(x, now));
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = rehydrate(v[k], now);
    return out;
  }
  return v;
}
function loadFixture(name, now = Date.now()) {
  const raw = JSON.parse(fs.readFileSync(path.join(fixturesDir, `${name}.json`), 'utf8'));
  return rehydrate(raw, now);
}

// ─────────────────────────────────────────────────────────────────────────────
// fmtDur — countdown formatting (QA-10). Copied verbatim from public/app.js.
// ─────────────────────────────────────────────────────────────────────────────
test('fmtDur: null → "—", ≤0 → "now", d h / h m / m', () => {
  assert.equal(fmtDur(null), '—');
  assert.equal(fmtDur(undefined), '—');
  assert.equal(fmtDur(0), 'now');
  assert.equal(fmtDur(-5000), 'now');
  assert.equal(fmtDur(45 * 60000), '45m');
  assert.equal(fmtDur(90 * 60000), '1h 30m');
  assert.equal(fmtDur(36 * 3600000), '1d 12h');
});

// ─────────────────────────────────────────────────────────────────────────────
// ageBand — freshness band from SERVER-supplied thresholds (QA-08, FR-09).
// No hardcoded thresholds; null/Codex freshness → no band.
// ─────────────────────────────────────────────────────────────────────────────
test('ageBand: straddles freshForMs / staleAfterMs; null → no band', () => {
  const now = Date.now();
  const f = (ageMs) => ({ capturedAt: new Date(now - ageMs).toISOString(), freshForMs: 300000, staleAfterMs: 600000 });
  assert.equal(ageBand(f(60_000)), 'fresh');   // 1m
  assert.equal(ageBand(f(420_000)), 'aging');  // 7m (> 5m, < 10m)
  assert.equal(ageBand(f(1_800_000)), 'stale'); // 30m (> 10m)
  // Codex-shaped: null freshness, or a freshness with no capturedAt → no band.
  assert.equal(ageBand(null), null);
  assert.equal(ageBand({ capturedAt: null, freshForMs: 300000, staleAfterMs: 600000 }), null);
});

test('ageBand honors the SERVER thresholds, not hardcoded ones', () => {
  const now = Date.now();
  // A tiny freshForMs makes a 1-minute-old reading "aging" — proving the band
  // reads the payload's threshold rather than a baked-in 5m.
  const f = { capturedAt: new Date(now - 60_000).toISOString(), freshForMs: 10_000, staleAfterMs: 20_000 };
  assert.equal(ageBand(f), 'stale');
});

// ─────────────────────────────────────────────────────────────────────────────
// sanitize — the security seam (QA-23, NFR-04).
// ─────────────────────────────────────────────────────────────────────────────
test('sanitize: strips | \\n \\r to spaces (the menu-bar analogue of esc)', () => {
  assert.equal(sanitize('spawn codex ENOENT | rm -rf /'), 'spawn codex ENOENT   rm -rf /');
  assert.equal(sanitize('a\nb\r\nc'), 'a b  c');
  assert.equal(sanitize('plain text'), 'plain text');
});

test('wrapMenuText: wraps long menu text and long tokens to bounded rows', () => {
  const lines = wrapMenuText('one two three four five six', 13);
  assert.deepEqual(lines, ['one two three', 'four five six']);
  const tokenLines = wrapMenuText('abcdefghijklmno', 5);
  assert.deepEqual(tokenLines, ['abcde', 'fghij', 'klmno']);
  assert.ok([...lines, ...tokenLines].every((line) => line.length <= 13));
});

// ─────────────────────────────────────────────────────────────────────────────
// diagLine — reason → fixed line, own-key lookup only (QA-15, NFR-04).
// ─────────────────────────────────────────────────────────────────────────────
test('diagLine: each reason maps to its fixed honest line', () => {
  assert.match(diagLine({ reason: 'auto-refresh-failing' }), /^Auto-refresh is failing —/);
  assert.match(diagLine({ reason: 'auto-refresh-disabled' }), /^Auto-refresh is off \(LLMDASH_CLAUDE_AUTOREFRESH=0\)/);
  assert.match(diagLine({ reason: 'stale-reading' }), /^Stale reading —/);
  assert.match(diagLine({ reason: 'no-statusline-reading' }), /^No statusline reading yet —/);
  assert.match(diagLine({ reason: 'codex-cmd-failed' }), /^The codex command couldn’t be run —/);
  assert.equal(diagLine({ reason: 'no-reading' }), 'No Codex limit reading yet.');
  assert.equal(diagLine(null), null);
  assert.equal(diagLine({ reason: null }), null);
});

test('diagLine: unmapped code → generic fallback (never rendered raw)', () => {
  assert.equal(diagLine({ reason: 'some-brand-new-code' }), 'Limit reading unavailable.');
});

test('diagLine: own-key lookup — a __proto__/constructor reason can NOT bypass the fallback', () => {
  // A plain LINES[reason] would resolve 'constructor'/'__proto__' to inherited
  // Object members; hasOwnProperty guards against it. Both fall back generically.
  assert.equal(diagLine({ reason: 'constructor' }), 'Limit reading unavailable.');
  assert.equal(diagLine({ reason: '__proto__' }), 'Limit reading unavailable.');
  assert.equal(diagLine({ reason: 'hasOwnProperty' }), 'Limit reading unavailable.');
});

test('diagLine: free-form detail with a | is sanitized before display', () => {
  const line = diagLine({ reason: 'codex-cmd-failed', cmd: 'codex', detail: 'boom | rm -rf /' });
  assert.doesNotMatch(line, /\|/);          // no pipe survives
  assert.match(line, /boom {3}rm -rf \//);  // " | " → 3 spaces (the pipe neutralized)
});

// ─────────────────────────────────────────────────────────────────────────────
// computeBadge — per fixture (QA-05/06/07/08/09/16).
// ─────────────────────────────────────────────────────────────────────────────
test('computeBadge fresh: glyph = min remaining across all windows, correct cue + state', () => {
  const badge = computeBadge(loadFixture('state-fresh'));
  assert.equal(badge.state, 'fresh');
  // min(46, 61, 88, 72) = 46 → Claude 5-hour binds.
  assert.equal(badge.pct, 46);
  assert.equal(badge.cue, '◆'); // Claude is the binding tool (ratified ◆/▲ cue)
  assert.equal(badge.binding.toolLabel, 'Claude Code');
  assert.equal(badge.binding.windowLabel, '5-hour');
});

test('computeBadge aging: keeps the number, state=aging, binding tool cue', () => {
  const badge = computeBadge(loadFixture('state-aging'));
  assert.equal(badge.state, 'aging');
  // min(78, 66, 88, 72) = 66 → Claude Weekly binds; Claude reading is 7m old → aging.
  assert.equal(badge.pct, 66);
  assert.equal(badge.cue, '◆');
  assert.equal(badge.binding.windowLabel, 'Weekly');
});

test('computeBadge stale: number present, state=stale (FR-17 coexistence)', () => {
  const badge = computeBadge(loadFixture('state-stale'));
  assert.equal(badge.state, 'stale');
  // min(78, 66, 99, 99) = 66 → Claude Weekly binds; reading 30m old → stale.
  assert.equal(badge.pct, 66);
  assert.equal(badge.cue, '◆');
  // The stale reading still yields a number AND a diagnostic — never blanked.
  const claude = badge.toolViews.find((t) => t.source === 'claude-code');
  assert.equal(claude.band, 'stale');
  assert.match(claude.diag, /^Stale reading —/);
});

test('computeBadge maxed: 0% is a valid binding glyph; partial-null → "not available"', () => {
  const badge = computeBadge(loadFixture('state-maxed'));
  // Claude 5-hour is 0% remaining → binds at 0.
  assert.equal(badge.pct, 0);
  assert.equal(badge.cue, '◆');
  assert.equal(badge.binding.windowLabel, '5-hour');
  // The maxed row is flagged maxed; the null Codex weekly is a null row.
  const claude = badge.toolViews.find((t) => t.source === 'claude-code');
  const codex = badge.toolViews.find((t) => t.source === 'codex');
  assert.equal(claude.rows.find((r) => r.label === '5-hour').maxed, true);
  assert.equal(codex.rows.find((r) => r.label === 'Weekly').remaining, null);
});

test('computeBadge no-reading: all windows null on both tools → no-reading, pct null, no cue', () => {
  const badge = computeBadge(loadFixture('state-no-reading'));
  assert.equal(badge.state, 'no-reading');
  assert.equal(badge.pct, null);
  assert.equal(badge.cue, null);
  assert.equal(badge.binding, null);
  // Each tool still carries its diagnostic for the dropdown.
  assert.equal(badge.toolViews.length, 2);
  assert.ok(badge.toolViews.every((t) => t.diag));
});

test('computeBadge: a Codex-owned binding window (no freshness) reads fresh unless a sibling is degraded', () => {
  // Fresh fixture, but drop Claude to nulls so Codex (72) binds; Codex has no
  // freshness band → the glyph is fresh (no band treatment), FR-09.
  const now = Date.now();
  const st = loadFixture('state-fresh', now);
  st.tools[0].limits.five_hour = null;
  st.tools[0].limits.seven_day = null;
  st.tools[0].haveLimits = false;
  st.tools[0].freshness = { capturedAt: null, freshForMs: 300000, staleAfterMs: 600000 };
  const badge = computeBadge(st);
  assert.equal(badge.cue, '▲'); // Codex binds (ratified ◆/▲ cue)
  assert.equal(badge.pct, 72);
  assert.equal(badge.state, 'fresh');
});

// ─────────────────────────────────────────────────────────────────────────────
// emit — exact SwiftBar/xbar grammar + the two never-do rules (QA-09/11/12/22).
// ─────────────────────────────────────────────────────────────────────────────
function titleLine(out) { return out.split('\n')[0]; }
function afterSep(out) { const i = out.indexOf('\n---\n'); return i < 0 ? '' : out.slice(i); }

test('emit fresh: title has the cue + %, colored by status; grammar valid', () => {
  const out = emit(computeBadge(loadFixture('state-fresh')));
  const title = titleLine(out);
  assert.match(title, /^▪ ◆ 46% \| color=#[0-9a-f]{6}$/);
  // warn color (46% → 20–49 → warn) lifted for the dark bar.
  assert.match(title, /color=#f0a94b$/);
  assert.match(out, /\n---\n/);
  assert.match(out, /Open dashboard \| href=http:\/\/127\.0\.0\.1:8787\/$/m);
  assert.match(out, /^Refresh \| refresh=true$/m);
});

test('emit aging: number KEEPS its value with a trailing · and dim color', () => {
  const out = emit(computeBadge(loadFixture('state-aging')));
  const title = titleLine(out);
  assert.match(title, /^▪ ◆ 66%· \| color=#a0a0a0$/);
  // The tool header carries the (aging) tag.
  assert.match(out, /^Claude Code {2}\(aging\) \|/m);
});

test('emit stale: number present, amber, trailing ⚠; diagnostics block present', () => {
  const out = emit(computeBadge(loadFixture('state-stale')));
  const title = titleLine(out);
  assert.match(title, /^▪ ◆ 66% ⚠ \| color=#f0a94b$/);
  assert.match(out, /^Claude Code {2}\(stale\) \|/m);
  assert.match(out, /^Stale reading — .* \| size=13 color=#f0a94b$/m);
  assert.match(out, /^  session to refresh\. \| size=13 color=#f0a94b$/m);
});

test('emit maxed: a maxed window reads "limit reached", never 0%; null → "not available"', () => {
  const out = emit(computeBadge(loadFixture('state-maxed')));
  assert.match(out, /^5-hour: {2}limit reached · resets .+ \| font=Menlo$/m);
  assert.match(out, /^Weekly: {2}not available \| font=Menlo$/m);
  // The glyph is a valid 0% binding.
  assert.match(titleLine(out), /^▪ ◆ 0% \| /);
});

test('emit no-reading: ▪ — (a DASH, NOT a number); dropdown explains per tool', () => {
  const out = emit(computeBadge(loadFixture('state-no-reading')));
  const title = titleLine(out);
  assert.equal(title, '▪ — | color=#9b9ea6');
  // NEVER a number in the no-reading glyph (the color param is not the glyph).
  const glyphText = title.split('|')[0];
  assert.doesNotMatch(glyphText, /\d/);
  // Both windows of both tools read "not available".
  const naCount = (out.match(/not available/g) || []).length;
  assert.equal(naCount, 4);
  // Per-tool diagnostics appear.
  assert.match(out, /No statusline reading yet —/);
  assert.match(out, /The codex command couldn’t be run —/);
});

test('emit offline: wordmark + ⚠, NEVER a number; still offers actions', () => {
  const out = emit(null, { offline: true });
  const title = titleLine(out);
  assert.equal(title, '▪ llmdash ⚠ | color=#8b8b8b');
  // The glyph text (before the SwiftBar param `|`) carries no reading number.
  const glyphText = title.split('|')[0];
  assert.doesNotMatch(glyphText, /\d/);       // no number in the visible glyph
  assert.doesNotMatch(out, /\d+%/);           // and no percentage anywhere in the output
  assert.match(out, /Dashboard offline — no server on 127\.0\.0\.1:8787/);
  assert.match(out, /Open dashboard \| href=http:\/\/127\.0\.0\.1:8787\//);
});

test('emit no-reading: the | injection in Codex detail is neutralized, opens no extra param', () => {
  const out = emit(computeBadge(loadFixture('state-no-reading')));
  // The wrapped diagnostic lines carry the sanitized detail. The ONLY | on each
  // diagnostic row is the SwiftBar param delimiter; the injected | is gone.
  const diagLines = out.split('\n').filter((l) =>
    l.includes('codex command') || l.includes('spawn codex') || l.includes('rm -rf'));
  assert.ok(diagLines.length >= 2);
  for (const line of diagLines) assert.equal((line.match(/\|/g) || []).length, 1);
  assert.match(diagLines.join(' '), /spawn codex ENOENT\s+rm -rf \//);
});

// ─────────────────────────────────────────────────────────────────────────────
// Full dropdown breakdown (QA-11): all four tool×window rows always present.
// ─────────────────────────────────────────────────────────────────────────────
test('emit: the dropdown lists all four tool×window rows', () => {
  const out = emit(computeBadge(loadFixture('state-fresh')));
  assert.match(out, /^Claude Code \|/m);
  assert.match(out, /^Codex \|/m);
  // two 5-hour rows and two Weekly rows
  assert.equal((out.match(/^5-hour: /gm) || []).length, 2);
  assert.equal((out.match(/^Weekly: /gm) || []).length, 2);
});

// ─────────────────────────────────────────────────────────────────────────────
// statusClass — verbatim thresholds from public/app.js.
// ─────────────────────────────────────────────────────────────────────────────
test('statusClass: ≥50 good, 20–49 warn, <20 crit', () => {
  assert.equal(statusClass(50), 'good');
  assert.equal(statusClass(49), 'warn');
  assert.equal(statusClass(20), 'warn');
  assert.equal(statusClass(19), 'crit');
  assert.equal(statusClass(0), 'crit');
});

// ─────────────────────────────────────────────────────────────────────────────
// baseUrl — used by BOTH the fetch target and the Open-dashboard href.
// ─────────────────────────────────────────────────────────────────────────────
test('baseUrl builds http://host:port/', () => {
  assert.equal(baseUrl('127.0.0.1', '8787'), 'http://127.0.0.1:8787/');
  assert.equal(baseUrl('100.64.0.7', '9000'), 'http://100.64.0.7:9000/');
});

// ─────────────────────────────────────────────────────────────────────────────
// Security seam: host/port are operator env (LLMDASH_BADGE_HOST/PORT) and flow
// verbatim into the SwiftBar `Open dashboard | href=…` line. A SwiftBar param
// list is SPACE-separated, so a host carrying a raw space could smuggle a second
// param — a clickable bash=/shell= action. sanitizeHostPort strips whitespace
// and `|` entirely (a real host/IP/port never contains them), so a hostile value
// collapses to a single inert href token — never a new param, never a new line.
// Sibling of the detail-sanitize seam above (QA-23); defense-in-depth for the
// deferred host-list.
test('sanitizeHostPort: strips whitespace and | so no host value can inject a SwiftBar param', () => {
  assert.equal(sanitizeHostPort('127.0.0.1'), '127.0.0.1');            // legit IP untouched
  assert.equal(sanitizeHostPort('my-mac.tailnet.ts.net'), 'my-mac.tailnet.ts.net'); // legit host untouched
  assert.equal(sanitizeHostPort('8787'), '8787');                     // legit port untouched
  assert.equal(sanitizeHostPort('x bash=/bin/sh'), 'xbash=/bin/sh');  // space removed → no 2nd param
  assert.equal(sanitizeHostPort('a\tb\nc\r'), 'abc');                 // all whitespace stripped
  assert.equal(sanitizeHostPort('a|bash=/bin/sh'), 'abash=/bin/sh');  // pipe removed
});

test('emit: a hostile LLMDASH_BADGE_HOST cannot inject a bash= action or an extra menu line', () => {
  const evil = '127.0.0.1/ bash=/bin/sh param1=-c param2="rm -rf ~" terminal=false';
  const out = emit(null, { host: evil, port: '8787', offline: true });
  const lines = out.split('\n');
  const openLine = lines.find((l) => l.startsWith('Open dashboard'));
  const afterHref = openLine.split('href=')[1] || '';
  // The href value is a single inert token: no space-separated param can follow
  // it, so `bash=…` stays swallowed inside the (garbage) URL rather than parsing
  // as a clickable SwiftBar action. A space then any `key=` would be the smuggle.
  assert.doesNotMatch(afterHref, /\s\S*=/);
  // The offline note can wrap, but every wrapped row is inert display text: no
  // injected SwiftBar action param and no oversized visible row.
  const openIdx = lines.findIndex((l) => l.startsWith('Open dashboard'));
  const noteLines = lines.slice(2, openIdx);
  assert.ok(noteLines.length >= 2);
  assert.ok(noteLines.every((l) => l.split('|')[0].length <= 74));
  for (const line of noteLines) {
    const params = line.split('|')[1] || '';
    assert.doesNotMatch(params, /\bbash=/);
  }
});
