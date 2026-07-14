# How to See the Change

1. Start llmdash with `npm start` and open `http://127.0.0.1:8787/`.
2. At the top, confirm the `Account limits` surface shows Claude Code and Codex
   together, with 5-hour and weekly slots for each tool.
3. On an account whose live Codex response reports only a 10,080-minute window,
   confirm Codex 5-hour says `Unavailable` and Codex weekly carries the live
   percentage and reset.
4. Resize to 320px. Both Claude slots and both Codex slots stay in the first
   comparison, two cards per row, with no horizontal scrolling. Any stale/error
   note appears only after all four cards.
5. Scroll through `Tool details`: Claude pacing, activity, model caps, and
   Trends remain together; Codex pacing, activity, deeper insights, and Trends
   remain together.
6. Change the shared Trend range and confirm both tool trend sections update.
   Change the Codex-insights range and confirm it updates independently.

For the data contract, inspect `/api/state`: a missing Codex window is `null`;
the reported 10,080-minute window appears under `limits.seven_day`.
