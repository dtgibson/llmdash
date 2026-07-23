import { Buffer } from 'node:buffer';

const MAX_ZONE_BYTES = 128;
const GAP_SEARCH_MINUTES = 26 * 60;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const TIME_RE = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
const ZONE_RE = /^(?:UTC|[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)+)$/;
const SCHEDULE_KEYS = new Set(['isoWeekday', 'localTime', 'timeZone']);

export const liveResetStatuses = Object.freeze([
  'usable', 'missing', 'invalid', 'expired', 'not-current',
]);
export const configuredResetStatuses = Object.freeze([
  'usable', 'missing', 'invalid', 'unresolvable',
]);

function boundedCacheSet(cache, key, value, maxEntries) {
  if (!cache.has(key) && cache.size >= maxEntries) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, value);
  return value;
}

function localPartsKey(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function sameLocalMinute(left, right) {
  return left.year === right.year && left.month === right.month
    && left.day === right.day && left.hour === right.hour
    && left.minute === right.minute && left.second === 0;
}

/**
 * Create the cached Intl adapter used by the pure resolver. Tests may inject a
 * compatible adapter with canonicalize(), partsAt(), and possibleInstantsFor().
 */
export function createIntlTimeZoneAdapter({
  IntlImpl = Intl,
  maxCacheEntries = 64,
  tzdbVersion = process.versions.tz || null,
} = {}) {
  const formatterCache = new Map();
  const offsetCache = new Map();

  const formatterFor = (timeZone) => {
    const cached = formatterCache.get(timeZone);
    if (cached) return cached;
    const formatter = new IntlImpl.DateTimeFormat('en-US-u-ca-iso8601-nu-latn', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    return boundedCacheSet(formatterCache, timeZone, formatter, maxCacheEntries);
  };

  const canonicalize = (timeZone) => {
    try {
      return formatterFor(timeZone).resolvedOptions().timeZone;
    } catch {
      return null;
    }
  };

  const partsAt = (epochMs, timeZone) => {
    const values = {};
    for (const part of formatterFor(timeZone).formatToParts(new Date(epochMs))) {
      if (part.type === 'year' || part.type === 'month' || part.type === 'day'
        || part.type === 'hour' || part.type === 'minute' || part.type === 'second') {
        values[part.type] = Number(part.value);
      }
    }
    if (!Number.isInteger(values.year) || !Number.isInteger(values.month)
      || !Number.isInteger(values.day) || !Number.isInteger(values.hour)
      || !Number.isInteger(values.minute) || !Number.isInteger(values.second)) {
      throw new RangeError('time-zone parts unavailable');
    }
    return values;
  };

  const offsetAt = (epochMs, timeZone) => {
    const instant = Math.trunc(epochMs / 1000) * 1000;
    const parts = partsAt(instant, timeZone);
    return Date.UTC(parts.year, parts.month - 1, parts.day,
      parts.hour, parts.minute, parts.second) - instant;
  };

  const offsetsFor = (local, timeZone) => {
    const cacheKey = `${timeZone}|${localPartsKey(local)}`;
    const cached = offsetCache.get(cacheKey);
    if (cached) return cached;

    // Sampling a 60-hour UTC envelope catches both sides of even the largest
    // modern civil-time jump. The resulting offsets are reused for every
    // minute examined while resolving a DST gap on this local date.
    const center = Date.UTC(local.year, local.month - 1, local.day, 12);
    const offsets = new Set();
    for (let delta = -30 * HOUR_MS; delta <= 30 * HOUR_MS; delta += 30 * MINUTE_MS) {
      offsets.add(offsetAt(center + delta, timeZone));
    }
    return boundedCacheSet(offsetCache, cacheKey,
      Object.freeze([...offsets].sort((a, b) => a - b)), maxCacheEntries);
  };

  const possibleInstantsFor = (local, timeZone) => {
    const representedUtc = Date.UTC(local.year, local.month - 1, local.day,
      local.hour, local.minute, 0);
    const matches = [];
    for (const offset of offsetsFor(local, timeZone)) {
      const candidate = representedUtc - offset;
      if (sameLocalMinute(partsAt(candidate, timeZone), local)) matches.push(candidate);
    }
    return [...new Set(matches)].sort((a, b) => a - b);
  };

  return Object.freeze({
    version: tzdbVersion,
    canonicalize,
    partsAt,
    possibleInstantsFor,
    cacheSizes: () => Object.freeze({
      formatters: formatterCache.size,
      offsetDays: offsetCache.size,
    }),
  });
}

export const defaultTimeZoneAdapter = createIntlTimeZoneAdapter();

export function validateCanonicalTimeZone(value, {
  adapter = defaultTimeZoneAdapter,
} = {}) {
  if (typeof value !== 'string' || value.length === 0
    || Buffer.byteLength(value, 'utf8') > MAX_ZONE_BYTES
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
    || !ZONE_RE.test(value)) return false;
  let canonical;
  try { canonical = adapter.canonicalize(value); }
  catch { return false; }
  return canonical === value;
}

export function normalizeResetSchedule(value, {
  adapter = defaultTimeZoneAdapter,
} = {}) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== SCHEDULE_KEYS.size
    || !Object.keys(value).every((key) => SCHEDULE_KEYS.has(key))
    || !Number.isInteger(value.isoWeekday)
    || value.isoWeekday < 1 || value.isoWeekday > 7
    || typeof value.localTime !== 'string' || !TIME_RE.test(value.localTime)
    || !validateCanonicalTimeZone(value.timeZone, { adapter })) return null;
  return Object.freeze({
    isoWeekday: value.isoWeekday,
    localTime: value.localTime,
    timeZone: value.timeZone,
  });
}

