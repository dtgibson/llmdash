import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addCalendarDays, buildCostAnalysis, clearCostAnalysisCache, getCostAnalysis,
  localMidnightMs, rangeDefinition, refreshCostAnalysis, roundPicosToMicros,
} from '../src/cost-analysis.js';
import { parseRateCard } from '../src/rate-card.js';
import { parseSubscriptions } from '../src/subscriptions.js';

const source = { id: 'official', label: 'Official pricing', publishedAt: '2026-01-01T00:00:00.000Z' };
function rateCard(rates) {
  return parseRateCard({
    schemaVersion: 1, currency: 'USD', asOf: '2026-01-01T00:00:00.000Z', sources: [source], rates,
  });
}
const claudeRate = (overrides = {}) => ({
  tool: 'claude', model: 'claude-test', effectiveFrom: '2000-01-01T00:00:00.000Z', effectiveTo: null,
  sourceId: 'official', usdPerMillionTokens: { input: '2', output: '10', cacheWrite: '2.5', cacheRead: '0.2' },
  ...overrides,
});
const codexRate = (overrides = {}) => ({
  tool: 'codex', model: 'gpt-test', effectiveFrom: '2000-01-01T00:00:00.000Z', effectiveTo: null,
  sourceId: 'official', usdPerMillionTokens: { input: '1.75', output: '14', cacheRead: '0.175' },
  ...overrides,
});
const scan = (overrides = {}) => ({
  complete: true, denominatorKnown: true, reasons: [], deduplicatedRecords: 0, fallbackIdentityRecords: 0,
  ...overrides,
});
const ledger = (records, reports = {}) => ({
  records,
  scanReport: { claude: scan(reports.claude), codex: scan(reports.codex) },
});
const subscriptions = (rows = []) => parseSubscriptions({ schemaVersion: 1, currency: 'USD', subscriptions: rows });
const sub = (tool, overrides = {}) => ({
  tool, amountUsd: '31.00', startDate: '2026-07-01', endDate: '2026-07-31', confirmed: true, ...overrides,
});
const NOW = Date.parse('2026-07-16T22:00:00.000Z');

test('local ranges use calendar days and preserve DST bucket lengths', () => {
  const spring = rangeDefinition('7d', Date.parse('2026-03-11T19:00:00Z'), 'America/Los_Angeles');
  assert.equal(spring.buckets.length, 7);
  assert.ok(spring.buckets.some((bucket) => bucket.end - bucket.start === 23 * 3_600_000));
  const fall = rangeDefinition('7d', Date.parse('2026-11-04T20:00:00Z'), 'America/Los_Angeles');
  assert.ok(fall.buckets.some((bucket) => bucket.end - bucket.start === 25 * 3_600_000));
  assert.equal(addCalendarDays('2026-02-28', 1), '2026-03-01');
  assert.equal(localMidnightMs('2026-07-16', 'America/Los_Angeles'), Date.parse('2026-07-16T07:00:00Z'));
});

test('Claude and Codex formulas use one exact comparison set and reconcile combined totals', () => {
  const payload = buildCostAnalysis({
    nowMs: NOW, timeZone: 'America/Los_Angeles', range: '7d',
    ledger: ledger([
      { tool: 'claude', tsMs: NOW - 1000, model: 'claude-test', input: 10, output: 4, cacheWrite: 2, cacheRead: 8 },
      { tool: 'codex', tsMs: NOW - 2000, model: 'gpt-test', input: 100, output: 10, cacheWrite: 0, cacheRead: 40 },
    ]),
    subscriptions: subscriptions([sub('claude'), sub('codex')]),
    rateCard: rateCard([claudeRate(), codexRate()]),
  });
  const claude = payload.scopes.claude.summary;
  assert.equal(claude.observedCache.amountMicros, 67);
  assert.equal(claude.noCache.amountMicros, 80);
  assert.equal(claude.cacheEffect.amountMicros, 13);
  const codex = payload.scopes.codex.summary;
  assert.equal(codex.observedCache.amountMicros, 252);
  assert.equal(codex.noCache.amountMicros, 315);
  assert.equal(codex.cacheEffect.amountMicros, 63);
  const combined = payload.scopes.combined.summary;
  assert.equal(combined.observedCache.amountMicros, 319);
  assert.equal(combined.noCache.amountMicros, 395);
  assert.equal(combined.cacheEffect.amountMicros, combined.noCache.amountMicros - combined.observedCache.amountMicros);
  assert.equal(payload.scopes.combined.cumulative.at(-1).observedCache.amountMicros, combined.observedCache.amountMicros);
  assert.equal(payload.scopes.combined.daily.reduce((sum, row) => sum + (row.observedCache.amountMicros || 0), 0), combined.observedCache.amountMicros);
  assert.deepEqual(payload.provenance.pricing.effectiveRates.map((rate) => [rate.tool, rate.model]), [
    ['claude', 'claude-test'], ['codex', 'gpt-test'],
  ]);
});

