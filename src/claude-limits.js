import fs from 'node:fs';
import { config } from '../config.js';

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
  return slug || null;
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
    ? raw.source
    : `claude-model:${model}`;
  const label = String(raw.label ?? raw.model ?? model).trim() || model;
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

// Read the latest rate-limit reading captured by the Claude Code statusline
// script (the sanctioned path). Returns null if nothing has been captured yet.
export function readClaudeLimits() {
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
    .map((m) => normalizeModelLimit(m, capturedAt))
    .filter(Boolean);
  if (Object.keys(windows).length === 0 && modelLimits.length === 0) return null;
  return { source: 'claude-code', capturedAt, windows, modelLimits };
}
