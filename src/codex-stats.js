import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

// Pricing lookup for a Codex/OpenAI model name.
export function codexPriceFor(model) {
  const m = (model || '').toLowerCase();
  for (const key of Object.keys(config.openaiPricing)) {
    if (key !== 'default' && m.includes(key)) return config.openaiPricing[key];
  }
  return config.openaiPricing.default;
}

// Pull a usage record out of a Codex token_count event. Codex's log shape varies
// by version, so accept common spellings; return null if nothing usable.
export function usageFromEvent(o) {
  const tc = o.token_count || o.payload || o;
  const u = tc.usage || tc.last_token_usage || tc.total_token_usage || tc.info || tc;
  if (!u || typeof u !== 'object') return null;
  const input = Number(u.input_tokens ?? u.prompt_tokens ?? u.input ?? 0) || 0;
  const output = Number(u.output_tokens ?? u.completion_tokens ?? u.output ?? 0) || 0;
  const cached = Number(u.cached_input_tokens ?? u.cache_read_input_tokens ?? u.cached_tokens ?? 0) || 0;
  if (!input && !output && !cached) return null;
  const model = o.model || tc.model || u.model || '';
  const ts = o.timestamp || tc.timestamp;
  return { input, output, cached, model, tsMs: ts ? Date.parse(ts) : NaN };
}

export function recordCost(r) {
  const p = codexPriceFor(r.model);
  return (r.input * p.input + r.output * p.output + r.cached * (p.cacheRead ?? p.input)) / 1e6;
}

export function aggregate(records) {
  let tokens = 0, cost = 0, cacheSavings = 0, input = 0, output = 0, cached = 0;
  const sessions = new Set();
  for (const r of records) {
    input += r.input; output += r.output; cached += r.cached;
    tokens += r.input + r.output + r.cached;
    cost += recordCost(r);
    const p = codexPriceFor(r.model);
    cacheSavings += r.cached * (p.input - (p.cacheRead ?? p.input)) / 1e6;
    if (r.sessionId) sessions.add(r.sessionId);
  }
  const base = input + cached;
  return {
    tokens, cost, cacheSavings, sessions: sessions.size,
    input, output, cacheRead: cached, cacheWrite: 0,
    cacheHitRate: base > 0 ? cached / base : 0,
  };
}

function listRollouts(sinceMs) {
  const files = [];
  const walk = (d) => {
    let entries; try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else if (e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) {
        let st; try { st = fs.statSync(fp); } catch { continue; }
        if (st.mtimeMs >= sinceMs) files.push({ fp, sid: e.name });
      }
    }
  };
  walk(config.codexSessionsDir);
  return files;
}

export function readUsageRecords(sinceMs) {
  const records = [];
  for (const { fp, sid } of listRollouts(sinceMs)) {
    let content; try { content = fs.readFileSync(fp, 'utf8'); } catch { continue; }
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      const r = usageFromEvent(o);
      if (!r || Number.isNaN(r.tsMs) || r.tsMs < sinceMs) continue;
      r.sessionId = sid;
      records.push(r);
    }
  }
  return records;
}

let cache = { at: 0, value: null };

function startOfTodayMs(nowMs) {
  const d = new Date(nowMs); d.setHours(0, 0, 0, 0); return d.getTime();
}

// Activity object in the same shape as Claude's, so the UI renders both identically.
// Returns zeros (hasData:false) when Codex has no logged usage yet.
export function computeCodexActivity(nowMs = Date.now()) {
  if (cache.value && nowMs - cache.at < config.statsTtlMs) return cache.value;
  const weekAgo = nowMs - 7 * 24 * 3600_000;
  const all = readUsageRecords(weekAgo);
  const fiveHAgo = nowMs - 5 * 3600_000;
  const hourAgo = nowMs - 3600_000;
  const todayStart = startOfTodayMs(nowMs);

  const week = aggregate(all);
  const last5h = aggregate(all.filter(r => r.tsMs >= fiveHAgo));
  const today = aggregate(all.filter(r => r.tsMs >= todayStart));
  const lastHour = aggregate(all.filter(r => r.tsMs >= hourAgo));

  const value = {
    hasData: all.length > 0,
    tokens: { last5h: last5h.tokens, week: week.tokens, today: today.tokens },
    sessionsToday: today.sessions,
    cacheHitRate: week.cacheHitRate,
    estValueWeek: week.cost,
    estValueToday: today.cost,
    cacheSavingsWeek: week.cacheSavings,
    tokenMix: { input: week.input, output: week.output, cacheRead: week.cacheRead, cacheWrite: 0 },
    burnTokensPerHour: lastHour.tokens,
    generatedAt: new Date(nowMs).toISOString(),
  };
  cache = { at: nowMs, value };
  return value;
}

export function clearCodexStatsCache() { cache = { at: 0, value: null }; }
