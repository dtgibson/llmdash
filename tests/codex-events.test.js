import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  clearCodexEventCache,
  scanCodexRollouts,
  scanCodexSession,
  usageRecordsFromScan,
} from '../src/codex-events.js';

const at = (second) => `2026-07-12T12:00:${String(second).padStart(2, '0')}.000Z`;
const line = (timestamp, type, payload) => JSON.stringify({ timestamp, type, payload });

function token(timestamp, usage, total, extra = {}) {
  return line(timestamp, 'event_msg', {
    type: 'token_count',
    ...extra,
    info: {
      last_token_usage: usage,
      ...(total ? { total_token_usage: total } : {}),
      ...(extra.contextWindow ? { model_context_window: extra.contextWindow } : {}),
    },
  });
}

test('normalizes a current turn, associates context, and deduplicates complete token fingerprints', () => {
  const usage = { input_tokens: 100, cached_input_tokens: 80, output_tokens: 20, reasoning_output_tokens: 0 };
  const total1 = { input_tokens: 100, cached_input_tokens: 80, output_tokens: 20 };
  const total2 = { input_tokens: 200, cached_input_tokens: 160, output_tokens: 40 };
  const scan = scanCodexSession([
    line(at(0), 'event_msg', { type: 'task_started', turn_id: 'opaque-turn-id', model_context_window: 1000 }),
    line(at(1), 'turn_context', { turn_id: 'opaque-turn-id', model: 'gpt-5.5-codex', effort: 'high' }),
    token(at(2), usage, total1),
    token(at(3), usage, total1),
    token(at(4), usage, total2),
    line(at(5), 'event_msg', {
      type: 'task_complete', turn_id: 'opaque-turn-id', duration_ms: 1200,
      time_to_first_token_ms: 125, completed_at: at(5), last_agent_message: 'PRIVATE RESPONSE',
    }),
  ], 'rollout-a');

  assert.equal(scan.usage.length, 2, 'the repeated snapshot is removed, but an advanced cumulative tuple is retained');
  assert.deepEqual(scan.usage[0], {
    tsMs: Date.parse(at(2)), sessionKey: 'rollout-a', turnKey: 'turn-1',
    input: 100, cached: 80, output: 20, reasoning: 0, total: 120,
    model: 'gpt-5.5-codex', effort: 'High', contextWindow: 1000,
  });
  assert.deepEqual(scan.completions, [{
    tsMs: Date.parse(at(5)), sessionKey: 'rollout-a', turnKey: 'turn-1',
    durationMs: 1200, firstTokenMs: 125, model: 'gpt-5.5-codex', effort: 'High',
  }]);
  assert.deepEqual(scan.capabilities, {
    toolEvents: false, compactionEvents: false, turnBoundaries: true,
    reasoning: true, context: true, latency: true,
  });
  const serialized = JSON.stringify(scan);
  assert.doesNotMatch(serialized, /opaque-turn-id|PRIVATE RESPONSE/);
});

test('uses consecutive fallback dedupe when a legacy stream lacks a turn or cumulative tuple', () => {
  const a = { input_tokens: 10, output_tokens: 2 };
  const b = { input_tokens: 20, output_tokens: 3 };
  const scan = scanCodexSession([
    token(at(1), a),
    token(at(2), a),
    token(at(3), b),
    token(at(4), a),
  ], 'legacy');
  assert.deepEqual(scan.usage.map((r) => [r.tsMs, r.total, r.turnKey]), [
    [Date.parse(at(1)), 12, null],
    [Date.parse(at(3)), 23, null],
    [Date.parse(at(4)), 12, null],
  ]);
});

test('preserves reasoning missing versus explicit zero and rejects malformed core token tuples', () => {
  const scan = scanCodexSession([
    token(at(1), { input_tokens: 5, output_tokens: 0 }),
    token(at(2), { input_tokens: 6, output_tokens: 1, reasoning_output_tokens: 0 }),
    token(at(3), { input_tokens: 2, cached_input_tokens: 3, output_tokens: 1 }),
    token(at(4), { input_tokens: '7', output_tokens: 1 }),
    token(at(5), { input_tokens: 1, output_tokens: 1, reasoning_output_tokens: 2 }),
    token(at(6), { cached_input_tokens: 1 }),
  ], 'numbers');
  assert.deepEqual(scan.usage.map((r) => r.reasoning), [null, 0, null]);
  assert.deepEqual(scan.usage.map((r) => r.total), [5, 7, 2]);
  assert.equal(scan.capabilities.reasoning, true);
});

