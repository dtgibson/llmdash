import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AccountConfigError, accountConfigBounds, accountConfigEtag, applyAccountConfigUpdate,
  canonicalAccountConfig, clearAccountConfigCache, getAccountConfigSnapshot, parseAccountConfig,
  refreshAccountConfig, saveAccountConfig,
} from '../src/account-config.js';

const schedule = Object.freeze({ isoWeekday: 5, localTime: '23:00', timeZone: 'America/Los_Angeles' });
const empty = () => ({ schemaVersion: 1, version: 0, updatedAt: null, resetSchedule: null, recurringPlans: [] });
const update = (baseVersion, overrides = {}) => ({
  schemaVersion: 1, baseVersion, resetSchedule: schedule, billingChanges: [], ...overrides,
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

function replaceFile(file, body, suffix) {
  const temporary = path.join(path.dirname(file), `.external-${suffix}.json`);
  fs.writeFileSync(temporary, body, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

test('strict account-config schema validates canonical history and rejects unknowns', () => {
  const value = {
    schemaVersion: 1,
    version: 1,
    updatedAt: '2026-07-23T18:15:30.000Z',
    resetSchedule: schedule,
    recurringPlans: [{
      tool: 'claude', amountCents: 2000, effectiveStartDate: '2026-07-01',
      effectiveEndDate: null, billingAnchorDay: 1, createdInVersion: 1,
      closedInVersion: null,
    }],
  };
  assert.equal(parseAccountConfig(value).ok, true);
  assert.equal(parseAccountConfig({ ...value, extra: true }).ok, false);
  assert.equal(parseAccountConfig({ ...value, resetSchedule: { ...schedule, timeZone: 'US/Pacific' } }).ok, false);
  assert.equal(parseAccountConfig({ ...value, recurringPlans: [{ ...value.recurringPlans[0], amountCents: 0 }] }).ok, false);
});

test('canonical bytes and strong ETags are stable and version-bound', () => {
  const first = applyAccountConfigUpdate(empty(), update(0), '2026-07-23T18:15:30.000Z').config;
  const bytes = canonicalAccountConfig(first);
  assert.equal(bytes.endsWith('\n'), true);
  assert.equal(accountConfigEtag(first, bytes), accountConfigEtag(first, bytes));
  assert.match(accountConfigEtag(first, bytes), /^"account-config-v1-1-[a-f0-9]{64}"$/);
});

test('set, effective change, and cancellation append/close without rewriting history', () => {
  const first = applyAccountConfigUpdate(empty(), update(0, {
    billingChanges: [{
      action: 'set', tool: 'claude', amountUsd: '100.00',
      effectiveDate: '2026-08-01', billingAnchorDay: 1, confirmed: true,
    }],
  }), '2026-07-23T18:15:30.000Z').config;
  assert.equal(first.version, 1);
  assert.equal(first.recurringPlans[0].amountCents, 10000);

  const second = applyAccountConfigUpdate(first, update(1, {
    billingChanges: [{
      action: 'set', tool: 'claude', amountUsd: '120',
      effectiveDate: '2026-09-01', billingAnchorDay: 1, confirmed: true,
    }],
  }), '2026-08-01T00:00:00.000Z').config;
  assert.deepEqual(second.recurringPlans.map((plan) => [
    plan.amountCents, plan.effectiveStartDate, plan.effectiveEndDate,
    plan.createdInVersion, plan.closedInVersion,
  ]), [
    [10000, '2026-08-01', '2026-09-01', 1, 2],
    [12000, '2026-09-01', null, 2, null],
  ]);

  const third = applyAccountConfigUpdate(second, update(2, {
    billingChanges: [{
      action: 'cancel', tool: 'claude', effectiveDate: '2026-10-01', confirmed: true,
    }],
  }), '2026-09-01T00:00:00.000Z').config;
  assert.equal(third.recurringPlans.length, 2);
  assert.equal(third.recurringPlans[1].effectiveEndDate, '2026-10-01');
  assert.equal(third.recurringPlans[1].closedInVersion, 3);
});

test('history validation rejects backdated closures, backfilled identities, and impossible version chronology', () => {
  const previous = {
    schemaVersion: 1,
    version: 5,
    updatedAt: '2026-07-23T18:15:30.000Z',
    resetSchedule: null,
    recurringPlans: [{
      tool: 'claude', amountCents: 10000, effectiveStartDate: '2026-01-01',
      effectiveEndDate: null, billingAnchorDay: 1, createdInVersion: 3,
      closedInVersion: null,
    }],
  };
  const backdatedClosure = {
    ...previous,
    version: 6,
    updatedAt: '2026-07-23T18:16:30.000Z',
    recurringPlans: [{
      ...previous.recurringPlans[0], effectiveEndDate: '2026-02-01', closedInVersion: 4,
    }],
  };
  assert.equal(parseAccountConfig(backdatedClosure, { previous }).ok, false);

  const closedPrevious = {
    ...previous,
    recurringPlans: [{
      ...previous.recurringPlans[0], createdInVersion: 1,
      effectiveEndDate: '2026-02-01', closedInVersion: 2,
    }],
  };
  const backfilledIdentity = {
    ...closedPrevious,
    version: 6,
    updatedAt: '2026-07-23T18:16:30.000Z',
    recurringPlans: [...closedPrevious.recurringPlans, {
      tool: 'claude', amountCents: 12000, effectiveStartDate: '2026-02-01',
      effectiveEndDate: null, billingAnchorDay: 1, createdInVersion: 3,
      closedInVersion: null,
    }],
  };
  assert.equal(parseAccountConfig(backfilledIdentity, { previous: closedPrevious }).ok, false);

  const nonMonotonic = {
    schemaVersion: 1,
    version: 10,
    updatedAt: '2026-07-23T18:16:30.000Z',
    resetSchedule: null,
    recurringPlans: [{
      tool: 'claude', amountCents: 10000, effectiveStartDate: '2026-01-01',
      effectiveEndDate: '2026-02-01', billingAnchorDay: 1, createdInVersion: 8,
      closedInVersion: 9,
    }, {
      tool: 'claude', amountCents: 12000, effectiveStartDate: '2026-02-01',
      effectiveEndDate: null, billingAnchorDay: 1, createdInVersion: 3,
      closedInVersion: null,
    }],
  };
  assert.equal(parseAccountConfig(nonMonotonic).ok, false);

  const closureAfterSuccessor = {
    schemaVersion: 1,
    version: 100,
    updatedAt: '2026-07-23T18:16:30.000Z',
    resetSchedule: null,
    recurringPlans: [{
      tool: 'claude', amountCents: 10000, effectiveStartDate: '2026-01-01',
      effectiveEndDate: '2026-02-01', billingAnchorDay: 1, createdInVersion: 1,
      closedInVersion: 100,
    }, {
      tool: 'claude', amountCents: 12000, effectiveStartDate: '2026-02-01',
      effectiveEndDate: null, billingAnchorDay: 1, createdInVersion: 2,
      closedInVersion: null,
    }],
  };
  assert.equal(parseAccountConfig(closureAfterSuccessor).ok, false);
});

test('invalid money, confirmation, stale versions, and off-boundary changes persist nothing', () => {
  for (const bad of ['0', '-1', '1.999', '1000000.01', '01.00']) {
    assert.throws(() => applyAccountConfigUpdate(empty(), update(0, {
      billingChanges: [{ action: 'set', tool: 'codex', amountUsd: bad,
        effectiveDate: '2026-08-01', billingAnchorDay: 1, confirmed: true }],
    }), '2026-07-23T18:15:30.000Z'), AccountConfigError);
  }
  assert.throws(() => applyAccountConfigUpdate(empty(), update(0, {
    billingChanges: [{ action: 'set', tool: 'codex', amountUsd: '20.00',
      effectiveDate: '2026-08-02', billingAnchorDay: 1, confirmed: true }],
  }), '2026-07-23T18:15:30.000Z'), AccountConfigError);
  assert.throws(() => applyAccountConfigUpdate(empty(), update(1),
    '2026-07-23T18:15:30.000Z'), /changed before this save/);
});

test('atomic save creates mode 0600 and invalid later edits retain last-valid data', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-account-config-'));
  fs.chmodSync(root, 0o700);
  const file = path.join(root, 'account-config.json');
  clearAccountConfigCache();
  const saved = saveAccountConfig(update(0), {
    file, root, now: '2026-07-23T18:15:30.000Z',
  });
  assert.equal(saved.config.version, 1);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(refreshAccountConfig({ file, root }).state, 'current');

  fs.writeFileSync(file, '{"schemaVersion":1,"schemaVersion":1}', { mode: 0o600 });
  const retained = refreshAccountConfig({ file, root });
  assert.equal(retained.state, 'last-valid');
  assert.equal(retained.config.version, 1);
  assert.equal(retained.reason, 'account_config_invalid');
  fs.rmSync(root, { recursive: true, force: true });
  clearAccountConfigCache();
});

function monthlyDate(offset) {
  const date = new Date(Date.UTC(2000, offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function historyWithOpenPlan(count) {
  return {
    schemaVersion: 1,
    version: count,
    updatedAt: '2026-07-23T18:15:30.000Z',
    resetSchedule: null,
    recurringPlans: Array.from({ length: count }, (_, index) => ({
      tool: 'claude',
      amountCents: 10000,
      effectiveStartDate: monthlyDate(index),
      effectiveEndDate: index + 1 === count ? null : monthlyDate(index + 1),
      billingAnchorDay: 1,
      createdInVersion: index + 1,
      closedInVersion: index + 1 === count ? null : index + 2,
    })),
  };
}

test('the plan-history bound fits the 32 KiB file cap and rejects one more record without changing disk', () => {
  const current = historyWithOpenPlan(accountConfigBounds.maxPlans);
  const change = update(current.version, {
    resetSchedule: null,
    billingChanges: [{
      action: 'set', tool: 'claude', amountUsd: '120.00',
      effectiveDate: monthlyDate(accountConfigBounds.maxPlans), billingAnchorDay: 1, confirmed: true,
    }],
  });
  assert.ok(Buffer.byteLength(canonicalAccountConfig(current)) <= accountConfigBounds.maxBytes);
  const versionBase = Number.MAX_SAFE_INTEGER - (2 * accountConfigBounds.maxPlans);
  const maximumWidth = {
    schemaVersion: 1,
    version: Number.MAX_SAFE_INTEGER,
    updatedAt: '2026-07-23T18:15:30.000Z',
    resetSchedule: {
      isoWeekday: 7,
      localTime: '23:59',
      timeZone: 'America/Los_Angeles',
    },
    recurringPlans: Array.from({ length: accountConfigBounds.maxPlans }, (_, index) => ({
      tool: 'claude',
      amountCents: 100_000_000,
      effectiveStartDate: monthlyDate(index),
      effectiveEndDate: index + 1 === accountConfigBounds.maxPlans ? null : monthlyDate(index + 1),
      billingAnchorDay: 1,
      createdInVersion: versionBase + (2 * index),
      closedInVersion: index + 1 === accountConfigBounds.maxPlans ? null : versionBase + (2 * index) + 1,
    })),
  };
  assert.equal(parseAccountConfig(maximumWidth).ok, true);
  assert.ok(Buffer.byteLength(canonicalAccountConfig(maximumWidth)) <= accountConfigBounds.maxBytes);
  assert.equal(parseAccountConfig(historyWithOpenPlan(accountConfigBounds.maxPlans + 1)).ok, false);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-account-config-cap-'));
  fs.chmodSync(root, 0o700);
  const file = path.join(root, 'account-config.json');
  const before = canonicalAccountConfig(current);
  fs.writeFileSync(file, before, { mode: 0o600 });
  clearAccountConfigCache();
  assert.throws(() => saveAccountConfig(change, {
    file, root, now: '2026-07-23T18:16:30.000Z',
  }), (error) => error instanceof AccountConfigError && error.code === 'validation_failed');
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  fs.rmSync(root, { recursive: true, force: true });
  clearAccountConfigCache();
});

test('a valid external version arriving after refresh is never overwritten', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-account-config-race-before-'));
  fs.chmodSync(root, 0o700);
  const file = path.join(root, 'account-config.json');
  clearAccountConfigCache();
  const first = saveAccountConfig(update(0), {
    file, root, now: '2026-07-23T18:15:30.000Z',
  }).config;
  const externalSchedule = { isoWeekday: 4, localTime: '22:00', timeZone: 'America/Los_Angeles' };
  const external = applyAccountConfigUpdate(first, update(1, {
    resetSchedule: externalSchedule,
  }), '2026-07-23T18:16:00.000Z').config;
  const externalBytes = canonicalAccountConfig(external);
  const canonicalRoot = fs.realpathSync(root);
  let injected = false;
  const fsImpl = proxyFs({
    openSync(candidate, flags, ...args) {
      if (!injected && candidate === canonicalRoot && (flags & fs.constants.O_DIRECTORY)) {
        replaceFile(file, externalBytes, 'before-rename');
        injected = true;
      }
      return fs.openSync(candidate, flags, ...args);
    },
  });

  assert.throws(() => saveAccountConfig(update(1, {
    resetSchedule: { isoWeekday: 3, localTime: '21:00', timeZone: 'America/Los_Angeles' },
  }), {
    file, root, fsImpl, now: '2026-07-23T18:16:30.000Z',
  }), (error) => error instanceof AccountConfigError && error.code === 'version_conflict');
  assert.equal(injected, true);
  assert.equal(fs.readFileSync(file, 'utf8'), externalBytes);
  assert.equal(refreshAccountConfig({ file, root }).config.version, 2);
  fs.rmSync(root, { recursive: true, force: true });
  clearAccountConfigCache();
});

test('a rename that lands before reporting EIO is reconciled as the exact candidate', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-account-config-rename-landed-'));
  fs.chmodSync(root, 0o700);
  const file = path.join(root, 'account-config.json');
  clearAccountConfigCache();
  try {
    saveAccountConfig(update(0), {
      file, root, now: '2026-07-23T18:15:30.000Z',
    });
    let injected = false;
    const fsImpl = proxyFs({
      renameSync(...args) {
        fs.renameSync(...args);
        injected = true;
        const error = new Error('rename reported EIO after replacement');
        error.code = 'EIO';
        throw error;
      },
    });

    const saved = saveAccountConfig(update(1, {
      resetSchedule: { isoWeekday: 4, localTime: '22:00', timeZone: 'America/Los_Angeles' },
    }), {
      file, root, fsImpl, now: '2026-07-23T18:16:30.000Z',
    });
    assert.equal(injected, true);
    assert.equal(saved.config.version, 2);
    assert.equal(saved.snapshot.state, 'current');
    assert.equal(saved.snapshot.config.resetSchedule.localTime, '22:00');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    clearAccountConfigCache();
  }
});

test('a committed target that stays unreadable during reconciliation remains indeterminate', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-account-config-indeterminate-'));
  fs.chmodSync(root, 0o700);
  const file = path.join(root, 'account-config.json');
  clearAccountConfigCache();
  try {
    saveAccountConfig(update(0), {
      file, root, now: '2026-07-23T18:15:30.000Z',
    });
    const canonicalFile = fs.realpathSync(file);
    let renamed = false;
    const fsImpl = proxyFs({
      renameSync(...args) {
        fs.renameSync(...args);
        renamed = true;
      },
      lstatSync(candidate) {
        if (renamed && candidate === canonicalFile) {
          const error = new Error('temporary target read failure');
          error.code = 'EIO';
          throw error;
        }
        return fs.lstatSync(candidate);
      },
    });

    assert.throws(() => saveAccountConfig(update(1, {
      resetSchedule: { isoWeekday: 4, localTime: '22:00', timeZone: 'America/Los_Angeles' },
    }), {
      file, root, fsImpl, now: '2026-07-23T18:16:30.000Z',
    }), (error) => error instanceof AccountConfigError && error.code === 'commit_indeterminate');
    assert.equal(renamed, true);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, 2);
    assert.equal(getAccountConfigSnapshot().state, 'last-valid');
    assert.equal(getAccountConfigSnapshot().config.version, 1);

    const recovered = refreshAccountConfig({ file, root });
    assert.equal(recovered.state, 'current');
    assert.equal(recovered.config.version, 2);
    assert.equal(recovered.config.resetSchedule.localTime, '22:00');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    clearAccountConfigCache();
  }
});

test('a later external version before publication is cached instead of the superseded candidate', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-account-config-race-after-'));
  fs.chmodSync(root, 0o700);
  const file = path.join(root, 'account-config.json');
  clearAccountConfigCache();
  const first = saveAccountConfig(update(0), {
    file, root, now: '2026-07-23T18:15:30.000Z',
  }).config;
  const localUpdate = update(1, {
    resetSchedule: { isoWeekday: 1, localTime: '20:00', timeZone: 'America/Los_Angeles' },
  });
  const candidate = applyAccountConfigUpdate(first, localUpdate, '2026-07-23T18:16:00.000Z').config;
  const external = applyAccountConfigUpdate(candidate, update(2, {
    resetSchedule: { isoWeekday: 2, localTime: '19:00', timeZone: 'America/Los_Angeles' },
  }), '2026-07-23T18:16:30.000Z').config;
  const externalBytes = canonicalAccountConfig(external);
  const canonicalFile = fs.realpathSync(file);
  let targetOpens = 0;
  let injected = false;
  const fsImpl = proxyFs({
    openSync(candidatePath, flags, ...args) {
      if (candidatePath === canonicalFile && (flags & fs.constants.O_ACCMODE) === fs.constants.O_RDONLY) {
        targetOpens++;
        if (targetOpens === 3) {
          replaceFile(file, externalBytes, 'before-publish');
          injected = true;
        }
      }
      return fs.openSync(candidatePath, flags, ...args);
    },
  });

  assert.throws(() => saveAccountConfig(localUpdate, {
    file, root, fsImpl, now: '2026-07-23T18:16:00.000Z',
  }), (error) => error instanceof AccountConfigError && error.code === 'version_conflict');
  assert.equal(injected, true);
  assert.equal(fs.readFileSync(file, 'utf8'), externalBytes);
  const latest = refreshAccountConfig({ file, root });
  assert.equal(latest.state, 'current');
  assert.equal(latest.config.version, 3);
  fs.rmSync(root, { recursive: true, force: true });
  clearAccountConfigCache();
});

test('a missing parent is unavailable rather than an empty v0 configuration', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-account-config-missing-parent-'));
  const root = path.join(base, 'missing');
  clearAccountConfigCache();
  const result = refreshAccountConfig({ file: path.join(root, 'account-config.json'), root });
  assert.equal(result.state, 'unavailable');
  assert.equal(result.config, null);
  assert.equal(result.reason, 'account_config_unreadable');
  fs.rmSync(base, { recursive: true, force: true });
  clearAccountConfigCache();
});
