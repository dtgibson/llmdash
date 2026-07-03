#!/usr/bin/env node
// llmdash — SwiftBar/xbar menu-bar badge plugin.
//
// A PURE CONSUMER of the dashboard's existing /api/state payload: one loopback
// GET per host tick, no second data path, no limit recomputation. It reads
// remainingPct (already clamped 0–100 server-side), resetsAt, capturedAt,
// freshness, and limitsDiagnostic as given, and does only the presentation math
// the web client already does (min remaining, the freshness band from the
// server-supplied thresholds, countdown formatting). Zero runtime dependencies:
// Node builtins only (node:http), no build step.
//
// Rendered by a user-installed menu-bar host (SwiftBar is the documented
// default; xbar works too). The filename encodes the refresh interval
// (llmdash.5s.js = re-run every 5s). See README "Menu-bar badge (SwiftBar)".
//
// INSTALLED-ARTIFACT NOTE: the host spawns this under a minimal PATH, so an
// installed copy needs an ABSOLUTE node path baked into line 1 (the checked-in
// #!/usr/bin/env node above is for dev-on-PATH use). scripts/install-macos.sh
// --setup-badge resolves node and rewrites the shebang; it fails loudly if node
// can't be resolved — never a silently dead badge.
//
// This file is an ES module (the repo's package.json declares "type":"module",
// and the SwiftBar/xbar interval convention fixes the .js extension); it is
// Node-builtins-only either way.

import http from 'node:http';
// Builtins for the live launchd-state read (menubar-service-controls). All
// node: builtins — the zero-dep / no-build constitution is preserved.
import { existsSync as _existsSync } from 'node:fs';
import { execFileSync as _execFileSync } from 'node:child_process';
import { userInfo as _userInfo } from 'node:os';
const _userUid = () => String(_userInfo().uid);

// ── CONFIG (the only config surface) ────────────────────────────────────────
// HOST defaults to loopback (badge and dashboard on the same Mac) but is
// configurable to a tailnet host/IP so the badge can read a dashboard running
// on ANOTHER machine — still the same /api/state contract, never a second data
// source. Ratified Stage 4. Multi-host (a host LIST) is a deferred follow-on.
// Edit the constants below once, or set the env vars if your host passes them.
export const HOST = process.env.LLMDASH_BADGE_HOST || '127.0.0.1';
export const PORT = process.env.LLMDASH_PORT || '8787';
export const FETCH_TIMEOUT_MS = 2000; // a hung fetch must never freeze the menu bar

// ── PURE PRESENTATION HELPERS ───────────────────────────────────────────────
// fmtDur / ageBand are copied VERBATIM from public/app.js (the plugin can't
// import browser JS). tests/menubar-parity.test.js asserts they stay in
// lockstep so the badge never silently diverges from the dashboard's honesty.

// remaining % → status band, VERBATIM from public/app.js `statusClass`.
export const statusClass = (rem) => (rem >= 50 ? 'good' : rem >= 20 ? 'warn' : 'crit');

// fmtDur — VERBATIM from public/app.js.
export function fmtDur(ms) {
  if (ms == null) return '—';
  if (ms <= 0) return 'now';
  const mins = Math.floor(ms / 60000), d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  if (d > 0) return d + 'd ' + h + 'h';
  if (h > 0) return h + 'h ' + m + 'm';
  return m + 'm';
}

// ageBand — VERBATIM from public/app.js. Thresholds are server-supplied on the
// freshness object; never hardcoded. Null freshness (Codex) → no band.
export function ageBand(f) {
  if (!f || !f.capturedAt) return null;
  const age = Date.now() - Date.parse(f.capturedAt);
  if (!Number.isFinite(age)) return null;
  if (age > f.staleAfterMs) return 'stale';
  if (age > f.freshForMs) return 'aging';
  return 'fresh';
}

// The menu-bar analogue of app.js's esc(): a SwiftBar/xbar line uses `|` to open
// its param list and newlines to end the line, so any free-form payload text
// (cmd, detail) must have those stripped before it touches a line. Never a
// shell string — the plugin spawns nothing.
export function sanitize(s) {
  return String(s).replace(/[|\r\n]/g, ' ');
}

// host/port sanitizer for the URL/href surface. Stricter than sanitize(): a
// SwiftBar param list is SPACE-separated (`key=value key=value`), so a value on
// the `Open dashboard | href=…` line that carries a raw space could smuggle a
// second param — a clickable `bash=`/`shell=` action. sanitize() turns `|` into
// a space and leaves existing spaces, which is fine for free-form *text* (no
// `=` → no recognized param) but not for a value the operator supplies verbatim
// into the href. A real host/IP and port never contain whitespace or SwiftBar
// metacharacters, so strip them entirely. LLMDASH_BADGE_HOST is local operator
// env (same authority that could run anything) — this is defense-in-depth /
// internal consistency with the detail sanitize, and future-proofs the
// deferred host-list, not a trust-boundary fix.
export function sanitizeHostPort(s) {
  return String(s).replace(/[\s|]/g, '');
}

