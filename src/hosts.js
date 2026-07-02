// Multi-host peer plumbing — the one module that owns the host list, the
// local-identity match, peer-payload normalization, and the hardened outbound
// fetch. Node builtins only (no npm dependency, no build step). Every function
// here is pure or injectable so the poller fan-out and the config parsing are
// unit-testable without a live tailnet peer.
//
// The security posture (NFR-03, for the Auditor): outbound reads go ONLY to the
// operator's explicitly-configured hosts (no discovery, no host derived from a
// payload → no transitive fan-out), only a credential-free GET /api/state is
// issued, the fetch is timeout-bounded AND body-capped, and a redirect to
// another host is never followed (3xx → peer-error). Every peer-supplied field
// is treated as data: clamped/normalized at ingest here, escaped at render.

import http from 'node:http';
import { config } from '../config.js';
import { tailnetIPv4 } from './net.js';

// ── Host/port sanitizer ──────────────────────────────────────────────────────
// Generalizes the badge's sanitizeHostPort (its fixed Low): a real host/IP and
// port never contain whitespace or shell/URL metacharacters, so strip anything
// outside the safe host-charset. This defends the outbound-URL surface and the
// dedup key. Kept strict: letters, digits, dot, colon, hyphen, underscore, and
// brackets (IPv6 literal form) survive; everything else is removed.
export function sanitizeHostPort(s) {
  return String(s == null ? '' : s).replace(/[^A-Za-z0-9._:\-\[\]]/g, '');
}

// The known-local identity set (best-effort, NO DNS — a subprocess/blocking-I/O
// risk off budget): loopback forms, the configured bind host when pinned, and
// this machine's tailnet IPv4. A host matching any of these on config.port is
// served IN-PROCESS (buildState()), never self-HTTP'd. A hostname alias we can't
// resolve is a correctness-PRESERVING miss (it double-shows the local reading,
// honestly, and issues one loopback-ish fetch) — never a fabricated reading.
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0']);

// `cfg`/`tailnet` injectable for tests. Matches only when the port also equals
// config.port (a different port on localhost is a genuinely different instance).
export function isLocalHost(host, port, cfg = config, tailnet = tailnetIPv4()) {
  const h = sanitizeHostPort(host).toLowerCase();
  const p = Number(port);
  if (!h) return false;
  if (p !== Number(cfg.port)) return false;
  if (LOOPBACK.has(h)) return true;
  // config.host is the bind address; treat it as local only when it is a real
  // pinned interface (not the 0.0.0.0 wildcard, which is already in LOOPBACK).
  if (cfg.host && cfg.host !== '0.0.0.0' && h === String(cfg.host).toLowerCase()) return true;
  if (tailnet && h === String(tailnet).toLowerCase()) return true;
  return false;
}

