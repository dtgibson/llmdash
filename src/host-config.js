// The host-config FILE layer — the one new persistence in multi-host-badge.
//
// The watched-host list is now a small line-oriented text file (hosts.conf under
// config.dataDir), NOT a table: it has no other history worth keeping, it must be
// hand-editable and append/remove-safe, and the poller re-reads it each tick. See
// pipeline/multi-host-badge/schema.md §"The config file" and §Precedence.
//
// This module owns: (a) READING the file into the exact string parseHosts already
// consumes, applying the seed-once precedence (file wins; env seeds the file once
// when absent; neither = today's single-host), and (b) the local WRITE helpers the
// badge's Add/Remove actions drive (atomic temp+rename, mode 0o600), reusing
// src/hosts.js's sanitizeHostPort + parseHosts per-entry grammar — one parser, one
// sanitizer, both surfaces. Also the optional `!local=` monitoring-station directive.
//
// Pure/injectable: every function takes its fs (and hostsFile/hostsRaw) so the
// parse/merge/precedence and the write round-trip are unit-testable without
// touching the real data dir. node:fs only — no npm dep, no build step, and never
// a subprocess. Nothing here runs on the HTTP request path (the read is on the
// poller tick; the write is in the badge process).

import realFs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { sanitizeHostPort, parseHosts } from './hosts.js';

// The file body ↔ LLMDASH_HOSTS grammar mapping (the load-bearing reuse):
// LLMDASH_HOSTS is a COMMA-separated list of host[:port][=label]; the file is
// NEWLINE-separated (append/remove-safe). Strip comment/blank/directive lines and
// join the rest with ',' → the same string parseHosts already parses. Labels may
// contain spaces and '=' (parseHosts splits on the first '='); a label may NOT
// contain a newline — the line IS the record delimiter, so writes strip \r\n.

const DIRECTIVE_LOCAL = '!local'; // the monitoring-station include/exclude/auto knob
const LOCAL_MODES = new Set(['include', 'exclude', 'auto']);

// ── The five !display-* directives (badge-display-options) ────────────────────
// The badge's per-glyph display prefs live here alongside !local= (CFG call: one
// file, one parser, no sibling prefs file — the host-LIST axis comma-joins
// cleanly into the grammar hosts.conf already speaks). Each axis is enumerable
// against a fixed Set (unknown value → the axis default + a bad-display-* error,
// surfaced in health, never a crash); the host-LIST axis is a raw string resolved
// against the LIVE hostViews at the badge (not here — host-config.js stays pure,
// no /api/hosts dependency). The tool-mark and group axes were folded in round 2.
const DIRECTIVE_DISPLAY_HOSTS = '!display-hosts';
const DIRECTIVE_DISPLAY_LAYOUT = '!display-layout';
const DIRECTIVE_DISPLAY_DENSITY = '!display-density';
const DIRECTIVE_DISPLAY_GROUP = '!display-group';
const DIRECTIVE_DISPLAY_TOOL_MARK = '!display-tool-mark';
const LAYOUTS = new Set(['single', 'side-by-side', 'alternating']);
const DENSITIES = new Set(['wide', 'compact']);
const GROUPS = new Set(['host', 'tool']);
const TOOL_MARKS = new Set(['neutral', 'logo']);

// The axis defaults — ALL absent ⇒ byte-for-byte today's badge (save the ratified
// C/X→◆/▲ neutral tool cue). Exposed so the writer knows which values to OMIT
// (a default-valued axis writes NOTHING → an unconfigured file stays clean).
export const DISPLAY_DEFAULTS = Object.freeze({
  hosts: 'all', layout: 'single', density: 'wide', group: 'host', toolMark: 'neutral',
});

