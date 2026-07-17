# Product Context — llmdash

## What It Is
A personal, self-hosted dashboard showing remaining AI coding usage and a local
comparison of configured subscription spend with API-equivalent value. It runs on
your own machine, is viewable on phone or laptop over Tailscale, and covers Claude
Code (Max) and Codex (the live ChatGPT account tier) side by side.

## Shipped Capabilities
- **Claude Code live dashboard** — the 5-hour and weekly limit windows (remaining
  %, reset countdowns, status colors), model-specific weekly caps when Claude
  reports them, pacing predictors for **both** windows (on pace / at risk / limit
  reached, with status pills), and activity stats from local logs: tokens (5h /
  week / today), cache hit rate, session counts, and weekly token mix, with limit
  snapshots logged to SQLite.
- **Codex usage and diagnostics** — Codex's provider-reported windows sit beside
  Claude in the leading account-limit comparison, with absent windows left
  unavailable and its account facts, local activity, reasoning, work mix,
  context/compaction pressure, latency, and daily patterns grouped into one
  honest Codex story.
- **Local cost analysis** — an independent 7d / 30d / 90d view compares
  owner-confirmed subscription spend with exact-model, effective-dated
  API-equivalent values for the same retained Claude/Codex usage under observed
  and no-cache pricing, with signed cache effect, reconciled histories,
  provenance, and explicit evidence completeness for this machine.
- **Usage trends** — each tool group closes with its own vanilla-SVG limit burn,
  tokens-per-day, and cache-rate charts under one shared 24h / 7d / 30d range
  switch.
- **Claude reading freshness & auto-refresh** — the Claude limit reading shows
  its age in the tool header (flagged "aging" past 5 minutes, "stale" past 10)
  and keeps itself fresh automatically while Claude is active (including nested
  subagent work) and the Claude CLI is authenticated: the activity-gated probe
  retries at a bounded cadence after timeouts, cleans up across reloads and exits,
  degrades honestly when failing or disabled, and costs no usage quota.
- **macOS menu-bar badge** — a glanceable badge in the menu bar (via SwiftBar/xbar)
  showing the most-constrained remaining % across Claude Code and Codex (both
  windows), with a dropdown carrying the full per-tool picture, including Claude
  model-specific caps when present, and a link to the dashboard. It is a pure
  consumer of the local instance's data (no second data path, no recomputed
  limits), honest about freshness and offline state (five honesty states
  mirroring the dashboard, with `◷` for aging and `⚠` for stale), and names the
  binding tool (◆ Claude / ▲ Codex). Its dropdown keeps summary,
  detail, diagnostics, Display controls, and Legend copy readable as explicit
  high-contrast rows instead of faint default-gray menu text, and the Legend
  explains every visible badge/menu mark, including the `▪` llmdash mark. It can
  also watch **several tailnet machines at
  once**: hosts are added and removed live from its dropdown (a native dialog
  editing a local `hosts.conf`), the glyph names the tightest machine (`▪ <host>·◆ <pct>`),
  an unreachable machine is named, and a monitoring-station Mac's empty local
  reading is auto-de-emphasized ("no local activity") so the machines it watches
  stay loudest. It is **configurable from its own 🖥 Display submenu** — group by
  host or by tool (per-tool aggregates across the chosen machines), show hosts
  single / side-by-side / alternating, wide or compact, with the neutral tool marks
  or bundled opt-in Claude/OpenAI logo marks that replace those marks in SwiftBar
  using the same status color and fall back to neutral text elsewhere, plus a 🛈
  Legend explaining every mark on demand; display
  settings are a glyph-only view filter (layout and density change only the
  status-bar glyph, including compact tight cells; the dropdown remains the full
  per-host detail view and monitoring coverage never changes). Unset (the default)
  is exactly today's single-host badge, which also offers "＋ Add host…" so the
  first machine is addable from the menu bar.
- **Menu-bar install-lifecycle controls** — from the badge dropdown you can install
  or remove llmdash's local monitoring service on this Mac (turning a machine into a
  full local monitor or a badge-only monitoring station) and uninstall llmdash
  entirely — either the menu-bar badge only, or completely (service, checkout,
  statusline wiring, and trust artifacts, each enumerated before it acts) — with no
  terminal, your usage history preserved by default, and SwiftBar never removed.
- **Multi-host view** — one llmdash can place every unique reachable account's
  Claude/Codex limits in the leading comparison, collapse matching accounts once,
  and then group each tailnet machine's local activity by tool while keeping
  offline hosts explicit and using only each peer's existing `/api/state`.

## How It Works
- Vanilla Node (`node:http` + `node:sqlite`), zero npm dependencies, plain
  HTML/CSS/JS, no build step. Requires Node 24+.
- Limit data comes from Claude Code's statusline: `scripts/statusline.js` writes
  the `rate_limits` block to `data/claude-ratelimits.json`, which the server
  reads. Readings also refresh on their own: when the reading goes stale and
  Claude has been active and the Claude CLI is authenticated, the interval poller
  recognizes direct and nested subagent transcript activity through a bounded
  metadata scan, spawns a short-lived session, sends `/usage`, and scrapes that
  pane into the same reading file. A timeout preserves the last good reading;
  advancing activity can retry at the normal cadence, and startup/shutdown clean
  only marker-owned probe remnants. The `/usage` scrape can also add model-specific
  caps, and account-only statusline captures preserve those active model caps until
  reset instead of deleting them. Activity stats are computed on demand from
  `~/.claude/projects/**/*.jsonl`.
