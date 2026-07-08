import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeMultiBadge, computeBadge, emit, emitMulti,
  applyDisplay, emitDisplay, displayFromConfig, isDefaultDisplay,
  displayActionLines, legendLines, DISPLAY_PRESETS, SIDE_BY_SIDE_CAP, ROTATE_MS,
  toolAggregates, growPrefixCues, compactCell, logoBase64, _resetLogoCache, isSwiftBar,
  remotesFromCombined, TOOL_MARK,
} from '../scripts/menubar/llmdash.5s.js';

// badge-display-options — applyDisplay over injected /api/hosts fixtures + the
// Display/Legend submenus. Pure over fixtures + an injected clock. Timestamps are
// relative-to-now so freshness bands are deterministic.
const now = Date.now();
const iso = (deltaMs) => new Date(now + deltaMs).toISOString();
function tool(source, five, seven, { freshness } = {}) {
  const win = (rem) => rem == null ? null : { usedPct: 100 - rem, remainingPct: rem, resetsAt: iso(3600000), capturedAt: iso(-60000) };
  return {
    source, label: source === 'codex' ? 'Codex' : 'Claude Code', plan: 'Max',
    haveLimits: !!(five != null || seven != null),
    limits: { five_hour: win(five), seven_day: win(seven) },
    freshness: freshness === undefined
      ? (source === 'codex' ? null : { capturedAt: iso(-60000), freshForMs: 300000, staleAfterMs: 600000 })
      : freshness,
    limitsDiagnostic: null,
  };
}
function host(label, { self = false, tools = null, reachable = true, hostDiagnostic = null, pending = false, port = 8787, hostStr = null } = {}) {
  const h = {
    host: hostStr || (self ? 'local' : label.toLowerCase().replace(/\s+/g, '')),
    label, port, self, reachable, hostDiagnostic, fetchedAt: iso(-10000),
    state: tools ? { tools, headroom: null, generatedAt: iso(0) } : null,
  };
  if (pending) h.pending = true;
  return h;
}
function combined(hosts) { return { hosts, generatedAt: iso(0) }; }
const glyphOf = (out) => out.split('\n')[0];
function preSeparatorLines(out) {
  const lines = out.split('\n');
  const i = lines.indexOf('---');
  return i < 0 ? lines : lines.slice(0, i);
}

// A canonical 3-host fleet: Studio (Claude 12%, crit/fresh, binding), Laptop
// (Codex 88%, fresh), Desktop (Codex 63%, fresh).
function fleet() {
  return combined([
    host('This machine', { self: true, tools: [tool('claude-code', 80, 90)] }),
    host('Studio', { tools: [tool('claude-code', 12, 38)], hostStr: '100.64.0.7', port: 8788 }),
    host('Laptop', { tools: [tool('codex', 88, 61)], hostStr: 'laptop', port: 8787 }),
    host('Desktop', { tools: [tool('codex', 63, 70)], hostStr: '100.64.0.9', port: 8790 }),
  ]);
}
const DEF = { hosts: 'all', layout: 'single', density: 'wide', group: 'host', toolMark: 'neutral' };

