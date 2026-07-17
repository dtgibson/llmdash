import { buildUsageLedger } from './usage-ledger.js';
import { readSubscriptions } from './subscriptions.js';
import { findRate, rateIssueReason, ratesForInput, readRateCard } from './rate-card.js';

const RANGE_DAYS = Object.freeze({ '7d': 7, '30d': 30, '90d': 90 });
const PICOS_PER_MICRO = 1_000_000n;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const formatters = new Map();

function formatter(timeZone) {
  if (!formatters.has(timeZone)) formatters.set(timeZone, new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }));
  return formatters.get(timeZone);
}

function partsAt(ms, timeZone) {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(new Date(ms))
    .filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
  return parts;
}

function dateFromParts({ year, month, day }) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function resolveAnalysisTimeZone(candidate) {
  const value = candidate || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  try { formatter(value).format(new Date(0)); return value; } catch { return 'UTC'; }
}

export function localDateAt(ms, timeZone) {
  return dateFromParts(partsAt(ms, resolveAnalysisTimeZone(timeZone)));
}

export function addCalendarDays(date, count) {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + count));
  return dateFromParts({ year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() });
}

export function localMidnightMs(date, timeZone) {
  const zone = resolveAnalysisTimeZone(timeZone);
  const [year, month, day] = date.split('-').map(Number);
  const desired = Date.UTC(year, month - 1, day, 0, 0, 0);
  let guess = desired;
  for (let attempt = 0; attempt < 6; attempt++) {
    const actual = partsAt(guess, zone);
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const next = guess + desired - represented;
    if (next === guess) return guess;
    guess = next;
  }
  return guess;
}

export function rangeDefinition(range = '30d', nowMs = Date.now(), timeZone) {
  const selected = Object.hasOwn(RANGE_DAYS, range) ? range : '30d';
  const zone = resolveAnalysisTimeZone(timeZone);
  const endDate = localDateAt(nowMs, zone);
  const startDate = addCalendarDays(endDate, -(RANGE_DAYS[selected] - 1));
  const dates = Array.from({ length: RANGE_DAYS[selected] }, (_, index) => addCalendarDays(startDate, index));
  const buckets = dates.map((date, index) => {
    const start = localMidnightMs(date, zone);
    const next = localMidnightMs(addCalendarDays(date, 1), zone);
    return { date, start, end: index === dates.length - 1 ? nowMs : next, partialDay: index === dates.length - 1 };
  });
  return { range: selected, timeZone: zone, start: buckets[0].start, end: nowMs, buckets };
}

function sortedReasons(...groups) {
  return [...new Set(groups.flat().filter((reason) => typeof reason === 'string'))].sort().slice(0, 16);
}

function safeCountAdd(a, b) { return Math.min(Number.MAX_SAFE_INTEGER, a + b); }

export function roundPicosToMicros(value) {
  if (typeof value !== 'bigint') return null;
  const sign = value < 0n ? -1n : 1n;
  const absolute = value < 0n ? -value : value;
  const micros = ((absolute + PICOS_PER_MICRO / 2n) / PICOS_PER_MICRO) * sign;
  return micros < -MAX_SAFE_BIGINT || micros > MAX_SAFE_BIGINT ? null : Number(micros);
}

function money(status, picos, reasons = []) {
  const amountMicros = picos === null ? null : roundPicosToMicros(picos);
  if (picos !== null && amountMicros === null) {
    return { status: 'unavailable', amountMicros: null, reasons: sortedReasons(reasons, ['amount_overflow']) };
  }
  return { status, amountMicros, reasons: sortedReasons(reasons) };
}

function moneyMicros(status, amountMicros, reasons = []) {
  if (amountMicros === null || !Number.isSafeInteger(amountMicros)) {
    return {
      status: 'unavailable', amountMicros: null,
      reasons: sortedReasons(reasons, status === 'unavailable' ? [] : ['amount_overflow']),
    };
  }
  return { status, amountMicros, reasons: sortedReasons(reasons) };
}