// Diagnostic reason code → one fixed honest line. Own-key (hasOwnProperty)
// lookup only, mirroring the shipped convention: a plain LINES[reason] would
// also hit inherited Object keys ('constructor', '__proto__', …) and bypass the
// generic fallback. Copy mirrors limitsNoteHtml's semantics (not its HTML).
export const DIAG_LINES = {
  'auto-refresh-failing': () => 'Auto-refresh is failing — open a Claude Code CLI session to refresh manually.',
  'auto-refresh-disabled': () => 'Auto-refresh is off (LLMDASH_CLAUDE_AUTOREFRESH=0) — unset it to re-enable, or open a Claude Code CLI session.',
  'stale-reading': () => 'Stale reading — the limits may have moved since; open a Claude Code CLI session to refresh.',
  'no-statusline-reading': () => 'No statusline reading yet — open a Claude Code CLI session to capture the first reading.',
  'codex-cmd-failed': (d) => 'The codex command couldn’t be run — set LLMDASH_CODEX_CMD to the absolute path and restart.'
    + (d && d.detail ? ` (${sanitize(d.detail)})` : ''),
  'no-reading': () => 'No Codex limit reading yet.',
};
export const DIAG_FALLBACK = 'Limit reading unavailable.';

export function diagLine(d) {
  if (!d || !d.reason) return null;
  const fn = Object.prototype.hasOwnProperty.call(DIAG_LINES, d.reason)
    ? DIAG_LINES[d.reason] : null;
  return fn ? fn(d) : DIAG_FALLBACK;
}

// ── computeBadge — pure, testable ───────────────────────────────────────────
// Turns an /api/state object into { state, pct, cue, binding, toolViews }.
// Never re-derives limits; never fabricates a number. The five states:
//   fresh | aging | stale | no-reading | offline
// (offline is produced by main() on a fetch/parse failure, not here.)
const WINDOWS = [['five_hour', '5-hour'], ['seven_day', 'Weekly']];
const BAND_RANK = { fresh: 0, aging: 1, stale: 2 };

export function computeBadge(state) {
  const tools = (state && Array.isArray(state.tools)) ? state.tools : [];

  // Per-tool: its ageBand (null for Codex / no freshness), its rows, its diag.
  const toolViews = tools.map((t) => {
    const band = ageBand(t.freshness);
    const cue = t.source === 'codex' ? 'X' : 'C'; // C=Claude, X=codeX
    const rows = WINDOWS.map(([key, label]) => {
      const win = t.limits ? t.limits[key] : null;
      if (win == null) {
        return { label, remaining: null, resetsAt: null, maxed: false };
      }
      return {
        label,
        remaining: Math.floor(win.remainingPct),
        resetsAt: win.resetsAt || null,
        maxed: win.remainingPct <= 0,
      };
    });
    return { label: t.label, source: t.source, cue, band, rows, diag: diagLine(t.limitsDiagnostic) };
  });

  // The binding window: lowest remainingPct across ALL windows-with-a-reading,
  // both tools × both windows (FR-07). Null windows are excluded from the min.
  let binding = null; // { pct, tool, windowLabel }
  for (const tv of toolViews) {
    for (const row of tv.rows) {
      if (row.remaining == null) continue;
      if (binding == null || row.remaining < binding.pct) {
        binding = { pct: row.remaining, tool: tv, windowLabel: row.label };
      }
    }
  }

  if (binding == null) {
    // No window on either tool has a reading → honest no-data (a dash, never a
    // number, no tool cue). The dropdown still explains why per tool.
    return { state: 'no-reading', pct: null, cue: null, binding: null, toolViews };
  }

  // The glyph's governing band is the binding tool's band. If that tool has no
  // band (Codex, freshness:null), fall back to the freshest applicable tool
  // band (fresh < aging < stale) — so an aging/stale sibling still marks the
  // glyph rather than reading confidently fresh.
  let band = binding.tool.band;
  if (band == null) {
    for (const tv of toolViews) {
      if (tv.band == null) continue;
      if (band == null || BAND_RANK[tv.band] > BAND_RANK[band]) band = tv.band;
    }
  }
  const glyphState = band === 'stale' ? 'stale' : band === 'aging' ? 'aging' : 'fresh';

  return {
    state: glyphState,
    pct: binding.pct,
    cue: binding.tool.cue,
    binding: { toolLabel: binding.tool.label, windowLabel: binding.windowLabel, band },
    toolViews,
  };
}

// ── HOST-LEVEL diagnostics (multi-host) — own-key mapped, detail sanitized ───
// A HostReading with reachable:false / state:null carries a hostDiagnostic. Map
// its reason to a fixed honest line naming WHICH host and WHY — own-key lookup
// (hasOwnProperty), the same discipline as DIAG_LINES, so an inherited-key reason
// can't bypass the fallback. Copy verbatim from the design spec's per-host table.
// The reserved codes auto-refresh-failing/auto-refresh-disabled are NOT reused
// here (they are tool-level Claude codes). label/host/detail are sanitize()d by
// the caller before this builds the line; addr is sanitizeHostPort()'d there too.
export const HOST_DIAG_LINES = {
  'peer-unreachable': (label, addr) =>
    `${label} is unreachable — no response within 3s. Check the machine is awake and llmdash is running on ${addr}. Its limits aren't shown while it's offline; the other machines are unaffected.`,
  'peer-error': (label, addr, cause) =>
    `${label} returned an error${cause ? ` (${cause})` : ''}.`,
  'pending': (label) =>
    `${label} — not polled yet; fills in on the next update.`,
};
export const HOST_DIAG_FALLBACK = (label) => `${label} is unavailable.`;

