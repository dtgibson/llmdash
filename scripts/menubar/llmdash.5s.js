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
import zlib from 'node:zlib';
// Builtins for the live launchd-state read (menubar-service-controls). All
// node: builtins — the zero-dep / no-build constitution is preserved.
import { existsSync as _existsSync, readFileSync as _readFileSync } from 'node:fs';
import { execFileSync as _execFileSync } from 'node:child_process';
import { userInfo as _userInfo } from 'node:os';
const _userUid = () => String(_userInfo().uid);

// The badge's display prefs (badge-display-options) live in hosts.conf alongside
// the watched-host list; the badge reads them on the render tick (off the request
// path). readDisplayConfig returns the five axes with defaults applied.
import { readDisplayConfig } from '../../src/host-config.js';

// ── TOOL MARKS (badge-display-options, round 2) — the ratified default cue ─────
// The neutral tool marks REPLACE the old C/X letters as the default tool cue,
// everywhere a tool is named (the wide per-host cue AND the per-tool aggregate).
// Distinct silhouettes (diamond vs triangle), solid, monochrome-legible at bar
// size. Text/emoji floor → xbar-safe. This is the ONE ratified break in the
// byte-for-byte-when-unconfigured guard (user-approved; see README + health).
export const TOOL_MARK = { claude: '◆', codex: '▲' };
// Map a tool source to its neutral mark. Codex → ▲, everything else (Claude) → ◆.
export function toolMark(source) {
  return source === 'codex' ? TOOL_MARK.codex : TOOL_MARK.claude;
}

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
    // The ratified neutral tool cue (badge-display-options): ◆ Claude / ▲ Codex,
    // replacing the old C/X letters everywhere the tool is named.
    const cue = toolMark(t.source);
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
  // Defensive re-sanitize (Auditor INFO-3): every current caller passes an
  // already-ingested (sanitize()'d) label, but scrubbing here too keeps a future
  // un-ingested caller from silently reopening the SwiftBar-grammar injection class
  // (strip `|`/CR/LF before a value reaches a line) — symmetry with growPrefixCues.
  const s = sanitize(String(label == null ? '' : label));
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
    cue: binding.cue,                   // binding tool cue (◆ Claude / ▲ Codex)
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
const HOST_TOOL_SEP = '·';
const AGE_CLOCK = '◷';
const DASH = '—';

// Menu-bar (dark strip) status colors — lifted variants of the design-system
// good/warn/crit hues for contrast on a dark bar (per design-spec).
const BAR_COLOR = { good: '#5bd88a', warn: '#f0a94b', crit: '#ff6b6b' };
const COLOR_AGING = '#a0a0a0';
const COLOR_STALE = '#f0a94b';
const COLOR_MUTED = '#9b9ea6';
const COLOR_OFFLINE = '#8b8b8b';
const COLOR_DROPDOWN_TEXT = '#111111';
const COLOR_DROPDOWN_HEADER = '#1f1f1f';
const COLOR_DROPDOWN_SUBTLE = '#333333';
const COLOR_DROPDOWN_DEEMPH = '#4a4a4a';
const DROPDOWN_STATE_COLOR = {
  good: '#17783c',
  warn: '#8a5a00',
  crit: '#b3261e',
  aging: '#4a4a4a',
  stale: '#8a5a00',
  muted: '#3f4754',
  offline: '#444444',
};
const DROPDOWN_WRAP_CHARS = 72;
const DROPDOWN_HEADER_SIZE = 14;
const DROPDOWN_BODY_SIZE = 13;
const DROPDOWN_NOTE_SIZE = 12;
const DROPDOWN_SECTION_SIZE = 12;
const DROPDOWN_NOOP_ACTION = 'bash=/usr/bin/true terminal=false refresh=false';

function menuParams({ size = null, color = null, font = null, inert = true } = {}) {
  const parts = [];
  if (font) parts.push(`font=${font}`);
  if (size) parts.push(`size=${size}`);
  if (color) parts.push(`color=${color}`);
  // SwiftBar renders menu items with no action as disabled, which makes text
  // grey even when color= is present. A fixed no-op keeps info rows readable.
  if (inert) parts.push(DROPDOWN_NOOP_ACTION);
  return parts.join(' ');
}

function menuLine(text, opts = {}) {
  const params = menuParams(opts);
  return params ? `${sanitize(text)} | ${params}` : sanitize(text);
}

function submenuLine(text, opts = {}) {
  return `--${menuLine(text, opts)}`;
}

export function wrapMenuText(text, max = DROPDOWN_WRAP_CHARS) {
  const clean = sanitize(text).replace(/\s+/g, ' ').trim();
  if (!clean) return [''];
  const lines = [];
  let current = '';
  for (const word of clean.split(' ')) {
    if (!current) {
      if (word.length <= max) {
        current = word;
      } else {
        for (let i = 0; i < word.length; i += max) lines.push(word.slice(i, i + max));
      }
      continue;
    }
    if (current.length + 1 + word.length <= max) {
      current += ` ${word}`;
      continue;
    }
    lines.push(current);
    if (word.length <= max) {
      current = word;
    } else {
      for (let i = 0; i < word.length; i += max) lines.push(word.slice(i, i + max));
      current = '';
    }
  }
  if (current) lines.push(current);
  return lines;
}

function wrappedMenuLines(text, opts = {}, { max = DROPDOWN_WRAP_CHARS } = {}) {
  return wrapMenuText(text, max).map((line, idx) => menuLine(idx === 0 ? line : `  ${line}`, opts));
}

export function baseUrl(host, port) {
  return `http://${sanitizeHostPort(host)}:${sanitizeHostPort(port)}/`;
}

// Dropdown for a normal (non-offline) badge: title echo → per-tool groups →
// diagnostics → actions. host/port drive the Open-dashboard href so the link
// matches what the badge reads.
function dropdownLines(badge, host, port, serviceState = 'not-installed', display = null) {
  const lines = ['---'];

  // Title echo line — repeats the glyph with the binding tool·window (and band
  // when degraded), mirroring SwiftBar's natural top-of-dropdown title.
  if (badge.state === 'no-reading') {
    lines.push(menuLine(`${MARK} no reading yet`, { size: DROPDOWN_HEADER_SIZE, color: COLOR_DROPDOWN_TEXT }));
  } else {
    const b = badge.binding;
    const bindingCue = `${b.toolLabel} · ${b.windowLabel}`
      + (b.band === 'aging' || b.band === 'stale' ? ` · ${b.band}` : '');
    lines.push(menuLine(`${MARK} ${badge.pct}% remaining — ${bindingCue}`, { size: DROPDOWN_HEADER_SIZE, color: COLOR_DROPDOWN_TEXT }));
  }

  const diagBlock = [];
  for (const tv of badge.toolViews) {
    lines.push('---'); // group separator
    const tag = tv.band === 'aging' ? '  (aging)' : tv.band === 'stale' ? '  (stale)' : '';
    lines.push(menuLine(`${tv.label}${tag}`, { size: DROPDOWN_HEADER_SIZE, color: COLOR_DROPDOWN_HEADER }));
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
      lines.push(menuLine(text, { font: 'Menlo', color: COLOR_DROPDOWN_TEXT }));
    }
    if (tv.diag) diagBlock.push(...wrappedMenuLines(tv.diag, { size: DROPDOWN_BODY_SIZE, color: DROPDOWN_STATE_COLOR.stale }));
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
  for (const l of actionClusterLines({ serviceState, remotes: [], display })) lines.push(l);

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
    ...wrappedMenuLines(`Dashboard offline — no server on ${sanitizeHostPort(host)}:${sanitizeHostPort(port)}`, { size: DROPDOWN_BODY_SIZE, color: COLOR_DROPDOWN_TEXT }),
    `Open dashboard | href=${baseUrl(host, port)}`,
    'Refresh | refresh=true',
  ];
}

