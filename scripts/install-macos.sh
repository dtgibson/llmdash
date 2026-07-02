#!/usr/bin/env bash
# One-line macOS installer for llmdash:
#   curl -fsSL https://raw.githubusercontent.com/dtgibson/llmdash/main/scripts/install-macos.sh | bash
#
# Checks Node, clones the repo, installs a launchd background service, and wires
# the Claude Code statusline. Safe to re-run (updates + reloads). Override the
# install dir or port with LLMDASH_DIR / LLMDASH_PORT.
set -euo pipefail

REPO="https://github.com/dtgibson/llmdash.git"
DIR="${LLMDASH_DIR:-$HOME/llmdash}"
PORT="${LLMDASH_PORT:-8787}"
PLIST="$HOME/Library/LaunchAgents/com.llmdash.dashboard.plist"

# Resolve codex to an ABSOLUTE path. launchd runs agents with a minimal PATH
# (/usr/bin:/bin:/usr/sbin:/sbin), so a bare "codex" baked into the plist can
# NEVER resolve there — the service would silently show no Codex limits. When
# codex isn't on this shell's PATH either (e.g. installed per-user), probe the
# common install locations before giving up.
resolve_codex() {
  if command -v codex >/dev/null 2>&1; then
    command -v codex
    return 0
  fi
  local d
  for d in "$HOME/.local/bin" /opt/homebrew/bin /usr/local/bin; do
    if [ -x "$d/codex" ]; then
      echo "$d/codex"
      return 0
    fi
  done
  return 1
}

# Resolve claude to an ABSOLUTE path, for the same launchd reason: the
# dashboard's auto-refresh spawns the claude binary, and a bare "claude" can
# never resolve under launchd's minimal PATH.
resolve_claude() {
  if command -v claude >/dev/null 2>&1; then
    command -v claude
    return 0
  fi
  local d
  for d in "$HOME/.local/bin" /opt/homebrew/bin /usr/local/bin; do
    if [ -x "$d/claude" ]; then
      echo "$d/claude"
      return 0
    fi
  done
  return 1
}

# Test/maintenance hooks: print the resolved codex/claude path (exit 1 if none)
# without running the installer. Used by tests/install-macos.test.js.
if [ "${1:-}" = "--resolve-codex" ]; then
  if p="$(resolve_codex)"; then echo "$p"; exit 0; else exit 1; fi
fi
if [ "${1:-}" = "--resolve-claude" ]; then
  if p="$(resolve_claude)"; then echo "$p"; exit 0; else exit 1; fi
fi

echo "llmdash installer (macOS)"

# 1. Node 24+ (needed for the built-in SQLite)
if ! command -v node >/dev/null 2>&1; then
  echo "  Node not found. Install Node 24+ first (e.g. 'brew install node'), then re-run." >&2
  exit 1
