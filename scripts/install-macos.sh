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

# Resolve node to an ABSOLUTE path, for the SAME minimal-PATH reason as codex/
# claude: the menu-bar host (SwiftBar/xbar) spawns the badge plugin under a
# minimal PATH, where a bare "node" (esp. under nvm) can never resolve — a
# #!/usr/bin/env node shebang there produces a DEAD badge (measured, spike-report
# 2026-07-02). The badge install writes a GENERATED WRAPPER (into SwiftBar's
# plugin dir) that execs this absolute node against the tracked plugin — the
# tracked source's own shebang is never rewritten.
resolve_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi
  local d
  for d in "$HOME/.local/bin" /opt/homebrew/bin /usr/local/bin; do
    if [ -x "$d/node" ]; then
      echo "$d/node"
      return 0
    fi
  done
  return 1
}

# Detect the SwiftBar plugin directory (empty string if none found). SwiftBar
# stores the user-chosen folder in its prefs; the common default is
# ~/Library/Application Support/SwiftBar/Plugins. Shared by setup/remove so both
# target the SAME directory. Pure detection — reads prefs, touches nothing.
swiftbar_plugin_dir() {
  # An explicit override wins and is authoritative (even to "not detected" if it
  # doesn't exist): a user with a custom SwiftBar plugin folder points at it, and
  # the test suite sets it to a scratch dir so detection never reads real machine
  # state (`defaults read` talks to the live user prefs regardless of $HOME).
  if [ -n "${LLMDASH_SWIFTBAR_DIR:-}" ]; then
    [ -d "$LLMDASH_SWIFTBAR_DIR" ] && echo "$LLMDASH_SWIFTBAR_DIR"
    return 0
  fi
  local sb_pref=""
  sb_pref="$(defaults read com.ameba.SwiftBar PluginDirectory 2>/dev/null || true)"
  if [ -n "$sb_pref" ] && [ -d "$sb_pref" ]; then
    echo "$sb_pref"
  elif [ -d "$HOME/Library/Application Support/SwiftBar/Plugins" ]; then
    echo "$HOME/Library/Application Support/SwiftBar/Plugins"
  fi
}

# Unique marker line in every generated wrapper. remove_badge deletes a real
# file in SwiftBar's dir ONLY if it contains this marker — so a user's own file
# named llmdash.5s.js is never touched.
BADGE_WRAPPER_MARKER='llmdash-menu-bar-badge'

# If the TRACKED plugin's line 1 was baked to an absolute-node shebang by an
# older installer, that dirties the git checkout and aborts the main-flow
# `git pull --ff-only` on re-run. Restore it to the committed
# `#!/usr/bin/env node` — but ONLY when line 1 is exactly a `#!<abspath>/node`
# baked shebang, never otherwise. Restoring the committed state DE-dirties the
# checkout; it is safe and idempotent.
restore_tracked_shebang() {
  local plugin="$1"
  [ -f "$plugin" ] || return 0
  local first
  first="$(head -n 1 "$plugin")"
  case "$first" in
    '#!/usr/bin/env node') return 0 ;;                 # already the committed form
    '#!/'*/node)                                        # a baked absolute-node shebang
      local tmp="$plugin.heal.$$"
      { echo '#!/usr/bin/env node'; tail -n +2 "$plugin"; } > "$tmp" && mv "$tmp" "$plugin"
      chmod +x "$plugin"
      echo "- Badge: restored the tracked plugin shebang to '#!/usr/bin/env node' (was baked by an older installer; the checkout is clean again)"
      ;;
    *) return 0 ;;                                      # anything else: never touch it
  esac
}

