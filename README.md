# llmdash

A small, self-hosted dashboard for your AI coding usage limits, viewable on your
phone or laptop over Tailscale. Zero dependencies, plain Node and vanilla
HTML/CSS/JS.

It tracks **Claude Code** (Max) and **Codex** (ChatGPT Plus) side by side: each
tool's 5-hour and weekly limit windows with reset countdowns and a burn-rate
projection, plus activity stats from your local logs (tokens, cache hit rate,
estimated value, token mix, cache savings). When one tool maxes out, a headroom
cue points you to the one with room left. A **Trends** section below the gauges
charts usage over time — limit burn, tokens per day, cache hit rate, and value —
with a 24h / 7d / 30d switch.

## Why
Claude Code's limit meters live inside the tool and are easy to lose track of.
This puts the real, authoritative numbers one glance away, from any device on
your tailnet, so you can pace your work and stop getting throttled mid-task.

## Requirements
- **Node 24+** (uses the built-in `node:sqlite`). No packages to install.

## Run it
```
npm start
```
Then open it:
- On this machine: <http://localhost:8787>
- From another device on the tailnet: `http://<your-tailscale-ip>:8787` — use **http, not https**. Find the IP with `tailscale ip -4`, or use the machine's MagicDNS name. (The startup log prints the exact URL.)

To keep it running across reboots, install it as a systemd user service (a sample
unit is described below), or use your preferred process manager.

## Connect the limit data (one-time)
The limit gauges read from Claude Code's statusline. Point Claude Code at the
included script by adding this to `~/.claude/settings.json`:
```json
{
  "statusLine": {
    "type": "command",
    "command": "node /absolute/path/to/llmdash/scripts/statusline.js"
  }
}
```
The gauges populate the first time a reading arrives — a Claude Code session
rendering its status line captures one, and auto-refresh (below) captures one
automatically within a few minutes of Claude activity. Until then they stay
empty and the dashboard says so. The activity stats work right away either
way — they come from your local logs. The script still prints a normal status
line (model, folder, and 5-hour remaining), so you keep a useful status line.

### Reading freshness & auto-refresh
Claude limit readings arrive two ways. Any real Claude Code CLI session that
renders its status line captures one (the desktop app doesn't render the
statusline). And **auto-refresh** covers the rest: when the reading is older
than 5 minutes while Claude has been active in the last 10 (newest transcript
under `~/.claude/projects`), the dashboard spawns a **short-lived Claude Code
session** in a dedicated folder, reads its `/usage` screen, and closes it —
typically a few seconds of lifetime, at most one attempt per 5 minutes. The
probe types only the `/usage` command: **no message is ever sent, no plan
usage is consumed, and no transcript is written**, so your activity stats stay
clean. While Claude is idle the dashboard does zero refresh work — the reading
can't have changed, and the age label carries the truth. Failed attempts back
off (5 minutes doubling to a 60-minute cap), and after 3 consecutive failures
the UI says auto-refresh is failing and why.

Two Claude-owned files are touched, both written by Claude Code itself and
disclosed here and in the startup log: `~/.claude.json` holds a **one-time
"trust this folder" entry** for the probe's dedicated directory
(`~/.llmdash/claude-refresh-cwd`), and `~/.claude/history.jsonl` gains one
line (the `/usage` command) per refresh.

The dashboard never hides a reading's age: the Claude header shows it
("updated 7m ago"), and as the reading ages it picks up a status pill —
**aging** past 5 minutes, then **stale** past 10 minutes, with a note under
the gauges stating the age and the remedy. The gauges keep showing the last
capture — flagged, never blanked. The manual remedy always works too: open a
Claude Code CLI session and the next statusline render refreshes the reading.

The knobs (all optional):
- `LLMDASH_CLAUDE_AUTOREFRESH` — auto-refresh is **on by default**; set `0`
  (or `false`) to turn it off. Off means zero spawns, and a stale reading says
  "Auto-refresh is off" instead of failing silently.
- `LLMDASH_CLAUDE_CMD` (default `claude`) — the claude binary the probe runs.
  Under launchd this **must be an absolute path** (same reason as
  `LLMDASH_CODEX_CMD`); the macOS installer bakes it in.
- `LLMDASH_CLAUDE_REFRESH_TIMEOUT_MS` (default `30000`, clamped 5 s–5 m) — how
  long one probe may run before it's torn down and counted a failure.
- `LLMDASH_CLAUDE_MAX_AGE_MS` (default `300000` = 5 minutes) — the one
  freshness knob: the refresh threshold and the aging band; stale (and the
  activity window) is always 2× that and is not configurable separately.