test('Codex long-context pricing applies only above the exact input threshold', () => {
  const tieredRate = codexRate({
    usdPerMillionTokens: { input: '5', output: '30', cacheRead: '0.5' },
    inputTokenTiers: [{
      aboveInputTokens: 272000,
      usdPerMillionTokens: { input: '10', output: '45', cacheRead: '1' },
    }],
  });
  const boundary = buildCostAnalysis({
    nowMs: NOW, timeZone: 'UTC', range: '7d',
    ledger: ledger([{ tool: 'codex', tsMs: NOW - 1, model: 'gpt-test', input: 272000, output: 0, cacheWrite: 0, cacheRead: 0 }]),
    subscriptions: subscriptions(), rateCard: rateCard([tieredRate]),
  });
  assert.equal(boundary.scopes.codex.summary.observedCache.amountMicros, 1_360_000);

  const long = buildCostAnalysis({
    nowMs: NOW, timeZone: 'UTC', range: '7d',
    ledger: ledger([{ tool: 'codex', tsMs: NOW - 1, model: 'gpt-test', input: 300000, output: 100, cacheWrite: 0, cacheRead: 200000 }]),
    subscriptions: subscriptions(), rateCard: rateCard([tieredRate]),
  });
  assert.equal(long.scopes.codex.summary.observedCache.amountMicros, 1_204_500);
  assert.equal(long.scopes.codex.summary.noCache.amountMicros, 3_004_500);
  assert.deepEqual(long.provenance.pricing.effectiveRates[0].inputTokenThresholds, [272000]);
});

test('zero-token records need no rate and remain comparable complete zero', () => {
  const payload = buildCostAnalysis({
    nowMs: NOW, timeZone: 'UTC', range: '7d',
    ledger: ledger([{ tool: 'claude', tsMs: NOW - 1, model: 'claude-unknown', input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }]),
    subscriptions: subscriptions(), rateCard: rateCard([]),
  });
  assert.equal(payload.scopes.claude.summary.observedCache.status, 'complete');
  assert.equal(payload.scopes.claude.summary.observedCache.amountMicros, 0);
  assert.equal(payload.scopes.claude.usageCoverage.recognizedRecords, 1);
  assert.equal(payload.scopes.claude.usageCoverage.comparableRecords, 1);
  assert.deepEqual(payload.scopes.claude.summary.observedCache.reasons, []);
});

test('missing rates exclude records from both API totals and disclose shared coverage', () => {
  const payload = buildCostAnalysis({
    nowMs: NOW, timeZone: 'UTC', range: '7d',
    ledger: ledger([
      { tool: 'claude', tsMs: NOW - 1000, model: 'claude-test', input: 1, output: 1, cacheWrite: 0, cacheRead: 0 },
      { tool: 'claude', tsMs: NOW - 2000, model: 'claude-unknown', input: 2, output: 2, cacheWrite: 0, cacheRead: 0 },
    ]),
    subscriptions: subscriptions(), rateCard: rateCard([claudeRate()]),
  });
  const scope = payload.scopes.claude;
  assert.equal(scope.summary.observedCache.status, 'partial');
  assert.equal(scope.summary.noCache.status, 'partial');
  assert.deepEqual(scope.summary.observedCache.reasons, scope.summary.noCache.reasons);
  assert.ok(scope.summary.observedCache.reasons.includes('unknown_model'));
  assert.equal(scope.usageCoverage.recognizedRecords, 2);
  assert.equal(scope.usageCoverage.comparableRecords, 1);
  assert.equal(scope.usageCoverage.recordRatio, 0.5);
});

