## What We Accomplished
Shipped multi-host. One llmdash instance can now show several of your own tailnet
machines side by side — each host's Claude Code + Codex account-wide limits and
its per-machine activity, honestly labeled and independently fresh/stale/offline.
Same-account machines collapse into a single "Account limits" banner (so identical
meters never imply double the budget) and each machine leads with its own distinct
activity; an unreachable machine shows a named callout, never a stale number. The
local instance polls each configured peer's existing /api/state on the interval
(never the request path), bounded by timeout/concurrency/body-cap, and serves the
combined view from cache via a new /api/hosts — with /api/state left untouched, so
the local view and the menu-bar badge are unaffected. Off until you set
LLMDASH_HOSTS.

## What Has Been Saved
- Feature: commit f0d6992 (code + tests + pipeline/multi-host/).
- Project memory: commit cad8c20 (DECISIONS, PRODUCT_CONTEXT, CLAUDE, ROADMAP).
- Both pushed to origin/main; installed copy at ~/llmdash updated and the service
  restarted; health-checked live (/api/state unchanged, /api/hosts serving).

## Where We Are
Feature complete and live, dormant until configured. Pipeline idle.

To turn it on: set LLMDASH_HOSTS to your other machines' tailnet
host[:port][=label] entries (each also running llmdash) and restart; the local
host is included automatically.

Housekeeping note: a duplicate Designer-stage session had been spawned as a
side-task chip during the architecture stage; it was stopped, its work discarded,
and its branch/worktree removed at deploy. The shipped design is the approved
main-flow one.

Two follow-ons on the roadmap (On the Horizon): the multi-host badge (now a thin
consumer of this peer plumbing) and a tmux/terminal statusline. Limit alerts is
Up Next, and can now alert across hosts.

## Resume Prompt

Run `/weft` to start the next thing.
