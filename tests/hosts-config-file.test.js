import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readHostsConfig, seedHostsConfigIfAbsent, writeHostsConfig, listHosts,
  configFileHealth, _resetConfigErrorLatch,
} from '../src/host-config.js';
import { parseHosts } from '../src/hosts.js';

// The config-file layer is pure/injectable: every function takes hostsFile +
// hostsRaw + fs, so parse/merge/precedence and the write round-trip are tested
// against a scratch temp dir — never the real data dir. (QA-01/02/04/05.)
const cfg = { port: 8787, host: '0.0.0.0' };
const noTailnet = null;

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-hostsconf-'));
  return { dir, file: path.join(dir, 'hosts.conf') };
}
function cleanup(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }

// ── Precedence: file present ⇒ file wins, LLMDASH_HOSTS ignored (QA-02) ────────
test('file present ⇒ source "file"; its lines are the remote set (QA-01/02)', () => {
  const { dir, file } = scratch();
  fs.writeFileSync(file, '# a comment\n100.64.0.7:8788=Desktop\nlaptop=Work Laptop\n');
  const r = readHostsConfig({ hostsFile: file, hostsRaw: 'IGNORED:9999=Ghost', fs });
  assert.equal(r.source, 'file');
  assert.equal(r.error, null);
  // The file body ↔ LLMDASH_HOSTS grammar parity: parseHosts consumes r.raw.
  const { hosts } = parseHosts(r.raw, cfg, noTailnet);
  const peers = hosts.filter((h) => !h.self);
  assert.deepEqual(peers.map((p) => p.label), ['Desktop', 'Work Laptop']);
  assert.deepEqual(peers.map((p) => p.host), ['100.64.0.7', 'laptop']);
  // The env is IGNORED because the file exists.
  assert.ok(!r.raw.includes('Ghost'));
  cleanup(dir);
});

test('file body ↔ LLMDASH_HOSTS grammar parity: comma-joined lines == env string (QA-01)', () => {
  const { dir, file } = scratch();
  fs.writeFileSync(file, 'a=Alpha\nb:9000=Bravo\n100.64.0.9=Charlie\n');
  const r = readHostsConfig({ hostsFile: file, hostsRaw: '', fs });
  const fromFile = parseHosts(r.raw, cfg, noTailnet).hosts.filter((h) => !h.self);
  const fromEnv = parseHosts('a=Alpha,b:9000=Bravo,100.64.0.9=Charlie', cfg, noTailnet).hosts.filter((h) => !h.self);
  assert.deepEqual(fromFile.map((p) => [p.host, p.port, p.label]),
    fromEnv.map((p) => [p.host, p.port, p.label]));
  cleanup(dir);
});

