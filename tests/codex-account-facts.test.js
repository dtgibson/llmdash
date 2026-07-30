import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// One long-lived module instance receives several live app-server polls so the
// test exercises the real sparse-update cache. The fake command reads a JSON-RPC
// response from the environment on every spawn, then lingers until the parser
// has consumed and killed it.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-codexfacts-'));
const fake = path.join(tmp, 'codex');
fs.writeFileSync(fake, [
  '#!/bin/sh',
  `printf '%s\n' "$LLMDASH_FAKE_CODEX_RESPONSE"`,
  'sleep 5',
  '',
].join('\n'));
fs.chmodSync(fake, 0o755);

process.env.LLMDASH_DATA_DIR = path.join(tmp, 'data');
process.env.LLMDASH_CODEX_DIR = path.join(tmp, 'codex-home');
process.env.LLMDASH_CODEX_CMD = fake;
process.env.LLMDASH_CODEX_TIMEOUT_MS = '4000';

const {
  readCodexLimits,
  codexAccountFacts,
  codexPlanLabel,
  codexResetCredits,
} = await import('../src/codex-limits.js');

const windows = {
  primary: { usedPercent: 42, resetsAt: 1767225600 },
  secondary: { usedPercent: 7, resetsAt: 1767830400 },
};

async function poll(rateLimits, rateLimitResetCredits) {
  process.env.LLMDASH_FAKE_CODEX_RESPONSE = JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    result: {
      rateLimits: { ...windows, ...rateLimits },
      ...(rateLimitResetCredits === undefined ? {} : { rateLimitResetCredits }),
    },
  });
  const reading = await readCodexLimits();
  assert.ok(reading, 'expected the live window response to remain readable');
  assert.equal(reading.windows.five_hour.usedPct, 42);
  assert.equal(reading.windows.seven_day.usedPct, 7);
}

test('live account facts are bounded, sparse-update safe, and use explicit status precedence', async () => {
  assert.deepEqual(codexAccountFacts(), {
    scope: 'account-wide',
    plan: { available: false, label: null },
    credits: {
      available: false,
      status: null,
      balance: null,
      resetCreditsAvailable: null,
    },
  });

  // A reset-credit count is useful on its own, but it cannot invent a status.
  await poll({ planType: 'pro' }, { availableCount: 2 });
  assert.deepEqual(codexAccountFacts().credits, {
    available: true,
    status: null,
    balance: null,
    resetCreditsAvailable: 2,
  });

  await poll({
    credits: {
      balance: ' \u0007\u202e12.5\u202c\u2028 ',
      hasCredits: true,
      unlimited: false,
    },
    // These similarly named fields are intentionally outside the supported
    // credit snapshot and must not affect the exported facts.
    individualLimit: { balance: 'ignore-me', availableCount: 999 },
  }, {
    availableCount: 2,
    credits: [{ id: 'secret', title: 'ignore-me', description: 'ignore-me' }],
  });

  assert.equal(codexPlanLabel(), 'ChatGPT Pro');
  assert.deepEqual(codexAccountFacts(), {
    scope: 'account-wide',
    plan: { available: true, label: 'ChatGPT Pro' },
    credits: {
      available: true,
      status: 'available',
      balance: '12.5',
      resetCreditsAvailable: 2,
    },
  });

  // Null and missing fields are sparse live updates, not instructions to erase
  // values that were already recognized.
  await poll({
    planType: null,
    credits: { balance: null, hasCredits: null, unlimited: null },
  }, { availableCount: null });
  assert.equal(codexPlanLabel(), 'ChatGPT Pro');
  assert.equal(codexAccountFacts().credits.status, 'available');
  assert.equal(codexAccountFacts().credits.balance, '12.5');
  assert.equal(codexAccountFacts().credits.resetCreditsAvailable, 2);

  const longBalance = 'x'.repeat(70);
  await poll({
    credits: { balance: longBalance, hasCredits: false, unlimited: true },
  }, { availableCount: 2_000_000 });
  let facts = codexAccountFacts();
  assert.equal(facts.credits.status, 'unlimited');
  assert.equal(facts.credits.balance, 'x'.repeat(64));
  assert.equal(facts.credits.resetCreditsAvailable, 1_000_000);

  // Turning unlimited off exposes the next supported status in precedence;
  // an explicit unknown plan clears the stale label instead of inventing one.
  await poll({
    planType: 'unknown',
    credits: { hasCredits: false, unlimited: false },
  }, { availableCount: -3 });
  facts = codexAccountFacts();
  assert.equal(codexPlanLabel(), 'Plan unavailable');
  assert.deepEqual(facts.plan, { available: false, label: null });
  assert.equal(facts.credits.status, 'none');
  assert.equal(facts.credits.balance, null, 'an explicit account/plan change clears prior-account facts');
  assert.equal(facts.credits.resetCreditsAvailable, null);

  // Wrongly typed fields are ignored, and each call returns a detached object.
  await poll({ credits: { balance: 99, hasCredits: 'true', unlimited: 'true' } }, { availableCount: '7' });
  facts = codexAccountFacts();
  assert.equal(facts.credits.status, 'none');
  assert.equal(facts.credits.balance, null);
  assert.equal(facts.credits.resetCreditsAvailable, null);
  facts.credits.balance = 'mutated';
  assert.equal(codexAccountFacts().credits.balance, null);

  // Sparse values are useful only for a bounded interval. A logout or
  // same-plan account switch that provides no identity signal cannot retain
  // prior facts indefinitely.
  const expired = codexAccountFacts(Date.now() + 24 * 60 * 60_000);
  assert.deepEqual(expired.plan, { available: false, label: null });
  assert.deepEqual(expired.credits, {
    available: false,
    status: null,
    balance: null,
    resetCreditsAvailable: null,
  });
  assert.equal(codexPlanLabel(Date.now() + 24 * 60 * 60_000), 'Plan unavailable');
});

