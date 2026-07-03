import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readHostsConfig, readDisplayConfig, writeDisplayConfig, writeHostsConfig,
  configFileHealth, DISPLAY_DEFAULTS,
} from '../src/host-config.js';

// badge-display-options — the five !display-* directives in hosts.conf: parse,
// defaults, degradation, and the writer that round-trips ALL directives. Pure/
// injectable: every function takes hostsFile + fs, so it is tested against a
// scratch temp dir — never the real data dir. (Round 1 + round 2 seams.)

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-display-'));
  return { dir, file: path.join(dir, 'hosts.conf') };
}
function cleanup(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }

// ── Parse: the five axes to their values (QA-01) ──────────────────────────────
test('the five !display-* directives parse to { hosts, layout, density, group, toolMark }', () => {
  const { dir, file } = scratch();
  fs.writeFileSync(file,
    '!display-hosts=100.64.0.7:8788,laptop:8787\n'
    + '!display-layout=side-by-side\n'
    + '!display-density=compact\n'
    + '!display-group=tool\n'
    + '!display-tool-mark=logo\n'
    + '100.64.0.7:8788=Desktop\n');
  const d = readDisplayConfig({ hostsFile: file, hostsRaw: '', fs });
  assert.deepEqual(d.hosts, ['100.64.0.7:8788', 'laptop:8787']);
  assert.equal(d.layout, 'side-by-side');
  assert.equal(d.density, 'compact');
  assert.equal(d.group, 'tool');
  assert.equal(d.toolMark, 'logo');
  cleanup(dir);
});

// ── Defaults when absent (QA-01) ──────────────────────────────────────────────
test('absent directives ⇒ the axis defaults (all/single/wide/host/neutral)', () => {
  const { dir, file } = scratch();
  fs.writeFileSync(file, '100.64.0.7:8788=Desktop\n'); // no !display-*
  const d = readDisplayConfig({ hostsFile: file, hostsRaw: '', fs });
  assert.deepEqual(d, { hosts: 'all', layout: 'single', density: 'wide', group: 'host', toolMark: 'neutral' });
  assert.deepEqual(d, { ...DISPLAY_DEFAULTS });
  cleanup(dir);
});

test('an absent file ⇒ the defaults (never a crash)', () => {
  const { dir, file } = scratch();
  const d = readDisplayConfig({ hostsFile: file, hostsRaw: '', fs });
  assert.deepEqual(d, { ...DISPLAY_DEFAULTS });
  cleanup(dir);
});

// ── The host list splits on commas into sanitized keys (QA-01) ────────────────
test('!display-hosts splits on commas into sanitized host:port keys; "all"/empty ⇒ "all"', () => {
  const { dir, file } = scratch();
  fs.writeFileSync(file, '!display-hosts= a:1 , b:2 ,,\n');
  assert.deepEqual(readDisplayConfig({ hostsFile: file, hostsRaw: '', fs }).hosts, ['a:1', 'b:2']);
  fs.writeFileSync(file, '!display-hosts=all\n');
  assert.equal(readDisplayConfig({ hostsFile: file, hostsRaw: '', fs }).hosts, 'all');
  fs.writeFileSync(file, '!display-hosts=\n');
  assert.equal(readDisplayConfig({ hostsFile: file, hostsRaw: '', fs }).hosts, 'all');
  cleanup(dir);
});

test('a host key with SwiftBar metacharacters is stripped to the sanitized vocabulary', () => {
  const { dir, file } = scratch();
  fs.writeFileSync(file, '!display-hosts=a|b:1 evil,c:2\n');
  // The '|' and space are stripped from the key (never a free-form string).
  assert.deepEqual(readDisplayConfig({ hostsFile: file, hostsRaw: '', fs }).hosts, ['ab:1evil', 'c:2']);
  cleanup(dir);
});

// ── Unknown value ⇒ default + a bad-display-* error, surfaced not crashing (QA-01/04) ─
test('an unknown axis value ⇒ the default + a bad-display-* error (surfaced, never a crash)', () => {
  const { dir, file } = scratch();
  fs.writeFileSync(file,
    '!display-layout=diagonal\n'
    + '!display-density=huge\n'
    + '!display-group=fleet\n'
    + '!display-tool-mark=emoji\n');
  const r = readHostsConfig({ hostsFile: file, hostsRaw: '', fs });
  assert.equal(r.display.layout, 'single');   // fell to default
  assert.equal(r.display.density, 'wide');
  assert.equal(r.display.group, 'host');
  assert.equal(r.display.toolMark, 'neutral');
  const reasons = r.fileErrors.map((e) => e.reason).sort();
  assert.deepEqual(reasons, ['bad-display-density', 'bad-display-group', 'bad-display-layout', 'bad-display-tool-mark']);
  cleanup(dir);
});

test('an unknown !display-* directive ⇒ the unknown-directive error path', () => {
  const { dir, file } = scratch();
  fs.writeFileSync(file, '!display-color=blue\n');
  const r = readHostsConfig({ hostsFile: file, hostsRaw: '', fs });
  assert.equal(r.fileErrors.length, 1);
  assert.equal(r.fileErrors[0].reason, 'unknown-directive');
  cleanup(dir);
});

