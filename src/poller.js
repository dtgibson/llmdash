import { insertSnapshot } from './db.js';
import { readClaudeLimits } from './claude-limits.js';
import { maybeRefreshClaude } from './claude-refresh.js';
import { readCodexLimits } from './codex-limits.js';
import { computeActivity, clearStatsCache } from './stats.js';
import { computeCodexActivity, clearCodexStatsCache } from './codex-stats.js';
import { config } from '../config.js';

function snapshot(live) {
  if (!live) return 0;
  let n = 0;
  for (const [window, w] of Object.entries(live.windows)) {
    if (insertSnapshot({ capturedAt: live.capturedAt, source: live.source, window, usedPct: w.usedPct, resetsAt: w.resetsAt })) n++;
  }
  return n;
}

// One poll: snapshot both tools' limits (deduped) and refresh both stat caches.
// Claude's reading is a cheap file read; Codex's is the app-server (or rollout
// cache), done here on the interval rather than per request.
export async function pollOnce() {
  // Auto-refresh runs first so a probe capture lands in this same tick's
  // snapshot; its own gates decide whether any work happens at all.
  try { await maybeRefreshClaude(); } catch (e) { console.error('claude refresh:', e.message); }
  try { snapshot(readClaudeLimits()); } catch (e) { console.error('claude poll:', e.message); }
  try { snapshot(await readCodexLimits()); } catch (e) { console.error('codex poll:', e.message); }
  clearStatsCache();
  clearCodexStatsCache();
  try { computeActivity(); } catch {}
  try { computeCodexActivity(); } catch {}
}

export function startPoller() {
  const run = () => { pollOnce().catch(e => console.error('poll error:', e.message)); };
  run();
  setInterval(run, config.pollIntervalMs);
}
