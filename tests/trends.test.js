import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { config } from '../config.js';
import { buildTrends, clearTrendsCache, dailySeries, refreshClaudeTrendsAsync, clearClaudeTrendsCache } from '../src/trends.js';
import { claudeTrendCacheStats, claudeTrendLimits } from '../src/claude-trend-cache.js';
import { aggregate as aggClaude, readUsageRecords as readClaude } from '../src/stats.js';
import { aggregate as aggCodex, clearCodexStatsCache, readUsageRecords as readCodex, refreshCodexAnalytics } from '../src/codex-stats.js';
import { scanCodexRollouts } from '../src/codex-events.js';
import { getDb } from '../src/db.js';

// Hermetic: trends also reads the snapshot DB and Claude transcripts. Point
// both at an empty temp tree before anything opens them.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-trends-'));
config.dataDir = path.join(tmp, 'data');
config.claudeDir = path.join(tmp, 'claude');
config.codexDir = path.join(tmp, 'codex');
test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
const DAY = 86_400_000;

test('dailySeries buckets records by day, preserves totals, sorts ascending', () => {
  const recs = [
    { tsMs: Date.UTC(2026, 0, 1, 10, 0, 0), v: 1 },
    { tsMs: Date.UTC(2026, 0, 1, 20, 0, 0), v: 2 },
    { tsMs: Date.UTC(2026, 0, 3, 5, 0, 0), v: 3 },
  ];
  const agg = (rs) => ({
    tokens: rs.reduce((a, r) => a + r.v, 0),
    input: 0, output: 0, cacheRead: 0, cost: 0, cacheHitRate: 0,
  });
  const s = dailySeries(recs, agg);
  assert.equal(s.reduce((a, d) => a + d.tokens, 0), 6); // totals preserved
  assert.ok(s.length >= 1 && s.length <= 3); // bucketed (exact count is tz-dependent)
  const days = s.map((d) => Date.parse(d.day));
  assert.deepEqual(days, [...days].sort((a, b) => a - b)); // ascending
});

test('dailySeries handles empty input', () => {
  assert.deepEqual(dailySeries([], () => ({})), []);
});

test('trends normalizes inherited and unknown range keys before and after daily caches publish', async () => {
  const NOW = Date.UTC(2026, 6, 12, 12);
  const fallbackRanges = [undefined, '', 'bogus', '7D', 'constructor', 'toString',
    '__proto__', 'hasOwnProperty', '__defineGetter__', 'valueOf'];
  clearClaudeTrendsCache();
  clearCodexStatsCache();
  try {
    for (const phase of ['warming', 'ready']) {
      if (phase === 'ready') {
        assert.equal(await refreshClaudeTrendsAsync(NOW), true);
        assert.equal(refreshCodexAnalytics(NOW, () => ({ usage: [], completions: [],
          compactions: [], tools: [], capabilities: {} })), true);
      }
      for (const range of ['24h', '7d', '30d']) {
        const value = buildTrends(range, NOW);
        assert.equal(value.range, range);
        assert.ok(value.tools.every(tool => tool.activityState === phase));
      }
      const week = buildTrends('7d', NOW);
      for (const range of fallbackRanges) {
        assert.equal(buildTrends(range, NOW), week, `${phase}: ${String(range)} reuses the canonical cache entry`);
      }
    }
  } finally {
    clearClaudeTrendsCache();
    clearCodexStatsCache();
  }
});

