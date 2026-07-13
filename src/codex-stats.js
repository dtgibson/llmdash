import { config } from '../config.js';
import { codexAccountFacts } from './codex-limits.js';
import { normalizeCodexModelLabel, scanCodexRollouts } from './codex-events.js';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
export const CODEX_INSIGHT_RANGES = Object.freeze({ '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY });
const TOOL_LABELS = Object.freeze(['Shell', 'File edits', 'Search', 'MCP', 'Subagents', 'Other']);
const EFFORT_LABELS = new Set(['Minimal', 'Low', 'Medium', 'High', 'X-high', 'Other']);

const finiteNonnegative = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const safe = (v) => finiteNonnegative(v) ? Math.min(Number.MAX_SAFE_INTEGER, Math.floor(v)) : 0;
const addSafe = (a, b) => Math.min(Number.MAX_SAFE_INTEGER, safe(a) + safe(b));
const ratio = (a, b) => finiteNonnegative(a) && finiteNonnegative(b) && b > 0
  ? Math.min(1, Math.max(0, a / b)) : null;
const aggregateModelLabel = (value) => normalizeCodexModelLabel(value) || 'Other';

// Pricing lookup for a Codex/OpenAI model name.
export function codexPriceFor(model) {
  const m = (model || '').toLowerCase();
  for (const key of Object.keys(config.openaiPricing)) {
    if (key !== 'default' && m.includes(key)) return config.openaiPricing[key];
  }
  return config.openaiPricing.default;
}

// Back-compatible pure helper used by tests and older callers. The production
// rollout path uses src/codex-events.js, which also supplies turn/context state.
export function usageFromEvent(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const tc = o.payload || o.token_count || o;
  if (!tc || typeof tc !== 'object' || Array.isArray(tc)) return null;
  const info = tc.info && typeof tc.info === 'object' && !Array.isArray(tc.info) ? tc.info : tc;
  const u = info.last_token_usage || tc.usage || tc.last_token_usage;
  if (!u || typeof u !== 'object' || Array.isArray(u)) return null;
  const number = (...values) => {
    for (const v of values) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(v));
    }
    return 0;
  };
  const input = number(u.input_tokens, u.prompt_tokens, u.input);
  const output = number(u.output_tokens, u.completion_tokens, u.output);
  const cached = Math.min(input, number(u.cached_input_tokens, u.cache_read_input_tokens, u.cached_tokens));
  if (!input && !output && !cached) return null;
  const rawReasoning = u.reasoning_output_tokens ?? u.reasoning_tokens;
  const reasoning = typeof rawReasoning === 'number' && Number.isFinite(rawReasoning)
    && rawReasoning >= 0 && rawReasoning <= output ? Math.floor(rawReasoning) : null;
  const model = o.model || tc.model || u.model || '';
  const ts = o.timestamp || tc.timestamp;
  return { input, output, cached, reasoning, total: addSafe(input, output), model, tsMs: ts ? Date.parse(ts) : NaN };
}

export function recordCost(r) {
  const p = codexPriceFor(r.model);
  const cacheRead = p.cacheRead ?? p.input;
  const input = safe(r.input), cached = Math.min(input, safe(r.cached)), output = safe(r.output);
  const nonCached = Math.max(0, input - cached);
  return (nonCached * p.input + cached * cacheRead + output * p.output) / 1e6;
}

export function aggregate(records) {
  let tokens = 0, cost = 0, cacheSavings = 0, input = 0, output = 0, cached = 0;
  const sessions = new Set();
  for (const r of Array.isArray(records) ? records : []) {
    const ri = safe(r.input), ro = safe(r.output), rc = Math.min(ri, safe(r.cached));
    input = addSafe(input, ri); output = addSafe(output, ro); cached = addSafe(cached, rc);
    tokens = addSafe(tokens, addSafe(ri, ro));
    cost += recordCost({ ...r, input: ri, output: ro, cached: rc });
    const p = codexPriceFor(r.model), cacheRead = p.cacheRead ?? p.input;
    cacheSavings += rc * (p.input - cacheRead) / 1e6;
    const sid = r.sessionKey ?? r.sessionId;
    if (sid != null) sessions.add(sid);
  }
  return {
    tokens, cost, cacheSavings, sessions: sessions.size,
    input, output, cacheRead: cached, cacheWrite: 0,
    cacheHitRate: input > 0 ? cached / input : 0,
  };
}

