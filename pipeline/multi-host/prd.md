# PRD — Multi-Host
**Feature:** multi-host
**Date:** 2026-07-02
**Stage:** 2 — The Planner
**Source:** strategic-brief.md (approved)

---

## Feature Overview

One llmdash instance presents several of the user's own tailnet machines'
readings together — each host's Claude Code + Codex limit windows **and** its
per-machine activity, side by side, the local machine included as one host. The
local instance polls each configured peer's existing `/api/state` on its interval
poller, caches the results per host, and serves a combined view. Each host is
honestly labeled and independently fresh / stale / offline. It generalizes the
just-shipped badge's single configurable host (`LLMDASH_BADGE_HOST`) from *one*
host to a *list* of peers and moves that onto the dashboard. Activity is the
genuine new information; limits are the account's numbers and must not masquerade
as N independent budgets.

### The two architectural choices this PRD hands to Stage 3

The brief fixes the *principle* and leaves two genuinely-architectural choices to
the Architect. This PRD pins the requirements around them so the Stage-3 decision
resolves cleanly, and tags the few requirements that depend on the endpoint shape
so nothing dangles.

- **[EP] — endpoint shape.** Whether the combined multi-host data crosses the
  wire as a **new endpoint** (e.g. `/api/hosts`) or an **extension of
  `/api/state`** is the Architect's call. Requirements tagged **[EP]** are the
  ones whose wording depends on that choice; everything else is
  endpoint-agnostic. The hard constraint on *both* options: the **single-host
  `/api/state` shape keeps working unchanged** for the local view and the
  existing badge (FR-16, QA-16), and the combined payload is **assembled from
  cache off the request path** (FR-06), carrying every host's full per-tool
  picture plus its own freshness/offline state.

- **Cached-only vs persisted peer readings.** Whether this instance stores peer
  readings at all (vs. serving them live-from-cache only) is an Architect call
  per the brief. **Default assumption (OQ-02): cached-only — live-from-cache, no
  cross-host history store in v1.** Persisting peers' snapshots into the local
  SQLite store is out of scope for v1 (the brief lists a cross-host history store
  as out of scope); the Architect confirms or overrides with justification.

### The wire contract each peer already serves (authoritative field names)

Every field below is named exactly as `src/server.js` `buildState()` emits it and
`public/app.js` reads it. A peer's `/api/state` is consumed exactly as a local
reading — the same shape, treated as **data** (clamp / normalize / escape at
ingest), never trusted to be well-formed:

- `state.tools[]` — array; each tool object has:
  - `source` (`"claude-code"` | `"codex"`), `label`, `plan`, `haveLimits` (bool).
  - `limits.five_hour` and `limits.seven_day` — each **`null`** or
    `{ usedPct, remainingPct, resetsAt, capturedAt }`.
  - `projection.five_hour` / `projection.seven_day` — pacing projection or `null`.
  - `activity` — the per-tool token stats (or `hasData:false` / not-available).
  - `freshness` — Claude: `{ capturedAt, freshForMs, staleAfterMs }`; Codex: `null`.
  - `limitsDiagnostic` — `null` or `{ reason, … }` (enum reason + escaped free-form).
  - `dataAt` — newest capturedAt across the tool's windows, or `null`.
- `state.headroom` — the cross-tool cue, or `null`.
- `state.generatedAt` — ISO timestamp of the payload.

Window keys on the wire are **`five_hour`** / **`seven_day`**; display labels are
**"5-hour"** / **"Weekly"**.

---

## User Stories

> **US-01** — As someone who codes on more than one machine, I want one llmdash to
> show all my machines' Claude Code and Codex readings together — each machine's
> limit windows and its own activity, side by side — so that "one glance, all your
> usage" holds across machines and I stop opening two tailnet URLs to compare.

> **US-02** — As that user, I want each host's **activity** (tokens, sessions,
> cache rate, estimated value) shown per machine, so that I can see where today's
> work actually happened — the desktop vs the laptop — which is the genuine new
> information a multi-host view adds.

