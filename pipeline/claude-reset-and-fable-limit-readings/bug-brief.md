# Bug Brief — Claude Reset and Fable Limit Readings

## What is broken
A newer Claude statusline capture with missing reset fields replaces earlier future reset times, so available 5-hour or weekly countdowns can disappear. Fable is captured only by `/usage`; fresh account readings suppress that probe until its separate cap is at least 60 minutes old, or indefinitely when no active cap remains.

## Steps to reproduce
1. Save a Claude reading with future `resets_at` values, then send a newer statusline reading with valid percentages and null reset fields; both saved resets become null.
2. Give `maybeRefreshClaude` a 2-minute-old account reading, a 52-minute-old Fable cap, and current Claude activity; it returns `fresh` without probing. Remove the cap and fresh account writes continue to suppress probing.
3. The live reading on 2026-09-23 showed an account capture at 05:13:59Z and Fable at 04:22:07Z (40% used), confirming the separate ages in the running product.

## Expected behavior
Show each Claude account and Fable reset that has trustworthy current provider evidence, with an honest unavailable state when none exists. Keep an earlier provider reset only while it remains valid and clearly sourced; active Claude use should refresh Fable promptly enough that its percentage tracks the provider pane.

## Blast radius
The Claude capture/merge path, `/usage` probe gate, and shared reading feed `/api/state`, `/api/hosts`, the dashboard, and the menu-bar dropdown. Review both account windows and model caps; keep configured weekly reset fallback separate from provider evidence and leave Codex handling alone.

## What done looks like
Regression checks cover a newer capture that omits reset times, a recently active Fable cap while account captures stay fresh, and genuinely absent or expired reset evidence. Compare a fresh `/usage` reading with both user surfaces to confirm matching percentages, reset countdowns, and capture ages.
