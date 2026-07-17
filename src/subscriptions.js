import fs from 'node:fs';
import { config } from '../config.js';
import { isBoundedFileError, readBoundedRegularFile } from './bounded-file.js';

const MAX_BYTES = 256 * 1024;
const MAX_DEPTH = 8;
const MAX_ENTRIES = 512;
const MIN_DATE = '2000-01-01';
const MAX_DATE = '2100-12-31';
const TOP_KEYS = new Set(['schemaVersion', 'currency', 'subscriptions']);
const ENTRY_KEYS = new Set(['tool', 'amountUsd', 'startDate', 'endDate', 'confirmed']);
const AMOUNT_RE = /^(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,2})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PICOS_PER_USD = 1_000_000_000_000n;

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function withinDepth(value, maxDepth = MAX_DEPTH) {
  const visit = (node, depth) => {
    if (depth > maxDepth) return false;
    if (Array.isArray(node)) return node.every((item) => visit(item, depth + 1));
    if (plainObject(node)) return Object.values(node).every((item) => visit(item, depth + 1));
    return true;
  };
  return visit(value, 1);
}

function keysAre(object, allowed) {
  return Object.keys(object).every((key) => allowed.has(key));
}

function validDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value) || value < MIN_DATE || value > MAX_DATE) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function fileStat(file, fsImpl) {
  return typeof fsImpl.lstatSync === 'function' ? fsImpl.lstatSync(file) : fsImpl.statSync(file);
}

function dateOrdinal(value) {
  const [year, month, day] = value.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function parseUsdPicos(value) {
  if (typeof value !== 'string' || !AMOUNT_RE.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole) * PICOS_PER_USD
    + BigInt((fraction + '00').slice(0, 2)) * 10_000_000_000n;
  return amount <= 1_000_000n * PICOS_PER_USD ? amount : null;
}

function validateEntry(raw, index) {
  if (!plainObject(raw) || !keysAre(raw, ENTRY_KEYS)) {
    return { ok: false, diagnostic: { index, reason: 'subscription_invalid_entry' } };
  }
  const tool = raw.tool;
  if (tool !== 'claude' && tool !== 'codex') {
    return { ok: false, diagnostic: { index, reason: 'subscription_invalid_entry' } };
  }
  if (raw.confirmed !== true) {
    return { ok: false, diagnostic: { index, tool, reason: 'subscription_unconfirmed' } };
  }
  const amountPicos = parseUsdPicos(raw.amountUsd);
  if (amountPicos === null || !validDate(raw.startDate) || !validDate(raw.endDate)
    || raw.endDate < raw.startDate
    || dateOrdinal(raw.endDate) - dateOrdinal(raw.startDate) + 1 > 3660) {
    return { ok: false, diagnostic: { index, tool, reason: 'subscription_invalid_entry' } };
  }
  return {
    ok: true,
    entry: {
      tool,
      amountPicos,
      startDate: raw.startDate,
      endDate: raw.endDate,
      confirmed: true,
      sourceIndex: index,
    },
  };
}

function rejectOverlaps(entries, diagnostics) {
  const rejected = new Set();
  for (const tool of ['claude', 'codex']) {
    const rows = entries.filter((entry) => entry.tool === tool)
      .sort((a, b) => a.startDate.localeCompare(b.startDate)
        || a.endDate.localeCompare(b.endDate) || a.sourceIndex - b.sourceIndex);
    let component = [];
    let componentEnd = '';
    const flush = () => {
      if (component.length > 1) {
        for (const entry of component) {
          rejected.add(entry.sourceIndex);
          diagnostics.push({
            index: entry.sourceIndex,
            tool,
            reason: 'subscription_overlap',
            startDate: entry.startDate,
            endDate: entry.endDate,
          });
        }
      }
      component = [];
      componentEnd = '';
    };
    for (const entry of rows) {
      if (!component.length || entry.startDate <= componentEnd) {
        component.push(entry);
        if (entry.endDate > componentEnd) componentEnd = entry.endDate;
      } else {
        flush();
        component = [entry];
        componentEnd = entry.endDate;
      }
    }
    flush();
  }
  return entries.filter((entry) => !rejected.has(entry.sourceIndex));
}

export function parseSubscriptions(value) {
  if (!plainObject(value) || !withinDepth(value) || !keysAre(value, TOP_KEYS)
    || value.schemaVersion !== 1 || value.currency !== 'USD'
    || !Array.isArray(value.subscriptions) || value.subscriptions.length > MAX_ENTRIES) {
    return { status: 'invalid', reason: 'subscription_invalid_file', entries: [], diagnostics: [] };
  }
  const entries = [];
  const diagnostics = [];
  value.subscriptions.forEach((raw, index) => {
    const checked = validateEntry(raw, index);
    if (checked.ok) entries.push(checked.entry);
    else diagnostics.push(checked.diagnostic);
  });
  const accepted = rejectOverlaps(entries, diagnostics);
  return {
    status: 'valid',
    reason: null,
    entries: accepted.sort((a, b) => a.tool.localeCompare(b.tool)
      || a.startDate.localeCompare(b.startDate) || a.sourceIndex - b.sourceIndex),
    diagnostics: diagnostics.sort((a, b) => a.index - b.index || a.reason.localeCompare(b.reason)),
  };
}

export function readSubscriptions({ file = config.subscriptionsFile, fsImpl = fs } = {}) {
  let stat;
  try { stat = fileStat(file, fsImpl); }
  catch (error) {
    return error?.code === 'ENOENT'
      ? { status: 'missing', reason: 'subscription_missing', entries: [], diagnostics: [] }
      : { status: 'unreadable', reason: 'subscription_unreadable', entries: [], diagnostics: [] };
  }
  if (stat.isSymbolicLink?.() || !stat.isFile?.() || !Number.isFinite(stat.size)
    || stat.size < 0 || stat.size > MAX_BYTES) {
    return { status: 'invalid', reason: 'subscription_invalid_file', entries: [], diagnostics: [] };
  }
  let content;
  try { ({ content } = readBoundedRegularFile(file, { fsImpl, maxBytes: MAX_BYTES, expectedStat: stat })); }
  catch (error) {
    if (isBoundedFileError(error, 'BOUNDED_FILE_INVALID', 'BOUNDED_FILE_TOO_LARGE', 'BOUNDED_FILE_CHANGED')) {
      return { status: 'invalid', reason: 'subscription_invalid_file', entries: [], diagnostics: [] };
    }
    return { status: 'unreadable', reason: 'subscription_unreadable', entries: [], diagnostics: [] };
  }
  let parsed;
  try { parsed = JSON.parse(content); }
  catch {
    return { status: 'invalid', reason: 'subscription_invalid_file', entries: [], diagnostics: [] };
  }
  return parseSubscriptions(parsed);
}

export const subscriptionBounds = Object.freeze({ maxBytes: MAX_BYTES, maxDepth: MAX_DEPTH, maxEntries: MAX_ENTRIES });