> **US-03** — As someone who trusts this tool *because* it is honest, I want the
> **limits** presented as the **account's numbers**, so that when the same account
> runs on two machines I am not shown the same meter twice as if I had two
> independent budgets — while two genuinely different accounts still read as
> distinct.

> **US-04** — As that user, I want each host to degrade **independently and
> honestly** — a reachable peer shows fresh/aging/stale per the existing bands; an
> unreachable or erroring peer shows a named offline/error state naming which host
> and why — so no machine is silently dropped, shown as fabricated zeros, or shown
> stale-as-fresh.

> **US-05** — As the operator, I want to name my peer machines with an explicit
> `LLMDASH_*` env list (each a tailnet host/IP, with optional label and port), the
> local host always included, so that an **unconfigured install behaves exactly as
> today** (single host = this machine) and I'm never handed a knob that drives
> nothing.

> **US-06** — As the owner of a zero-dependency tailnet-only tool, I want peer
> polling to ride the existing interval poller (never the HTTP request path), use
> Node builtins only, reach only explicitly-configured tailnet peers with a read,
> and treat every peer-supplied field as data to clamp/normalize/escape — so
> multi-host adds no dependency, no request-path network I/O, and no new sensitive
> surface.

---

## Functional Requirements

### Configuration — the peer list

> **FR-01** — The app shall read the peer-host list from a single `LLMDASH_*`
> environment variable (proposed **`LLMDASH_HOSTS`**; the Architect may rename,
> e.g. `LLMDASH_PEERS`, and shall document whichever ships). The list is a
> delimiter-separated set of entries, each parsed as **`host[:port][=label]`**
> (the Architect may adopt a differently-justified per-entry format, but it shall
> carry at minimum a host, an optional port, and an optional display label). Each
> `host` is a tailnet hostname or IP. `port` defaults to the dashboard port
> (`config.port`); `label` defaults to the host string.

> **FR-02** — The **local host shall always be present** in the effective host
> set, whether or not it appears in the configured list. An **empty or unset**
> list shall yield behavior **identical to today's single-host install**: exactly
> one host (this machine), no peer states, no multi-host UI affordances, no
> outbound peer fetch. There shall be **no dead knob**: the configured value
> shall drive real peer polling and real UI, or (when empty) change nothing.

> **FR-03** — The app shall **deduplicate** the effective host set so a peer that
> resolves to the local host (e.g. the local host listed explicitly, or the same
> `host:port` appearing twice) is **counted once**, not double-listed and not
> double-polled. Where the local host is identifiable, it shall use its
> **in-process reading** rather than issuing an HTTP round-trip to itself (FR-05);
> the Architect shall note the identification method and the tradeoff if
> exact identification is not always possible.

> **FR-04** — Each configured peer entry shall be **validated and normalized** at
> config load: the host and port coerced to a safe host/port form (the badge's
> `sanitizeHostPort` discipline — strip whitespace and metacharacters — generalizes
> here), the label retained as free-form text to be **escaped at render** (never
> interpolated raw). A malformed entry shall be surfaced honestly (a startup log
> line and/or a per-host error state), never silently dropped and never fabricated
> into a reading.

### Peer polling — on the interval poller, never the request path

> **FR-05** — On each interval-poller tick (`src/poller.js`, alongside the
> existing Claude/Codex polls), the app shall **fan out a bounded-timeout
> `GET http://<peer-host>:<port>/api/state`** to each configured **remote** peer,
> using Node builtins only (`node:http`, the badge's `fetchState(host, port)` is
> the template). The **local host's reading shall be taken in-process** (the same
> `buildState()` the local view uses), **not** fetched over HTTP from itself.
> Peer polling shall happen **only** on the interval — **never** on the HTTP
> request path (a hard CLAUDE.md convention: no network I/O on the request path).

> **FR-06** — The combined multi-host view shall be **served from cache**: each
> HTTP request for the combined view reads the last cached per-host readings and
> assembles the response with **no peer fetch, no subprocess, and no blocking
> I/O** on the request path. The cache is **keyed by host**. **[EP]** Whether the
> combined view is a new endpoint or an extension of `/api/state` is the
> Architect's call (see Overview); either way the response carries **every host's
> full per-tool picture plus that host's own freshness/offline/error state**.

