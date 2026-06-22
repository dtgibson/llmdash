import os from 'node:os';

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