## Connect Codex
Codex limits come from the **Codex app-server**, so the dashboard just needs to be
able to run `codex`. If you start it from your normal shell, that's automatic. If
you run it as a service, `LLMDASH_CODEX_CMD` **must be the absolute path** of your
`codex` binary (find it with `which codex`) — services run with a minimal PATH
(launchd: `/usr/bin:/bin:/usr/sbin:/sbin`), where a bare `codex` can never
resolve. The macOS installer resolves the absolute path for you (probing
`~/.local/bin`, `/opt/homebrew/bin`, and `/usr/local/bin` if codex isn't on
PATH); if you installed Codex *after* llmdash, just re-run the installer — it's
safe to re-run and bakes in the path. When the command can't be run, the
dashboard says so (startup log + UI) instead of failing silently.
Codex activity stats read from `~/.codex/sessions` and fill in as you use Codex.

## Menu-bar badge (SwiftBar) — optional
A one-glance remaining-% badge for your macOS menu bar: the **most-constrained
window** across Claude Code and Codex, updating on its own, with a dropdown that
carries the full picture (both tools × both windows, reset countdowns, freshness,
diagnostics). It's a tiny **zero-dependency Node plugin** (`scripts/menubar/llmdash.5s.js`)
that reads the dashboard's existing `/api/state` — no second data path, no extra
dependency for llmdash itself.

**SwiftBar is a prerequisite you install once — llmdash never installs it for you.**
It's a free third-party menu-bar host (the badge also works on xbar):
```
brew install --cask swiftbar
```
Open SwiftBar once and pick a plugin folder when it asks (e.g.
`~/Library/Application Support/SwiftBar/Plugins`).

**Install the plugin** — one command bakes the absolute `node` path into the
plugin (the menu-bar host spawns it under a minimal PATH where a bare `node`,
especially under nvm, can't resolve — the same reason `codex`/`claude` need
absolute paths) and, if it finds SwiftBar's plugin folder, symlinks the plugin in:
```
~/llmdash/scripts/install-macos.sh --setup-badge
```
Prefer to do it by hand? Copy or symlink the plugin into your SwiftBar plugin
folder and mark it executable (edit its first line to your absolute `node` path,
from `which node`):
```
ln -s ~/llmdash/scripts/menubar/llmdash.5s.js "<your-SwiftBar-plugin-dir>/llmdash.5s.js"
chmod +x ~/llmdash/scripts/menubar/llmdash.5s.js
```
The `.5s.` in the filename is SwiftBar's refresh-interval convention (re-run every
5 seconds); change the number, not the pattern, to slow it down.

**Remove it** — one symmetric command. It unlinks only the plugin symlink from
SwiftBar's plugin folder (it never deletes the repo file, and never touches a
real file you placed there yourself):
```
~/llmdash/scripts/install-macos.sh --remove-badge
```
That removes the *plugin*, not SwiftBar. If you want the host gone too, that stays
your explicit choice — llmdash never uninstalls it for you:
```
brew uninstall --cask swiftbar
```

**Point it at your dashboard.** By default the badge reads `http://127.0.0.1:8787`.
Two knobs, at the top of the plugin file or as environment variables (the only
config surface — each drives both the fetch and the *Open dashboard* link):
- **`LLMDASH_PORT`** (default `8787`) — match a non-default dashboard port.
- **`LLMDASH_BADGE_HOST`** (default `127.0.0.1`) — point the badge at a dashboard
  running on **another machine** (e.g. a Tailscale IP like `100.x.y.z`), since
  llmdash is often served over your tailnet. Still the same `/api/state` — the
  badge never becomes a second, independent reading.

**Reading the glyph.** It reads `▪ <tool> <number><marker>`:
- `▪` — the stable llmdash mark (always there, so it's recognizable in the bar).
- **`C` / `X`** — which tool is tightest: **C = Claude Code, X = code&#x200B;X (Codex)**.
- The number is the lowest remaining % across both tools' windows, colored
  **green / amber / red** by how much is left.

The badge mirrors the dashboard's honesty — it never shows a confident number
that's secretly old, and it never fabricates one:
- **fresh** — a plain, confident number (`▪ C 46%`).
- **aging** — the number kept, with a trailing `·` and a slight dim (the reading
  is getting old but you still see how much).
- **stale** — the number tinted amber with a trailing `⚠`.
- **no reading yet** — `▪ —` (a dash, never a number); the dropdown says why per tool.
- **offline** — `▪ llmdash ⚠` when the dashboard isn't reachable — unmistakably
  "no server," **never** a number that could be mistaken for headroom.

The **live in-menu-bar view requires SwiftBar** (the one prerequisite). Without it,
the plugin still runs from a terminal (`node scripts/menubar/llmdash.5s.js`) and
prints the same SwiftBar-format output, which is how you can preview the states.

## How it works
- **Claude limits** come from Claude Code's statusline output (the sanctioned
  path — no credentials reused). The script writes `rate_limits` to
  `data/claude-ratelimits.json`; the server reads it and logs snapshots to SQLite.
- **Claude auto-refresh** keeps that reading fresh on desktop-app-only days: a
  stale reading during Claude activity triggers a short-lived `/usage` probe
  session (on the interval poller, never per request) that writes the same
  file. Newest capture wins — a probe never overwrites a newer statusline
  reading.
