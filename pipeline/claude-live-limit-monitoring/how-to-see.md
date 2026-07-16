# Seeing the Claude live-limit fix locally

1. Open a terminal in the project folder.

2. Run the focused tests:

   ```sh
   node --test tests/claude-refresh-gates.test.js tests/claude-refresh-parse.test.js tests/claude-monitor-lifecycle.test.js tests/autorefresh-guard.test.js tests/server.test.js
   ```

   They verify that a timeout preserves the old good reading, new Claude
   activity gets a later recovery attempt, the full probe process tree is
   terminated, PID/PGID replacements and an unrelated Claude CLI are never
   selected, reload/exit awaits cleanup, and starting the monitor twice still
   creates one interval.

3. Run the complete regression suite:

   ```sh
   npm test
   ```

4. After the deploy stage restarts the installed service, keep a real Claude CLI
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

5. Check both shared consumers:

   ```sh
   curl -fsS http://127.0.0.1:8787/api/state
   curl -fsS http://127.0.0.1:8787/api/hosts
   ```

   The local Claude entry in both responses should carry the new `capturedAt`
   and matching weekly `usedPct` / `remainingPct`. On the next SwiftBar refresh,
   its dropdown and the browser dashboard should show that same weekly value.

6. Confirm the old probe leak is not recurring after one service reload and one
   completed refresh:

   ```sh
   ps -axo pid=,ppid=,etime=,command= | grep 'claude-usage-probe-' | grep -v grep
   ```

   No probe row should remain once a refresh or shutdown finishes. A probe may
   appear briefly while a refresh is actively running.

Do not judge freshness from the percentage alone: the provider value can remain
unchanged between captures. The proof that monitoring is live is the newer
`capturedAt`, consistent API values, and no lasting probe descendants.
