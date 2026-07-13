import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCodexInsights, clearCodexStatsCache, computeCodexActivity,
  getCodexInsights, refreshCodexAnalytics,
} from '../src/codex-stats.js';

const NOW = Date.UTC(2026, 6, 12, 12);
const at = (day, hour = 10) => Date.UTC(2026, 6, day, hour);

function fixture() {
  return {
    capabilities: { turnBoundaries: true, toolEvents: true },
    usage: [
      { tsMs: at(11), sessionKey: 's1', turnKey: 'a', input: 800, cached: 300, output: 200, reasoning: 50, total: 1000, model: 'gpt-5.5-codex', effort: 'High', contextWindow: 1000 },
      { tsMs: at(11, 11), sessionKey: 's1', turnKey: 'a', input: 100, cached: 0, output: 100, reasoning: 0, total: 200, model: 'gpt-5.5-codex', effort: 'High', contextWindow: 1000 },
      { tsMs: at(12), sessionKey: 's2', turnKey: 'b', input: 400, cached: 100, output: 100, reasoning: 50, total: 500, model: 'gpt-5-codex', effort: 'Medium', contextWindow: 1000 },
    ],
    completions: [
      { tsMs: at(11, 11), sessionKey: 's1', turnKey: 'a', durationMs: 100, firstTokenMs: 50 },
      { tsMs: at(12), sessionKey: 's2', turnKey: 'b', durationMs: 300, firstTokenMs: 70 },
      { tsMs: at(12), sessionKey: 's2', turnKey: 'bad', durationMs: null, firstTokenMs: null },
    ],
    compactions: [
      { tsMs: at(11), sessionKey: 's1' },
      { tsMs: at(11, 11), sessionKey: 's1' },
    ],
    tools: [
      { tsMs: at(11), sessionKey: 's1', turnKey: 'a', category: 'Shell' },
      { tsMs: at(11), sessionKey: 's1', turnKey: 'a', category: 'Shell' },
      { tsMs: at(12), sessionKey: 's2', turnKey: 'b', category: 'Other' },
    ],
  };
}

test('buildCodexInsights derives exact range metrics from normalized records', () => {
  const out = buildCodexInsights(fixture(), '7d', NOW);
  assert.equal(out.source, 'codex');
  assert.equal(out.scope, 'local-machine');
  assert.equal(out.hasData, true);
  assert.deepEqual(out.summary.reasoning, { available: true, share: 0.25, tokens: 100, outputTokens: 400 });
  assert.deepEqual(out.summary.turns, { available: true, count: 2, averageTokens: 850 });
  assert.deepEqual(out.summary.sessions, { available: true, count: 2, averageTokens: 850 });
  assert.deepEqual(out.summary.busiestDay, { available: true, day: new Date(Date.UTC(2026, 6, 11)).toISOString(), tokens: 1200 });
  assert.deepEqual(out.context.pressure, { available: true, peak: 0.8, supportedTurns: 2, turnsAtOrAbove80Pct: 1 });
  assert.deepEqual(out.context.compactions, { available: true, count: 2, sessionsAffected: 1 });
  assert.deepEqual(out.latency.total, { available: true, medianMs: 200, p95Ms: 300, samples: 2 });
  assert.deepEqual(out.latency.firstToken, { available: true, medianMs: 60, p95Ms: 70, samples: 2 });
  assert.equal(out.mix.models.items.reduce((n, r) => n + r.tokens, 0), 1700);
  assert.deepEqual(out.mix.tools.items.map((r) => [r.label, r.invocations]), [['Shell', 2], ['Other', 1]]);
  assert.equal(out.daily.length, 2);
  assert.equal(out.daily[0].averageTokensPerTurn, 1200);
});

test('reasoning zero is supported while a missing reasoning field is unavailable', () => {
  const base = { capabilities: { turnBoundaries: true }, completions: [], compactions: [], tools: [] };
  const missing = buildCodexInsights({ ...base, usage: [
    { tsMs: at(12), sessionKey: 's', turnKey: 'a', input: 1, output: 100, cached: 0, reasoning: null },
  ] }, '24h', NOW);
  assert.equal(missing.summary.reasoning.available, false);
  const zero = buildCodexInsights({ ...base, usage: [
    { tsMs: at(12), sessionKey: 's', turnKey: 'a', input: 1, output: 100, cached: 0, reasoning: 0 },
  ] }, '24h', NOW);
  assert.deepEqual(zero.summary.reasoning, { available: true, share: 0, tokens: 0, outputTokens: 100 });
});

