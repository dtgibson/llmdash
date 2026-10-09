// Targeted security proof only. Synthetic scanner callbacks; no HTTP listener,
// poller, real logs, providers, peers, preview service or physical devices.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

for (const key of Object.keys(process.env)) if (key.startsWith('LLMDASH_')) delete process.env[key];
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-warming-security-'));
for (const name of ['data', 'claude/projects', 'codex/sessions']) fs.mkdirSync(path.join(temporary, name), { recursive: true });
fs.writeFileSync(path.join(temporary, 'data/hosts.conf'), '');
Object.assign(process.env, {
  LLMDASH_HOST: '127.0.0.1', LLMDASH_PORT: '0', LLMDASH_HOSTS: '',
  LLMDASH_DATA_DIR: path.join(temporary, 'data'),
  LLMDASH_CLAUDE_DIR: path.join(temporary, 'claude'),
  LLMDASH_CODEX_DIR: path.join(temporary, 'codex'),
  LLMDASH_CLAUDE_AUTOREFRESH: '0',
  LLMDASH_CLAUDE_CMD: '/usr/bin/false', LLMDASH_CODEX_CMD: '/usr/bin/false',
});

const rows = [];
let db;
try {
  const { clearCodexStatsCache, codexScanStatus, computeCodexActivity,
    getCodexInsights, refreshCodexAnalytics } = await import('../../../src/codex-stats.js');
  const { buildTrends } = await import('../../../src/trends.js');
  const { getDb } = await import('../../../src/db.js');
  db = getDb();
  const now = Date.UTC(2026, 9, 8, 20);
  const privateValue = 'SECURITY_PRIVATE_<img src=x onerror=alert(1)>_/private/session/log_token';
  const assertFrozen = expected => {
    const status = codexScanStatus();
    assert.equal(status.state, expected);
    assert.deepEqual(Object.keys(status).sort(), ['generatedAt', 'state']);
    assert.equal(Object.isFrozen(status), true);
    assert.throws(() => { status.state = privateValue; }, TypeError);
    assert.equal(codexScanStatus(), status);
    return status;
  };
  const outputs = () => [computeCodexActivity(), getCodexInsights(), buildTrends('7d', now).tools[1]];
  const assertPrivate = values => assert.equal(JSON.stringify(values).includes(privateValue), false);

  clearCodexStatsCache();
  const cold = assertFrozen('warming');
  assert.equal(refreshCodexAnalytics(now, () => { throw new Error(privateValue); }), false);
  const failed = assertFrozen('error');
  assert.notEqual(failed, cold);
  assertPrivate(outputs());
  rows.push('frozen allowlisted state; cold thrown message omitted from all three payloads');

  const usage = [{ tsMs: now - 1000, input: 100, output: 10, cached: 40,
    sessionKey: privateValue, turnKey: privateValue, model: 'gpt-5', path: privateValue, content: privateValue }];
  const goodScan = () => ({ usage, completions: [], compactions: [], tools: [], capabilities: {} });
  assert.equal(refreshCodexAnalytics(now, goodScan), true);
  const ready = assertFrozen('ready');
  assert.notEqual(ready, failed);
  const good = outputs();
  assert.equal(good[0].tokens.week, 110);
  assertPrivate(good);
  rows.push('synthetic private identifiers/content remain internal; aggregate publication succeeds');

  // The changed catch also encloses aggregation: a failure while constructing
  // the next publication must retain the previous one and omit its exception.
  const broken = { ...usage[0] };
  Object.defineProperty(broken, 'input', { get() { throw new Error(privateValue); } });
  assert.equal(refreshCodexAnalytics(now + 1, () => ({ ...goodScan(), usage: [broken] })), false);
  assertFrozen('error');
  const retained = outputs();
  assert.deepEqual(retained[0], { ...good[0], scanState: 'error' });
  assert.deepEqual(retained[1], { ...good[1], scanState: 'error' });
  assert.deepEqual(retained[2], { ...good[2], activityState: 'error' });
  assertPrivate(retained);
  rows.push('aggregation exception retains last-good aggregates/time; exception content stays private');

  const beforeRecovery = codexScanStatus();
  assert.equal(refreshCodexAnalytics(now, goodScan), true);
  assert.notEqual(assertFrozen('ready'), beforeRecovery);
  assert.deepEqual(outputs(), good);
  rows.push('same-timestamp recovery changes identity and clears cached failure immediately');

  const app = fs.readFileSync(new URL('../../../public/app.js', import.meta.url), 'utf8');
  const errorLiteral = app.slice(app.indexOf('const CODEX_SCAN_ERROR_COPY'), app.indexOf('\n', app.indexOf('const CODEX_SCAN_ERROR_COPY')));
  const escLiteral = app.split('\n').find(line => line.startsWith('const esc = '));
  const noteCode = app.slice(app.indexOf('const TREND_ACTIVITY_COPY'), app.indexOf('function trendContentHtml'));
  const context = vm.createContext({ tool: null });
  vm.runInContext(escLiteral + '\n' + errorLiteral + '\n' + noteCode, context);
  const note = state => {
    context.tool = { activityState: state, label: privateValue };
    return vm.runInContext('trendActivityNote(tool)', context);
  };
  assert.equal(note('error'), "This machine's local Codex session logs could not be read.");
  for (const state of [privateValue, 'constructor', '__proto__', 'toString', null,
    { toString() { throw new Error('must not coerce unknown enum'); } }]) assert.equal(note(state), null);
  assert.equal(note('warming').includes('<img'), false);
  assert.equal(note('warming').includes('&lt;img'), true);
  rows.push('client maps only own enum keys; errors use fixed text and warming labels are escaped');

  console.log(JSON.stringify({ result: 'PASSED', nodeVersion: process.version,
    checks: rows, isolation: { clearedLlmdash: true, disposableRoots: true, emptyHosts: true,
      autoRefresh: false, providerCommands: '/usr/bin/false', scannerCallbacks: 'synthetic only',
      httpListener: false, vm: 'note helper only; no browser/layout claim' } }, null, 2));
} finally {
  db?.close();
  fs.rmSync(temporary, { recursive: true, force: true });
}
