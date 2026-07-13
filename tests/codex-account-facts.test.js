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

test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