export function hostDiagLine(label, addr, d) {
  if (!d || !d.reason) return null;
  const fn = Object.prototype.hasOwnProperty.call(HOST_DIAG_LINES, d.reason)
    ? HOST_DIAG_LINES[d.reason] : null;
  const cause = d.cause ? sanitize(d.cause) : '';
  return fn ? fn(label, addr, cause) : HOST_DIAG_FALLBACK(label);
}

// ── computeMultiBadge — the HOST axis over computeBadge (FR-07/08/13/19) ──────
// Wraps the per-tool computeBadge with an outer HOST loop. Given the /api/hosts
// combined view, it returns:
//   { mode, state, pct, cue, hostCue, binding, hostViews }
//   mode = 'single' | 'multi'   ('single' when the effective host count === 1 →
//          the caller renders the EXISTING single-host glyph/dropdown byte-for-byte)
//   binding = the min remainingPct across HOST × tool × window WITH a reading
//             (no-reading hosts/windows excluded — never counted as 0; a maxed
//             window binds as "limit reached"); the binding host + tool + window.
//   hostCue = the binding host's short label (multi mode only), for the glyph.
//   hostViews = per-host { label, addr, self, reachable, hostDiag, badge (computeBadge
//               result or null), pending, deemph } in RENDER order (binding first).
//
// Monitoring-station de-emphasis (FR-19): with localMode 'auto' (default), when
// the LOCAL host has no readings (its computeBadge is no-reading) AND ≥1 remote is
// present, the local host is dropped from the binding-min search and the headline
// (it stays in the dropdown, dimmed, honestly labeled — FR-20). 'exclude' forces
// de-emphasis; 'include' forces the local host into the glyph/headline. Pure
// derivation over /api/hosts — no server field. localMode comes from the local
// HostReading's `localMode` echo (see fetchHosts) or defaults to 'auto'.
const HOST_CUE_MAX = 10; // truncate a long host label past 10 chars with '…'

function truncateHostCue(label) {
  const s = String(label == null ? '' : label);
  return s.length > HOST_CUE_MAX ? s.slice(0, HOST_CUE_MAX) + '…' : s;
}

export function computeMultiBadge(combined, { localMode = 'auto' } = {}) {
  const hostsIn = (combined && Array.isArray(combined.hosts)) ? combined.hosts : [];

  // Build a per-host view: the existing computeBadge over each host's nested
  // state (self reads its own state; a remote with state:null is offline/pending).
  const views = hostsIn.map((h) => {
    const label = sanitize(h.label != null ? h.label : (h.host || '')); // data → sanitized
    const addr = `${sanitizeHostPort(h.host)}:${sanitizeHostPort(h.port)}`;
    const badge = (h.state && Array.isArray(h.state.tools)) ? computeBadge(h.state) : null;
    // A host with no state is offline (reachable:false) or pending (seeded, not
    // yet polled). Prefer the explicit hostDiagnostic; synthesize 'pending' when a
    // seeded host has neither state nor diagnostic yet.
    let hostDiag = h.hostDiagnostic || null;
    if (!badge && !hostDiag && h.pending) hostDiag = { reason: 'pending' };
    // "Empty local" = self with a no-reading badge (all tools without a reading).
    const emptyLocal = !!h.self && badge != null && badge.state === 'no-reading';
    return {
      label, addr, self: !!h.self, reachable: h.reachable !== false,
      badge, hostDiag, pending: !!h.pending, emptyLocal,
      diagLine: hostDiag ? hostDiagLine(label, addr, hostDiag) : null,
    };
  });

  const effectiveCount = views.length;
  if (effectiveCount <= 1) {
    // Single-host / unconfigured → the EXISTING path, byte-for-byte (FR-13). The
    // caller unwraps hostViews[0].badge and runs the shipped emit. hostCue omitted.
    const only = views[0] || null;
    return {
      mode: 'single',
      state: only && only.badge ? only.badge.state : 'no-reading',
      pct: only && only.badge ? only.badge.pct : null,
      cue: only && only.badge ? only.badge.cue : null,
      hostCue: null, binding: null,
      hostViews: views,
    };
  }

  // Monitoring-station: decide whether the local host is de-emphasized (dropped
  // from the glyph/headline + binding-min search). Retained in the dropdown always.
  const localView = views.find((v) => v.self) || null;
  let deemphLocal = false;
  if (localView) {
    if (localMode === 'exclude') deemphLocal = true;
    else if (localMode === 'include') deemphLocal = false;
    else deemphLocal = localView.emptyLocal; // 'auto': de-emphasize an empty local
  }
  if (localView) localView.deemph = deemphLocal;

  // The binding: min remainingPct across HOST × tool × window with a reading,
  // over the hosts that count toward the glyph (all remotes + the local host
  // unless de-emphasized). A no-reading host contributes nothing (never 0).
  let binding = null; // { pct, view, toolLabel, windowLabel, band, maxed }
  for (const v of views) {
    if (v.self && deemphLocal) continue;      // de-emphasized local: out of the glyph
    if (!v.badge || v.badge.binding == null) continue; // no reading on this host
    const b = v.badge;
    if (binding == null || b.pct < binding.pct) {
      binding = {
        pct: b.pct, view: v,
        toolLabel: b.binding.toolLabel, windowLabel: b.binding.windowLabel,
        band: b.binding.band, cue: b.cue, state: b.state,
      };
    }
  }

  // RENDER order (design spec §3): binding host first, then the remaining
  // reachable hosts in config order, then offline/unreachable hosts, then the
  // de-emphasized local host pinned last.
  const bindingView = binding ? binding.view : null;
  const ordered = [];
  const rest = views.filter((v) => v !== bindingView);
  if (bindingView) ordered.push(bindingView);
  // reachable, non-deemph, has-a-reading (or at least reachable) first
  for (const v of rest) {
    if (v.self && v.deemph) continue;        // deemph local goes last
    if (!v.reachable || (!v.badge)) continue; // offline/no-state next batch
    ordered.push(v);
  }
  for (const v of rest) {                     // offline / unreachable hosts
    if (v.self && v.deemph) continue;
    if (v.reachable && v.badge) continue;     // already placed
    ordered.push(v);
  }
  const deemphView = views.find((v) => v.self && v.deemph);
  if (deemphView) ordered.push(deemphView);   // de-emphasized local pinned last

  if (binding == null) {
    // No host on any counted machine has a reading → no-reading glyph (a dash),
    // never a number, no host cue (design spec: multi · no-reading = `▪ —`).
    return {
      mode: 'multi', state: 'no-reading', pct: null, cue: null, hostCue: null,
      binding: null, hostViews: ordered,
    };
  }

  return {
    mode: 'multi',
    state: binding.state,               // the binding host's glyph band (fresh/aging/stale)
    pct: binding.pct,
    cue: binding.cue,                   // binding tool cue (C/X)
    hostCue: truncateHostCue(binding.view.label), // binding host's short label (≤10 + …)
    binding: {
      hostLabel: binding.view.label,
      toolLabel: binding.toolLabel,
      windowLabel: binding.windowLabel,
      band: binding.band,
    },
    hostViews: ordered,
  };
}