// ── Precedence: file absent + env ⇒ seed-once, then file authoritative (QA-02) ─
test('file absent + LLMDASH_HOSTS set ⇒ seed the file once, source "env-seed" (QA-02)', () => {
  const { dir, file } = scratch();
  assert.ok(!fs.existsSync(file));
  const r = readHostsConfig({ hostsFile: file, hostsRaw: '100.64.0.7:8788=Desktop', fs });
  assert.equal(r.source, 'env-seed');
  // The file now EXISTS (seeded).
  assert.ok(fs.existsSync(file), 'the env seed wrote the file once');
  const body = fs.readFileSync(file, 'utf8');
  assert.match(body, /^# llmdash watched hosts/m); // has the header
  assert.match(body, /100\.64\.0\.7:8788=Desktop/);
  const peers = parseHosts(r.raw, cfg, noTailnet).hosts.filter((h) => !h.self);
  assert.equal(peers[0].label, 'Desktop');
  cleanup(dir);
});

test('seed-once: editing LLMDASH_HOSTS after the file exists does NOTHING (file wins, QA-02)', () => {
  const { dir, file } = scratch();
  // First read seeds from env.
  readHostsConfig({ hostsFile: file, hostsRaw: 'a=Alpha', fs });
  // Now the env changes; the file already exists → the env is ignored.
  const r = readHostsConfig({ hostsFile: file, hostsRaw: 'b=Bravo,c=Charlie', fs });
  assert.equal(r.source, 'file');
  const peers = parseHosts(r.raw, cfg, noTailnet).hosts.filter((h) => !h.self);
  assert.deepEqual(peers.map((p) => p.label), ['Alpha']); // still the seeded value
  cleanup(dir);
});

// ── Precedence: neither ⇒ single-host, byte-for-byte today (QA-02) ────────────
test('neither file nor env ⇒ source "none", raw "" ⇒ single-host (QA-02)', () => {
  const { dir, file } = scratch();
  const r = readHostsConfig({ hostsFile: file, hostsRaw: '', fs });
  assert.equal(r.source, 'none');
  assert.equal(r.raw, '');
  assert.ok(!fs.existsSync(file), 'nothing written when neither is set');
  const { hosts } = parseHosts(r.raw, cfg, noTailnet);
  assert.equal(hosts.length, 1);
  assert.equal(hosts[0].self, true);
  cleanup(dir);
});

// ── The empty-vs-absent corner: an empty file wins, env does NOT re-seed (QA-02) ─
test('existing-but-EMPTY file ⇒ zero remotes; env does NOT re-seed (Remove sticks, QA-02 corner)', () => {
  const { dir, file } = scratch();
  // The operator removed every peer → an empty (comment-only) file.
  fs.writeFileSync(file, '# all peers removed\n');
  const r = readHostsConfig({ hostsFile: file, hostsRaw: 'ghost=Ghost', fs });
  assert.equal(r.source, 'file');
  assert.equal(r.raw, '');
  const peers = parseHosts(r.raw, cfg, noTailnet).hosts.filter((h) => !h.self);
  assert.equal(peers.length, 0, 'the env seed must NOT resurrect removed hosts');
  cleanup(dir);
});

// ── Malformed individual line ⇒ errors[], surfaced not fabricated (QA-04) ─────
test('a malformed line flows to parseHosts errors[], never fabricated (QA-04)', () => {
  const { dir, file } = scratch();
  fs.writeFileSync(file, 'good\nbad:99999\n');
  const r = readHostsConfig({ hostsFile: file, hostsRaw: '', fs });
  assert.equal(r.source, 'file');
  const parsed = parseHosts(r.raw, cfg, noTailnet);
  assert.equal(parsed.hosts.filter((h) => !h.self).length, 1); // only "good"
  assert.equal(parsed.errors.length, 1);
  assert.equal(parsed.errors[0].reason, 'bad-port');
  cleanup(dir);
});

// ── Unreadable file ⇒ fall back + log once + no crash (QA-04) ─────────────────
test('unreadable file ⇒ error{unreadable}, falls back to env seed, logs ONCE, no crash (QA-04)', () => {
  _resetConfigErrorLatch();
  const file = '/some/hosts.conf';
  // An injected fs that says the file exists but throws on read (permission/IO).
  const throwingFs = {
    existsSync: () => true,
    readFileSync: () => { const e = new Error('EACCES'); throw e; },
    writeFileSync: () => {},
    renameSync: () => {},
    unlinkSync: () => {},
  };
  const logs = [];
  const origErr = console.error;
  console.error = (m) => logs.push(String(m));
  try {
    const r1 = readHostsConfig({ hostsFile: file, hostsRaw: 'a=Alpha', fs: throwingFs });
    const r2 = readHostsConfig({ hostsFile: file, hostsRaw: 'a=Alpha', fs: throwingFs });
    // Falls back to the env seed as the last-good remote set.
    assert.equal(r1.error.reason, 'unreadable');
    assert.equal(r2.error.reason, 'unreadable');
    const peers = parseHosts(r1.raw, cfg, noTailnet).hosts.filter((h) => !h.self);
    assert.equal(peers[0].label, 'Alpha');
  } finally {
    console.error = origErr;
  }
  // Logged exactly ONCE across the two ticks (the once-latch), not per tick.
  const unreadableLogs = logs.filter((l) => /unreadable/.test(l));
  assert.equal(unreadableLogs.length, 1, 'the unreadable failure logs once, not every tick');
  _resetConfigErrorLatch();
});

test('a recovered file re-arms the once-latch (a later failure logs again)', () => {
  _resetConfigErrorLatch();
  const { dir, file } = scratch();
  let mode = 'throw';
  const wrapFs = {
    existsSync: (p) => fs.existsSync(p),
    readFileSync: (p, enc) => { if (mode === 'throw') throw new Error('EACCES'); return fs.readFileSync(p, enc); },
    writeFileSync: (...a) => fs.writeFileSync(...a),
    renameSync: (...a) => fs.renameSync(...a),
    unlinkSync: (...a) => fs.unlinkSync(...a),
  };
  fs.writeFileSync(file, 'a=Alpha\n');
  const logs = [];
  const origErr = console.error; console.error = (m) => logs.push(String(m));
  try {
    readHostsConfig({ hostsFile: file, hostsRaw: '', fs: wrapFs }); // fails, logs once
    mode = 'ok';
    const rOk = readHostsConfig({ hostsFile: file, hostsRaw: '', fs: wrapFs }); // recovers
    assert.equal(rOk.error, null);
    mode = 'throw';
    readHostsConfig({ hostsFile: file, hostsRaw: '', fs: wrapFs }); // fails again → logs again
  } finally { console.error = origErr; }
  assert.equal(logs.filter((l) => /unreadable/.test(l)).length, 2, 'recovery re-arms the latch');
  cleanup(dir);
  _resetConfigErrorLatch();
});

// ── The !local directive is parsed as a real knob (QA-19) ─────────────────────
test('!local= directive parses include/exclude/auto; default auto; bad value ⇒ error + auto (QA-19)', () => {
  const { dir, file } = scratch();
  fs.writeFileSync(file, '!local=exclude\n100.64.0.7=Desktop\n');
  assert.equal(readHostsConfig({ hostsFile: file, hostsRaw: '', fs }).localMode, 'exclude');
  fs.writeFileSync(file, '!local=include\nx=X\n');
  assert.equal(readHostsConfig({ hostsFile: file, hostsRaw: '', fs }).localMode, 'include');
  fs.writeFileSync(file, 'x=X\n'); // no directive
  assert.equal(readHostsConfig({ hostsFile: file, hostsRaw: '', fs }).localMode, 'auto');
  fs.writeFileSync(file, '!local=banana\nx=X\n'); // bad value
  const r = readHostsConfig({ hostsFile: file, hostsRaw: '', fs });
  assert.equal(r.localMode, 'auto');
  assert.ok(r.fileErrors.some((e) => e.reason === 'bad-local-directive'));
  cleanup(dir);
});

test('!local directive is NOT treated as a host entry', () => {
  const { dir, file } = scratch();
  fs.writeFileSync(file, '!local=exclude\n100.64.0.7=Desktop\n');
  const r = readHostsConfig({ hostsFile: file, hostsRaw: '', fs });
  const peers = parseHosts(r.raw, cfg, noTailnet).hosts.filter((h) => !h.self);
  assert.equal(peers.length, 1);
  assert.equal(peers[0].label, 'Desktop'); // the directive did not leak into the host set
  cleanup(dir);
});

// ── writeHostsConfig: atomic + preserves the directive ────────────────────────
test('writeHostsConfig writes atomically (no temp leaks), keeps the directive, strips newlines', () => {
  const { dir, file } = scratch();
  writeHostsConfig(file, ['a=Alpha', 'b:9000=Bra\nvo'], { fs, localMode: 'exclude' });
  const body = fs.readFileSync(file, 'utf8');
  assert.match(body, /!local=exclude/);
  assert.match(body, /a=Alpha/);
  assert.match(body, /b:9000=Bravo/); // the injected newline was stripped
  // No temp file leaked.
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('.tmp.')), []);
  cleanup(dir);
});