function cacheEffect(status, observedPicos, noCachePicos, observedMetric, noCacheMetric, reasons = []) {
  if (observedPicos === null || noCachePicos === null
    || observedMetric.amountMicros === null || noCacheMetric.amountMicros === null) {
    return {
      status: 'unavailable', amountMicros: null, rawSign: 0, belowResolution: false,
      reasons: sortedReasons(reasons, observedMetric.reasons, noCacheMetric.reasons),
    };
  }
  const raw = noCachePicos - observedPicos;
  const amountMicros = noCacheMetric.amountMicros - observedMetric.amountMicros;
  return {
    status,
    amountMicros,
    rawSign: raw < 0n ? -1 : raw > 0n ? 1 : 0,
    belowResolution: raw !== 0n && amountMicros === 0,
    reasons: sortedReasons(reasons),
  };
}

function cumulativeAllocation(entry, atMs, timeZone) {
  const start = localMidnightMs(entry.startDate, timeZone);
  const end = localMidnightMs(addCalendarDays(entry.endDate, 1), timeZone);
  const elapsed = BigInt(Math.max(0, Math.min(end - start, atMs - start)));
  return entry.amountPicos * elapsed / BigInt(end - start);
}

function intervalUnion(intervals) {
  const sorted = intervals.filter((row) => row.end > row.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const row of sorted) {
    const last = merged.at(-1);
    if (!last || row.start > last.end) merged.push({ ...row });
    else if (row.end > last.end) last.end = row.end;
  }
  return merged;
}

function coverageGaps(intervals, start, end, timeZone, tool) {
  const gaps = [];
  let cursor = start;
  for (const interval of intervals) {
    if (interval.start > cursor) gaps.push({ tool, startDate: localDateAt(cursor, timeZone), endDate: localDateAt(interval.start - 1, timeZone) });
    cursor = Math.max(cursor, interval.end);
  }
  if (cursor < end) gaps.push({ tool, startDate: localDateAt(cursor, timeZone), endDate: localDateAt(end - 1, timeZone) });
  return gaps;
}

function subscriptionForTool(tool, range, subscriptions) {
  const sourceReasons = subscriptions?.status === 'valid' ? [] : [subscriptions?.reason || 'subscription_missing'];
  const entries = subscriptions?.status === 'valid'
    ? subscriptions.entries.filter((entry) => entry.tool === tool) : [];
  const diagnostics = subscriptions?.status === 'valid'
    ? subscriptions.diagnostics.filter((row) => row.tool === tool || row.tool === undefined).map((row) => row.reason) : [];
  const intervals = intervalUnion(entries.map((entry) => ({
    start: Math.max(range.start, localMidnightMs(entry.startDate, range.timeZone)),
    end: Math.min(range.end, localMidnightMs(addCalendarDays(entry.endDate, 1), range.timeZone)),
  })));
  const requiredMs = Math.max(0, range.end - range.start);
  const coveredMs = intervals.reduce((total, interval) => total + interval.end - interval.start, 0);
  const gaps = coverageGaps(intervals, range.start, range.end, range.timeZone, tool);
  const totalPicos = entries.reduce((total, entry) => total
    + cumulativeAllocation(entry, range.end, range.timeZone)
    - cumulativeAllocation(entry, range.start, range.timeZone), 0n);
  const status = coveredMs === requiredMs && requiredMs > 0 ? 'complete'
    : entries.length && coveredMs > 0 ? 'partial' : 'unavailable';
  const reasons = status === 'complete' ? [] : sortedReasons(sourceReasons, diagnostics, gaps.length ? ['subscription_gap'] : []);
  const dailyPicos = [];
  const dailyStatus = [];
  for (const bucket of range.buckets) {
    const bucketDuration = Math.max(0, bucket.end - bucket.start);
    const bucketIntervals = intervalUnion(intervals.map((interval) => ({
      start: Math.max(bucket.start, interval.start), end: Math.min(bucket.end, interval.end),
    })));
    const bucketCovered = bucketIntervals.reduce((total, interval) => total + interval.end - interval.start, 0);
    dailyPicos.push(entries.reduce((total, entry) => total
      + cumulativeAllocation(entry, bucket.end, range.timeZone)
      - cumulativeAllocation(entry, bucket.start, range.timeZone), 0n));
    dailyStatus.push(bucketCovered === bucketDuration && bucketDuration > 0 ? 'complete'
      : bucketCovered > 0 ? 'partial' : 'unavailable');
  }
  return {
    totalPicos, status, reasons, dailyPicos, dailyStatus,
    coverage: {
      status, coveredMs, requiredMs,
      ratio: requiredMs > 0 ? coveredMs / requiredMs : null,
      gapCount: gaps.length,
      gaps: gaps.slice(0, 8),
    },
  };
}

