import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  summarizeCpu,
  cpuDelta,
  parseVmStat,
  runVmStat,
  normalizeStatfs,
  runStatfs,
  effectivePollInterval,
  refreshDeviceHealth,
  getDeviceHealthSnapshot,
  _resetDeviceHealth,
} from '../src/device-health.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const cpu = (user, idle, extra = {}) => ({
  model: 'test', speed: 1,
  times: { user, nice: 0, sys: 0, idle, irq: 0, ...extra },
});
const okDisk = (availableBytes = 250 * (1024 ** 3), totalBytes = 1024 ** 4) =>
  async () => ({ ok: true, availableBytes, totalBytes, availablePct: 100 * availableBytes / totalBytes });
const okRam = (usedPct = 50) => async () => ({ ok: true, usedPct });

test.beforeEach(() => _resetDeviceHealth({ platform: 'darwin', pollIntervalMs: 60_000 }));

test('CPU summaries aggregate logical counters and deterministic deltas', () => {
  const before = summarizeCpu([cpu(100, 900), cpu(300, 700)], 1_000);
  const after = summarizeCpu([cpu(200, 1_000), cpu(500, 900)], 61_000);
  assert.deepEqual(before, { logicalCount: 2, totalMs: 2_000, idleMs: 1_600, observedAtMs: 1_000 });
  assert.deepEqual(cpuDelta(before, after), { ok: true, usedPct: 50, intervalMs: 60_000 });
  assert.equal(cpuDelta(
    summarizeCpu([cpu(0, 100)], 0), summarizeCpu([cpu(0, 200)], 60_000),
  ).usedPct, 0);
  assert.equal(cpuDelta(
    summarizeCpu([cpu(0, 100)], 0), summarizeCpu([cpu(100, 100)], 60_000),
  ).usedPct, 100);
});

test('CPU rejects malformed, zero-delta, count-change, regression, and overlong observations', () => {
  assert.equal(summarizeCpu([], 0), null);
  assert.equal(summarizeCpu([{ times: { user: NaN, nice: 0, sys: 0, idle: 1, irq: 0 } }], 0), null);
  const base = summarizeCpu([cpu(100, 100)], 0);
  assert.equal(cpuDelta(base, summarizeCpu([cpu(100, 100)], 60_000)).reason, 'counter-invalid');
  assert.equal(cpuDelta(base, summarizeCpu([cpu(110, 110), cpu(1, 1)], 60_000)).reason, 'counter-reset');
  assert.equal(cpuDelta(base, summarizeCpu([cpu(80, 110)], 60_000)).reason, 'counter-reset');
  assert.equal(cpuDelta(base, summarizeCpu([cpu(110, 110)], 86_400_001)).reason, 'counter-reset');
});

test('first CPU sample measures, second publishes usage, and a count change rebaselines', async () => {
  const readings = [
    [cpu(100, 900)],
    [cpu(200, 1_000)],
    [cpu(300, 1_100), cpu(10, 90)],
    [cpu(400, 1_200), cpu(20, 180)],
  ];
  const sample = async (nowMs) => refreshDeviceHealth({
    nowMs, platform: 'darwin', cpusImpl: () => readings.shift(), ramProbe: okRam(), statfsProbe: okDisk(),
  });
  const first = await sample(0);
  assert.equal(first.cpu.status, 'measuring');
  assert.equal(first.cpu.reason, 'baseline-required');
  const second = await sample(60_000);
  assert.equal(second.cpu.status, 'available');
  assert.equal(second.cpu.usedPct, 50);
  const reset = await sample(120_000);
  assert.equal(reset.cpu.updateStatus, 'failed');
  assert.equal(reset.cpu.reason, 'counter-reset');
  assert.equal(reset.cpu.capturedAt, second.cpu.capturedAt);
  const recovered = await sample(180_000);
  assert.equal(recovered.cpu.updateStatus, 'ok');
  assert.equal(recovered.cpu.intervalMs, 60_000);
});