test('busiest-day ties resolve to the most recent UTC day', () => {
  const usage = [11, 12].map((day, i) => ({
    tsMs: at(day), sessionKey: `s${i}`, turnKey: `t${i}`, input: 90, output: 10, cached: 0, reasoning: 0,
  }));
  const out = buildCodexInsights({ usage, completions: [], compactions: [], tools: [] }, '7d', NOW);
  assert.equal(out.summary.busiestDay.day, new Date(Date.UTC(2026, 6, 12)).toISOString());
});

test('empty ranges return unavailable activity metrics, not fabricated zeros', () => {
  const out = buildCodexInsights({ usage: [], completions: [], compactions: [], tools: [] }, 'bogus', NOW);
  assert.equal(out.range, '7d');
  assert.equal(out.hasData, false);
  assert.equal(out.summary.turns.available, false);
  assert.equal(out.summary.turns.count, null);
  assert.equal(out.mix.tools.available, false);
});

test('non-token tool, compaction, and timing evidence remains visible as partial activity', () => {
  const out = buildCodexInsights({
    capabilities: { toolEvents: true, compactionEvents: true, turnBoundaries: true },
    usage: [],
    tools: [{ tsMs: at(12), sessionKey: 's', turnKey: 't', category: 'Shell' }],
    compactions: [{ tsMs: at(12), sessionKey: 's' }],
    completions: [{ tsMs: at(12), sessionKey: 's', turnKey: 't', durationMs: 100, firstTokenMs: 25 }],
  }, '24h', NOW);
  assert.equal(out.hasData, true);
  assert.equal(out.summary.turns.available, false);
  assert.equal(out.summary.sessions.available, false);
  assert.deepEqual(out.mix.tools.items.map((item) => [item.label, item.invocations]), [['Shell', 1]]);
  assert.deepEqual(out.context.compactions, { available: true, count: 1, sessionsAffected: 1 });
  assert.deepEqual(out.latency.total, { available: true, medianMs: 100, p95Ms: 100, samples: 1 });
  assert.deepEqual(out.latency.firstToken, { available: true, medianMs: 25, p95Ms: 25, samples: 1 });
});

test('legacy usage without explicit turn boundaries does not fabricate turn metrics', () => {
  const out = buildCodexInsights({
    capabilities: { turnBoundaries: false, compactionEvents: false },
    usage: [
      { tsMs: at(12), sessionKey: 's', turnKey: null, input: 20, output: 5, cached: 0, reasoning: 0, model: 'gpt-5', effort: 'High', contextWindow: 100 },
      { tsMs: at(12, 11), sessionKey: 's', turnKey: null, input: 30, output: 5, cached: 0, reasoning: 0, model: 'gpt-5', effort: 'High', contextWindow: 100 },
    ],
    completions: [], compactions: [], tools: [],
  }, '24h', NOW);
  assert.equal(out.hasData, true);
  assert.equal(out.summary.sessions.available, true);
  assert.equal(out.summary.turns.available, false);
  assert.equal(out.mix.models.available, false);
  assert.equal(out.mix.effort.available, false);
  assert.equal(out.context.pressure.available, false);
  assert.equal(out.context.compactions.available, false);
  assert.equal(out.daily[0].turns, null);
  assert.equal(out.daily[0].averageTokensPerTurn, null);
});

test('effort mix sorts by observed turn count, not alphabetically', () => {
  const usage = [
    ['a', 'Low'], ['b', 'Medium'], ['c', 'Medium'],
    ['d', 'High'], ['e', 'High'], ['f', 'High'],
  ].map(([turnKey, effort], index) => ({
    tsMs: at(12, index), sessionKey: 's', turnKey,
    input: 1, output: 1, cached: 0, reasoning: 0,
    model: 'gpt-5', effort, contextWindow: 100,
  }));
  const out = buildCodexInsights({ usage, completions: [], compactions: [], tools: [] }, '24h', NOW);
  assert.deepEqual(out.mix.effort.items.map((item) => [item.label, item.turns]), [
    ['High', 3], ['Medium', 2], ['Low', 1],
  ]);
});