// ── emit — SwiftBar/xbar stdout (the host format) ───────────────────────────
// Title line, then `---`, then dropdown lines. Glyph honesty is carried by
// text/emoji + color= (xbar-safe floor); never depends on a SwiftBar-only
// param. Two structural never-do rules: no number is ever emitted in offline
// (the offline branch has no number path); no-reading shows `▪ —`, not a number.

const MARK = '▪'; // stable llmdash identity mark
const WARN_TRIANGLE = '⚠';
const AGE_DOT = '·';
const DASH = '—';

// Menu-bar (dark strip) status colors — lifted variants of the design-system
// good/warn/crit hues for contrast on a dark bar (per design-spec).
const BAR_COLOR = { good: '#5bd88a', warn: '#f0a94b', crit: '#ff6b6b' };
const COLOR_AGING = '#a0a0a0';
const COLOR_STALE = '#f0a94b';
const COLOR_MUTED = '#9b9ea6';
const COLOR_OFFLINE = '#8b8b8b';

export function baseUrl(host, port) {
  return `http://${sanitizeHostPort(host)}:${sanitizeHostPort(port)}/`;
}

// Dropdown for a normal (non-offline) badge: title echo → per-tool groups →
// diagnostics → actions. host/port drive the Open-dashboard href so the link
// matches what the badge reads.
function dropdownLines(badge, host, port, serviceState = 'not-installed') {
  const lines = [];

  // Title echo line — repeats the glyph with the binding tool·window (and band
  // when degraded), mirroring SwiftBar's natural top-of-dropdown title.
  if (badge.state === 'no-reading') {
    lines.push(`${MARK} no reading yet`);
  } else {
    const b = badge.binding;
    const bindingCue = `${b.toolLabel} · ${b.windowLabel}`
      + (b.band === 'aging' || b.band === 'stale' ? ` · ${b.band}` : '');
    lines.push(`${MARK} ${badge.pct}% remaining — ${bindingCue}`);
  }

  const diagBlock = [];
  for (const tv of badge.toolViews) {
    lines.push('---'); // group separator
    const tag = tv.band === 'aging' ? '  (aging)' : tv.band === 'stale' ? '  (stale)' : '';
    lines.push(`${tv.label}${tag} | size=13 color=#888888`);
    for (const row of tv.rows) {
      let text;
      if (row.remaining == null) {
        text = `${row.label}:  not available`;
      } else if (row.maxed) {
        const resetIn = row.resetsAt ? fmtDur(Date.parse(row.resetsAt) - Date.now()) : fmtDur(null);
        text = `${row.label}:  limit reached · resets ${resetIn}`;
      } else {
        const resetIn = row.resetsAt ? fmtDur(Date.parse(row.resetsAt) - Date.now()) : fmtDur(null);
        text = `${row.label}:  ${row.remaining}% · resets ${resetIn}`;
      }
      lines.push(`${text} | font=Menlo`);
    }
    if (tv.diag) diagBlock.push(`${tv.diag} | size=12 color=${COLOR_STALE}`);
  }

  if (diagBlock.length) {
    lines.push('---');
    for (const dl of diagBlock) lines.push(dl);
  }

  // The service toggle + host-config + Uninstall action cluster rides the single-
  // host dropdown too (menubar-service-controls): the service toggle and the
  // Uninstall submenu are reachable on a fresh single-host machine, and the FIRST
  // host is still addable here. Live service state is read in this render process,
  // off the request path. The glyph + per-tool rows above stay today's badge.
  for (const l of actionClusterLines({ serviceState, remotes: [] })) lines.push(l);

  lines.push('---');
  lines.push(`Open dashboard | href=${baseUrl(host, port)}`);
  lines.push('Refresh | refresh=true');
  return lines;
}

