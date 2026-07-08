// QA-ONLY probe suite (Stage 6, Tester) for badge-display-options.
// Hermetic: every write goes to a scratch tmp dir; no real ~/.llmdash, no real
// SwiftBar dir, no osascript. Deletes its scratch on teardown. This file probes
// gaps beyond the Engineer's own tests; it is QA-scoped and can be deleted after
// the verdict. NOT a feature test — do not treat as shipped coverage.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  applyDisplay, computeMultiBadge, emitDisplay, toolAggregates, compactCell,
  growPrefixCues, displayActionLines, legendLines, isDefaultDisplay,
  remotesFromCombined, TOOL_MARK,
} from '../scripts/menubar/llmdash.5s.js';
import { readDisplayConfig, writeDisplayConfig } from '../src/host-config.js';

const nowIso = () => new Date().toISOString();
const FRESH = { capturedAt: nowIso(), freshForMs: 300000, staleAfterMs: 600000 };
const AGING = { capturedAt: new Date(Date.now() - 400000).toISOString(), freshForMs: 300000, staleAfterMs: 600000 };
const STALE = { capturedAt: new Date(Date.now() - 700000).toISOString(), freshForMs: 300000, staleAfterMs: 600000 };

function claudeTool(fivePct, weekPct, freshness = FRESH) {
  return { source: 'claude-code', label: 'Claude', freshness,
    limits: { five_hour: fivePct == null ? null : { remainingPct: fivePct, resetsAt: null },
              seven_day: weekPct == null ? null : { remainingPct: weekPct, resetsAt: null } } };
}
function codexTool(fivePct, weekPct) {
  return { source: 'codex', label: 'Codex', freshness: null,
    limits: { five_hour: fivePct == null ? null : { remainingPct: fivePct, resetsAt: null },
              seven_day: weekPct == null ? null : { remainingPct: weekPct, resetsAt: null } } };
}
function host({ self = false, host: h, port = '8787', label, reachable = true, tools = null, pending = false }) {
  return { self, host: h, port, label, reachable, pending, state: tools ? { tools } : null };
}

// ── 1. The case-sensitivity view-filter bug (SUSPECTED DEFECT) ────────────────
test('QA: a mixed-case host key survives the round-trip and still filters the glyph', () => {
  const combined = { hosts: [
    host({ self: true, host: '127.0.0.1', port: '8787', label: 'Local', tools: [claudeTool(5, 90)] }),
    host({ host: 'Studio.local', port: '8788', label: 'Studio', tools: [claudeTool(80, 95)] }),
  ] };
  const multi = computeMultiBadge(combined, { localMode: 'include' });
  // The submenu writes THIS key (case preserved through sanitizeHostPort):
  const studioKey = remotesFromCombined(combined).find((r) => r.label === 'Studio').key;
  assert.equal(studioKey, 'Studio.local:8788', 'the toggle writes the case-preserved key');

  // Round-trip it through the file the way a real toggle does.
  const dir = mkdtempSync(join(tmpdir(), 'qa-case-'));
  const f = join(dir, 'hosts.conf');
  writeFileSync(f, 'Studio.local:8788=Studio\n');
  const w = writeDisplayConfig(f, { hosts: [studioKey], layout: 'single', density: 'compact' }, { hostsRaw: '' });
  assert.ok(w.ok);
  const stored = readDisplayConfig({ hostsFile: f, hostsRaw: '' }).hosts;

  const view = applyDisplay(multi, { ...readDisplayConfig({ hostsFile: f, hostsRaw: '' }) }, { epochMs: 0 });
  rmSync(dir, { recursive: true, force: true });

  // The user selected ONLY Studio (80%). If the filter matches, the glyph shows 80.
  // If the case-mismatch drops the selection → falls back to all → binding Local 5.
  assert.deepEqual(stored, [studioKey], `stored key should equal the written key, got ${JSON.stringify(stored)}`);
  assert.equal(view.cells[0].text, '80', `expected Studio(80) in the glyph, got ${view.cells[0].text} (fell back to all → Local 5 = case-mismatch bug)`);
});

