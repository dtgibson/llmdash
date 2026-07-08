import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMultiBadge, emitMulti, computeBadge, emit,
  hostDiagLine, remotesFromCombined, localModeFromCombined,
} from '../scripts/menubar/llmdash.5s.js';

// FR-07–FR-13, FR-19/20, QA-07–QA-13/19/20 — the host axis over computeBadge.
// Pure over injected /api/hosts fixtures. Timestamps are absolute-relative-to-now
// so freshness bands are deterministic.

const now = Date.now();
const iso = (deltaMs) => new Date(now + deltaMs).toISOString();

// A tool block in the /api/state shape the badge parses (nested in a host's state).
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
// A host reading in the /api/hosts shape.
function host(label, { self = false, tools = null, reachable = true, hostDiagnostic = null, pending = false, port = 8787, hostStr = null, localMode = undefined } = {}) {
  const h = {
    host: hostStr || (self ? 'local' : label.toLowerCase().replace(/\s+/g, '')),
    label, port, self, reachable, hostDiagnostic,
    fetchedAt: iso(-10000),
    state: tools ? { tools, headroom: null, generatedAt: iso(0) } : null,
  };
  if (pending) h.pending = true;
  if (localMode !== undefined) h.localMode = localMode;
  return h;
}
function combined(hosts) { return { hosts, generatedAt: iso(0) }; }
function titleLine(out) { return out.split('\n')[0]; }
function preSeparatorLines(out) {
  const lines = out.split('\n');
  const i = lines.indexOf('---');
  return i < 0 ? lines : lines.slice(0, i);
}

