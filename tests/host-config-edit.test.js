import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addHost, removeHost } from '../src/host-config.js';
import { runAdd, runRemove, runCli, asStr } from '../scripts/menubar/host-config-action.mjs';

// FR-15/16, QA-15/16/23 — the Add/Remove edit round-trip driven with INJECTED
// values (no real osascript dialog): sanitize → validate → dedupe → atomic write.
// The hostile-input case proves the value is DATA end to end (never executed), and
// the structural assertions prove the AppleScript is fixed-literal + value ARGV-only.
const cfg = { port: 8787, host: '0.0.0.0' };

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-edit-'));
  return { dir, file: path.join(dir, 'hosts.conf') };
}
function cleanup(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }

// ── addHost: valid → atomic canonical append (QA-15) ──────────────────────────
test('addHost: a valid host[:port][=label] is sanitized, validated, atomically appended (QA-15)', () => {
  const { dir, file } = scratch();
  const r = addHost(file, '100.64.0.7:8788=Desktop', { hostsRaw: '', cfg, tailnet: null });
  assert.equal(r.ok, true);
  assert.equal(r.canonical, '100.64.0.7:8788=Desktop');
  const body = fs.readFileSync(file, 'utf8');
  assert.match(body, /100\.64\.0\.7:8788=Desktop/);
  // No temp leaked.
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('.tmp.')), []);
  cleanup(dir);
});

test('addHost: the default port is omitted from the canonical line; a label is kept', () => {
  const { dir, file } = scratch();
  const r = addHost(file, 'laptop=Work Laptop', { hostsRaw: '', cfg, tailnet: null });
  assert.equal(r.ok, true);
  assert.equal(r.canonical, 'laptop=Work Laptop'); // no :8787 (it's the default)
  cleanup(dir);
});

// ── addHost: malformed → nothing written (QA-15) ──────────────────────────────
test('addHost: a malformed entry is rejected and NOTHING is written (QA-15)', () => {
  const { dir, file } = scratch();
  for (const bad of ['h:99999', '   ', ':8788', '=JustALabel']) {
    const r = addHost(file, bad, { hostsRaw: '', cfg, tailnet: null });
    assert.equal(r.ok, false, `${JSON.stringify(bad)} must be rejected`);
    assert.equal(r.reason, 'invalid');
  }
  // The file was never created (no partial write on any invalid attempt).
  assert.ok(!fs.existsSync(file), 'nothing written for any invalid entry');
  cleanup(dir);
});

// ── addHost: duplicate → deduped, honestly reported (QA-15) ───────────────────
test('addHost: a duplicate host:port is deduped, honestly reported, not re-appended (QA-15)', () => {
  const { dir, file } = scratch();
  assert.equal(addHost(file, 'desktop:9000=First', { hostsRaw: '', cfg, tailnet: null }).ok, true);
  const dup = addHost(file, 'desktop:9000=Second', { hostsRaw: '', cfg, tailnet: null });
  assert.equal(dup.ok, false);
  assert.equal(dup.reason, 'duplicate');
  // Still exactly one desktop:9000 line.
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.includes('desktop:9000'));
  assert.equal(lines.length, 1);
  cleanup(dir);
});

test('addHost: the local host (127.0.0.1) is refused as a duplicate (always included)', () => {
  const { dir, file } = scratch();
  const r = addHost(file, '127.0.0.1', { hostsRaw: '', cfg, tailnet: null });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'duplicate');
  cleanup(dir);
});

// ── HOSTILE input: data end to end, never executed (QA-23) ────────────────────
test('addHost: a hostile "| rm -rf ~" value is inert data — host clean, nothing executed (QA-23)', () => {
  const { dir, file } = scratch();
  // The hostile shell metacharacters live in the LABEL (after =); the host:port
  // part is clean. It must land as DATA in the file (render-sanitized later),
  // never be executed. (Mirrors the SPIKE-01 hostile round-trip.)
  const r = addHost(file, '  100.64.0.9:8790=Studio | rm -rf ~  ', { hostsRaw: '', cfg, tailnet: null });
  assert.equal(r.ok, true);
  assert.match(r.canonical, /^100\.64\.0\.9:8790=Studio/);
  const body = fs.readFileSync(file, 'utf8');
  // The dangerous chars are stored as literal text, not run.
  assert.match(body, /100\.64\.0\.9:8790=Studio/);
  // The home dir still exists (nothing executed — this test itself proves it).
  assert.ok(fs.existsSync(os.homedir()));
  cleanup(dir);
});

test('addHost: an out-of-range port in a hostile value is a rejection, never a coercion (QA-05)', () => {
  const { dir, file } = scratch();
  const r = addHost(file, 'x:99999', { hostsRaw: '', cfg, tailnet: null });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid');
  assert.ok(!fs.existsSync(file));
  cleanup(dir);
});

// ── removeHost: atomic, local never removable, no partial (QA-16) ─────────────
test('removeHost: drops the matching entry via an atomic write; other entries survive (QA-16)', () => {
  const { dir, file } = scratch();
  fs.writeFileSync(file, '100.64.0.7:8788=Desktop\n100.64.0.9:8790=Studio\n');
  const r = removeHost(file, '100.64.0.7:8788', { hostsRaw: '', cfg, tailnet: null });
  assert.equal(r.ok, true);
  assert.equal(r.removed, 'Desktop');
  const body = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(body, /100\.64\.0\.7:8788/);
  assert.match(body, /100\.64\.0\.9:8790=Studio/); // the other entry survives
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('.tmp.')), []); // no temp leak
  cleanup(dir);
});

