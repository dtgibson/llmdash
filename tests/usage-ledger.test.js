import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  clearUsageLedgerCaches, scanClaudeUsage, scanCodexUsage, usageLedgerCacheStats,
  usageLedgerLimits,
} from '../src/usage-ledger.js';

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-ledger-')); }
function claudeLine({ id, ts = '2026-07-16T12:00:00.000Z', model = 'claude-sonnet-4-6', input = 10 } = {}) {
  return JSON.stringify({
    uuid: id,
    timestamp: ts,
    message: {
      model,
      usage: {
        input_tokens: input,
        output_tokens: 4,
        cache_creation_input_tokens: 2,
        cache_read_input_tokens: 8,
      },
    },
  });
}

function codexContent() {
  return [
    { timestamp: '2026-07-16T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } },
    { timestamp: '2026-07-16T12:00:01.000Z', type: 'turn_context', payload: { turn_id: 'turn-1', model: 'gpt-5.3-codex' } },
    { timestamp: '2026-07-16T12:00:02.000Z', type: 'event_msg', payload: { type: 'token_count', turn_id: 'turn-1', info: { last_token_usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 2 } } } },
  ].map((row) => JSON.stringify(row)).join('\n');
}

function codexFallbackContent() {
  return [
    { timestamp: '2026-07-16T12:00:01.000Z', type: 'turn_context', payload: { model: 'gpt-5.3-codex' } },
    { timestamp: '2026-07-16T12:00:02.000Z', type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 2 } } } },
  ].map((row) => JSON.stringify(row)).join('\n');
}

