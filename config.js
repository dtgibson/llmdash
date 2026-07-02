import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// config.js sits at the project root, so its directory is the root.
const root = path.dirname(fileURLToPath(import.meta.url));
const home = os.homedir();

// A generic clamp-both-ways for an externally-sourced numeric knob: non-finite
// falls back to the default, otherwise it is pinned into [lo, hi]. Mirrors the
// discipline of the Claude knobs below (no dead knob, no unbounded value).
function clampedEnv(raw, def, lo, hi) {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : def;
}

// Claude statusline reading freshness threshold. Externally sourced, so it is
// clamped both ways: anything non-finite or ≤ 0 falls back to the default
// (5 minutes), and anything above 7 days clamps to 7 days — the derived 2×
// stale band must stay a finite number on the wire (a near-MAX_VALUE knob
// would overflow it to Infinity, which JSON-serializes as null).
const rawClaudeMaxAge = Number(process.env.LLMDASH_CLAUDE_MAX_AGE_MS);
const claudeMaxAgeMs = Number.isFinite(rawClaudeMaxAge) && rawClaudeMaxAge > 0
  ? Math.min(rawClaudeMaxAge, 604_800_000) // 7-day ceiling
  : 300_000;

// Claude auto-refresh probe timeout. Externally sourced, so it is clamped both
// ways: non-finite falls back to the default (30 s, generous — the prior spike
// saw the TUI ready in ~3–5 s and the /usage pane shortly after); floor 5 s
// (nothing renders faster), ceiling 5 minutes (a hung probe must never linger).
const rawRefreshTimeout = Number(process.env.LLMDASH_CLAUDE_REFRESH_TIMEOUT_MS);
const claudeRefreshTimeoutMs = Number.isFinite(rawRefreshTimeout)
  ? Math.min(Math.max(rawRefreshTimeout, 5_000), 300_000)
  : 30_000;

// Claude auto-refresh off-switch: on by default; ONLY "0" or "false" disable
// it. Any other value (including typos) leaves it on — opt-in would leave the
// gauges stale on exactly the desktop-app days the mechanism exists for.
const rawAutoRefresh = process.env.LLMDASH_CLAUDE_AUTOREFRESH;
const claudeAutoRefresh = !(rawAutoRefresh === '0'
  || (typeof rawAutoRefresh === 'string' && rawAutoRefresh.toLowerCase() === 'false'));

// Multi-host peer-fetch bounds. Each is a real knob that drives behavior (no
// dead knobs) and, being externally sourced, is clamped both ways like the
// Claude knobs above. Justified in pipeline/multi-host/schema.md §Timeout.
//   peerTimeoutMs     — per-peer fetch timeout, default 3s, clamp 0.5–30s.
//   peerConcurrency   — fan-out parallelism cap, default 4, clamp 1–32.
//   peerBodyCapBytes  — per-peer response byte cap, default 256 KiB,
//                       clamp 16 KiB–8 MiB (a peer is not trusted to send small).
const peerTimeoutMs = clampedEnv(process.env.LLMDASH_PEER_TIMEOUT_MS, 3000, 500, 30_000);
const peerConcurrency = clampedEnv(process.env.LLMDASH_PEER_CONCURRENCY, 4, 1, 32);
const peerBodyCapBytes = clampedEnv(process.env.LLMDASH_PEER_BODY_CAP_BYTES, 262_144, 16_384, 8_388_608);

