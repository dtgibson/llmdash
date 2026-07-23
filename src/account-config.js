import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { isMonthlyBoundary } from './billing-overlay.js';
import { parseStrictJson } from './strict-json.js';
import { atomicWriteSecureFile, readSecureRegularFile } from './secure-config-file.js';

const MAX_BYTES = 32 * 1024;
const MAX_DEPTH = 8;
// The protected file is capped at 32 KiB. 120 maximum-width canonical records
// fit beneath that cap; a larger logical count would advertise history the
// storage contract can never safely serialize.
const MAX_PLANS = 120;
const MAX_VERSION = Number.MAX_SAFE_INTEGER;
const MIN_DATE = '2000-01-01';
const MAX_DATE = '2100-12-31';
const TIME_RE = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT_RE = /^(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,2})?$/;
const TOP_KEYS = new Set(['schemaVersion', 'version', 'updatedAt', 'resetSchedule', 'recurringPlans']);
const RESET_KEYS = new Set(['isoWeekday', 'localTime', 'timeZone']);
const PLAN_KEYS = new Set([
  'tool', 'amountCents', 'effectiveStartDate', 'effectiveEndDate',
  'billingAnchorDay', 'createdInVersion', 'closedInVersion',
]);
const UPDATE_KEYS = new Set(['schemaVersion', 'baseVersion', 'resetSchedule', 'billingChanges']);
const SET_KEYS = new Set(['action', 'tool', 'amountUsd', 'effectiveDate', 'billingAnchorDay', 'confirmed']);
const CANCEL_KEYS = new Set(['action', 'tool', 'effectiveDate', 'confirmed']);

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value, allowed) {
  if (!object(value)) return false;
  const keys = Object.keys(value);
  return keys.length === allowed.size && keys.every((key) => allowed.has(key));
}
function safeVersion(value, allowZero = false) {
  return Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1) && value <= MAX_VERSION;
}
function validDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value) || value < MIN_DATE || value > MAX_DATE) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
function canonicalInstant(value) {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
function canonicalTimeZone(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') < 1
    || Buffer.byteLength(value, 'utf8') > 128 || /[\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone === value;
  } catch { return false; }
}
function schedulesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class AccountConfigError extends Error {
  constructor(code, message, fieldErrors = []) {
    super(message);
    this.name = 'AccountConfigError';
    this.code = code;
    this.fieldErrors = fieldErrors.slice(0, 16);
  }
}

function fail(path, code, message) {
  throw new AccountConfigError('validation_failed', 'Configuration validation failed', [{ path, code, message }]);
}

export function validateResetSchedule(value, path = 'resetSchedule') {
  if (value === null) return null;
  if (!exactKeys(value, RESET_KEYS)) fail(path, 'invalid_object', 'Use weekday, local time, and IANA time zone only.');
  if (!Number.isInteger(value.isoWeekday) || value.isoWeekday < 1 || value.isoWeekday > 7) {
    fail(`${path}.isoWeekday`, 'invalid_weekday', 'Choose a weekday from Monday through Sunday.');
  }
  if (typeof value.localTime !== 'string' || !TIME_RE.test(value.localTime)) {
    fail(`${path}.localTime`, 'invalid_time', 'Enter a 24-hour local time such as 23:00.');
  }
  if (!canonicalTimeZone(value.timeZone)) {
    fail(`${path}.timeZone`, 'invalid_time_zone', 'Enter a canonical IANA time zone such as America/Los_Angeles.');
  }
  return { isoWeekday: value.isoWeekday, localTime: value.localTime, timeZone: value.timeZone };
}

function validatePlan(raw, index, fileVersion) {
  const base = `recurringPlans[${index}]`;
  if (!exactKeys(raw, PLAN_KEYS)) fail(base, 'invalid_object', 'The recurring plan record has unexpected fields.');
  if (raw.tool !== 'claude' && raw.tool !== 'codex') fail(`${base}.tool`, 'invalid_tool', 'Choose Claude or Codex.');
  if (!Number.isSafeInteger(raw.amountCents) || raw.amountCents < 1 || raw.amountCents > 100_000_000) {
    fail(`${base}.amountCents`, 'invalid_amount', 'The recurring amount must be between $0.01 and $1,000,000.00.');
  }
  if (!validDate(raw.effectiveStartDate)) fail(`${base}.effectiveStartDate`, 'invalid_date', 'Enter a real start date.');
  if (raw.effectiveEndDate !== null && (!validDate(raw.effectiveEndDate)
    || raw.effectiveEndDate <= raw.effectiveStartDate)) {
    fail(`${base}.effectiveEndDate`, 'invalid_date', 'The exclusive end must be later than the start.');
  }
  if (!Number.isInteger(raw.billingAnchorDay) || raw.billingAnchorDay < 1 || raw.billingAnchorDay > 31) {
    fail(`${base}.billingAnchorDay`, 'invalid_anchor', 'The billing anchor must be a day from 1 through 31.');
  }
  if (!isMonthlyBoundary(raw.effectiveStartDate, raw.billingAnchorDay)
    || (raw.effectiveEndDate !== null && !isMonthlyBoundary(raw.effectiveEndDate, raw.billingAnchorDay))) {
    fail(base, 'invalid_boundary', 'Plan dates must fall on their clamped monthly billing boundary.');
  }
  if (!safeVersion(raw.createdInVersion) || raw.createdInVersion > fileVersion) {
    fail(`${base}.createdInVersion`, 'invalid_version', 'The plan creation version is invalid.');
  }
  if (raw.effectiveEndDate === null) {
    if (raw.closedInVersion !== null) fail(`${base}.closedInVersion`, 'invalid_version', 'An open plan cannot have a close version.');
  } else if (!safeVersion(raw.closedInVersion) || raw.closedInVersion <= raw.createdInVersion
    || raw.closedInVersion > fileVersion) {
    fail(`${base}.closedInVersion`, 'invalid_version', 'The plan close version is invalid.');
  }
  return {
    tool: raw.tool,
    amountCents: raw.amountCents,
    effectiveStartDate: raw.effectiveStartDate,
    effectiveEndDate: raw.effectiveEndDate,
    billingAnchorDay: raw.billingAnchorDay,
    createdInVersion: raw.createdInVersion,
    closedInVersion: raw.closedInVersion,
  };
}

function comparePlans(left, right) {
  return left.tool.localeCompare(right.tool)
    || left.effectiveStartDate.localeCompare(right.effectiveStartDate)
    || left.createdInVersion - right.createdInVersion;
}

function validatePlanHistory(plans) {
  const identities = new Set();
  for (const tool of ['claude', 'codex']) {
    const rows = plans.filter((plan) => plan.tool === tool);
    let prior = null;
    for (const plan of rows) {
      const identity = `${tool}\u0000${plan.createdInVersion}`;
      if (identities.has(identity)) fail('recurringPlans', 'duplicate_version', 'A tool can create only one plan record per version.');
      identities.add(identity);
      if (prior && (prior.effectiveEndDate === null || prior.effectiveEndDate > plan.effectiveStartDate)) {
        fail('recurringPlans', 'overlap', 'Recurring plan versions cannot overlap.');
      }
      if (prior && plan.createdInVersion <= prior.createdInVersion) {
        fail('recurringPlans', 'non_monotonic_version', 'Recurring plan creation versions must follow effective-date order.');
      }
      if (prior && prior.closedInVersion > plan.createdInVersion) {
        fail('recurringPlans', 'impossible_version_order', 'A later plan cannot predate the prior plan closure.');
      }
      prior = plan;
    }
  }
}

export function parseAccountConfig(value, { previous = null } = {}) {
  try {
    if (!exactKeys(value, TOP_KEYS)) fail('', 'invalid_file', 'The account configuration has unexpected fields.');
    if (value.schemaVersion !== 1) fail('schemaVersion', 'unsupported_schema', 'Only account configuration schema 1 is supported.');
    if (!safeVersion(value.version)) fail('version', 'invalid_version', 'The configuration version must be a positive safe integer.');
    if (!canonicalInstant(value.updatedAt)) fail('updatedAt', 'invalid_timestamp', 'The update time must be canonical UTC.');
    const resetSchedule = validateResetSchedule(value.resetSchedule);
    if (!Array.isArray(value.recurringPlans) || value.recurringPlans.length > MAX_PLANS) {
      fail('recurringPlans', 'invalid_array', `At most ${MAX_PLANS} recurring plan records are allowed.`);
    }
    const recurringPlans = value.recurringPlans.map((plan, index) => validatePlan(plan, index, value.version));
    const sorted = [...recurringPlans].sort(comparePlans);
    if (sorted.some((plan, index) => plan !== recurringPlans[index])) {
      fail('recurringPlans', 'invalid_order', 'Recurring plans must be sorted by tool, start date, and creation version.');
    }
    validatePlanHistory(recurringPlans);
    const parsed = { schemaVersion: 1, version: value.version, updatedAt: value.updatedAt, resetSchedule, recurringPlans };
    if (previous && !historyExtends(previous, parsed)) {
      fail('recurringPlans', 'history_rewritten', 'A newer file cannot delete or rewrite prior recurring plan history.');
    }
    return { ok: true, config: parsed, fieldErrors: [] };
  } catch (error) {
    if (error instanceof AccountConfigError) {
      return { ok: false, reason: error.code, fieldErrors: error.fieldErrors };
    }
    return { ok: false, reason: 'validation_failed', fieldErrors: [] };
  }
}

function historyExtends(previous, next) {
  const byIdentity = new Map(next.recurringPlans.map((plan) => [`${plan.tool}\u0000${plan.createdInVersion}`, plan]));
  const previousIdentities = new Set(previous.recurringPlans
    .map((plan) => `${plan.tool}\u0000${plan.createdInVersion}`));
  for (const prior of previous.recurringPlans) {
    const current = byIdentity.get(`${prior.tool}\u0000${prior.createdInVersion}`);
    if (!current) return false;
    for (const key of ['tool', 'amountCents', 'effectiveStartDate', 'billingAnchorDay', 'createdInVersion']) {
      if (current[key] !== prior[key]) return false;
    }
    if (prior.effectiveEndDate !== null) {
      if (current.effectiveEndDate !== prior.effectiveEndDate || current.closedInVersion !== prior.closedInVersion) return false;
    } else if (!((current.effectiveEndDate === null && current.closedInVersion === null)
      || (current.effectiveEndDate !== null && safeVersion(current.closedInVersion)
        && current.closedInVersion > previous.version))) return false;
  }
  for (const plan of next.recurringPlans) {
    const identity = `${plan.tool}\u0000${plan.createdInVersion}`;
    if (!previousIdentities.has(identity) && plan.createdInVersion <= previous.version) return false;
  }
  return true;
}

export function canonicalAccountConfig(value) {
  return `${JSON.stringify({
    schemaVersion: value.schemaVersion,
    version: value.version,
    updatedAt: value.updatedAt,
    resetSchedule: value.resetSchedule === null ? null : {
      isoWeekday: value.resetSchedule.isoWeekday,
      localTime: value.resetSchedule.localTime,
      timeZone: value.resetSchedule.timeZone,
    },
    recurringPlans: value.recurringPlans.map((plan) => ({
      tool: plan.tool,
      amountCents: plan.amountCents,
      effectiveStartDate: plan.effectiveStartDate,
      effectiveEndDate: plan.effectiveEndDate,
      billingAnchorDay: plan.billingAnchorDay,
      createdInVersion: plan.createdInVersion,
      closedInVersion: plan.closedInVersion,
    })),
  }, null, 2)}\n`;
}

export function accountConfigEtag(value, canonical = canonicalAccountConfig(value)) {
  const digest = createHash('sha256').update(canonical).digest('hex');
  return `"account-config-v${value.schemaVersion}-${value.version}-${digest}"`;
}

function emptyConfig() {
  return { schemaVersion: 1, version: 0, updatedAt: null, resetSchedule: null, recurringPlans: [] };
}

function freezeConfig(value) {
  if (value.resetSchedule) Object.freeze(value.resetSchedule);
  for (const plan of value.recurringPlans) Object.freeze(plan);
  Object.freeze(value.recurringPlans);
  return Object.freeze(value);
}

function snapshot(state, reason, value, canonical, file, stat = null, sourceBuffer = null) {
  const configValue = value ? freezeConfig({
    ...value,
    resetSchedule: value.resetSchedule ? { ...value.resetSchedule } : null,
    recurringPlans: value.recurringPlans.map((plan) => ({ ...plan })),
  }) : null;
  return Object.freeze({
    state,
    reason,
    config: configValue,
    canonical: canonical || null,
    etag: configValue ? accountConfigEtag(configValue, canonical || canonicalAccountConfig(configValue)) : null,
    file,
    identity: stat ? Object.freeze({
      dev: stat.dev,
      ino: stat.ino,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      ctimeMs: stat.ctimeMs,
      digest: sourceBuffer
        ? createHash('sha256').update(sourceBuffer).digest('hex')
        : (typeof stat.digest === 'string' ? stat.digest : null),
    }) : null,
  });
}

let cached = null;

export function clearAccountConfigCache() { cached = null; }

function lastValid(reason) {
  if (!cached?.config || cached.config.version === 0) return null;
  cached = snapshot('last-valid', reason, cached.config, cached.canonical, cached.file, cached.identity);
  return cached;
}

export function refreshAccountConfig({
  file = config.accountConfigFile,
  root = config.dataDir,
  fsImpl = fs,
} = {}) {
  if (cached && cached.file !== file) cached = null;
  let read;
  try {
    read = readSecureRegularFile(file, { root, maxBytes: MAX_BYTES, fsImpl });
  } catch (error) {
    if (error?.code === 'SECURE_TARGET_MISSING') {
      const retained = lastValid('account_config_missing');
      if (retained) return retained;
      const value = emptyConfig();
      cached = snapshot('empty', 'account_config_missing', value, canonicalAccountConfig(value), file);
      return cached;
    }
    const retained = lastValid(error?.code === 'SECURE_TARGET_TOO_LARGE'
      ? 'account_config_oversize' : 'account_config_unreadable');
    if (retained) return retained;
    cached = snapshot('unavailable', 'account_config_unreadable', null, null, file);
    return cached;
  }
  let value;
  try { value = parseStrictJson(read.buffer, { maxDepth: MAX_DEPTH }); }
  catch {
    const retained = lastValid('account_config_invalid');
    if (retained) return retained;
    cached = snapshot('unavailable', 'account_config_invalid', null, null, file, read.stat);
    return cached;
  }
  const checked = parseAccountConfig(value, { previous: cached?.config?.version > 0 ? cached.config : null });
  if (!checked.ok) {
    const retained = lastValid('account_config_invalid');
    if (retained) return retained;
    cached = snapshot('unavailable', 'account_config_invalid', null, null, file, read.stat);
    return cached;
  }
  const canonical = canonicalAccountConfig(checked.config);
  if (cached?.config?.version > 0) {
    if (checked.config.version < cached.config.version) return lastValid('account_config_version_regression');
    if (checked.config.version === cached.config.version && accountConfigEtag(checked.config, canonical) !== cached.etag) {
      return lastValid('account_config_version_conflict');
    }
  }
  cached = snapshot('current', null, checked.config, canonical, file, read.stat, read.buffer);
  return cached;
}

export function getAccountConfigSnapshot(options = {}) {
  return options.refresh || !cached ? refreshAccountConfig(options) : cached;
}

export function parseAmountCents(value) {
  if (typeof value !== 'string' || !AMOUNT_RE.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const cents = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
  return Number.isSafeInteger(cents) && cents >= 1 && cents <= 100_000_000 ? cents : null;
}

export function validateAccountConfigUpdate(value) {
  if (!exactKeys(value, UPDATE_KEYS)) fail('', 'invalid_object', 'Use schemaVersion, baseVersion, resetSchedule, and billingChanges only.');
  if (value.schemaVersion !== 1) fail('schemaVersion', 'unsupported_schema', 'Only schema 1 updates are supported.');
  if (!safeVersion(value.baseVersion, true)) fail('baseVersion', 'invalid_version', 'The base version is invalid.');
  const resetSchedule = validateResetSchedule(value.resetSchedule);
  if (!Array.isArray(value.billingChanges) || value.billingChanges.length > 2) {
    fail('billingChanges', 'invalid_array', 'Submit at most one billing change for each tool.');
  }
  const seen = new Set();
  const billingChanges = value.billingChanges.map((raw, index) => {
    const base = `billingChanges[${index}]`;
    if (!object(raw) || (raw.action !== 'set' && raw.action !== 'cancel')) {
      fail(`${base}.action`, 'invalid_action', 'Choose set or cancel.');
    }
    const allowed = raw.action === 'set' ? SET_KEYS : CANCEL_KEYS;
    if (!exactKeys(raw, allowed)) fail(base, 'invalid_object', 'The billing change has unexpected fields.');
    if (raw.tool !== 'claude' && raw.tool !== 'codex') fail(`${base}.tool`, 'invalid_tool', 'Choose Claude or Codex.');
    if (seen.has(raw.tool)) fail(`${base}.tool`, 'duplicate_tool', 'Submit only one change for each tool.');
    seen.add(raw.tool);
    if (!validDate(raw.effectiveDate)) fail(`${base}.effectiveDate`, 'invalid_date', 'Enter a real effective date.');
    if (raw.confirmed !== true) fail(`${base}.confirmed`, 'confirmation_required', 'Confirm this recurring billing change.');
    if (raw.action === 'cancel') return { action: 'cancel', tool: raw.tool, effectiveDate: raw.effectiveDate, confirmed: true };
    const amountCents = parseAmountCents(raw.amountUsd);
    if (amountCents === null) fail(`${base}.amountUsd`, 'invalid_amount', 'Enter $0.01–$1,000,000.00 with at most 2 decimal places.');
    if (!Number.isInteger(raw.billingAnchorDay) || raw.billingAnchorDay < 1 || raw.billingAnchorDay > 31) {
      fail(`${base}.billingAnchorDay`, 'invalid_anchor', 'Choose a billing anchor from 1 through 31.');
    }
    if (!isMonthlyBoundary(raw.effectiveDate, raw.billingAnchorDay)) {
      fail(`${base}.effectiveDate`, 'invalid_boundary', 'The effective date must match the clamped billing anchor.');
    }
    return {
      action: 'set', tool: raw.tool, amountCents, amountUsd: raw.amountUsd,
      effectiveDate: raw.effectiveDate, billingAnchorDay: raw.billingAnchorDay, confirmed: true,
    };
  });
  return { schemaVersion: 1, baseVersion: value.baseVersion, resetSchedule, billingChanges };
}

export function applyAccountConfigUpdate(current, rawUpdate, now = new Date().toISOString()) {
  const update = validateAccountConfigUpdate(rawUpdate);
  if (update.baseVersion !== current.version) {
    throw new AccountConfigError('version_conflict', 'The account configuration changed before this save.');
  }
  if (!canonicalInstant(now)) throw new TypeError('now must be a canonical UTC instant');
  if (current.version >= MAX_VERSION) throw new AccountConfigError('version_exhausted', 'The account configuration version cannot advance.');
  const nextVersion = current.version + 1;
  const plans = current.recurringPlans.map((plan) => ({ ...plan }));
  const changedFields = [];
  if (!schedulesEqual(current.resetSchedule, update.resetSchedule)) changedFields.push('resetSchedule');
  for (let index = 0; index < update.billingChanges.length; index++) {
    const change = update.billingChanges[index];
    const planIndexes = plans.map((plan, planIndex) => ({ plan, planIndex }))
      .filter(({ plan }) => plan.tool === change.tool);
    const open = planIndexes.find(({ plan }) => plan.effectiveEndDate === null) || null;
    const latest = planIndexes.at(-1) || null;
    if (change.action === 'cancel') {
      if (!open) fail(`billingChanges[${index}]`, 'no_open_plan', `There is no open ${change.tool} plan to cancel.`);
      if (change.effectiveDate <= open.plan.effectiveStartDate
        || !isMonthlyBoundary(change.effectiveDate, open.plan.billingAnchorDay)) {
        fail(`billingChanges[${index}].effectiveDate`, 'invalid_boundary', 'Cancellation must use a later billing boundary.');
      }
      plans[open.planIndex] = {
        ...open.plan, effectiveEndDate: change.effectiveDate, closedInVersion: nextVersion,
      };
    } else {
      if (open) {
        if (change.effectiveDate <= open.plan.effectiveStartDate
          || !isMonthlyBoundary(change.effectiveDate, open.plan.billingAnchorDay)) {
          fail(`billingChanges[${index}].effectiveDate`, 'invalid_boundary', 'A change must use a later boundary for the open plan.');
        }
        plans[open.planIndex] = {
          ...open.plan, effectiveEndDate: change.effectiveDate, closedInVersion: nextVersion,
        };
      } else if (latest && change.effectiveDate < latest.plan.effectiveEndDate) {
        fail(`billingChanges[${index}].effectiveDate`, 'history_overlap', 'A new plan cannot overlap closed history.');
      }
      plans.push({
        tool: change.tool,
        amountCents: change.amountCents,
        effectiveStartDate: change.effectiveDate,
        effectiveEndDate: null,
        billingAnchorDay: change.billingAnchorDay,
        createdInVersion: nextVersion,
        closedInVersion: null,
      });
    }
    changedFields.push(`recurringPlans.${change.tool}`);
  }
  if (!changedFields.length) fail('', 'no_changes', 'Make a reset or recurring billing change before saving.');
  plans.sort(comparePlans);
  const candidate = {
    schemaVersion: 1,
    version: nextVersion,
    updatedAt: now,
    resetSchedule: update.resetSchedule,
    recurringPlans: plans,
  };
  const checked = parseAccountConfig(candidate, { previous: current.version > 0 ? current : null });
  if (!checked.ok) throw new AccountConfigError('validation_failed', 'Configuration validation failed', checked.fieldErrors);
  return { config: checked.config, changedFields: [...new Set(changedFields)] };
}

export function saveAccountConfig(rawUpdate, {
  file = config.accountConfigFile,
  root = config.dataDir,
  fsImpl = fs,
  now = new Date().toISOString(),
  randomBytesImpl,
} = {}) {
  const current = refreshAccountConfig({ file, root, fsImpl });
  if (current.state !== 'current' && current.state !== 'empty') {
    throw new AccountConfigError('source_unavailable', 'The current account configuration is not safe to replace.');
  }
  const result = applyAccountConfigUpdate(current.config, rawUpdate, now);
  const canonical = canonicalAccountConfig(result.config);
  if (Buffer.byteLength(canonical, 'utf8') > MAX_BYTES) {
    throw new AccountConfigError(
      'configuration_too_large',
      'The account configuration cannot exceed its protected file limit.',
      [{
        path: 'billingChanges',
        code: 'configuration_too_large',
        message: 'Recurring plan history has reached the protected configuration file limit.',
      }],
    );
  }
  const bytes = Buffer.from(canonical, 'utf8');
  const candidateDigest = createHash('sha256').update(bytes).digest('hex');

  const publishIfCandidateLanded = () => {
    const read = readSecureRegularFile(file, { root, maxBytes: MAX_BYTES, fsImpl });
    if (!read.buffer.equals(bytes)) return false;
    cached = snapshot('current', null, result.config, canonical, file, read.stat, read.buffer);
    return true;
  };

  const reconcileChangedTarget = () => {
    const latest = refreshAccountConfig({ file, root, fsImpl });
    if (latest.state === 'current' || latest.state === 'empty') {
      throw new AccountConfigError('version_conflict', 'The account configuration changed before this save.');
    }
    throw new AccountConfigError('source_unavailable', 'The current account configuration is not safe to replace.');
  };

  let write;
  try {
    write = atomicWriteSecureFile(file, bytes, {
      root,
      fsImpl,
      randomBytesImpl,
      expectedTarget: current.identity,
    });
  } catch (error) {
    if (error?.code === 'SECURE_TARGET_CHANGED' || error?.code === 'SECURE_PARENT_CHANGED') {
      reconcileChangedTarget();
    }
    if (error?.code === 'SECURE_COMMIT_INDETERMINATE') {
      try {
        if (publishIfCandidateLanded()) {
          console.warn(JSON.stringify({ event: 'account-config-commit-reconciled', status: 'candidate-current' }));
          return { ...result, snapshot: cached };
        }
      } catch {}
      let latest = null;
      try { latest = refreshAccountConfig({ file, root, fsImpl }); } catch {}
      if (latest?.state === 'current'
        && latest.identity?.size === bytes.length
        && latest.identity?.digest === candidateDigest) {
        console.warn(JSON.stringify({ event: 'account-config-commit-reconciled', status: 'candidate-current' }));
        return { ...result, snapshot: latest };
      }
      if ((latest?.state === 'current' || latest?.state === 'empty')
        && (latest.config?.version ?? 0) > current.config.version) {
        throw new AccountConfigError('version_conflict', 'The account configuration changed before this save.');
      }
      throw new AccountConfigError('commit_indeterminate', 'The save result could not be verified.');
    }
    throw error;
  }

  // Publication is based on the descriptor-verified bytes now at the target.
  // A later external version wins the disk race and is returned as a conflict;
  // the candidate is never cached merely because rename once succeeded.
  try {
    if (!publishIfCandidateLanded()) reconcileChangedTarget();
  } catch (error) {
    if (error instanceof AccountConfigError) throw error;
    if (error?.code === 'SECURE_TARGET_CHANGED' || error?.code === 'SECURE_PARENT_CHANGED') {
      reconcileChangedTarget();
    }
    throw new AccountConfigError('commit_indeterminate', 'The save result could not be verified.');
  }
  if (write?.renameReconciled) {
    console.warn(JSON.stringify({ event: 'account-config-commit-reconciled', status: 'candidate-current' }));
  }
  if (write?.directorySynced === false) {
    console.warn(JSON.stringify({ event: 'account-config-directory-sync-failed', status: 'committed-current' }));
  }
  return { ...result, snapshot: cached };
}

export const accountConfigBounds = Object.freeze({ maxBytes: MAX_BYTES, maxDepth: MAX_DEPTH, maxPlans: MAX_PLANS });