// The offline dropdown: no number anywhere, names the unreachable host:port,
// and still offers the Open-dashboard/Refresh actions.
function offlineLines(host, port) {
  return [
    '---',
    `Dashboard offline — no server on ${sanitizeHostPort(host)}:${sanitizeHostPort(port)}`,
    `Open dashboard | href=${baseUrl(host, port)}`,
    'Refresh | refresh=true',
  ];
}

export function emit(badge, { host = HOST, port = PORT, offline = false, serviceState = 'not-installed' } = {}) {
  if (offline) {
    // OFFLINE — never a number, no tool cue. Wordmark + slash marker, dimmed.
    const title = `${MARK} llmdash ${WARN_TRIANGLE} | color=${COLOR_OFFLINE}`;
    return [title, ...offlineLines(host, port)].join('\n');
  }

  let title;
  switch (badge.state) {
    case 'no-reading':
      // A dash, NEVER a number, no tool cue.
      title = `${MARK} ${DASH} | color=${COLOR_MUTED}`;
      break;
    case 'stale':
      // Number tinted amber + trailing ⚠. Present but flagged.
      title = `${MARK} ${badge.cue} ${badge.pct}% ${WARN_TRIANGLE} | color=${COLOR_STALE}`;
      break;
    case 'aging':
      // Number KEEPS its status color; marked with a trailing · and dimmed.
      // The · is the load-bearing marker (reads in a monochrome bar); the dim
      // is secondary. color= carries the honest de-emphasis on the dark bar.
      title = `${MARK} ${badge.cue} ${badge.pct}%${AGE_DOT} | color=${COLOR_AGING}`;
      break;
    case 'fresh':
    default: {
      // Plain & confident: the number's own status color shows through.
      const color = BAR_COLOR[statusClass(badge.pct)];
      title = `${MARK} ${badge.cue} ${badge.pct}% | color=${color}`;
      break;
    }
  }
  return [title, ...dropdownLines(badge, host, port, serviceState)].join('\n');
}

// ── Multi-host dropdown + glyph (FR-07–FR-13, FR-19/20) ──────────────────────
// The badge dir (where host-config-action.mjs lives) — resolved from this file so
// the Add/Remove actions can shell to the sibling helper under $ABS_NODE. The
// installed wrapper passes the tracked plugin path as argv[1], so import.meta.url
// resolves to the tracked scripts/menubar dir where the helper also lives.
import { fileURLToPath as _fileURLToPath } from 'node:url';
import { dirname as _dirname } from 'node:path';
export const PLUGIN_DIR = (() => {
  try { return _dirname(_fileURLToPath(import.meta.url)); } catch { return '.'; }
})();
// The absolute node the wrapper baked (SwiftBar spawns under a minimal PATH where
// a bare "node" is dead). process.execPath is exactly that node — the same binary
// running this plugin — so the Add/Remove actions exec it against the helper.
export const ABS_NODE = process.execPath;
const HOST_CONFIG_ACTION = `${PLUGIN_DIR}/host-config-action.mjs`;
// The service/uninstall helper (menubar-service-controls) — a tracked sibling of
// this plugin, delivered by the SAME wrapper/absolute-node model. The service
// toggle + the Uninstall submenu shell to it under $ABS_NODE.
const SERVICE_CONTROL_ACTION = `${PLUGIN_DIR}/service-control-action.mjs`;

// ── Live launchd-state read (FR-04) — in the BADGE RENDER process, off the ─────
// request path (NFR-10). Cheap: fs.existsSync(plist) + one launchctl print. Never
// faked — the label word + suffix carry the honest state. Returns one of
// 'running' | 'stopped' | 'not-installed'. A read failure falls back to
// 'not-installed' (the safe, non-destructive label — offers Install, never Remove).
export const SERVICE_LABEL = process.env.LLMDASH_SERVICE_LABEL || 'com.llmdash.dashboard';
export function readServiceState({
  label = SERVICE_LABEL,
  plistPath = null,
  execFile = null,
} = {}) {
  const home = process.env.HOME || '';
  const laDir = process.env.LLMDASH_LAUNCH_AGENTS_DIR
    || (home ? `${home}/Library/LaunchAgents` : '');
  const plist = plistPath || (laDir ? `${laDir}/${label}.plist` : '');
  try {
    if (!plist || !_existsSync(plist)) return 'not-installed';
  } catch { return 'not-installed'; }
  // Bootstrapped into the user domain? `launchctl print gui/<uid>/<label>` exit 0.
  try {
    const uid = _userUid();
    const run = execFile || _execFileSync;
    run('/bin/launchctl', ['print', `gui/${uid}/${label}`], { stdio: 'ignore' });
    return 'running';
  } catch {
    return 'stopped'; // plist present but not bootstrapped
  }
}

