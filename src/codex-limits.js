import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from '../config.js';
import { toIso } from './claude-limits.js';
import { resolveCommand } from './health.js';

// Why Codex limits are (un)available, for the startup log and /api/state.
// Reasons: 'ok' (live read worked), 'codex-cmd-failed' (the configured command
// can't be run — the fresh-install failure mode), 'no-reading' (command runs
// but no rate-limit data has arrived yet). Seeded from a static PATH check so
// the very first HTTP request is already honest; the poller keeps it current.
let diag = resolveCommand(config.codexCmd)
  ? { reason: 'no-reading', cmd: config.codexCmd, detail: null }
  : { reason: 'codex-cmd-failed', cmd: config.codexCmd, detail: 'not found' };
let loggedKey = '';
let spawnFailedThisRead = false;
let observedPlanType = null;
let observedPlanAtMs = null;
let observedCreditUnlimited;
let observedCreditUnlimitedAtMs = null;
let observedHasCredits;
let observedHasCreditsAtMs = null;
let observedCreditBalance;
let observedCreditBalanceAtMs = null;
let observedResetCreditsAvailable;
let observedResetCreditsAvailableAtMs = null;

const configuredPollMs = Number(config.pollIntervalMs);
const ACCOUNT_FACT_TTL_MS = Math.min(30 * 60_000, Math.max(5 * 60_000,
  Number.isFinite(configuredPollMs) && configuredPollMs > 0 ? configuredPollMs * 5 : 5 * 60_000));

const PLAN_LABELS = {
  free: 'ChatGPT Free',
  go: 'ChatGPT Go',
  plus: 'ChatGPT Plus',
  pro: 'ChatGPT Pro',
  prolite: 'ChatGPT Pro Lite',
  team: 'ChatGPT Team',
  self_serve_business_usage_based: 'ChatGPT Business',
  business: 'ChatGPT Business',
  enterprise_cbp_usage_based: 'ChatGPT Enterprise',
  enterprise: 'ChatGPT Enterprise',
  edu: 'ChatGPT Edu',
};

export function codexLimitsDiagnostic() { return diag; }
function fresh(value, observedAtMs, nowMs) {
  return observedAtMs !== null && nowMs - observedAtMs <= ACCOUNT_FACT_TTL_MS ? value : undefined;
}

function clearObservedCredits() {
  observedCreditUnlimited = undefined;
  observedCreditUnlimitedAtMs = null;
  observedHasCredits = undefined;
  observedHasCreditsAtMs = null;
  observedCreditBalance = undefined;
  observedCreditBalanceAtMs = null;
  observedResetCreditsAvailable = undefined;
  observedResetCreditsAvailableAtMs = null;
}

export function codexPlanLabel(nowMs = Date.now()) {
  const planType = fresh(observedPlanType, observedPlanAtMs, nowMs);
  return planType ? PLAN_LABELS[planType] : 'Plan unavailable';
}

// Account-wide facts observed on the live app-server response. Callers get a
// fresh, bounded object so the module-level sparse-update cache cannot be
// mutated from outside this module.
export function codexAccountFacts(nowMs = Date.now()) {
  const planType = fresh(observedPlanType, observedPlanAtMs, nowMs);
  const unlimited = fresh(observedCreditUnlimited, observedCreditUnlimitedAtMs, nowMs);
  const hasCredits = fresh(observedHasCredits, observedHasCreditsAtMs, nowMs);
  const balance = fresh(observedCreditBalance, observedCreditBalanceAtMs, nowMs);
  const resetCreditsAvailable = fresh(observedResetCreditsAvailable, observedResetCreditsAvailableAtMs, nowMs);
  const status = unlimited === true
    ? 'unlimited'
    : hasCredits === true
      ? 'available'
      : hasCredits === false
        ? 'none'
        : null;
  return {
    scope: 'account-wide',
    plan: {
      available: planType != null,
      label: planType ? PLAN_LABELS[planType] : null,
    },
    credits: {
      available: status !== null
        || balance != null
        || resetCreditsAvailable != null,
      status,
      balance: balance ?? null,
      resetCreditsAvailable: resetCreditsAvailable ?? null,
    },
  };
}