test('fills context that appears after usage while bounding model and effort labels', () => {
  const scan = scanCodexSession([
    token(at(1), { input_tokens: 10, output_tokens: 1 }, null, { turn_id: 'late-context' }),
    line(at(2), 'turn_context', {
      turn_id: 'late-context', model: '/Users/alice/private/secrets', effort: 'future-ultra',
      model_context_window: 200,
    }),
  ], 'late');
  assert.equal(scan.usage[0].turnKey, 'turn-1');
  assert.equal(scan.usage[0].model, 'Other');
  assert.equal(scan.usage[0].effort, 'Other');
  assert.equal(scan.usage[0].contextWindow, 200);
  assert.doesNotMatch(JSON.stringify(scan), /alice|private|future-ultra|late-context/);
});

test('model display labels use known grammar and cannot smuggle a family-prefixed label', () => {
  const accepted = 'gpt-12.34-codex-spark';
  const coarse = 'gpt-5-private-project-codename';
  const rejected = `chatgpt-${'b'.repeat(41)}`;
  const scan = scanCodexSession([
    line(at(1), 'turn_context', { turn_id: 'a', model: accepted }),
    token(at(2), { input_tokens: 1, output_tokens: 1 }, null, { turn_id: 'a' }),
    line(at(3), 'turn_context', { turn_id: 'b', model: coarse }),
    token(at(4), { input_tokens: 1, output_tokens: 1 }, null, { turn_id: 'b' }),
    line(at(5), 'turn_context', { turn_id: 'c', model: rejected }),
    token(at(6), { input_tokens: 1, output_tokens: 1 }, null, { turn_id: 'c' }),
  ], 'model-bounds');
  assert.equal(scan.usage[0].model, accepted);
  assert.equal(scan.usage[1].model, 'gpt-5');
  assert.equal(scan.usage[2].model, 'Other');
  assert.doesNotMatch(JSON.stringify(scan), /private-project-codename/);
  assert.ok(scan.usage.every((row) => row.model.length <= 48));
});

test('rejects numeric timestamps outside the JavaScript Date range', () => {
  const scan = scanCodexSession([
    token(1e308, { input_tokens: 1, output_tokens: 1 }),
    token(at(1), { input_tokens: 2, output_tokens: 1 }),
  ], 'timestamp-bounds');
  assert.deepEqual(scan.usage.map((row) => row.tsMs), [Date.parse(at(1))]);
});

test('counts canonical compactions in preference to fallback records and deduplicates structured IDs', () => {
  const scan = scanCodexSession([
    line(at(1), 'event_msg', { type: 'context_compacted', window_id: 'fallback-secret' }),
    line(at(2), 'compacted', { window_id: 'canonical-secret', message: 'PRIVATE SUMMARY' }),
    line(at(3), 'compacted', { window_id: 'canonical-secret', replacement_history: ['PRIVATE'] }),
    line(at(4), 'compacted', {}),
  ], 'compact');
  assert.deepEqual(scan.compactions, [
    { tsMs: Date.parse(at(2)), sessionKey: 'compact' },
    { tsMs: Date.parse(at(4)), sessionKey: 'compact' },
  ]);
  assert.equal(scan.capabilities.compactionEvents, true);
  assert.doesNotMatch(JSON.stringify(scan), /secret|PRIVATE/);
});

