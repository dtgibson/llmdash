## What We Accomplished
Shipped the menu-bar badge. Your most-constrained AI-usage window now sits in
the macOS menu bar as a one-glance glyph (`▪ C 44%`), with a dropdown carrying
both tools, both windows, reset countdowns, freshness, and diagnostics. It's a
zero-dependency SwiftBar plugin that reads the dashboard's existing /api/state —
no second data path, no build step, no runtime dependency for llmdash itself.
Five honesty states carry over from the dashboard (fresh / aging / stale /
no-reading / offline — never a confident-but-stale number, never a fabricated
one), a C/X cue names which tool is tight, and the host is configurable so the
badge can read a dashboard on any tailnet machine. It's live in your menu bar.

## What Has Been Saved
- Feature: commit 7c2105a (plugin, tests, docs, installer, pipeline/menu-bar-badge/).
- Deploy fixes: 086896a (symlink run-guard + hermetic install tests) and
  9eb3e3f (generated-wrapper delivery, never dirties the checkout).
- Project memory: commit 609b937 (DECISIONS, PRODUCT_CONTEXT, CLAUDE, ROADMAP).
- All pushed to origin/main; installed copy at ~/llmdash updated; SwiftBar
  installed and the badge wired via --setup-badge, verified rendering live.

## Where We Are
Feature complete and live. Pipeline idle.

Two follow-ons are parked on the roadmap (On the Horizon): a multi-host badge
(a host list with per-machine dropdown and glyph switching) and a tmux/terminal
statusline reusing the same emitter. "Limit alerts" is now the top Up Next item,
and it can build on both a fresh-by-default reading and the badge's selection
model.

## Resume Prompt

Run `/weft` to start the next thing.