test('effort mix stays within five rows by folding the tail into Other', () => {
  const usage = ['Minimal', 'Low', 'Medium', 'High', 'X-high', 'Other'].map((effort, index) => ({
    tsMs: at(12, index), sessionKey: 's', turnKey: `t${index}`,
    input: 1, output: 1, cached: 0, reasoning: 0,
    model: 'gpt-5', effort, contextWindow: 100,
  }));
  const out = buildCodexInsights({ usage, completions: [], compactions: [], tools: [] }, '24h', NOW);
  assert.equal(out.mix.effort.items.length, 5);
  assert.equal(out.mix.effort.items.find((item) => item.label === 'Other').turns, 2);
});

test('model mix keeps five named rows plus a bounded Other tail', () => {
  const usage = Array.from({ length: 6 }, (_, index) => ({
    tsMs: at(12, index), sessionKey: 's', turnKey: `t${index}`,
    input: 6 - index, output: 1, cached: 0, reasoning: 0,
    model: `gpt-${index + 1}`, effort: 'High', contextWindow: 100,
  }));
  const out = buildCodexInsights({ usage, completions: [], compactions: [], tools: [] }, '24h', NOW);
  assert.equal(out.mix.models.items.length, 6);
  assert.deepEqual(out.mix.models.items.slice(0, 5).map((item) => item.label),
    ['gpt-1', 'gpt-2', 'gpt-3', 'gpt-4', 'gpt-5']);
  assert.equal(out.mix.models.items[5].label, 'Other');
  assert.equal(out.mix.models.items[5].turns, 1);
});

test('the aggregate contract drops raw IDs, content, paths, and tool payloads', () => {
  const secret = 'PRIVATE_AGGREGATE_SENTINEL_7f4a';
  const out = buildCodexInsights({
    capabilities: { turnBoundaries: true, toolEvents: true },
    usage: [{
      tsMs: at(12), sessionKey: `${secret}-session`, turnKey: `${secret}-turn`,
      input: 10, cached: 2, output: 4, reasoning: 1, total: 14,
      model: `/Users/alice/${secret}`, effort: secret, contextWindow: 100,
      prompt: secret, cwd: `/tmp/${secret}`,
    }],
    completions: [],
    compactions: [{ tsMs: at(12), sessionKey: `${secret}-session`, summary: secret }],
    tools: [{
      tsMs: at(12), sessionKey: `${secret}-session`, turnKey: `${secret}-turn`,
      category: 'Shell', arguments: secret, output: secret,
    }],
    accountEmail: `${secret}@example.test`,
  }, '24h', NOW);

  const serialized = JSON.stringify(out);
  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.doesNotMatch(serialized, /sessionKey|turnKey|prompt|cwd|arguments|accountEmail/);
  assert.equal(out.mix.models.items[0].label, 'Other');
  assert.equal(out.mix.effort.items[0].label, 'Other');
  assert.deepEqual(out.mix.tools.items.map((item) => item.label), ['Shell']);
});

test('refresh scans once for all ranges; getters are pure cache reads and a failure preserves good data', () => {
  clearCodexStatsCache();
  let calls = 0;
  const scan = () => { calls++; return fixture(); };
  assert.equal(refreshCodexAnalytics(NOW, scan), true);
  assert.equal(calls, 1);
  assert.equal(getCodexInsights('24h').range, '24h');
  assert.equal(getCodexInsights('7d').summary.turns.count, 2);
  assert.equal(getCodexInsights('30d').range, '30d');
  assert.equal(computeCodexActivity().hasData, true);
  assert.equal(calls, 1, 'cache getters never rescan');
  assert.equal(refreshCodexAnalytics(NOW + 1, () => { throw new Error('boom'); }), false);
  assert.equal(getCodexInsights('7d').summary.turns.count, 2, 'last good snapshot survives');
});