test('trends cache warming for exactly 2s, ready for 60s, and immediately reveal publications, failures and resets', async () => {
  const NOW = Date.UTC(2026, 6, 12, 12);
  clearClaudeTrendsCache(); clearCodexStatsCache();
  const db = getDb(), prepare = db.prepare;
  let queries = 0;
  db.prepare = function(sql, ...args) {
    if (sql.includes('captured_at >= ?')) queries++;
    return prepare.call(this, sql, ...args);
  };
  const ranges = ['24h', '7d', '30d'];
  const values = at => Object.fromEntries(ranges.map(range => [range, buildTrends(range, at)]));
  const scan = () => ({ usage: [{ tsMs: NOW - 1000, input: 100, output: 10, cached: 40 }],
    completions: [], compactions: [], tools: [], capabilities: {} });
  try {
    const cold = values(NOW);
    assert.equal(queries, 12);
    for (const range of ranges) assert.equal(buildTrends(range, NOW + 1999), cold[range]);
    assert.equal(queries, 12, 'warming hits skip all snapshot queries');
    const expired = values(NOW + 2000);
    for (const range of ranges) assert.notEqual(expired[range], cold[range]);
    assert.equal(queries, 24, 'warming expires at exactly 2000ms');
    // Publish Codex inside the warming TTL, while Claude is still cold.
    assert.equal(refreshCodexAnalytics(NOW, scan), true);
    const mixed = values(NOW + 2001);
    for (const range of ranges) {
      assert.equal(mixed[range].tools[0].activityState, 'warming');
      assert.equal(mixed[range].tools[1].activityState, 'ready');
      assert.equal(mixed[range].tools[1].daily[0].tokens, 110);
    }
    const pricing = Object.getOwnPropertyDescriptor(config, 'openaiPricing');
    try {
      Object.defineProperty(config, 'openaiPricing', { configurable: true,
        get() { throw new Error('daily aggregation must not run on cache hits'); } });
      for (const range of ranges) assert.equal(buildTrends(range, NOW + 4000), mixed[range]);
    } finally { Object.defineProperty(config, 'openaiPricing', pricing); }
    const mixedExpired = values(NOW + 4001);
    for (const range of ranges) assert.notEqual(mixedExpired[range], mixed[range]);
    await refreshClaudeTrendsAsync(NOW);
    const ready = values(NOW + 4002);
    for (const range of ranges) {
      assert.ok(ready[range].tools.every(t => t.activityState === 'ready'));
      assert.equal(buildTrends(range, NOW + 64001), ready[range]);
      assert.notEqual(buildTrends(range, NOW + 64002), ready[range]);
    }
    assert.equal(refreshCodexAnalytics(NOW, () => { throw new Error('/private/scan-error'); }), false);
    const failed = values(NOW + 64003);
    for (const range of ranges) {
      const tool = failed[range].tools[1];
      assert.equal(tool.activityState, 'error');
      assert.deepEqual(tool.daily, ready[range].tools[1].daily);
      assert.equal(tool.activityGeneratedAt, new Date(NOW).toISOString());
    }
    assert.equal(refreshCodexAnalytics(NOW, scan), true, 'same timestamp still invalidates on publication');
    const recovered = values(NOW + 64004);
    for (const range of ranges) assert.equal(recovered[range].tools[1].activityState, 'ready');
    clearCodexStatsCache();
    const codexReset = values(NOW + 64005);
    for (const range of ranges) assert.equal(codexReset[range].tools[1].activityState, 'warming');
    clearClaudeTrendsCache();
    const bothReset = values(NOW + 64006);
    for (const range of ranges) assert.ok(bothReset[range].tools.every(t => t.activityState === 'warming'));
    clearTrendsCache();
    for (const range of ranges) assert.notEqual(buildTrends(range, NOW + 64006), bothReset[range]);
  } finally {
    db.prepare = prepare;
    clearClaudeTrendsCache(); clearCodexStatsCache();
  }
});

test('trends never scan on the request path: Codex reads the poller-published usage and reports warming until the first publish', () => {
  const NOW = Date.UTC(2026, 6, 12, 12);
  clearCodexStatsCache();
  clearTrendsCache();
  const cold = buildTrends('7d', NOW);
  const coldCodex = cold.tools.find((t) => t.source === 'codex');
  assert.equal(coldCodex.activityState, 'warming');
  assert.deepEqual(coldCodex.daily, [], 'no fabricated zero-token days while warming');
  assert.equal(cold.tools.find((t) => t.source === 'claude-code').activityState, 'warming');

  let scans = 0;
  const usage = [
    { tsMs: NOW - 2 * DAY, sessionKey: 's1', turnKey: 'a', input: 100, cached: 40, output: 10, total: 110, model: 'gpt-5-codex' },
    { tsMs: NOW - 20 * DAY, sessionKey: 's2', turnKey: 'b', input: 50, cached: 0, output: 5, total: 55, model: 'gpt-5-codex' },
  ];
  assert.equal(refreshCodexAnalytics(NOW, () => { scans++; return { usage, completions: [], compactions: [], tools: [], capabilities: {} }; }), true);
  const week = buildTrends('7d', NOW).tools.find((t) => t.source === 'codex');
  assert.equal(week.activityState, 'ready', 'first publication immediately invalidates the warming answer');
  assert.deepEqual(week.daily.map((d) => [d.tokens, d.input, d.cacheRead]), [[110, 60, 40]]);
  assert.equal(buildTrends('30d', NOW).tools.find((t) => t.source === 'codex').daily.length, 2);
  assert.equal(scans, 1, 'trend requests read the published scan; they never rescan');
});

