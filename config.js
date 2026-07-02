import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// config.js sits at the project root, so its directory is the root.
const root = path.dirname(fileURLToPath(import.meta.url));
const home = os.homedir();

// Claude statusline reading freshness threshold. Externally sourced, so it is
// clamped both ways: anything non-finite or ≤ 0 falls back to the default
// (5 minutes), and anything above 7 days clamps to 7 days — the derived 2×
// stale band must stay a finite number on the wire (a near-MAX_VALUE knob
// would overflow it to Infinity, which JSON-serializes as null).
const rawClaudeMaxAge = Number(process.env.LLMDASH_CLAUDE_MAX_AGE_MS);
const claudeMaxAgeMs = Number.isFinite(rawClaudeMaxAge) && rawClaudeMaxAge > 0
  ? Math.min(rawClaudeMaxAge, 604_800_000) // 7-day ceiling
  : 300_000;

export const config = {
  // Bind to 0.0.0.0 so the dashboard is reachable from other devices on the
  // tailnet. Tailscale (not the dashboard) is the access boundary.
  host: process.env.LLMDASH_HOST || '0.0.0.0',
  port: Number(process.env.LLMDASH_PORT || 8787),

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
