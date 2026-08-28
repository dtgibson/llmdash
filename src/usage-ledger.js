import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { isBoundedFileError, readBoundedRegularFile } from './bounded-file.js';
import { clearCodexEventCache, scanCodexRollouts } from './codex-events.js';

const MIB = 1024 * 1024;
const LIMITS = Object.freeze({
  maxDepth: 6,
  maxDirectories: 512,
  maxEntries: 20_000,
  maxFiles: 10_000,
  // Codex rollouts are streamed line-by-line, so the per-file safety ceiling
  // no longer has to be an allocation ceiling. This still bounds a single
  // descriptor read while covering the observed ~200 MB rollout.
  maxFileBytes: 128 * MIB,
  maxCodexFileBytes: 256 * MIB,
  maxReadBytes: 512 * MIB,
  maxLines: 2_000_000,
  // Today's 90-day corpus is ~1.13M normalized records. Keep modest growth
  // headroom while bounding the combined ledger, parser caches, result views,
  // and temporary reference arrays well below Node's default old-space limit.
  maxRecords: 1_250_000,
  maxClaudeCacheFiles: 10_000,
  // A fresh 90-day corpus check retained 127,630 records at a conservative
  // 63.8 MB estimate; 96 MiB leaves growth room without making cache size
  // depend on whichever transcript happens to be scanned first.
  maxClaudeCacheRecords: 175_000,
  maxClaudeCacheEstimatedBytes: 96 * MIB,
  maxCodexCacheRecords: 1_100_000,
  maxLineBytes: MIB,
  maxWallMs: 10_000,
});
const claudeFileCache = new Map();
let claudeCacheRecords = 0;
let claudeCacheEstimatedBytes = 0;

function boundedPositive(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, fallback) : fallback;
}

function claudeCacheLimits(overrides) {
  return {
    maxFiles: boundedPositive(overrides?.maxFiles, LIMITS.maxClaudeCacheFiles),
    maxRecords: boundedPositive(overrides?.maxRecords, LIMITS.maxClaudeCacheRecords),
    maxEstimatedBytes: boundedPositive(overrides?.maxEstimatedBytes, LIMITS.maxClaudeCacheEstimatedBytes),
  };
}

function estimatedClaudeRecordBytes(record) {
  // Conservative shallow-object/string estimate. Numbers and object/array
  // slots are included in the fixed term; retained strings are counted at two
  // bytes per character, matching V8's worst common representation here.
  return 384 + 2 * (String(record.model || '').length + String(record.stableKey || '').length);
}

function cachedClaudeRecordCount(parsed) { return parsed?.records?.length || 0; }
function cachedClaudeEstimatedBytes(parsed) { return parsed?.estimatedBytes || 0; }

function deleteClaudeCacheEntry(file) {
  const parsed = claudeFileCache.get(file);
  if (!parsed) return;
  claudeFileCache.delete(file);
  claudeCacheRecords -= cachedClaudeRecordCount(parsed);
  claudeCacheEstimatedBytes -= cachedClaudeEstimatedBytes(parsed);
}

function claudeCacheEvictionOrder(exceptFile = null) {
  return [...claudeFileCache.entries()]
    .filter(([file]) => file !== exceptFile)
    .sort((a, b) => a[1].mtimeMs - b[1].mtimeMs || a[0].localeCompare(b[0]));
}

function cacheClaudeParse(file, parsed, limits) {
  const recordCount = cachedClaudeRecordCount(parsed);
  const estimatedBytes = cachedClaudeEstimatedBytes(parsed);
  if (recordCount > limits.maxRecords || estimatedBytes > limits.maxEstimatedBytes) return false;

  const replaced = claudeFileCache.get(file);
  let projectedFiles = claudeFileCache.size + (replaced ? 0 : 1);
  let projectedRecords = claudeCacheRecords - cachedClaudeRecordCount(replaced) + recordCount;
  let projectedBytes = claudeCacheEstimatedBytes - cachedClaudeEstimatedBytes(replaced) + estimatedBytes;
  const evictions = [];
  for (const [candidate, cached] of claudeCacheEvictionOrder(file)) {
    if (projectedFiles <= limits.maxFiles && projectedRecords <= limits.maxRecords
      && projectedBytes <= limits.maxEstimatedBytes) break;
    evictions.push(candidate);
    projectedFiles--;
    projectedRecords -= cachedClaudeRecordCount(cached);
    projectedBytes -= cachedClaudeEstimatedBytes(cached);
  }
  if (projectedFiles > limits.maxFiles || projectedRecords > limits.maxRecords
    || projectedBytes > limits.maxEstimatedBytes) return false;
  for (const candidate of evictions) deleteClaudeCacheEntry(candidate);
  deleteClaudeCacheEntry(file);
  claudeFileCache.set(file, parsed);
  claudeCacheRecords += recordCount;
  claudeCacheEstimatedBytes += estimatedBytes;
  return true;
}