const claude = (range, now) => buildTrends(range, now).tools.find(t => t.source === 'claude-code');
const usageRow = (tsMs, n = 1, model = 'claude-sonnet-4-6') => ({ timestamp: new Date(tsMs).toISOString(),
  sessionId: 'local-test', message: { model, usage: { input_tokens: 17 * n, output_tokens: 3 * n,
    cache_read_input_tokens: 23 * n, cache_creation_input_tokens: 11 * n } } });
function transcript(root, name, rows, mtimeMs) {
  fs.mkdirSync(path.join(root, 'project'), { recursive: true });
  const file = path.join(root, 'project', name + '.jsonl');
  fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n'));
  fs.utimesSync(file, new Date(mtimeMs), new Date(mtimeMs));
  return file;
}

test('Claude published ranges exactly match former records, local days, ordering and totals; requests never read or aggregate transcripts', async () => {
  const previousTz = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  const NOW = Date.parse('2026-03-10T07:30:00Z');
  const root = config.projectsDir;
  const files = [];
  clearClaudeTrendsCache(); clearTrendsCache();
  try {
    // Exact rolling cutoffs, local midnight, the DST transition, duplicate
    // usage, an old record and a malformed row retain their former semantics.
    const timestamps = [NOW - 30 * DAY - 1, NOW - 30 * DAY, NOW - 7 * DAY - 1,
      NOW - 7 * DAY, NOW - DAY - 1, NOW - DAY, Date.parse('2026-03-09T06:59:59Z'),
      Date.parse('2026-03-09T07:00:00Z'), NOW - 1000, NOW - 1000];
    files.push(transcript(root, 'parity', [...timestamps.map((t, i) => usageRow(t, i + 1,
      i % 2 ? 'claude-opus-4-6' : 'claude-sonnet-4-6')), { message: { usage: {} }, timestamp: 'bad' }], NOW));
    files.push(transcript(root, 'mtime', [usageRow(NOW - DAY, 100)], NOW - 10 * DAY));
    const expected = Object.fromEntries(Object.entries({ '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY })
      .map(([range, duration]) => [range, dailySeries(readClaude(NOW - duration), aggClaude)]));
    let reads = 0, scans = 0;
    const open = fs.openSync;
    const opendir = fs.opendirSync, readdir = fs.readdirSync;
    for (const [key, original] of [['opendirSync', opendir], ['readdirSync', readdir]]) {
      fs[key] = function(file, ...args) {
        if (String(file).startsWith(root)) scans++;
        return original.call(this, file, ...args);
      };
    }
    fs.openSync = function(file, ...args) {
      if (String(file).startsWith(root)) reads++;
      return open.call(this, file, ...args);
    };
    const pricing = Object.getOwnPropertyDescriptor(config, 'pricing');
    try {
      Object.defineProperty(config, 'pricing', { configurable: true, get() { throw new Error('request-path Claude aggregation'); } });
      for (const range of Object.keys(expected)) {
        clearTrendsCache();
        assert.equal(claude(range, NOW).activityState, 'warming');
        assert.deepEqual(claude(range, NOW).daily, []);
      }
      assert.equal(reads, 0, 'cold requests never open transcripts');
      assert.equal(scans, 0, 'cold requests never traverse transcripts');
      Object.defineProperty(config, 'pricing', pricing);
      assert.equal(await refreshClaudeTrendsAsync(NOW), true);
      assert.ok(reads > 0, 'the background refresh did read the fixture');
      reads = 0; scans = 0;
      Object.defineProperty(config, 'pricing', { configurable: true, get() { throw new Error('request-path Claude aggregation'); } });
      for (const range of Object.keys(expected)) {
        clearTrendsCache();
        const tool = claude(range, NOW);
        assert.equal(tool.activityState, 'ready');
        assert.deepEqual(tool.daily, expected[range]);
        assert.ok(Object.isFrozen(tool.daily));
      }
      assert.equal(reads, 0, 'warm requests never open transcripts');
      assert.equal(scans, 0, 'warm requests never traverse transcripts');
    } finally {
      fs.openSync = open; fs.opendirSync = opendir; fs.readdirSync = readdir;
      Object.defineProperty(config, 'pricing', pricing);
    }
  } finally {
    if (previousTz === undefined) delete process.env.TZ; else process.env.TZ = previousTz;
    for (const file of files) fs.rmSync(file, { force: true });
    clearClaudeTrendsCache();
  }
});

test('Claude bounded passes converge cooperatively, single-flight and publish all ranges atomically; failures retain the last good series', async () => {
  const NOW = Date.now(), root = path.join(tmp, 'bounded-claude');
  const a = transcript(root, 'a', [usageRow(NOW - 1000)], NOW);
  transcript(root, 'b', [usageRow(NOW - 2 * DAY, 2)], NOW);
  clearClaudeTrendsCache();
  const maxReadBytes = fs.statSync(a).size + 10;
  assert.equal(await refreshClaudeTrendsAsync(NOW, { root, limits: { maxReadBytes } }), false);
  assert.equal(claudeTrendCacheStats().reason, 'read-bytes');
  for (const range of ['24h', '7d', '30d']) assert.equal(claude(range, NOW).activityState, 'warming');
  const pacer = { due: () => true, resume() {} };
  const pending = refreshClaudeTrendsAsync(NOW, { root, pacer, limits: { maxReadBytes } });
  assert.equal(refreshClaudeTrendsAsync(NOW, { root }), pending, 'refresh is single-flight');
  let serviced = false;
  await new Promise(resolve => setImmediate(() => {
    serviced = true;
    assert.equal(claude('7d', NOW).activityState, 'warming');
    resolve();
  }));
  assert.equal(await pending, true);
  assert.ok(serviced, 'event loop runs while refreshing');
  assert.equal(claude('24h', NOW).daily.reduce((n, d) => n + d.tokens, 0), 54);
  const good = Object.fromEntries(['24h', '7d', '30d'].map(range => [range, claude(range, NOW).daily]));
  fs.appendFileSync(a, '\n' + JSON.stringify(usageRow(NOW - 100, 5)));
  const fsImpl = { ...fs, openSync() { throw Object.assign(new Error('read failed'), { code: 'EACCES' }); } };
  assert.equal(await refreshClaudeTrendsAsync(NOW, { root, fsImpl }), false);
  for (const range of Object.keys(good)) {
    clearTrendsCache();
    assert.equal(claude(range, NOW).daily, good[range]);
    assert.equal(claude(range, NOW).activityState, 'ready');
  }
  const recovery = refreshClaudeTrendsAsync(NOW, { root, pacer });
  for (const range of Object.keys(good)) assert.equal(claude(range, NOW).daily, good[range]);
  assert.equal(await recovery, true);
  for (const range of Object.keys(good)) assert.notEqual(claude(range, NOW).daily, good[range]);
  assert.equal(claude('24h', NOW).daily.reduce((n, d) => n + d.tokens, 0), 324);
  clearClaudeTrendsCache();
});

test('Claude traversal, byte, event, record, cache and time ceilings fail closed; missing roots publish authoritative empty', async () => {
  const NOW = Date.now(), root = path.join(tmp, 'ceilings-claude');
  transcript(root, 'a', [usageRow(NOW - 1000), usageRow(NOW - 2000)], NOW);
  transcript(root, 'b', [usageRow(NOW - 3000)], NOW);
  for (const key of ['maxDirectories', 'maxEntries', 'maxFiles', 'maxFileBytes', 'maxReadBytes',
    'maxLineBytes', 'maxEvents', 'maxRecords', 'maxCacheBytes', 'maxWallMs']) {
    assert.ok(Number.isSafeInteger(claudeTrendLimits[key]) && claudeTrendLimits[key] > 0);
    clearClaudeTrendsCache();
    let clock = 0;
    assert.equal(await refreshClaudeTrendsAsync(NOW, { root, limits: { [key]: 1 },
      ...(key === 'maxWallMs' ? { nowFn: () => clock++ } : {}) }), false, key);
    assert.equal(claude('7d', NOW).activityState, 'warming', key);
    const stats = claudeTrendCacheStats();
    assert.ok(stats.cacheRecords <= claudeTrendLimits.maxRecords);
    assert.ok(stats.cacheEstimatedBytes <= claudeTrendLimits.maxCacheBytes);
  }
  clearClaudeTrendsCache();
  assert.equal(await refreshClaudeTrendsAsync(NOW, { root: path.join(tmp, 'absent') }), true);
  assert.equal(claude('7d', NOW).activityState, 'ready');
  assert.deepEqual(claude('7d', NOW).daily, []);
  clearClaudeTrendsCache();
});

test('Claude descriptor validation rejects a changing file and oversized daily results without publishing', async () => {
  const NOW = Date.now(), root = path.join(tmp, 'changing-claude');
  const file = transcript(root, 'a', [usageRow(NOW - 1000)], NOW);
  clearClaudeTrendsCache();
  let changed = false;
  const fsImpl = { ...fs, readSync(...args) {
    const count = fs.readSync(...args);
    if (!changed) { changed = true; fs.appendFileSync(file, '\n'); }
    return count;
  } };
  assert.equal(await refreshClaudeTrendsAsync(NOW, { root, fsImpl }), false);
  assert.equal(claudeTrendCacheStats().cacheRecords, 0, 'unvalidated parse never enters cache');
  assert.equal(claude('7d', NOW).activityState, 'warming');
  clearClaudeTrendsCache();
  transcript(root, 'a', Array.from({ length: claudeTrendLimits.maxDailyBuckets + 1 }, (_, i) => usageRow(NOW + i * DAY)), NOW);
  assert.equal(await refreshClaudeTrendsAsync(NOW, { root }), false);
  assert.equal(claude('30d', NOW).activityState, 'warming');
  clearClaudeTrendsCache();
});

test('Claude FIFO replacement at open fails promptly without cache pollution or publication', () => {
  // Keep the real blocking-open regression outside this runner. If O_NONBLOCK
  // disappears, the child is killed instead of hanging the entire test suite.
  const root = path.join(tmp, 'fifo-claude');
  const script = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import path from 'node:path';
    import { execFileSync } from 'node:child_process';
    import { config } from ${JSON.stringify(new URL('../config.js', import.meta.url).href)};
    import { buildTrends, refreshClaudeTrendsAsync, clearClaudeTrendsCache }
      from ${JSON.stringify(new URL('../src/trends.js', import.meta.url).href)};
    import { claudeTrendCacheStats }
      from ${JSON.stringify(new URL('../src/claude-trend-cache.js', import.meta.url).href)};
    const root = process.argv[1], now = Date.now();
    config.dataDir = path.join(root, 'data');
    config.claudeDir = path.join(root, 'claude');
    config.codexDir = path.join(root, 'codex');
    const file = path.join(root, 'project', 'a.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const row = JSON.stringify({ timestamp: new Date(now - 1000).toISOString(),
      message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 17, output_tokens: 3 } } });
    fs.writeFileSync(file, row);
    const ranges = ['24h', '7d', '30d'];
    const tool = range => buildTrends(range, now).tools.find(t => t.source === 'claude-code');
    let opens = 0, closes = 0;
    const fsImpl = { ...fs,
      openSync(target, flags) {
        assert.equal(target, file);
        fs.unlinkSync(target);
        execFileSync('mkfifo', [target], { timeout: 500 });
        const fd = fs.openSync(target, flags);
        opens++;
        return fd;
      },
      readSync() { assert.fail('a nonregular descriptor must never be read'); },
      closeSync(fd) { closes++; fs.closeSync(fd); },
    };
    async function rejectFifo() {
      const started = performance.now();
      assert.equal(await refreshClaudeTrendsAsync(now, { root, fsImpl }), false);
      assert.ok(performance.now() - started < 1000, 'FIFO rejection must be prompt');
      assert.equal(claudeTrendCacheStats().reason, 'file-changed');
      assert.equal(opens, closes, 'the rejected descriptor must be closed');
    }
    clearClaudeTrendsCache();
    await rejectFifo();
    assert.equal(opens, 1, 'the real open returned without a FIFO writer');
    assert.equal(claudeTrendCacheStats().files, 0);
    assert.equal(claudeTrendCacheStats().cacheRecords, 0);
    assert.equal(claudeTrendCacheStats().cacheEstimatedBytes, 0);
    for (const range of ranges) {
      assert.equal(tool(range).activityState, 'warming');
      assert.deepEqual(tool(range).daily, []);
    }
    fs.unlinkSync(file);
    fs.writeFileSync(file, row);
    assert.equal(await refreshClaudeTrendsAsync(now, { root }), true);
    const good = Object.fromEntries(ranges.map(range => [range, tool(range).daily]));
    for (const range of ranges) assert.equal(good[range].reduce((n, d) => n + d.tokens, 0), 20);
    const cached = claudeTrendCacheStats();
    assert.equal(cached.cacheRecords, 1, 'ordinary regular-file reads remain valid');
    fs.appendFileSync(file, '\\n' + row);
    await rejectFifo();
    assert.equal(opens, 2);
    for (const key of ['files', 'cacheRecords', 'cacheEstimatedBytes'])
      assert.equal(claudeTrendCacheStats()[key], cached[key], 'failed replacement cannot pollute ' + key);
    for (const range of ranges) {
      assert.equal(tool(range).activityState, 'ready');
      assert.equal(tool(range).daily, good[range], 'the last complete publication survives');
    }
    console.log('FIFO replacement regression passed');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script, root], {
    encoding: 'utf8', timeout: 2000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024,
    env: { ...process.env, LLMDASH_HOSTS: '', LLMDASH_CLAUDE_AUTOREFRESH: '0' },
  });
  const detail = result.stdout + result.stderr;
  assert.equal(result.error, undefined, detail);
  assert.equal(result.status, 0, detail);
  assert.match(result.stdout, /FIFO replacement regression passed/);
});