// ── 2. Five honesty states, compact — no digit for no-reading/offline ─────────
test('QA: compact cell — five states, no-reading & offline carry NO digit', () => {
  assert.equal(compactCell({ state: 'fresh', pct: 46 }).text, '46');
  assert.equal(compactCell({ state: 'aging', pct: 46 }).text, '◷46');
  assert.equal(compactCell({ state: 'stale', pct: 12 }).text, '⚠12');
  assert.equal(compactCell({ state: 'no-reading', pct: null }).text, '—');
  assert.equal(compactCell({ state: 'offline', pct: null }).text, '⊘');
  // Structural: no digit path for no-reading/offline even if a stray pct sneaks in.
  assert.equal(compactCell({ state: 'no-reading', pct: 0 }).text, '—');
  assert.equal(compactCell({ state: 'offline', pct: 0 }).text, '⊘');
  assert.ok(!/\d/.test(compactCell({ state: 'no-reading', pct: 99 }).text));
  assert.ok(!/\d/.test(compactCell({ state: 'offline', pct: 99 }).text));
});

// ── 3. No-reading/offline carry no digit across EVERY layout ──────────────────
test('QA: no-reading & offline carry no digit in single/side-by-side/alternating/tool', () => {
  const combined = { hosts: [
    host({ self: true, host: '127.0.0.1', port: '8787', label: 'A', tools: [claudeTool(null, null)] }), // no-reading
    host({ host: 'b', port: '8788', label: 'Bee', reachable: false }), // offline
    host({ host: 'c', port: '8789', label: 'Cee', tools: [claudeTool(30, 60)] }), // fresh
  ] };
  const multi = computeMultiBadge(combined, { localMode: 'include' });
  for (const layout of ['single', 'side-by-side', 'alternating']) {
    for (const group of ['host', 'tool']) {
      // Select all three; sweep epoch to hit each alternating frame.
      for (let e = 0; e < 3; e++) {
        const view = applyDisplay(multi, { hosts: 'all', layout, density: 'compact', group, toolMark: 'neutral' }, { epochMs: e * 5000 });
        for (const c of view.cells) {
          if (c.state === 'no-reading') assert.ok(!/\d/.test(c.text), `no-reading with a digit: ${c.text} (${layout}/${group}/e${e})`);
          if (c.state === 'offline') assert.ok(!/\d/.test(c.text), `offline with a digit: ${c.text} (${layout}/${group}/e${e})`);
        }
      }
    }
  }
});

// ── 4. Per-tool aggregate: tightest window across SELECTED hosts, honest —/⊘ ──
test('QA: tool aggregate = tightest window across selected hosts; no-reading→—; all-offline→⊘', () => {
  // Claude present on two hosts (12 and 40); Codex present on one (63). Tightest
  // Claude = 12; Codex = 63. binding-first → Claude first.
  const multi = computeMultiBadge({ hosts: [
    host({ host: 'a', port: '8787', label: 'A', tools: [claudeTool(40, 80)] }),
    host({ host: 'b', port: '8788', label: 'B', tools: [claudeTool(12, 50), codexTool(63, 70)] }),
  ] }, { localMode: 'include' });
  const cells = toolAggregates(multi.hostViews);
  assert.equal(cells[0].source, 'claude-code');
  assert.equal(cells[0].pct, 12, 'tightest Claude across selected');
  assert.equal(cells[1].source, 'codex');
  assert.equal(cells[1].pct, 63);

  // A tool with no reading anywhere → no-reading (—), never a zero.
  const noCodex = toolAggregates(computeMultiBadge({ hosts: [
    host({ host: 'a', port: '8787', label: 'A', tools: [claudeTool(30, 60)] }),
  ] }, { localMode: 'include' }).hostViews);
  const codexCell = noCodex.find((c) => c.source === 'codex');
  assert.equal(codexCell.state, 'no-reading');
  assert.equal(codexCell.pct, null);

  // All contributing hosts offline → both aggregates ⊘.
  const allOffline = toolAggregates([
    { badge: null, addr: 'a', reachable: false },
    { badge: null, addr: 'b', reachable: false },
  ]);
  for (const c of allOffline) { assert.equal(c.state, 'offline'); assert.equal(c.pct, null); }
});

// ── 5. Tool aggregate: exactly two units, no cap / no +M ──────────────────────
test('QA: tool mode never emits +M even with a large selected fleet', () => {
  const hosts = [];
  for (let i = 0; i < 6; i++) hosts.push(host({ host: `h${i}`, port: `88${i}0`, label: `H${i}`, tools: [claudeTool(10 + i, 50), codexTool(20 + i, 60)] }));
  const multi = computeMultiBadge({ hosts }, { localMode: 'include' });
  const view = applyDisplay(multi, { hosts: 'all', layout: 'side-by-side', density: 'compact', group: 'tool', toolMark: 'neutral' }, { epochMs: 0 });
  assert.equal(view.more, 0, 'tool mode has no overflow');
  assert.equal(view.cells.length, 2, 'exactly two aggregate cells');
  const text = emitDisplay(view, multi).split('\n')[0];
  assert.ok(!/\+\d/.test(text), `no +M in tool mode: ${text}`);
});

