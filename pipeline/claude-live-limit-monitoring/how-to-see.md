# Seeing the Claude live-limit fix locally

1. Open a terminal in the project folder.

2. Run the focused tests:

   ```sh
   node --test tests/claude-activity-scan.test.js tests/claude-refresh-gates.test.js tests/claude-refresh-parse.test.js tests/claude-monitor-lifecycle.test.js tests/autorefresh-guard.test.js tests/server.test.js
   ```

   They verify that a timeout preserves the old good reading, advancing nested
   subagent activity gets one later recovery attempt, stale activity remains
   idle, scan budgets and symlink boundaries hold, the full probe process tree
   is terminated, PID/PGID replacements and an unrelated Claude CLI are never
   selected, reload/exit awaits cleanup, and starting the monitor twice still
   creates one interval.

3. Run the complete regression suite:

   ```sh
   LLMDASH_CLAUDE_AUTOREFRESH=0 \
   LLMDASH_CLAUDE_DIR=/tmp/llmdash-full-suite-no-claude \
   LLMDASH_CODEX_DIR=/tmp/llmdash-full-suite-no-codex \
   LLMDASH_CODEX_CMD=/usr/bin/false \
   npm test
   ```

   Those temporary, nonexistent provider roots keep this broad poller regression
   isolated from any live Claude or Codex session. The focused tests above drive
   the refresh behavior with controlled fixtures.

4. With a Claude session active, verify that the monitor sees its newest direct
   or nested transcript timestamp. This command reads filesystem metadata only:

   ```sh
   node --input-type=module -e 'import { config } from "./config.js"; import { newestTranscriptMtimeMs } from "./src/claude-refresh.js"; const m = newestTranscriptMtimeMs(config); console.log(m == null ? "no activity" : new Date(m).toISOString())'
   ```

   For current subagent sessions, this timestamp should advance even when the
   direct project transcript does not.

5. After the deploy stage restarts the installed service, keep a real Claude CLI
   session active and watch the reading timestamp:

   ```sh
   while true; do
     node -e 'const fs=require("node:fs"); const p=JSON.parse(fs.readFileSync("data/claude-ratelimits.json","utf8")); console.log(new Date().toISOString(), p.capturedAt, p.rate_limits?.seven_day?.used_percentage)'
     sleep 30
   done
   ```

   Within the normal refresh interval, `capturedAt` should advance and the
   weekly used percentage should match Claude's `/usage` screen. Stop the loop
   with Control-C.

6. Check both shared consumers:

   ```sh
   curl -fsS http://127.0.0.1:8787/api/state
   curl -fsS http://127.0.0.1:8787/api/hosts
   ```

   The local Claude entry in both responses should carry the new `capturedAt`
   and matching weekly `usedPct` / `remainingPct`. On the next SwiftBar refresh,
   its dropdown and the browser dashboard should show that same weekly value.

7. Confirm the old probe leak is not recurring after one service reload and one
   completed refresh:

   ```sh
   ps -axo pid=,ppid=,etime=,command= | grep 'claude-usage-probe-' | grep -v grep
   ```

   No probe row should remain once a refresh or shutdown finishes. A probe may
   appear briefly while a refresh is actively running.

Do not judge freshness from the percentage alone: the provider value can remain
unchanged between captures. The proof that monitoring is live is the newer
`capturedAt`, consistent API values, and no lasting probe descendants.
