# Decisions — multi-host-badge

## Stage 4 (Designer review) — 2026-07-02
- **User approved the design as drawn ("let's do it"), ratifying all four flagged
  calls to the recommended treatments:**
  1. **Glyph host cue** = the short machine name, `▪ <host>·<C|X> <pct>` (e.g.
     `▪ Desktop·C 12%`), truncated past 10 chars — not a two-letter code. The host
     cue binds the machine to the tool (C=Claude/X=Codex) as one token; the aging
     `·` sits after the number so the two dots never collide. Single-host omits the
     host cue = byte-for-byte today's badge.
  2. **Monitoring-station** = auto-detect ON by default: when the local host has no
     Claude/Codex readings AND ≥1 remote is configured, the empty local host is
     dropped from the glyph and the dropdown headline but retained last, dimmed
     (~0.72), with a "no local activity" idle pill — never fabricated zeros, never
     dropped. Override via the in-file `!local=include|exclude|auto` directive.
  3. **Dropdown ordering** = binding (tightest) host first, then reachable hosts in
     config order, then offline hosts, then the de-emphasized local host last.
  4. **Add/Remove/List** actions as drawn: Add host… pops the native osascript
     dialog; Remove host… is a submenu of the watched machines (never "This
     machine"); a "Watching: N hosts" listing line. All write the local config file
     (no HTTP mutation). FR-18 dialog/error copy verbatim.
- **Design-system extension is minimal/additive** — a host header row + a host-level
  pill, mirroring the dashboard multi-host `.host-head`/`.host-pill`; no new tokens
  or color semantics. Single-host badge is unchanged.
