# Strategic Brief — Multi-Host

## What We're Building
A multi-host view: one llmdash instance presents several of the user's own
machines' readings — each host's limit windows **and** its activity, side by
side — instead of only the machine it runs on. The local instance polls each
configured tailnet peer's existing `/api/state` on its interval, caches the
results, and serves a combined view of all hosts (itself included). Each host is
honestly labeled and independently fresh / stale / offline. It generalizes the
just-shipped badge's single configurable host (`LLMDASH_BADGE_HOST`) from *one*
host to a *list* of peers, and moves that generalization onto the dashboard.

## Why Now
Two things landed that make this the natural next move, not a leap:

- **The badge established the pattern.** The menu-bar badge (DECISIONS.md
  2026-07-02) already made a client read `/api/state` from a *chosen* tailnet
  host, with a `fetchState(host, port)` shaped — in its own comment — "so a
  future multi-host build can map over a list." The badge deliberately deferred
  the host *list* to keep its single-glyph scope clean, logging "multi-host
  badge" on the roadmap's On the Horizon. This feature is that deferred
  follow-on, expanded from the badge to the dashboard: the same `/api/state`
  contract, the same over-the-tailnet read, now fanned out to N peers.
- **The reach is the point.** The founding promise is "one glance, all your
  usage." For a user who codes on more than one machine, that glance is
  currently incomplete: today each machine runs its own llmdash and shows only
  *its* activity. Multi-host completes the glance by adding "across machines" to
  the founding "across tools" — you see where your tokens and sessions actually
  went, per machine, in one place.

## The User Problem
The user paces AI-coding work to avoid getting throttled, and they work across
more than one machine (e.g. a laptop and a desktop / VM). Today each machine's
llmdash is an island: to know how much of *today's* activity happened on the
desktop vs the laptop, they open two dashboards on two tailnet URLs and hold the
comparison in their head. There is no single surface that answers "across all my
machines, where did my usage go, and where do I have room." The founding
"single place to see your headroom" promise silently narrows to "single place,
*this machine's* view" the moment a second machine exists.

**The honest core of this problem — and this feature — is what multi-host
actually buys you, because limits and activity behave differently across
machines:**

- **Activity is per-machine.** Token counts, session counts, cache rates,
  estimated value — all derived from *this machine's* local logs
  (`~/.claude/projects`, `~/.codex/sessions`). This is the **genuine new
  information** a multi-host view adds: your two machines have genuinely
  different activity, and seeing them side by side is the real payoff.
- **Limits are account-wide.** Claude Code's and Codex's remaining-% and reset
  windows are the *account's* numbers — for the **same account on every
  machine, they are identical**. A naive multi-host limits view would show the
  same meter N times and imply N independent budgets, which is exactly the
  dishonesty the product exists to prevent (CLAUDE.md: "be honest in the UI").
  The limits still matter per host **when the user runs different accounts on
  different machines** (e.g. a personal Max on the laptop, a work account on the
  desktop) — then each host's meter is genuinely its own. The view must not
  *assume* either case; it must present limits truthfully for both.

So the feature's job is: show every host's activity (always new information),
and show every host's limits **without implying independence that may not
exist** — label them as the account's numbers, and let genuinely-distinct
accounts read as distinct while identical-account hosts don't masquerade as
separate budgets.

## Success Criteria
- One llmdash instance shows several configured hosts' readings together — each
  host's Claude Code + Codex limit windows *and* activity, side by side, the
  local machine included as one of the hosts.
- The combined data is assembled by **polling each peer's `/api/state` on the
  interval poller**, cached, and served from cache — **never** a peer fetch on
  the HTTP request path (a hard CLAUDE.md convention: no network/subprocess on
  the request path; the badge and Codex reads already honor this).
- Each host degrades **independently and honestly**: a reachable peer shows
  fresh/aging/stale per the existing freshness bands; an unreachable or
  erroring peer shows a named **offline/error** state (which host, why) — never
  dropped silently, never shown as fabricated zeros or a last-cached reading
  passed off as fresh.
- The **account-wide-limits reality is stated in the UI**: identical-account
  hosts do not read as N independent limit budgets; the limits are labeled as
  the account's numbers, with per-machine *activity* presented as the distinct,
  per-host data. (The exact copy/layout is the Designer's; the honesty
  requirement is settled here.)