test('Claude ledger scans nested JSONL, exact channels, and stable/fallback dedupe', () => {
  clearUsageLedgerCaches();
  const root = tempDir();
  const nested = path.join(root, 'project', 'subagents');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, 'a.jsonl'), [
    claudeLine({ id: 'event-1' }),
    claudeLine({ id: 'event-1' }),
    claudeLine({}),
    claudeLine({}),
    '{bad json',
  ].join('\n'));
  const out = scanClaudeUsage(Date.parse('2026-07-01T00:00:00Z'), { root });
  assert.equal(out.records.length, 2);
  assert.deepEqual(out.records[0], {
    tool: 'claude', tsMs: Date.parse('2026-07-16T12:00:00Z'), model: 'claude-sonnet-4-6',
    input: 10, output: 4, cacheWrite: 2, cacheWrite5m: null, cacheWrite1h: null,
    cacheRead: 8, identityQuality: 'stable',
  });
  assert.equal(out.report.deduplicatedRecords, 2);
  assert.equal(out.report.fallbackIdentityRecords, 1);
  assert.equal(out.report.complete, false);
  assert.deepEqual(out.report.reasons, ['dedupe_fallback', 'record_unsupported']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('oversized explicit Claude user rows do not weaken usage coverage', () => {
  clearUsageLedgerCaches();
  const root = tempDir();
  const oversizedUser = JSON.stringify({
    parentUuid: null, isSidechain: false, promptId: 'prompt-1', type: 'user',
    message: { role: 'user', content: 'x'.repeat(usageLedgerLimits.maxLineBytes + 1) },
    uuid: 'user-1', timestamp: '2026-07-16T12:00:00.000Z',
  });
  fs.writeFileSync(path.join(root, 'a.jsonl'), `${oversizedUser}\n${claudeLine({ id: 'good' })}`);
  const out = scanClaudeUsage(Date.parse('2026-07-01T00:00:00Z'), { root });
  assert.equal(out.records.length, 1);
  assert.equal(out.report.denominatorKnown, true);
  assert.ok(!out.report.reasons.includes('record_unsupported'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('nested Claude user discriminators cannot hide oversized assistant usage', () => {
  clearUsageLedgerCaches();
  const root = tempDir();
  const oversizedAssistant = JSON.stringify({
    type: 'assistant', timestamp: '2026-07-16T12:00:00.000Z',
    message: {
      role: 'assistant', model: 'claude-opus-5',
      usage: { input_tokens: 10, output_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      metadata: { type: 'user', message: { role: 'user' } },
      content: 'x'.repeat(usageLedgerLimits.maxLineBytes + 1),
    },
  });
  fs.writeFileSync(path.join(root, 'a.jsonl'), oversizedAssistant);
  const out = scanClaudeUsage(0, { root });
  assert.equal(out.records.length, 0);
  assert.equal(out.report.denominatorKnown, false);
  assert.ok(out.report.reasons.includes('record_unsupported'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('Claude cache-write TTL details remain distinct in normalized usage records', () => {
  clearUsageLedgerCaches();
  const root = tempDir();
  const row = JSON.parse(claudeLine({ id: 'detailed' }));
  row.message.usage.cache_creation_input_tokens = 7;
  row.message.usage.cache_creation = {
    ephemeral_5m_input_tokens: 2,
    ephemeral_1h_input_tokens: 5,
  };
  fs.writeFileSync(path.join(root, 'a.jsonl'), JSON.stringify(row));
  const [record] = scanClaudeUsage(0, { root }).records;
  assert.equal(record.cacheWrite, 7);
  assert.equal(record.cacheWrite5m, 2);
  assert.equal(record.cacheWrite1h, 5);
  fs.rmSync(root, { recursive: true, force: true });
});

test('zero Claude cache writes normalize missing duration evidence to an exact zero split', () => {
  clearUsageLedgerCaches();
  const root = tempDir();
  const row = JSON.parse(claudeLine({ id: 'zero-write' }));
  row.message.usage.cache_creation_input_tokens = 0;
  delete row.message.usage.cache_creation;
  fs.writeFileSync(path.join(root, 'a.jsonl'), JSON.stringify(row));
  const [record] = scanClaudeUsage(0, { root }).records;
  assert.equal(record.cacheWrite, 0);
  assert.equal(record.cacheWrite5m, 0);
  assert.equal(record.cacheWrite1h, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Claude parsed cache evicts deterministically within record and estimated-byte bounds', () => {
  clearUsageLedgerCaches();
  const root = tempDir();
  const base = Date.now() - 10_000;
  for (let index = 0; index < 3; index++) {
    const file = path.join(root, `${String.fromCharCode(97 + index)}.jsonl`);
    fs.writeFileSync(file, claudeLine({ id: `cache-${index}` }));
    fs.utimesSync(file, new Date(base + index * 1000), new Date(base + index * 1000));
  }
  const cacheLimits = { maxFiles: 2, maxRecords: 2, maxEstimatedBytes: 4096 };
  const first = scanClaudeUsage(0, { root, cacheLimits });
  assert.equal(first.records.length, 3, 'current results stay complete even when the cache must evict');
  assert.deepEqual(usageLedgerCacheStats().claude, {
    files: 2, records: 2, estimatedBytes: usageLedgerCacheStats().claude.estimatedBytes,
  });
  assert.ok(usageLedgerCacheStats().claude.estimatedBytes <= cacheLimits.maxEstimatedBytes);

  const oversized = path.join(root, 'oversized.jsonl');
  fs.writeFileSync(oversized, [
    claudeLine({ id: 'oversized-1' }), claudeLine({ id: 'oversized-2' }), claudeLine({ id: 'oversized-3' }),
  ].join('\n'));
  scanClaudeUsage(0, { root, cacheLimits });
  const afterOversized = usageLedgerCacheStats().claude;
  assert.ok(afterOversized.files <= 2);
  assert.ok(afterOversized.records <= 2, 'an over-budget parsed file is never inserted before eviction');
  assert.ok(afterOversized.estimatedBytes <= cacheLimits.maxEstimatedBytes);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Claude ledger excludes invalid tokens/models and respects lower bound', () => {
  clearUsageLedgerCaches();
  const root = tempDir();
  fs.writeFileSync(path.join(root, 'a.jsonl'), [
    claudeLine({ id: 'old', ts: '2026-06-01T00:00:00Z' }),
    claudeLine({ id: 'negative', input: -1 }),
    claudeLine({ id: 'hostile', model: 'claude\nsecret' }),
    claudeLine({ id: 'good', ts: '2026-07-17T00:00:00Z' }),
  ].join('\n'));
  const out = scanClaudeUsage(Date.parse('2026-07-01T00:00:00Z'), { root });
  assert.deepEqual(out.records.map((record) => record.model), ['claude-sonnet-4-6']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Claude and Codex missing roots are unavailable rather than complete zero', () => {
  clearUsageLedgerCaches();
  const absent = path.join(tempDir(), 'absent');
  for (const result of [
    scanClaudeUsage(0, { root: absent }),
    scanCodexUsage(0, { sessionsDir: absent }),
  ]) {
    assert.equal(result.records.length, 0);
    assert.equal(result.report.complete, false);
    assert.equal(result.report.denominatorKnown, false);
    assert.deepEqual(result.report.reasons, ['source_missing']);
  }
  fs.rmSync(path.dirname(absent), { recursive: true, force: true });
});

test('Claude scan budget exhaustion returns bounded partial evidence', () => {
  clearUsageLedgerCaches();
  const root = tempDir();
  fs.mkdirSync(path.join(root, 'a', 'b', 'c', 'd', 'e', 'f', 'g'), { recursive: true });
  fs.writeFileSync(path.join(root, 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'deep.jsonl'), claudeLine({ id: 'deep' }));
  const out = scanClaudeUsage(0, { root });
  assert.equal(out.report.complete, false);
  assert.equal(out.report.denominatorKnown, false);
  assert.ok(out.report.reasons.includes('scan_budget_depth'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('malformed Claude candidates remain partial across cached refreshes', () => {
  clearUsageLedgerCaches();
  const root = tempDir();
  const file = path.join(root, 'a.jsonl');
  fs.writeFileSync(file, `${claudeLine({ id: 'good' })}\n{`);
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = scanClaudeUsage(Date.parse('2026-07-01T00:00:00Z'), { root });
    assert.equal(out.records.length, 1);
    assert.equal(out.report.complete, false);
    assert.equal(out.report.denominatorKnown, false);
    assert.ok(out.report.reasons.includes('record_unsupported'));
  }
  fs.writeFileSync(file, claudeLine({ id: 'bad-time', ts: 'not-a-time' }));
  const invalidTime = scanClaudeUsage(0, { root });
  assert.equal(invalidTime.report.complete, false);
  assert.ok(invalidTime.report.reasons.includes('timestamp_invalid'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('Codex malformed and unreadable candidate files weaken completeness', () => {
  clearUsageLedgerCaches();
  const root = tempDir();
  const file = path.join(root, 'rollout-a.jsonl');
  fs.writeFileSync(file, '{');
  const malformed = scanCodexUsage(0, { sessionsDir: root });
  assert.equal(malformed.report.complete, false);
  assert.equal(malformed.report.denominatorKnown, false);
  assert.ok(malformed.report.reasons.includes('record_unsupported'));

  clearUsageLedgerCaches();
  fs.writeFileSync(file, JSON.stringify({
    type: 'token_count',
    info: { last_token_usage: { input_tokens: 1, output_tokens: 0 } },
  }));
  const invalidTimestamp = scanCodexUsage(0, { sessionsDir: root });
  assert.equal(invalidTimestamp.report.complete, false);
  assert.ok(invalidTimestamp.report.reasons.includes('timestamp_invalid'));

  clearUsageLedgerCaches();
  fs.writeFileSync(file, codexContent());
  const readable = scanCodexUsage(0, { sessionsDir: root });
  assert.equal(readable.records.length, 1);
  fs.appendFileSync(file, '\n');
  const unreadableFs = {
    lstatSync: (...args) => fs.lstatSync(...args),
    statSync: (...args) => fs.statSync(...args),
    readdirSync: (...args) => fs.readdirSync(...args),
    readFileSync: () => { const error = new Error('private path'); error.code = 'EACCES'; throw error; },
  };
  const retained = scanCodexUsage(0, { sessionsDir: root, fsImpl: unreadableFs });
  assert.equal(retained.records.length, 1);
  assert.equal(retained.report.complete, false);
  assert.equal(retained.report.denominatorKnown, false);
  assert.ok(retained.report.reasons.includes('source_unreadable'));

  clearUsageLedgerCaches();
  const cold = scanCodexUsage(0, { sessionsDir: root, fsImpl: unreadableFs });
  assert.equal(cold.records.length, 0);
  assert.equal(cold.report.complete, false);
  assert.ok(cold.report.reasons.includes('source_unreadable'));

  clearUsageLedgerCaches();
  fs.writeFileSync(file, codexFallbackContent());
  const fallback = scanCodexUsage(0, { sessionsDir: root });
  assert.deepEqual(fallback.report.reasons, ['dedupe_fallback']);
  fs.appendFileSync(file, '\n');
  const fallbackRetained = scanCodexUsage(0, { sessionsDir: root, fsImpl: unreadableFs });
  assert.deepEqual(fallbackRetained.report.reasons, ['dedupe_fallback', 'source_unreadable']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Codex valid usage without model context stays in the known denominator as explicitly unpriced', () => {
  clearUsageLedgerCaches();
  const root = tempDir();
  fs.writeFileSync(path.join(root, 'rollout-model-missing.jsonl'), [
    { timestamp: '2026-07-16T12:00:00.000Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1' } },
    { timestamp: '2026-07-16T12:00:01.000Z', type: 'event_msg', payload: { type: 'token_count', turn_id: 'turn-1', info: null } },
    { timestamp: '2026-07-16T12:00:02.000Z', type: 'event_msg', payload: { type: 'token_count', turn_id: 'turn-1', info: { last_token_usage: { input_tokens: 10, output_tokens: 2 } } } },
  ].map(JSON.stringify).join('\n'));
  const out = scanCodexUsage(0, { sessionsDir: root });
  assert.equal(out.records.length, 1);
  assert.equal(out.records[0].model, 'unknown');
  assert.equal(out.report.denominatorKnown, true);
  assert.deepEqual(out.report.reasons, []);
  assert.equal(out.report.scanDiagnostics.missingModelRecords, 1);
  assert.equal(out.report.scanDiagnostics.invalidTokenRecords, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('usage source roots are never followed through symlinks', () => {
  clearUsageLedgerCaches();
  const parent = tempDir();
  const target = path.join(parent, 'target');
  const link = path.join(parent, 'linked-root');
  fs.mkdirSync(target);
  fs.symlinkSync(target, link);
  for (const out of [scanClaudeUsage(0, { root: link }), scanCodexUsage(0, { sessionsDir: link })]) {
    assert.equal(out.report.complete, false);
    assert.equal(out.report.denominatorKnown, false);
    assert.deepEqual(out.report.reasons, ['source_unreadable']);
  }
  fs.rmSync(parent, { recursive: true, force: true });
});

test('Claude discovery streams entries and stops at the hard entry budget', () => {
  clearUsageLedgerCaches();
  const root = '/virtual/claude-root';
  let index = 0;
  let closed = false;
  const fsImpl = {
    lstatSync(file) {
      if (file === root) return { isDirectory: () => true, isSymbolicLink: () => false };
      return { isDirectory: () => false, isFile: () => false, isSymbolicLink: () => false };
    },
    opendirSync() {
      return {
        readSync() {
          if (index > usageLedgerLimits.maxEntries) return null;
          return { name: `entry-${index++}` };
        },
        closeSync() { closed = true; },
      };
    },
  };
  const out = scanClaudeUsage(0, { root, fsImpl });
  assert.deepEqual(out.report.reasons, ['scan_budget_entries']);
  assert.equal(out.report.denominatorKnown, false);
  assert.equal(index, usageLedgerLimits.maxEntries + 1);
  assert.equal(closed, true);
});

test('Codex cost scans enforce their wall-clock deadline', () => {
  clearUsageLedgerCaches();
  const root = tempDir();
  let nowMs = 0;
  const out = scanCodexUsage(0, { sessionsDir: root, nowFn: () => (nowMs += 20_000) });
  assert.equal(out.records.length, 0);
  assert.equal(out.report.denominatorKnown, false);
  assert.deepEqual(out.report.reasons, ['scan_budget_time']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('candidate file symlinks cannot import usage from outside either source root', () => {
  clearUsageLedgerCaches();
  const parent = tempDir();
  const outsideClaude = path.join(parent, 'outside-claude.jsonl');
  const outsideCodex = path.join(parent, 'outside-codex.jsonl');
  const claudeRoot = path.join(parent, 'claude');
  const codexRoot = path.join(parent, 'codex');
  fs.mkdirSync(claudeRoot);
  fs.mkdirSync(codexRoot);
  fs.writeFileSync(outsideClaude, claudeLine({ id: 'outside' }));
  fs.writeFileSync(outsideCodex, codexContent());
  fs.symlinkSync(outsideClaude, path.join(claudeRoot, 'import.jsonl'));
  fs.symlinkSync(outsideCodex, path.join(codexRoot, 'rollout-import.jsonl'));
  assert.equal(scanClaudeUsage(0, { root: claudeRoot }).records.length, 0);
  assert.equal(scanCodexUsage(0, { sessionsDir: codexRoot }).records.length, 0);
  fs.rmSync(parent, { recursive: true, force: true });
});