test('empty readable sources are complete zero while missing evidence is unavailable', () => {
  const complete = buildCostAnalysis({
    nowMs: NOW, timeZone: 'UTC', range: '7d', ledger: ledger([]),
    subscriptions: subscriptions([sub('claude'), sub('codex')]), rateCard: rateCard([claudeRate(), codexRate()]),
  });
  assert.equal(complete.scopes.combined.summary.observedCache.status, 'complete');
  assert.equal(complete.scopes.combined.summary.observedCache.amountMicros, 0);

  const missing = buildCostAnalysis({
    nowMs: NOW, timeZone: 'UTC', range: '7d',
    ledger: ledger([], { claude: { complete: false, denominatorKnown: false, reasons: ['source_missing'] }, codex: { complete: false, denominatorKnown: false, reasons: ['source_missing'] } }),
    subscriptions: subscriptions(), rateCard: rateCard([claudeRate(), codexRate()]),
  });
  assert.equal(missing.scopes.combined.summary.observedCache.status, 'unavailable');
  assert.equal(missing.scopes.combined.summary.observedCache.amountMicros, null);
  assert.ok(missing.scopes.combined.summary.observedCache.reasons.includes('source_missing'));
  assert.equal(missing.scopes.combined.summary.subscription.amountMicros, null);
});

test('confirmed zero differs from missing subscription coverage and allocations reconcile', () => {
  const payload = buildCostAnalysis({
    nowMs: NOW, timeZone: 'America/Los_Angeles', range: '7d', ledger: ledger([]),
    subscriptions: subscriptions([
      sub('claude', { amountUsd: '0.00' }),
      sub('codex', { amountUsd: '31.00', startDate: '2026-07-10', endDate: '2026-07-12' }),
    ]), rateCard: rateCard([claudeRate(), codexRate()]),
  });
  assert.equal(payload.scopes.claude.summary.subscription.status, 'complete');
  assert.equal(payload.scopes.claude.summary.subscription.amountMicros, 0);
  assert.equal(payload.scopes.codex.summary.subscription.status, 'partial');
  assert.ok(payload.scopes.codex.summary.subscription.amountMicros > 0);
  assert.ok(payload.scopes.codex.summary.subscription.reasons.includes('subscription_gap'));
  assert.equal(payload.scopes.combined.summary.subscription.status, 'partial');
  assert.equal(payload.scopes.combined.daily.reduce((sum, row) => sum + (row.subscription.amountMicros || 0), 0),
    payload.scopes.combined.summary.subscription.amountMicros);
});

test('signed cache effect remains negative and sub-micro raw signs remain visible', () => {
  const negativeCard = rateCard([claudeRate({
    usdPerMillionTokens: { input: '1', output: '1', cacheWrite: '3', cacheRead: '2' },
  }), codexRate()]);
  const payload = buildCostAnalysis({
    nowMs: NOW, timeZone: 'UTC', range: '7d',
    ledger: ledger([{ tool: 'claude', tsMs: NOW - 1, model: 'claude-test', input: 0, output: 0, cacheWrite: 1, cacheRead: 1 }]),
    subscriptions: subscriptions(), rateCard: negativeCard,
  });
  assert.ok(payload.scopes.claude.summary.cacheEffect.amountMicros < 0);
  assert.equal(payload.scopes.claude.summary.cacheEffect.rawSign, -1);
  assert.equal(roundPicosToMicros(499_999n), 0);
});

test('Claude no-cache sums safe integer channels only after BigInt conversion', () => {
  const exactCard = rateCard([claudeRate({
    usdPerMillionTokens: { input: '0.000001', output: '0.000001', cacheWrite: '0.000001', cacheRead: '0.000001' },
  })]);
  const payload = buildCostAnalysis({
    nowMs: NOW, timeZone: 'UTC', range: '7d',
    ledger: ledger([{
      tool: 'claude', tsMs: NOW - 1, model: 'claude-test',
      input: 9_007_199_254_500_001, output: 0, cacheWrite: 999_999, cacheRead: 999_999,
    }]),
    subscriptions: subscriptions(), rateCard: exactCard,
  });
  const summary = payload.scopes.claude.summary;
  assert.equal(summary.observedCache.amountMicros, summary.noCache.amountMicros);
  assert.equal(summary.cacheEffect.amountMicros, 0);
  assert.equal(summary.cacheEffect.rawSign, 0);
});