- **Codex limits** come from `codex app-server` (`account/rateLimits/read`),
  polled on an interval (not per request) and snapshotted to the same table with
  `source = "codex"`; a rollout-file cache is used as a fallback.
- **Activity** is computed on demand from each tool's local logs
  (`~/.claude/projects/**/*.jsonl`, `~/.codex/sessions/**/rollout-*.jsonl`).
- Limits are **account-wide**; activity is **from this machine's logs only**. The
  UI says which is which.
- On startup the server logs a **data-source health readout**: whether a Claude
  statusline reading exists (and how old it is), whether the configured codex
  command is runnable, and whether Codex has recorded any sessions on this
  machine — each missing source comes with the fix. Empty gauges in the UI carry
  the same explanation.

## Run as a service (optional, Linux/systemd)
Create `~/.config/systemd/user/llmdash.service` pointing `ExecStart` at your Node
binary and this directory, then:
```
systemctl --user daemon-reload
systemctl --user enable --now llmdash.service
loginctl enable-linger "$USER"   # so it runs without an active login
```

## Running on macOS (launchd)

**One-line install** (checks Node, clones to `~/llmdash`, sets up the launchd
service, wires the statusline):
```
curl -fsSL https://raw.githubusercontent.com/dtgibson/llmdash/main/scripts/install-macos.sh | bash
```
It's safe to re-run (it updates and reloads). Prefer to read the script first?
It's at `scripts/install-macos.sh`. Manual steps below if you'd rather.

---

The app itself is cross-platform (Node + a vanilla web UI); only the
background-service setup differs from Linux. On a Mac:

1. **Node 24+** is required (for the built-in SQLite): `node -v`.
2. Clone the repo (e.g. `~/llmdash`) and run it once with `npm start`, then open
   <http://localhost:8787>, or from another tailnet device `http://<your-mac's-tailscale-ip>:8787` — **http, not https** (find the IP with `tailscale ip -4`).
3. Point Claude Code's statusline at *your* path in `~/.claude/settings.json`:
   `"command": "node /Users/you/llmdash/scripts/statusline.js"`.
4. To run it in the background (the launchd equivalent of the systemd service),
   use the template at `macos/com.llmdash.dashboard.plist.example` — fill in your
   `node`, project, `codex`, and `claude` paths (the last is what auto-refresh
   runs; absolute, same launchd reason as `codex`), copy it to
   `~/Library/LaunchAgents/`, and `launchctl load -w` it. Full steps are in that
   file's comments. The one-line installer above does all of this for you,
   including resolving the absolute `claude` path.

Codex limits work the same way as on Linux (via the `codex app-server`).

## Configuration
All optional, via environment variables:
- `LLMDASH_PORT` (default `8787`)
- `LLMDASH_HOST` (default `0.0.0.0` — binds all local interfaces, so it's
  reachable on your LAN and tailnet, but not the public internet behind NAT. To
  restrict strictly to the tailnet, set this to your Tailscale IP, e.g.
  `LLMDASH_HOST=100.x.y.z`.)
- `LLMDASH_POLL_MS` (default `60000`)
- `LLMDASH_CLAUDE_MAX_AGE_MS` (default `300000` = 5 minutes) — Claude reading
  age at which the dashboard flags it "aging" and auto-refresh may act;
  "stale" is always 2× this value. Clamped: non-numeric or ≤ 0 falls back to
  the default, and values above 7 days (`604800000`) clamp to 7 days
- `LLMDASH_CLAUDE_AUTOREFRESH` (default on) — set `0` or `false` to disable
  the auto-refresh probe entirely (no other value disables it)
- `LLMDASH_CLAUDE_CMD` (default `claude`) — path to the claude binary for the
  auto-refresh probe (absolute under launchd; the installer bakes it in)
- `LLMDASH_CLAUDE_REFRESH_TIMEOUT_MS` (default `30000`) — one probe attempt's
  time budget; clamped to 5000–300000 ms
- `LLMDASH_CODEX_CMD` (default `codex`) — path to the codex binary for the limits read
- `LLMDASH_CODEX_DIR` (default `~/.codex`) — where Codex's session logs live

The **menu-bar badge** reads two of its own (in the plugin's environment, not the
server's — see [Menu-bar badge](#menu-bar-badge-swiftbar--optional)):
- `LLMDASH_PORT` (default `8787`) — the badge honors the same port knob as the server
- `LLMDASH_BADGE_HOST` (default `127.0.0.1`) — point the badge at a dashboard on
  another tailnet machine; drives both the badge's fetch and its *Open dashboard* link

The pricing table behind "estimated value" lives in `config.js` — edit it freely.
Snapshots and the captured reading are stored under `./data/` (gitignored).

## Tests
```
npm test
```

## Status & roadmap
Personal project. Claude Code and Codex are both tracked, with usage-over-time
trends, auto-refreshing Claude readings, and an optional SwiftBar menu-bar badge
all shipped. Next up: low-limit alerts (and, on the horizon, a multi-host badge
that shows several tailnet dashboards at once). See `ROADMAP.md`.