# Menu-bar badge setup (FR-20, opt-in): write a small GENERATED WRAPPER into
# SwiftBar's plugin dir that execs an absolute node against the TRACKED plugin.
# The tracked source is NEVER modified — so re-running the installer and its
# `git pull --ff-only` stay clean, and the badge auto-updates on pull (the
# wrapper points at the tracked file). NEVER installs SwiftBar/xbar (that stays
# the user's explicit `brew install --cask swiftbar`). An unresolved node is a
# loud failure with the fix, never a silently dead badge.
#
# $1 = project dir (the checkout that holds scripts/menubar/llmdash.5s.js)
setup_badge() {
  local dir="$1"
  local plugin="$dir/scripts/menubar/llmdash.5s.js"
  if [ ! -f "$plugin" ]; then
    echo "  Badge: plugin not found at $plugin — skipping badge setup." >&2
    return 1
  fi

  local node_bin
  if ! node_bin="$(resolve_node)"; then
    echo "  Badge: node not found (checked PATH, ~/.local/bin, /opt/homebrew/bin, /usr/local/bin)." >&2
    echo "  The menu-bar badge wrapper needs an ABSOLUTE node path: the host spawns it" >&2
    echo "  under a minimal PATH where a bare 'node' can't resolve." >&2
    echo "  Fix: install Node 24+, then re-run with --setup-badge." >&2
    return 1
  fi

  # Self-heal: if an OLDER installer baked the tracked plugin's shebang (dirtying
  # the checkout), restore the committed shebang first. We never modify the
  # tracked source ourselves, but we clean up the old model's mess.
  restore_tracked_shebang "$plugin"

  local sb_dir
  sb_dir="$(swiftbar_plugin_dir)"
  if [ -z "$sb_dir" ]; then
    echo "  Badge: no SwiftBar plugin directory detected (SwiftBar may not be installed)."
    echo "  SwiftBar is NOT installed for you — it's a user-installed prerequisite:"
    echo "    brew install --cask swiftbar"
    echo "  Then point SwiftBar at a plugin folder and re-run --setup-badge (or drop a"
    echo "  wrapper there by hand that execs: \"$node_bin\" \"$plugin\")."
    return 0
  fi

  # Migrate the old model: an existing llmdash.5s.js that is a SYMLINK (old
  # setup) or an older generated wrapper is replaced. rm-then-write so a symlink
  # is unlinked (never followed) before the real wrapper lands.
  local wrapper="$sb_dir/llmdash.5s.js"
  if [ -L "$wrapper" ] || { [ -f "$wrapper" ] && grep -q "$BADGE_WRAPPER_MARKER" "$wrapper" 2>/dev/null; }; then
    rm -f "$wrapper"
  elif [ -e "$wrapper" ]; then
    # A real file we didn't generate (no marker) — do NOT clobber a user's file.
    echo "  Badge: $wrapper exists and is not a llmdash wrapper — leaving it untouched." >&2
    echo "  Remove or rename it yourself, then re-run --setup-badge." >&2
    return 1
  fi

  # Write the wrapper: a tiny POSIX-sh script that execs the absolute node
  # against the tracked plugin (argv[1] = the real tracked path, so the plugin's
  # realpath run-guard matches). "$@" forwards any args SwiftBar passes.
  {
    echo '#!/bin/sh'
    echo "# $BADGE_WRAPPER_MARKER (generated by install-macos.sh --setup-badge; safe to delete via --remove-badge)"
    echo "exec \"$node_bin\" \"$plugin\" \"\$@\""
  } > "$wrapper"
  chmod +x "$wrapper"
  echo "- Badge: wrote the menu-bar wrapper to SwiftBar's plugin dir ($wrapper)"
  echo "  It execs: \"$node_bin\" \"$plugin\" — the tracked plugin, never modified, so a"
  echo "  later 'git pull' / installer re-run stays clean and the badge auto-updates."
  echo "  The badge's Add/Remove host actions edit the watched-host list at"
  echo "  \${LLMDASH_DATA_DIR:-$dir/data}/hosts.conf (a local file — no HTTP write); it's"
  echo "  created on first Add, or seeded once from LLMDASH_HOSTS if that's set."
  echo "  Next: in SwiftBar, refresh (or it appears within ~5s). Set LLMDASH_BADGE_HOST /"
  echo "  LLMDASH_PORT at the top of $plugin if your dashboard isn't on 127.0.0.1:${PORT:-8787}."
  echo "  To remove it later: $dir/scripts/install-macos.sh --remove-badge"
}

