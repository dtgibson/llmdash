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
The gauges populate the first time a Claude Code session renders its status
line — until a reading has arrived, they stay empty and the dashboard says so
(if your Claude Code sessions never render the CLI status line, no reading is
produced and the gauges stay empty). The activity stats work right away either
way — they come from your local logs. The script still prints a normal status
line (model, folder, and 5-hour remaining), so you keep a useful status line.

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

## How it works
- **Claude limits** come from Claude Code's statusline output (the sanctioned
  path — no credentials reused). The script writes `rate_limits` to
  `data/claude-ratelimits.json`; the server reads it and logs snapshots to SQLite.
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
   `node`, project, and `codex` paths, copy it to `~/Library/LaunchAgents/`, and
   `launchctl load -w` it. Full steps are in that file's comments.

Codex limits work the same way as on Linux (via the `codex app-server`).

## Configuration
All optional, via environment variables:
- `LLMDASH_PORT` (default `8787`)
- `LLMDASH_HOST` (default `0.0.0.0` — binds all local interfaces, so it's
  reachable on your LAN and tailnet, but not the public internet behind NAT. To
  restrict strictly to the tailnet, set this to your Tailscale IP, e.g.
  `LLMDASH_HOST=100.x.y.z`.)
- `LLMDASH_POLL_MS` (default `60000`)
- `LLMDASH_CODEX_CMD` (default `codex`) — path to the codex binary for the limits read
- `LLMDASH_CODEX_DIR` (default `~/.codex`) — where Codex's session logs live

The pricing table behind "estimated value" lives in `config.js` — edit it freely.
Snapshots and the captured reading are stored under `./data/` (gitignored).

## Tests
```
npm test
```

## Status & roadmap
Personal project. Next up: Codex (ChatGPT Plus) support, then usage-over-time
charts. See `ROADMAP.md`.
