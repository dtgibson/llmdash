import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBillingOverlay, expandRecurringPlans, isMonthlyBoundary, monthlyBoundary,
  overlayBillingSources,
} from '../src/billing-overlay.js';

const plan = (overrides = {}) => ({
  tool: 'claude', amountCents: 10000, effectiveStartDate: '2026-01-31',
  effectiveEndDate: null, billingAnchorDay: 31, createdInVersion: 1,
  closedInVersion: null, ...overrides,
});

test('monthly boundaries clamp without drifting after February', () => {
  assert.equal(monthlyBoundary(2026, 2, 31), '2026-02-28');
  assert.equal(monthlyBoundary(2028, 2, 31), '2028-02-29');
  assert.equal(monthlyBoundary(2026, 3, 31), '2026-03-31');
  assert.equal(isMonthlyBoundary('2026-04-30', 31), true);
  assert.equal(isMonthlyBoundary('2026-04-29', 31), false);
  const rows = expandRecurringPlans([plan()], { startDate: '2026-02-01', endDate: '2026-04-30' });
  assert.deepEqual(rows.map((row) => [row.startDate, row.endDate]), [
    ['2026-01-31', '2026-02-27'],
    ['2026-02-28', '2026-03-30'],
    ['2026-03-31', '2026-04-29'],
    ['2026-04-30', '2026-05-30'],
  ]);
});

test('an exclusive plan end stops expansion on its billing boundary', () => {
  const rows = expandRecurringPlans([plan({ effectiveEndDate: '2026-03-31', closedInVersion: 2 })], {
    startDate: '2026-01-01', endDate: '2026-05-01',
  });
  assert.deepEqual(rows.map((row) => [row.startDate, row.endDate]), [
    ['2026-01-31', '2026-02-27'], ['2026-02-28', '2026-03-30'],
  ]);
});

test('legacy fixed coverage clips recurring rows and retains the monthly allocation denominator', () => {
  const recurring = expandRecurringPlans([plan({
    effectiveStartDate: '2026-07-01', billingAnchorDay: 1,
  })], { startDate: '2026-07-01', endDate: '2026-07-31' });
  const legacy = [{
    tool: 'claude', amountPicos: 1n, startDate: '2026-07-10', endDate: '2026-07-20',
    confirmed: true, sourceIndex: 0,
  }];
  const rows = overlayBillingSources(legacy, recurring);
  assert.deepEqual(rows.map((row) => [row.source, row.startDate, row.endDate]), [
    ['configured-recurring', '2026-07-01', '2026-07-09'],
    ['legacy-fixed', '2026-07-10', '2026-07-20'],
    ['configured-recurring', '2026-07-21', '2026-07-31'],
  ]);
  for (const row of rows.filter((item) => item.source === 'configured-recurring')) {
    assert.equal(row.allocationStartDate, '2026-07-01');
    assert.equal(row.allocationEndDate, '2026-07-31');
  }
});

test('one invalid source never erases valid coverage from the other', () => {
  const result = buildBillingOverlay({
    legacy: { status: 'invalid', reason: 'subscription_invalid_file', entries: [] },
    accountConfig: { recurringPlans: [plan({ effectiveStartDate: '2026-07-01', billingAnchorDay: 1 })] },
    startDate: '2026-07-01', endDate: '2026-07-31',
  });
  assert.equal(result.status, 'valid');
  assert.equal(result.entries.length, 1);
  assert.deepEqual(result.sourceReasons, ['subscription_invalid_file']);
});

test('retained recurring data stays usable while its last-valid provenance is preserved', () => {
  const result = buildBillingOverlay({
    legacy: { status: 'missing', reason: 'subscription_missing', entries: [] },
    accountConfig: {
      recurringPlans: [plan({ effectiveStartDate: '2026-07-01', billingAnchorDay: 1 })],
    },
    accountConfigState: 'last-valid',
    accountConfigReason: 'account_config_invalid',
    startDate: '2026-07-01',
    endDate: '2026-07-31',
  });
  assert.equal(result.status, 'valid');
  assert.equal(result.entries.length, 1);
  assert.equal(result.sources.recurring, 'last-valid');
  assert.deepEqual(result.sourceReasons, [
    'account_config_invalid', 'subscription_missing',
  ]);
});
