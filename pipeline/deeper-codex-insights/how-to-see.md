## Seeing Deeper Codex Insights locally

1. Open Terminal and change into the llmdash project folder:

   ```sh
   cd /Users/developer/devwork/llmdash
   ```

2. If llmdash is not already running as your local service, start it:

   ```sh
   npm start
   ```

   Leave that Terminal window open. If it reports that port 8787 is already in
   use, the installed llmdash service is already running and you can continue.

3. Open a browser to:

   `http://localhost:8787`

4. Scroll past the Claude Code and Codex account/activity sections. Before the
   existing Trends section, look for `▲ Codex insights` with the visible scope
   `This machine`.

5. Choose `24h`, `7d`, and `30d`. Reasoning share, turn/session sizes, work mix,
   context/timing, and supported daily charts should update together. The
   `Account-wide` plan/credit strip should not change with the range.

6. If this machine has no supported Codex rollout metadata in a selected range,
   the section will say so instead of showing made-up zeros. Older Codex logs may
   show individual metrics as `Unavailable`; the account-limit gauges above are
   unaffected.