// ── 6. Aggregate scoping by Hosts selection (tool mode still honors hosts) ────
test('QA: tool aggregate is scoped by the Hosts selection', () => {
  const combined = { hosts: [
    host({ self: true, host: '127.0.0.1', port: '8787', label: 'Local', tools: [claudeTool(5, 90)] }),   // tightest Claude overall
    host({ host: 'studio', port: '8788', label: 'Studio', tools: [claudeTool(70, 95)] }),
  ] };
  const multi = computeMultiBadge(combined, { localMode: 'include' });
  // Select only Studio → the Claude aggregate should be 70, not the overall 5.
  // Tool-mode compact cells lead with the tool mark (◆), so expect ◆70.
  const view = applyDisplay(multi, { hosts: ['studio:8788'], layout: 'single', density: 'compact', group: 'tool', toolMark: 'neutral' }, { epochMs: 0 });
  assert.equal(view.cells[0].text, `${TOOL_MARK.claude}70`, `aggregate should be scoped to Studio(70), got ${view.cells[0].text}`);
});

// ── 7. One aggregate's state never suppresses the other's ─────────────────────
test('QA: aggregate independence — one stale tool does not flag the other', () => {
  const combined = { hosts: [host({ self: true, host: '127.0.0.1', label: 'L',
    tools: [claudeTool(12, 50, STALE), codexTool(63, 70)] })] };
  const multi = computeMultiBadge(combined, { localMode: 'include' });
  const cells = toolAggregates(multi.hostViews);
  const claude = cells.find((c) => c.source === 'claude-code');
  const codex = cells.find((c) => c.source === 'codex');
  assert.equal(claude.state, 'stale');
  assert.equal(codex.state, 'fresh', 'Codex aggregate stays fresh despite a stale Claude');
});

// ── 8. Side-by-side cap = 3, binding-first, +M hides least-constrained ────────
test('QA: side-by-side caps at 3 with +M; binding-first keeps the tightest visible', () => {
  const hosts = [
    host({ self: true, host: '127.0.0.1', port: '8787', label: 'Aaa', tools: [claudeTool(90, 95)] }),
    host({ host: 'b', port: '8788', label: 'Bbb', tools: [claudeTool(10, 50)] }), // tightest
    host({ host: 'c', port: '8789', label: 'Ccc', tools: [claudeTool(30, 60)] }),
    host({ host: 'd', port: '8790', label: 'Ddd', tools: [claudeTool(50, 70)] }),
    host({ host: 'e', port: '8791', label: 'Eee', tools: [claudeTool(70, 80)] }),
  ];
  const multi = computeMultiBadge({ hosts }, { localMode: 'include' });
  const view = applyDisplay(multi, { hosts: 'all', layout: 'side-by-side', density: 'compact', group: 'host', toolMark: 'neutral' }, { epochMs: 0 });
  assert.equal(view.cells.length, 3);
  assert.equal(view.more, 2, '+2 overflow');
  // The tightest (Bbb 10) must be present (binding-first).
  const glyph = emitDisplay(view, multi).split('\n')[0];
  assert.ok(/10/.test(glyph), `tightest host visible: ${glyph}`);
  assert.ok(/\+2/.test(glyph), `+2 shown: ${glyph}`);
  // The least-constrained (Eee 70) must be hidden.
  assert.ok(!/70/.test(glyph), `least-constrained hidden: ${glyph}`);
});

// ── 9. Alternating rotation is stateless and names host i, wraps ──────────────
test('QA: alternating rotates floor(epoch/5000)%count, wraps', () => {
  const hosts = [
    host({ self: true, host: '127.0.0.1', port: '8787', label: 'Aaa', tools: [claudeTool(10, 50)] }),
    host({ host: 'b', port: '8788', label: 'Bbb', tools: [claudeTool(20, 60)] }),
    host({ host: 'c', port: '8789', label: 'Ccc', tools: [claudeTool(30, 70)] }),
  ];
  const multi = computeMultiBadge({ hosts }, { localMode: 'include' });
  const frames = [];
  for (let e = 0; e < 4; e++) {
    const view = applyDisplay(multi, { hosts: 'all', layout: 'alternating', density: 'compact', group: 'host', toolMark: 'neutral' }, { epochMs: e * 5000 });
    frames.push(view.cells[0].text);
  }
  // 3 hosts, binding-first: [Bbb? no — binding-first orders by tightest: Aaa10, Bbb20, Ccc30]
  // frame0=idx0, frame1=idx1, frame2=idx2, frame3=idx0 (wrap)
  assert.equal(frames[0], frames[3], 'wraps after count');
  assert.equal(new Set(frames.slice(0, 3)).size, 3, 'three distinct hosts across three frames');
});