function calendarDate(parts) {
  return { year: parts.year, month: parts.month, day: parts.day };
}

function addCalendarDays(parts, count) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + count));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function isoWeekday(parts) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay() || 7;
}

function addLocalMinutes(local, count) {
  const date = new Date(Date.UTC(local.year, local.month - 1, local.day,
    local.hour, local.minute + count));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}

function resolveLocalWallTime(date, hour, minute, timeZone, adapter) {
  const requested = { ...date, hour, minute };
  for (let advanced = 0; advanced <= GAP_SEARCH_MINUTES; advanced++) {
    const local = advanced === 0 ? requested : addLocalMinutes(requested, advanced);
    const possible = adapter.possibleInstantsFor(local, timeZone)
      .filter((instant) => Number.isFinite(instant)).sort((a, b) => a - b);
    if (possible.length) return possible[0]; // overlap policy: earlier instant
  }
  return null;
}

/** Return the next configured occurrence as canonical UTC, or null if invalid. */
export function resolveConfiguredReset(schedule, nowMs = Date.now(), {
  adapter = defaultTimeZoneAdapter,
} = {}) {
  const normalized = normalizeResetSchedule(schedule, { adapter });
  const now = Number(nowMs);
  if (!normalized || !Number.isFinite(now)) return null;

  let localNow;
  try { localNow = adapter.partsAt(now, normalized.timeZone); }
  catch { return null; }
  const today = calendarDate(localNow);
  const daysAhead = (normalized.isoWeekday - isoWeekday(today) + 7) % 7;
  let targetDate = addCalendarDays(today, daysAhead);
  const [hour, minute] = normalized.localTime.split(':').map(Number);
  let instant;
  try {
    instant = resolveLocalWallTime(targetDate, hour, minute,
      normalized.timeZone, adapter);
    if (instant !== null && instant <= now) {
      targetDate = addCalendarDays(targetDate, 7);
      instant = resolveLocalWallTime(targetDate, hour, minute,
        normalized.timeZone, adapter);
    }
  } catch {
    return null;
  }
  return instant !== null && Number.isFinite(instant) && instant > now
    ? new Date(instant).toISOString() : null;
}

function parseResetInstant(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') return NaN;
  const epochMs = typeof value === 'number'
    ? (value < 1e12 ? value * 1000 : value)
    : Date.parse(value);
  return Number.isFinite(epochMs) ? epochMs : NaN;
}

function inspectLiveReset(live, nowMs) {
  if (live === null || live === undefined) return { status: 'missing', epochMs: null };
  if (typeof live !== 'object' || Array.isArray(live)) return { status: 'invalid', epochMs: null };
  if (live.current !== true || live.successful !== true) return { status: 'not-current', epochMs: null };
  const epochMs = parseResetInstant(live.resetsAt);
  if (epochMs === null) return { status: 'missing', epochMs: null };
  if (!Number.isFinite(epochMs)) return { status: 'invalid', epochMs: null };
  if (epochMs <= nowMs) return { status: 'expired', epochMs: null };
  return { status: 'usable', epochMs };
}

function modelCapCorroborates(modelLimits, selectedEpochMs, nowMs) {
  if (!Number.isFinite(selectedEpochMs) || !Array.isArray(modelLimits)) return false;
  return modelLimits.some((limit) => {
    if (!limit || typeof limit !== 'object' || limit.window !== 'seven_day') return false;
    const epochMs = parseResetInstant(limit.resetsAt);
    return Number.isFinite(epochMs) && epochMs > nowMs && epochMs === selectedEpochMs;
  });
}

/**
 * Select one account-week reset without mutating provider usage or freshness.
 * `liveAccountReset` must be an explicitly current successful account reading;
 * model limits are corroboration-only and can never become the selected reset.
 */
export function selectReset({
  nowMs = Date.now(),
  liveAccountReset = null,
  configuredSchedule = null,
  modelLimits = [],
  adapter = defaultTimeZoneAdapter,
} = {}) {
  const now = Number(nowMs);
  const safeNow = Number.isFinite(now) ? now : Date.now();
  const live = inspectLiveReset(liveAccountReset, safeNow);

  let configuredStatus = configuredSchedule == null ? 'missing' : 'invalid';
  let configuredEpochMs = null;
  if (configuredSchedule != null) {
    const normalized = normalizeResetSchedule(configuredSchedule, { adapter });
    if (normalized) {
      const configuredIso = resolveConfiguredReset(normalized, safeNow, { adapter });
      if (configuredIso) {
        configuredStatus = 'usable';
        configuredEpochMs = Date.parse(configuredIso);
      } else {
        configuredStatus = 'unresolvable';
      }
    }
  }

  const source = live.status === 'usable'
    ? 'live' : configuredStatus === 'usable' ? 'configured' : 'unavailable';
  const selectedEpochMs = source === 'live' ? live.epochMs
    : source === 'configured' ? configuredEpochMs : null;
  return Object.freeze({
    source,
    label: source === 'live' ? 'Live' : source === 'configured' ? 'Configured' : 'Unavailable',
    nextResetAt: Number.isFinite(selectedEpochMs)
      ? new Date(selectedEpochMs).toISOString() : null,
    liveStatus: live.status,
    configuredStatus,
    corroboratedByModelCap: modelCapCorroborates(modelLimits,
      selectedEpochMs, safeNow),
  });
}
