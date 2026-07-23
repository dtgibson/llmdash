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

function proxyFs(overrides = {}) {
  return new Proxy(fs, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) return overrides[property];
      const value = target[property];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-subscription-reader-'));
  const target = path.join(root, 'subscriptions.json');
  try {
    assert.equal(readSubscriptions({ file: target, root }).reason, 'subscription_missing');

    fs.writeFileSync(target, '{}', { mode: 0o600 });
    const unreadableFs = proxyFs({
      openSync() { const error = new Error('denied'); error.code = 'EACCES'; throw error; },
    });
    assert.equal(readSubscriptions({ file: target, root, fsImpl: unreadableFs }).reason,
      'subscription_unreadable');

    fs.truncateSync(target, 300_000);
    assert.equal(readSubscriptions({ file: target, root }).reason, 'subscription_invalid_file');

    fs.writeFileSync(target, '{', { mode: 0o600 });
    assert.equal(readSubscriptions({ file: target, root }).reason, 'subscription_invalid_file');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
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

test('reader rejects redirected/unsafe parents and descriptor identity changes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-subscription-safe-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-subscription-outside-'));
  try {
    const target = path.join(root, 'subscriptions.json');
    fs.writeFileSync(target, JSON.stringify(file([row()])), { mode: 0o600 });

    const changedIdentity = proxyFs({
      fstatSync(descriptor) {
        const stat = fs.fstatSync(descriptor);
        return new Proxy(stat, {
          get(value, property) { return property === 'ino' ? value.ino + 1 : value[property]; },
        });
      },
    });
    assert.equal(readSubscriptions({ file: target, root, fsImpl: changedIdentity }).reason,
      'subscription_invalid_file');

    const outsideFile = path.join(outside, 'subscriptions.json');
    fs.writeFileSync(outsideFile, JSON.stringify(file([row()])), { mode: 0o600 });
    const linkedParent = path.join(root, 'redirect');
    fs.symlinkSync(outside, linkedParent);
    assert.equal(readSubscriptions({
      file: path.join(linkedParent, 'subscriptions.json'), root: linkedParent,
    }).reason, 'subscription_invalid_file');

    const rootSpellings = new Set([path.resolve(root), fs.realpathSync(root)]);
    const wrongParentOwner = proxyFs({
      lstatSync(candidate) {
        const stat = fs.lstatSync(candidate);
        if (!rootSpellings.has(path.resolve(candidate))) return stat;
        return new Proxy(stat, {
          get(value, property) { return property === 'uid' ? value.uid + 1 : value[property]; },
        });
      },
    });
    assert.equal(readSubscriptions({ file: target, root, fsImpl: wrongParentOwner }).reason,
      'subscription_invalid_file');

    fs.chmodSync(root, 0o722);
    assert.equal(readSubscriptions({ file: target, root }).reason, 'subscription_invalid_file');
  } finally {
    try { fs.chmodSync(root, 0o700); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
