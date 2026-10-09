import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const MIB = 1024 * 1024;
export const claudeTrendLimits = Object.freeze({
  maxDirectories: 512, maxEntries: 20_000, maxFiles: 10_000,
  maxFileBytes: 128 * MIB, maxReadBytes: 256 * MIB,
  maxLineBytes: 8 * MIB, maxEvents: 2_000_000,
  maxRecords: 175_000, maxCacheBytes: 96 * MIB,
  maxWallMs: 10_000, maxDailyBuckets: 96,
});

// Only reduced numeric usage and a bounded model survive a parse. This cache
// preserves the former direct-project-file scope and order; no deduplication,
// subagent recursion, model normalization, or financial-ledger accounting.
const files = new Map();
let cacheRecords = 0, cacheBytes = 0;
let lastScan = null;

function fail(reason) { throw Object.assign(new Error(reason), { reason }); }
function sameFile(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;
}
function remove(file) {
  const old = files.get(file);
  if (!old) return;
  cacheRecords -= old.records.length;
  cacheBytes -= old.bytes;
  files.delete(file);
}
function boundedLimits(overrides) {
  return Object.fromEntries(Object.entries(claudeTrendLimits).map(([key, ceiling]) => [key,
    Number.isSafeInteger(overrides?.[key]) && overrides[key] > 0
      ? Math.min(ceiling, overrides[key]) : ceiling]));
}

// A nonblocking, no-follow open reaches descriptor validation even when the
// final component becomes a FIFO. Ancestor directories are same-user trusted,
// as in the existing local log readers; this is not descriptor-relative traversal.
function *lines(file, stat, shared) {
  const { fsImpl, limits, pacer } = shared;
  if (!stat.isFile() || stat.size > limits.maxFileBytes) fail('file-size');
  if (shared.bytes + stat.size > limits.maxReadBytes) fail('read-bytes');
  shared.bytes += stat.size;
  const fd = fsImpl.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const opened = fsImpl.fstatSync(fd);
    if (!opened.isFile() || !sameFile(stat, opened)) fail('file-changed');
    const chunk = Buffer.alloc(64 * 1024);
    let read = 0, fragments = [], length = 0;
    while (read <= opened.size) {
      shared.check();
      if (pacer?.due()) yield;
      const count = fsImpl.readSync(fd, chunk, 0, Math.min(chunk.length, opened.size + 1 - read), null);
      if (!count) break;
      read += count;
      if (read > opened.size) fail('file-changed');
      let start = 0;
      for (;;) {
        const newline = chunk.indexOf(0x0a, start);
        const end = newline < 0 || newline >= count ? count : newline;
        const part = chunk.subarray(start, end);
        length += part.length;
        if (length > limits.maxLineBytes) fail('line-size');
        if (part.length) fragments.push(Buffer.from(part));
        if (end === count) break;
        if (length) yield Buffer.concat(fragments, length).toString('utf8');
        fragments = []; length = 0; start = end + 1;
        shared.check();
        if (pacer?.due()) yield;
      }
    }
    if (read !== opened.size || !sameFile(opened, fsImpl.fstatSync(fd))
      || !sameFile(opened, fsImpl.lstatSync(file))) fail('file-changed');
    if (length) yield Buffer.concat(fragments, length).toString('utf8');
  } finally { fsImpl.closeSync(fd); }
}

function *parse(file, stat, sinceMs, shared) {
  const hit = files.get(file);
  if (hit && sameFile(hit.stat, stat) && hit.sinceMs <= sinceMs) return hit;
  const records = [];
  let bytes = 512 + file.length * 2;
  for (const line of lines(file, stat, shared)) {
    if (line === undefined) { yield; continue; }
    if (++shared.events > shared.limits.maxEvents) fail('events');
    let o;
    try { o = JSON.parse(line); } catch { continue; } // legacy malformed-line behavior
    const usage = o?.message?.usage;
    const tsMs = Date.parse(o?.timestamp);
    if (!usage || !Number.isFinite(tsMs) || tsMs < sinceMs) continue;
    const model = o.message.model;
    if (model != null && (typeof model !== 'string' || model.length > 256)) fail('record-model');
    const reduced = {};
    for (const key of ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) {
      const n = usage[key] || 0;
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) fail('record-tokens');
      reduced[key] = n;
    }
    if (records.length >= shared.limits.maxRecords) fail('records');
    records.push({ tsMs, model, usage: reduced, fileMtimeMs: stat.mtimeMs });
    bytes += 384 + 2 * (model?.length || 0);
    const retainedBytes = cacheBytes - (hit?.bytes || 0) + bytes;
    const retainedRecords = cacheRecords - (hit?.records.length || 0) + records.length;
    if (retainedBytes > shared.limits.maxCacheBytes || retainedRecords > shared.limits.maxRecords) fail('cache-size');
  }
  // The reader's final descriptor/path validation ran before this insertion.
  const parsed = { stat, sinceMs, records, bytes };
  if (cacheBytes - (hit?.bytes || 0) + bytes > shared.limits.maxCacheBytes) fail('cache-size');
  remove(file);
  files.set(file, parsed);
  cacheRecords += records.length; cacheBytes += bytes;
  return parsed;
}

