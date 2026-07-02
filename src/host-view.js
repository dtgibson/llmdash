// Pure, testable derivations for the multi-host client view. The client
// (public/app.js) can't import browser-external modules (no bundler), so the
// account-sameness logic is duplicated there VERBATIM; tests/hosts-account.test.js
// unit-tests THIS module, and tests/hosts-client.test.js locks app.js's copy in
// lockstep (the badge-parity discipline). Keeping the logic here means the
// detect-and-collapse rule is proven on real data, not just asserted by regex.
//
// Two machines on the SAME account share the same account-wide reset windows,
// so their per-window resetsAt epochs match; two DIFFERENT accounts have
// independent windows that (almost surely) don't. Bucketing by TOL absorbs
// clock skew / staggered captures so one account never splits into two.

export const ACCT_TOL_MS = 60_000; // one poll interval

// A tool's account-identity key: the pair of window reset epochs, bucketed by
// TOL. null when the tool has no usable limit reading (it can't be grouped).
export function accountKey(tool) {
  if (!tool || !tool.limits) return null;
  const epoch = (w) => {
    const win = tool.limits[w];
    if (!win || !win.resetsAt) return null;
    const ms = Date.parse(win.resetsAt);
    return Number.isFinite(ms) ? Math.round(ms / ACCT_TOL_MS) : null;
  };
  const fh = epoch('five_hour'), sd = epoch('seven_day');
  if (fh == null && sd == null) return null;
  return `${fh}|${sd}`;
}

// Group reachable hosts by account key, PER tool source. Returns source → Map
// (key → [{ host, tool }]). Only reachable hosts with a usable reading for that
// tool participate; an offline host or a no-reading tool never joins a group.
export function groupAccounts(hosts) {
  const bySource = {};
  for (const h of (hosts || [])) {
    if (!h.reachable || !h.state || !Array.isArray(h.state.tools)) continue;
    for (const tool of h.state.tools) {
      const key = accountKey(tool);
      if (key == null) continue;
      const src = tool.source;
      if (!bySource[src]) bySource[src] = new Map();
      if (!bySource[src].has(key)) bySource[src].set(key, []);
      bySource[src].get(key).push({ host: h, tool });
    }
  }
  return bySource;
}

// The set of keys (per source) that group ≥2 hosts → those are the shared,
// account-wide meters collapsed into the banner. Returns source → Set(keys).
export function sharedKeys(groups) {
  const out = {};
  for (const src of Object.keys(groups)) {
    out[src] = new Set();
    for (const [key, members] of groups[src]) if (members.length >= 2) out[src].add(key);
  }
  return out;
}

// Natural join (data-side; the client esc()'s each label before joining).
export function joinLabels(labels) {
  if (labels.length <= 1) return labels.join('');
  if (labels.length === 2) return `${labels[0]} & ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} & ${labels[labels.length - 1]}`;
}
