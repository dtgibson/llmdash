# Strategic Brief: Model-Specific Limits

## Problem

llmdash currently shows account-wide Claude Code and Codex windows, but Claude's `/usage` pane can also expose caps scoped to individual models such as Fable or Sonnet. Those caps are easy to miss because the existing parser intentionally stops before non-account weekly sections. A user can therefore see healthy account-wide headroom while a model-specific cap is close to exhausted.

## Outcome

Show model-specific usage and remaining limit data anywhere llmdash shows the relevant tool's account limits. Keep these readings visually and structurally separate from account-wide budget so they cannot be interpreted as additional shared quota.

## Scope

- Parse Claude `/usage` model sections like `Current week (Fable)` without letting them pollute the account-wide weekly window.
- Persist model-specific snapshots using the existing snapshot table by encoding the source as a Claude model sub-source.
- Add `modelLimits` to each tool's state contract; Claude can populate it, Codex emits an empty list until model caps exist there.
- Render model caps in the dashboard's single-host view, account-limits banner, and per-host full tool blocks.
- Normalize model caps from peer hosts defensively.

## Non-Goals

- No database migration.
- No model-specific headroom recommendation or menu-bar badge changes in this pass.
- No scraping of token-contribution rows; only explicit model limit meters are parsed.

## Risks

- The Claude `/usage` pane is a fragile terminal UI. Parser tests must keep account windows and model windows separated.
- Peer data is untrusted. Model labels stay raw in normalized state and are escaped only at render.
- Additional state keys change the `/api/state` tool object shape, so contract tests need a deliberate update.