// ── Single-host: shipped glyph + tool rows, PLUS the always-present Add action ─
// FR-13 refined: single-host keeps the glyph + per-tool rows compatible with the
// shipped badge, while the host-config affordance rides it too so the FIRST host
// is addable from the menu bar. Headers are intentionally larger now for
// status-bar-popup-legibility.
test('single host ⇒ mode "single"; the glyph + tool rows stay compatible (QA-13)', () => {
  const state = { tools: [tool('claude-code', 46, 61), tool('codex', 88, 72)], headroom: null, generatedAt: iso(0) };
  const c = combined([host('This machine', { self: true, tools: state.tools })]);
  const multi = computeMultiBadge(c);
  assert.equal(multi.mode, 'single');
  // The caller unwraps hosts[0].state and runs the EXISTING computeBadge/emit.
  const out = emit(computeBadge(c.hosts[0].state), { host: '127.0.0.1', port: '8787' });
  const lines = out.split('\n');
  // The GLYPH is byte-for-byte the shipped single-host glyph (no host cue).
  assert.match(lines[0], /^▪ ◆ 46% \| color=#[0-9a-f]{6}$/);
  assert.doesNotMatch(lines[0], /·[◆▲]/);
  // The per-tool ROWS stay the same content, now with explicit dark dropdown
  // colors so SwiftBar does not render them as faint gray.
  assert.match(out, /^Claude Code \| size=14 color=#1f1f1f$/m);
  assert.match(out, /^5-hour: {2}46% · resets .+ \| font=Menlo color=#111111$/m);
  assert.match(out, /^Codex \| size=14 color=#1f1f1f$/m);
});

test('single-host mode still offers ＋ Add host… so the first machine is addable from the menu bar (FR-14)', () => {
  const state = { tools: [tool('claude-code', 46, 61), tool('codex', 88, 72)], headroom: null, generatedAt: iso(0) };
  const c = combined([host('This machine', { self: true, tools: state.tools })]);
  const out = emit(computeBadge(c.hosts[0].state), { host: '127.0.0.1', port: '8787' });
  // The Add action is present in single-host mode — the ONLY way to add the first host.
  assert.match(out, /^＋ Add host… \| shell=.*param2=add terminal=false refresh=true$/m);
  // No Remove submenu in single mode (nothing to remove); the count is honest.
  assert.doesNotMatch(out, /Remove host…/);
  assert.doesNotMatch(out, /Stop watching/);
  assert.match(out, /^☰ Watching: 0 other machines \| color=#333333$/m);
  // Open dashboard / Refresh still present, unchanged.
  assert.match(out, /^Open dashboard \| href=http:\/\/127\.0\.0\.1:8787\/$/m);
  assert.match(out, /^Refresh \| refresh=true$/m);
});

// ── Glyph = min across HOST × tool × window with a reading (QA-07) ─────────────
test('multi glyph = floor(min remainingPct) across host × tool × window with a reading (QA-07)', () => {
  const c = combined([
    host('This machine', { self: true, tools: [tool('claude-code', 80, 90)] }),
    host('Desktop', { tools: [tool('claude-code', 12, 38), tool('codex', 71, 64)] }),
    host('Work laptop', { tools: [tool('claude-code', null, null), tool('codex', 88, 61)] }),
  ]);
  const multi = computeMultiBadge(c);
  assert.equal(multi.mode, 'multi');
  assert.equal(multi.pct, 12);          // Desktop Claude 5-hour is the tightest
  assert.equal(multi.cue, '◆');
  assert.equal(multi.binding.hostLabel, 'Desktop');
  assert.equal(multi.binding.windowLabel, '5-hour');
  assert.equal(multi.hostCue, 'Desktop'); // ≤10 chars, no truncation
});

test('a no-reading host/window is EXCLUDED from the min (never counted as 0) (QA-07)', () => {
  const c = combined([
    host('This machine', { self: true, tools: [tool('claude-code', 55, 60)] }),
    // Work laptop has NO reading at all → it must not drag the min to 0.
    host('Work laptop', { tools: [tool('claude-code', null, null), tool('codex', null, null)] }),
    host('Desktop', { tools: [tool('claude-code', 30, 40)] }),
  ]);
  const multi = computeMultiBadge(c);
  assert.equal(multi.pct, 30);          // Desktop 5-hour, NOT 0 from the empty host
  assert.equal(multi.binding.hostLabel, 'Desktop');
});

test('a maxed window (0% remaining) is a valid binding constraint (QA-07)', () => {
  const c = combined([
    host('This machine', { self: true, tools: [tool('claude-code', 50, 60)] }),
    host('Desktop', { tools: [tool('claude-code', 0, 40)] }), // 5-hour maxed
  ]);
  const multi = computeMultiBadge(c);
  assert.equal(multi.pct, 0);
  assert.equal(multi.binding.hostLabel, 'Desktop');
  // Its dropdown row reads "limit reached", never "0%".
  const out = emitMulti(multi, { host: '127.0.0.1', port: '8787', remotes: remotesFromCombined(c) });
  assert.match(out, /limit reached/);
});

// ── The binding host is named in the glyph + headline (QA-08) ─────────────────
test('the binding host is named in the glyph and the title echo (QA-08)', () => {
  const c = combined([
    host('This machine', { self: true, tools: [tool('claude-code', 80, 90)] }),
    host('Desktop', { tools: [tool('claude-code', 12, 38)] }),
  ]);
  const multi = computeMultiBadge(c);
  const out = emitMulti(multi, { host: '127.0.0.1', port: '8787', remotes: remotesFromCombined(c) });
  const title = out.split('\n')[0];
  assert.match(title, /^▪ Desktop·◆ 12% \|/);      // host cue · tool cue · pct
  // The dropdown title echo spells out host · tool · window.
  assert.match(out, /Desktop · Claude Code · 5-hour/);
});

test('multi-host emit: exactly one line appears before the first separator', () => {
  const c = combined([
    host('This machine', { self: true, tools: [tool('claude-code', 80, 90)] }),
    host('Desktop', { tools: [tool('claude-code', 12, 38)] }),
    host('Studio VM', { reachable: false, tools: null, hostDiagnostic: { reason: 'peer-unreachable' }, hostStr: '100.64.0.9', port: 8790 }),
  ]);
  const multi = computeMultiBadge(c);
  const out = emitMulti(multi, { host: '127.0.0.1', port: '8787', remotes: remotesFromCombined(c) });
  assert.deepEqual(preSeparatorLines(out), [titleLine(out)]);
  assert.doesNotMatch(preSeparatorLines(out).join('\n'), /Watching|not reachable|unreachable|remaining/i);
  assert.match(out, /\n---\n▪ 12% remaining/);
  assert.match(out, /Watching 3 machines · 1 not reachable/);
});

test('a long host label is truncated at 10 chars with … in the glyph; full label in the dropdown', () => {
  const c = combined([
    host('This machine', { self: true, tools: [tool('claude-code', 80, 90)] }),
    host('Studio VM in the garage', { tools: [tool('codex', 8, 40)] }),
  ]);
  const multi = computeMultiBadge(c);
  assert.equal(multi.hostCue, 'Studio VM ' + '…'); // first 10 chars + the ellipsis
  assert.equal(multi.hostCue.length, 11);          // 10 chars + the ellipsis
  assert.ok(multi.hostCue.endsWith('…'));
  const out = emitMulti(multi, { host: '127.0.0.1', port: '8787', remotes: remotesFromCombined(c) });
  const title = out.split('\n')[0];
  assert.match(title, /Studio VM …·▲/);            // truncated in the glyph
  assert.match(out, /Studio VM in the garage/);    // full label in the dropdown header
});

// ── One section per host, five states per host (QA-09) ────────────────────────
test('the dropdown renders one section per host; one host degraded does NOT suppress another (QA-09)', () => {
  const c = combined([
    host('This machine', { self: true, tools: [tool('claude-code', 80, 90)] }),
    host('Desktop', { tools: [tool('claude-code', 12, 38, { freshness: { capturedAt: iso(-1800000), freshForMs: 300000, staleAfterMs: 600000 } })] }), // stale
    host('Work laptop', { tools: [tool('codex', 88, 61)] }), // fresh, unaffected
  ]);
  const multi = computeMultiBadge(c);
  const out = emitMulti(multi, { host: '127.0.0.1', port: '8787', remotes: remotesFromCombined(c) });
  // All three host headers present.
  assert.match(out, /^Desktop.*binding/m);
  assert.match(out, /^Work laptop/m);
  assert.match(out, /This machine/);
  // Desktop stale doesn't suppress Work laptop's fresh Codex rows.
  assert.match(out, /88% · resets/);
});

// ── Offline host named honestly, own-key mapped, never fabricated (QA-10) ─────
test('an offline host is named via own-key hostDiagnostic map, detail sanitized, never a zero (QA-10)', () => {
  const c = combined([
    host('This machine', { self: true, tools: [tool('claude-code', 80, 90)] }),
    host('Desktop', { tools: [tool('claude-code', 30, 40)] }),
    host('Studio VM', { reachable: false, tools: null, hostDiagnostic: { reason: 'peer-unreachable', cause: 'timeout' }, hostStr: '100.64.0.9', port: 8790 }),
  ]);
  const multi = computeMultiBadge(c);
  const out = emitMulti(multi, { host: '127.0.0.1', port: '8787', remotes: remotesFromCombined(c) });
  assert.match(out, /Studio VM is unreachable/);
  assert.match(out, /100\.64\.0\.9:8790/);          // names the address + the fix
  assert.match(out, /the other machines are unaffected/);
  // The offline host contributes NO number to the glyph (Desktop 30% still binds).
  assert.equal(multi.pct, 30);
});

test('hostDiagLine: own-key lookup — an inherited-key reason cannot bypass the fallback (QA-10)', () => {
  assert.match(hostDiagLine('Desktop', 'd:8787', { reason: 'peer-unreachable' }), /is unreachable/);
  assert.match(hostDiagLine('Desktop', 'd:8787', { reason: 'peer-error', cause: 'http-500' }), /returned an error \(http-500\)/);
  assert.match(hostDiagLine('Desktop', 'd:8787', { reason: 'pending' }), /not polled yet/);
  // Inherited keys fall through to the generic fallback.
  assert.match(hostDiagLine('Desktop', 'd:8787', { reason: 'constructor' }), /is unavailable/);
  assert.match(hostDiagLine('Desktop', 'd:8787', { reason: '__proto__' }), /is unavailable/);
  // The reserved auto-refresh-* codes are NOT reused for hosts (fall to generic).
  assert.match(hostDiagLine('Desktop', 'd:8787', { reason: 'auto-refresh-failing' }), /is unavailable/);
});

// ── Every free-form field sanitized at render (QA-11) ─────────────────────────
test('a hostile host label with | and newlines cannot break the SwiftBar line grammar (QA-11)', () => {
  const c = combined([
    host('This machine', { self: true, tools: [tool('claude-code', 80, 90)] }),
    host('Desk|top\nEVIL', { tools: [tool('claude-code', 12, 40)] }),
  ]);
  const multi = computeMultiBadge(c);
  const out = emitMulti(multi, { host: '127.0.0.1', port: '8787', remotes: remotesFromCombined(c) });
  // The binding host header line has no raw | beyond the SwiftBar param delimiter,
  // and no injected newline splits it into extra lines.
  const headerLine = out.split('\n').find((l) => l.includes('Desk') && l.includes('binding'));
  assert.ok(headerLine, 'the host header rendered');
  // The label's | and \n were scrubbed to spaces (sanitize) — so the header line
  // carries exactly one | (the SwiftBar size/color param delimiter).
  assert.equal((headerLine.match(/\|/g) || []).length, 1);
  assert.doesNotMatch(headerLine, /EVIL\n/);
});

test('the glyph host cue is sanitized (a | in the binding host label cannot inject a param)', () => {
  const c = combined([
    host('This machine', { self: true, tools: [tool('claude-code', 80, 90)] }),
    host('a|b', { tools: [tool('claude-code', 5, 40)] }),
  ]);
  const multi = computeMultiBadge(c);
  const title = emitMulti(multi, { host: '127.0.0.1', port: '8787', remotes: remotesFromCombined(c) }).split('\n')[0];
  // Exactly one | on the title line (the color= param delimiter), never a smuggled one.
  assert.equal((title.match(/\|/g) || []).length, 1);
});

// ── Monitoring-station: auto-detect + !local override (QA-19/20) ──────────────
test('monitoring-station auto-detect: empty local + remotes ⇒ local out of glyph/headline, retained in dropdown (QA-19/20)', () => {
  const c = combined([
    host('This machine', { self: true, tools: [tool('claude-code', null, null), tool('codex', null, null)] }), // empty local
    host('Desktop', { tools: [tool('claude-code', 12, 38)] }),
  ]);
  const multi = computeMultiBadge(c, { localMode: 'auto' });
  // The binding is Desktop (the empty local didn't drag it to a no-reading state).
  assert.equal(multi.binding.hostLabel, 'Desktop');
  const out = emitMulti(multi, { host: '127.0.0.1', port: '8787', remotes: remotesFromCombined(c) });
  // The local host is RETAINED in the dropdown, honestly labeled, dimmed — never dropped.
  assert.match(out, /This machine/);
  assert.match(out, /no local activity/);
  assert.match(out, /No reading is fabricated/);
  // It is pinned LAST (after Desktop).
  const idxDesktop = out.indexOf('Desktop');
  const idxLocal = out.indexOf('This machine');
  assert.ok(idxLocal > idxDesktop, 'the de-emphasized local host is pinned last');
});

test('!local=include forces the local host into the binding search (defeats auto-detect) (QA-19)', () => {
  const c = combined([
    host('This machine', { self: true, tools: [tool('claude-code', 5, 90)] }), // local has a low reading
    host('Desktop', { tools: [tool('claude-code', 30, 40)] }),
  ]);
  // With include, the local host's 5% binds (it is NOT excluded).
  const multi = computeMultiBadge(c, { localMode: 'include' });
  assert.equal(multi.pct, 5);
  assert.equal(multi.binding.hostLabel, 'This machine');
});

test('!local=exclude forces the local host out of the glyph even when it has a reading (QA-19)', () => {
  const c = combined([
    host('This machine', { self: true, tools: [tool('claude-code', 5, 90)] }),
    host('Desktop', { tools: [tool('claude-code', 30, 40)] }),
  ]);
  const multi = computeMultiBadge(c, { localMode: 'exclude' });
  assert.equal(multi.pct, 30);          // the local 5% is excluded
  assert.equal(multi.binding.hostLabel, 'Desktop');
  // Still retained in the dropdown (prominence changed, not honesty).
  const out = emitMulti(multi, { host: '127.0.0.1', port: '8787', remotes: remotesFromCombined(c) });
  assert.match(out, /This machine/);
});

test('localModeFromCombined reads the self host echo; absent ⇒ auto', () => {
  assert.equal(localModeFromCombined(combined([host('This machine', { self: true, localMode: 'exclude', tools: [tool('claude-code', 5, 90)] })])), 'exclude');
  assert.equal(localModeFromCombined(combined([host('This machine', { self: true, tools: [tool('claude-code', 5, 90)] })])), 'auto');
});

// ── multi no-reading ⇒ dash, no host cue (design spec) ────────────────────────
test('multi no-reading (no host on any counted machine has a reading) ⇒ ▪ — , no host cue', () => {
  const c = combined([
    host('This machine', { self: true, tools: [tool('claude-code', null, null)] }),
    host('Desktop', { tools: [tool('claude-code', null, null), tool('codex', null, null)] }),
  ]);
  // With auto-detect, the empty local is dropped; Desktop also has no reading → no-reading.
  const multi = computeMultiBadge(c, { localMode: 'auto' });
  assert.equal(multi.state, 'no-reading');
  assert.equal(multi.pct, null);
  assert.equal(multi.hostCue, null);
  const title = emitMulti(multi, { host: '127.0.0.1', port: '8787', remotes: remotesFromCombined(c) }).split('\n')[0];
  assert.equal(title, '▪ — | color=#9b9ea6');
});

// ── remotesFromCombined for the Remove submenu / Watching count ───────────────
test('remotesFromCombined lists only non-self hosts with a host:port key (never the local host)', () => {
  const c = combined([
    host('This machine', { self: true, tools: [tool('claude-code', 80, 90)] }),
    host('Desktop', { tools: [tool('claude-code', 12, 38)], hostStr: '100.64.0.7', port: 8788 }),
    host('Work laptop', { tools: [tool('codex', 88, 61)], hostStr: 'laptop', port: 8787 }),
  ]);
  const remotes = remotesFromCombined(c);
  assert.deepEqual(remotes.map((r) => r.label), ['Desktop', 'Work laptop']);
  assert.deepEqual(remotes.map((r) => r.key), ['100.64.0.7:8788', 'laptop:8787']);
  assert.ok(remotes.every((r) => !r.key.startsWith('local:')));
});

test('the Remove submenu + Watching count reflect the remote set (FR-14)', () => {
  const c = combined([
    host('This machine', { self: true, tools: [tool('claude-code', 80, 90)] }),
    host('Desktop', { tools: [tool('claude-code', 12, 38)], hostStr: '100.64.0.7', port: 8788 }),
  ]);
  const multi = computeMultiBadge(c);
  const out = emitMulti(multi, { host: '127.0.0.1', port: '8787', remotes: remotesFromCombined(c) });
  assert.match(out, /Add host…/);
  assert.match(out, /Remove host…/);
  assert.match(out, /Stop watching Desktop \(100\.64\.0\.7:8788\)/);
  assert.match(out, /param2=remove param3="100\.64\.0\.7:8788"/); // key passed on ARGV
  assert.match(out, /Watching: 1 other machine\b/); // one remote → singular
  // The Open-dashboard href uses THIS machine's loopback, never a peer's.
  assert.match(out, /Open dashboard \| href=http:\/\/127\.0\.0\.1:8787\//);
});

// ── aging/stale glyph carry the host cue (design spec glyph table) ────────────
test('aging binding host keeps the host cue with a clock marker; stale keeps it with ⚠', () => {
  const aging = combined([
    host('This machine', { self: true, tools: [tool('claude-code', 80, 90)] }),
    host('Desktop', { tools: [tool('claude-code', 31, 40, { freshness: { capturedAt: iso(-420000), freshForMs: 300000, staleAfterMs: 600000 } })] }),
  ]);
  const mA = computeMultiBadge(aging);
  assert.equal(mA.state, 'aging');
  const tA = emitMulti(mA, { host: '127.0.0.1', port: '8787', remotes: remotesFromCombined(aging) }).split('\n')[0];
  assert.match(tA, /^▪ Desktop·◆ 31% ◷ \| color=#a0a0a0$/);

  const stale = combined([
    host('This machine', { self: true, tools: [tool('claude-code', 80, 90)] }),
    host('Desktop', { tools: [tool('claude-code', 12, 40, { freshness: { capturedAt: iso(-1800000), freshForMs: 300000, staleAfterMs: 600000 } })] }),
  ]);
  const mS = computeMultiBadge(stale);
  assert.equal(mS.state, 'stale');
  const tS = emitMulti(mS, { host: '127.0.0.1', port: '8787', remotes: remotesFromCombined(stale) }).split('\n')[0];
  assert.match(tS, /^▪ Desktop·◆ 12% ⚠ \| color=#f0a94b$/);
});
