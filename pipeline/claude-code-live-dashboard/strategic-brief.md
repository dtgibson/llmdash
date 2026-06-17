# Strategic Brief — Claude Code Live Dashboard

## What We're Building
A local web app that reads your Claude Code (Max) 5-hour and weekly remaining
allowance and reset times and shows them as a clean, mobile-friendly page you
open from your phone or laptop over Tailscale. It also starts logging usage
snapshots from day one, so the later trend charts have history to draw on.

## Why Now
First because it is the highest-confidence data source (the remaining numbers
were verified reachable on this machine), and it stands up the entire spine the
rest of the product hangs off: data collection, local serving, and Tailscale
access. Shipping it gives you a usable dashboard immediately.

## The User Problem
Right now you cannot see how much of your Claude Code 5-hour and weekly limits
you have left without checking inside the tool, and you get throttled mid-task
with no warning. This puts the answer one glance away, from any device.

## Success Criteria
- You open a URL on your phone or laptop over Tailscale and see your Claude Code 5-hour and weekly remaining as clear percentages.
- Each window shows a countdown to when it resets.
- The numbers are the authoritative remaining allowance, not an estimate.
- The page reads well on a phone.
- Usage snapshots are being recorded from launch, so history accrues for the later charts.

## Scope
- Read Claude Code's 5-hour and weekly remaining and reset times via its sanctioned interface.
- A web page showing both windows with remaining percentage and reset countdown.
- Served from this machine, reachable over the Tailscale network.
- Mobile-friendly layout.
- Persist periodic usage snapshots locally (the foundation for the trend charts).

## Out of Scope
- Codex (feature 2).
- Trend charts and historical visualization (feature 3, though snapshot logging starts here).
- Alerts or notifications.
- Any login or public exposure.

## Key Decisions
- Use the sanctioned Claude Code interface for the limit data (the statusline rate-limits path as the primary route); the exact mechanism is The Architect's to settle.
- "Realtime" means latest snapshot, refreshed on activity or a short interval; the page should show data freshness honestly.
- Start snapshot logging now, since there is no backfill available for the later charts.
- Single user, no auth; Tailscale is the access boundary.