// ── 10. Degenerate reduction: one effective host → single ─────────────────────
test('QA: side-by-side of one selected host reduces to single (compact still applies)', () => {
  const combined = { hosts: [
    host({ self: true, host: '127.0.0.1', port: '8787', label: 'Local', tools: [claudeTool(40, 80)] }),
    host({ host: 'studio', port: '8788', label: 'Studio', tools: [claudeTool(12, 50)] }),
  ] };
  const multi = computeMultiBadge(combined, { localMode: 'include' });
  const view = applyDisplay(multi, { hosts: ['studio:8788'], layout: 'side-by-side', density: 'compact', group: 'host', toolMark: 'neutral' }, { epochMs: 0 });
  assert.equal(view.layout, 'single', 'reduced to single');
  assert.equal(view.cells.length, 1);
  assert.equal(view.cells[0].text, '12', 'the one selected host, compact, no host cue');
});

// ── 11. View filter: selected offline host STAYS in the glyph (⊘, no drop) ─────
test('QA: a selected offline host stays in the glyph with ⊘, never dropped', () => {
  const combined = { hosts: [
    host({ self: true, host: '127.0.0.1', port: '8787', label: 'Local', tools: [claudeTool(40, 80)] }),
    host({ host: 'studio', port: '8788', label: 'Studio', reachable: false }), // offline
  ] };
  const multi = computeMultiBadge(combined, { localMode: 'include' });
  const view = applyDisplay(multi, { hosts: ['studio:8788'], layout: 'single', density: 'compact', group: 'host', toolMark: 'neutral' }, { epochMs: 0 });
  assert.equal(view.cells[0].text, '⊘', 'selected offline host shown as ⊘');
  assert.equal(view.cells[0].state, 'offline');
});

// ── 12. All-unknown selection falls back to all ───────────────────────────────
test('QA: an all-unknown host selection falls back to all (never empty glyph)', () => {
  const combined = { hosts: [
    host({ self: true, host: '127.0.0.1', port: '8787', label: 'Local', tools: [claudeTool(40, 80)] }),
    host({ host: 'studio', port: '8788', label: 'Studio', tools: [claudeTool(12, 50)] }),
  ] };
  const multi = computeMultiBadge(combined, { localMode: 'include' });
  const view = applyDisplay(multi, { hosts: ['ghost:9999'], layout: 'single', density: 'compact', group: 'host', toolMark: 'neutral' }, { epochMs: 0 });
  assert.ok(view.cells.length >= 1, 'not an empty glyph');
  assert.equal(view.cells[0].text, '12', 'fell back to all → binding Studio 12');
});

// ── 13. Dropdown always renders every host regardless of the glyph filter ─────
test('QA: the dropdown renders the full hostViews even when the glyph is filtered', () => {
  const combined = { hosts: [
    host({ self: true, host: '127.0.0.1', port: '8787', label: 'Local', tools: [claudeTool(40, 80)] }),
    host({ host: 'studio', port: '8788', label: 'Studio', tools: [claudeTool(12, 50)] }),
    host({ host: 'desk', port: '8789', label: 'Desktop', tools: [claudeTool(63, 70)] }),
  ] };
  const multi = computeMultiBadge(combined, { localMode: 'include' });
  const view = applyDisplay(multi, { hosts: ['studio:8788'], layout: 'single', density: 'compact', group: 'host', toolMark: 'neutral' }, { epochMs: 0 });
  const out = emitDisplay(view, multi);
  // Every host section must be present in the dropdown even though only Studio is in the glyph.
  assert.ok(out.includes('Local'), 'Local in dropdown');
  assert.ok(out.includes('Studio'), 'Studio in dropdown');
  assert.ok(out.includes('Desktop'), 'Desktop in dropdown');
});

