import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli, toggleHost, PRESET_AXES } from '../scripts/menubar/display-action.mjs';
import { readDisplayConfig, readHostsConfig } from '../src/host-config.js';

// badge-display-options — the Display-write helper. Driven with a scratch
// hosts.conf (never the real data dir), ARGV verbs, hostsRaw:'' (no env seed).
// It writes via host-config.js's atomic temp+rename — NO osascript, NO HTTP.
function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-displayact-'));
  return { dir, file: path.join(dir, 'hosts.conf') };
}
function cleanup(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
const cli = (file, argv) => runCli(argv, {}, { hostsFile: file, hostsRaw: '' });

// ── Each axis verb writes its directive atomically (QA-05/08) ─────────────────
test('layout / density / group / tool-mark verbs each write their axis', () => {
  const { dir, file } = scratch();
  assert.ok(cli(file, ['layout', 'side-by-side']).ok);
  assert.ok(cli(file, ['density', 'compact']).ok);
  assert.ok(cli(file, ['group', 'tool']).ok);
  assert.ok(cli(file, ['tool-mark', 'logo']).ok);
  const d = readDisplayConfig({ hostsFile: file, hostsRaw: '' });
  assert.equal(d.layout, 'side-by-side');
  assert.equal(d.density, 'compact');
  assert.equal(d.group, 'tool');
  assert.equal(d.toolMark, 'logo');
  cleanup(dir);
});

test('an unknown axis value writes NOTHING and reports the failure (never a crash)', () => {
  const { dir, file } = scratch();
  const res = cli(file, ['layout', 'diagonal']);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'bad-value');
  assert.ok(!fs.existsSync(file), 'nothing written for a bad value');
  cleanup(dir);
});

// ── The write is atomic temp+rename, mode 0o600 (QA-08/23) ────────────────────
test('the write is mode 0o600 and leaves no .tmp litter (atomic temp+rename)', () => {
  const { dir, file } = scratch();
  cli(file, ['layout', 'compact'.replace('compact', 'side-by-side')]);
  const st = fs.statSync(file);
  assert.equal(st.mode & 0o777, 0o600);
  // No stray temp file left behind.
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('.tmp.')), []);
  cleanup(dir);
});

// ── preset writes the FOUR layout axes, leaves toolMark (orthogonality) (QA-05) ─
test('the preset verb writes { group, hosts, layout, density }; toolMark is left untouched', () => {
  const { dir, file } = scratch();
  // First set a non-default toolMark.
  cli(file, ['tool-mark', 'logo']);
  // Now apply the tool-sbs preset — it writes four axes but must NOT touch toolMark.
  const res = cli(file, ['preset', 'tool-sbs']);
  assert.ok(res.ok);
  const d = readDisplayConfig({ hostsFile: file, hostsRaw: '' });
  const { group, hosts, layout, density } = PRESET_AXES['tool-sbs'];
  assert.deepEqual({ group: d.group, layout: d.layout, density: d.density }, { group, layout, density });
  assert.equal(d.hosts, hosts);
  assert.equal(d.toolMark, 'logo'); // PERSISTED across the preset write
  cleanup(dir);
});

test('an unknown preset id writes nothing and reports unknown-preset', () => {
  const { dir, file } = scratch();
  const res = cli(file, ['preset', 'ghost']);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'unknown-preset');
  cleanup(dir);
});

// ── hosts is a multi-select toggle; empty ⇒ all (QA-05) ───────────────────────
test('toggleHost adds/removes a key; an emptied selection ⇒ "all"', () => {
  assert.deepEqual(toggleHost('all', 'a:1'), ['a:1']);
  assert.deepEqual(toggleHost(['a:1'], 'b:2'), ['a:1', 'b:2']);
  assert.deepEqual(toggleHost(['a:1', 'b:2'], 'a:1'), ['b:2']);
  assert.equal(toggleHost(['a:1'], 'a:1'), 'all'); // last removed → all
  assert.equal(toggleHost(['a:1'], 'all'), 'all');  // the "all" sentinel clears
});

