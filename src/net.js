import os from 'node:os';
import { isIP, SocketAddress } from 'node:net';

// Tailscale assigns each node an IPv4 in the 100.64.0.0/10 CGNAT range
// (100.64.0.0 – 100.127.255.255). Find this host's tailnet address by
// scanning the local interfaces — no subprocess and no dependency on the
// `tailscale` CLI, so it stays within the "Node builtins only" rule.
//
// Returns the address string, or null when no tailnet address is present
// (e.g. the tunnel is down). The caller stays honest about a null result
// rather than printing a fabricated URL.
//
// `interfaces` is injectable so the detection is unit-testable.
export function tailnetIPv4(interfaces = os.networkInterfaces()) {
  for (const addrs of Object.values(interfaces)) {
    if (!addrs) continue;
    for (const a of addrs) {
      // Node reports family as the string 'IPv4' (newer) or the number 4 (older).
      const isV4 = a.family === 'IPv4' || a.family === 4;
      if (!isV4 || a.internal) continue;
      const [o1, o2] = a.address.split('.').map(Number);
      if (o1 === 100 && o2 >= 64 && o2 <= 127) return a.address;
    }
  }
  return null;
}

// ── Address classification (lifted from src/reset-billing-api.js) ───────────
// One canonical form for an IP literal: { family: 4|6, address } with IPv6
// lowercased/compressed by SocketAddress, or null for anything that is not an
// IP. Shared by the reset-billing authority check and the accept-time gate so
// both surfaces agree byte-for-byte on what "loopback" and "tailnet" mean.
export function canonicalIp(value) {
  const family = isIP(value);
  if (!family) return null;
  try {
    const address = new SocketAddress({
      address: value, port: 0, family: family === 4 ? 'ipv4' : 'ipv6',
    }).address.toLowerCase();
    // A wildcard IPv6 listener reports IPv4 clients as mapped addresses on
    // some platforms. Treat that representation as the corresponding IPv4
    // destination so a normal literal IPv4 Host still matches.
    if (family === 6 && address.startsWith('::ffff:')) {
      const mapped = address.slice('::ffff:'.length);
      if (isIP(mapped) === 4) return { family: 4, address: mapped };
    }
    return { family, address };
  } catch { return null; }
}

export function isLoopback(ip) {
  if (!ip) return false;
  if (ip.family === 4) return ip.address.split('.')[0] === '127';
  return ip.address === '::1';
}

export function isTailnetIp(ip) {
  if (!ip) return false;
  if (ip.family === 4) {
    const [first, second] = ip.address.split('.').map(Number);
    return first === 100 && second >= 64 && second <= 127;
  }
  // Tailscale's stable IPv6 ULA prefix is fd7a:115c:a1e0::/48.
  return ip.address.startsWith('fd7a:115c:a1e0:');
}

// ── Bind scope (tailnet-bind-and-reporting-resilience, Part 1) ──────────────
// The server keeps ONE wildcard listener (the badge and the deploy health
// check reach it on 127.0.0.1) but, by default, closes every accepted TCP
// connection that did not arrive on a loopback/tailnet address FROM a
// loopback/tailnet source. Under the weak-host model that gives the same
// protection as binding the tailnet IP, without a re-bind lifecycle when
// tailscale0 is down at boot: with the tunnel down only loopback clients can
// connect, nothing widens, and tailnet clients are accepted the moment the
// tunnel is up.

// A wildcard bind is exactly 0.0.0.0 or :: (a mapped ::ffff:0.0.0.0 canonicalizes
// to the v4 wildcard). Any other value — a loopback, LAN, or tailnet IP, or a
// host name — is a pinned bind whose reachability is the bind itself.
export function isWildcardBind(host) {
  const raw = String(host ?? '').trim().replace(/^\[(.*)\]$/, '$1');
  const ip = canonicalIp(raw);
  if (!ip) return false;
  return ip.family === 4 ? ip.address === '0.0.0.0' : ip.address === '::';
}