// ── 14. Display submenu present + active-marked; preset active only on 4-axis match ─
test('QA: display submenu marks the active axes/preset live in both modes', () => {
  const remotes = [{ label: 'Studio', key: 'studio:8788', addr: 'studio:8788' }];
  // Drifted config: side-by-side + compact + tool → the tool-sbs preset matches.
  const lines = displayActionLines({ display: { hosts: 'all', layout: 'side-by-side', density: 'compact', group: 'tool', toolMark: 'logo' }, remotes });
  const joined = lines.join('\n');
  // The tool-sbs preset should be ✓; other presets not.
  const toolSbs = lines.find((l) => l.includes('Claude vs Codex · side-by-side'));
  assert.ok(toolSbs.startsWith('--✓ '), `tool-sbs active: ${toolSbs}`);
  const mostConstrained = lines.find((l) => l.includes('Most-constrained · wide'));
  assert.ok(!mostConstrained.startsWith('--✓ '), `most-constrained NOT active: ${mostConstrained}`);
  // tool-mark=logo should be marked live.
  const logos = lines.find((l) => /Logos/.test(l));
  assert.ok(logos.startsWith('--✓ '), `logos active: ${logos}`);
  // The host toggle for a monitored host is present.
  assert.ok(joined.includes('Studio (studio:8788)'), 'host toggle enumerated');
});

// ── 15. Legend is static & complete (states, marks, menu symbols) ─────────────
test('QA: legend is complete and static', () => {
  const lines = legendLines();
  const joined = lines.join('\n');
  for (const sym of ['▪', '·', '▸ binding', '46', '◷46', '⚠12', '—', '⊘', '◆', '▲', 'St12', '+2', '✓', '＋', '－', '☰', '🖥', '🛈', '▬']) {
    assert.ok(joined.includes(sym), `legend missing ${sym}`);
  }
  for (const color of ['good', 'warn', 'crit']) assert.ok(joined.includes(color), `legend missing color ${color}`);
  assert.ok(joined.includes('color=#111111'), 'legend uses readable dark text');
  assert.ok(!joined.includes('color=#a0a0a0'), 'legend does not use faint aging gray on the dropdown');
  // No interpolated dynamic value — every line is a literal (call twice, identical).
  assert.deepEqual(legendLines(), lines, 'legend is deterministic/static');
});

// ── 16. Write helper round-trips ALL five axes + entries + !local ─────────────
test('QA: writeDisplayConfig round-trips display + preserves entries + !local', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qa-rt-'));
  const f = join(dir, 'hosts.conf');
  writeFileSync(f, '!local=exclude\nstudio:8788=Studio\nlaptop:8787=Laptop\n');
  // A display write must NOT disturb the host list or !local.
  const w = writeDisplayConfig(f, { group: 'tool', layout: 'side-by-side', density: 'compact' }, { hostsRaw: '' });
  assert.ok(w.ok);
  const body = readFileSync(f, 'utf8');
  assert.ok(body.includes('!local=exclude'), '!local preserved');
  assert.ok(body.includes('studio:8788=Studio'), 'host entry preserved');
  assert.ok(body.includes('laptop:8787=Laptop'), 'host entry preserved');
  assert.ok(body.includes('!display-group=tool'));
  assert.ok(body.includes('!display-layout=side-by-side'));
  assert.ok(body.includes('!display-density=compact'));
  // Default-valued axes omitted (check the DIRECTIVE lines, not the comment header
  // which documents the syntax `!display-hosts=all|…`).
  const directiveLines = body.split('\n').filter((l) => l.startsWith('!'));
  assert.ok(!directiveLines.some((l) => l.startsWith('!display-hosts=')), 'default hosts omitted');
  assert.ok(!directiveLines.some((l) => l.startsWith('!display-tool-mark=')), 'default tool-mark omitted');
  // The file mode is 0o600.
  assert.equal(statSync(f).mode & 0o777, 0o600);
  rmSync(dir, { recursive: true, force: true });
});

// ── 17. isDefaultDisplay routing: only non-default engages the new path ───────
test('QA: isDefaultDisplay true for all/single/wide/host (toolMark orthogonal)', () => {
  assert.ok(isDefaultDisplay({ hosts: 'all', layout: 'single', density: 'wide', group: 'host', toolMark: 'neutral' }));
  assert.ok(isDefaultDisplay({ hosts: 'all', layout: 'single', density: 'wide', group: 'host', toolMark: 'logo' }), 'toolMark does not change routing');
  assert.ok(!isDefaultDisplay({ hosts: 'all', layout: 'single', density: 'compact', group: 'host' }));
  assert.ok(!isDefaultDisplay({ hosts: 'all', layout: 'single', density: 'wide', group: 'tool' }));
  assert.ok(!isDefaultDisplay({ hosts: ['a:1'], layout: 'single', density: 'wide', group: 'host' }));
});