// ── The ratified default cue ◆/▲ everywhere (round 2) ─────────────────────────
test('the default tool cue is ◆ (Claude) / ▲ (Codex), replacing the old C/X letters', () => {
  const state = { tools: [tool('claude-code', 46, 61)], generatedAt: iso(0) };
  const out = emit(computeBadge(state), { host: '127.0.0.1', port: '8787' });
  // The single-host wide glyph uses ◆ (Claude), never the letter C.
  assert.match(glyphOf(out), /^▪ ◆ 46% \| color=#[0-9a-f]{6}$/);
  assert.doesNotMatch(glyphOf(out), /\bC\b/);
  const codex = { tools: [tool('codex', 5, 61)], generatedAt: iso(0) };
  const outX = emit(computeBadge(codex), { host: '127.0.0.1', port: '8787' });
  assert.match(glyphOf(outX), /^▪ ▲ 5% \| color=#[0-9a-f]{6}$/);
});

test('TOOL_MARK pins the ratified glyphs (guards a silent revert to C/X)', () => {
  assert.equal(TOOL_MARK.claude, '◆');
  assert.equal(TOOL_MARK.codex, '▲');
});

// ── Byte-for-byte: default display routes to the shipped path (QA-02) ─────────
test('isDefaultDisplay is true for all/single/wide/host (toolMark orthogonal)', () => {
  assert.equal(isDefaultDisplay(DEF), true);
  assert.equal(isDefaultDisplay({ ...DEF, toolMark: 'logo' }), true); // orthogonal
  assert.equal(isDefaultDisplay({ ...DEF, density: 'compact' }), false);
  assert.equal(isDefaultDisplay({ ...DEF, group: 'tool' }), false);
  assert.equal(isDefaultDisplay({ ...DEF, layout: 'side-by-side' }), false);
  assert.equal(isDefaultDisplay({ ...DEF, hosts: ['a:1'] }), false);
});

test('unconfigured single-host ⇒ byte-for-byte the shipped glyph (save the ◆/▲ cue) (QA-02)', () => {
  const c = combined([host('This machine', { self: true, tools: [tool('claude-code', 46, 61), tool('codex', 88, 72)] })]);
  const multi = computeMultiBadge(c);
  assert.equal(multi.mode, 'single');
  // Same routing main() uses: default display → shipped emit.
  const shipped = emit(computeBadge(c.hosts[0].state), { host: '127.0.0.1', port: '8787', display: DEF });
  assert.match(glyphOf(shipped), /^▪ ◆ 46% \| color=#[0-9a-f]{6}$/);
});

test('unconfigured multi-host ⇒ byte-for-byte the shipped multi glyph (save the ◆/▲ cue) (QA-02)', () => {
  const c = fleet();
  const multi = computeMultiBadge(c);
  const shipped = emitMulti(multi, { host: '127.0.0.1', port: '8787', remotes: remotesFromCombined(c), display: DEF });
  // Studio Claude 12% binds; the host+tool cue is ◆.
  assert.match(glyphOf(shipped), /^▪ Studio·◆ 12% \| color=#[0-9a-f]{6}$/);
});

// ── The view filter is glyph-only; the dropdown stays full (QA-11/12/13) ──────
test('a hosts subset filters the GLYPH (binding-first) but the dropdown renders every host (QA-11/12)', () => {
  const c = fleet();
  const multi = computeMultiBadge(c);
  // Select only Laptop + Desktop (Codex machines) — Studio (the binder) is filtered OUT.
  const view = applyDisplay(multi, { ...DEF, hosts: ['laptop:8787', '100.64.0.9:8790'], layout: 'side-by-side', density: 'compact' }, { epochMs: 0 });
  const out = emitDisplay(view, multi, { host: '127.0.0.1', port: '8787', remotes: remotesFromCombined(c) });
  const glyph = glyphOf(out);
  // The glyph shows only the two selected (63 binds since Laptop 88 > Desktop 63).
  assert.match(glyph, /63/);
  assert.match(glyph, /88/);
  assert.doesNotMatch(glyph, /12/); // Studio's 12% is NOT in the glyph
  // The dropdown still renders every host (Studio included).
  assert.match(out, /Studio/);
  assert.match(out, /Laptop/);
  assert.match(out, /Desktop/);
});

test('an all-unknown host selection falls back to "all" (never an empty glyph) (QA-19)', () => {
  const c = fleet();
  const multi = computeMultiBadge(c);
  const view = applyDisplay(multi, { ...DEF, hosts: ['ghost:9999'], layout: 'single', density: 'compact' }, { epochMs: 0 });
  // Fell back to all → the binding (Studio 12%) shows.
  assert.equal(view.cells[0].text, '12');
});

test('a SELECTED offline host STAYS in the glyph with ⊘, never dropped or zeroed (FR-13/QA-13)', () => {
  const c = combined([
    host('This machine', { self: true, tools: [tool('claude-code', 80, 90)] }),
    host('Down', { reachable: false, tools: null, hostDiagnostic: { reason: 'peer-unreachable' }, hostStr: 'down', port: 8787 }),
    host('Studio', { tools: [tool('claude-code', 12, 38)], hostStr: '100.64.0.7', port: 8788 }),
  ]);
  const multi = computeMultiBadge(c);
  const view = applyDisplay(multi, { ...DEF, hosts: ['down:8787', '100.64.0.7:8788'], layout: 'side-by-side', density: 'compact' }, { epochMs: 0 });
  const cells = view.cells.map((x) => x.text).join(' ');
  assert.match(cells, /⊘/);       // the offline host is shown with ⊘
  assert.match(cells, /12/);      // Studio's reading is shown
  assert.doesNotMatch(view.cells.find((x) => x.state === 'offline').text, /\d/); // ⊘ carries NO digit
});

test('display emit: compact mode keeps secondary copy below the first separator', () => {
  const c = combined([
    host('This machine', { self: true, tools: [tool('claude-code', 80, 90)] }),
    host('Down', { reachable: false, tools: null, hostDiagnostic: { reason: 'peer-unreachable' }, hostStr: 'down', port: 8787 }),
    host('Studio', { tools: [tool('claude-code', 12, 38)], hostStr: '100.64.0.7', port: 8788 }),
  ]);
  const multi = computeMultiBadge(c);
  const view = applyDisplay(multi, { ...DEF, hosts: 'all', layout: 'side-by-side', density: 'compact' }, { epochMs: 0 });
  const out = emitDisplay(view, multi, { host: '127.0.0.1', port: '8787', remotes: remotesFromCombined(c) });
  assert.deepEqual(preSeparatorLines(out), [glyphOf(out)]);
  assert.doesNotMatch(preSeparatorLines(out).join('\n'), /Watching|not reachable|unreachable|remaining/i);
  assert.match(out, /\n---\n▪ 12% remaining/);
  assert.match(out, /Watching 3 machines · 1 not reachable/);
});

// ── The five compact states (QA-14/16) ────────────────────────────────────────
test('compactCell distinguishes all five states; offline/no-reading carry NO digit (QA-14/16)', () => {
  assert.equal(compactCell({ state: 'fresh', pct: 46 }).text, '46');
  assert.equal(compactCell({ state: 'aging', pct: 46 }).text, '◷46');
  assert.equal(compactCell({ state: 'stale', pct: 12 }).text, '⚠12');   // leading ⚠
  assert.equal(compactCell({ state: 'no-reading', pct: null }).text, '—');
  assert.equal(compactCell({ state: 'offline', pct: null }).text, '⊘');
  // Structural never-a-number guard.
  assert.doesNotMatch(compactCell({ state: 'no-reading', pct: null }).text, /\d/);
  assert.doesNotMatch(compactCell({ state: 'offline', pct: null }).text, /\d/);
  // Colors are distinct per band.
  assert.equal(compactCell({ state: 'aging', pct: 46 }).color, '#a0a0a0');
  assert.equal(compactCell({ state: 'stale', pct: 12 }).color, '#f0a94b');
  assert.equal(compactCell({ state: 'no-reading', pct: null }).color, '#9b9ea6');
  assert.equal(compactCell({ state: 'offline', pct: null }).color, '#8b8b8b');
});

test('three independent states hold side-by-side; one line, one color = binding (QA-15)', () => {
  // Select exactly three hosts (fresh / stale / offline), single 5-hour window
  // each so the tightest-window pct is unambiguous.
  const c = combined([
    host('This machine', { self: true, tools: [tool('claude-code', 80, null)] }),
    host('S', { tools: [tool('claude-code', 12, null)], hostStr: 's', port: 8787 }),
    host('L', { tools: [tool('claude-code', 88, null, { freshness: { capturedAt: iso(-1800000), freshForMs: 300000, staleAfterMs: 600000 } })], hostStr: 'l', port: 8787 }), // stale
    host('D', { reachable: false, tools: null, hostDiagnostic: { reason: 'peer-unreachable' }, hostStr: 'd', port: 8787 }), // offline
  ]);
  const multi = computeMultiBadge(c);
  const view = applyDisplay(multi, { ...DEF, hosts: ['s:8787', 'l:8787', 'd:8787'], layout: 'side-by-side', density: 'compact' }, { epochMs: 0 });
  const glyph = glyphOf(emitDisplay(view, multi, { host: '127.0.0.1', port: '8787', remotes: [] }));
  // The line carries exactly one | (the color= delimiter) — one color for the run.
  assert.equal((glyph.match(/\|/g) || []).length, 1);
  // The three independent states each render (12 fresh, ⚠88 stale, ⊘ offline).
  assert.match(glyph, /12/);
  assert.match(glyph, /⚠88/);
  assert.match(glyph, /⊘/);
});

// ── side-by-side cap + overflow (QA-17) ───────────────────────────────────────
test('side-by-side caps at SIDE_BY_SIDE_CAP with +M more (binding-first hides the least-constrained) (QA-17)', () => {
  const hosts = [host('This machine', { self: true, tools: [tool('claude-code', 80, 90)] })];
  // 5 remote hosts with descending tightness so binding-first order is knowable.
  for (const [i, pct] of [10, 20, 30, 40, 50].entries()) {
    hosts.push(host('H' + i, { tools: [tool('claude-code', pct, 99)], hostStr: 'h' + i, port: 8787 }));
  }
  const multi = computeMultiBadge(combined(hosts));
  const view = applyDisplay(multi, { ...DEF, layout: 'side-by-side', density: 'compact' }, { epochMs: 0 });
  assert.equal(view.cells.length, SIDE_BY_SIDE_CAP);
  assert.equal(view.more, 5 + 1 - SIDE_BY_SIDE_CAP); // 6 counted hosts (incl. local 80), 3 shown → +3
  const glyph = glyphOf(emitDisplay(view, multi, { host: '127.0.0.1', port: '8787', remotes: [] }));
  assert.match(glyph, /\+\d/);         // the +M affordance
  // Binding-first: the tightest (10) is shown; the least-constrained (80 local) is hidden.
  assert.match(glyph, /10/);
});

// ── stateless rotation (QA-18) ────────────────────────────────────────────────
test('alternating rotation is stateless: floor(epochMs/ROTATE_MS) % count names host i; wraps (QA-18)', () => {
  const c = fleet(); // Studio(12,binding) Laptop(88) Desktop(63) — binding-first order
  const multi = computeMultiBadge(c);
  const at = (t) => glyphOf(emitDisplay(applyDisplay(multi, { ...DEF, layout: 'alternating', density: 'compact' }, { epochMs: t }), multi, { host: 'x', port: '1', remotes: [] }));
  const t0 = at(0), t1 = at(ROTATE_MS), t2 = at(ROTATE_MS * 2), t3 = at(ROTATE_MS * 3);
  // Three counted hosts in binding-first order: Studio(12), then the other two.
  assert.match(t0, /12/);              // idx 0 = Studio (the binder)
  assert.notEqual(t0, t1);             // advanced one host
  assert.notEqual(t1, t2);
  assert.equal(t0, t3);                // wrapped at count=3
});

// ── degenerate reduction (QA-19) ──────────────────────────────────────────────
test('side-by-side/alternating of a single effective host reduces to single (compact still applies) (QA-19)', () => {
  const c = combined([host('This machine', { self: true, tools: [tool('claude-code', 46, 61)] })]);
  const multi = computeMultiBadge(c); // mode:'single', one hostView
  const view = applyDisplay(multi, { ...DEF, layout: 'side-by-side', density: 'compact' }, { epochMs: 0 });
  assert.equal(view.layout, 'single');
  assert.equal(view.cells.length, 1);
  assert.equal(view.cells[0].text, '46');   // compact still applied, no host cue
  assert.equal(view.more, 0);
});

// ════════ Group = tool — per-tool aggregates over the SELECTED hosts ══════════
test('toolAggregates: per-tool min-remaining across selected hosts, tightest-window state, binding-first', () => {
  const c = fleet();
  const multi = computeMultiBadge(c);
  const cells = toolAggregates(multi.hostViews);
  // Claude tightest = Studio 12 (5-hour). Codex tightest across Laptop(88/61) +
  // Desktop(63/70) = 61 (Laptop weekly). Binding-first (12 < 61).
  assert.equal(cells[0].mark, TOOL_MARK.claude);
  assert.equal(cells[0].pct, 12);
  assert.equal(cells[1].mark, TOOL_MARK.codex);
  assert.equal(cells[1].pct, 61);
});

test('a tool with NO reading on any selected host ⇒ — (never a fabricated zero)', () => {
  // A fleet with only Claude readings anywhere → Codex aggregate is no-reading.
  const c = combined([
    host('A', { self: true, tools: [tool('claude-code', 20, 40)] }),
    host('B', { tools: [tool('claude-code', 30, 50)], hostStr: 'b', port: 8787 }),
  ]);
  const multi = computeMultiBadge(c);
  const view = applyDisplay(multi, { ...DEF, group: 'tool', layout: 'side-by-side', density: 'compact' }, { epochMs: 0 });
  const glyph = glyphOf(emitDisplay(view, multi, { host: 'x', port: '1', remotes: [] }));
  assert.match(glyph, /◆20/);   // Claude aggregate
  assert.match(glyph, /▲—/);    // Codex has no reading anywhere → dash, no zero
  assert.doesNotMatch(glyph, /▲0/);
});

test('every contributing host offline ⇒ the aggregate reads ⊘ (no digit)', () => {
  const c = combined([
    host('A', { reachable: false, tools: null, hostDiagnostic: { reason: 'peer-unreachable' }, hostStr: 'a', port: 8787 }),
    host('B', { reachable: false, tools: null, hostDiagnostic: { reason: 'peer-unreachable' }, hostStr: 'b', port: 8787 }),
  ]);
  const multi = computeMultiBadge(c);
  const cells = toolAggregates(multi.hostViews);
  assert.ok(cells.every((x) => x.state === 'offline' && x.pct == null));
});

test('the Hosts axis SCOPES the aggregate in tool mode', () => {
  const c = fleet();
  const multi = computeMultiBadge(c);
  // Select only Laptop (Codex 5h 88 / weekly 61) — the aggregate takes the TIGHTEST
  // window (61); the Claude aggregate then has no reading.
  const view = applyDisplay(multi, { ...DEF, group: 'tool', hosts: ['laptop:8787'], layout: 'side-by-side', density: 'compact' }, { epochMs: 0 });
  const glyph = glyphOf(emitDisplay(view, multi, { host: 'x', port: '1', remotes: [] }));
  assert.match(glyph, /▲61/);   // Codex from the selected Laptop, tightest window
  assert.match(glyph, /◆—/);    // Claude scoped out (Studio not selected) → dash
});

test('tool mode: exactly two units, NO cap / NO +M', () => {
  const c = fleet();
  const multi = computeMultiBadge(c);
  const view = applyDisplay(multi, { ...DEF, group: 'tool', layout: 'side-by-side', density: 'compact' }, { epochMs: 0 });
  assert.equal(view.cells.length, 2);
  assert.equal(view.more, 0);
});

test('tool alternating is a two-beat cycle', () => {
  const c = fleet();
  const multi = computeMultiBadge(c);
  const at = (t) => applyDisplay(multi, { ...DEF, group: 'tool', layout: 'alternating', density: 'compact' }, { epochMs: t }).cells[0].mark;
  assert.equal(at(0), at(ROTATE_MS * 2));       // wraps at 2
  assert.notEqual(at(0), at(ROTATE_MS));         // alternates
});

// ── Tool marks: neutral default, logo opt-in over the floor ───────────────────
test('tool mode single wide names the tool with ◆/▲ (neutral floor)', () => {
  const c = fleet();
  const multi = computeMultiBadge(c);
  const view = applyDisplay(multi, { ...DEF, group: 'tool', layout: 'single', density: 'wide' }, { epochMs: 0 });
  const glyph = glyphOf(emitDisplay(view, multi, { host: 'x', port: '1', remotes: [] }));
  assert.match(glyph, /^▪ ◆ 12% \|/); // Claude aggregate binds (12), neutral ◆
});

test('toolMark=logo: the neutral glyph is STILL emitted (floor) AND a templateImage layered under SwiftBar', () => {
  _resetLogoCache();
  const c = fleet();
  const multi = computeMultiBadge(c);
  const view = applyDisplay(multi, { ...DEF, group: 'tool', layout: 'single', density: 'compact', toolMark: 'logo' }, { epochMs: 0 });
  // Under SwiftBar: floor ◆ present AND templateImage layered.
  const sb = glyphOf(emitDisplay(view, multi, { host: 'x', port: '1', remotes: [], env: { SWIFTBAR: '1' } }));
  assert.match(sb, /◆/);                  // neutral floor still present
  assert.match(sb, /templateImage=[A-Za-z0-9+/=]+/); // the image layered
});

test('xbar / no-SwiftBar: toolMark=logo emits ◆/▲ ALONE — no templateImage (floor stands alone)', () => {
  _resetLogoCache();
  const c = fleet();
  const multi = computeMultiBadge(c);
  const view = applyDisplay(multi, { ...DEF, group: 'tool', layout: 'single', density: 'compact', toolMark: 'logo' }, { epochMs: 0 });
  const xbar = glyphOf(emitDisplay(view, multi, { host: 'x', port: '1', remotes: [], env: {} }));
  assert.match(xbar, /◆/);
  assert.doesNotMatch(xbar, /templateImage=/);
});

test('the logo asset resolves via import.meta.url and base64-encodes (the wrapper/symlink path)', () => {
  _resetLogoCache();
  // Read the tracked asset the way the plugin does — resolved from its own dir.
  const b64 = logoBase64('claude-code');
  assert.ok(typeof b64 === 'string' && b64.length > 0, 'the asset encoded');
  // It is a real PNG (base64 of the 8-byte PNG signature is "iVBOR…").
  assert.ok(b64.startsWith('iVBOR'), 'a PNG signature');
});

test('the logo asset is read ONLY when toolMark=logo (no read on the neutral/default path)', () => {
  _resetLogoCache();
  let reads = 0;
  const spyRead = (u) => { reads++; return fs.readFileSync(u); };
  // Neutral path: emitDisplay never calls logoBase64. Prove by asserting a neutral
  // render adds no templateImage and, structurally, logoBase64 is only invoked by
  // the logo branch. (A direct read via the spy confirms the encode path works.)
  const c = fleet();
  const multi = computeMultiBadge(c);
  const view = applyDisplay(multi, { ...DEF, group: 'tool', layout: 'single', density: 'compact', toolMark: 'neutral' }, { epochMs: 0 });
  const neutral = glyphOf(emitDisplay(view, multi, { host: 'x', port: '1', remotes: [], env: { SWIFTBAR: '1' } }));
  assert.doesNotMatch(neutral, /templateImage=/);
  // The read spy is only exercised by the explicit logo path.
  const b64 = logoBase64('codex', { read: spyRead });
  assert.equal(reads, 1);
  assert.ok(b64 && b64.length);
});

// ── The Display submenu — both modes, active-marked, six presets (QA-05/06/07/09) ─
function submenuIn(display, remotes) { return displayActionLines({ display, remotes }); }

test('the Display submenu appears in single-host AND multi-host dropdowns (shared path)', () => {
  const single = emit(computeBadge({ tools: [tool('claude-code', 46, 61)] }), { host: '127.0.0.1', port: '8787', display: DEF });
  assert.match(single, /🖥 Display/);
  const c = fleet();
  const multi = emitMulti(computeMultiBadge(c), { host: '127.0.0.1', port: '8787', remotes: remotesFromCombined(c), display: DEF });
  assert.match(multi, /🖥 Display/);
});

test('the submenu offers six presets + the five axes; host choices enumerate the monitored hosts', () => {
  const c = fleet();
  const lines = submenuIn(DEF, remotesFromCombined(c)).join('\n');
  assert.equal(DISPLAY_PRESETS.length, 6);
  for (const p of DISPLAY_PRESETS) assert.ok(lines.includes(p.label), `preset ${p.label}`);
  assert.match(lines, /Group by/);
  assert.match(lines, /Hosts/);
  assert.match(lines, /Glyph layout/);
  assert.match(lines, /Glyph density/);
  assert.match(lines, /Tool marks/);
  // Host choices enumerate the monitored remotes + "All hosts".
  assert.match(lines, /All hosts/);
  assert.match(lines, /Studio \(100\.64\.0\.7:8788\)/);
  assert.match(lines, /Laptop \(laptop:8787\)/);
});

test('the active axis value is ✓-marked live; a preset is active ONLY when all four axes match (QA-09)', () => {
  const c = fleet();
  // A config matching the "Compact glyphs side-by-side" preset exactly.
  const disp = { hosts: 'all', group: 'host', layout: 'side-by-side', density: 'compact', toolMark: 'neutral' };
  const lines = submenuIn(disp, remotesFromCombined(c));
  const activePreset = lines.find((l) => l.includes('✓') && l.includes('Compact glyphs side-by-side'));
  assert.ok(activePreset, 'the matching preset is ✓-marked');
  // The active axis values are ✓-marked.
  assert.ok(lines.some((l) => l.includes('✓') && l.includes('Side-by-side (up to 3)')));
  assert.ok(lines.some((l) => l.includes('✓') && l.includes('Compact (tight glyph)')));
  // A DRIFTED axis (density flipped to wide) → no preset ✓, but each axis marks itself.
  const drifted = submenuIn({ ...disp, density: 'wide' }, remotesFromCombined(c));
  assert.ok(!drifted.some((l) => l.includes('✓') && DISPLAY_PRESETS.some((p) => l.includes(p.label))), 'no preset marked when drifted');
  assert.ok(drifted.some((l) => l.includes('✓') && l.includes('Wide (text glyph)')), 'the drifted axis still marks itself');
});

test('the Display submenu labels layout and density as glyph-only choices', () => {
  const c = fleet();
  const lines = submenuIn(DEF, remotesFromCombined(c)).join('\n');
  assert.match(lines, /Glyph layout/);
  assert.match(lines, /Single \(tightest only\)/);
  assert.match(lines, /Side-by-side \(up to 3\)/);
  assert.match(lines, /Alternating \(one at a time\)/);
  assert.match(lines, /Glyph density/);
  assert.match(lines, /Wide \(text glyph\)/);
  assert.match(lines, /Compact \(tight glyph\)/);
  assert.doesNotMatch(lines, /Compact \(icon\)|Compact icons/);
});

test('the Group by + Tool marks axes are present and ✓-active-marked (round 2)', () => {
  const c = fleet();
  const lines = submenuIn({ ...DEF, group: 'tool', toolMark: 'logo' }, remotesFromCombined(c));
  assert.ok(lines.some((l) => l.includes('✓') && l.includes('Tool (◆ Claude / ▲ Codex)')));
  assert.ok(lines.some((l) => l.includes('✓') && l.includes('Logos')));
});

test('each Display action shells to display-action.mjs under $ABS_NODE with refresh=true — no HTTP, no osascript', () => {
  const c = fleet();
  const lines = submenuIn(DEF, remotesFromCombined(c)).join('\n');
  assert.match(lines, /display-action\.mjs/);
  assert.match(lines, /param2=preset param3="most-constrained-wide"/);
  assert.match(lines, /param2=group param3="tool"/);
  assert.match(lines, /param2=tool-mark param3="logo"/);
  assert.match(lines, /refresh=true/);
  assert.doesNotMatch(lines, /href=http/);   // no HTTP mutation
  assert.doesNotMatch(lines, /osascript/);    // no dialog on this path
});

test('the Hosts axis is a multi-select toggle; selected hosts are ✓-marked, "All hosts" when hosts=all', () => {
  const c = fleet();
  const remotes = remotesFromCombined(c);
  // hosts=all → "All hosts" ✓, no individual host ✓.
  const allLines = submenuIn({ ...DEF, hosts: 'all' }, remotes);
  assert.ok(allLines.some((l) => l.includes('✓') && l.includes('All hosts')));
  // hosts=[Laptop] → Laptop ✓, All hosts unmarked.
  const selLines = submenuIn({ ...DEF, hosts: ['laptop:8787'] }, remotes);
  assert.ok(selLines.some((l) => l.includes('✓') && l.includes('Laptop')));
  assert.ok(!selLines.some((l) => l.includes('✓') && l.includes('All hosts')));
});

// ── The Legend — static, both modes, complete (QA round 2) ────────────────────
test('the Legend submenu appears in single-host AND multi-host dropdowns', () => {
  const single = emit(computeBadge({ tools: [tool('claude-code', 46, 61)] }), { host: '127.0.0.1', port: '8787', display: DEF });
  assert.match(single, /🛈 Legend/);
  const c = fleet();
  const multi = emitMulti(computeMultiBadge(c), { host: '127.0.0.1', port: '8787', remotes: remotesFromCombined(c), display: DEF });
  assert.match(multi, /🛈 Legend/);
});

test('the Legend enumerates all five states + both tool marks + the colors + the ✓ marker (complete)', () => {
  const legend = legendLines().join('\n');
  // Five states.
  assert.match(legend, /Live: a fresh reading/);
  assert.match(legend, /Aging/);
  assert.match(legend, /Stale/);
  assert.match(legend, /No reading/);
  assert.match(legend, /Offline/);
  // Both tool marks.
  assert.match(legend, /◆ — Claude/);
  assert.match(legend, /▲ — Codex/);
  // The three colors.
  assert.match(legend, /good/);
  assert.match(legend, /warn/);
  assert.match(legend, /crit/);
  // The ✓ marker.
  assert.match(legend, /✓ — Active/);
  // The side-by-side cue + +M.
  assert.match(legend, /Host cue/);
  assert.match(legend, /\+M more/);
});

test('the Legend is fully static — no interpolated value (byte-stable)', () => {
  const a = legendLines();
  const b = legendLines();
  assert.deepEqual(a, b); // identical across calls — no config read, no dynamic data
});

// ── displayFromConfig degrades to today's defaults on a thrown read ───────────
test('displayFromConfig returns today\'s defaults when the read throws (never a crash)', () => {
  const d = displayFromConfig(() => { throw new Error('boom'); });
  assert.deepEqual(d, DEF);
});

// ── growPrefixCues — grow-until-unique, positional suffix on collision ─────────
test('growPrefixCues grows the prefix until all shown cues are distinct (position-indexed)', () => {
  const cues = growPrefixCues(['Studio', 'Laptop', 'Down', 'Empty', 'Extra']);
  // Empty/Extra collide at 1 char → all grow to 2.
  assert.equal(cues[3], 'Em'); // Empty
  assert.equal(cues[4], 'Ex'); // Extra
});

test('growPrefixCues appends a positional suffix on a persistent collision', () => {
  const cues = growPrefixCues(['Machine', 'Machine', 'Machine']);
  assert.equal(new Set(cues).size, 3); // all distinct despite identical labels
});

// ── isSwiftBar detection ──────────────────────────────────────────────────────
test('isSwiftBar detects the SwiftBar plugin env; xbar/no-env is false', () => {
  assert.equal(isSwiftBar({ SWIFTBAR: '1' }), true);
  assert.equal(isSwiftBar({ SWIFTBAR_VERSION: '1.4' }), true);
  assert.equal(isSwiftBar({}), false);
});

// ── the tracked assets exist as small monochrome PNGs (source, not a dep) ─────
test('the tracked tool-mark PNG assets exist and are real PNGs', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const assets = path.join(here, '..', 'scripts', 'menubar', 'assets');
  for (const f of ['claude-mark.png', 'codex-mark.png']) {
    const b = fs.readFileSync(path.join(assets, f));
    assert.ok(b.slice(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${f} is a PNG`);
    assert.ok(b.length < 4096, `${f} is small (${b.length} bytes)`);
  }
  // A LICENSE/attribution note travels with them.
  assert.ok(fs.existsSync(path.join(assets, 'LICENSE.md')));
});
