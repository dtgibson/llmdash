# Seeing claude-auto-refresh locally

This guide assumes nothing — each step tells you exactly what to type and
what you should see.

1. **Open a terminal in your project folder**
   (the folder containing this repo, e.g. `~/devwork/llmdash`).

2. **Start the dashboard:**

   ```
   npm start
   ```

3. **Read the startup log — the mechanism announces itself.**
   Look for these lines (this is the loud-disclosure part of the feature):
   - A `Claude refresh:` line under "Data sources:" saying either
     `claude command OK (/path/to/claude)` or, if it can't find claude, what
     to set (`LLMDASH_CLAUDE_CMD`) and why.
   - A paragraph starting `Claude limit readings auto-refresh:` that names
     the cadence (older than 5m + Claude active within 10m), the dedicated
     folder it uses (`~/.llmdash/claude-refresh-cwd`), the off-switch
     (`LLMDASH_CLAUDE_AUTOREFRESH=0`), and the two Claude-owned files the
     probe touches (the one-time trust entry and the history.jsonl line).

4. **Open your browser and go to:** <http://localhost:8787>
   The Claude Code block at the top shows the two limit gauges and, next to
   "Max", the reading's age — e.g. "updated 3m ago".

5. **Watch a real refresh happen.**
   Use Claude normally (the desktop app counts — that's the whole point) and
   leave the dashboard open. When the reading's age passes 5 minutes:
   - Within about a minute (the next poller tick) the dashboard quietly runs
     its `/usage` probe — you won't see anything flash; the probe is a
     background process that lives a few seconds.
   - The age in the header drops back to "updated under a minute ago" and
     any aging/stale pill disappears. That's auto-refresh working — silence
     is health; there is no status chrome for the happy path.

   If you want to see the plumbing: `cat data/claude-ratelimits.json` before
   and after — `capturedAt` advances even though you never opened a CLI
   session.

6. **See the "off" state.**
   Stop the server (Ctrl-C) and restart it with the switch off:

   ```
   LLMDASH_CLAUDE_AUTOREFRESH=0 npm start
   ```

   The startup log now says `Claude limit auto-refresh is OFF`. Once the
   reading is older than 10 minutes, the dashboard shows the stale pill plus
   a note under the gauges: **"Auto-refresh is off
   (LLMDASH_CLAUDE_AUTOREFRESH=0) — … Unset the variable and restart to
   re-enable…"**. The gauges keep showing the last capture — flagged, never
   blanked.

7. **See the "failing" state (optional, no waiting).**
   Point the probe at a binary that doesn't exist and restart:

   ```
   LLMDASH_CLAUDE_CMD=/nonexistent/claude npm start
   ```

   Keep using Claude so the activity gate is open. After 3 failed attempts
   (about 35 minutes, because failures back off 5m → 10m → 20m) a stale
   reading shows: **"Auto-refresh is failing — … The `claude` command
   couldn't be run: set `LLMDASH_CLAUDE_CMD` to the absolute path from
   `which claude`…"**. The startup log names the same fix immediately at
   boot, so you don't have to wait to know something's wrong.

8. **What good looks like day-to-day:** on a desktop-app-only day with the
   dashboard running, the Claude reading's age should never sit past ~5–6
   minutes while you're actively using Claude. When you're not using Claude,
   the age grows honestly (aging/stale pills) and the dashboard does zero
   background work — that's by design, not a bug.