// The rate-limit response is the authority for the plan attached to these
// quota windows. Keep the last recognized value because Codex documents this
// metadata as nullable during rolling updates; a missing field must not erase a
// plan we already observed, and an unknown value must never invent a tier.
function observePlanType(rl) {
  if (!rl || typeof rl !== 'object') return null;
  const raw = rl.planType ?? rl.plan_type;
  const normalized = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  // A missing/null/empty value is a sparse update and preserves the last known
  // tier. A nonempty unknown enum is an explicit value, so clear the stale tier
  // instead of continuing to present it as current.
  if (!normalized) return null;
  const recognized = Object.hasOwn(PLAN_LABELS, normalized);
  if (recognized) {
    if (observedPlanType !== null && observedPlanType !== normalized) clearObservedCredits();
    observedPlanType = normalized;
    observedPlanAtMs = Date.now();
  } else {
    observedPlanType = null;
    observedPlanAtMs = null;
    clearObservedCredits();
  }
  return recognized ? normalized : null;
}

function boundedBalance(raw) {
  if (typeof raw !== 'string') return undefined;
  // Control, format/bidi, and Unicode line-separator characters have no
  // semantic value in an opaque balance and can visually reorder neighboring
  // account facts even after correct HTML escaping.
  const cleaned = raw.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').trim();
  if (!cleaned) return null;
  return [...cleaned].slice(0, 64).join('');
}

function observeAccountFacts(result, rl) {
  const observedAtMs = Date.now();
  if (rl && typeof rl === 'object') {
    const credits = rl.credits;
    if (credits && typeof credits === 'object' && !Array.isArray(credits)) {
      if (credits.unlimited === true || credits.unlimited === false) {
        observedCreditUnlimited = credits.unlimited;
        observedCreditUnlimitedAtMs = observedAtMs;
      }
      if (credits.hasCredits === true || credits.hasCredits === false) {
        observedHasCredits = credits.hasCredits;
        observedHasCreditsAtMs = observedAtMs;
      }
      const balance = boundedBalance(credits.balance);
      if (balance !== undefined) {
        observedCreditBalance = balance;
        observedCreditBalanceAtMs = observedAtMs;
      }
    }
  }

  if (!result || typeof result !== 'object') return;
  const resetCredits = result.rateLimitResetCredits ?? result.rate_limit_reset_credits;
  if (!resetCredits || typeof resetCredits !== 'object' || Array.isArray(resetCredits)) return;
  const count = resetCredits.availableCount ?? resetCredits.available_count;
  if (typeof count === 'number' && Number.isFinite(count) && Number.isInteger(count) && count >= 0) {
    observedResetCreditsAvailable = Math.min(1_000_000, count);
    observedResetCreditsAvailableAtMs = observedAtMs;
  }
}

// Record a spawn failure and log it ONCE per distinct cause (not every poll
// interval) — per the "surface it in the startup log, never silently" rule.
function noteSpawnFailure(code) {
  const detail = code || 'spawn failed';
  spawnFailedThisRead = true;
  diag = { reason: 'codex-cmd-failed', cmd: config.codexCmd, detail };
  const key = `${config.codexCmd}:${detail}`;
  if (loggedKey === key) return;
  loggedKey = key;
  console.error(`codex limits: cannot run "${config.codexCmd}" (${detail}) — live Codex limits are unavailable. Set LLMDASH_CODEX_CMD to the absolute path from 'which codex' and restart (the macOS installer does this when re-run).`);
}

// Map one Codex rate-limit window object to our {usedPct, resetsAt} shape.
// Codex field names vary by version, so accept the common spellings.
function mapWindow(w) {
  if (!w) return null;
  const used = w.used_percent ?? w.usedPercent ?? w.used_percentage ?? w.utilization;
  const usedNum = Number(used);
  if (!Number.isFinite(usedNum)) return null;
  // Clamp to 0–100 so malformed/hostile local data can't pollute snapshots or projections.
  return { usedPct: Math.min(100, Math.max(0, usedNum)), resetsAt: toIso(w.resets_at ?? w.resetsAt) };
}

