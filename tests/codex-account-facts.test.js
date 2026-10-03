import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// One long-lived module instance receives several live app-server polls so the
// test exercises the real sparse-update cache. The fake command records each
// spawn, reads a JSON-RPC response from the environment, then lingers until the
// parser has consumed and killed it (or exits at once to simulate a failed
// app-server read).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-codexfacts-'));
const fake = path.join(tmp, 'codex');
const spawnLog = path.join(tmp, 'spawns.log');
fs.writeFileSync(fake, [
  '#!/bin/sh',
  `echo spawn >> '${spawnLog}'`,
  '[ -n "$LLMDASH_FAKE_CODEX_FAIL" ] && exit 1',
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
  cachedCodexLimits,
  codexAccountFacts,
  codexCredits,
  codexPlanLabel,
  codexResetCredits,
} = await import('../src/codex-limits.js');

const neverObserved = { status: 'unsupported', reason: 'never-observed', balance: null, capturedAt: null };
const spawns = () => (fs.existsSync(spawnLog) ? fs.readFileSync(spawnLog, 'utf8').split('\n').filter(Boolean).length : 0);

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
  // A fresh process has observed nothing (QA-05); the insights account object
  // carries the plan only (FR-28).
  assert.deepEqual(codexAccountFacts(), {
    scope: 'account-wide',
    plan: { available: false, label: null },
  });
  assert.deepEqual(codexCredits(), neverObserved);

  // A balance without a standing flag is not shown (FR-05, QA-06). A reset-credit
  // count cannot invent a standing either.
  await poll({ planType: 'pro', credits: { balance: '5' } }, { availableCount: 2 });
  assert.deepEqual(codexCredits(), neverObserved);

  const beforeObservation = Date.now();
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
  });
  const available = codexCredits();
  assert.deepEqual(Object.keys(available).sort(), ['balance', 'capturedAt', 'expiry', 'status']);
  assert.equal(available.status, 'available');
  assert.deepEqual(available.expiry, { status: 'not-reported' },
    'the live credits shape carries no expiry, so the block states the absence (QA-12)');
  assert.equal(available.balance, '12.5', 'control, bidi, and separator characters are stripped at ingest');
  assert.equal(available.capturedAt, new Date(Date.parse(available.capturedAt)).toISOString());
  assert.ok(Date.parse(available.capturedAt) >= beforeObservation && Date.parse(available.capturedAt) <= Date.now());

  // Null and missing fields are sparse live updates, not instructions to erase
  // values that were already recognized, and never restamp the observation (QA-07).
  await poll({
    planType: null,
    credits: { balance: null, hasCredits: null, unlimited: null },
  }, { availableCount: null });
  await poll({ planType: null });
  assert.equal(codexPlanLabel(), 'ChatGPT Pro');
  assert.deepEqual(codexCredits(), available);

  // Explicit standing precedence (FR-04, QA-04): unlimited wins over hasCredits.
  const longBalance = 'x'.repeat(70);
  await poll({
    credits: { balance: longBalance, hasCredits: false, unlimited: true },
  }, { availableCount: 2_000_000 });
  let credits = codexCredits();
  assert.equal(credits.status, 'unlimited');
  assert.equal(credits.balance, 'x'.repeat(64));
  assert.deepEqual(credits.expiry, { status: 'not-reported' });
  assert.equal(codexResetCredits().availableCount, 1_000_000);

  // Turning unlimited off exposes the next supported status in precedence;
  // an explicit unknown plan clears the stale label instead of inventing one,
  // and clears prior-account credit facts before this response re-observes them.
  await poll({
    planType: 'unknown',
    credits: { hasCredits: false, unlimited: false },
  }, { availableCount: -3 });
  assert.equal(codexPlanLabel(), 'Plan unavailable');
  assert.deepEqual(codexAccountFacts().plan, { available: false, label: null });
  credits = codexCredits();
  assert.equal(credits.status, 'none', 'hasCredits: false is an explicit none, not an absence');
  assert.equal(credits.balance, null, 'an explicit account/plan change clears prior-account facts');
  assert.deepEqual(credits.expiry, { status: 'not-reported' });

  // Wrongly typed fields are ignored (a numeric balance is never coerced), and
  // each call returns a detached object.
  await poll({ credits: { balance: 99, hasCredits: 'true', unlimited: 'true' } }, { availableCount: '7' });
  credits = codexCredits();
  assert.equal(credits.status, 'none');
  assert.equal(credits.balance, null);
  credits.balance = 'mutated';
  assert.equal(codexCredits().balance, null);

  // Sparse values are useful only for a bounded interval. A logout or
  // same-plan account switch that provides no identity signal cannot retain
  // prior facts indefinitely.
  const expiredAt = Date.now() + 24 * 60 * 60_000;
  assert.deepEqual(codexAccountFacts(expiredAt).plan, { available: false, label: null });
  assert.deepEqual(codexCredits(expiredAt), neverObserved);
  assert.equal(codexPlanLabel(expiredAt), 'Plan unavailable');

  // An unknown plan on a response that carries no credits clears the standing (QA-09).
  await poll({ planType: 'unknown' });
  assert.deepEqual(codexCredits(), neverObserved);
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