// ── parseHosts ───────────────────────────────────────────────────────────────
// raw = the LLMDASH_HOSTS string; cfg supplies the default port + local
// identity. Returns { hosts:[…], errors:[…] }. The local host is ALWAYS
// prepended (self:true) and the set is deduped by sanitizedHost:port. Malformed
// entries go to errors[] — never silently dropped, never fabricated into a
// reading. Pure: no I/O, no fetch.
//
// Per-entry format: host[:port][=label]
//   - split off `=label` at the FIRST '=' (labels may contain '=' after that,
//     though '=' in a label is unusual; the first wins so host parsing is clean)
//   - split off `:port` at the LAST ':' of the remaining host token, BUT only
//     when what follows is all-digits (so an IPv6 literal's colons aren't eaten)
//   - label default = the sanitized host string
export function parseHosts(raw = config.hostsRaw, cfg = config, tailnet = tailnetIPv4()) {
  const errors = [];
  const hosts = [];
  const seen = new Set();

  // The local host — always first, self:true. Labeled "This machine" unless the
  // operator later provides an explicit label for the same host:port (dedup
  // below lets an explicit label override the default).
  const localPort = Number(cfg.port);
  const localKey = `local:${localPort}`;
  hosts.push({
    host: 'local', // sentinel; the real bind host varies and self reads in-process
    port: localPort,
    label: 'This machine',
    self: true,
    key: localKey,
  });
  seen.add(localKey);

  const text = String(raw == null ? '' : raw).trim();
  if (!text) return { hosts, errors };

  for (const rawEntry of text.split(',')) {
    const entry = rawEntry.trim();
    if (!entry) continue; // a trailing/empty comma segment is not an error

    // Label: everything after the first '='.
    let hostPort = entry, label = null;
    const eq = entry.indexOf('=');
    if (eq !== -1) {
      hostPort = entry.slice(0, eq).trim();
      label = entry.slice(eq + 1).trim(); // free-form, retained raw, escaped at render
    }

    // Port: the last ':' whose tail is all-digits. Leaves IPv6 colons intact.
    let hostPart = hostPort, portPart = null;
    const lastColon = hostPort.lastIndexOf(':');
    if (lastColon !== -1) {
      const tail = hostPort.slice(lastColon + 1);
      if (/^\d+$/.test(tail)) { hostPart = hostPort.slice(0, lastColon); portPart = tail; }
    }

    const host = sanitizeHostPort(hostPart);
    if (!host) { errors.push({ entry, reason: 'empty-host' }); continue; }

    let port = localPort;
    if (portPart != null) {
      const n = Number(portPart);
      if (!Number.isInteger(n) || n < 1 || n > 65535) {
        errors.push({ entry, reason: 'bad-port', detail: portPart });
        continue; // a present-but-invalid port is an honest error, not a silent coercion
      }
      port = n;
    }

    const self = isLocalHost(host, port, cfg, tailnet);
    const key = self ? localKey : `${host}:${port}`;
    if (seen.has(key)) {
      // Duplicate host:port (or the local host listed explicitly). Counted once.
      // An explicit label overrides the default — least-surprising: the operator
      // bothered to name it. Do NOT re-poll or double-list.
      if (label) {
        const existing = hosts.find((x) => x.key === key);
        if (existing) existing.label = label;
      }
      continue;
    }
    seen.add(key);
    hosts.push({ host, port, label: label || host, self, key });
  }

  return { hosts, errors };
}

// The remote (non-self) subset of the effective host set — the poller's fan-out
// targets. The local host is served in-process, never fetched.
export function remoteHosts(parsed = parseHosts()) {
  return parsed.hosts.filter((h) => !h.self);
}

// ── normalizePeerState ───────────────────────────────────────────────────────
// A fetched peer /api/state payload is DATA, never trusted well-formed. Produce
// the same shape buildState() emits, defensively:
//   - used-% clamped to 0–100 (and remainingPct kept consistent)
//   - every timestamp normalized to canonical ISO; a missing/unparseable one is
//     DROPPED (→ null), NEVER defaulted to "now" (that would make malformed data
//     eternally fresh). A valid peer capturedAt is preserved as-is (clock skew
//     intact, never re-stamped to local now).
//   - free-form fields (labels, diagnostic strings) left RAW for render-time
//     esc() — normalization must not mangle them into meaninglessness.
//   - missing/extra fields tolerated → a partial reading, never a crash.
// Returns null when the payload is unusable at the top level (not an object /
// no tools array) so the caller marks the host offline rather than caching junk.
export function normalizePeerState(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const toolsIn = Array.isArray(payload.tools) ? payload.tools : null;
  if (!toolsIn) return null; // shape too broken to render — offline, not fabricated

  const tools = toolsIn.map(normalizeTool).filter(Boolean);
  return {
    tools,
    headroom: normalizeHeadroom(payload.headroom),
    generatedAt: normalizeIso(payload.generatedAt),
  };
}

// Canonical ISO or null. Never "now": a missing/unparseable timestamp must not
// become eternally-fresh. Date.parse validation alone doesn't guarantee a clean
// string, so round-trip through toISOString (per CLAUDE.md).
export function normalizeIso(v) {
  if (v == null) return null;
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

// Clamp an externally-sourced percentage into 0–100, or null if not finite.
function clampPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, n));
}

function normalizeWindow(w) {
  if (!w || typeof w !== 'object') return null;
  const usedPct = clampPct(w.usedPct);
  if (usedPct == null) return null; // no usable reading for this window
  return {
    usedPct,
    // Derive remainingPct from the clamped used-% so the pair stays consistent
    // even if a buggy peer sent an inconsistent remainingPct.
    remainingPct: Math.max(0, 100 - usedPct),
    resetsAt: normalizeIso(w.resetsAt),
    capturedAt: normalizeIso(w.capturedAt),
  };
}

function normalizeLimits(limits) {
  const src = (limits && typeof limits === 'object') ? limits : {};
  return { five_hour: normalizeWindow(src.five_hour), seven_day: normalizeWindow(src.seven_day) };
}

