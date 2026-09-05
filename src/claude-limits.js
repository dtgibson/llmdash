import fs from 'node:fs';
import { config } from '../config.js';

export const MODEL_LIMIT_RESETLESS_TTL_MS = 7 * 24 * 60 * 60_000;
export const MODEL_LIMIT_CLOCK_SKEW_MS = 5 * 60_000;
// How long after its last observation an aged-out model cap is still NAMED
// (model-cap-expired) instead of the UI claiming a complete reading. A code
// constant, not a knob: long enough to notice a probe that keeps failing,
// bounded so a cap the account genuinely lost stops being mentioned.
export const MODEL_LIMIT_EXPIRED_DISCLOSURE_MS = 30 * 24 * 60 * 60_000;

// Normalize a reset value (epoch seconds, epoch ms, or ISO string) to ISO-8601.
export function toIso(v) {
  if (v == null) return null;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const ms = n < 1e12 ? n * 1000 : n; // 10-digit epoch seconds vs 13-digit ms
  const d = new Date(ms);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function modelSlug(v) {
  const slug = String(v == null ? '' : v).trim().toLowerCase()
    .replace(/^claude-model:/, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug ? slug.slice(0, 96) : null;
}

function boundedDisplayText(value, fallback, max = 96) {
  if (typeof value !== 'string') return fallback;
  const clean = value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').trim();
  return [...clean].slice(0, max).join('') || fallback;
}

function normalizeModelWindow(v) {
  if (v === 'five_hour' || v === 'five-hour' || v === '5h') return 'five_hour';
  return 'seven_day';
}

function normalizeModelLimit(raw, capturedAt) {
  if (!raw || typeof raw !== 'object') return null;
  const model = modelSlug(raw.model ?? raw.label ?? raw.source);
  if (!model) return null;
  const usedNum = Number(raw.used_percentage ?? raw.usedPercentage ?? raw.usedPct ?? raw.utilization);
  if (!Number.isFinite(usedNum)) return null;
  const source = (typeof raw.source === 'string' && /^claude-model:[a-z0-9][a-z0-9-]*$/.test(raw.source))
    ? raw.source.slice(0, 110)
    : `claude-model:${model}`;
  const label = boundedDisplayText(raw.label ?? raw.model, model);
  const usedPct = Math.min(100, Math.max(0, usedNum));
  return {
    source,
    provider: 'claude-code',
    model,
    label,
    window: normalizeModelWindow(raw.window),
    usedPct,
    remainingPct: Math.max(0, 100 - usedPct),
    resetsAt: toIso(raw.resets_at ?? raw.resetsAt),
    capturedAt: toIso(raw.captured_at ?? raw.capturedAt) || capturedAt,
  };
}

// The ONE activity rule for a model cap, shared by the reader (below) and the
// reading-file merge in src/claude-refresh.js. Accepts the raw field shapes
// (epoch seconds, epoch ms, or ISO) via toIso. A reset-bearing cap is active
// until its reset PLUS the clock-skew grace (FM-C3: the pane's reset time and
// this machine's clock can disagree by minutes — expiring the instant the
// reset passes dropped caps that were still live); a resetless cap is active
// for the bounded TTL after a plausible (not future-dated) capture.
export function modelLimitActiveAt(resetsAt, capturedAt, nowMs) {
  const resetIso = toIso(resetsAt);
  if (resetIso) return Date.parse(resetIso) + MODEL_LIMIT_CLOCK_SKEW_MS > nowMs;
  const capturedMs = Date.parse(toIso(capturedAt) || '');
  return Number.isFinite(capturedMs) && capturedMs <= nowMs + MODEL_LIMIT_CLOCK_SKEW_MS
    && nowMs - capturedMs < MODEL_LIMIT_RESETLESS_TTL_MS;
}

function activeModelLimit(limit, nowMs) {
  return modelLimitActiveAt(limit.resetsAt, limit.capturedAt, nowMs);
}

// Which previously observed model cap has aged out with no newer capture
// (the model-cap-expired evidence). `storedRows` are the poller's snapshot
// rows for `claude-model:<slug>` sources (src/db.js getLatestModelSnapshots),
// injected so this stays pure. Rules: a cap with an ACTIVE row in the current
// reading is not expired; a row still active by time but absent from the
// reading is not "expired" either (nothing is guessed about it); only a row
// whose reset (with skew grace) or resetless TTL has passed, observed within
// the bounded disclosure window, qualifies — the newest such observation wins.
// Returns { model, window, lastCapturedAt } or null. Disclosure only: no value
// is revived from history.
export function expiredModelCap(activeLimits, nowMs, storedRows) {
  const active = new Set((Array.isArray(activeLimits) ? activeLimits : [])
    .filter((l) => l && typeof l === 'object')
    .map((l) => `${modelSlug(l.model ?? l.source)}:${normalizeModelWindow(l.window)}`));
  let newest = null;
  for (const row of (Array.isArray(storedRows) ? storedRows : []).slice(0, 256)) {
    if (!row || typeof row !== 'object' || typeof row.source !== 'string') continue;
    if (!row.source.startsWith('claude-model:')) continue;
    const model = modelSlug(row.source);
    const window = normalizeModelWindow(row.window);
    if (!model || active.has(`${model}:${window}`)) continue;
    const lastCapturedAt = toIso(row.captured_at ?? row.capturedAt);
    const capturedMs = lastCapturedAt ? Date.parse(lastCapturedAt) : NaN;
    if (!Number.isFinite(capturedMs) || capturedMs > nowMs + MODEL_LIMIT_CLOCK_SKEW_MS) continue;
    if (nowMs - capturedMs > MODEL_LIMIT_EXPIRED_DISCLOSURE_MS) continue;
    if (modelLimitActiveAt(row.resets_at ?? row.resetsAt, lastCapturedAt, nowMs)) continue;
    if (!newest || capturedMs > newest.capturedMs) newest = { model, window, lastCapturedAt, capturedMs };
  }
  return newest ? { model: newest.model, window: newest.window, lastCapturedAt: newest.lastCapturedAt } : null;
}

// Read the latest rate-limit reading captured by the Claude Code statusline
// script (the sanctioned path). Returns null if nothing has been captured yet.
export function readClaudeLimits(nowMs = Date.now()) {
  let raw;
  try {
    raw = fs.readFileSync(config.rateLimitsFile, 'utf8');
  } catch {
    return null;
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }

  const rl = parsed.rate_limits || parsed.rateLimits || {};

  // Honesty: a missing (or unparseable) capturedAt falls back to the file's
  // mtime — never to "now". Re-stamping now on every read would make a
  // malformed file eternally fresh, defeating the staleness treatment.
  // Security: re-serialize to canonical ISO at ingest, never keep the raw
  // string — V8's Date.parse accepts arbitrary parenthesized content (e.g.
  // "2026 (<img …>)"), and the raw value would otherwise cross the tailnet on
  // /api/state and be persisted to SQLite by the poller (latent stored XSS).
  const capturedTs = parsed.capturedAt ? Date.parse(parsed.capturedAt) : NaN;
  let capturedAt = Number.isFinite(capturedTs) ? new Date(capturedTs).toISOString() : null;
  if (!capturedAt) {
    try { capturedAt = fs.statSync(config.rateLimitsFile).mtime.toISOString(); }
    catch { /* file vanished between read and stat; leave null (unknown age) */ }
  }
  const windows = {};
  for (const key of ['five_hour', 'seven_day']) {
    const w = rl[key];
    if (!w) continue;
    const usedNum = Number(w.used_percentage ?? w.usedPercentage ?? w.utilization);
    if (!Number.isFinite(usedNum)) continue; // skip missing or garbage windows
    windows[key] = {
      usedPct: Math.min(100, Math.max(0, usedNum)), // clamp to 0–100
      resetsAt: toIso(w.resets_at ?? w.resetsAt),
    };
  }
  const modelLimits = (Array.isArray(parsed.model_limits) ? parsed.model_limits : Array.isArray(parsed.modelLimits) ? parsed.modelLimits : [])
    .slice(0, 128)
    .map((m) => normalizeModelLimit(m, capturedAt))
    .filter(Boolean)
    .filter((limit) => activeModelLimit(limit, Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now()));
  if (Object.keys(windows).length === 0 && modelLimits.length === 0) return null;
  return { source: 'claude-code', capturedAt, windows, modelLimits };
}