// ── The writer round-trips ALL directives (Risk 5, QA-03/04) ──────────────────
test('writeDisplayConfig preserves host entries + !local when writing a display axis', () => {
  const { dir, file } = scratch();
  fs.writeFileSync(file, '!local=exclude\n100.64.0.7:8788=Desktop\nlaptop=Work\n');
  const res = writeDisplayConfig(file, { layout: 'side-by-side', density: 'compact' }, { hostsRaw: '' });
  assert.ok(res.ok);
  const r = readHostsConfig({ hostsFile: file, hostsRaw: '', fs });
  // The host entries + !local survive untouched.
  assert.equal(r.localMode, 'exclude');
  assert.match(r.raw, /100\.64\.0\.7:8788=Desktop/);
  assert.match(r.raw, /laptop=Work/);
  // The display axes are written.
  assert.equal(r.display.layout, 'side-by-side');
  assert.equal(r.display.density, 'compact');
  cleanup(dir);
});

test('an Add/Remove (writeHostsConfig) preserves the !display-* directives (round-trip)', () => {
  const { dir, file } = scratch();
  // Start with a display config + one host.
  writeDisplayConfig(file, { group: 'tool', layout: 'alternating', density: 'compact', hosts: ['a:1'] }, { hostsRaw: '' });
  // Simulate a host Add by rewriting the entry list, passing the read-back display.
  const r0 = readHostsConfig({ hostsFile: file, hostsRaw: '', fs });
  writeHostsConfig(file, ['a:1=Alpha', 'b:2=Bravo'], { localMode: r0.localMode, display: r0.display });
  const r = readHostsConfig({ hostsFile: file, hostsRaw: '', fs });
  // The display axes survived the host edit.
  assert.equal(r.display.group, 'tool');
  assert.equal(r.display.layout, 'alternating');
  assert.equal(r.display.density, 'compact');
  assert.deepEqual(r.display.hosts, ['a:1']);
  // And the new host list is there.
  assert.match(r.raw, /a:1=Alpha/);
  assert.match(r.raw, /b:2=Bravo/);
  cleanup(dir);
});

test('a display write never disturbs a later display write of a DIFFERENT axis', () => {
  const { dir, file } = scratch();
  writeDisplayConfig(file, { layout: 'side-by-side' }, { hostsRaw: '' });
  writeDisplayConfig(file, { density: 'compact' }, { hostsRaw: '' });
  const r = readDisplayConfig({ hostsFile: file, hostsRaw: '', fs });
  assert.equal(r.layout, 'side-by-side'); // the first axis persisted
  assert.equal(r.density, 'compact');     // the second landed
  cleanup(dir);
});

// ── Default-valued axes are OMITTED from the file (byte-for-byte file guard) ───
test('default-valued axes are OMITTED from the written file (unconfigured file stays clean)', () => {
  const { dir, file } = scratch();
  // Write group=host (default) + layout=side-by-side (non-default).
  writeDisplayConfig(file, { group: 'host', toolMark: 'neutral', layout: 'side-by-side' }, { hostsRaw: '' });
  const body = fs.readFileSync(file, 'utf8');
  // The directive (non-comment) lines only.
  const directives = body.split('\n').filter((l) => !l.trimStart().startsWith('#') && l.trim().startsWith('!'));
  // group=host and toolMark=neutral are defaults → no directive line for them.
  assert.ok(!directives.some((l) => l.startsWith('!display-group')), 'group=host omitted');
  assert.ok(!directives.some((l) => l.startsWith('!display-tool-mark')), 'toolMark=neutral omitted');
  // The non-default layout IS written.
  assert.ok(directives.includes('!display-layout=side-by-side'), 'layout written');
  cleanup(dir);
});

test('writing all-defaults produces a file with NO !display-* directive lines', () => {
  const { dir, file } = scratch();
  writeDisplayConfig(file, { ...DISPLAY_DEFAULTS }, { hostsRaw: '' });
  const body = fs.readFileSync(file, 'utf8');
  // No non-comment line begins a !display- directive (the header COMMENTS mention
  // the syntax — those are '#'-prefixed and don't count).
  const directiveLines = body.split('\n').filter((l) => !l.trimStart().startsWith('#') && l.trim().startsWith('!display-'));
  assert.deepEqual(directiveLines, []);
  cleanup(dir);
});

// ── configFileHealth carries the display axes for the disclosure line (QA-20) ─
test('configFileHealth surfaces the display axes + bad-display-* errors', () => {
  const { dir, file } = scratch();
  fs.writeFileSync(file, '!display-group=tool\n!display-layout=diagonal\n');
  const h = configFileHealth({ hostsFile: file, hostsRaw: '', fs });
  assert.equal(h.display.group, 'tool');
  assert.equal(h.display.layout, 'single'); // bad value fell to default
  assert.ok(h.fileErrors.some((e) => e.reason === 'bad-display-layout'));
  cleanup(dir);
});
