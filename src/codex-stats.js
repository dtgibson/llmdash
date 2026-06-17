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

// Pull a usage record out of a Codex token_count event. Real Codex logs nest the
// per-turn delta at payload.info.last_token_usage (the field to SUM); older/other
// shapes put tokens under .usage or at the top level. Accept all; null if nothing.
export function usageFromEvent(o) {
  if (!o || typeof o !== 'object') return null;
  const tc = o.payload || o.token_count || o;
  const info = (tc && typeof tc.info === 'object' && tc.info) ? tc.info : tc;
  const u = info.last_token_usage || tc.usage || tc.last_token_usage
    || info.total_token_usage || tc.total_token_usage || info;
  if (!u || typeof u !== 'object') return null;
  const input = Number(u.input_tokens ?? u.prompt_tokens ?? u.input ?? 0) || 0;
  const output = Number(u.output_tokens ?? u.completion_tokens ?? u.output ?? 0) || 0;
  // Codex's cached_input_tokens is a SUBSET of input_tokens (not a disjoint bucket
  // like Anthropic's cache fields).
  const cached = Number(u.cached_input_tokens ?? u.cache_read_input_tokens ?? u.cached_tokens ?? 0) || 0;
  const reasoning = Number(u.reasoning_output_tokens ?? u.reasoning_tokens ?? 0) || 0;
  if (!input && !output && !cached) return null;
  const model = o.model || tc.model || u.model || '';
  const ts = o.timestamp || tc.timestamp;
  return { input, output, cached, reasoning, model, tsMs: ts ? Date.parse(ts) : NaN };
}

// token_count events carry no model of their own; the model is recorded in
// turn_context / session_meta events. Pull it from there so cost uses real rates.
function modelFromEvent(o) {
  if (!o || typeof o !== 'object') return '';
  const p = o.payload || o;
  if (!p || typeof p !== 'object') return '';
  return p.model || (p.info && p.info.model) || o.model || '';
}

export function recordCost(r) {
  const p = codexPriceFor(r.model);
  // cached is a subset of input: bill the non-cached part of input at the input
  // rate and the cached part at the cache-read rate. Never bill the same tokens twice.
  const cacheRead = p.cacheRead ?? p.input;
  const nonCached = Math.max(0, r.input - r.cached);
  return (nonCached * p.input + r.cached * cacheRead + r.output * p.output) / 1e6;
}

export function aggregate(records) {
  let tokens = 0, cost = 0, cacheSavings = 0, input = 0, output = 0, cached = 0;
  const sessions = new Set();
  for (const r of records) {
    input += r.input; output += r.output; cached += r.cached;
    // cached ⊆ input, so the real total is input + output (cached is already
    // counted inside input — do NOT add it again).
    tokens += r.input + r.output;
    cost += recordCost(r);
    const p = codexPriceFor(r.model);
    const cacheRead = p.cacheRead ?? p.input;
    cacheSavings += r.cached * (p.input - cacheRead) / 1e6;
    if (r.sessionId) sessions.add(r.sessionId);
  }
  return {
    tokens, cost, cacheSavings, sessions: sessions.size,
    input, output, cacheRead: cached, cacheWrite: 0,
    // cached ⊆ input → hit rate is cached / input.
    cacheHitRate: input > 0 ? cached / input : 0,
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
    const fileRecs = [];
    let sessionModel = '';
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (!o || typeof o !== 'object') continue; // skip primitive / null JSONL lines
      if (!sessionModel) { const m = modelFromEvent(o); if (m) sessionModel = m; }
      const r = usageFromEvent(o);
      if (!r || Number.isNaN(r.tsMs) || r.tsMs < sinceMs) continue;
      r.sessionId = sid;
      fileRecs.push(r);
    }
    // token_count events have no model — stamp the session's model (from
    // turn_context / session_meta) so cost uses the right rates.
    for (const r of fileRecs) if (!r.model && sessionModel) r.model = sessionModel;
    records.push(...fileRecs);
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
    // Codex's cached tokens are a subset of input — the UI uses this to label and
    // lay out the token mix honestly (cached ÷ input, total = input + output).
    cachedIsSubsetOfInput: true,
    tokens: { last5h: last5h.tokens, week: week.tokens, today: today.tokens },
    sessionsToday: today.sessions,
    cacheHitRate: week.cacheHitRate,
    estValueWeek: week.cost,
    estValueToday: today.cost,
    cacheSavingsWeek: week.cacheSavings,
    // Show input as the NON-cached input so the mix segments sum to input+output
    // (cacheRead carries the cached subset). Avoids double-counting cached tokens.
    tokenMix: { input: Math.max(0, week.input - week.cacheRead), output: week.output, cacheRead: week.cacheRead, cacheWrite: 0 },
    burnTokensPerHour: lastHour.tokens,
    generatedAt: new Date(nowMs).toISOString(),
  };
  cache = { at: nowMs, value };
  return value;
}

export function clearCodexStatsCache() { cache = { at: 0, value: null }; }