export function emit(badge, { host = HOST, port = PORT, offline = false, serviceState = 'not-installed', display = null } = {}) {
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
      // Number KEEPS its value; marked with a clock-like age symbol and dimmed.
      // The age symbol is load-bearing (reads in a monochrome bar); the dim
      // is secondary. color= carries the honest de-emphasis on the dark bar.
      title = `${MARK} ${badge.cue} ${badge.pct}% ${AGE_CLOCK} | color=${COLOR_AGING}`;
      break;
    case 'fresh':
    default: {
      // Plain & confident: the number's own status color shows through.
      const color = BAR_COLOR[statusClass(badge.pct)];
      title = `${MARK} ${badge.cue} ${badge.pct}% | color=${color}`;
      break;
    }
  }
  return [title, ...dropdownLines(badge, host, port, serviceState, display)].join('\n');
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
  lines.push(menuLine(head, { size: DROPDOWN_HEADER_SIZE, color: COLOR_DROPDOWN_HEADER }));

  if (view.self && view.deemph) {
    // De-emphasized local (monitoring station): the honest idle note, no fake
    // rows, no zeros — retained but out of the glance (FR-20). Copy verbatim.
    lines.push(menuLine('no local activity', { size: DROPDOWN_BODY_SIZE, color: COLOR_DROPDOWN_TEXT }));
    lines.push(...wrappedMenuLines("This Mac isn't running Claude or Codex — it's watching the machines above. Kept out of the glyph so the machines you're watching stay loudest. No reading is fabricated.", { size: DROPDOWN_NOTE_SIZE, color: COLOR_DROPDOWN_SUBTLE }));
    return lines;
  }

  if (view.diagLine) {
    // Offline / error / pending host: the named line, never a fabricated zero.
    lines.push(...wrappedMenuLines(view.diagLine, { size: DROPDOWN_BODY_SIZE, color: DROPDOWN_STATE_COLOR.stale }));
    return lines;
  }

  if (!view.badge) {
    // No state and no diagnostic (shouldn't happen post-normalize) — honest dash.
    lines.push(menuLine('no reading', { size: DROPDOWN_NOTE_SIZE, color: COLOR_DROPDOWN_DEEMPH }));
    return lines;
  }

  // The existing per-tool rows, per host (5-hour / Weekly; not available / limit
  // reached / N% · resets …). Verbatim from dropdownLines' inner loop.
  const diagBlock = [];
  for (const tv of view.badge.toolViews) {
    const tag = tv.band === 'aging' ? '  (aging)' : tv.band === 'stale' ? '  (stale)' : '';
    lines.push(menuLine(`${tv.label}${tag}`, { size: DROPDOWN_BODY_SIZE, color: COLOR_DROPDOWN_HEADER }));
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
      lines.push(menuLine(text, { font: 'Menlo', color: COLOR_DROPDOWN_TEXT }));
    }
    if (tv.diag) diagBlock.push(...wrappedMenuLines(tv.diag, { size: DROPDOWN_NOTE_SIZE, color: DROPDOWN_STATE_COLOR.stale }));
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
    lines.push(menuLine('－ Remove host…', { color: COLOR_DROPDOWN_HEADER, inert: false }));
    for (const r of remotes) {
      const label = sanitize(r.label);
      const key = sanitizeHostPort(r.key);
      lines.push(`--Stop watching ${label} (${r.addr}) | shell="${ABS_NODE}" param1="${HOST_CONFIG_ACTION}" param2=remove param3="${key}" terminal=false refresh=true`);
    }
    // A live listing of the current remote set (a real affordance, not a dead item).
    lines.push(menuLine(`☰ Watching: ${remotes.length} other machine${remotes.length === 1 ? '' : 's'}`, { color: COLOR_DROPDOWN_SUBTLE }));
  } else {
    // Single-host: no remotes to remove; state the honest zero so the count line
    // is never a dead/absent affordance. Add host… above is the live path.
    lines.push(menuLine('☰ Watching: 0 other machines', { color: COLOR_DROPDOWN_SUBTLE }));
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
export function actionClusterLines({ serviceState = 'not-installed', remotes = [], display = null } = {}) {
  const { serviceLine, uninstallLines } = serviceControlActionLines({ state: serviceState });
  const lines = ['---', serviceLine];
  // hostConfigActionLines opens with its own '---'; we've already started the
  // group, so append its body without the leading separator (keep one group).
  const hostLines = hostConfigActionLines({ remotes });
  for (const l of hostLines) { if (l === '---') continue; lines.push(l); }
  // The Display submenu (badge-display-options) — presets + the five axes,
  // ✓-active-marked live. Rides BOTH single-host and multi-host dropdowns (shared
  // path). Its own '---' opens a new group.
  for (const l of displayActionLines({ display: display || {}, remotes })) lines.push(l);
  // The Legend submenu (badge-display-options) — static, on demand, both modes.
  for (const l of legendLines()) lines.push(l);
  for (const l of uninstallLines) lines.push(l);
  return lines;
}

// The multi-host dropdown: title echo (binding host · tool · window) + scope line,
// one section per host (binding first), then the actions, then the shipped
// Open-dashboard / Refresh. host/port drive the Open-dashboard href (THIS machine's
// loopback, never a peer's).
function multiDropdownLines(multi, host, port, remotes, serviceState = 'not-installed', display = null) {
  const lines = ['---'];
  const reachableCount = multi.hostViews.length;
  const unreachable = multi.hostViews.filter((v) => !v.reachable || (!v.badge && !v.self)).length;

  if (multi.state === 'no-reading') {
    lines.push(menuLine(`${MARK} no reading yet`, { size: DROPDOWN_HEADER_SIZE, color: COLOR_DROPDOWN_TEXT }));
  } else {
    const b = multi.binding;
    const bindingCue = `${b.hostLabel} · ${b.toolLabel} · ${b.windowLabel}`
      + (b.band === 'aging' || b.band === 'stale' ? ` · ${b.band}` : '');
    lines.push(menuLine(`${MARK} ${multi.pct}% remaining — ${bindingCue}`, { size: DROPDOWN_HEADER_SIZE, color: COLOR_DROPDOWN_TEXT }));
  }
  const scope = `Watching ${reachableCount} machine${reachableCount === 1 ? '' : 's'}`
    + (unreachable ? ` · ${unreachable} not reachable` : '');
  lines.push(menuLine(scope, { size: DROPDOWN_SECTION_SIZE, color: COLOR_DROPDOWN_SUBTLE }));

  const bindingView = multi.binding ? multi.hostViews[0] : null;
  for (const view of multi.hostViews) {
    for (const l of hostSectionLines(view, { isBinding: view === bindingView && !!multi.binding })) lines.push(l);
  }

  // The service toggle + host-config + Uninstall action cluster (both modes).
  for (const l of actionClusterLines({ serviceState, remotes, display })) lines.push(l);

  lines.push('---');
  lines.push(`Open dashboard | href=${baseUrl(host, port)}`);
  lines.push('Refresh | refresh=true');
  return lines;
}

// emitMulti — the multi-host title glyph + the multi-host dropdown. The glyph
// carries the host cue: `▪ <host>·<C|X> <pct>` in fresh/aging/stale; no-reading is
// `▪ —` (no host cue). Single-host mode is handled by the caller delegating to the
// shipped emit() — this is only ever called with mode:'multi'.
export function emitMulti(multi, { host = HOST, port = PORT, remotes = [], serviceState = 'not-installed', display = null } = {}) {
  let title;
  const hc = multi.hostCue; // already truncated + sanitized
  switch (multi.state) {
    case 'no-reading':
      title = `${MARK} ${DASH} | color=${COLOR_MUTED}`;
      break;
    case 'stale':
      title = `${MARK} ${hc}${HOST_TOOL_SEP}${multi.cue} ${multi.pct}% ${WARN_TRIANGLE} | color=${COLOR_STALE}`;
      break;
    case 'aging':
      title = `${MARK} ${hc}${HOST_TOOL_SEP}${multi.cue} ${multi.pct}% ${AGE_CLOCK} | color=${COLOR_AGING}`;
      break;
    case 'fresh':
    default: {
      const color = BAR_COLOR[statusClass(multi.pct)];
      title = `${MARK} ${hc}${HOST_TOOL_SEP}${multi.cue} ${multi.pct}% | color=${color}`;
      break;
    }
  }
  return [title, ...multiDropdownLines(multi, host, port, remotes, serviceState, display)].join('\n');
}

// ════════════════════════════════════════════════════════════════════════════
// BADGE DISPLAY OPTIONS (badge-display-options) — group × hosts × layout ×
// density × tool-mark, applied as a PURE presentation layer over the existing
// computeMultiBadge hostViews. computeMultiBadge, the fetch, /api/hosts, and the
// binding/ordering logic are ALL unchanged. The dropdown never filters/regroups;
// only the GLYPH uses the display view. Default axes route to the SHIPPED
// emit()/emitMulti() path byte-for-byte (save the ratified ◆/▲ default cue).
// ════════════════════════════════════════════════════════════════════════════

// The one cap shared by side-by-side + alternating (host mode only; tool mode has
// exactly two units → no cap). Binding-first, so +M hides the LEAST-constrained.
export const SIDE_BY_SIDE_CAP = 3;
// The stateless rotation cadence (alternating): one host/aggregate per render tick.
// A pure function of the wall clock — no cursor persisted (the plugin re-spawns
// each tick, so a stored counter is unnecessary and a corruption risk).
export const ROTATE_MS = 5000;

// ── displayFromConfig — read the five display axes on the render tick (NEW) ────
// Off the HTTP request path (badge process). A thrown read → today's defaults
// (byte-for-byte the shipped badge) — honest degradation, never a crash.
export function displayFromConfig(read = readDisplayConfig) {
  try {
    const d = read();
    return {
      hosts: d && d.hosts ? d.hosts : 'all',
      layout: d && d.layout ? d.layout : 'single',
      density: d && d.density ? d.density : 'wide',
      group: d && d.group ? d.group : 'host',
      toolMark: d && d.toolMark ? d.toolMark : 'neutral',
    };
  } catch {
    return { hosts: 'all', layout: 'single', density: 'wide', group: 'host', toolMark: 'neutral' };
  }
}

// Is the display config the all-default (today's badge)? Used for the byte-for-
// byte routing split: default ⇒ the shipped emit()/emitMulti() path unchanged.
export function isDefaultDisplay(display) {
  const d = display || {};
  return (d.hosts === 'all' || d.hosts == null)
    && (d.layout === 'single' || d.layout == null)
    && (d.density === 'wide' || d.density == null)
    && (d.group === 'host' || d.group == null);
  // (toolMark is orthogonal — it doesn't change the routing; the ◆/▲ cue is the
  // default and the wide path already emits it. Logo replacement happens in the
  // emit path regardless of the other axes.)
}

// ── The grow-prefix host cue (SPIKE-01) — per-cell identity for multi layouts ──
// Grow each SHOWN label's prefix (1 → max 4 chars) until all shown cues are
// distinct; on a persistent collision, append a positional suffix. sanitize()d,
// bounded. Returns a Map label→cue over the shown labels (recomputed per render).
const GROW_PREFIX_MAX = 4;
// Returns an ARRAY of cues PARALLEL to the input labels (indexed by position, not
// keyed by label — two hosts can share a label, so a label→cue Map would collapse
// them; the caller indexes by the same position it passed).
export function growPrefixCues(labels) {
  const clean = labels.map((l) => sanitize(String(l == null ? '' : l)).trim());
  const cues = new Array(clean.length).fill('');
  // Try prefix lengths 1..MAX; stop when every cue is unique.
  for (let len = 1; len <= GROW_PREFIX_MAX; len++) {
    for (let i = 0; i < clean.length; i++) cues[i] = clean[i].slice(0, len) || clean[i];
    if (new Set(cues).size === clean.length) return cues;
  }
  // Persistent collision at MAX: append a positional suffix to the duplicates so
  // each cue is still distinct (Mac, Mac2, Mac3 — the design-spec form).
  const seen = new Map();
  for (let i = 0; i < cues.length; i++) {
    const base = cues[i];
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    if (n > 1) cues[i] = `${base}${n}`;
  }
  return cues;
}

// ── The per-tool aggregate (group=tool) — a presentation regroup over hostViews ─
// For each tool, the tightest-window MIN remaining across the SELECTED hosts'
// windows that have a reading, carrying that window's freshness state. No reading
// anywhere → no-reading (—, no digit); every contributing host offline → offline
// (⊘, no digit). NO new /api field — reads only the existing view.badge.toolViews
// (NFR-03). `shown` is the host-selected subset of hostViews. Returns two cells
// (claude, codex) ordered binding-first (tighter remaining first).
const AGG_TOOLS = [
  { source: 'claude-code', match: (s) => s !== 'codex' }, // Claude (default mark ◆)
  { source: 'codex', match: (s) => s === 'codex' },       // Codex (default mark ▲)
];
export function toolAggregates(shownViews) {
  const cells = AGG_TOOLS.map(({ source, match }) => {
    let best = null;          // { pct, band } — the tightest window with a reading
    const windows = Object.fromEntries(WINDOWS.map(([key]) => [key, null]));
    let anyTracks = false;    // did any shown host even have this tool's block?
    let anyReachable = false; // is any host that tracks this tool reachable (has a badge)?
    for (const v of shownViews) {
      if (!v.badge || !Array.isArray(v.badge.toolViews)) continue;
      for (const tv of v.badge.toolViews) {
        if (!match(tv.source)) continue;
        anyTracks = true;
        anyReachable = true;
        for (let i = 0; i < tv.rows.length; i += 1) {
          const row = tv.rows[i];
          if (row.remaining == null) continue;
          const key = WINDOWS[i] && WINDOWS[i][0];
          if (key && (windows[key] == null || row.remaining < windows[key])) {
            windows[key] = row.remaining;
          }
          const band = tv.band || 'fresh'; // Codex has no freshness band → treat as fresh
          if (best == null || row.remaining < best.pct) best = { pct: row.remaining, band };
        }
      }
    }
    const mark = toolMark(source);
    if (best) {
      const state = best.band === 'stale' ? 'stale' : best.band === 'aging' ? 'aging' : 'fresh';
      return { source, mark, state, pct: best.pct, windows };
    }
    // No reading for this tool across the selected hosts. Offline only when a host
    // TRACKS the tool but none are reachable; otherwise honest no-reading (—).
    // In this presentation-regroup, a host with a badge is reachable, so if no
    // host with this tool block is present at all → no-reading. All-offline is
    // detected when the shown set has hosts but none carry a badge (below).
    void anyTracks; void anyReachable;
    return { source, mark, state: 'no-reading', pct: null, windows };
  });
  // All-offline detection: if EVERY shown host is unreachable/no-badge, both tool
  // aggregates read offline (⊘) rather than no-reading (—). A shown set with at
  // least one badge yields no-reading for an absent tool (honest — data exists,
  // just not for that tool).
  const anyBadge = shownViews.some((v) => v.badge);
  if (!anyBadge && shownViews.length) {
    for (const c of cells) { c.state = 'offline'; c.pct = null; c.windows = Object.fromEntries(WINDOWS.map(([key]) => [key, null])); }
  }
  // Binding-first: the tighter-remaining aggregate first. A no-reading/offline
  // cell sorts AFTER a cell with a reading (it has no pct to bind on).
  cells.sort((a, b) => {
    const ap = a.pct == null ? Infinity : a.pct;
    const bp = b.pct == null ? Infinity : b.pct;
    return ap - bp;
  });
  return cells;
}

// ── The compact cell — one host/aggregate's { state, pct } → a render descriptor ─
// Reuses the shipped five-state markers, miniaturized. offline/no-reading carry
// NO digit (structural — no code path emits one). `cue` is an optional prefix
// (the grow-prefix host cue, or the tool mark in aggregate mode). `color` is the
// cell's own color (a side-by-side LINE takes the binding cell's color).
export function compactCell({ state, pct, cue = '', mark = '' }) {
  const prefix = `${cue}${mark}`;
  switch (state) {
    case 'no-reading':
      return { text: `${prefix}${DASH}`, color: COLOR_MUTED, state, mark };
    case 'offline':
      return { text: `${prefix}⊘`, color: COLOR_OFFLINE, state, mark };
    case 'stale':
      // Leading ⚠ in compact (design-spec: the flag registers first in tight space).
      return { text: `${prefix}${WARN_TRIANGLE}${pct}`, color: COLOR_STALE, state, mark };
    case 'aging':
      return { text: `${prefix}${AGE_CLOCK}${pct}`, color: COLOR_AGING, state, mark };
    case 'fresh':
    default:
      return { text: `${prefix}${pct}`, color: BAR_COLOR[statusClass(pct)], state, mark };
  }
}

// A host view → its compact-cell inputs { state, pct }. A view with a badge maps
// its badge state/pct; an offline/pending/no-badge view is offline/no-reading
// (never a fabricated number — a SELECTED offline host STAYS, marked ⊘, FR-13).
function viewToCellState(v) {
  if (v.badge && v.badge.state && v.badge.state !== 'no-reading') {
    return { state: v.badge.state, pct: v.badge.pct };
  }
  if (v.badge && v.badge.state === 'no-reading') return { state: 'no-reading', pct: null };
  // No badge → offline (unreachable) or pending → treat as offline in the compact
  // glyph (it carries no number). A pending host reads offline until it fills in.
  return { state: v.reachable === false ? 'offline' : 'no-reading', pct: null };
}

// ── applyDisplay — the pure axis-applier (group → hosts → layout → density) ────
// PURE and injectable (clock injected for rotation tests). Returns a glyph
// descriptor the emitter turns into the title line; hostViews is echoed UNCHANGED
// (the dropdown still renders every host). display echoed for submenu marking.
//   applyDisplay(multi, display, { epochMs }) → { layout, density, group, toolMark,
//       cells:[{text,color,state}], color, more, hostViews, display }
export function applyDisplay(multi, display, { epochMs = Date.now() } = {}) {
  const d = {
    hosts: display && display.hosts ? display.hosts : 'all',
    layout: display && display.layout ? display.layout : 'single',
    density: display && display.density ? display.density : 'wide',
    group: display && display.group ? display.group : 'host',
    toolMark: display && display.toolMark ? display.toolMark : 'neutral',
  };
  const allViews = Array.isArray(multi.hostViews) ? multi.hostViews : [];

  // ── group=host: VIEW FILTER over hostViews (glyph only). ─────────────────────
  // 'all' → identity (byte-for-byte guard). A key list → keep only selected addrs,
  // binding-first (the set stays in multi.hostViews' binding-first order); an empty
  // result falls back to 'all' (never an empty glyph). A selected offline host is
  // filtered IN by its key and rendered with its marker (FR-13). Views without a
  // real host (the deemph local placeholder) are still valid cells.
  let shown = allViews;
  if (d.group === 'host' && d.hosts !== 'all' && Array.isArray(d.hosts)) {
    const selected = new Set(d.hosts);
    const filtered = allViews.filter((v) => selected.has(v.addr));
    shown = filtered.length ? filtered : allViews; // empty selection → all
  }

  // ── Build the UNITS (cells' state) per group. ────────────────────────────────
  let units; // [{ state, pct, cue, mark }] — pre-density, one per shown unit
  if (d.group === 'tool') {
    // Per-tool aggregate over the SELECTED hosts (the Hosts axis still scopes even
    // in tool mode). Two units, binding-first, no cap. The tool MARK is the unit's
    // identity (always shown, leads the cell); NO host cue in tool mode.
    let aggShown = allViews;
    if (d.hosts !== 'all' && Array.isArray(d.hosts)) {
      const selected = new Set(d.hosts);
      const filtered = allViews.filter((v) => selected.has(v.addr));
      aggShown = filtered.length ? filtered : allViews;
    }
    units = toolAggregates(aggShown).map((c) => ({
      source: c.source, state: c.state, pct: c.pct, windows: c.windows, cue: '', mark: c.mark,
    }));
  } else {
    // Per-host: each unit a host, cued by the grow-prefix host cue (multi layouts).
    // Cues are position-indexed (two hosts can share a label — index, don't key).
    const cueArr = growPrefixCues(shown.map((v) => v.label));
    units = shown.map((v, i) => {
      const cs = viewToCellState(v);
      return { state: cs.state, pct: cs.pct, cue: '', mark: '', _view: v, _cue: cueArr[i] || '' };
    });
  }

  // ── layout over the units → the shown cell set + overflow. ───────────────────
  const cap = d.group === 'tool' ? units.length : SIDE_BY_SIDE_CAP; // no cap in tool mode
  let picked;      // the units to render this tick
  let more = 0;    // +M overflow (side-by-side host mode only)
  let effectiveLayout = d.layout;
  if (units.length <= 1) {
    // Degenerate reduction (FR-19): one effective unit → single (compact still
    // applies). Zero units shouldn't happen (empty selection fell back to all).
    picked = units.slice(0, 1);
    effectiveLayout = 'single';
  } else if (d.layout === 'single') {
    picked = units.slice(0, 1); // the binding unit (units stay binding-first)
  } else if (d.layout === 'alternating') {
    // Stateless rotation over the capped set: floor(epochMs/ROTATE_MS) % count.
    const set = units.slice(0, cap);
    const idx = Math.floor(epochMs / ROTATE_MS) % set.length;
    picked = [set[idx]];
  } else { // side-by-side
    picked = units.slice(0, cap);
    more = Math.max(0, units.length - cap);
  }

  // ── density → the cell text; multi layouts carry the per-unit cue/mark. ──────
  // The host cue shows whenever the EFFECTIVE layout identifies a specific machine
  // among several: side-by-side (each cell cued) AND alternating (the one shown
  // machine named — `▪ La◷88`). single compact drops it (`▪ 12`). Degenerate
  // reduction to 'single' (one effective host) also drops it — there is no
  // ambiguity to resolve.
  const showHostCue = d.group === 'host'
    && (effectiveLayout === 'side-by-side' || effectiveLayout === 'alternating');
  const cells = picked.map((u) => {
    const keepMeta = (cell) => ({ ...cell, source: u.source, windows: u.windows });
    if (d.density === 'compact') {
      // Compact: host cue tight against the number in multi layouts; tool mark
      // leads in aggregate mode; single compact drops the host cue entirely.
      const cue = showHostCue ? (u._cue || '') : '';
      return keepMeta(compactCell({ state: u.state, pct: u.pct, cue, mark: u.mark }));
    }
    // Wide density in a multi layout: reuse the shipped truncateHostCue form for a
    // host cue; tool mark leads in aggregate mode. (Single wide default routes to
    // the shipped emit path — this handles wide + non-default group/hosts.)
    if (showHostCue && u._view) {
      const hc = truncateHostCue(u._view.label);
      return keepMeta(wideCell({ state: u.state, pct: u.pct, cue: hc, mark: u._view.badge ? u._view.badge.cue : '' }));
    }
    return keepMeta(wideCell({ state: u.state, pct: u.pct, cue: '', mark: u.mark || (u._view && u._view.badge ? u._view.badge.cue : '') }));
  });

  // The line's single color = the BINDING (first) cell's (one color per SwiftBar
  // line; per-cell state rides the marker). Alternating shows one cell → its color.
  const color = cells.length ? cells[0].color : COLOR_MUTED;

  return {
    layout: effectiveLayout, density: d.density, group: d.group, toolMark: d.toolMark,
    cells, color, more,
    hostViews: allViews, // UNCHANGED — the dropdown still renders every host
    display: d,
  };
}

// A wide-density cell (wide + non-default group/hosts). Mirrors the shipped wide
// grammar per state: fresh `<cue><mark> <pct>%`, aging clock marker, stale trailing
// ⚠, no-reading/offline no number. Used only by applyDisplay's wide multi/tool
// paths (single+all+wide default still routes to the shipped emit()).
function wideCell({ state, pct, cue = '', mark = '' }) {
  const lead = cue ? `${cue}${HOST_TOOL_SEP}${mark}` : mark; // host cue · tool mark, or just the mark
  const sp = lead ? `${lead} ` : '';
  switch (state) {
    case 'no-reading':
      return { text: `${DASH}`, color: COLOR_MUTED, state, mark };
    case 'offline':
      return { text: `${lead ? lead + ' ' : ''}⊘`, color: COLOR_OFFLINE, state, mark };
    case 'stale':
      return { text: `${sp}${pct}% ${WARN_TRIANGLE}`, color: COLOR_STALE, state, mark };
    case 'aging':
      return { text: `${sp}${pct}% ${AGE_CLOCK}`, color: COLOR_AGING, state, mark };
    case 'fresh':
    default:
      return { text: `${sp}${pct}%`, color: BAR_COLOR[statusClass(pct)], state, mark };
  }
}

// ── The logo image (opt-in, SwiftBar-only, neutral fallback) ───────────────────
// SwiftBar exposes one image slot per menu item line, not arbitrary inline images.
// When a logo image is available, it replaces the visible ◆/▲ text marks in the
// title; if the image is missing or the host is xbar, the neutral text marks stay.
// Use `image=` instead of `templateImage=` so the PNG can be recolored to the same
// status color as the text glyph it replaces. Read + encode ONLY when opted in
// (no cost on the default path), cached per process (the plugin re-spawns each
// tick). Resolve assets from THIS file via import.meta.url (ESM de-symlinks it →
// works under the wrapper/symlink). If an asset is missing/unreadable → return
// null and let the text fallback stand.
const LOGO_ASSET = { 'claude-code': 'claude-mark.png', claude: 'claude-mark.png', codex: 'codex-mark.png' };
const LOGO_PAIR_ASSET = {
  'claude-code|codex': 'claude-codex-mark.png',
  'codex|claude-code': 'codex-claude-mark.png',
};
const MARK_TO_LOGO_SOURCE = { [TOOL_MARK.claude]: 'claude-code', [TOOL_MARK.codex]: 'codex' };
const _logoCache = new Map(); // asset filename → base64 | null (per-process)
const _logoImageCache = new Map(); // asset filename + color → base64 | null
const _logoTitleCache = new Map(); // title spec + color → base64 | null
function logoAssetBase64(name, { read = _readFileSync } = {}) {
  if (!name) return null;
  if (_logoCache.has(name)) return _logoCache.get(name);
  let b64 = null;
  try {
    const url = new URL(`./assets/${name}`, import.meta.url);
    b64 = read(url).toString('base64');
  } catch { b64 = null; }
  _logoCache.set(name, b64);
  return b64;
}
export function logoBase64(source, options = {}) {
  return logoAssetBase64(LOGO_ASSET[source] || LOGO_ASSET.claude, options);
}
export function logoBase64ForCells(cells, options = {}) {
  const sources = (Array.isArray(cells) ? cells : [])
    .map((c) => MARK_TO_LOGO_SOURCE[c && c.mark])
    .filter(Boolean);
  if (sources.length === 1) return logoBase64(sources[0], options);
  if (sources.length === 2) return logoAssetBase64(LOGO_PAIR_ASSET[sources.join('|')], options);
  return null;
}

function logoAssetNameForCells(cells) {
  const sources = (Array.isArray(cells) ? cells : [])
    .map((c) => MARK_TO_LOGO_SOURCE[c && c.mark])
    .filter(Boolean);
  if (sources.length === 1) return LOGO_ASSET[sources[0]] || null;
  if (sources.length === 2) return LOGO_PAIR_ASSET[sources.join('|')] || null;
  return null;
}

function parseHexColor(color) {
  const m = String(color || '').match(/^#([0-9a-f]{6})$/i);
  if (!m) return null;
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
}

let _crcTable = null;
function crc32(buf) {
  if (!_crcTable) {
    _crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      _crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = _crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodeRgbaPng(buf) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!Buffer.isBuffer(buf) || buf.length < 33 || !buf.subarray(0, 8).equals(sig)) return null;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  for (let off = 8; off + 12 <= buf.length;) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    off += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (bitDepth !== 8 || colorType !== 6 || width <= 0 || height <= 0 || !idat.length) return null;
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const rgba = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[pos++];
    const row = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[pos++];
      const left = x >= bpp ? rgba[row + x - bpp] : 0;
      const up = y > 0 ? rgba[row - stride + x] : 0;
      const upLeft = y > 0 && x >= bpp ? rgba[row - stride + x - bpp] : 0;
      let val = raw;
      if (filter === 1) val = raw + left;
      else if (filter === 2) val = raw + up;
      else if (filter === 3) val = raw + Math.floor((left + up) / 2);
      else if (filter === 4) val = raw + paeth(left, up, upLeft);
      else if (filter !== 0) return null;
      rgba[row + x] = val & 0xff;
    }
  }
  return { width, height, rgba };
}

