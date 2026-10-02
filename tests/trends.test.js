import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.js';
import { buildTrends, clearTrendsCache, dailySeries } from '../src/trends.js';
import { aggregate as aggCodex, clearCodexStatsCache, readUsageRecords as readCodex, refreshCodexAnalytics } from '../src/codex-stats.js';
import { scanCodexRollouts } from '../src/codex-events.js';

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

test('trends never scan on the request path: Codex reads the poller-published usage and reports warming until the first publish', () => {
  const NOW = Date.UTC(2026, 6, 12, 12);
  clearCodexStatsCache();
  clearTrendsCache();
  const cold = buildTrends('7d', NOW);
  const coldCodex = cold.tools.find((t) => t.source === 'codex');
  assert.equal(coldCodex.activityState, 'warming');
  assert.deepEqual(coldCodex.daily, [], 'no fabricated zero-token days while warming');
  assert.equal(cold.tools.find((t) => t.source === 'claude-code').activityState, 'ready');

  let scans = 0;
  const usage = [
    { tsMs: NOW - 2 * DAY, sessionKey: 's1', turnKey: 'a', input: 100, cached: 40, output: 10, total: 110, model: 'gpt-5-codex' },
    { tsMs: NOW - 20 * DAY, sessionKey: 's2', turnKey: 'b', input: 50, cached: 0, output: 5, total: 55, model: 'gpt-5-codex' },
  ];
  assert.equal(refreshCodexAnalytics(NOW, () => { scans++; return { usage, completions: [], compactions: [], tools: [], capabilities: {} }; }), true);
  const week = buildTrends('7d', NOW).tools.find((t) => t.source === 'codex');
  assert.equal(week.activityState, 'ready', 'a warming answer is not cached past the first publish');
  assert.deepEqual(week.daily.map((d) => [d.tokens, d.input, d.cacheRead]), [[110, 60, 40]]);
  assert.equal(buildTrends('30d', NOW).tools.find((t) => t.source === 'codex').daily.length, 2);
  assert.equal(scans, 1, 'trend requests read the published scan; they never rescan');
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