- Multi-host flows through the **shared source-aware path** — it adds a *host*
  dimension on top of the existing *tool* (source) dimension without forking the
  store or the renderer (CLAUDE.md multi-source discipline).
- No new runtime dependencies, no build step; peer polling is Node builtins only
  (the badge's `fetchState` is the template — `node:http`, bounded timeout).
- Externally-sourced peer data is treated as data to escape/clamp/normalize at
  ingest exactly as a local reading is (clamp used-% 0–100, normalize
  timestamps to canonical ISO, escape host labels and free-form fields before
  they touch HTML/styles) — CLAUDE.md conventions apply to a peer's payload the
  same as to a raw source.

## Scope
- **A configured peer-host list** via the `LLMDASH_*` env pattern (recommended
  `LLMDASH_HOSTS` / `LLMDASH_PEERS`): each entry a tailnet hostname or IP, with
  optional per-host label and port. The **local host is always included**
  (itself), so an unconfigured install behaves exactly as today (single host =
  this machine). No dead knob: an empty/unset list = today's single-host
  behavior.
- **Peer polling on the interval poller** (`src/poller.js`): each tick, fan out
  a bounded-timeout `GET /api/state` to each configured peer, normalize/clamp
  the payload, and cache it keyed by host. Reuse the existing `/api/state`
  contract as the per-host source — **no new per-host data path**. (The badge's
  `fetchState(host, port)` with its timeout and failure→offline handling is the
  ready template.)
- **A combined server view.** The aggregated multi-host data crosses the wire to
  the dashboard client. Whether that is a new endpoint (e.g. `/api/hosts`) or an
  extension of `/api/state` is an **Architect call** — the principle is: one
  combined payload, assembled from cache, off the request path, carrying every
  host's full per-tool picture plus its own freshness/offline state. The single-
  host `/api/state` shape must keep working unchanged for the local view and for
  the badge (which still reads a single host).
- **A dashboard multi-host section/mode** (the primary surface): each host's
  tool blocks (limits + activity) shown together, each host honestly labeled and
  independently fresh/stale/offline, with the account-wide-limits honesty made
  explicit. Exact layout is the Designer's.
- **Per-host honesty & degradation.** The existing freshness bands and
  `limitsDiagnostic` reason codes now apply **per host**. An offline peer is a
  named offline state. A peer whose reading is stale carries its stale cue. The
  account-wide-limits framing is part of this honesty surface.

## Out of Scope
- **The multi-host *badge*** — the host-list + per-machine dropdown/glyph
  switching originally deferred from the menu-bar badge. **Recommended:
  follow-on, not this feature** (see Key Decisions). This feature is the
  *dashboard* aggregation; badge-multi-host reuses the same peer-list config and
  aggregation once they exist, and stays a separate, focused deliverable. If it
  turns out to be nearly free once the config + aggregation land, the Planner may
  fold in a thin version — but the default is: dashboard now, badge later.
- **A tmux/terminal statusline emitter** — a separate On-the-Horizon item; not
  pulled in here.
- **Limit alerts** across hosts — Up Next item 1 is a separate feature; a
  cross-host alert would build *on* this, not inside it.
- **A control plane / write path to peers.** llmdash only ever issues an
  outbound **read** (`GET /api/state`) to explicitly-configured peers. No
  commands, no config push, no peer management UI beyond the env list.
- **Peer discovery / auto-enumeration of the tailnet.** Peers are an explicit
  operator-supplied list, never auto-discovered — an auto-scan would be an
  unexpected outbound-traffic surface and a fabricated-completeness risk.
- **Non-tailnet / public peers.** Peers are tailnet hosts only; the tailnet
  remains the trust boundary (founding decision). This does not add public
  exposure or authentication.
- **Reconciling or merging cross-host activity into a single total.** The view
  shows hosts *side by side*; it does not sum or dedupe activity across machines
  (that would obscure the per-machine distinction that is the whole point). A
  future "combined" roll-up, if ever wanted, is out of scope here.
- **Retrofitting the local snapshot store to persist peers' limit history.**
  Peers already persist their own snapshots locally; whether this instance
  stores peer readings at all (vs. showing them live-from-cache only) is an
  Architect call, but building a cross-host history store is out of scope for v1.

## Key Decisions
- **Account-wide-limits honesty is the load-bearing product decision.** The
  genuine new information multi-host adds is **per-machine activity**; the
  **limits are the account's numbers** and are *identical across same-account
  hosts*. The view must not imply N independent limit budgets when there may be
  one account's meter shown N times — but must still let *genuinely different
  accounts* on different machines read as distinct. This is squarely the
  product's "be honest in the UI" convention. The **user must eventually ratify
  how this is presented** (the framing and copy) — flag for the Designer/user.
- **Aggregation happens on the interval poller, never on the request path.**
  The local instance polls each peer's `/api/state` on its existing tick,
  caches per host, and serves from cache. This is a hard CLAUDE.md convention
  (network/subprocess off the request path — the reason Codex limits are read in
  the poller, not per request); a peer fetch is network I/O and belongs on the
  interval, bounded by a timeout, with failure → a per-host offline state. The
  badge's `fetchState(host, port)` (bounded, failure→offline) is the template.
- **The dashboard is the surface; the badge's multi-host is a follow-on.**
  Scope this feature to the dashboard multi-host view to keep it focused on the
  aggregation itself; badge-multi-host (the originally-deferred host list) reuses
  the same peer config + cache and stays a separate deliverable. Reason: the hard
  new work — the peer-list config, the fan-out polling, the honest per-host
  degradation, and the account-wide-limits framing — is all server-side and
  shared; doing it once, for the dashboard, de-risks the badge follow-on to a thin
  consumer. (If it's near-free once the plumbing lands, the Planner may include a
  minimal badge version — but that's a Planner call, not a scope commitment here.)
- **Reuse the existing `/api/state` contract as the per-host source; add a host
  dimension, don't fork.** "Source-aware" now has **two axes: host × tool**. Each
  peer's payload is consumed exactly as the local one, and the combined view adds
  hosts through the shared path — it does not fork the store or the renderer
  (CLAUDE.md multi-source). The exact modeling (endpoint shape, whether/where
  peer readings are cached or persisted) is the **Architect's** call; this brief
  fixes the *principle*, not the schema.
- **Config: an explicit peer list, local host always included, degrades
  honestly.** `LLMDASH_HOSTS`/`LLMDASH_PEERS` (Architect names it), each entry a
  tailnet host/IP + optional label + port. No dead knob: unset = today's
  single-host behavior. A misconfigured/unreachable peer is a named offline/error
  state, never a fabricated reading. Host labels and any peer-supplied fields are
  **data to escape** before they touch HTML/styles (the badge's `sanitize` /
  `sanitizeHostPort` discipline generalizes here).
- **Security posture — outbound peer fetch, for the Auditor.** Multi-host makes
  llmdash issue **outbound requests to configured peer hosts** — a new posture
  (previously llmdash only *served*). Keep them **tailnet-only, to
  explicitly-configured hosts only, off the request path, with sane timeouts**.
  A peer's `/api/state` is **semi-trusted** — it's the user's own machine, but
  treat every field (host labels, numbers, diagnostic strings, timestamps) as
  data to clamp/normalize/escape, never interpolated raw into HTML or styles
  (CLAUDE.md; and the badge's `sanitizeHostPort` was itself a fixed Low from the
  badge's security pass — the same class of bug lives here on the host list).
  **Flag for the Auditor:** SSRF-shaped surface (llmdash fetching operator-named
  hosts), response-body bounding (don't trust a peer to send a small body —
  cap/timeout it), and per-host field escaping on render.
- **Alignment confirmed — a conscious, minor scope expansion, no founding-brief
  rewrite required.** The founding product is single-**user** but was framed
  single-**machine** ("Runs on this machine where the usage data lives… serves a
  web UI over Tailscale, reachable from phone or computer" — i.e. *view* from
  many devices, *data* from one machine). Multi-host broadens "runs on this
  machine" → "aggregates across *my* machines" while staying **single-user,
  tailnet-only, same sanctioned per-tool data**. It *strengthens* the founding
  "pace your work across tools" promise by adding "across machines"; it does not
  add multi-user, auth, sharing, teams, or public exposure (all still explicitly
  out of scope per the founding brief). **No founding-brief rewrite is required.**
  Optional one-line update the brief *might* want, if the user chooses to record
  the widened reach: soften "Runs on this machine" (Founding Decisions) to
  something like "Runs on your machine(s); one instance can aggregate several of
  your own machines over the tailnet." Flag as optional, not a blocker.