test('reset credits past the account-fact TTL are served as stale with their capture age, then cleared at the 24 h hard cap (FM-X4)', async () => {
  const second = (msFromNow) => Math.ceil((Date.now() + msFromNow) / 1000);
  const expiry = second(48 * 60 * 60_000);
  await poll({ planType: 'pro' }, {
    availableCount: 2,
    credits: [
      { resetType: 'codexRateLimits', status: 'available', expiresAt: expiry },
      { resetType: 'codexRateLimits', status: 'available', expiresAt: expiry },
    ],
  });
  const fresh = codexResetCredits();
  assert.equal(fresh.status, 'available');
  const observedMs = Date.parse(fresh.capturedAt);

  // Five failed polls later (TTL is 5×poll = 5 min in this sandbox): stale, not unsupported.
  const stale = codexResetCredits(observedMs + 10 * 60_000);
  assert.equal(stale.available, true);
  assert.equal(stale.status, 'stale');
  assert.equal(stale.availableCount, 2);
  assert.deepEqual(stale.expirations, fresh.expirations);
  assert.equal(stale.capturedAt, fresh.capturedAt, 'the original observation time is preserved (the client shows its age)');

  // Still stale right up to the hard cap…
  assert.equal(codexResetCredits(observedMs + 24 * 60 * 60_000 - 1).status, 'stale');
  // …then cleared: no evidence that old is presented at all.
  assert.deepEqual(codexResetCredits(observedMs + 24 * 60 * 60_000), {
    available: false, status: 'unsupported', availableCount: null,
    expirations: [], missingExpirationCount: 0, capturedAt: null,
  });

  // The explicit-plan-change clearing rule is unchanged: a recognized plan
  // switch drops the evidence immediately, stale or not.
  await poll({ planType: 'plus' }, undefined);
  assert.equal(codexResetCredits().status, 'unsupported');
});

test('the credit standing ages as one block, survives the rollout fallback unchanged, and clears on a plan change (FR-07…FR-09)', async () => {
  await poll({ planType: 'pro', credits: { hasCredits: true, unlimited: false, balance: '0' } });
  const fresh = codexCredits();
  assert.equal(fresh.status, 'available');
  assert.equal(fresh.balance, '0', 'an explicit zero balance is carried as the literal "0"');
  const observedMs = Date.parse(fresh.capturedAt);
  const ttlMs = 5 * 60_000; // TTL is 5×poll = 5 min in this sandbox

  // Fresh through the TTL, then stale with the last standing, balance, and the
  // original capture time; cleared at the 24 h hard cap (QA-08).
  assert.deepEqual(codexCredits(observedMs + ttlMs - 1000), fresh);
  assert.deepEqual(codexCredits(observedMs + ttlMs + 1000), {
    status: 'stale', lastStatus: 'available', balance: '0', capturedAt: fresh.capturedAt,
    expiry: { status: 'not-reported' },
  });
  assert.equal(codexCredits(observedMs + 24 * 60 * 60_000 - 1).status, 'stale');
  assert.deepEqual(codexCredits(observedMs + 24 * 60 * 60_000), neverObserved);
  assert.deepEqual(codexCredits(), fresh, 'reading past the hard cap does not mutate the cache');

  // Reading the standing is in-memory only: no spawn, poll, or file read (QA-03).
  const before = spawns();
  for (let i = 0; i < 3; i++) codexCredits();
  assert.equal(spawns(), before);

  // With the app-server failing, the rollout fallback supplies the reading but
  // never credits: its snake_cased credits object is not read (FR-09, QA-10).
  const sessions = path.join(process.env.LLMDASH_CODEX_DIR, 'sessions', '2026', '10', '01');
  fs.mkdirSync(sessions, { recursive: true });
  const rolloutAt = new Date().toISOString();
  fs.writeFileSync(path.join(sessions, 'rollout-credits.jsonl'), JSON.stringify({
    timestamp: rolloutAt,
    payload: { rate_limits: {
      primary: { used_percent: 10, window_minutes: 300, resets_at: windows.primary.resetsAt },
      plan_type: 'pro',
      credits: { has_credits: false, hasCredits: false, unlimited: true, balance: '999' },
    } },
  }) + '\n');
  process.env.LLMDASH_FAKE_CODEX_FAIL = '1';
  try { await readCodexLimits(); } finally { delete process.env.LLMDASH_FAKE_CODEX_FAIL; }
  assert.equal(cachedCodexLimits().capturedAt, rolloutAt, 'the rollout fallback supplied the reading');
  assert.deepEqual(codexCredits(), fresh, 'the fallback never restamps or rewrites the credit standing');

  // A recognized plan change clears the standing immediately (FR-08, QA-09).
  await poll({ planType: 'plus' });
  assert.deepEqual(codexCredits(), neverObserved);
});