// The scope enum the banner, health line, and tests share:
//   tailnet-only     — wildcard bind, accept-time gate ON (the shipped default)
//   lan-and-tailnet  — wildcard bind, LLMDASH_ALLOW_LAN=1 (the pre-gate behavior)
//   pinned:<host>    — LLMDASH_HOST set to one address; exact current meaning
export function networkScope(cfg) {
  const host = String(cfg && cfg.host != null ? cfg.host : '');
  if (!isWildcardBind(host)) return `pinned:${host}`;
  return cfg && cfg.allowLan === true ? 'lan-and-tailnet' : 'tailnet-only';
}

// The policy object the accept-time gate consumes. `gate` is true only for the
// tailnet-only scope; `allowLanIgnored` names the one dead-knob case (the env
// is set but the bind is pinned) so the disclosure line can say so.
export function bindPolicy(cfg) {
  const scope = networkScope(cfg);
  const allowLan = !!(cfg && cfg.allowLan === true);
  return Object.freeze({
    scope,
    host: String(cfg && cfg.host != null ? cfg.host : ''),
    port: Number(cfg && cfg.port),
    gate: scope === 'tailnet-only',
    allowLan,
    allowLanIgnored: allowLan && scope.startsWith('pinned:'),
  });
}

function trustedEndpoint(ip) {
  return isLoopback(ip) || isTailnetIp(ip);
}

// Pure accept-time classifier over the two socket addresses. Both the address
// the connection ARRIVED ON (localAddress) and the address it CAME FROM
// (remoteAddress) must be loopback or tailnet; a missing, undefined, or
// non-IP value fails closed. Only an explicit `policy.gate === false` (LAN
// allowed, or a pinned bind) accepts unconditionally — an absent or malformed
// policy is treated as gated, never as open.
export function isTrustedConnection(socket, policy) {
  if (policy && policy.gate === false) return true;
  const local = canonicalIp(socket && socket.localAddress);
  const remote = canonicalIp(socket && socket.remoteAddress);
  return trustedEndpoint(local) && trustedEndpoint(remote);
}

// One honest sentence set for the startup banner and healthLines(): the scope
// in effect, what it means for LAN devices, the tailnet-down fallback, and the
// two knobs. `tailnetIp` is the detected address (or null when the tunnel is
// down) so the line states the current reality, never a fabricated URL.
export function networkScopeDisclosure(cfg, tailnetIp = null) {
  const policy = bindPolicy(cfg);
  const bind = `${policy.host}:${policy.port}`;
  if (policy.scope === 'tailnet-only') {
    const tunnel = tailnetIp
      ? `Tailnet address now: ${tailnetIp}.`
      : 'No Tailscale address is up right now, so only local (127.0.0.1) clients can connect until the tunnel is up.';
    return `Network: bound to ${bind}, TAILNET-ONLY (the default) — a connection is accepted only when it arrives on a loopback or Tailscale address from a loopback or Tailscale source; a LAN device that is not on the tailnet is refused at connect time (no HTTP response). `
      + `If the Tailscale tunnel is down, only local (127.0.0.1) clients can connect; tailnet clients are accepted the moment it is up again — no restart needed. ${tunnel} `
      + 'To also allow LAN devices set LLMDASH_ALLOW_LAN=1; to bind one address set LLMDASH_HOST (127.0.0.1 = local-only).';
  }
  if (policy.scope === 'lan-and-tailnet') {
    return `Network: bound to ${bind} with LLMDASH_ALLOW_LAN=1 — reachable from the LAN and the tailnet (not the public internet behind NAT); no connect-time gate. `
      + 'Unset LLMDASH_ALLOW_LAN to return to the tailnet-only default, or set LLMDASH_HOST to bind one address (127.0.0.1 = local-only).';
  }
  const ip = canonicalIp(policy.host);
  const reach = isLoopback(ip) ? 'local-only (this machine)'
    : isTailnetIp(ip) ? 'that Tailscale address only'
      : 'that address only';
  let line = `Network: bound to ${bind} (LLMDASH_HOST pinned) — reachable via ${reach}; the bind itself is the boundary, no connect-time gate applies.`;
  if (policy.allowLanIgnored) {
    line += ' LLMDASH_ALLOW_LAN is set but IGNORED because LLMDASH_HOST is pinned (the gate and its opt-out only apply to the wildcard 0.0.0.0 bind) — unset LLMDASH_HOST to use the gate.';
  }
  return line;
}
