import { insertSnapshot } from './db.js';
import { readClaudeLimits } from './claude-limits.js';
import { maybeRefreshClaude } from './claude-refresh.js';
import { readCodexLimits } from './codex-limits.js';
import { computeActivity, clearStatsCache } from './stats.js';
import { computeCodexActivity, clearCodexStatsCache } from './codex-stats.js';
import { config } from '../config.js';
import { parseHosts, remoteHosts, fetchPeerState } from './hosts.js';
import { setHost, retainHosts, seedOrder } from './host-cache.js';
import { readHostsConfig } from './host-config.js';

function snapshot(live) {
  if (!live) return 0;
  let n = 0;
  for (const [window, w] of Object.entries(live.windows)) {
    if (insertSnapshot({ capturedAt: live.capturedAt, source: live.source, window, usedPct: w.usedPct, resetsAt: w.resetsAt })) n++;
  }
  return n;
}

// The local host's reading is taken IN-PROCESS (the same buildState() the local
// view serves), never fetched over HTTP from itself. Imported lazily to avoid a
// server↔poller import cycle (server.js imports startPoller from here).
//
// `parsed` is passed in (produced from the config FILE this tick, not
// config.hostsRaw directly), so the file-once-it-exists precedence is applied
// before the local host is written and the fan-out is computed. `localMode` is the
// !local= directive from the config file, echoed onto the LOCAL HostReading so the
// badge's monitoring-station override is a real knob (QA-19) — a pure config echo,
// no fabricated field; absent → 'auto' (the client default).
async function writeLocalHost(nowMs, parsed, localMode = 'auto') {
  const local = parsed.hosts.find((h) => h.self) || parsed.hosts[0];
  const { buildState } = await import('./server.js');
  let state = null;
  try { state = buildState(nowMs); } catch (e) { console.error('local buildState:', e.message); }
  setHost(local.key, {
    host: local.host, label: local.label, port: local.port, self: true,
    reachable: !!state, hostDiagnostic: state ? null : { reason: 'peer-error', cause: 'bad-json', detail: 'local build failed' },
    fetchedAt: new Date(nowMs).toISOString(),
    localMode: (localMode === 'include' || localMode === 'exclude' || localMode === 'auto') ? localMode : 'auto',
    state,
  });
}

// Bounded-concurrency fan-out over the REMOTE peers. Each fetch is timeout-
// bounded; a failure becomes a NAMED hostDiagnostic (never a fabricated zero,
// never stale-as-fresh — the prior entry is replaced by the failure). fetchImpl
// is injectable for tests.
export async function pollPeers(remotes, nowMs = Date.now(), fetchImpl = fetchPeerState) {
  const queue = [...remotes];
  const concurrency = Math.max(1, Math.min(config.peerConcurrency, queue.length || 1));
  const worker = async () => {
    for (;;) {
      const h = queue.shift();
      if (!h) return;
      const at = new Date(Date.now()).toISOString();
      let result;
      try { result = await fetchImpl(h.host, h.port, { timeoutMs: config.peerTimeoutMs, bodyCapBytes: config.peerBodyCapBytes }); }
      catch (e) { result = { ok: false, reason: 'peer-unreachable', cause: 'connect', detail: e && e.message }; }
      if (result && result.ok) {
        setHost(h.key, {
          host: h.host, label: h.label, port: h.port, self: false,
          reachable: true, hostDiagnostic: null, fetchedAt: at, state: result.state,
        });
      } else {
        setHost(h.key, {
          host: h.host, label: h.label, port: h.port, self: false,
          reachable: false,
          hostDiagnostic: {
            reason: (result && result.reason) || 'peer-unreachable',
            cause: (result && result.cause) || 'connect',
            ...(result && result.detail ? { detail: result.detail } : {}),
          },
          fetchedAt: at,
          state: null, // offline-only: no last-known meter, never stale-as-fresh
        });
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
}

// One poll: snapshot both tools' limits (deduped) and refresh both stat caches,
// then write the local host into the host-cache in-process and fan out to peers.
// Claude's reading is a cheap file read; Codex's is the app-server (or rollout
// cache), done here on the interval rather than per request.
export async function pollOnce() {
  const nowMs = Date.now();
  // Auto-refresh runs first so a probe capture lands in this same tick's
  // snapshot; its own gates decide whether any work happens at all.
  try { await maybeRefreshClaude(); } catch (e) { console.error('claude refresh:', e.message); }
  try { snapshot(readClaudeLimits()); } catch (e) { console.error('claude poll:', e.message); }
  try { snapshot(await readCodexLimits()); } catch (e) { console.error('codex poll:', e.message); }
  clearStatsCache();
  clearCodexStatsCache();
  try { computeActivity(); } catch {}
  try { computeCodexActivity(); } catch {}

  // Multi-host: local reading in-process, then the bounded peer fan-out. Peer
  // polling runs ONLY here (never on the HTTP request path). An empty peer list
  // (no hosts.conf, LLMDASH_HOSTS unset) issues no outbound fetch — single-host.
  //
  // The effective host set now comes from the config FILE (re-read each tick), not
  // config.hostsRaw directly: readHostsConfig applies the seed-once precedence
  // (file wins; env seeds the file when absent; neither = single-host) and degrades
  // honestly on an unreadable file (falls back to the last-good/env seed and logs
  // ONCE via its own latch — never crashes the poller). A LIVE file edit is thus
  // applied here: an added host is polled next tick; a removed host's cache entry
  // is dropped by retainHosts next tick (ghost cleanup on a file change mid-run).
  let parsed;
  try {
    const cfgRead = readHostsConfig(); // cheap fs read on the POLLER tick, never the request path
    parsed = parseHosts(cfgRead.raw);
    await writeLocalHost(nowMs, parsed, cfgRead.localMode);
  } catch (e) { console.error('local host:', e.message); }
  if (parsed) {
    // Pin the view ordering to the configured list order (local first, peers as
    // listed) BEFORE the fan-out, so a fast-failing offline peer can't jump
    // ahead of a slower-succeeding one by completion time.
    seedOrder(parsed.hosts);
    // retainHosts runs BEFORE pollPeers so a same-tick removal is never fetched,
    // and a peer dropped from the FILE mid-run has its cache entry cleaned here
    // (the ghost-cleanup path is now exercised on a live file edit, not only on a
    // process restart — the original "normally the process restarts" belt-and-
    // braces is the load-bearing runtime-apply half for the badge's Remove).
    retainHosts(parsed.hosts.map((h) => h.key));
    const remotes = remoteHosts(parsed);
    if (remotes.length) {
      try { await pollPeers(remotes, nowMs); } catch (e) { console.error('peer fan-out:', e.message); }
    }
  }
}

// Single-flight guard: a still-running fan-out from a slow prior tick must not
// be restarted, so in-flight fetches never accumulate across ticks (FR-08).
let inFlight = false;
export function startPoller() {
  const run = () => {
    if (inFlight) return; // a prior tick's fan-out is still draining — skip
    inFlight = true;
    pollOnce().catch((e) => console.error('poll error:', e.message)).finally(() => { inFlight = false; });
  };
  run();
  setInterval(run, config.pollIntervalMs);
}