function apiForTool(tool, range, ledger, card) {
  const records = ledger.records.filter((record) => record.tool === tool
    && record.tsMs >= range.start && record.tsMs < range.end);
  const scan = ledger.scanReport?.[tool] || { complete: false, denominatorKnown: false, reasons: ['source_missing'], deduplicatedRecords: 0, fallbackIdentityRecords: 0 };
  let recognizedRecords = 0;
  let comparableRecords = 0;
  let recognizedTokens = 0;
  let comparableTokens = 0;
  let observedPicos = 0n;
  let noCachePicos = 0n;
  const dailyObserved = range.buckets.map(() => 0n);
  const dailyNoCache = range.buckets.map(() => 0n);
  const reasons = new Set(scan.reasons || []);
  const usedSourceIds = new Set();
  const usedRates = new Map();
  for (const record of records) {
    const tokenCount = tool === 'claude'
      ? safeCountAdd(safeCountAdd(record.input, record.output), safeCountAdd(record.cacheWrite, record.cacheRead))
      : safeCountAdd(record.input, record.output);
    recognizedRecords = safeCountAdd(recognizedRecords, 1);
    recognizedTokens = safeCountAdd(recognizedTokens, tokenCount);
    if (tool === 'codex' && record.cacheRead > record.input) { reasons.add('token_record_invalid'); continue; }
    if (tokenCount === 0) {
      comparableRecords = safeCountAdd(comparableRecords, 1);
      continue;
    }
    const rate = findRate(card, tool, record.model, record.tsMs);
    if (!rate) { reasons.add(rateIssueReason(card, tool, record.model, record.tsMs)); continue; }
    const appliedRates = ratesForInput(rate, record.input);
    if (!appliedRates) { reasons.add('rate_invalid_entry'); continue; }
    const priced = tool === 'claude'
      ? {
          observed: BigInt(record.input) * appliedRates.input + BigInt(record.output) * appliedRates.output
            + BigInt(record.cacheWrite) * appliedRates.cacheWrite + BigInt(record.cacheRead) * appliedRates.cacheRead,
          noCache: (BigInt(record.input) + BigInt(record.cacheWrite) + BigInt(record.cacheRead)) * appliedRates.input
            + BigInt(record.output) * appliedRates.output,
        }
      : {
          observed: BigInt(record.input - record.cacheRead) * appliedRates.input
            + BigInt(record.cacheRead) * appliedRates.cacheRead + BigInt(record.output) * appliedRates.output,
          noCache: BigInt(record.input) * appliedRates.input + BigInt(record.output) * appliedRates.output,
        };
    comparableRecords = safeCountAdd(comparableRecords, 1);
    comparableTokens = safeCountAdd(comparableTokens, tokenCount);
    observedPicos += priced.observed;
    noCachePicos += priced.noCache;
    usedSourceIds.add(rate.sourceId);
    usedRates.set(`${rate.tool}\u0000${rate.model}\u0000${rate.effectiveFrom}`, {
      tool: rate.tool,
      model: rate.model,
      effectiveFrom: rate.effectiveFrom,
      effectiveTo: rate.effectiveTo,
      sourceId: rate.sourceId,
      inputTokenThresholds: rate.inputTokenTiers.map((tier) => tier.aboveInputTokens),
    });
    const index = range.buckets.findIndex((bucket) => record.tsMs >= bucket.start && record.tsMs < bucket.end);
    if (index >= 0) { dailyObserved[index] += priced.observed; dailyNoCache[index] += priced.noCache; }
  }
  let status;
  if (scan.complete && comparableRecords === recognizedRecords) status = 'complete';
  else if (comparableRecords > 0) status = 'partial';
  else status = 'unavailable';
  if (status === 'unavailable') { observedPicos = null; noCachePicos = null; }
  const finalReasons = status === 'complete' ? [] : sortedReasons([...reasons]);
  const denominatorKnown = scan.denominatorKnown === true;
  return {
    status, reasons: finalReasons, observedPicos, noCachePicos, dailyObserved, dailyNoCache,
    coverage: {
      status, denominatorKnown, recognizedRecords, comparableRecords, recognizedTokens, comparableTokens,
      recordRatio: denominatorKnown && recognizedRecords > 0 ? comparableRecords / recognizedRecords : null,
      tokenRatio: denominatorKnown && recognizedTokens > 0 ? comparableTokens / recognizedTokens : null,
      deduplicatedRecords: Number(scan.deduplicatedRecords) || 0,
      fallbackIdentityRecords: Number(scan.fallbackIdentityRecords) || 0,
      reasons: finalReasons,
    },
    usedSourceIds, usedRates,
  };
}