function safeToken(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeModel(value) {
  return typeof value === 'string' && /^[\x20-\x7e]{1,96}$/.test(value) ? value : null;
}

function tupleKey(record) {
  return `${record.tsMs}\u0000${record.model}\u0000${record.input}\u0000${record.output}\u0000${record.cacheWrite}\u0000${record.cacheWrite5m}\u0000${record.cacheWrite1h}\u0000${record.cacheRead}`;
}

function normalizedClaude(raw) {
  const usage = raw?.message?.usage;
  const tsMs = Date.parse(raw?.timestamp);
  const model = safeModel(raw?.message?.model);
  if (!usage || !Number.isFinite(tsMs) || !model) return null;
  const input = safeToken(usage.input_tokens);
  const output = safeToken(usage.output_tokens);
  const cacheWrite = safeToken(usage.cache_creation_input_tokens ?? 0);
  const cacheRead = safeToken(usage.cache_read_input_tokens ?? 0);
  if ([input, output, cacheWrite, cacheRead].some((value) => value === null)) return null;
  const cacheDetail = usage.cache_creation && typeof usage.cache_creation === 'object'
    && !Array.isArray(usage.cache_creation) ? usage.cache_creation : null;
  const detail5m = cacheDetail ? safeToken(cacheDetail.ephemeral_5m_input_tokens) : null;
  const detail1h = cacheDetail ? safeToken(cacheDetail.ephemeral_1h_input_tokens) : null;
  const detailedCacheWrites = detail5m !== null && detail1h !== null
    && safeToken(detail5m + detail1h) === cacheWrite;
  const exactDetail5m = cacheWrite === 0 ? 0 : (detailedCacheWrites ? detail5m : null);
  const exactDetail1h = cacheWrite === 0 ? 0 : (detailedCacheWrites ? detail1h : null);
  const stableId = safeModel(raw.uuid ?? raw.event_uuid ?? raw.eventId);
  const messageId = safeModel(raw.message?.id);
  const requestId = safeModel(raw.requestId ?? raw.request_id ?? raw.message?.request_id);
  return {
    tool: 'claude', tsMs, model, input, output, cacheWrite,
    cacheWrite5m: exactDetail5m,
    cacheWrite1h: exactDetail1h,
    cacheRead,
    stableKey: stableId ? `event:${stableId}`
      : messageId && requestId ? `pair:${messageId}:${requestId}:${tupleKey({
          tsMs, model, input, output, cacheWrite,
          cacheWrite5m: exactDetail5m,
          cacheWrite1h: exactDetail1h,
          cacheRead,
        })}` : null,
  };
}

function skipWhitespace(source, index) {
  while (index < source.length && /\s/.test(source[index])) index++;
  return index;
}

function jsonStringAt(source, index) {
  index = skipWhitespace(source, index);
  if (source[index] !== '"') return null;
  const start = index++;
  while (index < source.length) {
    if (source[index] === '\\') { index += 2; continue; }
    if (source[index] === '"') {
      const end = index + 1;
      try { return { value: JSON.parse(source.slice(start, end)), end }; } catch { return null; }
    }
    if (source.charCodeAt(index) < 0x20) return null;
    index++;
  }
  return null;
}

function scalarAt(source, index) {
  index = skipWhitespace(source, index);
  const string = jsonStringAt(source, index);
  if (string) return string;
  const match = /^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(index));
  if (!match) return null;
  try { return { value: JSON.parse(match[0]), end: index + match[0].length }; } catch { return null; }
}

