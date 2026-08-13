// Poller-owned device health snapshot. CPU uses builtin cumulative counters;
// RAM uses one bounded macOS vm_stat probe; disk uses builtin statfs on the
// llmdash data directory. HTTP handlers only read the detached in-memory cache.

import fs from 'node:fs';
import os from 'node:os';
import { execFile as execFileCallback } from 'node:child_process';
import { config } from '../config.js';

const PROBE_TIMEOUT_MS = 2_000;
const PROBE_MAX_BYTES = 32 * 1024;
const MAX_INTERVAL_MS = 86_400_000;
const DEFAULT_POLL_MS = 60_000;

const CPU_REASONS = new Set([
  'baseline-required', 'counter-unavailable', 'counter-invalid', 'counter-reset',
]);
const RAM_REASONS = new Set([
  'unsupported-platform', 'probe-timeout', 'probe-failed', 'output-too-large',
  'parse-failed', 'invalid-values',
]);
const DISK_REASONS = new Set(['statfs-timeout', 'statfs-failed', 'invalid-values']);

export function effectivePollInterval(value = config.pollIntervalMs) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1_000 && n <= MAX_INTERVAL_MS
    ? Math.round(n) : DEFAULT_POLL_MS;
}

function iso(nowMs) {
  const n = Number(nowMs);
  const date = new Date(Number.isFinite(n) ? n : Date.now());
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function cpuEmpty() {
  return {
    status: 'measuring', usedPct: null, capturedAt: null, attemptedAt: null,
    updateStatus: 'pending', reason: 'baseline-required', intervalMs: null,
  };
}

function ramEmpty(platform = process.platform) {
  if (platform !== 'darwin') {
    return {
      status: 'unsupported', usedPct: null, capturedAt: null, attemptedAt: null,
      updateStatus: 'unsupported', reason: 'unsupported-platform',
    };
  }
  return {
    status: 'unavailable', usedPct: null, capturedAt: null, attemptedAt: null,
    updateStatus: 'pending', reason: null,
  };
}

function diskEmpty() {
  return {
    status: 'unavailable', availableBytes: null, totalBytes: null,
    availablePct: null, target: 'data-volume', capturedAt: null,
    attemptedAt: null, updateStatus: 'pending', reason: null,
  };
}

let snapshot = {
  scope: 'device',
  pollIntervalMs: effectivePollInterval(),
  cpu: cpuEmpty(),
  ram: ramEmpty(),
  disk: diskEmpty(),
};
let cpuBaseline = null;
let refreshInFlight = null;
let diskInFlight = null;

function detached(value) {
  return structuredClone(value);
}

export function getDeviceHealthSnapshot() {
  return detached(snapshot);
}

export function summarizeCpu(cpus, observedAtMs) {
  if (!Array.isArray(cpus) || cpus.length === 0) return null;
  let totalMs = 0;
  let idleMs = 0;
  for (const cpu of cpus) {
    const times = cpu && cpu.times;
    if (!times) return null;
    const values = ['user', 'nice', 'sys', 'idle', 'irq'].map((key) => Number(times[key]));
    if (values.some((value) => !Number.isFinite(value) || value < 0)) return null;
    totalMs += values.reduce((sum, value) => sum + value, 0);
    idleMs += values[3];
  }
  if (!Number.isFinite(totalMs) || !Number.isFinite(idleMs)) return null;
  return { logicalCount: cpus.length, totalMs, idleMs, observedAtMs: Number(observedAtMs) };
}

export function cpuDelta(previous, current) {
  if (!previous || !current) return { ok: false, reason: 'counter-unavailable' };
  const intervalMs = current.observedAtMs - previous.observedAtMs;
  if (current.logicalCount !== previous.logicalCount
    || current.totalMs < previous.totalMs || current.idleMs < previous.idleMs
    || !Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs > MAX_INTERVAL_MS) {
    return { ok: false, reason: 'counter-reset' };
  }
  const total = current.totalMs - previous.totalMs;
  const idle = current.idleMs - previous.idleMs;
  if (!Number.isFinite(total) || !Number.isFinite(idle) || total <= 0 || idle < 0 || idle > total) {
    return { ok: false, reason: 'counter-invalid' };
  }
  const usedPct = Math.min(100, Math.max(0, 100 * (total - idle) / total));
  return { ok: true, usedPct, intervalMs: Math.round(intervalMs) };
}

function collectCpu(nowMs, cpusImpl) {
  let current;
  try { current = summarizeCpu(cpusImpl(), nowMs); } catch { current = null; }
  if (!current) {
    cpuBaseline = null;
    return { ok: false, reason: 'counter-unavailable', baseline: null };
  }
  const previous = cpuBaseline;
  cpuBaseline = current;
  if (!previous) return { ok: false, reason: 'baseline-required', baseline: current };
  return { ...cpuDelta(previous, current), baseline: current };
}

export function parseVmStat(stdout, totalBytes) {
  if (typeof stdout !== 'string' || Buffer.byteLength(stdout, 'utf8') > PROBE_MAX_BYTES) return null;
  const pageMatch = stdout.match(/page size of\s+(\d+)\s+bytes/i);
  const pageSize = pageMatch ? Number(pageMatch[1]) : null;
  const total = Number(totalBytes);
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0
    || !Number.isFinite(total) || total <= 0) return null;

  const fields = new Map();
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^([^:]+):\s*([0-9]+)\.?\s*$/);
    if (!match) continue;
    if (fields.has(match[1])) return null;
    fields.set(match[1], Number(match[2]));
  }
  const integer = (name) => {
    const value = fields.get(name);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  };
  const active = integer('Pages active');
  const wired = integer('Pages wired down');
  const purgeable = integer('Pages purgeable');
  const compressed = integer('Pages occupied by compressor')
    ?? integer('Pages used by VM compressor');
  if (fields.has('Pages occupied by compressor') && fields.has('Pages used by VM compressor')) return null;
  if ([active, wired, purgeable, compressed].some((value) => value == null)) return null;
  const usedPages = Math.max(0, active - purgeable) + wired + compressed;
  const usedBytes = usedPages * pageSize;
  if (!Number.isSafeInteger(usedBytes) || usedBytes < 0) return null;
  return { usedPct: Math.min(100, Math.max(0, 100 * usedBytes / total)) };
}

