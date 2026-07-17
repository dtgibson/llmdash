import fs from 'node:fs';
import { config } from '../config.js';
import { isBoundedFileError, readBoundedRegularFile } from './bounded-file.js';

const MAX_BYTES = 1024 * 1024;
const MAX_DEPTH = 10;
const MAX_SOURCES = 128;
const MAX_RATES = 4096;
const TOP_KEYS = new Set(['schemaVersion', 'currency', 'asOf', 'sources', 'rates']);
const SOURCE_KEYS = new Set(['id', 'label', 'publishedAt']);
const RATE_KEYS = new Set(['tool', 'model', 'effectiveFrom', 'effectiveTo', 'sourceId', 'usdPerMillionTokens']);
const CLAUDE_CHANNELS = new Set(['input', 'output', 'cacheWrite', 'cacheRead']);
const CODEX_CHANNELS = new Set(['input', 'output', 'cacheRead']);
const RATE_RE = /^(?:0|[1-9][0-9]{0,5})(?:\.[0-9]{1,6})?$/;
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null; }
function exactKeys(value, allowed) { return object(value) && Object.keys(value).every((key) => allowed.has(key)); }
function withinDepth(value, maxDepth = MAX_DEPTH) {
  const visit = (node, depth) => {
    if (depth > maxDepth) return false;
    if (Array.isArray(node)) return node.every((item) => visit(item, depth + 1));
    const row = object(node);
    return row ? Object.values(row).every((item) => visit(item, depth + 1)) : true;
  };
  return visit(value, 1);
}
function utcInstant(value) {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : null;
}
function wellFormedUnicode(value) {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}
function boundedText(value, max, ascii = false) {
  return typeof value === 'string' && value.length >= 1 && [...value].length <= max
    && wellFormedUnicode(value) && !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value)
    && !/[\p{Cf}\p{Zl}\p{Zp}]/u.test(value)
    && (!ascii || PRINTABLE_ASCII.test(value));
}

function fileStat(file, fsImpl) {
  return typeof fsImpl.lstatSync === 'function' ? fsImpl.lstatSync(file) : fsImpl.statSync(file);
}

