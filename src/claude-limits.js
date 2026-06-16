import fs from 'node:fs';
import { config } from '../config.js';

// Normalize a reset value (epoch seconds, epoch ms, or ISO string) to ISO-8601.
export function toIso(v) {
  if (v == null) return null;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  const ms = v < 1e12 ? v * 1000 : v; // 10-digit epoch seconds vs 13-digit ms
  return new Date(ms).toISOString();
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

  const rl = parsed.rate_limits || parsed.rateLimits;
  if (!rl) return null;

  const capturedAt = parsed.capturedAt || new Date().toISOString();
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
  if (Object.keys(windows).length === 0) return null;
  return { source: 'claude-code', capturedAt, windows };
}
