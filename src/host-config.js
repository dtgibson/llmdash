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

// Split raw file text into { entryLines, localMode, directiveErrors }. A line is:
//   - blank / whitespace-only        → ignored
//   - starts with '#'                → comment, ignored
//   - '!local=include|exclude|auto'  → the directive (last one wins); bad value ignored → 'auto'
//   - anything else                  → a host entry line (fed to parseHosts)
function splitFileText(text) {
  const entryLines = [];
  let localMode = 'auto';
  const directiveErrors = [];
  for (const rawLine of String(text == null ? '' : text).split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('!')) {
      // A directive line. Only !local= is defined; an unknown directive is an
      // honest error (surfaced), never a silent host entry.
      const eq = line.indexOf('=');
      const name = (eq === -1 ? line : line.slice(0, eq)).trim();
      const value = (eq === -1 ? '' : line.slice(eq + 1)).trim().toLowerCase();
      if (name === DIRECTIVE_LOCAL) {
        if (LOCAL_MODES.has(value)) localMode = value;
        else directiveErrors.push({ entry: line, reason: 'bad-local-directive' });
      } else {
        directiveErrors.push({ entry: line, reason: 'unknown-directive' });
      }
      continue;
    }
    entryLines.push(line);
  }
  return { entryLines, localMode, directiveErrors };
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
    const { entryLines, localMode, directiveErrors } = splitFileText(text);
    return {
      source: 'file',
      raw: entryLinesToRaw(entryLines),
      localMode,
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
    const { entryLines, localMode } = splitFileText(body);
    return { source: 'env-seed', raw: entryLinesToRaw(entryLines), localMode, error: null, fileErrors: [] };
  }
  return { source: 'none', raw: '', localMode: 'auto', error: null, fileErrors: [] };
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

// ── writeHostsConfig — rewrite the file from a list of entry strings (atomic) ──
// entries[] are raw host[:port][=label] strings (already validated by the caller);
// newline-stripped per entry (the line is the record delimiter). Preserves the
// !local directive when provided. This is the low-level writer add/removeHost use.
export function writeHostsConfig(hostsFile, entries, { fs = realFs, localMode = null } = {}) {
  const lines = [...FILE_HEADER];
  if (localMode && LOCAL_MODES.has(localMode) && localMode !== 'auto') {
    lines.push(`${DIRECTIVE_LOCAL}=${localMode}`);
  }
  for (const e of entries) {
    const clean = String(e == null ? '' : e).replace(/[\r\n]/g, '').trim();
    if (clean) lines.push(clean);
  }
  lines.push('');
  atomicWrite(hostsFile, lines.join('\n'), fs);
}

// Read the current file into { entries, localMode }, where entries[] are the raw
// host-entry lines (verbatim, for round-tripping labels). Absent/unreadable file →
// seed from env (so an Add before the first read still lands in a coherent file).
function readEntries({ hostsFile, hostsRaw, fs }) {
  let text = null;
  try {
    if (fs.existsSync(hostsFile)) text = fs.readFileSync(hostsFile, 'utf8');
  } catch { text = null; }
  if (text == null) text = seedBodyFromEnv(hostsRaw);
  const { entryLines, localMode } = splitFileText(text);
  return { entries: entryLines, localMode };
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

  const { entries, localMode } = readEntries({ hostsFile, hostsRaw, fs });

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
    writeHostsConfig(hostsFile, [...entries, canonical], { fs, localMode });
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

  const { entries, localMode } = readEntries({ hostsFile, hostsRaw, fs });

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
    writeHostsConfig(hostsFile, kept, { fs, localMode });
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
    envIgnored: cfgRead.source === 'file'
      && String(hostsRaw == null ? '' : hostsRaw).trim() !== '',
  };
}
