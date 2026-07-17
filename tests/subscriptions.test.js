import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseSubscriptions, parseUsdPicos, readSubscriptions } from '../src/subscriptions.js';

const file = (subscriptions, extra = {}) => ({ schemaVersion: 1, currency: 'USD', subscriptions, ...extra });
const row = (overrides = {}) => ({
  tool: 'claude',
  amountUsd: '20.00',
  startDate: '2026-07-01',
  endDate: '2026-07-31',
  confirmed: true,
  ...overrides,
});

test('subscription money parsing is exact and closed', () => {
  assert.equal(parseUsdPicos('0.01'), 10_000_000_000n);
  assert.equal(parseUsdPicos('1000000.00'), 1_000_000_000_000_000_000n);
  for (const bad of ['-1', '01', '1e2', ' 1', '1.234', '1000000.01', 'NaN']) {
    assert.equal(parseUsdPicos(bad), null, bad);
  }
});

test('subscription validation preserves adjacent periods and rejects whole overlap components', () => {
  const result = parseSubscriptions(file([
    row({ startDate: '2026-07-01', endDate: '2026-07-10' }),
    row({ startDate: '2026-07-10', endDate: '2026-07-12', amountUsd: '2' }),
    row({ startDate: '2026-07-13', endDate: '2026-07-20', amountUsd: '8' }),
    row({ tool: 'codex', startDate: '2026-07-10', endDate: '2026-07-12' }),
  ]));
  assert.equal(result.status, 'valid');
  assert.deepEqual(result.entries.map((entry) => [entry.tool, entry.startDate, entry.endDate]), [
    ['claude', '2026-07-13', '2026-07-20'],
    ['codex', '2026-07-10', '2026-07-12'],
  ]);
  assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.reason), [
    'subscription_overlap', 'subscription_overlap',
  ]);
});

test('unconfirmed and malformed entries are inert without poisoning valid periods', () => {
  const result = parseSubscriptions(file([
    row({ confirmed: false }),
    row({ tool: 'codex', amountUsd: '0.00' }),
    row({ tool: '__proto__' }),
  ]));
  assert.equal(result.status, 'valid');
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].tool, 'codex');
  assert.equal(result.entries[0].amountPicos, 0n);
  assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.reason), [
    'subscription_unconfirmed', 'subscription_invalid_entry',
  ]);
});

test('file-level shape, dates, entry counts, and depth are bounded', () => {
  assert.equal(parseSubscriptions(file([], { extra: true })).reason, 'subscription_invalid_file');
  assert.equal(parseSubscriptions(file(Array.from({ length: 513 }, () => row()))).reason, 'subscription_invalid_file');
  assert.equal(parseSubscriptions(file([row({ startDate: '2026-02-30' })])).entries.length, 0);
  let deep = {};
  for (let index = 0; index < 9; index++) deep = { nested: deep };
  assert.equal(parseSubscriptions(deep).reason, 'subscription_invalid_file');
});

test('reader distinguishes missing, unreadable, oversized, and invalid JSON', () => {
  const missing = readSubscriptions({ file: '/x', fsImpl: { statSync() { const error = new Error(); error.code = 'ENOENT'; throw error; } } });
  assert.equal(missing.reason, 'subscription_missing');

  const unreadable = readSubscriptions({ file: '/x', fsImpl: {
    statSync() { return { size: 3, isFile: () => true }; },
    readFileSync() { throw new Error('secret path'); },
  } });
  assert.equal(unreadable.reason, 'subscription_unreadable');

  const oversized = readSubscriptions({ file: '/x', fsImpl: {
    statSync() { return { size: 300_000, isFile: () => true }; },
  } });
  assert.equal(oversized.reason, 'subscription_invalid_file');

  const invalid = readSubscriptions({ file: '/x', fsImpl: {
    statSync() { return { size: 1, isFile: () => true }; },
    readFileSync() { return '{'; },
  } });
  assert.equal(invalid.reason, 'subscription_invalid_file');
});

test('reader rejects a symlink instead of following owner configuration outside the data file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-subscription-link-'));
  const target = path.join(root, 'target.json');
  const link = path.join(root, 'subscriptions.json');
  fs.writeFileSync(target, JSON.stringify(file([row()])));
  fs.symlinkSync(target, link);
  assert.equal(readSubscriptions({ file: link }).reason, 'subscription_invalid_file');
  fs.rmSync(root, { recursive: true, force: true });
});