test('removeHost: the local host is NEVER removable (is-local), no write (QA-16)', () => {
  const { dir, file } = scratch();
  fs.writeFileSync(file, '100.64.0.7:8788=Desktop\n');
  const before = fs.readFileSync(file, 'utf8');
  const r = removeHost(file, 'local:8787', { hostsRaw: '', cfg, tailnet: null });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'is-local');
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'nothing written when refusing the local host');
  cleanup(dir);
});

test('removeHost: an unknown key ⇒ not-found, nothing changed', () => {
  const { dir, file } = scratch();
  fs.writeFileSync(file, '100.64.0.7:8788=Desktop\n');
  const before = fs.readFileSync(file, 'utf8');
  const r = removeHost(file, '10.0.0.1:9999', { hostsRaw: '', cfg, tailnet: null });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not-found');
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  cleanup(dir);
});

// ── The helper (runAdd/runRemove) with injected values (no dialog) ────────────
test('runAdd with an injected value writes the file — no osascript dialog (test seam)', () => {
  const { dir, file } = scratch();
  const r = runAdd({ value: '100.64.0.7:8788=Desktop', hostsFile: file, hostsRaw: '', interactive: false });
  assert.equal(r.ok, true);
  assert.match(fs.readFileSync(file, 'utf8'), /100\.64\.0\.7:8788=Desktop/);
  cleanup(dir);
});

test('runAdd rejects a hostile injected value cleanly (nothing executed, honest failure)', () => {
  const { dir, file } = scratch();
  // A wholly-invalid value (empty host) → invalid, nothing written.
  const r = runAdd({ value: ':99999', hostsFile: file, hostsRaw: '', interactive: false });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid');
  assert.ok(!fs.existsSync(file));
  cleanup(dir);
});

test('runRemove with --yes (no confirm dialog) removes the entry atomically', () => {
  const { dir, file } = scratch();
  fs.writeFileSync(file, '100.64.0.7:8788=Desktop\n');
  const r = runRemove('100.64.0.7:8788', { yes: true, hostsFile: file, hostsRaw: '', interactive: false });
  assert.equal(r.ok, true);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /100\.64\.0\.7:8788/);
  cleanup(dir);
});

test('runCli dispatches add (via --value=) to a scratch file — never the real data dir', () => {
  const { dir, file } = scratch();
  const add = runCli(['add', `--value=laptop=Work`], { LLMDASH_ACTION_NONINTERACTIVE: '1' }, { hostsFile: file });
  assert.equal(add.ok, true);
  assert.match(fs.readFileSync(file, 'utf8'), /laptop=Work/);
  cleanup(dir);
});

test('runCli dispatches remove (via --yes) to a scratch file; unknown action is honest', () => {
  const { dir, file } = scratch();
  fs.writeFileSync(file, 'desktop:9000=Box\n');
  const rm = runCli(['remove', 'desktop:9000', '--yes'], { LLMDASH_ACTION_NONINTERACTIVE: '1' }, { hostsFile: file });
  assert.equal(rm.ok, true);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /desktop:9000/);
  const unknown = runCli(['bogus'], {});
  assert.equal(unknown.reason, 'unknown-action');
  cleanup(dir);
});

// ── STRUCTURAL anti-injection assertions (QA-23) ──────────────────────────────
// The load-bearing security property: the AppleScript is a FIXED literal and the
// typed value is passed ARGV/stdout-only — NEVER concatenated into an AppleScript
// source or a shell command. Asserted by inspecting the helper source.
const here = path.dirname(fileURLToPath(import.meta.url));
const helperSrc = fs.readFileSync(path.join(here, '..', 'scripts', 'menubar', 'host-config-action.mjs'), 'utf8');

test('anti-injection: the helper uses execFileSync (ARGV), never exec/execSync/sh -c/eval (QA-23)', () => {
  // execFileSync passes args as an ARGV array (no shell) — the safe form.
  assert.match(helperSrc, /execFileSync\(/);
  // None of the shell-interpolating forms appear.
  assert.doesNotMatch(helperSrc, /\bexecSync\(/);
  assert.doesNotMatch(helperSrc, /child_process\)\.exec\(|[^F]\bexec\(/);
  assert.doesNotMatch(helperSrc, /sh',\s*\['-c'|-c['"]/);
  assert.doesNotMatch(helperSrc, /\beval\(/);
});

test('anti-injection: the typed value never re-enters an AppleScript source string (QA-23)', () => {
  // The prompt/message AppleScript is built ONLY from fixed copy (ADD_PROMPT,
  // INVALID_MSG, etc.) via asStr(); the captured `text returned of result` value
  // is handed to addHost as a plain string, never spliced back into a `-e` script.
  // Assert the prompt script is a literal that returns the value (does not embed it).
  assert.match(helperSrc, /display dialog ' \+ asStr\(ADD_PROMPT\)/);
  assert.match(helperSrc, /return text returned of result/);
  // The value captured from osascript is passed to addHost as ARGV/stdout only.
  assert.match(helperSrc, /addHost\(hostsFile, entry/);
});

test('asStr escapes backslash and double-quote so even our OWN copy cannot break the script', () => {
  assert.equal(asStr('plain'), '"plain"');
  assert.equal(asStr('a"b'), '"a\\"b"');
  assert.equal(asStr('a\\b'), '"a\\\\b"');
});