function propertyAt(source, index) {
  const key = jsonStringAt(source, index);
  if (!key) return null;
  index = skipWhitespace(source, key.end);
  if (source[index] !== ':') return null;
  return { key: key.value, valueIndex: skipWhitespace(source, index + 1) };
}

function commaAt(source, index) {
  index = skipWhitespace(source, index);
  return source[index] === ',' ? skipWhitespace(source, index + 1) : null;
}

function explicitClaudeUserHeader(line) {
  // Claude's generated oversized user/tool-result rows begin with one of two
  // exact top-level property sequences. Prove that grammar from the start of
  // the bounded prefix; never search for discriminator fragments in nested
  // metadata where an assistant usage row could spoof them.
  const prefix = line.slice(0, 64 * 1024);
  let index = skipWhitespace(prefix, 0);
  if (prefix[index++] !== '{') return false;
  const readScalarProperty = (expectedKey, predicate = () => true) => {
    const property = propertyAt(prefix, index);
    if (!property || property.key !== expectedKey) return false;
    const value = scalarAt(prefix, property.valueIndex);
    if (!value || !predicate(value.value)) return false;
    const next = commaAt(prefix, value.end);
    if (next === null) return false;
    index = next;
    return true;
  };
  if (!readScalarProperty('parentUuid')) return false;
  if (!readScalarProperty('isSidechain', (value) => typeof value === 'boolean')) return false;
  if (!readScalarProperty('promptId')) return false;

  let property = propertyAt(prefix, index);
  if (property?.key === 'agentId') {
    const agent = scalarAt(prefix, property.valueIndex);
    const next = agent && commaAt(prefix, agent.end);
    if (!agent || next === null) return false;
    index = next;
    property = propertyAt(prefix, index);
  }
  if (!property || property.key !== 'type') return false;
  const type = scalarAt(prefix, property.valueIndex);
  if (!type || type.value !== 'user') return false;
  index = commaAt(prefix, type.end);
  if (index === null) return false;

  property = propertyAt(prefix, index);
  if (!property || property.key !== 'message') return false;
  index = skipWhitespace(prefix, property.valueIndex);
  if (prefix[index++] !== '{') return false;
  const role = propertyAt(prefix, index);
  if (!role || role.key !== 'role') return false;
  const roleValue = scalarAt(prefix, role.valueIndex);
  return roleValue?.value === 'user' && commaAt(prefix, roleValue.end) !== null;
}

function budgetReason(error) {
  return error?.code === 'SCAN_BUDGET' ? error.reason : null;
}

function budgetError(reason) {
  const error = new Error('Usage scan safety budget reached');
  error.code = 'SCAN_BUDGET';
  error.reason = reason;
  return error;
}

function inspectClaudeFiles(root, sinceMs, fsImpl, nowFn) {
  const files = [];
  const discovered = new Set();
  let directories = 0;
  let entries = 0;
  let denominatorKnown = true;
  const reasons = new Set();
  const started = nowFn();
  const checkTime = () => { if (nowFn() - started > LIMITS.maxWallMs) throw budgetError('scan_budget_time'); };
  const walk = (directory, depth, isRoot = false) => {
    checkTime();
    if (++directories > LIMITS.maxDirectories) throw budgetError('scan_budget_directories');
    let directoryHandle;
    let listing;
    const visitEntry = (entry) => {
      checkTime();
      if (++entries > LIMITS.maxEntries) throw budgetError('scan_budget_entries');
      const file = path.join(directory, entry.name);
      let stat;
      try { stat = fsImpl.lstatSync(file); } catch { denominatorKnown = false; reasons.add('source_unreadable'); return; }
      if (stat.isSymbolicLink?.()) return;
      if (stat.isDirectory?.()) {
        if (depth >= LIMITS.maxDepth) { denominatorKnown = false; reasons.add('scan_budget_depth'); return; }
        walk(file, depth + 1);
        return;
      }
      if (!stat.isFile?.() || !entry.name.endsWith('.jsonl') || stat.mtimeMs < sinceMs) return;
      if (stat.size > LIMITS.maxFileBytes) { denominatorKnown = false; reasons.add('file_too_large'); return; }
      if (files.length >= LIMITS.maxFiles) throw budgetError('scan_budget_files');
      discovered.add(file);
      files.push({ file, stat });
    };
    try {
      if (typeof fsImpl.opendirSync === 'function') directoryHandle = fsImpl.opendirSync(directory);
      else listing = fsImpl.readdirSync(directory, { withFileTypes: true });
      if (directoryHandle) {
        let entry;
        while ((entry = directoryHandle.readSync()) !== null) visitEntry(entry);
      } else {
        for (const entry of listing) visitEntry(entry);
      }
    } catch (error) {
      if (budgetReason(error)) throw error;
      if (isRoot) throw Object.assign(new Error('root unavailable'), { code: error?.code || 'EACCES' });
      denominatorKnown = false;
      reasons.add('source_unreadable');
    } finally {
      if (directoryHandle) try { directoryHandle.closeSync(); } catch {}
    }
  };
  walk(root, 0, true);
  return { files, discovered, denominatorKnown, reasons, entries, started };
}

