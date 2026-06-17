# Design Spec — Codex Usage

## Visual Direction
Extends the existing llmdash design system — same tokens, gauges, tiles,
monospace numerals, auto light/dark. No new visual language. Two additions: a
top "headroom" strip and per-tool grouping.

## Screens / Views

### Dashboard (multi-tool)
- **Header:** wordmark + freshness (drops the single-tool "· Claude Code" scope
  now that it's multi-tool).
- **Headroom strip:** appears when a tool is low/maxed; names the tool that's out
  and points to the one with the most remaining 5-hour headroom (warn-tinted,
  left accent border). Hidden when both have comfortable room.
- **Tool blocks (one per tool, Claude Code then Codex):** a labeled header (tool
  name + plan + freshness), the two limit gauges (5h, weekly), the burn callout,
  and the activity tiles. Same panel/tile/bar/burn components as before.
- **Codex empty state:** when Codex activity logs are sparse, show the tiles with
  low/zero values plus an italic "fills in as you use it" note.
- **Footer:** unchanged honesty line.

Key decisions:
- Group by tool (not a combined gauge row) so attribution is unambiguous.
- The headroom strip is the cross-tool "where do I switch" cue — the feature's
  reason for being.
- Status color still drives the eye; the strip reinforces it in words at the top.

## Component Usage
Existing components reused. New: `.headroom` strip and `.tool` / `.tool-head`
grouping wrappers. No new dependencies.

## Design Tokens Applied
Existing tokens; added a `--warn-bg` tint for the headroom strip (light/dark).

## Interaction Notes
- The headroom strip is computed: show it only when at least one window is
  low/maxed; name the lowest tool and the tool with the most 5-hour headroom.
- Per-tool freshness reflects each source's last reading independently.

## Content Notes
Plain, directive copy in the strip ("switch to X, N% left"). Honest empty-state
line for Codex. Per-source labels everywhere.
