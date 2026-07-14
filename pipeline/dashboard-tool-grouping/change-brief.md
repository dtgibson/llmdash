# Change Brief — Dashboard Tool Grouping

## What is changing
Correct Codex limit-window mapping, then reorganize the dashboard into a
limits-first comparison followed by tool-grouped detail. Window duration from
the live Codex response will determine whether a reading is 5-hour or weekly;
missing windows will stay unavailable and obsolete stored readings will not
masquerade as current. Below the limits, each tool's supporting content will
live together.

## Why now
The current DOM pushes Codex limits far down on phones and splits one tool's
story across several sections. During this run, the live Codex app-server also
reported one 10,080-minute window and no secondary window; llmdash ignored the
duration, labeled it 5-hour, and retained an older weekly reading beside it.

## User-facing impact
Claude and Codex limits become faster to compare and correctly labeled on
desktop and mobile. A plan without a live 5-hour Codex window will show that
window as unavailable rather than presenting weekly usage under the wrong name.
No new metric, control, account scope, or remote data path is introduced.

## Design pass
Needed. Refine the existing dashboard's desktop comparison region, compact
mobile limit treatment, and the placement of pacing, diagnostics, insights, and
trends inside tool groups. Include an intentional unavailable-window treatment.
Preserve automatic light/dark themes, reduced motion, and the established
limits-first visual language.

## Decisions touched
- Cross-surface reading hierarchy: limits first, pacing second, quieter evidence after.
- Tool blocks as the principal grouping surface.
- Deeper Codex insights and Trends placement; their standalone sections are superseded.
- Multi-host host-first grouping, same-account limit collapse, and per-machine activity.
- Model-specific caps remain supplemental rather than headline limits.
- Codex window identity must follow explicit duration evidence, never field position.

## What done looks like
Both tools' known limit windows precede every activity, insight, and trend in
semantic order and remain readable without horizontal scrolling at 320px. A
10,080-minute Codex primary maps to weekly, a missing 300-minute window stays
unavailable, and stale stored windows do not reappear. Claude statistics and
charts form one group; Codex activity, insights, and charts form another.
Refresh cadence, range semantics, multi-host scope, accessibility, and menu-bar
output remain unchanged.