function toolScope(tool, range, ledger, subscriptions, card) {
  const sub = subscriptionForTool(tool, range, subscriptions);
  const api = apiForTool(tool, range, ledger, card);
  const subscription = money(sub.status, sub.status === 'unavailable' ? null : sub.totalPicos, sub.reasons);
  const observedCache = money(api.status, api.observedPicos, api.reasons);
  const noCache = money(api.status, api.noCachePicos, api.reasons);
  const effect = cacheEffect(api.status, api.observedPicos, api.noCachePicos, observedCache, noCache, api.reasons);
  let subCumulative = 0n;
  let observedCumulative = 0n;
  let noCacheCumulative = 0n;
  const daily = [];
  const cumulative = [];
  const cumulativeObservedPicos = [];
  const cumulativeNoCachePicos = [];
  const roundedDelta = (afterPicos, beforePicos) => {
    const after = roundPicosToMicros(afterPicos);
    const before = roundPicosToMicros(beforePicos);
    return after === null || before === null ? null : after - before;
  };
  range.buckets.forEach((bucket, index) => {
    const subDayStatus = sub.dailyStatus[index];
    const previousSubPicos = subCumulative;
    const previousObservedPicos = observedCumulative;
    const previousNoCachePicos = noCacheCumulative;
    subCumulative += sub.dailyPicos[index];
    if (api.status !== 'unavailable') {
      observedCumulative += api.dailyObserved[index];
      noCacheCumulative += api.dailyNoCache[index];
    }
    const subDay = moneyMicros(subDayStatus,
      subDayStatus === 'unavailable' ? null : roundedDelta(subCumulative, previousSubPicos),
      subDayStatus === 'complete' ? [] : sub.reasons);
    const observedDayPicos = api.status === 'unavailable' ? null : api.dailyObserved[index];
    const noCacheDayPicos = api.status === 'unavailable' ? null : api.dailyNoCache[index];
    const observedDay = moneyMicros(api.status, api.status === 'unavailable' ? null
      : roundedDelta(observedCumulative, previousObservedPicos), api.reasons);
    const noCacheDay = moneyMicros(api.status, api.status === 'unavailable' ? null
      : roundedDelta(noCacheCumulative, previousNoCachePicos), api.reasons);
    daily.push({
      date: bucket.date, partialDay: bucket.partialDay,
      subscription: subDay, observedCache: observedDay, noCache: noCacheDay,
      cacheEffect: cacheEffect(api.status, observedDayPicos, noCacheDayPicos, observedDay, noCacheDay, api.reasons),
    });
    const cumulativeSubscription = money(sub.status, sub.status === 'unavailable' ? null : subCumulative, sub.reasons);
    const cumulativeObserved = money(api.status, api.status === 'unavailable' ? null : observedCumulative, api.reasons);
    const cumulativeNoCache = money(api.status, api.status === 'unavailable' ? null : noCacheCumulative, api.reasons);
    cumulativeObservedPicos.push(api.status === 'unavailable' ? null : observedCumulative);
    cumulativeNoCachePicos.push(api.status === 'unavailable' ? null : noCacheCumulative);
    cumulative.push({
      at: new Date(bucket.end).toISOString(),
      subscription: cumulativeSubscription,
      observedCache: cumulativeObserved,
      noCache: cumulativeNoCache,
      cacheEffect: cacheEffect(api.status, api.status === 'unavailable' ? null : observedCumulative,
        api.status === 'unavailable' ? null : noCacheCumulative, cumulativeObserved, cumulativeNoCache, api.reasons),
    });
  });
  return {
    summary: { subscription, observedCache, noCache, cacheEffect: effect },
    usageCoverage: api.coverage,
    subscriptionCoverage: sub.coverage,
    daily,
    cumulative,
    usedSourceIds: api.usedSourceIds,
    usedRates: api.usedRates,
    _picos: {
      summaryObserved: api.observedPicos,
      summaryNoCache: api.noCachePicos,
      dailyObserved: api.status === 'unavailable' ? api.dailyObserved.map(() => null) : api.dailyObserved,
      dailyNoCache: api.status === 'unavailable' ? api.dailyNoCache.map(() => null) : api.dailyNoCache,
      cumulativeObserved: cumulativeObservedPicos,
      cumulativeNoCache: cumulativeNoCachePicos,
    },
  };
}

