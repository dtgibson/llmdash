# llmdash

A small, self-hosted dashboard for your AI coding usage limits, viewable on your
phone or laptop over Tailscale. Zero dependencies, plain Node and vanilla
HTML/CSS/JS.

It tracks **Claude Code** (Max) and **Codex** (ChatGPT Plus) side by side: each
tool's 5-hour and weekly limit windows with reset countdowns and a burn-rate
projection, plus activity stats from your local logs (tokens, cache hit rate,
estimated value, token mix, cache savings). When one tool maxes out, a headroom
cue points you to the one with room left.

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
- From your phone or laptop on the tailnet: `http://<this-machine's-tailscale-name>:8787`

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
The next time Claude Code renders its status line, the gauges populate. Until
then, the activity stats already work (they come from your logs) and the gauges
show "waiting…". The script still prints a normal status line (model, folder, and
5-hour remaining), so you keep a useful status line.

## Connect Codex
Codex limits come from the **Codex app-server**, so the dashboard just needs to be
able to run `codex`. If you start it from your normal shell, that's automatic. If
you run it as a service, set `LLMDASH_CODEX_CMD` to the absolute path of your
`codex` binary (find it with `which codex`), since the service's PATH is minimal.
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

## Run as a service (optional, Linux/systemd)
Create `~/.config/systemd/user/llmdash.service` pointing `ExecStart` at your Node
binary and this directory, then:
```
systemctl --user daemon-reload
systemctl --user enable --now llmdash.service
loginctl enable-linger "$USER"   # so it runs without an active login
```

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