// A per-host section: header (escaped label + binding/you pill + freshness/offline
// state) then the existing per-tool rows. Reuses dropdownLines' per-tool grammar
// per host. `isBinding` marks the glyph-driving host; `deemph` is the monitoring-
// station local host (dimmed + "no local activity" + the honest note, FR-20).
function hostSectionLines(view, { isBinding = false } = {}) {
  const lines = ['---'];
  // Host header: label, then a pill (binding / you), then a state suffix.
  let head = view.label;
  if (isBinding) head += '  ▸ binding';
  else if (view.self) head += '  · you';
  lines.push(`${head} | size=13 color=#cccccc`);

  if (view.self && view.deemph) {
    // De-emphasized local (monitoring station): the honest idle note, no fake
    // rows, no zeros — retained but out of the glance (FR-20). Copy verbatim.
    lines.push('no local activity | size=12 color=#888888');
    lines.push("This Mac isn't running Claude or Codex — it's watching the machines above. Kept out of the glyph so the machines you're watching stay loudest. No reading is fabricated. | size=11 color=#888888");
    return lines;
  }

  if (view.diagLine) {
    // Offline / error / pending host: the named line, never a fabricated zero.
    lines.push(`${view.diagLine} | size=12 color=${COLOR_STALE}`);
    return lines;
  }

  if (!view.badge) {
    // No state and no diagnostic (shouldn't happen post-normalize) — honest dash.
    lines.push(`no reading | size=12 color=${COLOR_MUTED}`);
    return lines;
  }

  // The existing per-tool rows, per host (5-hour / Weekly; not available / limit
  // reached / N% · resets …). Verbatim from dropdownLines' inner loop.
  const diagBlock = [];
  for (const tv of view.badge.toolViews) {
    const tag = tv.band === 'aging' ? '  (aging)' : tv.band === 'stale' ? '  (stale)' : '';
    lines.push(`${tv.label}${tag} | size=12 color=#999999`);
    for (const row of tv.rows) {
      let text;
      if (row.remaining == null) {
        text = `${row.label}:  not available`;
      } else if (row.maxed) {
        const resetIn = row.resetsAt ? fmtDur(Date.parse(row.resetsAt) - Date.now()) : fmtDur(null);
        text = `${row.label}:  limit reached · resets ${resetIn}`;
      } else {
        const resetIn = row.resetsAt ? fmtDur(Date.parse(row.resetsAt) - Date.now()) : fmtDur(null);
        text = `${row.label}:  ${row.remaining}% · resets ${resetIn}`;
      }
      lines.push(`${text} | font=Menlo`);
    }
    if (tv.diag) diagBlock.push(`${tv.diag} | size=11 color=${COLOR_STALE}`);
  }
  for (const dl of diagBlock) lines.push(dl);
  return lines;
}

// The Add / Remove / List actions (FR-14) — the ONE source of truth for the
// host-config affordance, called from BOTH the single-host and multi-host
// dropdowns so the first host is always addable from the menu bar. Each action
// shells to the tracked helper under $ABS_NODE (terminal=false windowless,
// refresh=true so the dropdown reflects the new list).
//
// `＋ Add host…` is ALWAYS present — on a fresh single-host machine (remotes=[])
// it is the ONLY way to add the first machine; omitting it there would defeat the
// feature's headline (add hosts from the statusbar). With no remotes we omit the
// Remove submenu (nothing to remove) and state the count honestly
// ("Watching: 0 other machines"). With remotes, Remove is a submenu of the
// REMOVABLE (non-self) hosts — the local host is never offered — and Watching
// counts them. `remotes` = [{label, key, addr}] from remotesFromCombined.
export function hostConfigActionLines({ remotes = [] } = {}) {
  const lines = ['---'];
  lines.push(`＋ Add host… | shell="${ABS_NODE}" param1="${HOST_CONFIG_ACTION}" param2=add terminal=false refresh=true`);
  if (remotes.length) {
    // Remove submenu: SwiftBar renders a nested item with a leading `--`. One item
    // per removable host; each passes the host KEY on ARGV (param3). The key is a
    // sanitized host:port identity — never a free-form label.
    lines.push('－ Remove host…');
    for (const r of remotes) {
      const label = sanitize(r.label);
      const key = sanitizeHostPort(r.key);
      lines.push(`--Stop watching ${label} (${r.addr}) | shell="${ABS_NODE}" param1="${HOST_CONFIG_ACTION}" param2=remove param3="${key}" terminal=false refresh=true`);
    }
    // A live listing of the current remote set (a real affordance, not a dead item).
    lines.push(`☰ Watching: ${remotes.length} other machine${remotes.length === 1 ? '' : 's'} | color=#999999`);
  } else {
    // Single-host: no remotes to remove; state the honest zero so the count line
    // is never a dead/absent affordance. Add host… above is the live path.
    lines.push('☰ Watching: 0 other machines | color=#999999');
  }
  return lines;
}

