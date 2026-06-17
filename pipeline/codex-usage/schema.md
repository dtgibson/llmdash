# Data Layer Design — Codex Usage
**Feature:** codex-usage
**Stage:** 3 — The Architect
**Path:** Incremental
**Source:** prd.md (approved)
**Store:** existing SQLite (no change)

## Summary
No schema change. Codex reuses the existing `usage_snapshots` table as a new
`source` value (`"codex"`). Activity stats stay derived on demand from Codex's
local logs, as Claude's are — no new storage. The work is read paths, not storage.

## Existing table (unchanged)
`usage_snapshots(id, captured_at, source, window, used_pct, resets_at)` — Codex
writes rows with `source = "codex"` and `window` in {`five_hour`, `seven_day`}.
The existing `(source, window, captured_at)` index already serves Codex queries.

## Read paths (for the Engineer)

### Limits — Codex app-server
- Spawn `codex app-server` (JSON-RPC 2.0 over stdio) as a **managed subprocess**
  (not per request). Do the initialize handshake, then call
  `account/rateLimits/read`; optionally subscribe to `account/rateLimits/updated`.
- Auth: the existing `~/.codex/auth.json` ChatGPT token, handled by the codex
  binary — we never read or transmit the token ourselves beyond invoking codex.
- Map response → windows: primary → `five_hour`, secondary → `seven_day`, each
  `{usedPercent → used_pct, resetsAt → resets_at}`; normalize resets to ISO-8601.
- Snapshot into `usage_snapshots` with `source = "codex"` (same dedup logic).

### Activity — Codex session logs
- Read `~/.codex/sessions/**/rollout-*.jsonl` `token_count` events for token
  usage. **Currently zero on this machine** → stats render empty/zero and fill in
  as Codex is used (FR-12).
- Map Codex's token fields to the existing shape (input / output / cached) as
  closely as the data allows; compute tokens, cache hit rate, token mix.
- Estimated value uses a **new OpenAI per-model rate table** in config, separate
  from Claude's and user-editable.

## Decisions
- Generalize the existing reader/store to be **source-aware** (a `source`
  parameter) rather than Claude-specific, so both tools flow through one path.
- Codex's limit data path differs (subprocess vs Claude's statusline file), but
  the stored shape and the UI components are identical.
- Degrade gracefully: a missing app-server or empty logs never break the page
  (FR-04, FR-12); Claude is unaffected (FR-14).