> **FR-07** — Each fetched peer payload shall be **normalized and clamped at
> ingest**, exactly as a local raw source is, before it is cached or rendered:
> - Externally-sourced **used-% clamped to 0–100** (and `remainingPct` kept
>   consistent) — a hostile or buggy peer number never escapes the range.
> - **Timestamps normalized to canonical ISO** (`new Date(Date.parse(v)).toISOString()`);
>   a missing or unparseable timestamp shall **not** default to "now" (that would
>   make malformed data eternally fresh) — the ingest shall drop that field / mark
>   the host's reading unusable per FR-10, honoring the peer's own `capturedAt` as
>   captured when it is valid (never re-stamped to the local now, so a peer clock
>   skew is preserved, not masked).
> - Every free-form field (host label, tool label, diagnostic strings) treated as
>   **data to escape** before it reaches HTML, styles, or (if ever persisted)
>   SQLite.

> **FR-08** — Peer polling shall be **bounded so N slow or unreachable peers can
> never stall or pile up on the tick**: each fetch carries a **bounded timeout**,
> and the fan-out has **bounded concurrency** (the Architect sets the timeout and
> concurrency cap and justifies them). A tick shall not wait on the slowest peer
> beyond the bound, and a still-in-flight fetch from a prior tick shall not
> accumulate unboundedly across ticks. The local reading and the fast peers shall
> render regardless of a slow peer.

> **FR-09** — A peer fetch that **times out, is refused, returns a non-200,
> returns unparseable JSON, or returns an oversized body** (FR-22) shall resolve
> to a **named per-host offline/error state** carrying **which host** and **why**
> (a reason code, FR-11) — **never** a fabricated reading, **never** a fabricated
> zero, and **never** a last-cached reading presented as fresh. When a peer was
> previously reachable and is now failing, the host shall read as offline/erroring
> (its last cache may be shown **explicitly flagged as stale/last-known**, per the
> existing stale-cue discipline, but never as fresh) — the Architect/Designer
> decide between "show last-known, flagged" and "show offline only"; the honesty
> requirement (never stale-as-fresh) is settled here.

### Per-host degradation, freshness & diagnostics

> **FR-10** — The existing **freshness model shall apply per host**: each host's
> tool objects carry the **server-supplied freshness thresholds** already emitted
> by `buildState()` (`freshness.freshForMs` / `staleAfterMs`), and the client
> derives each host's fresh/aging/stale band **live on the render tick** from those
> thresholds — never hardcoded, exactly as the single-host view does today. A
> peer's Claude reading carries its freshness object as received; Codex remains
> `freshness:null` (no band), per tool, per host.

> **FR-11** — Per-host and per-tool **diagnostics shall use enum reason codes**,
> as today: each tool's existing `limitsDiagnostic` codes (`stale-reading`,
> `no-statusline-reading`, `auto-refresh-failing`, `auto-refresh-disabled`,
> `codex-cmd-failed`, `no-reading`) cross the wire unchanged and are mapped
> client-side by **own-key lookup** (the shipped `hasOwnProperty` convention),
> with free-form fields escaped. Multi-host shall add the **new peer-level reason
> code(s)** it needs for FR-09 — proposed **`peer-unreachable`** (timeout /
> refused / connection error) and **`peer-error`** (non-200 / bad JSON / oversized
> body) — as enums with an escaped free-form `detail`, mapped client-side by
> own-key lookup, never rendered raw. (The Architect may collapse these into one
> code with a `cause`; the requirement is a **named, enum, escaped** peer failure
> state, not a silent drop.) The reserved names `auto-refresh-failing` /
> `auto-refresh-disabled` shall **not** be reused for peer failures.

> **FR-12** — **First-run / unconfigured honesty:** when **no peers are
> configured** (the default), **no peer states, no offline hosts, and no
> multi-host affordances shall appear** — the readout is exactly today's
> single-host dashboard. Peer/offline states appear **only** for hosts the
> operator explicitly configured (plus the always-present local host, which is
> never an "offline peer").

### The combined view & the account-wide-limits honesty

