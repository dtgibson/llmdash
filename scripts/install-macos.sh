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
CODEX_BIN="$(command -v codex || echo codex)"

# 4. Generate the LaunchAgent from the template (strip comments, fill in paths)
mkdir -p "$HOME/Library/LaunchAgents"
sed -e '/<!--/,/-->/d' \
    -e "s#NODE_PATH#${NODE_BIN}#g" \
    -e "s#PROJECT_DIR#${DIR}#g" \
    -e "s#CODEX_PATH#${CODEX_BIN}#g" \
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