test('vm_stat parser accepts current and legacy compressor labels and exact memory classes', () => {
  const banner = 'Mach Virtual Memory Statistics: (page size of 4096 bytes)\n';
  const fields = 'Pages active: 100.\nPages wired down: 20.\nPages purgeable: 30.\n';
  const current = parseVmStat(`${banner}${fields}Pages occupied by compressor: 10.\n`, 4096 * 200);
  const legacy = parseVmStat(`${banner}${fields}Pages used by VM compressor: 10.\n`, 4096 * 200);
  assert.deepEqual(current, { usedPct: 50 });
  assert.deepEqual(legacy, current);
});

test('vm_stat parser rejects missing, duplicate, conflicting, malformed, and oversized fields', () => {
  const base = 'Mach Virtual Memory Statistics: (page size of 4096 bytes)\nPages active: 10.\nPages wired down: 2.\nPages purgeable: 1.\n';
  assert.equal(parseVmStat(base, 4096 * 100), null);
  assert.equal(parseVmStat(`${base}Pages active: 11.\nPages occupied by compressor: 1.\n`, 4096 * 100), null);
  assert.equal(parseVmStat(`${base}Pages occupied by compressor: 1.\nPages used by VM compressor: 1.\n`, 4096 * 100), null);
  assert.equal(parseVmStat(base.replace('10.', '-1.') + 'Pages occupied by compressor: 1.\n', 4096 * 100), null);
  assert.equal(parseVmStat('x'.repeat(32 * 1024 + 1), 1), null);
});

test('RAM probe is bounded and classifies unsupported, timeout, cap, failure, and parse errors', async () => {
  assert.deepEqual(await runVmStat({ platform: 'linux' }), {
    ok: false, unsupported: true, reason: 'unsupported-platform',
  });
  const invoke = (error, stdout = '') => runVmStat({
    platform: 'darwin', totalmemImpl: () => 1,
    execFileImpl: (file, args, opts, cb) => {
      assert.equal(file, '/usr/bin/vm_stat');
      assert.deepEqual(args, []);
      assert.equal(opts.timeout, 2_000);
      assert.equal(opts.maxBuffer, 32 * 1024);
      assert.equal(opts.env.LC_ALL, 'C');
      cb(error, stdout);
    },
  });
  assert.equal((await invoke(Object.assign(new Error('timeout'), { killed: true }))).reason, 'probe-timeout');
  assert.equal((await invoke(Object.assign(new Error('maxBuffer exceeded'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }))).reason, 'output-too-large');
  assert.equal((await invoke(new Error('spawn failed'))).reason, 'probe-failed');
  assert.equal((await invoke(null, 'bad output')).reason, 'parse-failed');
});

test('statfs normalization uses bavail, supports BigInt, and rejects impossible or unsafe values', () => {
  const parsed = normalizeStatfs({ blocks: 1_024n, bfree: 900n, bavail: 250n, bsize: 1_024n });
  assert.deepEqual(parsed, { totalBytes: 1_048_576, availableBytes: 256_000, availablePct: 24.4140625 });
  assert.equal(normalizeStatfs({ blocks: 0n, bavail: 0n, bsize: 1n }), null);
  assert.equal(normalizeStatfs({ blocks: 10n, bavail: 11n, bsize: 1n }), null);
  assert.equal(normalizeStatfs({ blocks: BigInt(Number.MAX_SAFE_INTEGER) + 1n, bavail: 1n, bsize: 1n }), null);
  assert.equal(normalizeStatfs({ blocks: 10n, bavail: -1n, bsize: 1n }), null);
});

