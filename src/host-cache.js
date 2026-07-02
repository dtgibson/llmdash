// In-memory per-host cache for the combined multi-host view. Process-lifetime
// module state (like claude-refresh's failure state) maintained by the interval
// poller and read — off the request path — by GET /api/hosts. Peers are NEVER
// persisted (cached-only, OQ-02): a reading survives only until the next poll
// attempt overwrites it. Nothing here touches SQLite.
//
// A HostReading entry (the wire shape for one host):
//   { host, label, port, self, reachable,
//     hostDiagnostic: null | { reason, cause, detail? },
//     fetchedAt,        // ISO — when this entry was last refreshed/attempted
//     state: null | { tools:[…], headroom, generatedAt }   // the /api/state shape
//   }

const cache = new Map(); // key (sanitizedHost:port | local:port) → HostReading
const order = [];        // key insertion order → stable host ordering in the view

// Upsert one host's reading. The poller calls this for the local host (from
// buildState(), self:true) and for each remote peer (success or named failure).
// Stable order: a key keeps its first-seen position so the eye learns each
// host's place (offline hosts are not sorted to the bottom).
export function setHost(key, reading) {
  if (!cache.has(key)) order.push(key);
  cache.set(key, reading);
}

// Register a key's ORDER position without touching an existing reading. Used to
// pin the host ordering to the configured list order (local first, then peers
// as listed) BEFORE the fan-out, so a fast-failing offline peer can't jump ahead
// of a slower-succeeding one by completion time. A key that already has a
// reading keeps it; a new key gets a placeholder until its first result lands.
export function seedOrder(entries) {
  for (const e of entries) {
    if (!cache.has(e.key)) {
      order.push(e.key);
      cache.set(e.key, {
        host: e.host, label: e.label, port: e.port, self: !!e.self,
        reachable: false, hostDiagnostic: null, fetchedAt: null, state: null,
        pending: true, // not yet polled — the health readout distinguishes this
      });
    }
  }
}

// Drop cache entries whose key is no longer in the effective host set (e.g. the
// operator removed a peer from LLMDASH_HOSTS and restarted — belt-and-braces;
// normally the process restarts). Keeps the view from showing a ghost host.
export function retainHosts(keys) {
  const keep = new Set(keys);
  for (const k of [...cache.keys()]) {
    if (!keep.has(k)) { cache.delete(k); const i = order.indexOf(k); if (i !== -1) order.splice(i, 1); }
  }
}

// The combined payload, assembled from cache — a pure read, no fetch, no
// subprocess, no blocking I/O. Safe on the request path.
export function getCombined(nowMs = Date.now()) {
  const hosts = order.map((k) => cache.get(k)).filter(Boolean);
  return { hosts, generatedAt: new Date(nowMs).toISOString() };
}

// Test/inspection helpers.
export function _peek(key) { return cache.get(key) || null; }
export function _reset() { cache.clear(); order.length = 0; }