> **FR-13** — The combined view shall present **each configured host** with its
> Claude Code and Codex tool blocks — **both limits and activity** — grouped by
> host and honestly **labeled** with the host's display label. Each host block
> shall carry its **own freshness/offline/error state** independently of the
> others (FR-09, FR-10): one host aging or offline shall not flag or suppress
> another. (Exact layout — side-by-side vs stacked, host ordering — is the
> Designer's; local host is a host like any other, labeled as such.)

> **FR-14** — Each host's **per-machine activity** shall be presented as the
> **distinct, per-host data** it is (tokens, sessions, cache rate, estimated
> value, token mix — the stats the single-host tool block already renders). A host
> whose tool genuinely records no activity (e.g. a machine with no Codex sessions)
> shall render the existing honest **"not available"** state for that tool, not
> fabricated zeros — per host.

> **FR-15** — The app shall present each host's **limits as the account's
> numbers**, and shall **not present identical-account hosts as N independent
> limit budgets**, while **genuinely-different accounts still read as distinct.**
> Because llmdash **cannot always know** whether two hosts run the same account,
> the shipped **default honesty mechanism** is:
> - Every host's limit meters are **explicitly labeled as account-wide** (e.g.
>   "account limits — the same across your machines on this account"), reusing the
>   product's existing account-wide-vs-local-activity honesty language, and
> - The per-host differentiation is **led by activity** (FR-14), which is the
>   genuinely per-machine data, so the view never *implies* independent budgets
>   from repeated identical meters.
> - **Optionally** (Architect/Designer may adopt if cheap and honest): detect
>   sameness by comparing the limit **tuples / reset epochs** across hosts and,
>   when identical, **collapse or annotate** the repeated meter as "same account,
>   shown once / same as <host>"; when they differ, render each host's meter as
>   its own. This detection is a *refinement* of the labeling default, not a
>   replacement — the labeling shall stand even if detection is not built.
>
> The exact copy and visual treatment are the **Designer's** (and the framing is
> flagged for the user to ratify); the **observable requirement** is: (a) limits
> are labeled as account numbers on every host; (b) the UI does not read as N
> independent budgets when meters are identical; (c) different-account hosts read
> as distinct.

> **FR-16 [EP]** — The **single-host `/api/state` shape shall keep working
> unchanged**: the local dashboard view and the existing menu-bar badge (which
> reads a single host) shall continue to consume `/api/state` with **no field
> renamed, removed, or changed in meaning**. If multi-host data is added by
> extending `/api/state`, the extension shall be **purely additive** (new
> optional field(s)) and the existing consumers shall ignore it and behave as
> today; if it is a new endpoint, `/api/state` is untouched. Either way, an
> older single-host consumer sees no regression.

### Client rendering

> **FR-17** — The multi-host section shall be **rendered from the combined
> payload** and each host's charts/gauges shall **actually render** per host (the
> project's "verify it renders, not just that the page loads" convention) — the
> limit gauges, pacing lines, and activity tiles/mix per host, using the existing
> source-aware renderer extended by a **host dimension** on top of the existing
> **tool (source) dimension** (host × tool), **without forking** the store or the
> renderer.

> **FR-18** — A **single-host (unconfigured) install shall look exactly as
> today** — no host grouping chrome, no per-host labels beyond today's, no offline
> peer rows. The multi-host presentation shall engage **only** when more than the
> local host is configured (FR-02, FR-12).

### Disclosure

> **FR-19** — The peer-list configuration shall be **disclosed**, per the
> "surface security-relevant and environmental defaults, never silently"
> convention: documented in the **README** (the env var, its format, the
> tailnet-only / read-only outbound posture, and that the local host is always
> included), stated in the **startup log** (how many peers are configured and to
> which hosts:ports the instance will issue outbound reads), and surfaced as a
> **per-peer line in `src/health.js` `healthLines()`** naming, for each configured
> peer, what is reachable / what is missing and the fix — a cheap check, off the
> request path. When no peers are configured, the disclosure states the
> single-host reality (no outbound reads).

### Edge cases

