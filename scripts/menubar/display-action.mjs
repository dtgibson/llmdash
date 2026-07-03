#!/usr/bin/env node
// llmdash — the badge's Display-preferences write helper (badge-display-options).
//
// Invoked by the SwiftBar Display-submenu actions under the wrapper's ABSOLUTE node:
//   Preset      → shell="$ABS_NODE" param1=".../display-action.mjs" param2=preset    param3="<preset-id>"
//   Group by    →                    …                             param2=group     param3="host|tool"
//   Hosts       →                    …                             param2=hosts     param3="<key>|all"
//   Layout      →                    …                             param2=layout    param3="single|side-by-side|alternating"
//   Density     →                    …                             param2=density   param3="wide|compact"
//   Tool marks  →                    …                             param2=tool-mark param3="neutral|logo"
// (terminal=false windowless, refresh=true so the glyph + submenu marks reflect the
// new setting on the next render — no restart.)
//
// It writes the LOCAL hosts.conf's !display-* directives via src/host-config.js's
// atomic temp+rename (writeDisplayConfig) — NO HTTP mutation, so the dashboard's
// serve-only/405 posture is preserved (NFR-02). NO osascript dialog: every value
// is an ENUMERABLE menu choice passed on ARGV and written directly (there is no
// typed input on this path → no injection surface, FR-08). ARGV-only, no shell,
// runs under process.execPath / $ABS_NODE (a bare "node" is dead under the minimal
// spawn PATH — the standing lesson). Node builtins + host-config.js only.
//
// TEST SEAM: `--file=<scratch>` points the write at a scratch hosts.conf so the
// round-trip is testable WITHOUT touching the real data dir (mirrors the other
// action helpers). The write logic itself lives in host-config.js (this helper is
// thin: it decodes the verb → a partial display change → writeDisplayConfig).

import { writeDisplayConfig, readDisplayConfig, DISPLAY_DEFAULTS } from '../../src/host-config.js';
import { config } from '../../config.js';

// The preset id → the four layout axes it writes ({ group, hosts, layout, density };
// tool-mark is orthogonal and left untouched). Kept in lockstep with the badge's
// DISPLAY_PRESETS (same ids/axes) — the submenu offers them, this helper writes them.
export const PRESET_AXES = {
  'most-constrained-wide': { group: 'host', hosts: 'all', layout: 'single', density: 'wide' },
  'single-compact': { group: 'host', hosts: 'all', layout: 'single', density: 'compact' },
  'all-compact-sbs': { group: 'host', hosts: 'all', layout: 'side-by-side', density: 'compact' },
  'rotate-compact': { group: 'host', hosts: 'all', layout: 'alternating', density: 'compact' },
  'tool-sbs': { group: 'tool', hosts: 'all', layout: 'side-by-side', density: 'compact' },
  'tool-rotate': { group: 'tool', hosts: 'all', layout: 'alternating', density: 'compact' },
};

const LAYOUTS = new Set(['single', 'side-by-side', 'alternating']);
const DENSITIES = new Set(['wide', 'compact']);
const GROUPS = new Set(['host', 'tool']);
const TOOL_MARKS = new Set(['neutral', 'logo']);
// The badge's sanitized host:port vocabulary — a hosts toggle key never carries a
// free-form string (mirrors sanitizeHostPort in the badge / hosts.js).
function sanitizeKey(s) { return String(s == null ? '' : s).replace(/[^A-Za-z0-9._:\-\[\]]/g, ''); }

// Toggle a host key in/out of the current selection; "all" clears to the sentinel.
// An empty selection after a toggle writes 'all' (never an empty glyph → never an
// empty selection). Returns the next hosts value ('all' | [keys]).
export function toggleHost(current, key) {
  if (key === 'all') return 'all';
  const k = sanitizeKey(key);
  if (!k) return current === undefined ? 'all' : current;
  const list = Array.isArray(current) ? current.slice() : (current === 'all' || current == null ? [] : [current]);
  const idx = list.indexOf(k);
  if (idx === -1) list.push(k);
  else list.splice(idx, 1);
  return list.length ? list : 'all';
}

// ── runCli — decode the verb → a partial display change → writeDisplayConfig ───
// Returns { ok, ... } (never throws for a known verb; an unknown verb/value is a
// reported failure that writes NOTHING). opts.hostsFile / --file= point at a
// scratch file in tests. hostsRaw is passed so a first-ever write seeds coherently.
export function runCli(argv = process.argv.slice(2), env = process.env, opts = {}) {
  const [verb, ...rest] = argv;
  const fileFlag = rest.find((a) => a.startsWith('--file='));
  const hostsFile = opts.hostsFile || (fileFlag ? fileFlag.slice('--file='.length) : config.hostsFile);
  const hostsRaw = opts.hostsRaw !== undefined ? opts.hostsRaw : config.hostsRaw;
  const value = rest.find((a) => !a.startsWith('--'));

  if (verb === 'preset') {
    const axes = Object.prototype.hasOwnProperty.call(PRESET_AXES, value) ? PRESET_AXES[value] : null;
    if (!axes) return { ok: false, reason: 'unknown-preset', detail: value };
    // Writes the FOUR layout axes; leaves tool-mark untouched (orthogonality).
    return writeDisplayConfig(hostsFile, { ...axes }, { hostsRaw });
  }
  if (verb === 'group') {
    if (!GROUPS.has(value)) return { ok: false, reason: 'bad-value', detail: value };
    return writeDisplayConfig(hostsFile, { group: value }, { hostsRaw });
  }
  if (verb === 'layout') {
    if (!LAYOUTS.has(value)) return { ok: false, reason: 'bad-value', detail: value };
    return writeDisplayConfig(hostsFile, { layout: value }, { hostsRaw });
  }
  if (verb === 'density') {
    if (!DENSITIES.has(value)) return { ok: false, reason: 'bad-value', detail: value };
    return writeDisplayConfig(hostsFile, { density: value }, { hostsRaw });
  }
  if (verb === 'tool-mark') {
    if (!TOOL_MARKS.has(value)) return { ok: false, reason: 'bad-value', detail: value };
    return writeDisplayConfig(hostsFile, { toolMark: value }, { hostsRaw });
  }
  if (verb === 'hosts') {
    // A multi-select TOGGLE: read the current selection, toggle the passed key (or
    // set 'all'), write the new list. An unknown value degrades to 'all' via
    // toggleHost's empty-list guard, never an empty glyph.
    let current = 'all';
    try { current = (readDisplayConfig({ hostsFile, hostsRaw }) || DISPLAY_DEFAULTS).hosts; } catch { current = 'all'; }
    const next = toggleHost(current, value === 'all' ? 'all' : sanitizeKey(value));
    return writeDisplayConfig(hostsFile, { hosts: next }, { hostsRaw });
  }
  return { ok: false, reason: 'unknown-action', detail: verb };
}

// Run only when invoked directly (not when imported by tests). Compare REAL paths
// so a symlinked invocation still fires, mirroring the plugin's run-guard.
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}
if (invokedDirectly()) {
  const res = runCli();
  // Exit non-zero on a hard failure so the caller (SwiftBar) can tell, but never
  // throw (that would surface the host's own error dialog).
  if (!res || !res.ok) process.exitCode = 1;
}