function combineMoney(left, right) {
  const known = [left, right].filter((metric) => metric?.amountMicros !== null);
  if (!known.length) return { status: 'unavailable', amountMicros: null, reasons: sortedReasons(left?.reasons, right?.reasons) };
  const amountMicros = known.reduce((total, metric) => total + metric.amountMicros, 0);
  if (!Number.isSafeInteger(amountMicros)) {
    return {
      status: 'unavailable', amountMicros: null,
      reasons: sortedReasons(left?.reasons, right?.reasons, ['amount_overflow']),
    };
  }
  return {
    status: left.status === 'complete' && right.status === 'complete' ? 'complete' : 'partial',
    amountMicros,
    reasons: sortedReasons(left?.reasons, right?.reasons),
  };
}

function combinedEffect(observed, noCache, reasons, rawObserved = null, rawNoCache = null) {
  if (observed.amountMicros === null || noCache.amountMicros === null) {
    return {
      status: 'unavailable', amountMicros: null, rawSign: 0, belowResolution: false,
      reasons: sortedReasons(reasons, observed.reasons, noCache.reasons),
    };
  }
  const amountMicros = noCache.amountMicros - observed.amountMicros;
  const raw = typeof rawObserved === 'bigint' && typeof rawNoCache === 'bigint' ? rawNoCache - rawObserved : null;
  return {
    status: observed.status === 'complete' && noCache.status === 'complete' ? 'complete' : 'partial',
    amountMicros,
    rawSign: raw === null ? Math.sign(amountMicros) : raw < 0n ? -1 : raw > 0n ? 1 : 0,
    belowResolution: raw !== null && raw !== 0n && amountMicros === 0,
    reasons: sortedReasons(reasons, observed.reasons, noCache.reasons),
  };
}

function sumKnownPicos(...values) {
  const known = values.filter((value) => typeof value === 'bigint');
  return known.length ? known.reduce((total, value) => total + value, 0n) : null;
}

function combineCoverage(left, right) {
  const denominatorKnown = left.denominatorKnown && right.denominatorKnown;
  const recognizedRecords = safeCountAdd(left.recognizedRecords, right.recognizedRecords);
  const comparableRecords = safeCountAdd(left.comparableRecords, right.comparableRecords);
  const recognizedTokens = safeCountAdd(left.recognizedTokens, right.recognizedTokens);
  const comparableTokens = safeCountAdd(left.comparableTokens, right.comparableTokens);
  const status = left.status === 'complete' && right.status === 'complete' ? 'complete'
    : (left.status !== 'unavailable' || right.status !== 'unavailable') ? 'partial' : 'unavailable';
  return {
    status, denominatorKnown, recognizedRecords, comparableRecords, recognizedTokens, comparableTokens,
    recordRatio: denominatorKnown && recognizedRecords > 0 ? comparableRecords / recognizedRecords : null,
    tokenRatio: denominatorKnown && recognizedTokens > 0 ? comparableTokens / recognizedTokens : null,
    deduplicatedRecords: safeCountAdd(left.deduplicatedRecords, right.deduplicatedRecords),
    fallbackIdentityRecords: safeCountAdd(left.fallbackIdentityRecords, right.fallbackIdentityRecords),
    reasons: sortedReasons(left.reasons, right.reasons),
  };
}

