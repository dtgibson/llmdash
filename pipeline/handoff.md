## What We Accomplished
Shipped claude-auto-refresh. The dashboard's Claude limit reading now refreshes
itself while you're actively using Claude — no manual CLI ritual — by spawning a
short-lived, invisible Claude Code session, reading its `/usage` screen, and
closing it. It costs no plan usage, only runs when Claude has been active
recently (never around the clock), and degrades honestly: a failing mechanism
shows "auto-refresh is failing" with the cause, a switched-off one says so, and
the gauges never blank. This reverses the prior feature's "auto-refresh is
refuted" conclusion — the statusline-payload avenue really is dead, but the
`/usage` screen-scrape works. Verified live on the installed dashboard: the
reading came back ~22 seconds old with no manual step.

## What Has Been Saved
- Feature (code + tests + pipeline/claude-auto-refresh/): commit 62e248e.
- Project memory (DECISIONS.md, PRODUCT_CONTEXT.md, CLAUDE.md, ROADMAP.md):
  commit 070095f.
- Both pushed to origin/main. The installed dashboard (~/llmdash) was
  fast-forwarded and its launchd service re-installed so LLMDASH_CLAUDE_CMD
  resolves the absolute claude path; health-checked live (fresh reading, clean
  diagnostic).

## Where We Are
Feature complete and live. Pipeline idle.

Two threads left on the roadmap (On the Horizon), neither blocking: a small
teardown-hardening follow-up (a SIGTERM handler + startup sweep so an ungraceful
llmdash exit can't orphan one probe session), and the Fable per-model weekly
meter that `/usage` exposes but the two-window UI doesn't show yet.

## Resume Prompt

Run `/weft` to start the next thing.
