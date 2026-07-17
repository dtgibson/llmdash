import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findRate, parseRateCard, parseRatePicosPerToken, readRateCard } from '../src/rate-card.js';

const source = { id: 'official', label: 'Official pricing', publishedAt: '2026-07-16T00:00:00.000Z' };
const rate = (overrides = {}) => ({
  tool: 'claude', model: 'claude-sonnet-5', effectiveFrom: '2026-01-01T00:00:00.000Z',
  effectiveTo: null, sourceId: 'official',
  usdPerMillionTokens: { input: '2', output: '10', cacheWrite: '2.5', cacheRead: '0.2' },
  ...overrides,
});
const card = (rates, extra = {}) => ({
  schemaVersion: 1, currency: 'USD', asOf: '2026-07-16T00:00:00.000Z',
  sources: [source], rates, ...extra,
});

test('rate parsing produces exact picodollars per token', () => {
  assert.equal(parseRatePicosPerToken('3.00'), 3_000_000n);
  assert.equal(parseRatePicosPerToken('0.175'), 175_000n);
  assert.equal(parseRatePicosPerToken('100000.000000'), 100_000_000_000n);
  for (const bad of ['-1', '01', '1e2', ' 1', '0.0000001', '100000.000001', 'Infinity']) {
    assert.equal(parseRatePicosPerToken(bad), null, bad);
  }
});

test('effective intervals match exact model IDs and boundary instants', () => {
  const parsed = parseRateCard(card([
    rate({ effectiveTo: '2026-09-01T00:00:00.000Z' }),
    rate({
      effectiveFrom: '2026-09-01T00:00:00.000Z',
      usdPerMillionTokens: { input: '3', output: '15', cacheWrite: '3.75', cacheRead: '0.3' },
    }),
  ]));
  assert.equal(parsed.status, 'valid');
  assert.equal(findRate(parsed, 'claude', 'claude-sonnet-5', Date.parse('2026-08-31T23:59:59.999Z')).rates.input, 2_000_000n);
  assert.equal(findRate(parsed, 'claude', 'claude-sonnet-5', Date.parse('2026-09-01T00:00:00.000Z')).rates.input, 3_000_000n);
  assert.equal(findRate(parsed, 'claude', 'CLAUDE-SONNET-5', Date.now()), null);
  assert.equal(findRate(parsed, 'claude', 'claude-sonnet-5-latest', Date.now()), null);
});

test('invalid and overlapping rates are inert without poisoning unrelated exact models', () => {
  const parsed = parseRateCard(card([
    rate({ effectiveTo: '2026-10-01T00:00:00.000Z' }),
    rate({ effectiveFrom: '2026-09-01T00:00:00.000Z' }),
    rate({ model: 'claude-fable-5', usdPerMillionTokens: { input: '10', output: '50', cacheWrite: '12.5', cacheRead: '1' } }),
    rate({ model: 'bad', usdPerMillionTokens: { input: '-1', output: '1', cacheWrite: '1', cacheRead: '1' } }),
  ]));
  assert.equal(parsed.status, 'valid');
  assert.deepEqual(parsed.rates.map((row) => row.model), ['claude-fable-5']);
  assert.deepEqual(parsed.diagnostics.map((row) => row.reason), ['rate_overlap', 'rate_overlap', 'rate_invalid_entry']);
});

test('Codex requires cached input and forbids Claude cache-write channel', () => {
  const good = rate({
    tool: 'codex', model: 'gpt-5.3-codex',
    usdPerMillionTokens: { input: '1.75', output: '14', cacheRead: '0.175' },
  });
  const bad = rate({
    tool: 'codex', model: 'gpt-bad',
    usdPerMillionTokens: { input: '1', output: '2', cacheWrite: '1', cacheRead: '0.1' },
  });
  const parsed = parseRateCard(card([good, bad]));
  assert.equal(parsed.rates.length, 1);
  assert.equal(parsed.rates[0].model, 'gpt-5.3-codex');
});

test('top-level/source shape and reader size/syntax are closed and bounded', () => {
  assert.equal(parseRateCard(card([], { extra: true })).reason, 'rate_card_invalid');
  assert.equal(parseRateCard(card([], { sources: [{ ...source, id: 'x', extra: true }] })).reason, 'rate_card_invalid');
  const oversized = readRateCard({ file: '/x', fsImpl: { statSync: () => ({ size: 2_000_000, isFile: () => true }) } });
  assert.equal(oversized.reason, 'rate_card_invalid');
  const invalid = readRateCard({ file: '/x', fsImpl: {
    statSync: () => ({ size: 1, isFile: () => true }), readFileSync: () => '{',
  } });
  assert.equal(invalid.reason, 'rate_card_invalid');
  assert.equal(parseRateCard(card([], { sources: [{ ...source, label: 'Official \u202e pricing' }] })).reason, 'rate_card_invalid');
  assert.equal(parseRateCard(card([], { sources: [{ ...source, label: 'Official \ud800 pricing' }] })).reason, 'rate_card_invalid');
  assert.equal(parseRateCard(card([], { sources: [{ ...source, label: 'Official\u200bpricing' }] })).reason, 'rate_card_invalid');
  assert.equal(parseRateCard(card([], { sources: [{ ...source, label: 'Official\u2028pricing' }] })).reason, 'rate_card_invalid');
});

test('tracked rate reader rejects symlinks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-rate-link-'));
  const target = path.join(root, 'target.json');
  const link = path.join(root, 'rates.json');
  fs.writeFileSync(target, JSON.stringify(card([])));
  fs.symlinkSync(target, link);
  assert.equal(readRateCard({ file: link }).reason, 'rate_card_invalid');
  fs.rmSync(root, { recursive: true, force: true });
});

test('tracked rate card validates and includes reviewed provider provenance', () => {
  const parsed = readRateCard();
  assert.equal(parsed.status, 'valid');
  assert.deepEqual(parsed.sources.map((item) => item.id), [
    'anthropic-fable-5-launch-2026-06-09',
    'anthropic-haiku-4-5-launch-2025-10-15',
    'anthropic-opus-4-8-launch-2026-05-28',
    'anthropic-sonnet-5-launch-2026-06-30',
    'openai-gpt-5-3-codex-launch-2026-02-05',
  ]);
  assert.ok(findRate(parsed, 'claude', 'claude-fable-5', Date.now()));
  assert.ok(findRate(parsed, 'codex', 'gpt-5.3-codex', Date.now()));
  assert.equal(findRate(parsed, 'claude', 'claude-fable-5', Date.parse('2026-06-08T23:59:59.999Z')), null);
  assert.equal(findRate(parsed, 'claude', 'claude-sonnet-5', Date.parse('2026-06-29T23:59:59.999Z')), null);
  assert.equal(findRate(parsed, 'codex', 'gpt-5.3-codex', Date.parse('2026-02-04T23:59:59.999Z')), null);
  assert.equal(findRate(parsed, 'codex', 'gpt-5.5-codex', Date.now()), null);
});
