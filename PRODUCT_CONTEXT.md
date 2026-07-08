# Product Context — llmdash

## What It Is
A personal, self-hosted dashboard showing your remaining AI coding usage. It runs
on your own machine and is viewable on phone or laptop over Tailscale. It covers
Claude Code (Max) and Codex (ChatGPT Plus) side by side.

## Shipped Capabilities
- **Claude Code live dashboard** — the 5-hour and weekly limit windows (remaining
  %, reset countdowns, status colors), pacing predictors for **both** windows
  (on pace / at risk / limit reached, with status pills), and activity stats from
  local logs: tokens (5h / week / today), cache hit rate, estimated value, weekly
  token mix, cache savings, and today's value. Limit snapshots are logged to SQLite.
- **Codex usage** — Codex's 5-hour and weekly limits beside Claude Code, with a
  headroom cue (across both windows) that points you to the tool with room left
  when one is low or maxed. Codex token activity is read from its local session
  logs too (tokens, cache hit rate, estimated value, token mix); its cached tokens
  are a subset of input, so the totals stay honest. A maxed window reads "limit
  reached."
- **Usage trends** — a Trends section below the gauges charts usage over time per
  tool (limit burn, tokens per day, cache rate, estimated value) in vanilla SVG,
  with a 24h / 7d / 30d range switch.
- **Claude reading freshness & auto-refresh** — the Claude limit reading shows
  its age in the tool header (flagged "aging" past 5 minutes, "stale" past 10)
  and keeps itself fresh automatically: while Claude is active, an activity-gated
  probe scrapes a `/usage` pane into the reading file, so a desktop-app-only day
  no longer leaves the headline number permanently stale — no manual CLI ritual.
  It degrades honestly (a failing probe or a disabled one says so; gauges keep
  rendering the last capture) and costs no usage quota.
- **macOS menu-bar badge** — a glanceable badge in the menu bar (via SwiftBar/xbar)
  showing the most-constrained remaining % across Claude Code and Codex (both
  windows), with a dropdown carrying the full per-tool picture and a link to the
  dashboard. It is a pure consumer of the local instance's data (no second data
  path, no recomputed limits), honest about freshness and offline state (five
  honesty states mirroring the dashboard, with `◷` for aging and `⚠` for stale),
  and names the binding tool (◆ Claude / ▲ Codex). Its dropdown keeps summary,
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
  or opt-in logos, plus a 🛈 Legend explaining every mark on demand; display
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
- **Multi-host view** — one llmdash can show several of your tailnet machines
  together: each host's account-wide limit windows and its per-machine activity,
  side by side, honestly labeled and independently fresh / stale / offline. Because
  limits are account-wide, same-account machines collapse into a single "Account
  limits" banner (identical meters shown once, never N budgets) while each machine
  leads with its own distinct activity; an unreachable host shows a named offline
  callout, never a stale meter. It reads each peer's existing `/api/state` — no new
  per-host data path. Unset (the default) leaves the single-host dashboard exactly
  as before.

## How It Works
- Vanilla Node (`node:http` + `node:sqlite`), zero npm dependencies, plain
  HTML/CSS/JS, no build step. Requires Node 24+.
- Limit data comes from Claude Code's statusline: `scripts/statusline.js` writes
  the `rate_limits` block to `data/claude-ratelimits.json`, which the server
  reads. Readings also refresh on their own: when the reading goes stale and
  Claude has been active, the interval poller spawns a short-lived session, sends
  `/usage`, and scrapes that pane into the same reading file (the statusline
  render itself never carries limits for a desktop-app user). Activity stats are
  computed on demand from `~/.claude/projects/**/*.jsonl`.
- Codex limits come from `codex app-server` (polled on the interval, not per
  request) with a rollout-file fallback; Codex activity from
  `~/.codex/sessions`. Both tools flow through one source-aware path and the same
  UI components; each is a `source` value in `usage_snapshots`.
- Trends come from the same data (the snapshot series plus daily-bucketed log
  aggregation) via a separate `/api/trends?range=` endpoint, rendered as plain
  SVG. Static assets are served `no-store`; the CSP allows inline styles while
  scripts stay locked to `'self'`.
- Served on `0.0.0.0:8787`, reachable over the tailnet. Runs as a systemd user
  service (`llmdash.service`) with lingering enabled, so it survives reboots.
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
- A gauge with no reading yet names the cause and the remedy (statusline not
  reporting yet, codex command not runnable) instead of silent dashes, and the
  startup log prints a data-source health readout naming anything missing.
- No history backfill: limit trends accrue from first run; token stats have full
  history from the logs.

## Deferred / Not yet built
- Nothing major queued. See `ROADMAP.md` → Up Next (limit alerts) and On the
  Horizon (a tmux/terminal statusline emitter, strict tailnet-only binding, the
  auto-refresh teardown follow-up, the Fable per-model weekly meter).
- Kagi (Ultimate is unlimited; no meter to show).
- General ChatGPT chat caps (no machine-readable source).
- Limit alerts/notifications.