test('reset-credit snapshots retain only bounded availability and expiration evidence', async () => {
  const second = (msFromNow) => Math.ceil((Date.now() + msFromNow) / 1000);
  // Keep the synthetic boundaries inside the bounded account-fact TTL. The
  // reader intentionally becomes unsupported once the whole snapshot ages
  // out, which is covered independently below.
  const firstExpiry = second(60_000);
  const sharedExpiry = second(2 * 60_000);
  await poll({ planType: 'pro' }, {
    available_count: 3,
    credits: [
      {
        id: 'must-not-escape', reset_type: 'codexRateLimits', status: 'available',
        granted_at: second(-60_000), expires_at: sharedExpiry,
        title: '<img src=x>', description: 'private provider copy',
      },
      { resetType: 'codexRateLimits', status: 'available', expiresAt: firstExpiry },
      { resetType: 'codexRateLimits', status: 'available', expiresAt: sharedExpiry },
      { resetType: 'differentEntitlement', status: 'available', expiresAt: second(3 * 60_000) },
      { resetType: 'codexRateLimits', status: 'used', expiresAt: second(3 * 60_000) },
    ],
  });

  const snapshot = codexResetCredits();
  assert.equal(snapshot.available, true);
  assert.equal(snapshot.status, 'available');
  assert.equal(snapshot.availableCount, 3);
  assert.deepEqual(snapshot.expirations, [
    new Date(firstExpiry * 1000).toISOString(),
    new Date(sharedExpiry * 1000).toISOString(),
    new Date(sharedExpiry * 1000).toISOString(),
  ], 'expiration instants sort soonest-first and preserve duplicate credits');
  assert.equal(snapshot.missingExpirationCount, 0);
  assert.deepEqual(Object.keys(snapshot).sort(), [
    'available', 'availableCount', 'capturedAt', 'expirations',
    'missingExpirationCount', 'status',
  ]);
  assert.doesNotMatch(JSON.stringify(snapshot), /must-not-escape|private provider copy|<img|granted/i,
    'identifiers and provider display strings are discarded inside the parser');

  snapshot.expirations[0] = 'mutated';
  snapshot.availableCount = 999;
  const detached = codexResetCredits();
  assert.equal(detached.availableCount, 3);
  assert.equal(detached.expirations[0], new Date(firstExpiry * 1000).toISOString());

  const atFirstBoundary = codexResetCredits(firstExpiry * 1000);
  assert.equal(atFirstBoundary.availableCount, 2);
  assert.deepEqual(atFirstBoundary.expirations, [
    new Date(sharedExpiry * 1000).toISOString(),
    new Date(sharedExpiry * 1000).toISOString(),
  ]);
  assert.equal(atFirstBoundary.status, 'available');

  const atLastBoundary = codexResetCredits(sharedExpiry * 1000);
  assert.equal(atLastBoundary.availableCount, 0);
  assert.equal(atLastBoundary.status, 'zero');
  assert.deepEqual(atLastBoundary.expirations, []);
});