// The state-aware service toggle + the two-tier Uninstall submenu
// (menubar-service-controls, FR-01/FR-04/FR-09) — the ONE source of truth for the
// service/uninstall affordances, called from BOTH dropdownLines and
// multiDropdownLines so they show in single-host AND multi-host mode (like
// hostConfigActionLines). Each action shells to the tracked service-control helper
// under $ABS_NODE (terminal=false windowless, refresh=true). NO HTTP mutation.
//
// Returns { serviceLine, uninstallLines } so callers place them in the design order
// (service toggle FIRST, then the host-config actions, then the Uninstall submenu).
// `state` is the LIVE launchd state (running|stopped|not-installed), read in the
// badge render process off the request path (readServiceState). Injectable for tests.
export function serviceControlActionLines({ state = 'not-installed' } = {}) {
  // The state-aware service item. not-installed → Install (＋); running/stopped →
  // Remove (－) with a dim mono state suffix. The label word + suffix carry the
  // honest state (reads in a monochrome bar; xbar-safe) — never a status color.
  let serviceLine;
  if (state === 'not-installed') {
    serviceLine = `＋ Install the local service | shell="${ABS_NODE}" param1="${SERVICE_CONTROL_ACTION}" param2=install terminal=false refresh=true`;
  } else {
    const suffix = state === 'running' ? ' · running' : ' · stopped';
    serviceLine = `－ Remove the local service${suffix} | shell="${ABS_NODE}" param1="${SERVICE_CONTROL_ACTION}" param2=remove terminal=false refresh=true`;
  }
  // The Uninstall submenu (two tiers, SwiftBar nested items via leading `--`).
  // Tier 1 (badge only) is light; tier 2 (complete) carries its own `…` and its
  // own enumerated gate, so the two are never one accidental click apart.
  const uninstallLines = [
    '⊘ Uninstall llmdash…',
    `--▬ Remove the menu-bar badge only | shell="${ABS_NODE}" param1="${SERVICE_CONTROL_ACTION}" param2=remove-badge terminal=false refresh=true`,
    `--⊘ Uninstall llmdash completely… | shell="${ABS_NODE}" param1="${SERVICE_CONTROL_ACTION}" param2=uninstall terminal=false refresh=true`,
  ];
  return { serviceLine, uninstallLines };
}

// Emit the full service+host+uninstall action cluster in design order:
//   ---                                   (group separator)
//   ＋/－ <service toggle>                 (state-aware; leads the cluster)
//   ＋ Add host… / － Remove host… / ☰ Watching  (hostConfigActionLines)
//   ⊘ Uninstall llmdash…  ↳ two tiers     (the submenu, last)
// Shared by BOTH single-host and multi-host dropdowns so the affordances are
// structurally present in both. `serviceState` is injected by the caller from the
// live read; `remotes` drive the host-config lines.
export function actionClusterLines({ serviceState = 'not-installed', remotes = [] } = {}) {
  const { serviceLine, uninstallLines } = serviceControlActionLines({ state: serviceState });
  const lines = ['---', serviceLine];
  // hostConfigActionLines opens with its own '---'; we've already started the
  // group, so append its body without the leading separator (keep one group).
  const hostLines = hostConfigActionLines({ remotes });
  for (const l of hostLines) { if (l === '---') continue; lines.push(l); }
  for (const l of uninstallLines) lines.push(l);
  return lines;
}

// The multi-host dropdown: title echo (binding host · tool · window) + scope line,
// one section per host (binding first), then the actions, then the shipped
// Open-dashboard / Refresh. host/port drive the Open-dashboard href (THIS machine's
// loopback, never a peer's).
function multiDropdownLines(multi, host, port, remotes, serviceState = 'not-installed') {
  const lines = [];
  const reachableCount = multi.hostViews.length;
  const unreachable = multi.hostViews.filter((v) => !v.reachable || (!v.badge && !v.self)).length;

  if (multi.state === 'no-reading') {
    lines.push(`${MARK} no reading yet`);
  } else {
    const b = multi.binding;
    const bindingCue = `${b.hostLabel} · ${b.toolLabel} · ${b.windowLabel}`
      + (b.band === 'aging' || b.band === 'stale' ? ` · ${b.band}` : '');
    lines.push(`${MARK} ${multi.pct}% remaining — ${bindingCue}`);
  }
  const scope = `Watching ${reachableCount} machine${reachableCount === 1 ? '' : 's'}`
    + (unreachable ? ` · ${unreachable} not reachable` : '');
  lines.push(`${scope} | size=12 color=#999999`);

  const bindingView = multi.binding ? multi.hostViews[0] : null;
  for (const view of multi.hostViews) {
    for (const l of hostSectionLines(view, { isBinding: view === bindingView && !!multi.binding })) lines.push(l);
  }

  // The service toggle + host-config + Uninstall action cluster (both modes).
  for (const l of actionClusterLines({ serviceState, remotes })) lines.push(l);

  lines.push('---');
  lines.push(`Open dashboard | href=${baseUrl(host, port)}`);
  lines.push('Refresh | refresh=true');
  return lines;
}

// emitMulti — the multi-host title glyph + the multi-host dropdown. The glyph
// carries the host cue: `▪ <host>·<C|X> <pct>` in fresh/aging/stale; no-reading is
// `▪ —` (no host cue). Single-host mode is handled by the caller delegating to the
// shipped emit() — this is only ever called with mode:'multi'.
export function emitMulti(multi, { host = HOST, port = PORT, remotes = [], serviceState = 'not-installed' } = {}) {
  let title;
  const hc = multi.hostCue; // already truncated + sanitized
  switch (multi.state) {
    case 'no-reading':
      title = `${MARK} ${DASH} | color=${COLOR_MUTED}`;
      break;
    case 'stale':
      title = `${MARK} ${hc}${AGE_DOT}${multi.cue} ${multi.pct}% ${WARN_TRIANGLE} | color=${COLOR_STALE}`;
      break;
    case 'aging':
      title = `${MARK} ${hc}${AGE_DOT}${multi.cue} ${multi.pct}%${AGE_DOT} | color=${COLOR_AGING}`;
      break;
    case 'fresh':
    default: {
      const color = BAR_COLOR[statusClass(multi.pct)];
      title = `${MARK} ${hc}${AGE_DOT}${multi.cue} ${multi.pct}% | color=${color}`;
      break;
    }
  }
  return [title, ...multiDropdownLines(multi, host, port, remotes, serviceState)].join('\n');
}