> **FR-20 — Shape tolerance.** The poller and the combined view shall tolerate a
> peer `/api/state` with **missing or extra fields** (a peer running a slightly
> older or newer llmdash): the host degrades to a **partial or offline reading**,
> never crashing the poller or the combined view. A partial reading renders the
> fields that are present and marks the rest honestly not-available (never
> fabricated).

> **FR-21 — No transitive fan-out.** When a configured peer is **itself
> multi-host-configured**, the app shall fetch **only that peer's own `/api/state`
> reading** and shall **not** recurse or fan out to the peer's peers, nor fetch any
> host derived from a peer's payload. Multi-host is one hop, from the local
> instance to each explicitly-configured peer.

> **FR-22 — Bounded response body.** The app shall **cap the bytes read** from a
> peer response and **abort** a peer that exceeds the cap, resolving it to the
> peer-error state (FR-09). It shall **never buffer an unbounded peer body** — a
> peer is not trusted to send a small payload.

---

## Non-Functional Requirements

> **NFR-01 — Zero runtime dependencies / no build / Node 24+:** Peer polling and
> the combined view shall use **Node builtins only** (`node:http`, `node:sqlite`
> if persistence is ever added), add **no** npm runtime dependency and **no** build
> step. `package.json` runtime dependencies stay at zero.

> **NFR-02 — Request-path isolation:** No peer fetch, subprocess, or blocking I/O
> shall occur on the HTTP request path (FR-05, FR-06). The combined view is served
> from the interval-poller-maintained cache; the only per-request work is
> assembling already-cached data — the same discipline that keeps Codex's
> subprocess read and the Claude probe off the request path.

