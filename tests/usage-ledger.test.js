import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  clearUsageLedgerCaches, scanClaudeUsage, scanCodexUsage, usageLedgerLimits,
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
    input: 10, output: 4, cacheWrite: 2, cacheRead: 8, identityQuality: 'stable',
  });
  assert.equal(out.report.deduplicatedRecords, 2);
  assert.equal(out.report.fallbackIdentityRecords, 1);
  assert.equal(out.report.complete, false);
  assert.deepEqual(out.report.reasons, ['dedupe_fallback', 'record_unsupported']);
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
