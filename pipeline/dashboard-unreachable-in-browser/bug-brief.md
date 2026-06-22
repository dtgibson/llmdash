# Bug Brief: dashboard-unreachable-in-browser

## Re-verification (2026-06-21, on host snowravendev-vm)
**The reported bug is no longer reproducing — the Tailscale data plane is back UP and the dashboard answers on the tailnet IP.** Re-ran the same probes ~a day after diagnosis:
- `curl http://100.82.9.81:8787/` (host's Tailscale IP) -> **HTTP 200 in 0.0006s** (was: 4s timeout, code=000).
- `tailscale0`: operstate **unknown** (= up for a TUN iface), `inet 100.82.9.81/32` assigned (was: DOWN, no IPv4).
- `ip route get 100.82.9.81` -> `local ... dev lo` (correctly local; was: leaking `via 10.211.55.1 dev enp0s5`).
- `tailscale status`: this node up, peer `hephaestus` online; loopback + LAN still 200; `llmdash.service` active.

The host-side failure condition (`tailscale0` DOWN) has cleared — the tunnel recovered (manual restart, reboot, or tailscaled self-heal). **Still unconfirmed from this host:** an end-to-end browser load from hephaestus, and whether `tailscale0` comes up DOWN again on the next reboot (the recurrence item under Open Questions remains open). The diagnosis below stands as the record of what was wrong.

## Symptom
The `llmdash` service is running but the dashboard is "not reachable in a browser" from another tailnet device (the user browses from **hephaestus**, a macOS peer). On the host itself the server answers **HTTP 200 on loopback and on the LAN IP in ~1ms**, but a request to the host's **Tailscale IP `http://100.82.9.81:8787/` times out after ~4s**.

## Reproduction
- `curl -m4 http://127.0.0.1:8787/` -> **HTTP 200** in 0.0014s (server healthy on loopback)
- `curl -m4 http://10.211.55.5:8787/` (this host's real LAN IP) -> **HTTP 200** in 0.0010s (server healthy on a real non-loopback interface)
- `curl -m4 http://100.82.9.81:8787/` (this host's Tailscale IP) -> **code=000, timeout after 4.003s**
- `curl -m4 http://100.119.29.70:8787/` (peer hephaestus over the tailnet) -> **code=000, timeout after 4.004s** (the whole tailnet is unroutable, not just port 8787)
- From a browser on another tailnet device: `http://100.82.9.81:8787` hangs / "not reachable"

## Root Cause
**The Tailscale data plane is DOWN — this is a host/operational tailscale problem, NOT a firewall block and NOT a code bug.**

The `tailscale0` TUN interface is in state **DOWN** (`operstate: down`), has **no IPv4 address**, and there are **zero tailnet routes installed** (route table 52 is empty; no `100.64.0.0/10` route in any table). As a result the host's own tailnet IP `100.82.9.81` is **not bound to any local interface**, and `ip route get 100.82.9.81` resolves to the **LAN gateway** (`via 10.211.55.1 dev enp0s5`). Packets to the tailnet IP (and to every peer) leak out the LAN NIC and are black-holed, producing the exact 4s timeout observed.

`tailscaled`'s control plane is half-up (BackendState Running, `WantRunning: true`, `ShieldsUp: false`, and userspace `tailscale ping hephaestus` succeeds in 2ms) while the **kernel TUN datapath is dead** — a stuck/half-initialized `tailscaled`.

> Note: this overturns the initial framing that the fix is "opening the firewall for 8787." The firewall is not the binding cause (see Ruled Out). The fix is to restart the Tailscale tunnel.

## Evidence
- `ss -tlnp`: `LISTEN 0.0.0.0:8787` owned by node pid 1232576 — server bound on **all** interfaces, matching `config.js` host=0.0.0.0 / `server.listen(port, host)` in `src/server.js:144-150`.
- `systemctl --user is-active llmdash.service` -> **active**; loopback curl 200 — the app is healthy.
- `ip -o addr show`: only `lo` (127.0.0.1) and `enp0s5` (10.211.55.5). **`100.82.9.81` is not assigned to any interface.**
- `ip -d link show tailscale0` -> **state DOWN**, `link/none`; `/sys/class/net/tailscale0/operstate` -> **down**; `ip -4 addr show tailscale0` -> **empty**.
- `ip route show table 52` (tailscale's table) -> **EMPTY**, despite rule `5270: from all lookup 52`; no `100.64.0.0/10` route in any table.
- `ip route get 100.82.9.81` -> `via 10.211.55.1 dev enp0s5 src 10.211.55.5` (own tailnet IP escapes to LAN gateway). `ip route get 100.119.29.70` -> same leak.
- `ping -c1 100.82.9.81` (kernel ICMP to own TS IP) -> **100% packet loss**.
- **DECISIVE anti-firewall test:** `nc -vz -w4 10.211.55.5 8787` -> **succeeds**; `curl http://10.211.55.5:8787/` -> **200**. A default-deny INPUT firewall would have blocked inbound 8787 on the LAN interface too — it does not.
- ufw signature is **REJECT, not silent DROP**: `nc -vz -w4 10.211.55.5 22` -> **"Connection refused" instantly** (closed port), versus the 4s **timeout** on the tailnet IP — different mechanisms.
- Control-plane vs data-plane split: `tailscale status` lists this node 100.82.9.81 + active peer hephaestus; `tailscale ping hephaestus` -> "pong ... in 2ms" (userspace WireGuard works); kernel ping to own IP fails and tailscale0 is DOWN.
- `tailscale debug prefs`: `WantRunning: true`, `LoggedOut: false`, `ShieldsUp: false` — not a tailscale-level inbound block, not logged out.
- `getent hosts snowravendev-vm.giraffe-chuckwalla.ts.net` -> `100.82.9.81` (MagicDNS resolves correctly; name and IP behave identically -> URL is not the cause).

## Ruled Out
- **Host packet filter (ufw/iptables/nftables default-deny) dropping 8787** — REFUTED (high). `curl http://10.211.55.5:8787/` returns 200 and `nc` to it succeeds: inbound 8787 IS permitted on a non-loopback interface. ufw is active but its signature is REJECT (instant "Connection refused" on port 22), not the silent 4s timeout; the tailnet timeout is identical across ports 8787/22/9 (whole-destination unroutable, not per-port). **The firewall is not the binding cause.**
- **Node server only serves loopback / rejects non-loopback Host / per-request subprocess** — REFUTED. `ss` shows LISTEN 0.0.0.0:8787 matching `server.listen('0.0.0.0', 8787)`; LAN IP returns a real 200 in 1.8ms; no Host allow-listing in `src/server.js`; Codex live data read in the poller (`toolWrap(..., live=null)`), no per-request subprocess.
- **Tailscale ACL / missing `tailscale serve` / ShieldsUp** — REFUTED. `tailscale ping hephaestus` succeeds (ACLs not blocking), `ShieldsUp: false`, `serve` is not required to reach a raw listener on a tailnet IP. The block is one layer lower (TUN datapath/routes).
- **Wrong/unresolvable URL or browser HTTPS-upgrade** — REFUTED as primary cause. MagicDNS resolves to the correct IP; name vs IP give the identical 4s timeout (would diverge if URL were the issue). HTTPS-upgrade has a different fast signature (instant TLS "wrong version number" ~17ms), not a 4s hang. Worth documenting as a post-fix confounder.

## Scope of Fix
**Primarily host/operational on this VM (snowravendev-vm):** restart the Tailscale tunnel to bring `tailscale0` UP, assign `100.82.9.81`, and install the tailnet routes. **No repo code change is required** to restore reachability — the llmdash server, its `0.0.0.0:8787` bind (`config.js` / `src/server.js:144-150`), and ufw are all fine.

**Optional accompanying repo changes** (docs/observability only, per the project's "surface security-relevant defaults" and honesty conventions, zero new deps):
- Substitute real reachable URLs into the startup banner (`src/server.js:146`) and `README.md:29,95` in place of the literal `<this-machine's-tailscale-name>` placeholder, and state **use http (not https)** and **MagicDNS-or-IP**.
- Optionally make the bind tailnet-scoped by default via `LLMDASH_HOST` as a hardening option, surfaced in the README and startup log.

## Recommended Fix (options)
1. **[RECOMMENDED — operational] Restart the Tailscale tunnel.** `sudo tailscale down && sudo tailscale up` (or `sudo systemctl restart tailscaled`). Verify: `ip -d link show tailscale0` shows state UP/UNKNOWN with `100.82.9.81/32`; `ip route get 100.82.9.81` resolves `dev tailscale0`; `ping -c1 100.82.9.81` succeeds; `curl http://100.82.9.81:8787/` returns 200. Then hephaestus can open `http://100.82.9.81:8787` (or the MagicDNS name). *Tradeoff:* addresses the proven root cause; requires sudo; brief tunnel blip; no repo code touched.
2. **[Not recommended for this incident] Tailnet-only firewall allow:** `sudo ufw allow in on tailscale0 to any port 8787 proto tcp`. Narrowest exposure (tailnet only), but **does not fix this incident** — packets never reach tailscale0 while it is DOWN. Keep only as a hardening note if ufw is later set default-deny.
3. **[Not recommended] All-interface firewall allow:** `sudo ufw allow 8787/tcp`. Also does not fix this incident and is broader than wanted — it opens 8787 on the LAN. `config.js` deliberately binds 0.0.0.0 with Tailscale as the intended boundary, so blanket LAN exposure is likely unwanted.
4. **[Follow-up only] Repo hardening:** bind to the tailnet IP via `LLMDASH_HOST=100.82.9.81` (config.js already honors it) plus substitute real URLs into the banner/README. Reduces surface and improves doc honesty, but does **not** restore reachability and would fail to bind while tailscale0 is DOWN — do this **after** the tunnel is restored.

## Open Questions
- Why is `tailscale0` stuck DOWN while `tailscaled` reports Running? (failed userspace<->kernel TUN handoff after VM sleep/resume or network change, a half-applied upgrade, or a `--tun=userspace-networking` start.) Check `journalctl -u tailscaled --since '-2h'` and `tailscale bugreport` after the restart.
- Does the restart persist across reboots, or does tailscale0 come up DOWN again? If recurring, inspect the tailscaled unit/flags and whether enp0s5/NetworkManager churn races tailscaled on this Parallels VM.
- Confirm from hephaestus directly (not testable from this host) that `http://100.82.9.81:8787` returns 200 once tailscale0 is UP, ruling out any residual peer-side MagicDNS/HTTPS-upgrade confounder.
- Maintainer decision: keep the deliberate 0.0.0.0 LAN-exposed bind with Tailscale as the boundary, or harden to a tailnet-only default — and surface whichever choice in the README and startup log.
