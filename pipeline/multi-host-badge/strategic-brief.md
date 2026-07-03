# Strategic Brief — Multi-host badge

## What We're Building

The menu-bar badge grows from watching one machine to watching several, and
gains the ability to be reconfigured live from its own dropdown. The driving
use case is a **monitoring station**: your primary Mac runs the badge (and an
llmdash instance) but does no Claude/Codex work itself — it watches your *other*
tailnet machines that do. You add and remove monitored hosts by hostname or IP
straight from the menu-bar dropdown, with no plist edit and no service restart.

Concretely this pulls together three things:

1. **A multi-host badge** — the badge becomes a consumer of the existing
   `/api/hosts` (the shipped multi-host fan-out), not just single-host
   `/api/state`. The primary machine's local llmdash already polls the remote
   hosts; the badge reads that machine's local `/api/hosts` over loopback and
   renders several hosts at once. It reuses the multi-host peer plumbing wholesale
   — the badge issues no new outbound fetch of its own.
2. **Live host configuration from the menu bar** (the headline ask) — the host
   list becomes runtime-mutable and persisted, and the badge gets add/remove/list
   actions that edit it. Today `LLMDASH_HOSTS` is a startup env var; editing it
   means a launchd plist edit plus a restart. This removes that friction.
3. **Monitoring-station handling** — a machine that runs the badge but has no
   local Claude/Codex activity is handled honestly, so its empty self-reading is
   de-emphasized rather than dominating the glance with noise.

## Why Now

The server-side work this depends on already shipped. Multi-host
(DECISIONS.md 2026-07-02) built the poller fan-out, the per-host in-memory cache,
the hardened outbound peer fetch, and the combined `GET /api/hosts` view — and
it explicitly **deferred the multi-host badge as a thin follow-on** ("the plugin
is built so a host list slots in without a rewrite"). The badge's own schema
records the same deferral. This feature is that follow-on, now that the hard part
exists. `ROADMAP.md` → On the Horizon names it directly.

The live-config and monitoring-station angles are what turn it from a mechanical
"consume `/api/hosts`" chore into a real product step: the founding promise of
"all your usage in one glance" quietly narrowed the moment a second machine
existed, and the menu bar is the most glanceable surface there is. Making the
watched-host list editable from that surface — on a machine you keep in front of
you all day — is what makes the multi-machine glance actually usable, rather than
a config exercise you do once and forget.

## The User Problem

You work across several machines over Tailscale, some of them running Claude Code
and Codex, and you want one persistent, glanceable readout of them all — without
sitting on any one of the working machines. Today the badge watches exactly one
host, fixed at install time. To watch a different machine you edit a launchd
plist and restart; to watch several at once you can't at all. And if you run the
badge on a machine that does no AI-coding work itself (the natural place for a
monitoring station — it's the computer that's always on and always in front of
you), the badge's own empty reading is the loudest thing on it, which is exactly
backwards.

## Success Criteria

- Running llmdash configured with remote hosts, the badge shows a single glyph
  reflecting the **most-constrained window across all monitored machines**, and
  its dropdown carries a per-host section with each machine's limits, activity,
  and honest freshness/offline state — reusing the badge's existing five-state
  honesty model per host.
- You can add a monitored host by hostname or IP from the badge's dropdown, and
  remove one, and see the change take effect on the next poller tick — with no
  plist edit and no manual service restart.
- A hostname/IP you type is validated and sanitized before it enters config, the
  fetch target, or any rendered/logged surface; a malformed entry is rejected
  with an honest message, never silently accepted or fabricated into a reading.
- On a monitoring-station machine (badge running, no local Claude/Codex activity,
  remote hosts configured), the empty local reading does not dominate the glyph
  or the dropdown; the badge reflects the machines actually being watched. The
  empty local state is still available and honestly labeled ("no local activity")
  — never fabricated into zeros, just not the headline.
- An unreachable or offline monitored host is named in the dropdown (never shown
  as a stale-as-fresh number, never a fabricated zero), consistent with the
  existing offline honesty.
- The dashboard's HTTP surface stays read-only (still 405 for non-GET/HEAD); no
  new write endpoint is exposed on the tailnet.
- Zero new runtime dependencies, no build step. The badge adds no second data
  path — it reads the already-served `/api/hosts` from the local instance.

## Scope

- **Badge consumes `/api/hosts`.** The badge reads the combined multi-host view
  from its **local** llmdash over loopback (the primary machine is the one polling
  the remotes). Glyph = the most-constrained window across all monitored hosts
  (host × tool × window), extending the existing `computeBadge` "min remaining"
  logic by one axis. Dropdown = one section per host, reusing the existing
  per-tool rows, freshness bands, diagnostic lines, and offline handling. The
  binding host is named in the glyph via a host cue alongside the existing C/X
  tool cue.
- **Runtime-mutable, persisted host list.** The watched-host set becomes editable
  at runtime and survives restart. `LLMDASH_HOSTS` stays as a **startup seed /
  override**; a persisted config file (under the data dir) is the runtime layer;
  the poller re-reads it on the tick (the same tick that already re-runs
  `parseHosts()` and reconciles the cache via `retainHosts`). Precedence between
  the env seed and the file is defined and stated honestly.
- **Badge edits the local file directly** — a SwiftBar dropdown action runs a
  small helper that collects a hostname/IP via a native macOS `osascript` input
  dialog (no new dependency), validates and sanitizes it (the `sanitizeHostPort`
  discipline), and writes the config file on the same machine. Add / remove / list
  actions. **No HTTP mutation** — the file is written locally by the user-owned
  badge process, not via a network request to the dashboard.
- **Monitoring-station handling.** When the local host has no readings **and**
  remote hosts are configured, de-emphasize or exclude the local host from the
  glyph and the dropdown headline (recommended default: auto-detect; a config flag
  is the explicit override). The empty local reading is retained and honestly
  labeled, never fabricated.
- **Honesty carries throughout.** Offline/unreachable monitored hosts are named;
  the empty local monitoring host is handled honestly; every externally-entered
  hostname/IP is sanitized before use.

## Out of Scope

- **Any new HTTP write endpoint / dashboard config mutation over the network.**
  Config edits happen via a local file the badge writes and the server re-reads —
  never a POST to a tailnet-exposed `0.0.0.0` surface. The 405/serve-only posture
  is preserved. (Whether the *dashboard* should also gain host-editing later is a
  separate future question, flagged, not built here.)
- **Discovery / auto-enumeration of hosts.** Hosts are still only the operator's
  explicitly-configured set; no scanning, no host derived from a payload (preserves
  the no-transitive-fan-out and configured-hosts-only posture).
- **Persisting peer readings.** Multi-host stays cached-only; this feature changes
  only the *host list*'s persistence, not peer *readings* (still in-memory, still
  refilled each tick).