test('overflow is unavailable at tool, day, and combined boundaries', () => {
  const hugeClaude = claudeRate({
    usdPerMillionTokens: { input: '100000', output: '100000', cacheWrite: '100000', cacheRead: '100000' },
  });
  const hugeCodex = codexRate({
    usdPerMillionTokens: { input: '100000', output: '100000', cacheRead: '100000' },
  });
  const payload = buildCostAnalysis({
    nowMs: NOW, timeZone: 'UTC', range: '7d',
    ledger: ledger([
      { tool: 'claude', tsMs: NOW - 1, model: 'claude-test', input: 50_000_000_000, output: 0, cacheWrite: 0, cacheRead: 0 },
      { tool: 'codex', tsMs: NOW - 2, model: 'gpt-test', input: 50_000_000_000, output: 0, cacheWrite: 0, cacheRead: 0 },
    ]),
    subscriptions: subscriptions(), rateCard: rateCard([hugeClaude, hugeCodex]),
  });
  assert.equal(payload.scopes.claude.summary.observedCache.amountMicros, 5_000_000_000_000_000);
  assert.equal(payload.scopes.combined.summary.observedCache.status, 'unavailable');
  assert.equal(payload.scopes.combined.summary.observedCache.amountMicros, null);
  assert.ok(payload.scopes.combined.summary.observedCache.reasons.includes('amount_overflow'));
  assert.ok(payload.scopes.combined.summary.noCache.reasons.includes('amount_overflow'));
  assert.ok(payload.scopes.combined.summary.cacheEffect.reasons.includes('amount_overflow'));

  const perToolOverflow = buildCostAnalysis({
    nowMs: NOW, timeZone: 'UTC', range: '7d',
    ledger: ledger([{ tool: 'claude', tsMs: NOW - 1, model: 'claude-test', input: Number.MAX_SAFE_INTEGER, output: 0, cacheWrite: 0, cacheRead: 0 }]),
    subscriptions: subscriptions(), rateCard: rateCard([hugeClaude, codexRate()]),
  });
  assert.equal(perToolOverflow.scopes.claude.daily.at(-1).observedCache.status, 'unavailable');
  assert.equal(perToolOverflow.scopes.claude.daily.at(-1).observedCache.amountMicros, null);
  assert.ok(perToolOverflow.scopes.claude.daily.at(-1).observedCache.reasons.includes('amount_overflow'));
  assert.ok(perToolOverflow.scopes.claude.summary.cacheEffect.reasons.includes('amount_overflow'));
});

test('rejected exact rates retain their bounded diagnostic category', () => {
  const overlapping = rateCard([
    claudeRate({ effectiveTo: '2026-08-01T00:00:00.000Z' }),
    claudeRate({ effectiveFrom: '2026-07-01T00:00:00.000Z' }),
  ]);
  const payload = buildCostAnalysis({
    nowMs: NOW, timeZone: 'UTC', range: '7d',
    ledger: ledger([{ tool: 'claude', tsMs: NOW - 1, model: 'claude-test', input: 1, output: 0, cacheWrite: 0, cacheRead: 0 }]),
    subscriptions: subscriptions(), rateCard: overlapping,
  });
  assert.ok(payload.scopes.claude.summary.observedCache.reasons.includes('rate_overlap'));
  assert.ok(!payload.scopes.claude.summary.observedCache.reasons.includes('unknown_model'));
});

test('poller cache is immutable, request reads are pure, and failures retain stale evidence', () => {
  clearCostAnalysisCache();
  const cold = getCostAnalysis('30d');
  assert.equal(cold.refresh.status, 'cold');
  const options = {
    timeZone: 'UTC', ledger: ledger([]), subscriptions: subscriptions([sub('claude'), sub('codex')]),
    rateCard: rateCard([claudeRate(), codexRate()]),
  };
  assert.equal(refreshCostAnalysis(NOW, options), true);
  const fresh = getCostAnalysis('30d');
  assert.equal(fresh.refresh.status, 'fresh');
  assert.equal(Object.isFrozen(fresh.scopes.combined.summary), true);
  assert.equal(getCostAnalysis('30d'), fresh);
  assert.equal(refreshCostAnalysis(NOW + 1000, { ...options, ledger: { get records() { throw new Error('raw path'); } } }), false);
  const stale = getCostAnalysis('30d');
  assert.equal(stale.generatedAt, fresh.generatedAt);
  assert.equal(stale.refresh.status, 'stale');
  assert.deepEqual(stale.refresh.reasons, ['refresh_failed']);
});