// FR-12 / QA-13: the forward path the day Codex reports a credit-balance expiry.
// No live response carries one today; the key names mirror the provider's own
// reset-credit `expiresAt` and are driven here through the fake app-server.
test('a reported credit expiry is canonical, future-only, sparse-retained, and cleared with the standing (QA-12, QA-13)', async () => {
  const second = (msFromNow) => Math.ceil((Date.now() + msFromNow) / 1000);
  await poll({ planType: 'plus', credits: { hasCredits: true, unlimited: false, balance: '7' } });
  assert.deepEqual(codexCredits().expiry, { status: 'not-reported' });

  const soon = second(2 * 60_000);
  await poll({ credits: { hasCredits: true, expiresAt: soon } });
  const reported = codexCredits();
  assert.deepEqual(reported.expiry, { status: 'reported', expiresAt: new Date(soon * 1000).toISOString() });
  assert.deepEqual(Object.keys(reported.expiry).sort(), ['expiresAt', 'status']);
  const observedMs = Date.parse(reported.capturedAt);

  // An omitted field is a sparse update: the reported instant is retained.
  await poll({ credits: { hasCredits: true } });
  assert.deepEqual(codexCredits().expiry, reported.expiry);
  // Future-only at read time: once the instant passes it is not a current
  // expiry, and it is never relabelled or replaced by now.
  const afterExpiry = codexCredits(soon * 1000 + 1000);
  assert.equal(afterExpiry.status, 'available', 'the standing is still within its TTL');
  assert.deepEqual(afterExpiry.expiry, { status: 'not-reported' });

  // A stale block carries the sub-fact too, on the standing's clock.
  const later = second(3 * 3600_000);
  await poll({ credits: { hasCredits: true, expires_at: new Date(later * 1000).toISOString().replace('Z', '+00:00') } });
  const staleAt = Date.parse(codexCredits().capturedAt) + 5 * 60_000 + 1000;
  assert.deepEqual(codexCredits(staleAt).expiry,
    { status: 'reported', expiresAt: new Date(later * 1000).toISOString() }, 'snake_case ISO is re-normalized');
  assert.equal(codexCredits(staleAt).status, 'stale');

  // A past instant and an unreadable value both read as not reported.
  await poll({ credits: { hasCredits: true, expiresAt: second(-60_000) } });
  assert.deepEqual(codexCredits().expiry, { status: 'not-reported' });
  await poll({ credits: { hasCredits: true, expiresAt: 'soon' } });
  const unreadable = codexCredits();
  assert.deepEqual(unreadable.expiry, { status: 'not-reported' });
  assert.ok(Date.parse(unreadable.capturedAt) >= observedMs);

  // Past the hard cap the block is unsupported and carries no expiry key (QA-14).
  await poll({ credits: { hasCredits: true, expiresAt: later } });
  assert.deepEqual(codexCredits(Date.now() + 24 * 60 * 60_000), neverObserved);
  // A recognized plan change clears the reported instant with the standing.
  await poll({ planType: 'pro', credits: { hasCredits: true } });
  assert.deepEqual(codexCredits().expiry, { status: 'not-reported' });
});

test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} });