- **The badge polling remotes itself.** The badge reads its local instance's
  `/api/hosts`; llmdash does the fan-out. The badge does not open outbound
  connections to remote machines.
- **Cross-platform config UI.** The edit affordance is macOS-native (SwiftBar +
  osascript + launchd), matching where the badge lives. No Linux/Windows config UI.
- **Limit alerts / notifications across hosts.** That is the Up Next item, built on
  the same plumbing; not this feature.
- **A separate per-badge outbound fetch to each host** (the badge does not become
  a second multi-host aggregator; it consumes the one the server already built).

## Key Decisions

- **Runtime config lives in a persisted local file, not a new env var and not a
  network endpoint.** `LLMDASH_HOSTS` becomes a startup seed/override; the file
  (under the data dir) is the runtime layer the poller re-reads on the tick. This
  reuses the existing per-tick `parseHosts()` + `retainHosts()` reconciliation —
  the plumbing to apply a changed host set at runtime already exists; today it just
  reads a static value. No dead knob: both the seed env var and the file drive real
  behavior, with honest precedence. **(Architect confirms the file location,
  format, and exact env-vs-file precedence.)**
- **The badge edits the file locally; the HTTP surface stays read-only.** A
  tailnet-exposed write endpoint on `0.0.0.0` would be a real new attack surface
  and would break the founding serve-only/405 posture. The badge runs on the same
  machine as the file, as the same user — a direct local file write is both simpler
  and safer than an HTTP mutation. **The security posture and the feasibility of an
  osascript input dialog invoked from a SwiftBar `bash=` action are flagged for the
  Auditor and the Architect to confirm/spike.**
- **The multi-host glyph is the most-constrained window across all monitored
  hosts**, extending `computeBadge`'s existing "min remaining across windows" by a
  host axis. The binding host is named (host cue) alongside the existing binding-
  tool cue (C/X). Exact dropdown composition and the host-cue treatment are the
  Designer's, within this model.
- **The monitoring station is a first-class shape.** A machine can now run the
  badge with no local Claude/Codex and watch only remotes; the empty local reading
  is de-emphasized/excludable (recommended default: auto-detect empty-local +
  remotes-present) rather than fabricated or forced into the glance. This is one of
  two conscious expansions of the founding scope (below).
- **Every entered hostname/IP is validated/sanitized at the door** (`sanitizeHostPort`
  discipline — a fixed security finding twice already) before it touches config, the
  fetch target, or any rendered/logged surface. A malformed entry is an honest,
  rejected error, never a silent coercion or a fabricated reading.
- **Founding alignment: no brief rewrite needed.** This strengthens the founding
  vision — it makes "all your usage in one glance" real across machines on the most
  glanceable surface, and removes the config friction. Still single-user, still
  tailnet-only, still the same sanctioned data, consistent with the multi-host
  founding-alignment note (single-user, tailnet-only, "aggregates across my
  machines"). It fulfills the roadmap's deferred multi-host-badge item. Two
  **conscious, justified expansions** are recorded rather than slipped in:
  (a) the badge gains a small **config/write capability** — a deliberate shift from
  its founded read-only/minimal design, justified because it is the user's explicit
  ask and is scoped to a **local file write only** (no HTTP write, no dashboard
  mutation); and (b) a machine can now be a **pure monitoring station** with no
  local AI-coding work. Both are noted here for the record; neither requires
  editing `product-brief.md`, though a one-line note there acknowledging the badge's
  new local-config capability would be reasonable and is flagged for the user.
