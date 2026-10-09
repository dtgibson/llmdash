import { getSeries } from './db.js';
import { aggregate as aggClaude } from './stats.js';
import { readUsageRecords as readCodex, aggregate as aggCodex, codexUsageReady } from './codex-stats.js';
import { scanClaudeTrendRecordsSteps, claudeTrendLimits, clearClaudeTrendFileCache } from './claude-trend-cache.js';
import { createPacer, runCooperatively, runToCompletion } from './cooperative.js';

const RANGES = { '24h': 24 * 3600_000, '7d': 7 * 86400_000, '30d': 30 * 86400_000 };

function dayKeyMs(ms, utc = false) {
  const d = new Date(ms);
  if (utc) { d.setUTCHours(0, 0, 0, 0); return d.getTime(); }
  d.setHours(0, 0, 0, 0); return d.getTime();
}

// Group usage records by day and aggregate each day with the tool's own
// aggregator (Claude and Codex have different record shapes).
// opts.utc buckets on UTC day boundaries (Codex logs are UTC-stamped while its
// session dirs are named in local time — bucket from the timestamps). opts.subset
// means cached ⊆ input (Codex), so the displayed input is the non-cached part.
export function dailySeries(records, agg, opts = {}) {
  return runToCompletion(dailySeriesSteps(records, agg, opts));
}

function *dailySeriesSteps(records, agg, opts = {}, pacer = null) {
  const { utc = false, subset = false } = opts;
  const byDay = new Map();
  for (const r of records) {
    if (pacer?.due()) yield;
    if (opts.sinceMs != null && (r.tsMs < opts.sinceMs || r.fileMtimeMs < opts.sinceMs)) continue;
    const k = dayKeyMs(r.tsMs, utc);
    if (!byDay.has(k)) {
      if (byDay.size >= (opts.maxBuckets ?? Infinity)) throw new Error('daily bucket limit');
      byDay.set(k, []);
    }
    byDay.get(k).push(r);
  }
  const out = [];
  for (const k of [...byDay.keys()].sort((a, b) => a - b)) {
    if (pacer?.due()) yield;
    const g = agg(byDay.get(k));
    const input = subset ? Math.max(0, (g.input || 0) - (g.cacheRead || 0)) : g.input;
    out.push({
      day: new Date(k).toISOString(),
      tokens: g.tokens, input, output: g.output, cacheRead: g.cacheRead,
      cost: g.cost, cacheHitRate: g.cacheHitRate,
    });
  }
  return out;
}

let claudeDaily = null; // one atomic publication, containing all three ranges
let claudeRefresh = null;

function *refreshClaudeTrendsSteps(nowMs, options, pacer) {
  const records = yield* scanClaudeTrendRecordsSteps(nowMs - RANGES['30d'], { ...options, pacer });
  if (records === null) return false;
  const next = {};
  for (const [range, duration] of Object.entries(RANGES)) {
    const since = nowMs - duration;
    // The old reader excluded files whose mtime predates the requested range,
    // as well as records before its cutoff. Preserve both predicates.
    const daily = yield* dailySeriesSteps(records, aggClaude,
      { sinceMs: since, maxBuckets: claudeTrendLimits.maxDailyBuckets }, pacer);
    if (daily.some(d => Object.values(d).some(n => typeof n === 'number' && !Number.isFinite(n)))) return false;
    next[range] = Object.freeze(daily.map(d => Object.freeze(d)));
  }
  claudeDaily = Object.freeze(next);
  clearTrendsCache();
  return true;
}

export function refreshClaudeTrendsAsync(nowMs = Date.now(), options = {}) {
  if (claudeRefresh) return claudeRefresh;
  const pacer = options.pacer || createPacer();
  claudeRefresh = runCooperatively(refreshClaudeTrendsSteps(nowMs, options, pacer), pacer)
    .catch(() => false).finally(() => { claudeRefresh = null; });
  return claudeRefresh;
}

export function clearClaudeTrendsCache() {
  claudeDaily = null;
  clearClaudeTrendFileCache();
  clearTrendsCache();
}

// Limit-burn series per window, from stored snapshots.
function limitSeries(source, sinceIso) {
  const out = {};
  for (const w of ['five_hour', 'seven_day']) {
    out[w] = getSeries(source, w, sinceIso).map((r) => ({
      t: r.captured_at,
      remaining: Math.max(0, 100 - Number(r.used_pct)),
    }));
  }
  return out;
}

let cache = new Map(); // range -> { at, value }
const TTL = 60_000;

export function buildTrends(range = '7d', nowMs = Date.now()) {
  if (!RANGES[range]) range = '7d';
  const hit = cache.get(range);
  if (hit && nowMs - hit.at < TTL) return hit.value;

  const since = nowMs - RANGES[range];
  const sinceIso = new Date(since).toISOString();
  // Codex daily usage comes from the poller's published 30-day scan (the widest
  // trends range), never from a request-path scan. Until the first scan after
  // start publishes, say so with an explicit state instead of empty data that
  // would read as "no activity". activityState is an enum: 'ready' | 'warming'.
  const codexReady = codexUsageReady();
  const claudeReady = claudeDaily !== null;

  const value = {
    range,
    tools: [
      { source: 'claude-code', label: 'Claude Code', limits: limitSeries('claude-code', sinceIso), daily: claudeReady ? claudeDaily[range] : [], activityState: claudeReady ? 'ready' : 'warming' },
      {
        source: 'codex', label: 'Codex', limits: limitSeries('codex', sinceIso),
        daily: codexReady ? dailySeries(readCodex(since), aggCodex, { utc: true, subset: true }) : [],
        activityState: codexReady ? 'ready' : 'warming',
      },
    ],
    generatedAt: new Date(nowMs).toISOString(),
  };
  // A warming answer is not cached, so the next request sees the first publish.
  if (codexReady && claudeReady) cache.set(range, { at: nowMs, value });
  return value;
}

export function clearTrendsCache() { cache = new Map(); }