function windowsFromRateLimits(rl) {
  if (!rl || typeof rl !== 'object') return null;
  const five = mapWindow(rl.primary ?? rl.five_hour ?? rl.fiveHour);
  const seven = mapWindow(rl.secondary ?? rl.seven_day ?? rl.sevenDay ?? rl.weekly);
  const windows = {};
  if (five) windows.five_hour = five;
  if (seven) windows.seven_day = seven;
  return Object.keys(windows).length ? windows : null;
}

// Path A: ask the live Codex app-server over JSON-RPC (on-demand, authoritative).
// Spawns `codex app-server`, does the initialize handshake, requests rate limits,
// and resolves null on any failure (so the dashboard degrades gracefully).
function readViaAppServer() {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(config.codexCmd, ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (e) {
      noteSpawnFailure(e && e.code);
      return resolve(null);
    }
    let buf = '';
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        child.kill(); // SIGTERM, then SIGKILL if it ignores it
        const k = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 1000);
        if (k.unref) k.unref();
      } catch {}
      resolve(val);
    };
    const timer = setTimeout(() => finish(null), config.codexAppServerTimeoutMs);
    child.on('error', (e) => { noteSpawnFailure(e && e.code); finish(null); });
    child.on('exit', () => finish(null));
    child.stdout.on('data', (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        const result = msg && msg.result;
        const rl = result && (result.rateLimits || result.rate_limits || result);
        const planType = observePlanType(rl);
        observeAccountFacts(result, rl);
        const windows = windowsFromRateLimits(rl);
        if (windows) {
          finish({ source: 'codex', capturedAt: new Date().toISOString(), windows, ...(planType ? { planType } : {}) });
        }
      }
    });
    try {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'llmdash', version: '0.1.0' } } }) + '\n');
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'account/rateLimits/read', params: {} }) + '\n');
    } catch {
      finish(null);
    }
  });
}

// Path B: the newest rollout file's latest token_count.rate_limits (a local cache
// Codex writes as it runs). Empty until Codex has recorded sessions.
function readViaRollout() {
  const files = [];
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else if (e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) {
        let st; try { st = fs.statSync(fp); } catch { continue; }
        files.push({ fp, mtime: st.mtimeMs });
      }
    }
  };
  walk(config.codexSessionsDir);
  if (!files.length) return null;
  files.sort((a, b) => b.mtime - a.mtime);
  let content; try { content = fs.readFileSync(files[0].fp, 'utf8'); } catch { return null; }
  const lines = content.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    let o; try { o = JSON.parse(lines[i]); } catch { continue; }
    const rl = o.rate_limits || (o.payload && o.payload.rate_limits) || (o.token_count && o.token_count.rate_limits);
    const planType = observePlanType(rl);
    const windows = windowsFromRateLimits(rl);
    if (windows) {
      return {
        source: 'codex',
        capturedAt: o.timestamp ? toIso(o.timestamp) : new Date().toISOString(),
        windows,
        ...(planType ? { planType } : {}),
      };
    }
  }
  return null;
}

// Prefer the live app-server; fall back to the rollout cache; null if neither.
export async function readCodexLimits() {
  spawnFailedThisRead = false;
  const live = await readViaAppServer();
  if (live) {
    // Live path works again — clear the diagnostic and re-arm the one-time log.
    diag = { reason: 'ok', cmd: config.codexCmd, detail: null };
    loggedKey = '';
    return live;
  }
  // Keep a spawn-failure diagnostic (the actionable cause) over a generic
  // "no reading" — the rollout fallback may still supply (possibly stale) data.
  if (!spawnFailedThisRead) diag = { reason: 'no-reading', cmd: config.codexCmd, detail: null };
  return readViaRollout();
}