> **NFR-03 — Security · outbound-fetch posture (for the Auditor):** Multi-host
> makes llmdash issue **outbound requests** — a new posture (previously it only
> served). The following are required:
> - **Explicit configured hosts only.** Outbound reads go **only** to hosts in the
>   operator's configured list — **no peer discovery, no auto-enumeration**, no
>   fetching a host derived from any peer's payload (no transitive fan-out, FR-21).
> - **Tailnet-only, read-only.** Only an outbound **`GET /api/state`** is issued;
>   no write/control path, no other methods, **no credentials** attached. The
>   tailnet remains the trust boundary (founding decision) — no public peers.
> - **Bounded timeout AND bounded response body.** The fetch is timeout-bounded
>   (FR-08) **and** the bytes read from a peer are **capped** (FR-22) — llmdash
>   does not trust a peer to send a small body.
> - **No surprising redirect.** The fetch shall **not follow a redirect to a
>   different host** (a peer must not be able to bounce the read to an
>   unconfigured/unexpected target); a redirect resolves to the peer-error state.
> - **Every peer-supplied field is data.** Host labels, numbers, diagnostic
>   strings, and timestamps are **clamped / normalized / escaped** before they
>   reach HTML, styles, or SQLite (FR-04, FR-07) — the `sanitizeHostPort` bug class
>   (the badge's fixed Low) lives here on the host list and on every rendered peer
>   field.
> - **No new sensitive surface.** The combined endpoint exposes **only the same
>   shape already exposed** by `/api/state` (per host); it introduces no field
>   that isn't already served single-host.

> **NFR-04 — Existing hardening preserved:** All HTTP responses (including the
> combined view) shall keep the **baseline security headers** (`nosniff`, the CSP
> with `default-src 'self'` / `style-src 'unsafe-inline'` / `script-src 'self'`,
> `Referrer-Policy`) and shall **reject non-GET/HEAD with 405**. Static assets stay
> `cache-control: no-store`. Style values stay literals/coerced numbers; no peer
> field is ever interpolated into a style or raw HTML (escaped as text only).

> **NFR-05 — Honesty (product-core, non-negotiable):** Per host and per tool, the
> view shall never present a stale/aging reading as fresh, never fabricate a
> number (or a zero) where a peer has no reading or is unreachable, and shall state
> the **account-wide** nature of limits vs the **per-machine** nature of activity
> (FR-15) — the founding data-source-honesty distinction, now per host.

> **NFR-06 — Compatibility / graceful tolerance:** A peer running a slightly
> **older or newer llmdash** with a slightly different `/api/state` shape shall be
> tolerated: **missing/extra fields shall degrade to a partial or offline host
> reading, never crash** the poller or the combined view (FR-22). The feature is
> validated on the tailnet reality (Node 24+, macOS/Linux hosts over Tailscale);
> non-tailnet/public peers are out of scope.

---

## Out of Scope

- **The multi-host *badge*** — the menu-bar host-list + per-machine dropdown/glyph
  switching originally deferred from the badge. **Default: follow-on, not this
  feature** (this feature is the dashboard aggregation; badge-multi-host reuses the
  same peer config + cache once they exist). See OQ-05 — the Planner does not fold
  it in by default.
- **A tmux/terminal statusline emitter** — a separate On-the-Horizon item.
- **Cross-host limit alerts** — a separate Up-Next feature that would build *on*
  this, not inside it.
- **A control plane / write path to peers.** llmdash issues only an outbound
  **read** (`GET /api/state`) to explicitly-configured peers. No commands, no
  config push, no peer-management UI beyond the env list.
- **Peer discovery / auto-enumeration of the tailnet.** Peers are an explicit
  operator-supplied list, never auto-discovered (an auto-scan is an unexpected
  outbound surface and a fabricated-completeness risk).
- **Non-tailnet / public peers, and any authentication.** Peers are tailnet hosts
  only; the tailnet stays the trust boundary. No public exposure, no login.
- **Reconciling or merging cross-host activity into a single total.** The view
  shows hosts *side by side*; it does **not** sum, dedupe, or roll up activity or
  limits across machines (that would obscure the per-machine distinction that is
  the point). A future combined roll-up is out of scope here.
- **A cross-host history store.** Persisting peers' limit snapshots into the local
  SQLite store to build cross-host trend history is out of scope for v1 (default:
  cached-only, OQ-02). Each peer already persists its own snapshots locally.
- **Any change to the single-host `/api/state` contract's existing fields, the
  freshness thresholds/bands, or the existing diagnostic reason codes.** Existing
  consumers (local view, badge) consume the contract unchanged (FR-16). New peer
  reason codes are additive.

---

## Open Questions

> **OQ-01 — Endpoint shape: new `/api/hosts` vs extend `/api/state`? [EP]**
> **Default assumption:** the Architect decides at Stage 3. Whichever ships, the
> single-host `/api/state` shape keeps working unchanged for the local view and
> the badge (FR-16), and the combined payload is assembled from the per-host cache
> off the request path (FR-06). The requirements are endpoint-agnostic except the
> few tagged **[EP]**.

> **OQ-02 — Cached-only vs persisted peer readings?**
> **Default assumption:** **cached-only (live-from-cache), no cross-host history
> store in v1.** Peer readings live in the interval-poller-maintained per-host
> cache and are served from there; they are **not** written to the local SQLite
> store (persisting peers' snapshots / a cross-host history store is out of scope).
> The Architect confirms or overrides with justification (e.g. persisting only for
> offline-survivability of the last-known reading — which, if adopted, must keep
> the never-stale-as-fresh honesty of FR-09 and treat peer fields as data on write
> per FR-07/NFR-03).

> **OQ-03 — Env var name and per-entry format.**
> **Default assumption:** **`LLMDASH_HOSTS`**, entries `host[:port][=label]`,
> delimiter-separated (the Architect may rename to `LLMDASH_PEERS` or adjust the
> per-entry syntax with justification, but shall carry host + optional port +
> optional label, and shall document what ships). Port defaults to `config.port`;
> label defaults to the host. Unset/empty = single-host behavior (FR-02).

> **OQ-04 — Account-sameness: label-only vs detect-and-collapse?**
> **Default assumption:** **label-only is the shipped floor** (FR-15: limits
> labeled account-wide, differentiation led by activity). The detect-by-reset-epoch
> collapse/annotate is an **optional refinement** the Architect/Designer may add if
> cheap and honest; it does not replace the labeling. **The exact presentation is
> flagged for the user to ratify at the Designer stage.**

> **OQ-05 — Fold a minimal badge-multi-host into this feature?**
> **Default assumption:** **No — dashboard now, badge later.** The badge multi-host
> stays a separate deliverable; this feature ships the shared server-side plumbing
> (peer-list config, fan-out polling, per-host honesty, account-wide-limits
> framing) that de-risks the badge follow-on to a thin consumer. (Flagged for the
> user; the Planner may revisit only if it proves near-free once the plumbing
> lands — not a scope commitment here.)

> **OQ-06 — Timeout, concurrency cap, and response-body cap values.**
> **Default assumption:** the Architect sets them and justifies (FR-08, FR-22) —
> starting points: a per-peer timeout in the low seconds (the badge uses 2 s; the
> poller has more headroom than the menu bar, so a few seconds is reasonable),
> bounded concurrency (fan out, don't serialize; don't unleash unbounded parallel
> sockets on a large list), and a body cap generously above a real `/api/state`
> payload but far below anything that could exhaust memory.

---

## Success Metrics

Every functional requirement maps to at least one QA check. **[EP]** rows are
verified against whichever endpoint shape Stage 3 chose. All rows assume a
tailnet-reachable peer (or a fixture/loopback stand-in for a peer's `/api/state`).

| ID | What's Being Verified | Pass Condition |
|---|---|---|
| QA-01 | Peer-list parsing (FR-01) | The configured env var parses entries of `host[:port][=label]` (or the shipped format): host, port (defaulting to `config.port`), and label (defaulting to the host) are each read correctly; a multi-entry list yields that many peers. |
| QA-02 | Local host always present + no dead knob (FR-02) | With the list **unset/empty**, the effective host set is exactly one host (this machine) and the UI/behavior are byte-for-byte today's single-host install (no peer states, no outbound fetch). With the list set, the configured hosts drive real polling and UI. |
| QA-03 | Dedup / self not double-counted (FR-03) | The local host listed explicitly (or a duplicate `host:port`) appears **once**; the local reading is taken in-process (no HTTP round-trip to self where the local host is identifiable). |
| QA-04 | Entry validation/normalization (FR-04) | A host/port with whitespace or metacharacters is sanitized (per `sanitizeHostPort`) before use; a malformed entry surfaces honestly (startup log / per-host error) and is never silently dropped or fabricated into a reading. |
| QA-05 | Fan-out on the poller, local in-process (FR-05) | On a poller tick, a bounded-timeout `GET /api/state` is issued to each **remote** peer via Node builtins; the **local** host's reading is taken in-process (no self-HTTP). No peer fetch is issued from any HTTP request handler. |
| QA-06 | Combined view served from cache, off request path (FR-06) [EP] | A request for the combined view performs **no** peer fetch / subprocess / blocking I/O — it reads the per-host cache and assembles the response; the payload carries every host's full per-tool picture plus its own freshness/offline state. |
| QA-07 | Ingest normalize/clamp/escape (FR-07) | A peer payload with used-% >100 or <0 is clamped to 0–100; a bad/missing timestamp is **not** defaulted to "now" (host marked unusable/offline instead), a valid peer `capturedAt` is preserved (not re-stamped to local now); free-form fields are escaped before render. |
| QA-08 | Bounded timeout + concurrency (FR-08) | With one peer artificially slow/hung and several others fast, the tick completes within the bound, the fast peers and the local reading render, and in-flight fetches do not accumulate across ticks (bounded concurrency observed). |
| QA-09 | Peer failure → named offline/error, never fabricated (FR-09) | A peer that times out / refuses / returns non-200 / returns bad JSON / returns an oversized body yields a **named** per-host offline/error state (which host + why); the host is never shown as fresh, never as a fabricated zero, and any last-known reading shown is explicitly flagged (never fresh). |
| QA-10 | Per-host freshness bands (FR-10) | Each host's Claude tool carries its server-supplied `freshness` thresholds and the client derives its fresh/aging/stale band live per host; Codex remains no-band per host; one host's band does not affect another's. |
| QA-11 | Per-host diagnostics incl. new peer codes (FR-11) | Existing per-tool `limitsDiagnostic` codes render per host by own-key lookup with fields escaped; a peer failure renders the new enum code (`peer-unreachable`/`peer-error` or the shipped equivalent) mapped client-side, with escaped `detail`, never raw; reserved `auto-refresh-*` names are not reused. |
| QA-12 | Unconfigured first-run honesty (FR-12) | With no peers configured, **no** peer/offline/multi-host states appear anywhere — the readout is exactly today's single-host dashboard. |
| QA-13 | Combined view groups per host with independent state (FR-13) | Each configured host shows its Claude Code + Codex blocks (limits + activity), honestly labeled, each carrying its own freshness/offline/error state independent of the others. |
| QA-14 | Per-host activity distinct / honest not-available (FR-14) | Each host's activity stats are shown per machine as distinct data; a host tool with no activity shows the existing "not available" state (no fabricated zeros), per host. |
| QA-15 | Account-wide-limits honesty (FR-15, NFR-05) | Every host's limits are **labeled as account-wide**; the UI does **not** read as N independent budgets when meters are identical (labeling + activity-led differentiation, or the optional collapse/annotate); two genuinely-different-account hosts read as **distinct**. |
| QA-16 | Single-host contract unchanged (FR-16) [EP] | `/api/state`'s existing fields are unrenamed/unremoved/unchanged in meaning; the existing badge and the local view consume it exactly as before (any multi-host extension is additive and ignored by old consumers); no regression in the single-host path. |
| QA-17 | Per-host render (not just load) (FR-17) | The multi-host section actually **renders** each host's gauges, pacing lines, and activity tiles/mix (verified in a real browser render, not merely a 200 on the page), through the shared renderer extended by a host dimension (no forked store/renderer). |
| QA-18 | Single-host UI unchanged (FR-18) | An unconfigured install's dashboard is visually and behaviorally identical to today (no host grouping chrome, no per-host labels, no offline rows). |
| QA-19 | Disclosure (FR-19) | The README documents the env var + format + tailnet-only read-only posture + local-host-always-included; the startup log states how many peers and to which hosts:ports outbound reads go; `healthLines()` has a per-peer line naming reachable/missing + fix; with no peers, the disclosure states the single-host (no outbound) reality. |
| QA-20 | Zero deps / no build (NFR-01) | `package.json` runtime dependencies remain zero; no build step is added; peer polling uses `node:http` only. |
| QA-21 | Request-path isolation (NFR-02) | Static + runtime inspection confirm no peer fetch/subprocess/blocking I/O on any HTTP request handler; the combined view is served from the poller-maintained cache. |
| QA-22 | Compatibility / shape tolerance (FR-20, NFR-06) | A peer returning a payload with missing or extra fields (older/newer llmdash) yields a partial or offline host reading and **does not crash** the poller or the combined view. |
| QA-23 | No transitive fan-out (FR-21, NFR-03) | A peer that is itself multi-host-configured is fetched for **its own** `/api/state` reading only; llmdash does **not** recurse/fan-out to that peer's peers, and never fetches a host derived from a peer payload. |
| QA-24 | Outbound-fetch security posture (NFR-03) | Outbound reads go only to explicitly-configured hosts (no discovery); only a credential-free `GET /api/state` is issued; the fetch is timeout-bounded **and** body-capped; a redirect to a different host does not get followed (resolves to peer-error); every peer-supplied field is clamped/normalized/escaped before HTML/style/SQLite; the combined endpoint exposes only the already-exposed shape. |
| QA-25 | Response-body cap (NFR-03, FR-22) | A peer that streams a body larger than the cap is aborted at the cap and resolves to the peer-error state — llmdash never buffers an unbounded peer body. |
| QA-26 | Hardening preserved (NFR-04) | The combined view (and all responses) carry the baseline security headers and reject non-GET/HEAD with 405; static assets stay `no-store`; no peer field is interpolated into a style or raw HTML. |
| QA-27 | Clock-skew preserved, not re-stamped (FR-07) | A peer with a skewed but valid `capturedAt` has that timestamp honored as-is (normalized to canonical ISO), never re-stamped to the local now; its freshness band reflects the peer's stated capture time. |
