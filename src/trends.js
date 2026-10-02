import { getSeries } from './db.js';
import { readUsageRecords as readClaude, aggregate as aggClaude } from './stats.js';
import { readUsageRecords as readCodex, aggregate as aggCodex, codexUsageReady } from './codex-stats.js';

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
  const { utc = false, subset = false } = opts;
  const byDay = new Map();
  for (const r of records) {
    const k = dayKeyMs(r.tsMs, utc);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(r);
  }
  return [...byDay.keys()].sort((a, b) => a - b).map((k) => {
    const g = agg(byDay.get(k));
    const input = subset ? Math.max(0, (g.input || 0) - (g.cacheRead || 0)) : g.input;
    return {
      day: new Date(k).toISOString(),
      tokens: g.tokens, input, output: g.output, cacheRead: g.cacheRead,
      cost: g.cost, cacheHitRate: g.cacheHitRate,
    };
  });
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

  const value = {
    range,
    tools: [
      { source: 'claude-code', label: 'Claude Code', limits: limitSeries('claude-code', sinceIso), daily: dailySeries(readClaude(since), aggClaude), activityState: 'ready' },
      {
        source: 'codex', label: 'Codex', limits: limitSeries('codex', sinceIso),
        daily: codexReady ? dailySeries(readCodex(since), aggCodex, { utc: true, subset: true }) : [],
        activityState: codexReady ? 'ready' : 'warming',
      },
    ],
    generatedAt: new Date(nowMs).toISOString(),
  };
  // A warming answer is not cached, so the next request sees the first publish.
  if (codexReady) cache.set(range, { at: nowMs, value });
  return value;
}

export function clearTrendsCache() { cache = new Map(); }