test('cached Codex trend records equal the former request-path scan for 24h, 7d, and 30d', () => {
  const NOW = Date.now();
  const dir = path.join(config.codexSessionsDir, '2026', '10', '01');
  fs.mkdirSync(dir, { recursive: true });
  const rows = (id, hoursAgo) => [
    { timestamp: new Date(NOW - hoursAgo * 3_600_000).toISOString(), type: 'event_msg', payload: { type: 'task_started', turn_id: id } },
    { timestamp: new Date(NOW - hoursAgo * 3_600_000).toISOString(), type: 'turn_context', payload: { turn_id: id, model: 'gpt-5-codex' } },
    { timestamp: new Date(NOW - hoursAgo * 3_600_000 + 1000).toISOString(), type: 'event_msg', payload: { type: 'token_count', turn_id: id, info: { last_token_usage: { input_tokens: 100 + hoursAgo, cached_input_tokens: 10, output_tokens: 7 } } } },
  ];
  fs.writeFileSync(path.join(dir, 'rollout-a.jsonl'), [...rows('t1', 2), ...rows('t2', 30)].map((r) => JSON.stringify(r)).join('\n'));
  fs.writeFileSync(path.join(dir, 'rollout-b.jsonl'), [...rows('t3', 5 * 24), ...rows('t4', 20 * 24)].map((r) => JSON.stringify(r)).join('\n'));
  clearCodexStatsCache();
  assert.equal(refreshCodexAnalytics(NOW), true);
  for (const rangeMs of [DAY, 7 * DAY, 30 * DAY]) {
    const since = NOW - rangeMs;
    // The pre-change trends reader, verbatim: a direct scan bounded at `since`.
    const former = scanCodexRollouts(since).usage.filter((r) => r.tsMs >= since).map((r) => ({ ...r, sessionId: r.sessionKey }));
    assert.ok(former.length > 0);
    assert.deepEqual(readCodex(since), former);
    assert.deepEqual(dailySeries(readCodex(since), aggCodex, { utc: true, subset: true }),
      dailySeries(former, aggCodex, { utc: true, subset: true }));
  }
});