# Menu-bar badge removal (the symmetric uninstall of setup_badge). Removes the
# SwiftBar-dir llmdash.5s.js ONLY when it is EITHER a symlink (the old model) OR
# a real file that CONTAINS our wrapper marker. A real file WITHOUT the marker is
# a user's own file and is NEVER deleted. NEVER uninstalls SwiftBar itself.
# Idempotent: "nothing to remove" is a friendly exit 0.
#
# $1 = project dir (only used to name the source plugin in messages).
remove_badge() {
  local dir="$1"
  local sb_dir
  sb_dir="$(swiftbar_plugin_dir)"

  if [ -z "$sb_dir" ]; then
    echo "  Badge: no SwiftBar plugin directory detected — nothing to remove automatically."
    echo "  If you installed the wrapper into a custom SwiftBar folder by hand, delete the"
    echo "  'llmdash.5s.js' file there yourself (the repo plugin source stays):"
    echo "    rm \"<your-SwiftBar-plugin-dir>/llmdash.5s.js\""
    echo "  Note: this does NOT uninstall SwiftBar. To remove the host too:"
    echo "    brew uninstall --cask swiftbar"
    return 0
  fi

  local wrapper="$sb_dir/llmdash.5s.js"
  if [ -L "$wrapper" ]; then
    # Legacy model: a symlink. rm removes the LINK itself (never follows it), so
    # the repo's plugin source is untouched.
    local target=""
    target="$(readlink "$wrapper" 2>/dev/null || true)"
    rm "$wrapper"
    echo "- Badge: removed the legacy plugin symlink from SwiftBar's plugin dir ($wrapper${target:+ -> $target})"
  elif [ -f "$wrapper" ] && grep -q "$BADGE_WRAPPER_MARKER" "$wrapper" 2>/dev/null; then
    # Our generated wrapper: carries the marker, so it is unambiguously ours.
    rm "$wrapper"
    echo "- Badge: removed the menu-bar wrapper from SwiftBar's plugin dir ($wrapper)"
  elif [ -e "$wrapper" ]; then
    # A real file WITHOUT our marker is a user's own file — never delete it.
    echo "  Badge: $wrapper exists but is not a llmdash wrapper (no marker) — leaving it"
    echo "  untouched. If you put it there and want it gone, remove it yourself:"
    echo "    rm \"$wrapper\""
  else
    echo "- Badge: nothing to remove — no llmdash.5s.js in SwiftBar's plugin dir ($sb_dir)"
  fi

  echo "  This did NOT uninstall SwiftBar (a user-installed prerequisite) or delete the"
  echo "  plugin source at $dir/scripts/menubar/llmdash.5s.js. To remove the host too:"
  echo "    brew uninstall --cask swiftbar"
  return 0
}

# Test/maintenance hooks: print the resolved codex/claude/node path (exit 1 if
# none) without running the installer. Used by tests/install-macos.test.js and
# tests/menubar-install.test.js.
if [ "${1:-}" = "--resolve-codex" ]; then
  if p="$(resolve_codex)"; then echo "$p"; exit 0; else exit 1; fi
fi
if [ "${1:-}" = "--resolve-claude" ]; then
  if p="$(resolve_claude)"; then echo "$p"; exit 0; else exit 1; fi
fi
if [ "${1:-}" = "--resolve-node" ]; then
  if p="$(resolve_node)"; then echo "$p"; exit 0; else exit 1; fi
fi
# Opt-in badge setup: `install-macos.sh --setup-badge [project-dir]`. Defaults
# to $DIR (the standard checkout). Never installs SwiftBar.
if [ "${1:-}" = "--setup-badge" ]; then
  setup_badge "${2:-$DIR}"
  exit $?
fi
# Symmetric badge removal: `install-macos.sh --remove-badge [project-dir]`.
# Removes only the wrapper setup wrote (marker-verified) or a legacy symlink;
# never deletes a non-marker user file; never uninstalls SwiftBar; re-run-safe.
if [ "${1:-}" = "--remove-badge" ]; then
  remove_badge "${2:-$DIR}"
  exit $?
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
echo
echo "Optional: menu-bar badge (SwiftBar)"
echo "  - A one-glance remaining-% badge for your menu bar. It needs SwiftBar, a"
echo "    user-installed third-party app — NOT installed for you:"
echo "      brew install --cask swiftbar"
echo "  - Then set it up (writes a small wrapper into SwiftBar's plugin dir that runs"
echo "    the tracked plugin with an absolute node path; the tracked source is never"
echo "    modified, so re-running the installer stays clean):"
echo "      \"$DIR/scripts/install-macos.sh\" --setup-badge"
echo "  - Remove it later with --remove-badge. Details, host/port config, and the C/X"
echo "    tool cue are in the README."
