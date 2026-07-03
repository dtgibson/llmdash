## What We Accomplished
Shipped menubar-service-controls — llmdash's install lifecycle no longer needs a
terminal. The badge dropdown gained a state-aware toggle to install or remove the
local monitoring service (it reads your real launchd state), and a two-tier
"Uninstall llmdash" — remove just the badge, or uninstall completely. The complete
uninstall lists every artifact before acting and keeps your usage history by
default (rescuing the DB out of the app folder before deleting it), only wiping it
on a second explicit confirmation. SwiftBar is never removed. It's all local,
confirmed, user-scoped (no sudo), and the HTTP surface stayed read-only. It's live
in your menu bar now.

## What Has Been Saved
- Feature: commit 96ee98d (installer hooks + the service-control helper + the badge
  items + tests + pipeline/menubar-service-controls/).
- Project memory: commit afed27a (DECISIONS, PRODUCT_CONTEXT, CLAUDE, ROADMAP).
- All pushed to origin/main; installed copy at ~/llmdash updated and the service
  restarted; verified live (endpoints healthy, read-only preserved, the new
  dropdown controls present).

## Where We Are
Feature complete and live. Pipeline idle.

Everything was built and tested against throwaway scratch copies — your real
service, app folder, and usage-history DB were verified untouched throughout.

One follow-on remains on the roadmap (On the Horizon): a tmux/terminal statusline.
"Limit alerts" is Up Next.

## Resume Prompt

Run `/weft` to start the next thing.