fi
if [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  echo "  Node 24+ required (found $(node -v)). Upgrade (e.g. 'brew upgrade node'), then re-run." >&2
  exit 1
fi
echo "- Node $(node -v) OK"

# 2. Clone or update
if [ -d "$DIR/.git" ]; then
  echo "- Updating existing checkout at $DIR"
  git -C "$DIR" pull --ff-only
else
  echo "- Cloning into $DIR"
  git clone --depth 1 "$REPO" "$DIR"
fi

# 3. Detect binaries
NODE_BIN="$(command -v node)"
CODEX_OK=1
if CODEX_BIN="$(resolve_codex)"; then
  echo "- codex found: $CODEX_BIN"
else
  # Don't silently bake a guaranteed-dead bare "codex" into the plist: warn
  # loudly, say how to fix it, and let the dashboard's own health readout and
  # UI name the cause instead of failing silently.
  CODEX_BIN="codex"
  CODEX_OK=0
  echo "  WARNING: codex not found (checked PATH, ~/.local/bin, /opt/homebrew/bin, /usr/local/bin)." >&2
  echo "  Codex limits will NOT work yet: the service runs under launchd's minimal PATH," >&2
  echo "  where a bare 'codex' can never resolve. The dashboard will say so in its" >&2
  echo "  startup log and UI rather than fail silently." >&2
  echo "  Fix: install the Codex CLI, then re-run this installer (safe to re-run) —" >&2
  echo "  it bakes the absolute codex path into the service." >&2
fi
CLAUDE_OK=1
if CLAUDE_BIN="$(resolve_claude)"; then
  echo "- claude found: $CLAUDE_BIN"
else
  # Same reasoning as codex: never bake a guaranteed-dead bare "claude" in
  # silently — warn loudly and let the health readout/UI name the cause.
  CLAUDE_BIN="claude"
  CLAUDE_OK=0
  echo "  WARNING: claude not found (checked PATH, ~/.local/bin, /opt/homebrew/bin, /usr/local/bin)." >&2
  echo "  Claude limit auto-refresh will NOT work yet: the service runs under launchd's" >&2
  echo "  minimal PATH, where a bare 'claude' can never resolve. Readings then refresh" >&2
  echo "  only when a real Claude Code session renders its status line, and the" >&2
  echo "  dashboard will say so rather than fail silently." >&2
  echo "  Fix: install the Claude Code CLI, then re-run this installer (safe to re-run) —" >&2
  echo "  it bakes the absolute claude path into the service." >&2
fi

# 4. Generate the LaunchAgent from the template (strip comments, fill in paths)
mkdir -p "$HOME/Library/LaunchAgents"
sed -e '/<!--/,/-->/d' \
    -e "s#NODE_PATH#${NODE_BIN}#g" \
    -e "s#PROJECT_DIR#${DIR}#g" \
    -e "s#CODEX_PATH#${CODEX_BIN}#g" \
    -e "s#CLAUDE_PATH#${CLAUDE_BIN}#g" \
    -e "s#>8787<#>${PORT}<#g" \
    "$DIR/macos/com.llmdash.dashboard.plist.example" > "$PLIST"
echo "- Wrote LaunchAgent to $PLIST"

# 5. (Re)load the service
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"
echo "- Service loaded (starts at login, restarts on crash)"

# 6. Wire the Claude Code statusline — only if not already set; backs up first
LLMDASH_DIR="$DIR" node <<'NODE'
const fs = require('fs'), path = require('path'), os = require('os');
const dir = process.env.LLMDASH_DIR;
const p = path.join(os.homedir(), '.claude', 'settings.json');
const cmd = 'node ' + dir + '/scripts/statusline.js';
let s = {}, existed = false;
try { s = JSON.parse(fs.readFileSync(p, 'utf8')); existed = true; } catch {}
if (s.statusLine) {
  console.log('- Claude statusline already configured — leaving it. (llmdash uses: ' + cmd + ')');
} else {
  if (existed) { try { fs.copyFileSync(p, p + '.bak'); } catch {} }
  s.statusLine = { type: 'command', command: cmd };
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(s, null, 2) + '\n');
  console.log('- Wired Claude statusline to llmdash' + (existed ? ' (backup: settings.json.bak)' : ''));
}
NODE

TS_IP="$(tailscale ip -4 2>/dev/null | head -n1)"
echo
echo "llmdash is running."
echo "  On this Mac:    http://localhost:${PORT}"
if [ -n "$TS_IP" ]; then
  echo "  Over Tailscale: http://${TS_IP}:${PORT}  (from another tailnet device — use http, not https)"
else
  echo "  Over Tailscale: http://<your-tailscale-ip>:${PORT}  (find the IP with 'tailscale ip -4'; use http, not https)"
fi
echo "  To uninstall:   launchctl unload -w \"$PLIST\""
echo
echo "What to expect on first run:"
echo "  - Claude limit gauges stay empty until a reading arrives — a Claude Code"
echo "    session rendering its status line captures one, and auto-refresh captures"
echo "    one automatically within a few minutes of Claude activity. Claude activity"
echo "    stats (from local logs) work right away."
if [ "$CODEX_OK" -eq 1 ]; then
  echo "  - Codex limits are read via: $CODEX_BIN"
else
  echo "  - Codex limits are UNAVAILABLE (no codex binary found — see the warning"
  echo "    above). Install the Codex CLI, then re-run this installer to fix it."
fi
echo "  - The server's startup log (/tmp/llmdash.log) prints a data-source health"
echo "    readout naming anything that's missing and how to fix it."