function emptyActivity(generatedAt = null) {
  return {
    hasData: false,
    cachedIsSubsetOfInput: true,
    tokens: { last5h: 0, week: 0, today: 0 },
    sessionsToday: 0,
    cacheHitRate: 0,
    estValueWeek: 0,
    estValueToday: 0,
    cacheSavingsWeek: 0,
    tokenMix: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    burnTokensPerHour: 0,
    generatedAt,
  };
}

function startOfTodayMs(nowMs) {
  const d = new Date(nowMs); d.setHours(0, 0, 0, 0); return d.getTime();
}

function activityFromUsage(usage, nowMs) {
  const weekAgo = nowMs - 7 * DAY;
  const all = usage.filter((r) => finiteNonnegative(r.tsMs) && r.tsMs >= weekAgo && r.tsMs <= nowMs);
  const week = aggregate(all);
  const last5h = aggregate(all.filter((r) => r.tsMs >= nowMs - 5 * HOUR));
  const today = aggregate(all.filter((r) => r.tsMs >= startOfTodayMs(nowMs)));
  const lastHour = aggregate(all.filter((r) => r.tsMs >= nowMs - HOUR));
  return {
    hasData: all.length > 0,
    cachedIsSubsetOfInput: true,
    tokens: { last5h: last5h.tokens, week: week.tokens, today: today.tokens },
    sessionsToday: today.sessions,
    cacheHitRate: week.cacheHitRate,
    estValueWeek: week.cost,
    estValueToday: today.cost,
    cacheSavingsWeek: week.cacheSavings,
    tokenMix: {
      input: Math.max(0, week.input - week.cacheRead), output: week.output,
      cacheRead: week.cacheRead, cacheWrite: 0,
    },
    burnTokensPerHour: lastHour.tokens,
    generatedAt: new Date(nowMs).toISOString(),
  };
}

function unavailableInsights(range, generatedAt = null) {
  return {
    source: 'codex', scope: 'local-machine', range, generatedAt, hasData: false,
    summary: {
      reasoning: { available: false, share: null, tokens: null, outputTokens: null },
      turns: { available: false, count: null, averageTokens: null },
      sessions: { available: false, count: null, averageTokens: null },
      busiestDay: { available: false, day: null, tokens: null },
    },
    mix: {
      models: { available: false, items: [] },
      effort: { available: false, items: [] },
      tools: { available: false, items: [] },
    },
    context: {
      pressure: { available: false, peak: null, supportedTurns: null, turnsAtOrAbove80Pct: null },
      compactions: { available: false, count: null, sessionsAffected: null },
    },
    latency: {
      total: { available: false, medianMs: null, p95Ms: null, samples: null },
      firstToken: { available: false, medianMs: null, p95Ms: null, samples: null },
    },
    daily: [],
  };
}

const canonicalRange = (range) => Object.hasOwn(CODEX_INSIGHT_RANGES, range) ? range : '7d';
const recordKey = (r, index) => `${String(r.sessionKey ?? 'session')}\u0000${String(r.turnKey ?? `legacy-${index}`)}`;