// ── seedHostsConfigIfAbsent: explicit, idempotent ────────────────────────────
test('seedHostsConfigIfAbsent writes iff absent+env; idempotent on a present file', () => {
  const { dir, file } = scratch();
  assert.equal(seedHostsConfigIfAbsent({ hostsFile: file, hostsRaw: '', fs }), false); // no env
  assert.ok(!fs.existsSync(file));
  assert.equal(seedHostsConfigIfAbsent({ hostsFile: file, hostsRaw: 'a=Alpha', fs }), true); // seeded
  assert.ok(fs.existsSync(file));
  const before = fs.readFileSync(file, 'utf8');
  assert.equal(seedHostsConfigIfAbsent({ hostsFile: file, hostsRaw: 'b=Bravo', fs }), false); // present → no-op
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'a present file is never re-seeded');
  cleanup(dir);
});

// ── listHosts: the current remote set (never the local host) ─────────────────
test('listHosts returns the remote entries only (never the local host)', () => {
  const { dir, file } = scratch();
  fs.writeFileSync(file, '100.64.0.7:8788=Desktop\nlaptop=Work Laptop\n');
  const hosts = listHosts({ hostsFile: file, hostsRaw: '', fs, cfg, tailnet: null });
  assert.deepEqual(hosts.map((h) => h.label), ['Desktop', 'Work Laptop']);
  assert.ok(hosts.every((h) => !String(h.key).startsWith('local:')));
  cleanup(dir);
});

// ── configFileHealth: names the state + the env-ignored note ─────────────────
test('configFileHealth reports source, envIgnored, and directive/file errors (QA-21)', () => {
  const { dir, file } = scratch();
  // Present file + env set → source file, env ignored.
  fs.writeFileSync(file, '100.64.0.7=Desktop\n');
  const h1 = configFileHealth({ hostsFile: file, hostsRaw: 'ghost=Ghost', fs });
  assert.equal(h1.source, 'file');
  assert.equal(h1.envIgnored, true);
  assert.equal(h1.file, file);
  // Missing file + no env → source none, not ignored.
  cleanup(dir);
  const { dir: d2, file: f2 } = scratch();
  const h2 = configFileHealth({ hostsFile: f2, hostsRaw: '', fs });
  assert.equal(h2.source, 'none');
  assert.equal(h2.envIgnored, false);
  cleanup(d2);
});