test('classifies invocation starts, deduplicates call IDs, and ignores outputs and end events', () => {
  const starts = [
    ['exec_command', 'Shell'],
    ['apply_patch', 'File edits'],
    ['web__run', 'Search'],
    ['mcp__calendar__list', 'MCP'],
    ['spawn_agent', 'Subagents'],
    ['unknown_private_tool', 'Other'],
  ];
  const events = starts.map(([name], index) => line(at(index + 1), 'response_item', {
    type: index % 2 ? 'custom_tool_call' : 'function_call', name, call_id: `call-${index}`,
    arguments: 'PRIVATE COMMAND OR PATH',
  }));
  events.push(events[0]);
  events.push(line(at(8), 'response_item', { type: 'function_call_output', call_id: 'call-0', output: 'PRIVATE OUTPUT' }));
  events.push(line(at(9), 'event_msg', { type: 'mcp_tool_call_end', name: 'mcp__calendar__list' }));
  events.push(line(at(10), 'response_item', { type: 'local_shell_call', call_id: 'shell-local', command: 'PRIVATE' }));
  events.push(line(at(11), 'response_item', { type: 'web_search_call', call_id: 'web-local', query: 'PRIVATE' }));
  events.push(line(at(12), 'response_item', { type: 'function_call', call_id: 'mcp-precedence', name: 'exec_command', namespace: 'mcp__remote' }));
  events.push(line(at(13), 'response_item', { type: 'function_call', call_id: 'wrapper', name: 'functions.exec' }));
  events.push(line(at(14), 'response_item', { type: 'tool_search_call', call_id: 'tool-search', query: 'PRIVATE' }));
  const scan = scanCodexSession(events, 'tools');
  assert.deepEqual(scan.tools.map((r) => r.category), [
    ...starts.map(([, category]) => category), 'Shell', 'Search', 'MCP', 'Other', 'Search',
  ]);
  assert.equal(scan.capabilities.toolEvents, true);
  assert.doesNotMatch(JSON.stringify(scan), /PRIVATE|unknown_private_tool|calendar/);
});

test('uses session context fallback and deduplicates repeated completions by internal turn identity', () => {
  const scan = scanCodexSession([
    line(at(0), 'session_meta', { context_window: 4096, cwd: '/PRIVATE/PATH' }),
    line(at(1), 'event_msg', { type: 'task_started', turn_id: 'complete-once' }),
    token(at(2), { input_tokens: 100, output_tokens: 10 }, { input_tokens: 100, output_tokens: 10 }),
    line(at(3), 'event_msg', { type: 'task_complete', turn_id: 'complete-once', duration_ms: 30 }),
    line(at(4), 'event_msg', { type: 'task_complete', turn_id: 'complete-once', duration_ms: 40 }),
  ], 'session-context');
  assert.equal(scan.usage[0].contextWindow, 4096);
  assert.equal(scan.completions.length, 1);
  assert.equal(scan.completions[0].durationMs, 30);
  assert.doesNotMatch(JSON.stringify(scan), /PRIVATE|complete-once/);
});

test('aborted turns stay excluded even when a contradictory completion arrives later', () => {
  const lateCompletion = scanCodexSession([
    line(at(1), 'event_msg', { type: 'task_started', turn_id: 'aborted-a' }),
    line(at(2), 'event_msg', { type: 'turn_aborted', turn_id: 'aborted-a' }),
    line(at(3), 'event_msg', { type: 'task_complete', turn_id: 'aborted-a', duration_ms: 50, time_to_first_token_ms: 10 }),
  ], 'abort-late-complete');
  assert.deepEqual(lateCompletion.completions, []);
  assert.equal(lateCompletion.capabilities.latency, false);

  const lateAbort = scanCodexSession([
    line(at(1), 'event_msg', { type: 'task_started', turn_id: 'aborted-b' }),
    line(at(2), 'event_msg', { type: 'task_complete', turn_id: 'aborted-b', duration_ms: 50 }),
    line(at(3), 'event_msg', { type: 'turn_aborted', turn_id: 'aborted-b' }),
  ], 'complete-then-abort');
  assert.deepEqual(lateAbort.completions, []);
  assert.equal(lateAbort.capabilities.latency, false);
});

test('a non-invocation response_item still proves the structured tool event capability', () => {
  const scan = scanCodexSession([
    line(at(1), 'response_item', { type: 'message', content: 'PRIVATE' }),
  ], 'capability');
  assert.equal(scan.capabilities.toolEvents, true);
  assert.deepEqual(scan.tools, []);
  assert.doesNotMatch(JSON.stringify(scan), /PRIVATE/);
});