function nearestRank(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function latencyMetric(values) {
  const safeValues = values.filter(finiteNonnegative).map((v) => Math.min(Number.MAX_SAFE_INTEGER, v));
  return safeValues.length ? {
    available: true, medianMs: median(safeValues), p95Ms: nearestRank(safeValues, 0.95), samples: safeValues.length,
  } : { available: false, medianMs: null, p95Ms: null, samples: null };
}

function utcDay(ms) {
  const d = new Date(ms); d.setUTCHours(0, 0, 0, 0); return d.getTime();
}

function mixMetric(map, valueKey, denominator, maxRows = Infinity, namedLimit = null) {
  const metricValue = (row) => valueKey === 'turnCount' ? row.turns.size : row[valueKey];
  let rows = [...map.values()].sort((a, b) => metricValue(b) - metricValue(a) || a.label.localeCompare(b.label));
  const tooManyNamed = Number.isFinite(namedLimit)
    && rows.filter((row) => row.label !== 'Other').length > namedLimit;
  if (tooManyNamed || (Number.isFinite(maxRows) && rows.length > maxRows)) {
    const named = rows.filter((r) => r.label !== 'Other');
    const existingOther = rows.find((r) => r.label === 'Other');
    const keepCount = Number.isFinite(namedLimit) ? namedLimit : Math.max(0, maxRows - 1);
    const keep = named.slice(0, keepCount);
    const rest = named.slice(keepCount);
    if (existingOther || rest.length) {
      const other = { label: 'Other', tokens: 0, turns: new Set(), invocations: 0 };
      for (const row of [...rest, ...(existingOther ? [existingOther] : [])]) {
        other.tokens = addSafe(other.tokens, row.tokens || 0);
        other.invocations = addSafe(other.invocations, row.invocations || 0);
        for (const key of row.turns || []) other.turns.add(key);
      }
      keep.push(other);
    }
    rows = keep;
  }
  const items = rows.map((row) => {
    const n = valueKey === 'turnCount' ? row.turns.size : safe(row[valueKey]);
    const base = { label: row.label };
    if (valueKey === 'tokens') Object.assign(base, { tokens: n, tokenShare: ratio(n, denominator), turns: row.turns.size });
    else if (valueKey === 'turnCount') Object.assign(base, { turns: n, share: ratio(n, denominator) });
    else Object.assign(base, { invocations: n, share: ratio(n, denominator) });
    return base;
  });
  return { available: items.length > 0, items };
}

export function buildCodexInsights(scan, range = '7d', nowMs = Date.now()) {
  range = canonicalRange(range);
  const value = unavailableInsights(range, new Date(nowMs).toISOString());
  const sinceMs = nowMs - CODEX_INSIGHT_RANGES[range];
  const usage = (Array.isArray(scan?.usage) ? scan.usage : []).filter((r) => finiteNonnegative(r.tsMs) && r.tsMs >= sinceMs && r.tsMs <= nowMs);
  const completions = (Array.isArray(scan?.completions) ? scan.completions : []).filter((r) => finiteNonnegative(r.tsMs) && r.tsMs >= sinceMs && r.tsMs <= nowMs);
  const compactions = (Array.isArray(scan?.compactions) ? scan.compactions : []).filter((r) => finiteNonnegative(r.tsMs) && r.tsMs >= sinceMs && r.tsMs <= nowMs);
  const tools = (Array.isArray(scan?.tools) ? scan.tools : []).filter((r) => finiteNonnegative(r.tsMs) && r.tsMs >= sinceMs && r.tsMs <= nowMs);
  const timedCompletions = completions.filter((record) => finiteNonnegative(record.durationMs)
    || finiteNonnegative(record.firstTokenMs));
  value.hasData = usage.length > 0 || tools.length > 0 || compactions.length > 0 || timedCompletions.length > 0;

  const turns = new Map(), sessions = new Set(), models = new Map(), efforts = new Map(), contextByTurn = new Map();
  let totalTokens = 0, supportedTurnTokens = 0;
  let supportedReasoning = 0, supportedReasoningOutput = 0, reasoningSamples = 0;
  const daily = new Map();
  usage.forEach((r, index) => {
    const hasTurn = r.turnKey !== null && r.turnKey !== undefined;
    const key = hasTurn ? recordKey(r, index) : null;
    const tokens = addSafe(r.input, r.output);
    totalTokens = addSafe(totalTokens, tokens);
    if (r.sessionKey != null) sessions.add(r.sessionKey);
    if (hasTurn) {
      supportedTurnTokens = addSafe(supportedTurnTokens, tokens);
      if (!turns.has(key)) turns.set(key, { tokens: 0 });
      turns.get(key).tokens = addSafe(turns.get(key).tokens, tokens);
    }
    if (r.reasoning !== null && r.reasoning !== undefined && finiteNonnegative(r.reasoning) && r.reasoning <= safe(r.output)) {
      supportedReasoning = addSafe(supportedReasoning, r.reasoning);
      supportedReasoningOutput = addSafe(supportedReasoningOutput, r.output);
      reasoningSamples++;
    }

    if (hasTurn && typeof r.model === 'string' && r.model) {
      const label = aggregateModelLabel(r.model);
      if (!models.has(label)) models.set(label, { label, tokens: 0, turns: new Set() });
      const row = models.get(label); row.tokens = addSafe(row.tokens, tokens); row.turns.add(key);
    }
    if (hasTurn && typeof r.effort === 'string' && r.effort) {
      const label = EFFORT_LABELS.has(r.effort) ? r.effort : 'Other';
      if (!efforts.has(label)) efforts.set(label, { label, turns: new Set() });
      efforts.get(label).turns.add(key);
    }
    if (hasTurn && finiteNonnegative(r.contextWindow) && r.contextWindow > 0 && safe(r.input) <= r.contextWindow) {
      const pressure = r.input / r.contextWindow;
      contextByTurn.set(key, Math.max(contextByTurn.get(key) || 0, pressure));
    }

    const day = utcDay(r.tsMs);
    if (!daily.has(day)) daily.set(day, {
      day, tokens: 0, turnTokens: 0, reasoningTokens: 0,
      outputTokens: 0, reasoningSamples: 0, turns: new Set(),
    });
    const d = daily.get(day);
    d.tokens = addSafe(d.tokens, tokens);
    if (hasTurn) {
      d.turnTokens = addSafe(d.turnTokens, tokens);
      d.turns.add(key);
    }
    if (r.reasoning !== null && r.reasoning !== undefined && finiteNonnegative(r.reasoning) && r.reasoning <= safe(r.output)) {
      d.reasoningTokens = addSafe(d.reasoningTokens, r.reasoning);
      d.outputTokens = addSafe(d.outputTokens, r.output);
      d.reasoningSamples++;
    }
  });

  value.summary.reasoning = reasoningSamples > 0 && supportedReasoningOutput > 0
    ? { available: true, share: ratio(supportedReasoning, supportedReasoningOutput), tokens: supportedReasoning, outputTokens: supportedReasoningOutput }
    : value.summary.reasoning;
  if (turns.size) {
    value.summary.turns = { available: true, count: turns.size, averageTokens: supportedTurnTokens / turns.size };
  }
  if (sessions.size) {
    value.summary.sessions = { available: true, count: sessions.size, averageTokens: totalTokens / sessions.size };
  }

  const days = [...daily.values()].sort((a, b) => a.day - b.day);
  const busiest = days.reduce((best, d) => !best || d.tokens > best.tokens || (d.tokens === best.tokens && d.day > best.day) ? d : best, null);
  if (busiest) value.summary.busiestDay = { available: true, day: new Date(busiest.day).toISOString(), tokens: busiest.tokens };

  const taggedModelTokens = [...models.values()].reduce((n, row) => addSafe(n, row.tokens), 0);
  // Five named models plus a bounded Other tail.
  value.mix.models = mixMetric(models, 'tokens', taggedModelTokens, 6, 5);
  const taggedEffortTurns = [...efforts.values()].reduce((n, row) => addSafe(n, row.turns.size), 0);
  value.mix.effort = mixMetric(efforts, 'turnCount', taggedEffortTurns, 5);

  const toolMap = new Map(TOOL_LABELS.map((label) => [label, { label, invocations: 0 }]));
  for (const t of tools) {
    const label = TOOL_LABELS.includes(t.category) ? t.category : 'Other';
    toolMap.get(label).invocations = addSafe(toolMap.get(label).invocations, 1);
  }
  const observedTools = new Map([...toolMap].filter(([, row]) => row.invocations > 0));
  const toolsSupported = tools.length > 0 || !!scan?.capabilities?.toolEvents;
  value.mix.tools = toolsSupported ? mixMetric(observedTools, 'invocations', tools.length) : value.mix.tools;
  if (toolsSupported && !tools.length) value.mix.tools = { available: true, items: [] };

  if (contextByTurn.size) {
    const pressures = [...contextByTurn.values()];
    value.context.pressure = {
      available: true, peak: pressures.reduce((peak, pressure) => Math.max(peak, pressure), 0), supportedTurns: pressures.length,
      turnsAtOrAbove80Pct: pressures.filter((n) => n >= 0.8).length,
    };
  }
  if (compactions.length || scan?.capabilities?.compactionEvents) {
    value.context.compactions = {
      available: true, count: compactions.length,
      sessionsAffected: new Set(compactions.map((r) => r.sessionKey)).size,
    };
  }

  value.latency.total = latencyMetric(completions.map((r) => r.durationMs));
  value.latency.firstToken = latencyMetric(completions.map((r) => r.firstTokenMs));
  value.daily = days.slice(-30).map((d) => ({
    day: new Date(d.day).toISOString(), tokens: d.tokens,
    reasoningTokens: d.reasoningSamples > 0 ? d.reasoningTokens : null,
    outputTokens: d.reasoningSamples > 0 ? d.outputTokens : null,
    turns: d.turns.size || null,
    reasoningShare: d.reasoningSamples > 0 && d.outputTokens > 0 ? ratio(d.reasoningTokens, d.outputTokens) : null,
    averageTokensPerTurn: d.turns.size ? d.turnTokens / d.turns.size : null,
  }));
  return value;
}

let cache = { activity: emptyActivity(), insights: new Map(), generatedAt: null };

// Poller/startup-owned refresh. Atomic replacement means a failed refresh keeps
// the prior good view; HTTP getters below never scan the session tree.
export function refreshCodexAnalytics(nowMs = Date.now(), scanFn = scanCodexRollouts) {
  let scan;
  const sinceMs = nowMs - CODEX_INSIGHT_RANGES['30d'];
  try { scan = scanFn(sinceMs, { pruneBeforeMs: sinceMs }); }
  catch { return false; }
  const usage = Array.isArray(scan?.usage) ? scan.usage : [];
  const insights = new Map();
  for (const range of Object.keys(CODEX_INSIGHT_RANGES)) insights.set(range, buildCodexInsights(scan, range, nowMs));
  cache = { activity: activityFromUsage(usage, nowMs), insights, generatedAt: new Date(nowMs).toISOString() };
  return true;
}

// Existing activity contract, now a pure cache read.
export function computeCodexActivity() { return cache.activity; }

export function getCodexInsights(range = '7d') {
  range = canonicalRange(range);
  const base = cache.insights.get(range) || unavailableInsights(range, cache.generatedAt);
  return { ...base, account: codexAccountFacts() };
}

// Existing trends/tests use this reader. It delegates to the same normalized,
// deduplicated scanner so totals cannot disagree with the insight endpoint.
export function readUsageRecords(sinceMs) {
  const scan = scanCodexRollouts(sinceMs);
  return (Array.isArray(scan?.usage) ? scan.usage : []).filter((r) => finiteNonnegative(r.tsMs) && r.tsMs >= sinceMs)
    .map((r) => ({ ...r, sessionId: r.sessionKey }));
}

export function clearCodexStatsCache() { cache = { activity: emptyActivity(), insights: new Map(), generatedAt: null }; }