// Projection is derived pacing data; pass through the booleans/numbers we use,
// clamped to plain finite numbers. Missing → null (honest "not available").
function normalizeProjection(proj) {
  const one = (p) => {
    if (!p || typeof p !== 'object') return null;
    const etaMs = Number(p.etaMs);
    return {
      etaMs: Number.isFinite(etaMs) ? etaMs : null,
      hitsBeforeReset: !!p.hitsBeforeReset,
    };
  };
  const src = (proj && typeof proj === 'object') ? proj : {};
  return { five_hour: one(src.five_hour), seven_day: one(src.seven_day) };
}

// Activity is per-machine token stats, rendered through the existing
// tilesHtml/mixHtml. Those helpers read the numeric fields and format them, but
// two render paths do NOT escape their input: fmtTokensHtml's String(n) fallback
// (a non-numeric value renders raw) and the sessionsToday note (raw string
// concatenation). So a hostile peer sending a STRING where a token count belongs
// (e.g. tokens.today = "<img src=x onerror=…>") would inject markup into
// innerHTML. Every rendered activity number must therefore be coerced to a
// finite number (or null) HERE at ingest — the same discipline normalizeWindow/
// normalizeHeadroom/normalizeProjection already apply — so no peer string ever
// reaches an unescaped render path. hasData:false → honest not-available.
function normalizeActivity(a) {
  if (!a || typeof a !== 'object') return { hasData: false };
  // A peer that recorded no activity sends hasData:false; preserve that.
  if (a.hasData === false) return { hasData: false };
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const tk = (a.tokens && typeof a.tokens === 'object') ? a.tokens : {};
  const mix = (a.tokenMix && typeof a.tokenMix === 'object') ? a.tokenMix : null;
  return {
    hasData: true,
    burnTokensPerHour: num(a.burnTokensPerHour),
    tokens: { last5h: num(tk.last5h), week: num(tk.week), today: num(tk.today) },
    sessionsToday: num(a.sessionsToday),
    cacheHitRate: num(a.cacheHitRate),
    cachedIsSubsetOfInput: !!a.cachedIsSubsetOfInput,
    estValueWeek: num(a.estValueWeek),
    estValueToday: num(a.estValueToday),
    cacheSavingsWeek: num(a.cacheSavingsWeek),
    tokenMix: mix ? {
      cacheRead: num(mix.cacheRead) || 0,
      input: num(mix.input) || 0,
      cacheWrite: num(mix.cacheWrite) || 0,
      output: num(mix.output) || 0,
    } : null,
  };
}

function normalizeFreshness(f) {
  if (!f || typeof f !== 'object') return null;
  const freshForMs = Number(f.freshForMs);
  const staleAfterMs = Number(f.staleAfterMs);
  // Thresholds must be finite positive to derive a band; otherwise no band.
  if (!Number.isFinite(freshForMs) || !Number.isFinite(staleAfterMs)) return null;
  return {
    capturedAt: normalizeIso(f.capturedAt),
    freshForMs: Math.max(0, freshForMs),
    staleAfterMs: Math.max(0, staleAfterMs),
  };
}

// A tool's limitsDiagnostic crosses the wire as an enum reason + escaped free-
// form fields. Keep the reason as a string and the free-form fields as raw text
// for render-time esc(); do not fabricate a reason.
function normalizeDiagnostic(d) {
  if (!d || typeof d !== 'object' || typeof d.reason !== 'string') return null;
  const out = { reason: d.reason };
  for (const k of ['cause', 'detail', 'cmd', 'capturedAt']) {
    if (d[k] != null) out[k] = d[k]; // raw; escaped at render
  }
  if (typeof d.ageMs === 'number' && Number.isFinite(d.ageMs)) out.ageMs = d.ageMs;
  return out;
}

function normalizeTool(t) {
  if (!t || typeof t !== 'object') return null;
  const source = typeof t.source === 'string' ? t.source : null;
  if (!source) return null; // a tool with no source can't be rendered honestly
  const limits = normalizeLimits(t.limits);
  const caps = ['five_hour', 'seven_day']
    .map((w) => limits[w] && limits[w].capturedAt).filter(Boolean).map(Date.parse)
    .filter(Number.isFinite);
  const dataAt = caps.length ? new Date(Math.max(...caps)).toISOString() : null;
  return {
    source,
    label: typeof t.label === 'string' ? t.label : source, // raw; esc()'d at render
    plan: typeof t.plan === 'string' ? t.plan : '',
    haveLimits: !!(limits.five_hour || limits.seven_day),
    limits,
    projection: normalizeProjection(t.projection),
    activity: normalizeActivity(t.activity),
    freshness: normalizeFreshness(t.freshness),
    limitsDiagnostic: normalizeDiagnostic(t.limitsDiagnostic),
    dataAt,
  };
}