- Codex limits and account facts come from `codex app-server` (polled on the
  interval, not per request) with a rollout-file fallback; explicit duration
  identifies each current window, a complete response can authoritatively omit a
  window, and historical snapshot rows never repopulate that missing current
  slot. A bounded local scanner reduces `~/.codex/sessions` into cached aggregate
  activity and 24h/7d/30d diagnostics for `/api/codex-insights`, never returning
  raw session content or identifiers; deeper insight history is re-derived from
  logs and never written to `usage_snapshots`.
- Cost analysis reduces a bounded 90-day local Claude/Codex ledger on the poller,
  combines optional owner-confirmed subscription periods with reviewed
  effective-dated rates using fixed-point arithmetic, and atomically caches 7d,
  30d, and 90d views for its read-only endpoint; requests never scan logs, and
  cost history is not added to peer or menu contracts.
- Trends come from the same data (the snapshot series plus daily-bucketed log
  aggregation) via a separate `/api/trends?range=` endpoint, rendered as plain
  SVG. Static assets are served `no-store`; the CSP allows inline styles while
  scripts stay locked to `'self'`.
- Served on `0.0.0.0:8787`, reachable over the tailnet. This Mac runs it as the
  `com.llmdash.dashboard` user LaunchAgent; Linux installs can use the documented
  systemd user service.
- The menu-bar badge is a zero-dependency Node plugin that only does a loopback
  read of its local instance's combined `GET /api/hosts` (no outbound peer fetch
  of its own — the local instance does the fan-out). SwiftBar is a user-installed
  prerequisite (llmdash never installs it); `--setup-badge` wires it in by
  generating a wrapper in SwiftBar's plugin dir that runs the tracked plugin, so
  the checkout is never modified and the badge updates on pull (`--remove-badge`
  reverses it symmetrically). The badge's host list is a human-readable
  `hosts.conf` under the data dir that the badge edits **locally** (Add/Remove →
  a native `osascript` dialog → sanitize/validate → atomic write); `LLMDASH_HOSTS`
  seeds it once, after which the file is the source of truth (so a removed host
  can't ghost back), and the poller re-reads it each tick. The HTTP surface stays
  read-only — config edits are a local file write, never an HTTP endpoint.
- The install-lifecycle controls are the same badge-process pattern: dropdown
  actions run `launchctl`/`fs` operations locally (user-domain, no sudo) through the
  installer's `--service`/`--uninstall` hooks (the single source of truth), each
  confirmed by a fixed-literal `osascript` dialog with the safe choice as default.
  The service toggle reads the real launchd state, never a faked checkmark. The
  complete uninstall runs as a detached, self-contained helper (temp-copied) so it
  survives unloading its own service and deleting its own checkout; it rescues the
  usage-history DB to `~/.llmdash/preserved-data` before removing a checkout that
  contains it. The HTTP surface stays read-only — these are local mutations in the
  badge/helper process, never an endpoint.
- Multi-host is a host dimension on top of the tool dimension. Set `LLMDASH_HOSTS`
  (`host[:port][=label]`, comma-separated; the local host is always included) and
  the interval poller fans out a bounded, credential-free `GET /api/state` to each
  peer, caching the result per host in memory (peers are never persisted). A new
  `GET /api/hosts` serves the combined view from that cache — off the request path.
  `/api/state` and its badge/local consumers are byte-for-byte unchanged (a golden
  test guards it); the same-account collapse is a client-side derivation (matching
  reset epochs), so it needs no new server field.

## Data Sources & Honesty
- **Limits** are account-wide (each tool's own numbers) — identical across every
  machine signed in to the same account. **Activity stats** are per machine, from
  that machine's logs only. The UI states this distinction, and in multi-host mode
  it is load-bearing: same-account limits are shown once (never repeated as if
  independent budgets), while per-machine activity leads the differentiation.
- **Configured subscription spend** is fixed access cost supplied by the owner;
  **API-equivalent values** are counterfactual estimates from retained local logs,
  not invoices or provider charges, and any missing source/rate coverage remains
  visibly partial or unavailable.
- A gauge with no reading yet names the cause and the remedy (statusline not
  reporting yet, codex command not runnable) instead of silent dashes, and the
  startup log prints a data-source health readout naming anything missing.
- No history backfill: limit trends accrue from first run; token stats have full
  history from the logs.

## Deferred / Not yet built
- Nothing major queued. See `ROADMAP.md` → Up Next (limit alerts) and On the
  Horizon (a tmux/terminal statusline emitter, strict tailnet-only binding,
  LaunchAgent reload hardening, and cross-host cost history).
- Kagi (Ultimate is unlimited; no meter to show).
- General ChatGPT chat caps (no machine-readable source).
- Limit alerts/notifications.