test('disk probe targets the data volume with bigint, is deadline-bounded, and prevents backlog', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const first = runStatfs({
    dataDir: '/bounded-test-volume', timeoutMs: 100,
    statfsImpl: async (target, options) => {
      calls += 1;
      assert.equal(target, '/bounded-test-volume');
      assert.deepEqual(options, { bigint: true });
      return pending;
    },
  });
  const overlapping = await runStatfs({ statfsImpl: async () => { calls += 1; } });
  assert.deepEqual(overlapping, { ok: false, reason: 'statfs-timeout' });
  assert.equal(calls, 1);
  release({ blocks: 10n, bavail: 4n, bfree: 9n, bsize: 2n });
  assert.deepEqual(await first, {
    ok: true, totalBytes: 20, availableBytes: 8, availablePct: 40,
  });
  const timedOut = await runStatfs({ statfsImpl: async () => new Promise(() => {}), timeoutMs: 2 });
  assert.deepEqual(timedOut, { ok: false, reason: 'statfs-timeout' });
});

test('last-good values retain capturedAt while failed attempts advance attemptedAt independently', async () => {
  const cpus = [[cpu(100, 900)], [cpu(200, 1_000)], [cpu(300, 1_100)]];
  const call = (nowMs, ramProbe = okRam(60), statfsProbe = okDisk()) => refreshDeviceHealth({
    nowMs, platform: 'darwin', cpusImpl: () => cpus.shift(), ramProbe, statfsProbe,
  });
  await call(0);
  const good = await call(60_000);
  const failed = await call(120_000,
    async () => { throw new Error('private detail'); }, async () => ({ ok: false, reason: 'statfs-failed' }));
  assert.equal(failed.ram.status, 'available');
  assert.equal(failed.ram.capturedAt, good.ram.capturedAt);
  assert.equal(failed.ram.attemptedAt, new Date(120_000).toISOString());
  assert.equal(failed.ram.updateStatus, 'failed');
  assert.equal(failed.ram.reason, 'probe-failed');
  assert.equal(failed.disk.capturedAt, good.disk.capturedAt);
  assert.equal(failed.disk.reason, 'statfs-failed');
  assert.doesNotMatch(JSON.stringify(failed), /private detail/);
});

test('snapshot reads are detached and overlapping refreshes share one collection', async () => {
  let release;
  const diskWait = new Promise((resolve) => { release = resolve; });
  let ramCalls = 0;
  const options = {
    nowMs: 1_000, platform: 'darwin', cpusImpl: () => [cpu(1, 9)],
    ramProbe: async () => { ramCalls += 1; return { ok: true, usedPct: 40 }; },
    statfsProbe: async () => diskWait,
  };
  const a = refreshDeviceHealth(options);
  const b = refreshDeviceHealth(options);
  release({ ok: true, availableBytes: 5, totalBytes: 10, availablePct: 50 });
  const [one, two] = await Promise.all([a, b]);
  assert.deepEqual(one, two);
  assert.equal(ramCalls, 1);
  const detached = getDeviceHealthSnapshot();
  detached.disk.target = 'changed';
  assert.equal(getDeviceHealthSnapshot().disk.target, 'data-volume');
});

test('poll interval normalization is bounded with a one-minute fallback', () => {
  assert.equal(effectivePollInterval(15_000), 15_000);
  assert.equal(effectivePollInterval(999), 60_000);
  assert.equal(effectivePollInterval(Infinity), 60_000);
  assert.equal(effectivePollInterval(86_400_001), 60_000);
});

test('polling is the only refresh owner and device health adds no persistence or request-path probe', () => {
  const poller = read('src', 'poller.js');
  const server = read('src', 'server.js');
  const db = read('src', 'db.js');
  assert.equal((poller.match(/await refreshDeviceHealth\(\{ nowMs \}\)/g) || []).length, 1);
  assert.ok(poller.indexOf('await refreshDeviceHealth({ nowMs })') < poller.indexOf('await writeLocalHost('));
  assert.doesNotMatch(server, /refreshDeviceHealth/);
  assert.match(server, /deviceHealth: getDeviceHealthSnapshot\(\)/);
  assert.doesNotMatch(db, /device.?health/i);
  assert.doesNotMatch(read('src', 'device-health.js'), /insertSnapshot|CREATE TABLE|ALTER TABLE/);
});