export const config = {
  // Bind to 0.0.0.0 so the dashboard is reachable from other devices on the
  // tailnet. Tailscale (not the dashboard) is the access boundary.
  host: process.env.LLMDASH_HOST || '0.0.0.0',
  port: Number(process.env.LLMDASH_PORT || 8787),

  // Raw multi-host peer list (LLMDASH_HOSTS, format host[:port][=label], comma-
  // separated). The EFFECTIVE host set — the local host always prepended, plus
  // deduped remote peers — is produced by parseHosts() in src/hosts.js, which
  // reads this raw string and config.port. It lives there (not as a config
  // getter) to avoid a config↔hosts import cycle and to keep the parser purely
  // testable. Unset ⇒ parseHosts yields [local] ⇒ single-host behavior
  // identical to today (no dead knob: the value drives real polling + UI, or
  // when empty changes nothing). The three fetch bounds below drive the fan-out.
  hostsRaw: process.env.LLMDASH_HOSTS || '',
  peerTimeoutMs,
  peerConcurrency,
  peerBodyCapBytes,

  // Where Claude Code keeps its data on this machine.
  claudeDir: process.env.LLMDASH_CLAUDE_DIR || path.join(home, '.claude'),
  get projectsDir() { return path.join(this.claudeDir, 'projects'); },

  // Local storage for snapshots and the captured rate-limit reading.
  dataDir: process.env.LLMDASH_DATA_DIR || path.join(root, 'data'),
  get dbPath() { return path.join(this.dataDir, 'llmdash.db'); },
  // The Claude Code statusline script writes the latest rate-limit reading here.
  get rateLimitsFile() { return path.join(this.dataDir, 'claude-ratelimits.json'); },

  pollIntervalMs: Number(process.env.LLMDASH_POLL_MS || 60_000),
  dedupWindowMs: Number(process.env.LLMDASH_DEDUP_MS || 5 * 60_000),
  statsTtlMs: 30_000,
  uiRefreshMs: 60_000,

  // Claude reading-age bands: fresh ≤ claudeMaxAgeMs, aging up to 2×, stale
  // beyond that. One knob (LLMDASH_CLAUDE_MAX_AGE_MS, default 300000 = 5m);
  // the stale band is always derived as 2× — never independently configurable.
  claudeMaxAgeMs,
  get claudeStaleAfterMs() { return 2 * this.claudeMaxAgeMs; },

  // Claude auto-refresh: when the reading is stale during Claude activity, a
  // short-lived probe session runs /usage and captures the pane (never a
  // message, never plan usage). The command mirrors codexCmd: a service runs
  // under launchd's minimal PATH, so it may need an absolute path — the macOS
  // installer bakes one in.
  claudeCmd: process.env.LLMDASH_CLAUDE_CMD || 'claude',
  claudeRefreshTimeoutMs,
  claudeAutoRefresh,
  // The probe's fixed working directory — deliberately NOT configurable, and
  // install-independent (under ~/.llmdash/, outside any checkout) so dev and
  // installed copies share the ONE "trust this folder" entry ever created in
  // ~/.claude.json. Disclosed in the startup log and README.
  claudeRefreshCwd: path.join(home, '.llmdash', 'claude-refresh-cwd'),

  // Codex (ChatGPT Plus) — local data + how to read its limits.
  codexDir: process.env.LLMDASH_CODEX_DIR || path.join(home, '.codex'),
  get codexSessionsDir() { return path.join(this.codexDir, 'sessions'); },
  // Command to launch the Codex app-server (the live rate-limits read).
  // The systemd service may need an absolute path, e.g. /home/you/.local/bin/codex.
  codexCmd: process.env.LLMDASH_CODEX_CMD || 'codex',
  codexAppServerTimeoutMs: Number(process.env.LLMDASH_CODEX_TIMEOUT_MS || 8000),

  // Approximate pay-as-you-go Anthropic API rates, USD per 1M tokens. These back
  // the Claude "estimated value" stat. They are estimates — edit them freely.
  pricing: {
    opus:    { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
    sonnet:  { input: 3,  output: 15, cacheWrite: 3.75,  cacheRead: 0.3 },
    haiku:   { input: 1,  output: 5,  cacheWrite: 1.25,  cacheRead: 0.1 },
    default: { input: 3,  output: 15, cacheWrite: 3.75,  cacheRead: 0.3 },
  },

  // Approximate OpenAI API rates, USD per 1M tokens, for Codex's estimated value.
  // Separate table from Anthropic's. Estimates — edit freely.
  openaiPricing: {
    'gpt-5-codex': { input: 1.25, output: 10, cacheRead: 0.125 },
    'gpt-5':       { input: 1.25, output: 10, cacheRead: 0.125 },
    'o4-mini':     { input: 1.1,  output: 4.4, cacheRead: 0.275 },
    default:       { input: 1.25, output: 10, cacheRead: 0.125 },
  },
};