function encodeRgbaPng({ width, height, rgba }) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND'),
  ]);
}

function recolorPngBase64(buf, color) {
  const rgb = parseHexColor(color);
  const decoded = rgb ? decodeRgbaPng(buf) : null;
  if (!decoded) return null;
  const rgba = Buffer.from(decoded.rgba);
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] > 0) {
      rgba[i] = rgb[0];
      rgba[i + 1] = rgb[1];
      rgba[i + 2] = rgb[2];
    }
  }
  return encodeRgbaPng({ ...decoded, rgba }).toString('base64');
}

function logoColorAssetBase64(name, color, { read = _readFileSync } = {}) {
  if (!name) return null;
  const key = `${name}|${color}`;
  if (_logoImageCache.has(key)) return _logoImageCache.get(key);
  let b64 = null;
  try {
    const url = new URL(`./assets/${name}`, import.meta.url);
    b64 = recolorPngBase64(read(url), color);
  } catch { b64 = null; }
  _logoImageCache.set(key, b64);
  return b64;
}

export function logoImageBase64ForCells(cells, color, options = {}) {
  return logoColorAssetBase64(logoAssetNameForCells(cells), color, options);
}

const TITLE_IMAGE_HEIGHT = 16;
const TITLE_TOOL_ORDER = { 'claude-code': 0, codex: 1 };
// Alpha masks rendered once from AppKit `NSFont.menuBarFont(ofSize: 0)` on macOS
// (13pt system font). The plugin embeds masks instead of spawning a renderer on
// every SwiftBar tick, preserving the zero-dep/no-build runtime posture.
const TITLE_NATIVE_FONT = {
  height: 16,
  glyphs: {
    '0': { width: 11, advance: 8.112, alpha: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABPp7NhBgAAAAAAZv/38f+UAAAAAADc9iEO2/kSAAAAFP+VAABm/0QAAAA7/1sAACz/awAAAFX/RgAAFv+FAAAANv9fAAAv/2UAAAAN/6gAAHn/PAAAAACl/4Bz884FAAAAABC9/f/PKQAAAAAAAAAWGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' },
    '1': { width: 8, advance: 5.954, alpha: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAArkVMAAAAAVPP/nAAAAEv/4f+cAAAAXrwU8ZwAAAACAwDxnAAAAAAAAPGcAAAAAAAA8ZwAAAAAAADxnAAAAAAAAPGcAAAAAAAA65YAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' },
    '2': { width: 10, advance: 7.770, alpha: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAd6t7VuAQAAAACz/9jl/4wAAAAQ/rUBEeXcAAAALMRGAACs+wAAAAAAAAAf8cQAAAAAAAAV2PUxAAAAAAAT0vhFAAAAAAARz/dHAAAAAAAMy/+oZWVlCwAAKf///////yIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==' },
    '3': { width: 11, advance: 8.074, alpha: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABhoq18DgAAAAAAj//r3//OAAAAAAPuzwwBrv8eAAAACZVGAAB5/y4AAAAAABNXffPJAgAAAAAAQPb//3gAAAAAAAAAACOn/zsAAAAqtjwAADr/fQAAAA304GFVyP86AAAAADzZ///oYgAAAAAAAAAREQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' },
    '4': { width: 11, advance: 8.290, alpha: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGqSRwAAAAAAAAA8/v+HAAAAAAAAAML4/4cAAAAAAABP/4X+hwAAAAAAEefRBv6HAAAAAACf+zEA/ocAAAAAQv+xLCz/oSAAAAB2////////1AAAAA8rKysr/6AfAAAAAAAAAAD6gQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' },
    '5': { width: 10, advance: 7.960, alpha: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFqSkpKSgAAAAACw/PT09NgAAAAAxqoAAAAAAAAAAN2SBAsAAAAAAADz9vj+0T8AAAAJ/+loaOn1FgAAAEUfAABO/1YAAB20SQAASf9XAAAG6+VbV+H3FQAAADrj///nQwAAAAAAAB8eAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==' },
    '6': { width: 11, advance: 8.201, alpha: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABDl8OWIQAAAAAAWv/+1f/vEwAAAADZ9y4AdP9sAAAAF/+NAhQHUyIAAAA//8P0/+RtAAAAAGD//4NczP9LAAAASv/oAAAX/5YAAAAk/6MAABf/lAAAAAC2/HtRyf9IAAAAABq////xbwAAAAAAAAAbIwMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' },
    '7': { width: 10, advance: 7.325, alpha: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAUJKSkpKSewAAAIn09PT0/+IAAAAAAAAAL/6hAAAAAAAAALD7IwAAAAAAADT/nAAAAAAAAAC2+h8AAAAAAAA5/5cAAAAAAAAAvPgcAAAAAAAAP/+SAAAAAAAAAKv2GQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==' },
    '8': { width: 11, advance: 8.227, alpha: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFhoa58EQAAAAAAk//s3v/bBQAAAAHr2hAAnP85AAAABvimAABZ/0wAAAAAlv2biuvkCAAAAABo/////6wHAAAALv+6Ggp8/3sAAABZ/1sAAAz/pwAAABn85WZgvv9jAAAAAETa///tfQEAAAAAAAAREgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' },
    '9': { width: 11, advance: 8.201, alpha: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVzsLl3BQAAAAAArP/p5v+rAAAAACH/zQcEw/4oAAAAVv9UAABJ/3EAAABJ/2gAAGP/lQAAAAvp9oOA8/+mAAAAACi59Oue/4AAAAATbCwAAFv/VgAAABLx31507NcLAAAAAEnr///MLQAAAAAAAAIpGwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' },
    '/': { width: 6, advance: 3.885, alpha: 'AAAAAAAAAAAAAAAAAAAAAAAAAABr9xMAAACr5gAAAADppwAAACj/aQAAAGf/KgAAAKXrAQAAAOStAAAAIv9vAAAAYf8wAAAAn+8CAAAA3rMAAAAA/3UAAAAASBYAAAAA' },
    '-': { width: 9, advance: 6.056, alpha: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFWNjY2MjAAAAPvj4+PhfAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
  },
};

function titleToolOrder(source) {
  return Object.prototype.hasOwnProperty.call(TITLE_TOOL_ORDER, source) ? TITLE_TOOL_ORDER[source] : 99;
}

function titleToolCells(cells) {
  return (Array.isArray(cells) ? cells : [])
    .map((cell) => ({ ...cell, source: cell.source || MARK_TO_LOGO_SOURCE[cell.mark] || '' }))
    .filter((cell) => cell.source && MARK_TO_LOGO_SOURCE[cell.mark])
    .sort((a, b) => titleToolOrder(a.source) - titleToolOrder(b.source));
}

function titleWindowText(cell) {
  const windows = cell && cell.windows ? cell.windows : {};
  const fmt = (v) => Number.isFinite(v) ? String(v) : '-';
  return `${fmt(windows.five_hour)}/${fmt(windows.seven_day)}`;
}

function titleGlyph(ch) {
  return TITLE_NATIVE_FONT.glyphs[ch] || TITLE_NATIVE_FONT.glyphs['-'];
}

function titleGlyphMask(glyph) {
  if (!glyph._mask) glyph._mask = Buffer.from(glyph.alpha, 'base64');
  return glyph._mask;
}

function titleTextLayout(text) {
  let cursor = 0;
  let width = 0;
  const placements = [];
  for (const ch of String(text)) {
    const glyph = titleGlyph(ch);
    const x = Math.round(cursor);
    placements.push({ glyph, x });
    width = Math.max(width, x + glyph.width);
    cursor += glyph.advance;
  }
  return { width, placements };
}

function measureTitleText(text) {
  return titleTextLayout(text).width;
}

function drawPixel(rgba, width, height, x, y, rgb, alpha = 255) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const i = (y * width + x) * 4;
  rgba[i] = rgb[0];
  rgba[i + 1] = rgb[1];
  rgba[i + 2] = rgb[2];
  rgba[i + 3] = alpha;
}

function drawRect(rgba, width, height, x, y, w, h, rgb, alpha = 255) {
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) drawPixel(rgba, width, height, xx, yy, rgb, alpha);
  }
}

function drawTitleText(rgba, width, height, x, y, text, rgb) {
  const layout = titleTextLayout(text);
  for (const p of layout.placements) {
    const mask = titleGlyphMask(p.glyph);
    for (let yy = 0; yy < TITLE_NATIVE_FONT.height; yy += 1) {
      for (let xx = 0; xx < p.glyph.width; xx += 1) {
        const a = mask[yy * p.glyph.width + xx];
        if (a > 0) drawPixel(rgba, width, height, x + p.x + xx, y + yy, rgb, a);
      }
    }
  }
}

function readLogoRgba(source, { read = _readFileSync } = {}) {
  const name = LOGO_ASSET[source];
  if (!name) return null;
  try {
    const url = new URL(`./assets/${name}`, import.meta.url);
    return decodeRgbaPng(read(url));
  } catch {
    return null;
  }
}

function drawLogo(rgba, width, height, x, y, logo, rgb) {
  if (!logo) return;
  for (let yy = 0; yy < logo.height; yy += 1) {
    for (let xx = 0; xx < logo.width; xx += 1) {
      const src = (yy * logo.width + xx) * 4;
      const a = logo.rgba[src + 3];
      if (a > 0) drawPixel(rgba, width, height, x + xx, y + yy, rgb, a);
    }
  }
}

export function logoTitleImageBase64ForView(view, options = {}) {
  if (!view || view.group !== 'tool' || view.layout !== 'side-by-side' || view.density !== 'compact') return null;
  const rgb = parseHexColor(view.color);
  const cells = titleToolCells(view.cells);
  if (!rgb || cells.length < 2) return null;
  const key = `${view.color}|${cells.map((c) => `${c.source}:${titleWindowText(c)}`).join('|')}`;
  if (_logoTitleCache.has(key)) return _logoTitleCache.get(key);
  const logos = cells.map((c) => readLogoRgba(c.source, options));
  if (logos.some((l) => !l)) {
    _logoTitleCache.set(key, null);
    return null;
  }
  const parts = cells.map((c, i) => ({ cell: c, logo: logos[i], text: titleWindowText(c) }));
  const markW = 5;
  const gapAfterMark = 4;
  const gapLogoText = 3;
  const gapTools = 7;
  const padding = 1;
  let width = padding + markW + gapAfterMark;
  for (let i = 0; i < parts.length; i += 1) {
    width += parts[i].logo.width + gapLogoText + measureTitleText(parts[i].text);
    if (i < parts.length - 1) width += gapTools;
  }
  width += padding;
  const height = TITLE_IMAGE_HEIGHT;
  const rgba = Buffer.alloc(width * height * 4);
  let x = padding;
  drawRect(rgba, width, height, x, Math.floor((height - markW) / 2), markW, markW, rgb);
  x += markW + gapAfterMark;
  for (let i = 0; i < parts.length; i += 1) {
    const logo = parts[i].logo;
    drawLogo(rgba, width, height, x, Math.floor((height - logo.height) / 2), logo, rgb);
    x += logo.width + gapLogoText;
    drawTitleText(rgba, width, height, x, 0, parts[i].text, rgb);
    x += measureTitleText(parts[i].text);
    if (i < parts.length - 1) x += gapTools;
  }
  const b64 = encodeRgbaPng({ width, height, rgba }).toString('base64');
  _logoTitleCache.set(key, b64);
  return b64;
}

function textWithoutToolMark(cell) {
  const text = String(cell && cell.text ? cell.text : '');
  const mark = cell && cell.mark;
  if ((mark === TOOL_MARK.claude || mark === TOOL_MARK.codex) && text.startsWith(mark)) {
    return text.slice(mark.length).replace(/^ +/, '');
  }
  return text;
}

export function _resetLogoCache() {
  _logoCache.clear();
  _logoImageCache.clear();
  _logoTitleCache.clear();
}

// Is the menu-bar host SwiftBar? SwiftBar sets SWIFTBAR / SWIFTBAR_VERSION in the
// plugin env; xbar does not. Template images are SwiftBar-only polish.
export function isSwiftBar(env = process.env) {
  return !!(env.SWIFTBAR || env.SWIFTBAR_VERSION || env.SWIFTBAR_PLUGINS_PATH);
}

// ── emitDisplay — render the applyDisplay glyph descriptor to a title line ─────
// Composes the cells into ONE menu-bar line: `▪ <cell> <cell> … [+M] | color=…`.
// A single cell → `▪ <cell>`. offline/no-reading cells carry no number (structural
// — compactCell/wideCell never emit one for those states). The dropdown is the
// FULL multi.hostViews (multiDropdownLines) — unchanged. Logo mode replaces the
// visible ◆/▲ text only after the colored image has been generated successfully.
export function emitDisplay(view, multi, { host = HOST, port = PORT, remotes = [], serviceState = 'not-installed', env = process.env } = {}) {
  let logoB64 = null;
  let logoTitleB64 = null;
  const swiftBarLogoTool = view.toolMark === 'logo' && isSwiftBar(env) && view.group === 'tool';
  const compositeLogoTitle = swiftBarLogoTool && view.layout === 'side-by-side' && view.density === 'compact';
  if (compositeLogoTitle) {
    logoTitleB64 = logoTitleImageBase64ForView(view);
  } else if (swiftBarLogoTool) {
    logoB64 = logoImageBase64ForCells(view.cells, view.color);
  }
  if (logoTitleB64) {
    const title = `${String.fromCharCode(8203)} | color=${view.color} image=${logoTitleB64}`;
    return [title, ...multiDropdownLines(multi, host, port, remotes, serviceState, view.display)].join('\n');
  }
  const parts = view.cells.map((c) => logoB64 ? textWithoutToolMark(c) : c.text);
  if (view.more > 0) parts.push(`+${view.more}`);
  const glyphText = parts.filter(Boolean).join(' ');
  let title = `${MARK}${glyphText ? ` ${glyphText}` : ''} | color=${view.color}`;
  if (logoB64) title += ` image=${logoB64}`;
  return [title, ...multiDropdownLines(multi, host, port, remotes, serviceState, view.display)].join('\n');
}

// ── The Display submenu (badge-display-options) — shared action-lines path ─────
// Six presets (four host + two tool) + the five axes (group/hosts/layout/density/
// tool-mark), ✓-active-marked LIVE from the current display. Rides actionClusterLines
// → BOTH single-host and multi-host dropdowns. Each choice shells to display-action.mjs
// under $ABS_NODE (NO osascript dialog, NO HTTP — enumerable values written directly).
const DISPLAY_ACTION = `${PLUGIN_DIR}/display-action.mjs`;

// Presets → the four layout axes { group, hosts, layout, density } (tool-mark is
// orthogonal — it persists across preset changes, FR-06/round-2 orthogonality).
export const DISPLAY_PRESETS = [
  { id: 'most-constrained-wide', label: 'Most-constrained · wide (today)', axes: { group: 'host', hosts: 'all', layout: 'single', density: 'wide' } },
  { id: 'single-compact', label: 'Single compact glyph', axes: { group: 'host', hosts: 'all', layout: 'single', density: 'compact' } },
  { id: 'all-compact-sbs', label: 'Compact glyphs side-by-side', axes: { group: 'host', hosts: 'all', layout: 'side-by-side', density: 'compact' } },
  { id: 'rotate-compact', label: 'Rotate hosts · compact', axes: { group: 'host', hosts: 'all', layout: 'alternating', density: 'compact' } },
  { id: 'tool-sbs', label: 'Claude vs Codex · side-by-side', axes: { group: 'tool', hosts: 'all', layout: 'side-by-side', density: 'compact' } },
  { id: 'tool-rotate', label: 'Rotate Claude / Codex · compact', axes: { group: 'tool', hosts: 'all', layout: 'alternating', density: 'compact' } },
];

// A preset is active ONLY when all four of its layout axes match the current
// display (a drifted axis → no preset marked, but each axis marks its own value).
function presetActive(preset, display) {
  const a = preset.axes;
  const hostsMatch = a.hosts === 'all'
    ? (display.hosts === 'all' || display.hosts == null)
    : false; // every shipped preset uses hosts:'all'; a custom host selection drifts
  return hostsMatch
    && a.group === (display.group || 'host')
    && a.layout === (display.layout || 'single')
    && a.density === (display.density || 'wide');
}

// The ✓-or-aligned-slot active marker (macOS checkmark-menu convention). Active
// rows are also bolded (belt-and-braces — the mark reads even if ✓ renders faint).
function activeMark(isActive) { return isActive ? '✓ ' : '   '; }
function activeFont(isActive) { return isActive ? ' font=bold' : ''; }

export function displayActionLines({ display = {}, remotes = [] } = {}) {
  const d = {
    hosts: display.hosts || 'all', layout: display.layout || 'single',
    density: display.density || 'wide', group: display.group || 'host',
    toolMark: display.toolMark || 'neutral',
  };
  const act = (verb, value) => `shell="${ABS_NODE}" param1="${DISPLAY_ACTION}" param2=${verb} param3="${value}" terminal=false refresh=true`;
  const lines = ['---', menuLine('🖥 Display', { color: COLOR_DROPDOWN_HEADER, inert: false })];
  // Presets (the friendly front).
  lines.push(submenuLine('Presets', { size: DROPDOWN_SECTION_SIZE, color: COLOR_DROPDOWN_SUBTLE }));
  for (const p of DISPLAY_PRESETS) {
    const on = presetActive(p, d);
    lines.push(`--${activeMark(on)}${sanitize(p.label)} | ${act('preset', p.id)}${activeFont(on)}`);
  }
  lines.push('-----');
  // Group by (radio).
  lines.push(submenuLine('Group by', { size: DROPDOWN_SECTION_SIZE, color: COLOR_DROPDOWN_SUBTLE }));
  for (const [val, lbl] of [['host', 'Host (machine)'], ['tool', 'Tool (◆ Claude / ▲ Codex)']]) {
    const on = d.group === val;
    lines.push(`--${activeMark(on)}${lbl} | ${act('group', val)}${activeFont(on)}`);
  }
  lines.push('-----');
  // Hosts (multi-select toggle). "All hosts" sentinel clears to all.
  lines.push(submenuLine('Hosts', { size: DROPDOWN_SECTION_SIZE, color: COLOR_DROPDOWN_SUBTLE }));
  const allOn = d.hosts === 'all';
  lines.push(`--${activeMark(allOn)}All hosts | ${act('hosts', 'all')}${activeFont(allOn)}`);
  const selected = Array.isArray(d.hosts) ? new Set(d.hosts) : new Set();
  for (const r of remotes) {
    const key = sanitizeHostPort(r.key);
    const on = selected.has(key);
    lines.push(`--${activeMark(on)}${sanitize(r.label)} (${r.addr}) | ${act('hosts', key)}${activeFont(on)}`);
  }
  lines.push('-----');
  // Layout (radio). This controls the menu-bar glyph only; the dropdown remains
  // the full per-host picture.
  lines.push(submenuLine('Glyph layout', { size: DROPDOWN_SECTION_SIZE, color: COLOR_DROPDOWN_SUBTLE }));
  for (const [val, lbl] of [['single', 'Single (tightest only)'], ['side-by-side', 'Side-by-side (up to 3)'], ['alternating', 'Alternating (one at a time)']]) {
    const on = d.layout === val;
    lines.push(`--${activeMark(on)}${lbl} | ${act('layout', val)}${activeFont(on)}`);
  }
  lines.push('-----');
  // Density (radio). Density changes the glyph cell, not the dropdown detail.
  lines.push(submenuLine('Glyph density', { size: DROPDOWN_SECTION_SIZE, color: COLOR_DROPDOWN_SUBTLE }));
  for (const [val, lbl] of [['wide', 'Wide (text glyph)'], ['compact', 'Compact (tight glyph)']]) {
    const on = d.density === val;
    lines.push(`--${activeMark(on)}${lbl} | ${act('density', val)}${activeFont(on)}`);
  }
  lines.push('-----');
  // Tool marks (radio) — neutral fallback · logos opt-in.
  lines.push(submenuLine('Tool marks', { size: DROPDOWN_SECTION_SIZE, color: COLOR_DROPDOWN_SUBTLE }));
  for (const [val, lbl] of [['neutral', 'Neutral (◆ / ▲)'], ['logo', 'Logos']]) {
    const on = d.toolMark === val;
    lines.push(`--${activeMark(on)}${lbl} | ${act('tool-mark', val)}${activeFont(on)}`);
  }
  return lines;
}

// ── The Legend submenu (badge-display-options) — static, both modes, on demand ─
// A 🛈 Legend row in the shared action-lines path (single + multi). A SwiftBar
// submenu (native click-to-reveal — ZERO plugin state). FULLY STATIC: literal
// sample+gloss rows, no config read, no dynamic value → no escaping surface. The
// copy is the design-spec Legend table, verbatim. Complete by design (every
// symbol the badge can emit). Sample cells colored via a literal color= where it
// aids reading.
export function legendLines() {
  return [
    '---',
    menuLine('🛈 Legend — what the marks mean', { color: COLOR_DROPDOWN_HEADER, inert: false }),
    submenuLine('Badge', { size: DROPDOWN_SECTION_SIZE, color: COLOR_DROPDOWN_SUBTLE }),
    submenuLine('▪ — llmdash mark; every status-bar glyph starts here.', { color: COLOR_DROPDOWN_TEXT, font: 'Menlo' }),
    submenuLine('· — separator between host, tool, and scope words.', { color: COLOR_DROPDOWN_TEXT, font: 'Menlo' }),
    submenuLine('▸ binding — this host is driving the status-bar glyph.', { color: COLOR_DROPDOWN_TEXT }),
    '-----',
    submenuLine('Freshness', { size: DROPDOWN_SECTION_SIZE, color: COLOR_DROPDOWN_SUBTLE }),
    submenuLine('46 — Fresh: a current reading.', { color: DROPDOWN_STATE_COLOR.good, font: 'Menlo' }),
    submenuLine('◷46 — Aging: reading is getting old.', { color: DROPDOWN_STATE_COLOR.aging, font: 'Menlo' }),
    submenuLine('⚠12 — Stale: too old to trust; may have moved.', { color: DROPDOWN_STATE_COLOR.stale, font: 'Menlo' }),
    submenuLine('— — No reading: no data yet (never a fake number).', { color: DROPDOWN_STATE_COLOR.muted, font: 'Menlo' }),
    submenuLine('⊘ — Offline: host unreachable (never a number).', { color: DROPDOWN_STATE_COLOR.offline, font: 'Menlo' }),
    '-----',
    submenuLine('Color', { size: DROPDOWN_SECTION_SIZE, color: COLOR_DROPDOWN_SUBTLE }),
    submenuLine('good — 50%+ remaining; plenty of room.', { color: DROPDOWN_STATE_COLOR.good }),
    submenuLine('warn — 20-49%; getting tight.', { color: DROPDOWN_STATE_COLOR.warn }),
    submenuLine('crit — under 20%; nearly out.', { color: DROPDOWN_STATE_COLOR.crit }),
    '-----',
    submenuLine('Number', { size: DROPDOWN_SECTION_SIZE, color: COLOR_DROPDOWN_SUBTLE }),
    submenuLine('12 — % remaining in the tightest tracked window (5-hour or weekly).', { color: COLOR_DROPDOWN_TEXT }),
    '-----',
    submenuLine('Tool', { size: DROPDOWN_SECTION_SIZE, color: COLOR_DROPDOWN_SUBTLE }),
    submenuLine('◆ — Claude Code.', { color: COLOR_DROPDOWN_TEXT }),
    submenuLine('▲ — Codex. Logos replace these marks in SwiftBar; side-by-side logo mode shows each tool as 5-hour/weekly.', { color: COLOR_DROPDOWN_TEXT }),
    '-----',
    submenuLine('Multi-host', { size: DROPDOWN_SECTION_SIZE, color: COLOR_DROPDOWN_SUBTLE }),
    submenuLine('St12 — host cue plus % in compact side-by-side mode.', { color: COLOR_DROPDOWN_TEXT, font: 'Menlo' }),
    submenuLine('+2 — more hosts exist beyond the side-by-side cap.', { color: COLOR_DROPDOWN_TEXT, font: 'Menlo' }),
    '-----',
    submenuLine('This menu', { size: DROPDOWN_SECTION_SIZE, color: COLOR_DROPDOWN_SUBTLE }),
    submenuLine('✓ — active choice in Display.', { color: COLOR_DROPDOWN_TEXT }),
    submenuLine('＋ — add or install.', { color: COLOR_DROPDOWN_TEXT }),
    submenuLine('－ — remove.', { color: COLOR_DROPDOWN_TEXT }),
    submenuLine('☰ — watched-host count.', { color: COLOR_DROPDOWN_TEXT }),
    submenuLine('🖥 — Display settings.', { color: COLOR_DROPDOWN_TEXT }),
    submenuLine('🛈 — this legend.', { color: COLOR_DROPDOWN_TEXT }),
    submenuLine('⊘ — unavailable or uninstall.', { color: COLOR_DROPDOWN_TEXT }),
    submenuLine('▬ — remove the badge only.', { color: COLOR_DROPDOWN_TEXT }),
  ];
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
    // The badge display prefs (badge-display-options), read on the render tick off
    // the request path; a thrown read → today's defaults (never a crash).
    const display = displayFromConfig();
    const localMode = localModeFromCombined(combined);
    const multi = computeMultiBadge(combined, { localMode });
    const remotes = remotesFromCombined(combined);
    // The byte-for-byte routing split (FR-02): the all-default display routes to the
    // SHIPPED emit()/emitMulti() path (unchanged save the ratified ◆/▲ cue). A
    // non-default axis engages the new applyDisplay/emitDisplay glyph — over the
    // FULL multi (the dropdown still renders every host).
    if (isDefaultDisplay(display)) {
      if (multi.mode === 'single') {
        // Single-host / unconfigured → byte-for-byte the shipped badge. Unwrap the
        // one host's state and run the EXISTING computeBadge/emit path unchanged.
        const only = (combined.hosts || []).find((h) => h && h.self) || (combined.hosts || [])[0];
        const state = only && only.state ? only.state : null;
        process.stdout.write(emit(computeBadge(state || { tools: [] }), { host: HOST, port: PORT, serviceState, display }) + '\n');
      } else {
        process.stdout.write(emitMulti(multi, { host: HOST, port: PORT, remotes, serviceState, display }) + '\n');
      }
    } else {
      // Non-default display: build the glyph view over the full multi. computeMultiBadge
      // returns mode:'single' when only one host is effectively watched — in that case
      // the applyDisplay view has one host too (still a valid compact/wide cell). We
      // always have hostViews (even single), so applyDisplay works over both.
      const view = applyDisplay(multi, display, { epochMs: Date.now() });
      process.stdout.write(emitDisplay(view, multi, { host: HOST, port: PORT, remotes, serviceState }) + '\n');
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
