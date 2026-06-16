import { insertSnapshot } from './db.js';
import { readClaudeLimits } from './claude-limits.js';
import { computeActivity, clearStatsCache } from './stats.js';
import { config } from '../config.js';

// One poll: persist the latest limit reading (deduped) and refresh stats.
export function pollOnce() {
  const live = readClaudeLimits();
  let written = 0;
  if (live) {
    for (const [window, w] of Object.entries(live.windows)) {
      if (insertSnapshot({
        capturedAt: live.capturedAt,
        source: live.source,
        window,
        usedPct: w.usedPct,
        resetsAt: w.resetsAt,
      })) written++;
    }
  }
  clearStatsCache();
  computeActivity(); // warm the cache so the next request is instant
  return written;
}

export function startPoller() {
  const run = () => { try { pollOnce(); } catch (e) { console.error('poll error:', e.message); } };
  run();
  setInterval(run, config.pollIntervalMs);
}
