# Security Report: Model-Specific Limits

## Reviewed Surfaces

- Claude `/usage` parser and statusline payload writer.
- `readClaudeLimits()` local file ingest.
- `/api/state` and `/api/hosts` tool payloads.
- Peer payload normalization in `src/hosts.js`.
- Dashboard rendering in `public/app.js`.
- Snapshot insertion for model sub-sources.

## Findings

No blocking security issues found.

## Controls

- Peer-provided model percentages are coerced to finite numbers and clamped to 0-100.
- Model reset and capture timestamps are canonicalized to ISO or dropped.
- Unknown peer model fields are dropped.
- Model labels remain raw only in normalized data; the browser escapes them before `innerHTML`.
- CSS width interpolation uses clamped numeric percentages.
- Local Claude model sources are restricted to `claude-model:<slug>` before snapshot storage.
- No new HTTP write endpoints, subprocesses, shell execution, credentials, or network fan-out paths were added.

## Residual Risk

Claude's terminal `/usage` layout is still a fragile scrape surface. Fixture tests now cover the split `Res ts` redraw artifact and verify model caps cannot replace account-wide windows.
