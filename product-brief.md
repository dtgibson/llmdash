# Product Brief — llmdash

## What This Is
A personal dashboard that shows, in one place, how much of your AI coding
usage you have left. It tracks Claude Code (Max) and Codex (ChatGPT Plus):
remaining allowance in the 5-hour and weekly windows, when each resets, and
how your usage trends over time. It runs on your machine and is viewable from
your phone or computer over your Tailscale network.

## The Problem
Claude Code and Codex each enforce rolling 5-hour and weekly limits, but their
meters live in separate tools and are easy to lose track of. You can get
throttled mid-task with no warning, and there is no single place to see your
headroom across both. Existing tools either estimate spend from logs or only
cover one assistant.

## Who It's For
You: someone working across multiple AI coding assistants every day who
routinely bumps into their usage limits. You want to pace work deliberately and
never get surprised by a lockout in the middle of something important. Single
user, your own machine, checked from whatever device is nearby.

## Why It Should Exist
The authoritative "remaining" numbers are reachable through each tool's own
sanctioned interface, but nobody surfaces them together. A unified view built on
the real limit data, not estimates, lets you manage your day across tools
instead of guessing.

## What Success Looks Like
You glance at the dashboard, on your laptop or your phone, and immediately know
how much you have left in each tool's 5-hour and weekly windows, when they
reset, and whether you are burning faster than usual. You plan heavy work around
resets and stop getting cut off unexpectedly. Over weeks, the trend charts
reveal your real usage patterns.

## Founding Decisions
- Two services at launch: Claude Code (Max) and Codex (ChatGPT Plus). Kagi dropped.
- Use each tool's sanctioned interface for the data, not credential workarounds.
- Track 5-hour and weekly windows with remaining percentage and reset countdowns.
- History is self-logged from launch; the dashboard records its own snapshots. No backfill.
- "Realtime" means the latest snapshot, refreshed on tool activity or a short interval, not a live needle.
- Runs on this machine (where the usage data lives) and serves a web UI over the user's Tailscale network, reachable from phone or computer.
- Mobile-friendly, responsive layout.
- No separate login; the private tailnet is the access boundary. Not exposed to the public internet.
- Personal, single-user tool.

## Out of Scope
- Kagi.
- General ChatGPT chat message caps (no readable source).
- Pay-as-you-go API-key spend tracking (a different meter).
- Alerts when nearing a limit (candidate for later, not v1).
- Public hosting or internet exposure; the dashboard stays on the tailnet.
- Sharing, teams, multi-user, or per-user authentication.