// Parse the host-LIST directive value into 'all' | [sanitized host:port keys].
// 'all' (case-insensitive), empty, or absent ⇒ 'all' (every host — never an empty
// glyph). Otherwise a comma-joined list of keys, each stripped to the badge's
// sanitized host:port vocabulary ([A-Za-z0-9._:\-\[\]], mirroring src/hosts
// sanitizeHostPort) so a stored key is never a free-form string. Host keys are
// CASE-PRESERVED — they are case-sensitive identities that must match the badge's
// addr (also case-preserving); lowercasing here would silently break the glyph
// filter for any key with an uppercase letter (e.g. a `Studio.local` Bonjour name).
// Unknown keys are dropped at the BADGE (resolved against live hostViews), not here.
function parseDisplayHosts(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw || raw.toLowerCase() === 'all') return 'all';
  const keys = raw
    .split(',')
    .map((k) => k.replace(/[^A-Za-z0-9._:\-\[\]]/g, '').trim())
    .filter(Boolean);
  return keys.length ? keys : 'all';
}

// Split raw file text into { entryLines, localMode, display, directiveErrors }.
// A line is:
//   - blank / whitespace-only        → ignored
//   - starts with '#'                → comment, ignored
//   - '!local=include|exclude|auto'  → the directive (last one wins); bad value → error, default
//   - '!display-*=…'                 → a display axis (last one wins); bad value → error, default
//   - any other '!…'                 → unknown-directive error (never a silent host entry)
//   - anything else                  → a host entry line (fed to parseHosts)
function splitFileText(text) {
  const entryLines = [];
  let localMode = 'auto';
  const display = { ...DISPLAY_DEFAULTS };
  const directiveErrors = [];
  for (const rawLine of String(text == null ? '' : text).split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('!')) {
      // A directive line. Only !local= and !display-* are defined; an unknown
      // directive is an honest error (surfaced), never a silent host entry.
      const eq = line.indexOf('=');
      const name = (eq === -1 ? line : line.slice(0, eq)).trim();
      // Enum axes (!local, layout/density/group/tool-mark) are lowercase vocabularies,
      // so they match against the lowercased `value`. !display-hosts carries
      // case-sensitive host:port identities and parses the case-PRESERVED rawValue —
      // the badge's addr preserves case, so lowercasing here would break the filter.
      const rawValue = (eq === -1 ? '' : line.slice(eq + 1)).trim();
      const value = rawValue.toLowerCase();
      if (name === DIRECTIVE_LOCAL) {
        if (LOCAL_MODES.has(value)) localMode = value;
        else directiveErrors.push({ entry: line, reason: 'bad-local-directive' });
      } else if (name === DIRECTIVE_DISPLAY_HOSTS) {
        display.hosts = parseDisplayHosts(rawValue); // 'all' | [case-preserved keys]; never an error (dropped keys resolve at the badge)
      } else if (name === DIRECTIVE_DISPLAY_LAYOUT) {
        if (LAYOUTS.has(value)) display.layout = value;
        else directiveErrors.push({ entry: line, reason: 'bad-display-layout' });
      } else if (name === DIRECTIVE_DISPLAY_DENSITY) {
        if (DENSITIES.has(value)) display.density = value;
        else directiveErrors.push({ entry: line, reason: 'bad-display-density' });
      } else if (name === DIRECTIVE_DISPLAY_GROUP) {
        if (GROUPS.has(value)) display.group = value;
        else directiveErrors.push({ entry: line, reason: 'bad-display-group' });
      } else if (name === DIRECTIVE_DISPLAY_TOOL_MARK) {
        if (TOOL_MARKS.has(value)) display.toolMark = value;
        else directiveErrors.push({ entry: line, reason: 'bad-display-tool-mark' });
      } else {
        directiveErrors.push({ entry: line, reason: 'unknown-directive' });
      }
      continue;
    }
    entryLines.push(line);
  }
  return { entryLines, localMode, display, directiveErrors };
}

// entryLines[] → the comma-joined LLMDASH_HOSTS-grammar string parseHosts consumes.
function entryLinesToRaw(entryLines) {
  return entryLines.join(',');
}