function *discover(root, sinceMs, shared) {
  const { fsImpl, limits, pacer } = shared;
  const found = [];
  let directories = 0, entries = 0;
  function *walk(dir, project = false) {
    if (++directories > limits.maxDirectories) fail('directories');
    const handle = fsImpl.opendirSync(dir);
    try {
      let entry;
      while ((entry = handle.readSync()) !== null) {
        shared.check();
        if (pacer?.due()) yield;
        if (++entries > limits.maxEntries) fail('entries');
        const file = path.join(dir, entry.name);
        // Like the former reader, visit direct project directories only.
        if (!project && entry.isDirectory()) { yield* walk(file, true); continue; }
        if (!project || !entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
        const stat = fsImpl.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        if (stat.mtimeMs < sinceMs) continue;
        if (found.length >= limits.maxFiles) fail('files');
        found.push({ file, stat, directory: dir });
      }
    } finally { handle.closeSync(); }
  }
  yield* walk(root);
  // libuv's readdirSync (the former reader) sorts names, while opendir streams
  // native directory order. Match the former project/file order exactly so
  // floating-point cost sums keep the same addition order too.
  found.sort((a, b) => Buffer.compare(Buffer.from(a.directory), Buffer.from(b.directory))
    || Buffer.compare(Buffer.from(a.file), Buffer.from(b.file)));
  return found;
}

// Completed file parses survive a per-pass byte/event/time budget, so the next
// poll continues through unchanged files without re-reading them. No partial
// scan reaches the published trends, even on the first cold pass.
export function *scanClaudeTrendRecordsSteps(sinceMs, {
  root = config.projectsDir, fsImpl = fs, limits: overrides = null,
  nowFn = Date.now, pacer = null,
} = {}) {
  const limits = boundedLimits(overrides), started = nowFn();
  const shared = { fsImpl, limits, pacer, bytes: 0, events: 0,
    check() { if (nowFn() - started > limits.maxWallMs) fail('time'); } };
  let result = null, reason = null;
  try {
    let rootStat;
    try { rootStat = fsImpl.lstatSync(root); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      clearClaudeTrendFileCache();
      result = [];
      return result; // missing root is authoritative empty
    }
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('root-invalid');
    const found = yield* discover(root, sinceMs, shared);
    const current = new Set(found.map(({ file }) => file));
    for (const file of files.keys()) {
      if (!current.has(file)) remove(file);
      else {
        const parsed = files.get(file);
        // Prune the rolling horizon, including during a prolonged failure.
        const retained = [];
        let bytes = 512 + file.length * 2;
        for (const r of parsed.records) {
          shared.check();
          if (pacer?.due()) yield;
          if (r.tsMs >= sinceMs) {
            retained.push(r);
            bytes += 384 + 2 * (r.model?.length || 0);
          }
        }
        cacheRecords += retained.length - parsed.records.length;
        cacheBytes += bytes - parsed.bytes;
        parsed.records = retained;
        parsed.bytes = bytes;
        parsed.sinceMs = Math.max(parsed.sinceMs, sinceMs);
      }
    }
    const records = [];
    for (const { file, stat } of found) {
      shared.check();
      if (pacer?.due()) yield;
      const parsed = yield* parse(file, stat, sinceMs, shared);
      for (const record of parsed.records) {
        if (pacer?.due()) yield;
        shared.check();
        if (record.tsMs < sinceMs) continue;
        if (records.length >= limits.maxRecords) fail('results');
        records.push(record);
      }
    }
    result = records;
    return result;
  } catch (error) { reason = error.reason || 'source-unreadable'; return null; }
  finally {
    lastScan = Object.freeze({ complete: result !== null, reason,
      readBytes: Math.min(shared.bytes, limits.maxReadBytes), events: shared.events,
      resultRecords: result?.length || 0, files: files.size,
      cacheRecords, cacheEstimatedBytes: cacheBytes });
  }
}

export function claudeTrendCacheStats() { return lastScan; }
export function clearClaudeTrendFileCache() {
  files.clear(); cacheRecords = 0; cacheBytes = 0; lastScan = null;
}