function parseClaudeFile(file, stat, fsImpl, shared) {
  const cached = claudeFileCache.get(file);
  const replayDiagnostics = (parsed) => {
    if (parsed.denominatorKnown === false) shared.denominatorKnown = false;
    for (const reason of parsed.reasons || []) shared.reasons.add(reason);
  };
  if (cached && cached.device === stat.dev && cached.inode === stat.ino
    && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
    replayDiagnostics(cached);
    return cached.records;
  }
  shared.readBytes += stat.size;
  if (shared.readBytes > LIMITS.maxReadBytes) throw budgetError('scan_budget_total_bytes');
  let content;
  try {
    ({ content } = readBoundedRegularFile(file, {
      fsImpl, maxBytes: LIMITS.maxFileBytes, expectedStat: stat,
    }));
  } catch (error) {
    shared.denominatorKnown = false;
    shared.reasons.add(isBoundedFileError(error, 'BOUNDED_FILE_TOO_LARGE') ? 'file_too_large' : 'source_unreadable');
    if (cached) replayDiagnostics(cached);
    return cached?.records || [];
  }
  const records = [];
  let denominatorKnown = true;
  const reasons = new Set();
  const unsupported = () => { denominatorKnown = false; reasons.add('record_unsupported'); };
  let cursor = 0;
  while (cursor < content.length) {
    if (shared.nowFn() - shared.started > LIMITS.maxWallMs) throw budgetError('scan_budget_time');
    const newline = content.indexOf('\n', cursor);
    const end = newline < 0 ? content.length : newline;
    const line = content.slice(cursor, end);
    cursor = newline < 0 ? content.length : newline + 1;
    if (!line.trim()) continue;
    if (++shared.lines > LIMITS.maxLines) throw budgetError('scan_budget_lines');
    if (Buffer.byteLength(line, 'utf8') > LIMITS.maxLineBytes) {
      if (!explicitClaudeUserHeader(line)) unsupported();
      continue;
    }
    let raw;
    try { raw = JSON.parse(line); } catch { unsupported(); continue; }
    const record = normalizedClaude(raw);
    if (record) {
      if (records.length >= LIMITS.maxRecords) throw budgetError('scan_budget_records');
      records.push(record);
    }
    else if (raw?.message?.usage !== undefined) {
      if (!Number.isFinite(Date.parse(raw?.timestamp))) {
        denominatorKnown = false;
        reasons.add('timestamp_invalid');
      } else unsupported();
    }
  }
  const parsed = {
    device: stat.dev, inode: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs,
    records, denominatorKnown, reasons: [...reasons],
    estimatedBytes: 512 + records.reduce((total, record) => total + estimatedClaudeRecordBytes(record), 0),
  };
  replayDiagnostics(parsed);
  cacheClaudeParse(file, parsed, shared.cacheLimits);
  return records;
}