export function parseRatePicosPerToken(value) {
  if (typeof value !== 'string' || !RATE_RE.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const micros = BigInt(whole) * 1_000_000n + BigInt((fraction + '000000').slice(0, 6));
  return micros <= 100_000_000_000n ? micros : null;
}

function validateSource(raw) {
  if (!exactKeys(raw, SOURCE_KEYS) || !boundedText(raw.id, 64, true)
    || !boundedText(raw.label, 96) || utcInstant(raw.publishedAt) === null) return null;
  return { id: raw.id, label: raw.label, publishedAt: raw.publishedAt };
}

function validateRate(raw, sources, index) {
  const row = object(raw);
  if (!exactKeys(row, RATE_KEYS) || (row.tool !== 'claude' && row.tool !== 'codex')
    || !boundedText(row.model, 96, true) || !sources.has(row.sourceId)) return null;
  const fromMs = utcInstant(row.effectiveFrom);
  const toMs = row.effectiveTo === null ? Infinity : utcInstant(row.effectiveTo);
  if (fromMs === null || toMs === null || fromMs >= toMs) return null;
  const allowed = row.tool === 'claude' ? CLAUDE_CHANNELS : CODEX_CHANNELS;
  if (!exactKeys(row.usdPerMillionTokens, allowed)
    || Object.keys(row.usdPerMillionTokens).length !== allowed.size) return null;
  const rates = {};
  for (const channel of allowed) {
    const parsed = parseRatePicosPerToken(row.usdPerMillionTokens[channel]);
    if (parsed === null) return null;
    rates[channel] = parsed;
  }
  return {
    tool: row.tool, model: row.model, fromMs, toMs, effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo, sourceId: row.sourceId, rates, sourceIndex: index,
  };
}

function rejectRateOverlaps(rates, diagnostics) {
  const rejected = new Set();
  const groups = new Map();
  for (const rate of rates) {
    const key = `${rate.tool}\u0000${rate.model}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(rate);
  }
  for (const rows of groups.values()) {
    rows.sort((a, b) => a.fromMs - b.fromMs || a.toMs - b.toMs || a.sourceIndex - b.sourceIndex);
    let component = [];
    let end = -Infinity;
    const flush = () => {
      if (component.length > 1) for (const row of component) {
        rejected.add(row.sourceIndex);
        diagnostics.push({ index: row.sourceIndex, reason: 'rate_overlap', tool: row.tool, model: row.model });
      }
      component = [];
      end = -Infinity;
    };
    for (const row of rows) {
      if (!component.length || row.fromMs < end) {
        component.push(row);
        if (row.toMs > end) end = row.toMs;
      } else {
        flush();
        component = [row];
        end = row.toMs;
      }
    }
    flush();
  }
  return rates.filter((rate) => !rejected.has(rate.sourceIndex));
}

export function parseRateCard(value) {
  if (!exactKeys(value, TOP_KEYS) || !withinDepth(value) || value.schemaVersion !== 1
    || value.currency !== 'USD' || utcInstant(value.asOf) === null
    || !Array.isArray(value.sources) || value.sources.length > MAX_SOURCES
    || !Array.isArray(value.rates) || value.rates.length > MAX_RATES) {
    return { status: 'invalid', reason: 'rate_card_invalid', asOf: null, sources: [], rates: [], diagnostics: [] };
  }
  const sources = [];
  const sourceMap = new Map();
  for (const raw of value.sources) {
    const source = validateSource(raw);
    if (!source || sourceMap.has(source.id)) {
      return { status: 'invalid', reason: 'rate_card_invalid', asOf: null, sources: [], rates: [], diagnostics: [] };
    }
    sources.push(source);
    sourceMap.set(source.id, source);
  }
  const rates = [];
  const diagnostics = [];
  value.rates.forEach((raw, index) => {
    const rate = validateRate(raw, sourceMap, index);
    if (rate) rates.push(rate);
    else {
      const row = object(raw);
      diagnostics.push({
        index,
        reason: 'rate_invalid_entry',
        ...(row && (row.tool === 'claude' || row.tool === 'codex') ? { tool: row.tool } : {}),
        ...(row && boundedText(row.model, 96, true) ? { model: row.model } : {}),
      });
    }
  });
  const accepted = rejectRateOverlaps(rates, diagnostics);
  return {
    status: 'valid', reason: null, asOf: value.asOf,
    sources: sources.sort((a, b) => a.id.localeCompare(b.id)), sourceMap,
    rates: accepted.sort((a, b) => a.tool.localeCompare(b.tool) || a.model.localeCompare(b.model)
      || a.fromMs - b.fromMs),
    diagnostics: diagnostics.sort((a, b) => a.index - b.index || a.reason.localeCompare(b.reason)),
  };
}

export function readRateCard({ file = config.apiRatesFile, fsImpl = fs } = {}) {
  let stat;
  try { stat = fileStat(file, fsImpl); }
  catch { return { status: 'unreadable', reason: 'rate_card_unreadable', asOf: null, sources: [], rates: [], diagnostics: [] }; }
  if (stat.isSymbolicLink?.() || !stat.isFile?.() || !Number.isFinite(stat.size)
    || stat.size < 0 || stat.size > MAX_BYTES) {
    return { status: 'invalid', reason: 'rate_card_invalid', asOf: null, sources: [], rates: [], diagnostics: [] };
  }
  let content;
  try { ({ content } = readBoundedRegularFile(file, { fsImpl, maxBytes: MAX_BYTES, expectedStat: stat })); }
  catch (error) {
    if (isBoundedFileError(error, 'BOUNDED_FILE_INVALID', 'BOUNDED_FILE_TOO_LARGE', 'BOUNDED_FILE_CHANGED')) {
      return { status: 'invalid', reason: 'rate_card_invalid', asOf: null, sources: [], rates: [], diagnostics: [] };
    }
    return { status: 'unreadable', reason: 'rate_card_unreadable', asOf: null, sources: [], rates: [], diagnostics: [] };
  }
  let parsed;
  try { parsed = JSON.parse(content); }
  catch { return { status: 'invalid', reason: 'rate_card_invalid', asOf: null, sources: [], rates: [], diagnostics: [] }; }
  return parseRateCard(parsed);
}

export function findRate(card, tool, model, atMs) {
  if (card?.status !== 'valid' || (tool !== 'claude' && tool !== 'codex')
    || typeof model !== 'string' || !Number.isFinite(atMs)) return null;
  return card.rates.find((rate) => rate.tool === tool && rate.model === model
    && atMs >= rate.fromMs && atMs < rate.toMs) || null;
}

export function rateIssueReason(card, tool, model, atMs) {
  if (card?.status !== 'valid') return card?.reason || 'rate_card_unreadable';
  const diagnostics = Array.isArray(card.diagnostics) ? card.diagnostics : [];
  const exactDiagnostic = diagnostics.find((row) => row.tool === tool && row.model === model);
  if (exactDiagnostic) return exactDiagnostic.reason;
  if (card.rates.some((rate) => rate.tool === tool && rate.model === model)) return 'rate_missing';
  return 'unknown_model';
}

export const rateCardBounds = Object.freeze({ maxBytes: MAX_BYTES, maxDepth: MAX_DEPTH, maxSources: MAX_SOURCES, maxRates: MAX_RATES });
