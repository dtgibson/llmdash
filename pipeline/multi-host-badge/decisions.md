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

## Stage 8 (Deployer) — 2026-07-03
- **Held then shipped.** The user cancelled the first deploy gate (feature paused,
  built + verified, nothing shipped); resumed via /weft and confirmed. Commit
  25a76d9 (feature) on origin/main; installed copy at ~/llmdash fast-forwarded and
  the launchd service restarted. Health-checked live: /api/state 200 (unchanged),
  /api/hosts serves the single local host (self:true), POST /api/hosts → 405
  (serve-only preserved). Dormant until LLMDASH_HOSTS / hosts.conf is configured.
- **Deploy-caught gap fixed forward (commit 8bf0535).** Running the installed badge
  at the post-deploy check exposed that single-host mode delegated to the shipped
  emit path with NO host-config actions — so a fresh single-host / monitoring-station
  machine had no way to add its FIRST host from the menu bar, defeating the feature's
  headline. Fix: a shared `hostConfigActionLines()` helper called from both paths;
  single-host now shows `＋ Add host…` (+ honest "Watching: 0 other machines") with
  the glyph + tool rows still byte-for-byte the shipped single-host badge. QA-13's
  guard was updated from whole-output-byte-for-byte to "glyph+rows unchanged AND the
  Add affordance present." 334 tests (332 pass, 2 pre-existing skips). Verified live
  on the installed badge (`＋ Add host…` present).
- Lesson: FR-13 ("single-host byte-for-byte") over-applied by hiding the one new
  affordance that must be reachable from the single-host state; verifying the real
  installed artifact (not just tests) caught it. Reinforces the standing convention:
  verify a feature the way its host actually runs it.
