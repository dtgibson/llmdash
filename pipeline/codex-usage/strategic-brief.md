# Strategic Brief — Codex Usage

## What We're Building
Bring Codex (ChatGPT Plus) into the dashboard at full parity with Claude Code:
its 5-hour and weekly limit windows (remaining %, reset countdowns, burn
projection) and its activity stats (tokens, cache hit rate, estimated value,
token mix, cache savings), shown alongside Claude Code in one view.

## Why Now
It completes the picture the product was built for. With both tools side by side,
when you max one out you can see at a glance how much room you still have on the
other and switch instead of stalling. Claude Code shipped first as the
highest-confidence source; Codex was the planned next step and is confirmed
reachable.

## The User Problem
You can see Claude Code's headroom but not Codex's. When Claude hits a limit
mid-task, you're flying blind on whether Codex can carry you. One unified view
turns "am I stuck?" into "switch to the one with room left."

## Success Criteria
- Codex's 5-hour and weekly remaining show next to Claude Code's, with reset countdowns and a burn projection, matching Claude's treatment.
- Codex activity stats (tokens 5h/week/today, cache hit rate, estimated value, token mix, cache savings) show the same way Claude's do.
- When one tool is low or maxed, it's immediately obvious which still has headroom.
- Codex numbers match what Codex itself reports, within the same snapshot-lag tolerance as Claude.
- Honesty rules hold: account-wide limits vs local-log activity labeled, and each number attributed to its tool.

## Scope
- Read Codex's 5-hour and weekly limits and reset times via its sanctioned interface (the Codex app-server).
- Add Codex as a second source in the existing limits view and snapshot logging.
- Compute Codex activity stats from its local session logs, using OpenAI per-model rates for estimated value.
- A clear cross-tool headroom read (which tool has room when another is low).

## Out of Scope
- General ChatGPT chat caps (no readable source).
- Kagi.
- Trend charts over time (still the later feature; snapshot logging keeps feeding it).
- Alerts / notifications.

## Key Decisions
- Full parity is the target (limits + activity), not limits-only.
- Codex limits come from the app-server (`account/rateLimits/read`), a managed subprocess — different plumbing from Claude's statusline. The Architect and Engineer own the mechanism.
- Codex activity depends on Codex usage existing in its logs; it populates over time and may be thin at first. Accepted and labeled honestly.
- Reuse the existing schema and UI: Codex is a new `source` (`codex`) in the same `usage_snapshots` table and the same components — no schema change expected.
- Estimated value uses OpenAI's per-model API rates (a separate pricing table).