test('the hosts verb toggles a key in the file; toggling the last one back writes "all"', () => {
  const { dir, file } = scratch();
  cli(file, ['hosts', 'a:1']);
  assert.deepEqual(readDisplayConfig({ hostsFile: file, hostsRaw: '' }).hosts, ['a:1']);
  cli(file, ['hosts', 'b:2']);
  assert.deepEqual(readDisplayConfig({ hostsFile: file, hostsRaw: '' }).hosts, ['a:1', 'b:2']);
  cli(file, ['hosts', 'a:1']); // toggle a:1 off
  assert.deepEqual(readDisplayConfig({ hostsFile: file, hostsRaw: '' }).hosts, ['b:2']);
  cli(file, ['hosts', 'all']);  // the sentinel
  assert.equal(readDisplayConfig({ hostsFile: file, hostsRaw: '' }).hosts, 'all');
  cleanup(dir);
});

// ── the write PRESERVES host entries + !local + other !display-* (round-trip) ──
test('a display write preserves the host entries, !local, and the other display axes', () => {
  const { dir, file } = scratch();
  fs.writeFileSync(file, '!local=exclude\n!display-group=tool\n100.64.0.7:8788=Desktop\nlaptop=Work\n');
  const res = cli(file, ['density', 'compact']);
  assert.ok(res.ok);
  const r = readHostsConfig({ hostsFile: file, hostsRaw: '' });
  // Host entries + !local survive.
  assert.equal(r.localMode, 'exclude');
  assert.match(r.raw, /100\.64\.0\.7:8788=Desktop/);
  assert.match(r.raw, /laptop=Work/);
  // The other display axis (group) survives; the new one (density) landed.
  assert.equal(r.display.group, 'tool');
  assert.equal(r.display.density, 'compact');
  cleanup(dir);
});

test('a display write does NOT change the monitored host set (presentation-only, QA-10/11)', () => {
  const { dir, file } = scratch();
  fs.writeFileSync(file, '100.64.0.7:8788=Desktop\nlaptop=Work\n');
  const before = readHostsConfig({ hostsFile: file, hostsRaw: '' }).raw;
  cli(file, ['layout', 'alternating']);
  const after = readHostsConfig({ hostsFile: file, hostsRaw: '' }).raw;
  assert.equal(before, after, 'the host entries are untouched by a display write');
  cleanup(dir);
});

// ── an unknown verb is a reported failure (no crash) ──────────────────────────
test('an unknown verb reports unknown-action, writes nothing', () => {
  const { dir, file } = scratch();
  const res = cli(file, ['frobnicate', 'x']);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'unknown-action');
  assert.ok(!fs.existsSync(file));
  cleanup(dir);
});

// ── STATIC posture checks: no osascript, no HTTP, ARGV-only, $ABS_NODE (QA-23) ─
test('display-action.mjs uses NO osascript, NO HTTP, no shell — ARGV-only', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const raw = fs.readFileSync(path.join(here, '..', 'scripts', 'menubar', 'display-action.mjs'), 'utf8');
  // Strip line comments so the posture assertions test CODE, not the doc block
  // (which necessarily says "NO osascript", "no HTTP" to explain the posture).
  const code = raw.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /osascript/);
  assert.doesNotMatch(code, /node:http|require\(['"]http['"]\)|http\.get/);
  assert.doesNotMatch(code, /execFileSync|execSync|\bspawn\b|child_process/); // no shell/subprocess
  // It imports the atomic writer from host-config.js (the local file write).
  assert.match(code, /writeDisplayConfig/);
  // No mutating HTTP method anywhere.
  assert.doesNotMatch(code, /POST|PUT|DELETE|PATCH/);
});

test('the badge wires the Display actions to $ABS_NODE against display-action.mjs, refresh=true', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const plugin = fs.readFileSync(path.join(here, '..', 'scripts', 'menubar', 'llmdash.5s.js'), 'utf8');
  assert.match(plugin, /display-action\.mjs/);
  // The Display action-line builder execs ABS_NODE against DISPLAY_ACTION with refresh=true.
  assert.match(plugin, /shell="\$\{ABS_NODE\}" param1="\$\{DISPLAY_ACTION\}"[^`]*refresh=true/);
});