test('reset-credit snapshots preserve partial, sparse, zero, capped, TTL, and account-change semantics', async () => {
  const second = (msFromNow) => Math.ceil((Date.now() + msFromNow) / 1000);
  const first = second(3 * 60 * 60_000);
  await poll({ planType: 'pro' }, {
    availableCount: 4,
    credits: [
      { resetType: 'codexRateLimits', status: 'available', expiresAt: first },
      { resetType: 'codexRateLimits', status: 'available', expiresAt: first + 60 },
      { resetType: 'codexRateLimits', status: 'available', expiresAt: 'not-a-number' },
      { resetType: 'codexRateLimits', status: 'used', expiresAt: first + 120 },
    ],
  });
  let snapshot = codexResetCredits();
  assert.equal(snapshot.status, 'partial');
  assert.equal(snapshot.availableCount, 4);
  assert.equal(snapshot.expirations.length, 2);
  assert.equal(snapshot.missingExpirationCount, 2);

  const originalCapture = snapshot.capturedAt;
  await poll({ planType: null }, undefined);
  assert.equal(codexResetCredits().capturedAt, originalCapture, 'a missing field does not restamp evidence');
  await poll({ planType: null }, null);
  assert.equal(codexResetCredits().capturedAt, originalCapture, 'a null field is a sparse update');
  await poll({ planType: null }, { availableCount: '4', credits: [] });
  assert.equal(codexResetCredits().capturedAt, originalCapture, 'malformed evidence does not erase last-good data');

  const many = Array.from({ length: 140 }, (_, index) => ({
    resetType: 'codexRateLimits', status: 'available', expiresAt: first + index,
  }));
  await poll({ planType: null }, { availableCount: 140, credits: many });
  snapshot = codexResetCredits();
  assert.equal(snapshot.expirations.length, 128);
  assert.equal(snapshot.missingExpirationCount, 12);
  assert.equal(snapshot.status, 'partial');

  await poll({ planType: null }, { availableCount: 0, credits: many });
  snapshot = codexResetCredits();
  assert.equal(snapshot.status, 'zero');
  assert.equal(snapshot.availableCount, 0);
  assert.deepEqual(snapshot.expirations, []);
  assert.equal(codexAccountFacts().credits.resetCreditsAvailable, 0,
    'the legacy account-facts count remains compatible with explicit zero');

  const expired = codexResetCredits(Date.parse(snapshot.capturedAt) + 24 * 60 * 60_000);
  assert.deepEqual(expired, {
    available: false,
    status: 'unsupported',
    availableCount: null,
    expirations: [],
    missingExpirationCount: 0,
    capturedAt: null,
  });

  await poll({ planType: 'plus' }, undefined);
  assert.equal(codexResetCredits().status, 'unsupported',
    'an explicit recognized account-plan change clears prior reset evidence');
});

test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