test('timestamp-less tool and compaction records do not fabricate supported zeroes', () => {
  const scan = scanCodexSession([
    line(undefined, 'response_item', { type: 'message', content: 'PRIVATE' }),
    line(undefined, 'compacted', { window_id: 'PRIVATE' }),
  ], 'malformed-capabilities');
  assert.equal(scan.capabilities.toolEvents, false);
  assert.equal(scan.capabilities.compactionEvents, false);
  assert.deepEqual(scan.tools, []);
  assert.deepEqual(scan.compactions, []);
});

test('skips malformed JSON independently and exposes a legacy usage helper without changing normalized fields', () => {
  const scan = scanCodexSession([
    '', '{bad json', 'null', '5', '[]',
    token(at(1), { input_tokens: 2, cached_input_tokens: 1, output_tokens: 3 }),
  ], 'safe');
  assert.equal(scan.usage.length, 1);
  const [legacy] = usageRecordsFromScan(scan);
  assert.equal(legacy.sessionId, 'safe');
  assert.equal(legacy.sessionKey, 'safe');
  assert.equal(legacy.total, 5);
});

test('a timestamp-less token record cannot suppress a later valid duplicate', () => {
  const usage = { input_tokens: 10, output_tokens: 2 };
  const cumulative = { input_tokens: 10, output_tokens: 2 };
  const scan = scanCodexSession([
    line(undefined, 'event_msg', { type: 'task_started', turn_id: 'same-turn' }),
    token(undefined, usage, cumulative),
    token(at(2), usage, cumulative),
  ], 'timestamps');
  assert.equal(scan.usage.length, 1);
  assert.equal(scan.usage[0].tsMs, Date.parse(at(2)));
});

test('parses legacy top-level token and completion fields without retaining content', () => {
  const scan = scanCodexSession([
    JSON.stringify({ type: 'task_started', turn_id: 'legacy-top', model_context_window: 4096 }),
    JSON.stringify({
      timestamp: at(1), type: 'token_count', turn_id: 'legacy-top',
      usage: { input_tokens: 7, cached_input_tokens: 2, output_tokens: 3 },
      prompt: 'PRIVATE LEGACY PROMPT',
    }),
    JSON.stringify({
      type: 'task_complete', turn_id: 'legacy-top', completed_at: at(2),
      duration_ms: 50, time_to_first_token_ms: 10, response: 'PRIVATE LEGACY RESPONSE',
    }),
  ], 'legacy-top-level');
  assert.equal(scan.usage.length, 1);
  assert.equal(scan.usage[0].total, 10);
  assert.equal(scan.usage[0].contextWindow, 4096);
  assert.deepEqual(scan.completions.map((row) => [row.durationMs, row.firstTokenMs]), [[50, 10]]);
  assert.doesNotMatch(JSON.stringify(scan), /PRIVATE|legacy-top(?!-level)/);
});