function combinedSubscriptionCoverage(left, right) {
  const coveredMs = safeCountAdd(left.coveredMs, right.coveredMs);
  const requiredMs = safeCountAdd(left.requiredMs, right.requiredMs);
  const status = left.status === 'complete' && right.status === 'complete' ? 'complete'
    : coveredMs > 0 ? 'partial' : 'unavailable';
  return {
    status, coveredMs, requiredMs, ratio: requiredMs > 0 ? coveredMs / requiredMs : null,
    gapCount: safeCountAdd(left.gapCount, right.gapCount), gaps: [...left.gaps, ...right.gaps].slice(0, 8),
  };
}

function combineScopes(claude, codex) {
  const combineRow = (left, right, extras = {}, rawObserved = null, rawNoCache = null) => {
    const subscription = combineMoney(left.subscription, right.subscription);
    const observedCache = combineMoney(left.observedCache, right.observedCache);
    const noCache = combineMoney(left.noCache, right.noCache);
    return {
      ...extras, subscription, observedCache, noCache,
      cacheEffect: combinedEffect(observedCache, noCache,
        sortedReasons(left.cacheEffect?.reasons, right.cacheEffect?.reasons), rawObserved, rawNoCache),
    };
  };
  const summaryObserved = sumKnownPicos(claude._picos.summaryObserved, codex._picos.summaryObserved);
  const summaryNoCache = sumKnownPicos(claude._picos.summaryNoCache, codex._picos.summaryNoCache);
  return {
    summary: combineRow(claude.summary, codex.summary, {}, summaryObserved, summaryNoCache),
    usageCoverage: combineCoverage(claude.usageCoverage, codex.usageCoverage),
    subscriptionCoverage: combinedSubscriptionCoverage(claude.subscriptionCoverage, codex.subscriptionCoverage),
    daily: claude.daily.map((row, index) => combineRow(row, codex.daily[index],
      { date: row.date, partialDay: row.partialDay },
      sumKnownPicos(claude._picos.dailyObserved[index], codex._picos.dailyObserved[index]),
      sumKnownPicos(claude._picos.dailyNoCache[index], codex._picos.dailyNoCache[index]))),
    cumulative: claude.cumulative.map((row, index) => combineRow(row, codex.cumulative[index], { at: row.at },
      sumKnownPicos(claude._picos.cumulativeObserved[index], codex._picos.cumulativeObserved[index]),
      sumKnownPicos(claude._picos.cumulativeNoCache[index], codex._picos.cumulativeNoCache[index]))),
  };
}

function pricingProvenance(card, usedIds, usedRates) {
  if (card?.status !== 'valid') return { cardAsOf: null, sources: [], effectiveRates: [] };
  return {
    cardAsOf: card.asOf,
    sources: card.sources.filter((source) => usedIds.has(source.id))
      .map(({ id, label, publishedAt }) => ({ id, label, publishedAt })).slice(0, 16),
    effectiveRates: [...usedRates.values()].sort((a, b) => a.tool.localeCompare(b.tool)
      || a.model.localeCompare(b.model) || a.effectiveFrom.localeCompare(b.effectiveFrom)).slice(0, 64),
  };
}

