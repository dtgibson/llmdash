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
function dropdownLines(badge, host, port) {
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

export function emit(badge, { host = HOST, port = PORT, offline = false } = {}) {
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
  return [title, ...dropdownLines(badge, host, port)].join('\n');
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

// ── main ────────────────────────────────────────────────────────────────────
export async function main() {
  let state;
  try {
    state = await fetchState(HOST, PORT);
  } catch {
    // Fetch failed / timed out / non-200 / bad JSON → offline. Never a crash,
    // never a fabricated number.
    process.stdout.write(emit(null, { host: HOST, port: PORT, offline: true }) + '\n');
    return;
  }
  try {
    process.stdout.write(emit(computeBadge(state), { host: HOST, port: PORT }) + '\n');
  } catch {
    // Last-resort guard: a thrown computeBadge/emit still lands on offline
    // rather than crashing the plugin (which would show the host's own error).
    process.stdout.write(emit(null, { host: HOST, port: PORT, offline: true }) + '\n');
  }
}

// Run only when invoked as the plugin, not when imported by the test suite.
// (Mirrors the src/server.js entry-point guard.)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