function normalizeHeadroom(h) {
  if (!h || typeof h !== 'object') return null;
  // Rendered fields are text (esc'd) or coerced integers; keep only known keys.
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  return {
    lowLabel: typeof h.lowLabel === 'string' ? h.lowLabel : '',
    lowWindow: typeof h.lowWindow === 'string' ? h.lowWindow : '',
    lowRemaining: num(h.lowRemaining),
    bestLabel: typeof h.bestLabel === 'string' ? h.bestLabel : '',
    bestRemaining: num(h.bestRemaining),
    maxed: !!h.maxed,
  };
}

// ── fetchPeerState ───────────────────────────────────────────────────────────
// Hardened outbound GET /api/state to ONE explicitly-configured peer. Resolves
// { ok:true, state } on success, or { ok:false, reason, cause, detail } on any
// failure — never throws, never fabricates. `httpImpl` is injectable so tests
// exercise the real node:http path against a scratch loopback peer, or a fault
// injector, without a live tailnet. NO redirect follow (3xx → peer-error). Body
// capped and aborted on overflow. No credentials. No method other than GET.
export function fetchPeerState(host, port, {
  timeoutMs = config.peerTimeoutMs,
  bodyCapBytes = config.peerBodyCapBytes,
  httpImpl = http,
} = {}) {
  const safeHost = sanitizeHostPort(host);
  const safePort = Number(port);
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };

    let req;
    try {
      req = httpImpl.get({
        host: safeHost,
        port: safePort,
        path: '/api/state',
        timeout: timeoutMs,
        // No credentials, no cookies, no auth header — read-only, credential-free.
      }, (res) => {
        const status = res.statusCode;

        // No redirect follow: a peer must not be able to bounce the read to an
        // unconfigured/unexpected target. Any 3xx is a peer-error.
        if (status >= 300 && status < 400) {
          res.resume(); // drain
          return done({ ok: false, reason: 'peer-error', cause: 'redirect', detail: `status ${status}` });
        }
        if (status !== 200) {
          res.resume();
          return done({ ok: false, reason: 'peer-error', cause: `http-${status}`, detail: `status ${status}` });
        }

        let body = '';
        let bytes = 0;
        res.setEncoding('utf8');
        res.on('data', (c) => {
          bytes += Buffer.byteLength(c, 'utf8');
          if (bytes > bodyCapBytes) {
            // Oversized: abort the stream and resolve to peer-error. Never
            // buffer an unbounded peer body.
            res.destroy();
            try { req.destroy(); } catch {}
            return done({ ok: false, reason: 'peer-error', cause: 'oversized', detail: `>${bodyCapBytes}B` });
          }
          body += c;
        });
        res.on('end', () => {
          if (settled) return;
          let parsed;
          try { parsed = JSON.parse(body); }
          catch { return done({ ok: false, reason: 'peer-error', cause: 'bad-json' }); }
          const state = normalizePeerState(parsed);
          if (!state) return done({ ok: false, reason: 'peer-error', cause: 'bad-json', detail: 'unusable shape' });
          return done({ ok: true, state });
        });
        res.on('error', () => done({ ok: false, reason: 'peer-unreachable', cause: 'connect', detail: 'stream error' }));
      });
    } catch (e) {
      return done({ ok: false, reason: 'peer-unreachable', cause: 'connect', detail: e && e.message });
    }

    req.on('timeout', () => {
      try { req.destroy(new Error('timeout')); } catch {}
      done({ ok: false, reason: 'peer-unreachable', cause: 'timeout', detail: `no response within ${timeoutMs}ms` });
    });
    req.on('error', (e) => {
      // ECONNREFUSED / ENOTFOUND / socket errors → unreachable. A timeout emits
      // both 'timeout' (handled above, destroys) and then 'error'; the settled
      // guard keeps the timeout classification.
      done({ ok: false, reason: 'peer-unreachable', cause: 'connect', detail: e && e.message });
    });
  });
}