export function scanClaudeUsage(sinceMs, {
  root = config.projectsDir,
  fsImpl = fs,
  nowFn = Date.now,
  cacheLimits = null,
} = {}) {
  const report = {
    complete: true, denominatorKnown: true, reasons: [], deduplicatedRecords: 0,
    fallbackIdentityRecords: 0,
  };
  try {
    const rootStat = typeof fsImpl.lstatSync === 'function' ? fsImpl.lstatSync(root) : fsImpl.statSync(root);
    if (rootStat.isSymbolicLink?.() || !rootStat.isDirectory?.()) throw new Error('not a directory');
  } catch (error) {
    report.complete = false;
    report.denominatorKnown = false;
    report.reasons = [error?.code === 'ENOENT' ? 'source_missing' : 'source_unreadable'];
    return { records: [], report };
  }
  let discovery;
  try { discovery = inspectClaudeFiles(path.resolve(root), sinceMs, fsImpl, nowFn); }
  catch (error) {
    const reason = budgetReason(error);
    report.complete = false;
    report.denominatorKnown = false;
    report.reasons = [reason || (error?.code === 'ENOENT' ? 'source_missing' : 'source_unreadable')];
    return { records: [], report };
  }
  const shared = {
    readBytes: 0, lines: 0, denominatorKnown: discovery.denominatorKnown,
    reasons: discovery.reasons, started: discovery.started, nowFn,
    cacheLimits: claudeCacheLimits(cacheLimits),
  };
  const records = [];
  try {
    for (const { file, stat } of discovery.files) {
      let previousFallback = null;
      for (const record of parseClaudeFile(file, stat, fsImpl, shared)) {
        if (record.tsMs < sinceMs) continue;
        const fallback = tupleKey(record);
        if (!record.stableKey && fallback === previousFallback) { report.deduplicatedRecords++; continue; }
        previousFallback = record.stableKey ? null : fallback;
        if (records.length >= LIMITS.maxRecords) throw budgetError('scan_budget_records');
        records.push({ ...record, identityQuality: record.stableKey ? 'stable' : 'fallback' });
        if (!record.stableKey) report.fallbackIdentityRecords++;
      }
    }
  } catch (error) {
    shared.denominatorKnown = false;
    shared.reasons.add(budgetReason(error) || 'source_unreadable');
  }
  const seen = new Set();
  const deduped = [];
  for (const record of records) {
    if (record.stableKey && seen.has(record.stableKey)) { report.deduplicatedRecords++; continue; }
    if (record.stableKey) seen.add(record.stableKey);
    const { stableKey: _stableKey, ...publicRecord } = record;
    deduped.push(publicRecord);
  }
  for (const cachedPath of claudeFileCache.keys()) {
    if (!discovery.discovered.has(cachedPath)) deleteClaudeCacheEntry(cachedPath);
  }
  deduped.sort((a, b) => a.tsMs - b.tsMs || a.model.localeCompare(b.model));
  report.denominatorKnown = shared.denominatorKnown;
  report.complete = shared.denominatorKnown && shared.reasons.size === 0 && report.fallbackIdentityRecords === 0;
  report.reasons = [...shared.reasons];
  if (report.fallbackIdentityRecords) report.reasons.push('dedupe_fallback');
  report.reasons = [...new Set(report.reasons)].sort().slice(0, 16);
  return { records: deduped, report };
}