export function buildCostAnalysis({ nowMs = Date.now(), timeZone, ledger, subscriptions, rateCard, range = '30d' } = {}) {
  const definition = rangeDefinition(range, nowMs, timeZone);
  const claude = toolScope('claude', definition, ledger, subscriptions, rateCard);
  const codex = toolScope('codex', definition, ledger, subscriptions, rateCard);
  const combined = combineScopes(claude, codex);
  const usedIds = new Set([...claude.usedSourceIds, ...codex.usedSourceIds]);
  const usedRates = new Map([...claude.usedRates.values(), ...codex.usedRates.values()]
    .map((rate) => [`${rate.tool}\u0000${rate.model}\u0000${rate.effectiveFrom}`, rate]));
  delete claude.usedSourceIds;
  delete codex.usedSourceIds;
  delete claude.usedRates;
  delete codex.usedRates;
  delete claude._picos;
  delete codex._picos;
  const combinedRequired = definition.end - definition.start;
  const combinedCovered = Math.min(claude.subscriptionCoverage.coveredMs, codex.subscriptionCoverage.coveredMs);
  return {
    schemaVersion: 1,
    source: 'local-logs-and-owner-config',
    scope: 'local-machine',
    currency: 'USD',
    range: definition.range,
    generatedAt: new Date(nowMs).toISOString(),
    interval: {
      start: new Date(definition.start).toISOString(), end: new Date(definition.end).toISOString(),
      timeZone: definition.timeZone, partialCurrentDay: true,
    },
    refresh: { status: 'fresh', lastAttemptAt: new Date(nowMs).toISOString(), reasons: [] },
    provenance: {
      subscription: {
        ownerConfirmed: subscriptions?.status === 'valid' && subscriptions.entries.length > 0,
        coveredMs: combinedCovered, requiredMs: combinedRequired,
        gapCount: combined.subscriptionCoverage.gapCount,
      },
      pricing: pricingProvenance(rateCard, usedIds, usedRates),
    },
    scopes: { combined, claude, codex },
  };
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

function coldMetric(effect = false) {
  return effect
    ? { status: 'unavailable', amountMicros: null, rawSign: 0, belowResolution: false, reasons: ['cache_cold'] }
    : { status: 'unavailable', amountMicros: null, reasons: ['cache_cold'] };
}

function coldScope() {
  return {
    summary: { subscription: coldMetric(), observedCache: coldMetric(), noCache: coldMetric(), cacheEffect: coldMetric(true) },
    usageCoverage: {
      status: 'unavailable', denominatorKnown: false, recognizedRecords: 0, comparableRecords: 0,
      recognizedTokens: 0, comparableTokens: 0, recordRatio: null, tokenRatio: null,
      deduplicatedRecords: 0, fallbackIdentityRecords: 0, reasons: ['cache_cold'],
    },
    subscriptionCoverage: { status: 'unavailable', coveredMs: 0, requiredMs: 0, ratio: null, gapCount: 0, gaps: [] },
    daily: [], cumulative: [],
  };
}

function coldPayload(range, nowMs = Date.now(), timeZone) {
  const definition = rangeDefinition(range, nowMs, timeZone);
  return deepFreeze({
    schemaVersion: 1, source: 'local-logs-and-owner-config', scope: 'local-machine', currency: 'USD',
    range: definition.range, generatedAt: new Date(nowMs).toISOString(),
    interval: { start: new Date(definition.start).toISOString(), end: new Date(nowMs).toISOString(), timeZone: definition.timeZone, partialCurrentDay: true },
    refresh: { status: 'cold', lastAttemptAt: null, reasons: ['cache_cold'] },
    provenance: {
      subscription: { ownerConfirmed: false, coveredMs: 0, requiredMs: definition.end - definition.start, gapCount: 0 },
      pricing: { cardAsOf: null, sources: [], effectiveRates: [] },
    },
    scopes: { combined: coldScope(), claude: coldScope(), codex: coldScope() },
  });
}

let cache = new Map();

export function refreshCostAnalysis(nowMs = Date.now(), options = {}) {
  try {
    const timeZone = resolveAnalysisTimeZone(options.timeZone);
    const ledger = options.ledger || buildUsageLedger(nowMs, {
      ...options.ledgerOptions,
      sinceMs: rangeDefinition('90d', nowMs, timeZone).start,
    });
    const subscriptions = options.subscriptions || readSubscriptions(options.subscriptionOptions);
    const rateCard = options.rateCard || readRateCard(options.rateCardOptions);
    const next = new Map();
    for (const range of Object.keys(RANGE_DAYS)) next.set(range, deepFreeze(buildCostAnalysis({
      nowMs, timeZone, ledger, subscriptions, rateCard, range,
    })));
    cache = next;
    return true;
  } catch {
    const attemptedAt = new Date(nowMs).toISOString();
    if (cache.size) {
      const stale = new Map();
      for (const [range, payload] of cache) stale.set(range, deepFreeze({
        ...payload,
        refresh: { status: 'stale', lastAttemptAt: attemptedAt, reasons: ['refresh_failed'] },
      }));
      cache = stale;
    }
    return false;
  }
}

export function getCostAnalysis(range = '30d') {
  const selected = Object.hasOwn(RANGE_DAYS, range) ? range : '30d';
  return cache.get(selected) || coldPayload(selected);
}

export function clearCostAnalysisCache() { cache = new Map(); }

export const costAnalysisRanges = Object.freeze(Object.keys(RANGE_DAYS));