// ── fetchState — one loopback GET, bounded by FETCH_TIMEOUT_MS ───────────────
// A function of (host, port) so a future multi-host build can map over a list.
// Any failure (non-200, timeout, connection error, bad JSON) rejects; main()
// maps every rejection to the offline state.
export function fetchState(host, port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host, port, path: '/api/state', timeout: FETCH_TIMEOUT_MS }, (res) => {
      if (res.statusCode !== 200) {
        res.resume(); // drain
        return reject(new Error(`status ${res.statusCode}`));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// ── fetchHosts — one loopback GET /api/hosts, bounded by FETCH_TIMEOUT_MS ─────
// The badge reads its LOCAL instance's combined multi-host view (the local machine
// already fanned out to the peers). Same hardened loopback shape as fetchState,
// path /api/hosts. Any failure → reject → main() maps it to the OFFLINE glyph (the
// local llmdash instance being unreachable — distinct from a single remote being
// down, which is a per-host dropdown line, never the glyph).
export function fetchHosts(host, port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host, port, path: '/api/hosts', timeout: FETCH_TIMEOUT_MS }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`status ${res.statusCode}`));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// The remote (non-self) host set for the Remove submenu + the Watching count,
// derived from the SAME /api/hosts combined view the badge already fetched — no
// second data path, no config-file read on the badge's render path. Each entry:
// { label, key (host:port identity), addr }. The local host is never included.
export function remotesFromCombined(combined) {
  const hostsIn = (combined && Array.isArray(combined.hosts)) ? combined.hosts : [];
  return hostsIn
    .filter((h) => !h.self)
    .map((h) => ({
      label: sanitize(h.label != null ? h.label : (h.host || '')),
      key: `${sanitizeHostPort(h.host)}:${sanitizeHostPort(h.port)}`,
      addr: `${sanitizeHostPort(h.host)}:${sanitizeHostPort(h.port)}`,
    }));
}

// The monitoring-station override echoed on the local HostReading, if the server
// ever surfaces it. It is a CLIENT-side derivation otherwise: default 'auto'. The
// badge reads a `localMode` field on the self host when present (a real knob wired
// through the file), else 'auto'. No fabricated field — absent → 'auto'.
export function localModeFromCombined(combined) {
  const hostsIn = (combined && Array.isArray(combined.hosts)) ? combined.hosts : [];
  const self = hostsIn.find((h) => h.self);
  const m = self && self.localMode;
  return (m === 'include' || m === 'exclude' || m === 'auto') ? m : 'auto';
}

// ── main ────────────────────────────────────────────────────────────────────
// Reads the LOCAL instance's combined /api/hosts view (the machine already fanned
// out to the peers) and renders the multi-host badge. When only the local host is
// effectively watched, computeMultiBadge returns mode:'single' and we delegate to
// the SHIPPED single-host emit() path byte-for-byte (FR-13). A failed /api/hosts
// fetch (local llmdash down) → the shipped offline glyph.
export async function main() {
  let combined;
  try {
    combined = await fetchHosts(HOST, PORT);
  } catch {
    // Local /api/hosts fetch failed / timed out / non-200 / bad JSON → offline.
    // Never a crash, never a fabricated number.
    process.stdout.write(emit(null, { host: HOST, port: PORT, offline: true }) + '\n');
    return;
  }
  try {
    // Live launchd state for THIS Mac's service, read once per render in this
    // (badge) process — never on the server's request path or poller (NFR-10). A
    // read failure falls back to 'not-installed' (the safe Install-offering label).
    let serviceState = 'not-installed';
    try { serviceState = readServiceState(); } catch { serviceState = 'not-installed'; }
    const localMode = localModeFromCombined(combined);
    const multi = computeMultiBadge(combined, { localMode });
    if (multi.mode === 'single') {
      // Single-host / unconfigured → byte-for-byte the shipped badge. Unwrap the
      // one host's state and run the EXISTING computeBadge/emit path unchanged.
      const only = (combined.hosts || []).find((h) => h && h.self) || (combined.hosts || [])[0];
      const state = only && only.state ? only.state : null;
      process.stdout.write(emit(computeBadge(state || { tools: [] }), { host: HOST, port: PORT, serviceState }) + '\n');
    } else {
      const remotes = remotesFromCombined(combined);
      process.stdout.write(emitMulti(multi, { host: HOST, port: PORT, remotes, serviceState }) + '\n');
    }
  } catch {
    // Last-resort guard: a thrown compute/emit still lands on offline rather than
    // crashing the plugin (which would show the host's own error).
    process.stdout.write(emit(null, { host: HOST, port: PORT, offline: true }) + '\n');
  }
}

// Run only when invoked as the plugin, not when imported by the test suite.
// Compare REAL paths: SwiftBar runs the plugin through a symlink in its plugin
// dir, and Node de-symlinks import.meta.url but not process.argv[1], so a plain
// string compare would never match under a symlink and main() would never fire
// (a blank badge). realpathSync on both sides collapses the symlink so the
// symlinked entry — the actual delivery path — still runs.
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
if (invokedDirectly()) {
  main();
}