export function scanCodexUsage(sinceMs, {
  sessionsDir = config.codexSessionsDir,
  fsImpl = fs,
  nowFn = Date.now,
  maxRecords = LIMITS.maxRecords,
} = {}) {
  const report = {
    complete: true, denominatorKnown: true, reasons: [], deduplicatedRecords: 0,
    fallbackIdentityRecords: 0,
  };
  try {
    const stat = typeof fsImpl.lstatSync === 'function' ? fsImpl.lstatSync(sessionsDir) : fsImpl.statSync(sessionsDir);
    if (stat.isSymbolicLink?.() || !stat.isDirectory?.()) throw new Error('not a directory');
  } catch (error) {
    return { records: [], report: { ...report, complete: false, denominatorKnown: false, reasons: [error?.code === 'ENOENT' ? 'source_missing' : 'source_unreadable'] } };
  }
  try {
    const resultRecordLimit = boundedPositive(maxRecords, LIMITS.maxRecords);
    const scan = scanCodexRollouts(sinceMs, {
      fs: fsImpl,
      sessionsDir,
      pruneBeforeMs: sinceMs,
      usageOnly: true,
      partialOnBudget: true,
      limits: {
        maxDepth: LIMITS.maxDepth,
        maxEntries: LIMITS.maxEntries,
        maxFiles: LIMITS.maxFiles,
        maxFileBytes: LIMITS.maxCodexFileBytes,
        maxChangedBytesPerScan: LIMITS.maxReadBytes,
        maxEventsPerFile: LIMITS.maxLines,
        maxEventsPerScan: LIMITS.maxLines,
        maxResultRecords: resultRecordLimit,
        maxCacheRecords: Math.min(resultRecordLimit, LIMITS.maxCodexCacheRecords),
        maxWallMs: LIMITS.maxWallMs,
      },
      nowFn,
    });
    const records = scan.usage.map((record) => ({
      tool: 'codex',
      tsMs: record.tsMs,
      // Older rollout formats can carry a valid token tuple without a model
      // field. Keep those records in the known denominator under an explicit
      // sentinel; exact-rate lookup will name them as unpriceable rather than
      // pretending the usage itself was unreadable.
      model: record.model || 'unknown',
      modelSource: record.modelSource || 'unknown',
      input: record.input,
      output: record.output,
      cacheRead: record.cached,
      cacheWrite: 0,
      identityQuality: record.turnKey ? 'stable' : 'fallback',
    })).filter((record) => Number.isFinite(record.tsMs) && safeModel(record.model)
      && [record.input, record.output, record.cacheRead].every((value) => safeToken(value) !== null));
    report.fallbackIdentityRecords = records.filter((record) => record.identityQuality === 'fallback').length;
    if (scan.scanIncomplete) {
      report.complete = false;
      report.denominatorKnown = false;
      report.reasons.push(scan.scanIncomplete);
    }
    report.scanDiagnostics = { ...scan.parseDiagnostics };
    if (report.fallbackIdentityRecords) {
      report.complete = false;
      report.reasons.push('dedupe_fallback');
    }
    report.reasons = [...new Set(report.reasons)].sort().slice(0, 16);
    return { records, report };
  } catch (error) {
    return {
      records: [],
      report: {
        ...report, complete: false, denominatorKnown: false,
        reasons: [error?.code === 'CODEX_SCAN_BUDGET' ? (error.reason || 'scan_budget_records') : 'source_unreadable'],
      },
    };
  }
}

export function buildUsageLedger(nowMs = Date.now(), options = {}) {
  const sinceMs = Number.isFinite(options.sinceMs) && options.sinceMs <= nowMs
    ? options.sinceMs : nowMs - 91 * 86_400_000;
  const claude = scanClaudeUsage(sinceMs, options.claude);
  const remainingRecords = LIMITS.maxRecords - claude.records.length;
  const codex = remainingRecords > 0
    ? scanCodexUsage(sinceMs, { ...options.codex, maxRecords: remainingRecords })
    : {
        records: [],
        report: {
          complete: false, denominatorKnown: false, reasons: ['scan_budget_records'],
          deduplicatedRecords: 0, fallbackIdentityRecords: 0,
        },
      };
  return {
    generatedAt: new Date(nowMs).toISOString(),
    sinceMs,
    records: [...claude.records, ...codex.records]
      .sort((a, b) => a.tsMs - b.tsMs || a.tool.localeCompare(b.tool) || String(a.model).localeCompare(String(b.model))),
    scanReport: { claude: claude.report, codex: codex.report },
  };
}

export function clearUsageLedgerCaches() {
  claudeFileCache.clear();
  claudeCacheRecords = 0;
  claudeCacheEstimatedBytes = 0;
  clearCodexEventCache();
}

export function usageLedgerCacheStats() {
  return Object.freeze({
    claude: Object.freeze({
      files: claudeFileCache.size,
      records: claudeCacheRecords,
      estimatedBytes: claudeCacheEstimatedBytes,
    }),
  });
}

export const usageLedgerLimits = LIMITS;
