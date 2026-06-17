import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

// --- Pure helpers (unit-tested) ---------------------------------------------

export function priceFor(model) {
  const m = (model || '').toLowerCase();
  if (m.includes('opus')) return config.pricing.opus;
  if (m.includes('sonnet')) return config.pricing.sonnet;
  if (m.includes('haiku')) return config.pricing.haiku;
  return config.pricing.default;
}

export function totalTokens(u) {
  return (u.input_tokens || 0) + (u.output_tokens || 0)
    + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
}

// USD cost of one usage record at the given model's rates.
export function recordCost(u, model) {
  const p = priceFor(model);
  return (
    (u.input_tokens || 0) * p.input +
    (u.output_tokens || 0) * p.output +
    (u.cache_creation_input_tokens || 0) * p.cacheWrite +
    (u.cache_read_input_tokens || 0) * p.cacheRead
  ) / 1e6;
}

// Aggregate {model, usage, sessionId} records into displayed figures.
export function aggregate(records) {
  let tokens = 0, cost = 0, cacheSavings = 0;
  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0;
  const sessions = new Set();
  for (const r of records) {
    const u = r.usage;
    const p = priceFor(r.model);
    const cr = u.cache_read_input_tokens || 0;
    input += u.input_tokens || 0;
    output += u.output_tokens || 0;
    cacheRead += cr;
    cacheWrite += u.cache_creation_input_tokens || 0;
    tokens += totalTokens(u);
    cost += recordCost(u, r.model);
    // What those cache reads would have cost at full input price, minus what
    // they actually cost — i.e. the savings the prompt cache earned.
    cacheSavings += cr * (p.input - p.cacheRead) / 1e6;
    if (r.sessionId) sessions.add(r.sessionId);
  }
  const cacheBase = input + cacheWrite + cacheRead;
  return {
    tokens, cost, cacheSavings, sessions: sessions.size,
    input, output, cacheRead, cacheWrite,
    cacheHitRate: cacheBase > 0 ? cacheRead / cacheBase : 0,
  };
}

// Given a window's used % and reset time, estimate when — at the current pace
// within this window — usage would reach 100%. windowHours is the window length
// (5 for the 5-hour window, 168 for the weekly window): a code constant supplied
// by the caller, not stored data.
export function projectWindow(usedPct, resetsAtMs, nowMs, windowHours = 5) {
  if (usedPct == null || resetsAtMs == null) return null;
  const windowStart = resetsAtMs - windowHours * 3600_000;
  const elapsedH = (nowMs - windowStart) / 3600_000;
  if (elapsedH <= 0 || usedPct <= 0) return { hitsBeforeReset: false, etaMs: null, hoursToFull: null };
  const ratePerH = usedPct / elapsedH;
  const hoursToFull = (100 - usedPct) / ratePerH;
  const etaMs = nowMs + hoursToFull * 3600_000;
  return { hitsBeforeReset: etaMs < resetsAtMs, etaMs, hoursToFull };
}

// Back-compat alias: the 5-hour projector is projectWindow with the default 5h.
// Kept so existing imports/tests of projectFiveHour keep working.
export const projectFiveHour = projectWindow;

// --- Transcript reading ------------------------------------------------------

function listRecentTranscripts(sinceMs) {
  let dirs;
  try { dirs = fs.readdirSync(config.projectsDir, { withFileTypes: true }); }
  catch { return []; }
  const files = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(config.projectsDir, d.name);
    let entries;
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      if (!name.endsWith('.jsonl')) continue;
      const fp = path.join(dir, name);
      let st; try { st = fs.statSync(fp); } catch { continue; }
      if (st.mtimeMs >= sinceMs) files.push(fp); // skip files untouched in the window
    }
  }
  return files;
}

// Assistant usage records newer than sinceMs, read from recent transcripts only.
export function readUsageRecords(sinceMs) {
  const records = [];
  for (const fp of listRecentTranscripts(sinceMs)) {
    let content; try { content = fs.readFileSync(fp, 'utf8'); } catch { continue; }
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      const u = o.message && o.message.usage;
      if (!u) continue;
      const tsMs = Date.parse(o.timestamp);
      if (Number.isNaN(tsMs) || tsMs < sinceMs) continue;
      records.push({ tsMs, model: o.message.model, usage: u, sessionId: o.sessionId });
    }
  }
  return records;
}

// --- Cached activity snapshot for the API -----------------------------------

let cache = { at: 0, value: null };

function startOfTodayMs(nowMs) {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function computeActivity(nowMs = Date.now()) {
  if (cache.value && nowMs - cache.at < config.statsTtlMs) return cache.value;

  const weekAgo = nowMs - 7 * 24 * 3600_000;
  const all = readUsageRecords(weekAgo); // widest window we display
  const fiveHAgo = nowMs - 5 * 3600_000;
  const hourAgo = nowMs - 3600_000;
  const todayStart = startOfTodayMs(nowMs);

  const week = aggregate(all);
  const last5h = aggregate(all.filter(r => r.tsMs >= fiveHAgo));
  const today = aggregate(all.filter(r => r.tsMs >= todayStart));
  const lastHour = aggregate(all.filter(r => r.tsMs >= hourAgo));

  const value = {
    tokens: { last5h: last5h.tokens, week: week.tokens, today: today.tokens },
    sessionsToday: today.sessions,
    cacheHitRate: week.cacheHitRate, // weekly base is the most stable
    estValueWeek: week.cost,
    estValueToday: today.cost,
    cacheSavingsWeek: week.cacheSavings,
    tokenMix: { input: week.input, output: week.output, cacheRead: week.cacheRead, cacheWrite: week.cacheWrite },
    burnTokensPerHour: lastHour.tokens, // tokens in the last hour = tokens/hr
    generatedAt: new Date(nowMs).toISOString(),
  };
  cache = { at: nowMs, value };
  return value;
}

export function clearStatsCache() { cache = { at: 0, value: null }; }
