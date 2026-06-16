import { getSeries } from './db.js';
import { readUsageRecords as readClaude, aggregate as aggClaude } from './stats.js';
import { readUsageRecords as readCodex, aggregate as aggCodex } from './codex-stats.js';

const RANGES = { '24h': 24 * 3600_000, '7d': 7 * 86400_000, '30d': 30 * 86400_000 };

function dayKeyMs(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }

// Group usage records by local day and aggregate each day with the tool's own
// aggregator (Claude and Codex have different record shapes).
export function dailySeries(records, agg) {
  const byDay = new Map();
  for (const r of records) {
    const k = dayKeyMs(r.tsMs);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(r);
  }
  return [...byDay.keys()].sort((a, b) => a - b).map((k) => {
    const g = agg(byDay.get(k));
    return {
      day: new Date(k).toISOString(),
      tokens: g.tokens, input: g.input, output: g.output, cacheRead: g.cacheRead,
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

  const value = {
    range,
    tools: [
      { source: 'claude-code', label: 'Claude Code', limits: limitSeries('claude-code', sinceIso), daily: dailySeries(readClaude(since), aggClaude) },
      { source: 'codex', label: 'Codex', limits: limitSeries('codex', sinceIso), daily: dailySeries(readCodex(since), aggCodex) },
    ],
    generatedAt: new Date(nowMs).toISOString(),
  };
  cache.set(range, { at: nowMs, value });
  return value;
}

export function clearTrendsCache() { cache = new Map(); }