// The env seed → the initial file body (a commented header + one line per entry).
// Split LLMDASH_HOSTS on commas, keep the entries verbatim (parseHosts will
// validate/sanitize them at read time exactly as it does for a hand-typed file);
// a newline in an entry is stripped (the line is the record delimiter).
const FILE_HEADER = [
  '# llmdash watched hosts — one per line, format: host[:port][=label]',
  '# Lines starting with # are comments. Edited live by the badge (Add/Remove) or by hand.',
  '# Optional directive: !local=include|exclude|auto  (monitoring-station local-host emphasis; default auto)',
  '# Optional badge display prefs (set live from the badge\'s Display submenu):',
  '#   !display-hosts=all|host:port,host:port   !display-layout=single|side-by-side|alternating',
  '#   !display-density=wide|compact   !display-group=host|tool   !display-tool-mark=neutral|logo',
];
function seedBodyFromEnv(hostsRaw) {
  const entries = String(hostsRaw == null ? '' : hostsRaw)
    .split(',')
    .map((e) => e.replace(/[\r\n]/g, '').trim())
    .filter(Boolean);
  return [...FILE_HEADER, ...entries, ''].join('\n');
}

// Atomic temp+rename write on the SAME filesystem, mode 0o600. No partial file is
// ever observable and concurrent writes are last-write-wins without corruption
// (OQ-06 — no lock; the atomic rename suffices for a single-user tool). A unique
// temp suffix (pid + counter) so overlapping writes don't collide on the temp path.
let tmpCounter = 0;
function atomicWrite(hostsFile, body, fs) {
  const tmp = `${hostsFile}.tmp.${process.pid}.${tmpCounter++}`;
  fs.writeFileSync(tmp, body, { mode: 0o600 });
  try {
    fs.renameSync(tmp, hostsFile);
  } catch (e) {
    // Rename failed — clean up the temp so it never leaks, then rethrow so the
    // caller reports an honest write failure ("Nothing changed").
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
}

// A module-level once-latch for the unreadable-file failure, mirroring
// claude-refresh's loggedCauses: an unreadable file logs ONCE (not every tick).
// A successful read clears it so a recovered file re-arms the latch.
const loggedConfigErrors = new Set();
export function _resetConfigErrorLatch() { loggedConfigErrors.clear(); }

// ── readHostsConfig — the runtime source of truth, with precedence ────────────
// Returns { source, raw, localMode, error, fileErrors }:
//   source ∈ 'file' | 'env-seed' | 'none'
//   raw       = the comma-joined host[:port][=label] string to feed parseHosts
//   localMode = 'include' | 'exclude' | 'auto'  (from the !local= directive; default auto)
//   error     = null | { reason: 'unreadable', detail }   (the WHOLE-FILE failure, FR-04)
//   fileErrors= [] | [{ entry, reason }]   (per-line directive errors; host errors surface via parseHosts)
//
// Precedence (FR-02, seed-once):
//   file present (readable)      → source 'file'    — the file is the runtime truth; LLMDASH_HOSTS ignored
//   file absent + LLMDASH_HOSTS  → source 'env-seed' — seed the file once (atomic), then read it back
//   file absent + no env         → source 'none'    — raw '' → parseHosts yields [local] (single-host)
//   file present but EMPTY       → source 'file', raw '' — zero remotes; env does NOT re-seed (Remove sticks)
//   file UNREADABLE (IO/perm)    → error{unreadable} + fall back to env seed (or '' = last-good local); log once
export function readHostsConfig({
  hostsFile = config.hostsFile,
  hostsRaw = config.hostsRaw,
  fs = realFs,
} = {}) {
  // Does the file exist? Distinguish "absent" (→ maybe seed) from "present but
  // unreadable" (→ honest degradation, NEVER a seed that would clobber it).
  let exists = false;
  try { exists = fs.existsSync(hostsFile); } catch { exists = false; }

  if (exists) {
    let text;
    try {
      text = fs.readFileSync(hostsFile, 'utf8');
    } catch (e) {
      // Unreadable (permission/IO error). Fall back to the env seed as the last-
      // good remote set (or '' → local-only); log once; never crash, never clobber.
      const detail = e && e.message ? e.message : 'read failed';
      if (!loggedConfigErrors.has('unreadable')) {
        loggedConfigErrors.add('unreadable');
        console.error(`hosts.conf unreadable (${detail}) — falling back to LLMDASH_HOSTS/last-good; fix the file and it will be re-read. (${hostsFile})`);
      }
      const { entryLines, localMode } = splitFileText(seedBodyFromEnv(hostsRaw));
      return {
        source: 'env-seed',
        raw: entryLinesToRaw(entryLines),
        localMode,
        error: { reason: 'unreadable', detail },
        fileErrors: [],
      };
    }
    // Readable — the file wins (even when empty: emptiness is honest, Remove sticks).
    loggedConfigErrors.delete('unreadable'); // recovered → re-arm the once-latch
    const { entryLines, localMode, display, directiveErrors } = splitFileText(text);
    return {
      source: 'file',
      raw: entryLinesToRaw(entryLines),
      localMode,
      display,
      error: null,
      fileErrors: directiveErrors,
    };
  }

  // File absent. Seed from LLMDASH_HOSTS if set, else single-host.
  const envHas = String(hostsRaw == null ? '' : hostsRaw).trim() !== '';
  if (envHas) {
    // Seed the file ONCE (best-effort); whether the write succeeds or not, this
    // tick reads the env-seed grammar. If the write fails we simply seed again
    // next tick — never a crash. Reuse the same split so the raw is consistent.
    const body = seedBodyFromEnv(hostsRaw);
    try { atomicWrite(hostsFile, body, fs); } catch { /* best-effort; retried next tick */ }
    const { entryLines, localMode, display } = splitFileText(body);
    return { source: 'env-seed', raw: entryLinesToRaw(entryLines), localMode, display, error: null, fileErrors: [] };
  }
  return { source: 'none', raw: '', localMode: 'auto', display: { ...DISPLAY_DEFAULTS }, error: null, fileErrors: [] };
}

// ── readDisplayConfig — the parsed { hosts, layout, density, group, toolMark } ─
// The named export the badge imports (one import, one place). Returns the display
// axes with the defaults already applied (an absent file / unreadable file → the
// all/single/wide/host/neutral default). The badge's displayFromConfig() wraps
// this in a try/catch so a thrown read degrades to today's badge, never a crash.
export function readDisplayConfig({
  hostsFile = config.hostsFile,
  hostsRaw = config.hostsRaw,
  fs = realFs,
} = {}) {
  const r = readHostsConfig({ hostsFile, hostsRaw, fs });
  return r.display ? r.display : { ...DISPLAY_DEFAULTS };
}

// ── seedHostsConfigIfAbsent — explicit first-run seed (used at server startup) ─
// Writes the file from LLMDASH_HOSTS iff the file is absent AND the env is set.
// Returns true when it wrote (seeded), false otherwise. readHostsConfig already
// seeds lazily on the first tick; this is the explicit call the server may use so
// the file exists from process start. Idempotent (a present file is never touched).
export function seedHostsConfigIfAbsent({
  hostsFile = config.hostsFile,
  hostsRaw = config.hostsRaw,
  fs = realFs,
} = {}) {
  let exists = false;
  try { exists = fs.existsSync(hostsFile); } catch { exists = false; }
  if (exists) return false;
  if (String(hostsRaw == null ? '' : hostsRaw).trim() === '') return false;
  try { atomicWrite(hostsFile, seedBodyFromEnv(hostsRaw), fs); return true; }
  catch { return false; }
}

// ── listHosts — the current remote (non-self) set, parsed from the file ────────
// Returns [{ host, port, label, key }] for the remote entries (never the local
// host — it is always present and not file-listed). Reuses parseHosts so the file
// and LLMDASH_HOSTS share one grammar. Used by the badge's Remove submenu + List.
export function listHosts({
  hostsFile = config.hostsFile,
  hostsRaw = config.hostsRaw,
  fs = realFs,
  cfg = config,
  tailnet = undefined,
} = {}) {
  const cfgRead = readHostsConfig({ hostsFile, hostsRaw, fs });
  const parsed = tailnet === undefined
    ? parseHosts(cfgRead.raw, cfg)
    : parseHosts(cfgRead.raw, cfg, tailnet);
  return parsed.hosts
    .filter((h) => !h.self)
    .map((h) => ({ host: h.host, port: h.port, label: h.label, key: h.key }));
}

// ── Serialize the non-default !display-* directives (round-trip helper) ────────
// Default-valued axes are OMITTED (an unconfigured file stays clean and the
// byte-for-byte-today guard holds at the file level). The host-LIST axis writes
// 'all' as nothing (default) or its comma-joined keys. Order is fixed for a
// deterministic file. `display` is a { hosts, layout, density, group, toolMark }
// object (any subset; missing axes fall to the defaults → omitted).
function displayDirectiveLines(display) {
  if (!display) return [];
  const lines = [];
  const hosts = display.hosts;
  if (hosts && hosts !== 'all') {
    const val = Array.isArray(hosts) ? hosts.join(',') : String(hosts);
    if (val && val !== 'all') lines.push(`${DIRECTIVE_DISPLAY_HOSTS}=${val}`);
  }
  if (display.layout && LAYOUTS.has(display.layout) && display.layout !== DISPLAY_DEFAULTS.layout) {
    lines.push(`${DIRECTIVE_DISPLAY_LAYOUT}=${display.layout}`);
  }
  if (display.density && DENSITIES.has(display.density) && display.density !== DISPLAY_DEFAULTS.density) {
    lines.push(`${DIRECTIVE_DISPLAY_DENSITY}=${display.density}`);
  }
  if (display.group && GROUPS.has(display.group) && display.group !== DISPLAY_DEFAULTS.group) {
    lines.push(`${DIRECTIVE_DISPLAY_GROUP}=${display.group}`);
  }
  if (display.toolMark && TOOL_MARKS.has(display.toolMark) && display.toolMark !== DISPLAY_DEFAULTS.toolMark) {
    lines.push(`${DIRECTIVE_DISPLAY_TOOL_MARK}=${display.toolMark}`);
  }
  return lines;
}

// ── writeHostsConfig — rewrite the file from a list of entry strings (atomic) ──
// entries[] are raw host[:port][=label] strings (already validated by the caller);
// newline-stripped per entry (the line is the record delimiter). Preserves the
// !local directive AND the five !display-* directives when provided, so a host
// Add/Remove never disturbs the display axes (Risk 5, round-trip ALL directives).
// This is the low-level writer add/removeHost + writeDisplayConfig use.
export function writeHostsConfig(hostsFile, entries, { fs = realFs, localMode = null, display = null } = {}) {
  const lines = [...FILE_HEADER];
  if (localMode && LOCAL_MODES.has(localMode) && localMode !== 'auto') {
    lines.push(`${DIRECTIVE_LOCAL}=${localMode}`);
  }
  for (const d of displayDirectiveLines(display)) lines.push(d);
  for (const e of entries) {
    const clean = String(e == null ? '' : e).replace(/[\r\n]/g, '').trim();
    if (clean) lines.push(clean);
  }
  lines.push('');
  atomicWrite(hostsFile, lines.join('\n'), fs);
}

// Read the current file into { entries, localMode, display }, where entries[] are
// the raw host-entry lines (verbatim, for round-tripping labels) and display is
// the parsed five-axis object. Absent/unreadable file → seed from env (so an Add
// before the first read still lands in a coherent file).
function readEntries({ hostsFile, hostsRaw, fs }) {
  let text = null;
  try {
    if (fs.existsSync(hostsFile)) text = fs.readFileSync(hostsFile, 'utf8');
  } catch { text = null; }
  if (text == null) text = seedBodyFromEnv(hostsRaw);
  const { entryLines, localMode, display } = splitFileText(text);
  return { entries: entryLines, localMode, display };
}

// ── writeDisplayConfig — write the display axes, preserving everything else ────
// Reads the current entries + !local + display, merges the passed axis change(s)
// over the current display, and rewrites atomically. A display edit NEVER disturbs
// the host list or !local; default-valued axes are omitted. `next` is a partial
// { hosts?, layout?, density?, group?, toolMark? } — only the passed axes change.
// The badge's display-action.mjs is the only caller (the enumerable-value write).
export function writeDisplayConfig(hostsFile, next, {
  fs = realFs,
  hostsRaw = config.hostsRaw,
} = {}) {
  const { entries, localMode, display } = readEntries({ hostsFile, hostsRaw, fs });
  const merged = { ...DISPLAY_DEFAULTS, ...(display || {}), ...(next || {}) };
  try {
    writeHostsConfig(hostsFile, entries, { fs, localMode, display: merged });
  } catch (e) {
    return { ok: false, reason: 'write-failed', detail: e && e.message ? e.message : 'write failed' };
  }
  return { ok: true, display: merged };
}

// ── addHost — sanitize → validate → dedupe → atomic append (FR-15) ────────────
// entry = a raw host[:port][=label] string (from the osascript dialog, ARGV-only).
// Returns { ok:true, canonical } on a successful append, or
//   { ok:false, reason:'invalid'|'duplicate'|'write-failed', detail? }  — NOTHING
// written on invalid/duplicate. Reuses parseHosts's per-entry grammar to validate
// exactly as LLMDASH_HOSTS does; a host that is empty-after-sanitize or has a bad
// port is 'invalid'; a host:port already in the set is 'duplicate' (deduped,
// honestly reported). The stored label is newline-stripped at write; a '|' in a
// label is inert (scrubbed at render by the badge's sanitize()).
export function addHost(hostsFile, entry, {
  fs = realFs,
  hostsRaw = config.hostsRaw,
  cfg = config,
  tailnet = undefined,
} = {}) {
  const raw = String(entry == null ? '' : entry).replace(/[\r\n]/g, ' ').trim();
  if (!raw) return { ok: false, reason: 'invalid', detail: 'empty' };

  // Validate the single entry through the SAME parser LLMDASH_HOSTS uses. Parse it
  // ALONE (no other entries) so exactly one host/error tells us if it is valid.
  const solo = tailnet === undefined
    ? parseHosts(raw, cfg)
    : parseHosts(raw, cfg, tailnet);
  if (solo.errors && solo.errors.length) {
    return { ok: false, reason: 'invalid', detail: solo.errors[0].reason };
  }
  const parsedEntry = solo.hosts.find((h) => !h.self);
  if (!parsedEntry) {
    // The entry resolved to the LOCAL host (e.g. someone typed 127.0.0.1) — the
    // local host is always present and never file-listed; adding it is a no-op we
    // report as a duplicate, honestly (it is already "watched").
    return { ok: false, reason: 'duplicate', detail: 'local host is always included' };
  }

  const { entries, localMode, display } = readEntries({ hostsFile, hostsRaw, fs });

  // Dedupe by sanitized host:port (identity), reusing the existing set's parse.
  const existing = tailnet === undefined
    ? parseHosts(entryLinesToRaw(entries), cfg)
    : parseHosts(entryLinesToRaw(entries), cfg, tailnet);
  if (existing.hosts.some((h) => !h.self && h.key === parsedEntry.key)) {
    const dup = existing.hosts.find((h) => !h.self && h.key === parsedEntry.key);
    return { ok: false, reason: 'duplicate', detail: dup ? dup.label : parsedEntry.key };
  }

  // Canonical stored line: sanitized host, explicit :port when non-default,
  // =label when a label was given (labels retained raw for render-time escape,
  // only newline-stripped here). This normalizes what lands in the file.
  const host = sanitizeHostPort(parsedEntry.host);
  const defaultPort = Number(cfg.port);
  let canonical = host;
  if (Number(parsedEntry.port) !== defaultPort) canonical += `:${parsedEntry.port}`;
  const gaveLabel = parsedEntry.label && parsedEntry.label !== parsedEntry.host;
  if (gaveLabel) canonical += `=${String(parsedEntry.label).replace(/[\r\n]/g, ' ').trim()}`;

  try {
    writeHostsConfig(hostsFile, [...entries, canonical], { fs, localMode, display });
  } catch (e) {
    return { ok: false, reason: 'write-failed', detail: e && e.message ? e.message : 'write failed' };
  }
  return { ok: true, canonical };
}

// ── removeHost — drop the entry matching a host:port key, atomically (FR-16) ───
// key = a sanitized "host:port" identity (what the badge's Remove submenu passes).
// Returns { ok:true, removed } or { ok:false, reason:'not-found'|'is-local'|'write-failed' }.
// The LOCAL host is never removable (it is always present); its sentinel key
// 'local:<port>' is refused. Rewrites the file atomically without the matched line.
export function removeHost(hostsFile, key, {
  fs = realFs,
  hostsRaw = config.hostsRaw,
  cfg = config,
  tailnet = undefined,
} = {}) {
  const wantKey = String(key == null ? '' : key).replace(/[\r\n\s]/g, '');
  if (!wantKey) return { ok: false, reason: 'not-found' };
  if (wantKey.startsWith('local:')) return { ok: false, reason: 'is-local' };

  const { entries, localMode, display } = readEntries({ hostsFile, hostsRaw, fs });

  // Match each stored entry to its parsed key; drop the one whose key == wantKey.
  // Parse entries one at a time so a per-line key maps back to its exact source
  // line (a whole-list parse dedupes and would lose the source-line correspondence).
  const kept = [];
  let removedLabel = null;
  for (const line of entries) {
    const solo = tailnet === undefined ? parseHosts(line, cfg) : parseHosts(line, cfg, tailnet);
    const peer = solo.hosts.find((h) => !h.self);
    // A local-collapsing or malformed line has no remote peer; keep it verbatim
    // (never silently drop a line we can't key — that would be a stealth edit).
    if (peer && peer.key === wantKey) { removedLabel = peer.label; continue; }
    kept.push(line);
  }
  if (removedLabel == null) return { ok: false, reason: 'not-found' };

  try {
    writeHostsConfig(hostsFile, kept, { fs, localMode, display });
  } catch (e) {
    return { ok: false, reason: 'write-failed', detail: e && e.message ? e.message : 'write failed' };
  }
  return { ok: true, removed: removedLabel };
}

// ── configFileHealth — a cheap fs check for the startup/health readout (FR-21) ─
// Names the config-file state (present / seeded-from-env / missing / malformed /
// unreadable) + the fix. Off the request path (fs stat/read only, no subprocess).
export function configFileHealth({
  hostsFile = config.hostsFile,
  hostsRaw = config.hostsRaw,
  fs = realFs,
} = {}) {
  const cfgRead = readHostsConfig({ hostsFile, hostsRaw, fs });
  return {
    file: hostsFile,
    source: cfgRead.source,       // 'file' | 'env-seed' | 'none'
    error: cfgRead.error,         // { reason:'unreadable' } | null
    fileErrors: cfgRead.fileErrors,
    localMode: cfgRead.localMode,
    display: cfgRead.display,      // { hosts, layout, density, group, toolMark } (badge-display-options)
    envIgnored: cfgRead.source === 'file'
      && String(hostsRaw == null ? '' : hostsRaw).trim() !== '',
  };
}