export function runVmStat({
  execFileImpl = execFileCallback,
  totalmemImpl = os.totalmem,
  platform = process.platform,
} = {}) {
  if (platform !== 'darwin') return Promise.resolve({ ok: false, unsupported: true, reason: 'unsupported-platform' });
  return new Promise((resolve) => {
    execFileImpl('/usr/bin/vm_stat', [], {
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: PROBE_MAX_BYTES,
      windowsHide: true,
      env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
    }, (error, stdout) => {
      if (error) {
        const code = String(error.code || '');
        const message = String(error.message || '');
        const reason = error.killed || code === 'ETIMEDOUT' ? 'probe-timeout'
          : code.includes('MAXBUFFER') || /maxBuffer/i.test(message) ? 'output-too-large'
            : 'probe-failed';
        resolve({ ok: false, reason });
        return;
      }
      const parsed = parseVmStat(stdout, totalmemImpl());
      resolve(parsed ? { ok: true, ...parsed } : { ok: false, reason: 'parse-failed' });
    });
  });
}

export function normalizeStatfs(stat) {
  if (!stat || typeof stat !== 'object') return null;
  try {
    const blocks = BigInt(stat.blocks);
    const availableBlocks = BigInt(stat.bavail);
    const blockSize = BigInt(stat.bsize);
    if (blocks <= 0n || availableBlocks < 0n || blockSize <= 0n) return null;
    const total = blocks * blockSize;
    const available = availableBlocks * blockSize;
    if (available > total || total > BigInt(Number.MAX_SAFE_INTEGER)
      || available > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    const totalBytes = Number(total);
    const availableBytes = Number(available);
    return {
      totalBytes,
      availableBytes,
      availablePct: Math.min(100, Math.max(0, 100 * availableBytes / totalBytes)),
    };
  } catch { return null; }
}

export async function runStatfs({
  statfsImpl = fs.promises.statfs,
  dataDir = config.dataDir,
  timeoutMs = PROBE_TIMEOUT_MS,
} = {}) {
  if (diskInFlight) return { ok: false, reason: 'statfs-timeout' };
  const raw = Promise.resolve().then(() => statfsImpl(dataDir, { bigint: true }));
  diskInFlight = raw;
  void raw.finally(() => { if (diskInFlight === raw) diskInFlight = null; }).catch(() => {});
  let timer;
  try {
    const stat = await Promise.race([
      raw,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('deadline')), timeoutMs); }),
    ]);
    const parsed = normalizeStatfs(stat);
    return parsed ? { ok: true, ...parsed } : { ok: false, reason: 'invalid-values' };
  } catch (error) {
    return { ok: false, reason: error && error.message === 'deadline' ? 'statfs-timeout' : 'statfs-failed' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function failedMetric(previous, attemptedAt, reason, emptyFactory) {
  if (previous && previous.status === 'available') {
    return { ...previous, attemptedAt, updateStatus: 'failed', reason };
  }
  return { ...emptyFactory(), status: 'unavailable', attemptedAt, updateStatus: 'failed', reason };
}

function reduceCpu(previous, result, attemptedAt) {
  if (result.ok) {
    return {
      status: 'available', usedPct: result.usedPct, capturedAt: attemptedAt,
      attemptedAt, updateStatus: 'ok', reason: null, intervalMs: result.intervalMs,
    };
  }
  if (result.reason === 'baseline-required' && previous.status !== 'available') {
    return { ...cpuEmpty(), attemptedAt, updateStatus: 'ok', reason: 'baseline-required' };
  }
  if (result.reason === 'counter-reset' && previous.status !== 'available') {
    return { ...cpuEmpty(), attemptedAt, updateStatus: 'failed', reason: 'counter-reset' };
  }
  return failedMetric(previous, attemptedAt,
    CPU_REASONS.has(result.reason) ? result.reason : 'counter-unavailable', cpuEmpty);
}

function reduceRam(previous, result, attemptedAt, platform) {
  if (result.ok) {
    return { status: 'available', usedPct: result.usedPct, capturedAt: attemptedAt, attemptedAt, updateStatus: 'ok', reason: null };
  }
  if (result.unsupported || result.reason === 'unsupported-platform') {
    return { ...ramEmpty(platform), attemptedAt, updateStatus: 'unsupported' };
  }
  return failedMetric(previous, attemptedAt,
    RAM_REASONS.has(result.reason) ? result.reason : 'probe-failed', () => ramEmpty(platform));
}

function reduceDisk(previous, result, attemptedAt) {
  if (result.ok) {
    return {
      status: 'available', availableBytes: result.availableBytes,
      totalBytes: result.totalBytes, availablePct: result.availablePct,
      target: 'data-volume', capturedAt: attemptedAt, attemptedAt,
      updateStatus: 'ok', reason: null,
    };
  }
  return failedMetric(previous, attemptedAt,
    DISK_REASONS.has(result.reason) ? result.reason : 'statfs-failed', diskEmpty);
}

export function refreshDeviceHealth({
  nowMs = Date.now(),
  cpusImpl = os.cpus,
  ramProbe = runVmStat,
  statfsProbe = runStatfs,
  platform = process.platform,
  pollIntervalMs = config.pollIntervalMs,
} = {}) {
  if (refreshInFlight) return refreshInFlight;
  const work = (async () => {
    const attemptedAt = iso(nowMs);
    const cpu = collectCpu(Number(nowMs), cpusImpl);
    const settleProbe = async (probe, fallbackReason) => {
      try {
        const result = await probe();
        return result && typeof result === 'object'
          ? result : { ok: false, reason: fallbackReason };
      } catch {
        return { ok: false, reason: fallbackReason };
      }
    };
    const [ram, disk] = await Promise.all([
      platform === 'darwin'
        ? settleProbe(ramProbe, 'probe-failed')
        : Promise.resolve({ ok: false, unsupported: true, reason: 'unsupported-platform' }),
      settleProbe(statfsProbe, 'statfs-failed'),
    ]);
    snapshot = {
      scope: 'device',
      pollIntervalMs: effectivePollInterval(pollIntervalMs),
      cpu: reduceCpu(snapshot.cpu, cpu, attemptedAt),
      ram: reduceRam(snapshot.ram, ram, attemptedAt, platform),
      disk: reduceDisk(snapshot.disk, disk, attemptedAt),
    };
    return getDeviceHealthSnapshot();
  })();
  refreshInFlight = work;
  void work.finally(() => { if (refreshInFlight === work) refreshInFlight = null; }).catch(() => {});
  return work;
}

export function _resetDeviceHealth({ platform = process.platform, pollIntervalMs = config.pollIntervalMs } = {}) {
  snapshot = {
    scope: 'device', pollIntervalMs: effectivePollInterval(pollIntervalMs),
    cpu: cpuEmpty(), ram: ramEmpty(platform), disk: diskEmpty(),
  };
  cpuBaseline = null;
  refreshInFlight = null;
  diskInFlight = null;
}