test('rollout scanner parses full files before range filtering and reuses path/mtime/size cache entries', () => {
  clearCodexEventCache();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-codex-events-'));
  const nested = path.join(directory, '2026', '07', '12');
  fs.mkdirSync(nested, { recursive: true });
  const rollout = path.join(nested, 'rollout-fixture.jsonl');
  const before = line(at(0), 'turn_context', { turn_id: 'range-turn', model: 'gpt-5-codex', effort: 'medium' });
  const after = token(at(2), { input_tokens: 10, output_tokens: 2 }, { input_tokens: 10, output_tokens: 2 }, { turn_id: 'range-turn' });
  fs.writeFileSync(rollout, `${before}\n${after}\n`);
  let reads = 0;
  const countedFs = {
    readdirSync: (...args) => fs.readdirSync(...args),
    statSync: (...args) => fs.statSync(...args),
    readFileSync: (...args) => { reads++; return fs.readFileSync(...args); },
  };

  try {
    const since = Date.parse(at(1));
    const first = scanCodexRollouts(since, { sessionsDir: directory, fs: countedFs });
    assert.equal(first.usage.length, 1);
    assert.equal(first.usage[0].model, 'gpt-5-codex', 'pre-range context is still associated');
    assert.equal(first.usage[0].effort, 'Medium');
    assert.equal(reads, 1);
    scanCodexRollouts(since, { sessionsDir: directory, fs: countedFs });
    assert.equal(reads, 1, 'an unchanged path/mtime/size tuple is not reparsed');

    const future = Date.now() + 60_000;
    assert.equal(scanCodexRollouts(future, { sessionsDir: directory, fs: countedFs }).usage.length, 0);
    scanCodexRollouts(since, { sessionsDir: directory, fs: countedFs });
    assert.equal(reads, 1, 'a narrower range does not evict the shared 30-day parse cache');
    scanCodexRollouts(future, { sessionsDir: directory, fs: countedFs, pruneBeforeMs: future });
    scanCodexRollouts(since, { sessionsDir: directory, fs: countedFs });
    assert.equal(reads, 2, 'the broad refresh can explicitly prune entries outside its retention bound');
  } finally {
    clearCodexEventCache();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('an unreadable session root fails the refresh without evicting the last parsed file', () => {
  clearCodexEventCache();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-codex-events-unreadable-'));
  const rollout = path.join(directory, 'rollout-fixture.jsonl');
  fs.writeFileSync(rollout, `${token(at(1), { input_tokens: 4, output_tokens: 1 })}\n`);
  let unreadable = false, reads = 0;
  const guardedFs = {
    readdirSync: (...args) => {
      if (unreadable && path.resolve(args[0]) === path.resolve(directory)) {
        const error = new Error('denied'); error.code = 'EACCES'; throw error;
      }
      return fs.readdirSync(...args);
    },
    statSync: (...args) => fs.statSync(...args),
    readFileSync: (...args) => { reads++; return fs.readFileSync(...args); },
  };
  try {
    const since = Date.parse(at(0));
    assert.equal(scanCodexRollouts(since, { sessionsDir: directory, fs: guardedFs, pruneBeforeMs: since }).usage.length, 1);
    assert.equal(reads, 1);
    unreadable = true;
    assert.throws(() => scanCodexRollouts(since, { sessionsDir: directory, fs: guardedFs, pruneBeforeMs: since }), /could not be read/);
    unreadable = false;
    assert.equal(scanCodexRollouts(since, { sessionsDir: directory, fs: guardedFs, pruneBeforeMs: since }).usage.length, 1);
    assert.equal(reads, 1, 'the last parsed file survived the transient root failure');
  } finally {
    clearCodexEventCache();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('removing the session root clears cached activity on the next broad refresh', () => {
  clearCodexEventCache();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-codex-events-removed-'));
  const rollout = path.join(directory, 'rollout-fixture.jsonl');
  fs.writeFileSync(rollout, `${token(at(1), { input_tokens: 4, output_tokens: 1 })}\n`);
  const since = Date.parse(at(0));
  try {
    assert.equal(scanCodexRollouts(since, { sessionsDir: directory, pruneBeforeMs: since }).usage.length, 1);
    fs.rmSync(directory, { recursive: true, force: true });
    assert.equal(scanCodexRollouts(since, { sessionsDir: directory, pruneBeforeMs: since }).usage.length, 0);
  } finally {
    clearCodexEventCache();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('scan safety budgets are bounded, content-free, and atomic', () => {
  assert.throws(
    () => scanCodexSession(['{}', '{}'], 'PRIVATE-BUDGET', { limits: { maxEventsPerFile: 1 } }),
    (error) => error.code === 'CODEX_SCAN_BUDGET'
      && error.message === 'Codex session scan exceeded its safety budget'
      && !error.message.includes('PRIVATE-BUDGET'),
  );
  assert.throws(
    () => scanCodexSession([
      token(at(1), { input_tokens: 4, output_tokens: 1 }),
      token(at(2), { input_tokens: 5, output_tokens: 1 }),
    ], 'PRIVATE-RECORD-BUDGET', { limits: { maxResultRecords: 1 } }),
    (error) => error.code === 'CODEX_SCAN_BUDGET' && error.reason === 'scan_budget_records',
  );

  clearCodexEventCache();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-codex-events-budget-'));
  const rollout = path.join(directory, 'rollout-private-budget.jsonl');
  const first = `${token(at(1), { input_tokens: 4, output_tokens: 1 })}\n`;
  fs.writeFileSync(rollout, first);
  const since = Date.parse(at(0));
  try {
    let reads = 0;
    const countedFs = {
      readdirSync: (...args) => fs.readdirSync(...args),
      statSync: (...args) => fs.statSync(...args),
      readFileSync: (...args) => { reads++; return fs.readFileSync(...args); },
    };
    assert.throws(
      () => scanCodexRollouts(since, {
        sessionsDir: directory,
        fs: countedFs,
        limits: { maxFileBytes: first.length - 1 },
      }),
      (error) => error.code === 'CODEX_SCAN_BUDGET' && !error.message.includes('private-budget'),
    );
    assert.equal(reads, 0, 'an oversized file is rejected from stat metadata before it is read');

    const initial = scanCodexRollouts(since, { sessionsDir: directory, pruneBeforeMs: since });
    assert.equal(initial.usage.length, 1);
    fs.appendFileSync(rollout, `${token(at(2), { input_tokens: 5, output_tokens: 1 })}\n`);
    assert.throws(
      () => scanCodexRollouts(since, {
        sessionsDir: directory,
        pruneBeforeMs: since,
        limits: { maxEventsPerScan: 1 },
      }),
      (error) => error.code === 'CODEX_SCAN_BUDGET',
    );

    const unreadableChangedFs = {
      readdirSync: (...args) => fs.readdirSync(...args),
      statSync: (...args) => fs.statSync(...args),
      readFileSync: () => { const error = new Error('denied'); error.code = 'EACCES'; throw error; },
    };
    const retained = scanCodexRollouts(since, { sessionsDir: directory, fs: unreadableChangedFs });
    assert.equal(retained.usage.length, 1, 'a failed budgeted parse cannot replace the prior complete cache entry');
    assert.equal(retained.usage[0].total, 5);
  } finally {
    clearCodexEventCache();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('unreadable nested directories and individual files are isolated from valid sessions', () => {
  clearCodexEventCache();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-codex-events-partial-'));
  const nested = path.join(directory, 'nested');
  fs.mkdirSync(nested);
  const good = path.join(directory, 'rollout-good.jsonl');
  const cachedNested = path.join(nested, 'rollout-nested.jsonl');
  const blocked = path.join(directory, 'rollout-blocked.jsonl');
  fs.writeFileSync(good, `${token(at(1), { input_tokens: 4, output_tokens: 1 })}\n`);
  fs.writeFileSync(cachedNested, `${token(at(2), { input_tokens: 5, output_tokens: 1 })}\n`);
  let blockNested = false, blockGoodRead = false;
  const partialFs = {
    readdirSync: (...args) => {
      if (blockNested && path.resolve(args[0]) === path.resolve(nested)) {
        const error = new Error('denied'); error.code = 'EACCES'; throw error;
      }
      return fs.readdirSync(...args);
    },
    statSync: (...args) => fs.statSync(...args),
    readFileSync: (...args) => {
      const target = path.resolve(args[0]);
      if (target === path.resolve(blocked) || (blockGoodRead && target === path.resolve(good))) {
        const error = new Error('denied'); error.code = 'EACCES'; throw error;
      }
      return fs.readFileSync(...args);
    },
  };
  try {
    const since = Date.parse(at(0));
    assert.equal(scanCodexRollouts(since, { sessionsDir: directory, fs: partialFs, pruneBeforeMs: since }).usage.length, 2);
    blockNested = true;
    assert.equal(scanCodexRollouts(since, { sessionsDir: directory, fs: partialFs, pruneBeforeMs: since }).usage.length, 2,
      'a cached unreadable subtree keeps its last complete normalized records');
    blockNested = false;
    fs.writeFileSync(blocked, `${token(at(3), { input_tokens: 9, output_tokens: 1 })}\n`);
    fs.appendFileSync(good, `${token(at(4), { input_tokens: 7, output_tokens: 1 })}\n`);
    blockGoodRead = true;
    assert.equal(scanCodexRollouts(since, { sessionsDir: directory, fs: partialFs, pruneBeforeMs: since }).usage.length, 2,
      'cold unreadable files are skipped and changed unreadable files reuse their prior parse');
  } finally {
    clearCodexEventCache();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
