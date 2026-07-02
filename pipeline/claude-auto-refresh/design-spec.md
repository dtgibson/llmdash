# Design Spec — Claude Auto-Refresh: Diagnostic Notes
**Feature:** claude-auto-refresh
**Date:** 2026-07-02
**Stage:** 4 — The Designer — **approved by the user 2026-07-02** (first
direction accepted as presented; open calls resolved to their drafted defaults:
disabled note keeps the crit tint, spawn-error remedy stays inline)
**Companion artifact:** `design.html` in this directory — the rendered
reference, four states. Copy marked "verbatim" below is implemented exactly as
written.

---

## Visual Direction

Entirely within the established design system — this feature adds **zero new
CSS, zero new tokens, zero new components, zero new layout**. The two new
diagnostic states (`auto-refresh-failing`, `auto-refresh-disabled`) are copy
branches on the existing `limitsDiagnostic` note surface, rendered with the
shipped data-quality note component (`.stale-note`) in its existing slot.
Silence is health: when auto-refresh works, nothing in the UI says so — the
fresh reading age is the only evidence. No mechanism status indicator exists.

## Screens / Views

One view: the **Claude tool block** (`toolHtml` in `public/app.js`). Codex is
untouched. Four states, all rendered in `design.html`:

### A · Healthy (silent)
- Fresh reading (`updated 2m ago`), no pill, no note — today's fresh rendering,
  byte-identical. Auto-refresh working produces **no visible artifact** beyond
  the age staying small.

### B · auto-refresh-failing (shown with cause `parse-failed`)
- Fires only when the reading is **stale or absent** AND 3+ consecutive refresh
  attempts have failed (server-decided, FR-16). Never before both are true.
- Header sub: the shipped stale pill, unchanged (`Max · updated 47m ago [STALE]`)
  — band-driven, independent of the note.
- The note renders in the `.stale-note` component, in the existing note slot.
  It **replaces** the plain stale note (FR-18: one reason code at a time) and
  carries the staleness sentence itself, so nothing doubles up.
- Copy: what's happening, the cause in plain words (one fixed sentence per
  cause category — see Copy table), the manual remedy.
- Gauges keep rendering the last capture — same colors, never dimmed, never
  blanked. Pacing rows keep their normal confident copy (accepted call from the
  prior feature: the block-level flag covers them).

### C · auto-refresh-disabled
- Fires only when the reading is **stale or absent** AND
  `LLMDASH_CLAUDE_AUTOREFRESH=0` (FR-17). While the reading is fresh or aging,
  a disabled mechanism is invisible (nothing is wrong yet).
- Same component, same slot, same stale pill. Copy names the setting, how to
  re-enable, and the manual remedy.
- Tint call (draft): the off state keeps the crit tint — the note is a
  data-quality fact about stale gauges, the same fact the plain stale note
  states today. Flagged for review (see Open flags).

### D · First run — no reading ever (unchanged)
- Before any refresh attempt, the existing `no-statusline-reading` state
  renders unchanged: no fabricated age, empty gauges, the existing italic
  `.empty-note`, pacing "limit data not available yet". The new notes never
  appear prematurely (FR-19) — included in the gallery to prove they don't
  leak in.

## DOM placement & precedence

- Both new notes are returned by `limitsNoteHtml(tool)` (or its successor) —
  the same call site in `toolHtml`, rendering **between `.gauges` and the
  `.burn` pacing callout**, exactly where the stale note renders today.
- The server sends exactly one reason code (FR-18 precedence:
  `auto-refresh-failing` > `auto-refresh-disabled` > `stale-reading` >
  `no-statusline-reading`); the client maps the code to copy and never guesses.
  Mirror the precedence order in the client branch order anyway (cosmetic, but
  it documents intent).
- **Coexistence with the age pill:** the pill is band-driven from
  `tool.freshness` and untouched by this feature. In states B and C with a
  stale reading, the stale pill AND the note both show — pill flags, note
  explains. With no reading ever, no pill (no fabricated age), note only.
- The new notes can never appear in the fresh or aging bands: the server only
  fires them when the reading is stale or absent, so the aging band still
  shows pill-only, no note.
- `cause` crosses the wire as an enum (`spawn-error` | `timeout` |
  `parse-failed` | `no-reading-produced`) and is **mapped to a fixed sentence,
  never rendered raw**. An unmapped cause value falls back to the generic
  sentence (Copy table row 5) — never interpolate an unknown code into HTML.
  These notes contain no free-form server fields; the only interpolation is
  `fmtAge(capturedAt)`.

## Component Usage

- **`.stale-note`** — reused as-is for both new states. The design system
  already defines it generally ("a crit-tinted callout for a data-quality
  warning… states the problem plainly and names the remedy; lead words
  bolded"), so no design-system change is needed. Keep the class name.
- **`.age-pill`**, **`.burn` / `.burn-pill`**, **`.panel` gauges**,
  **`.empty-note`** — all shipped, all unchanged.
- **New CSS: none.** New classes: none.

## Design Tokens Applied

All existing, via `.stale-note`: `--crit-bg` (background), `--crit` (left
accent border), `--border`, `--text`, `--mono` + tabular-nums for ages.
Auto light/dark inherited — no extra rules.

## Interaction Notes

- **Static notes** — no listeners, no toggles, nothing clickable.
- **Live ages:** the "updated {age} ago" fragment re-derives from
  `freshness.capturedAt` on the existing 1-second render tick (same as the
  stale note today); tabular-nums prevents jitter.
- No wrap concerns: the notes are block-level in a full-width slot; the pill
  wrap fix from last feature already covers the header at phone widths.
- **Verify rendered text in a real browser** (per the chart-regression
  lesson): the words "Auto-refresh is failing" / "Auto-refresh is off" must
  appear in rendered DOM text in their states, and must NOT appear in states
  A and D.

## Copy table (verbatim — the Engineer implements these exactly)

Markup key: `**bold**` → `<strong>`, `` `code` `` → `<code>`. `{age}` is
`fmtAge(capturedAt)` output (e.g. "updated 47m ago" — the word "updated" comes
from `fmtAge`). Each string is a client-side literal; nothing server-sent is
interpolated except `capturedAt` via `fmtAge`.

**`auto-refresh-failing`, reading present (stale):**

| # | Cause | Full note text |
|---|---|---|
| 1 | `spawn-error` | **Auto-refresh is failing** — {age} ago; the limits above may have moved since. The `claude` command couldn't be run: set `LLMDASH_CLAUDE_CMD` to the absolute path from `which claude` and restart the service, or open a Claude Code CLI session to refresh the reading manually. |
| 2 | `timeout` | **Auto-refresh is failing** — {age} ago; the limits above may have moved since. Refresh attempts are timing out before a reading arrives — open a Claude Code CLI session to refresh the reading manually. |
| 3 | `parse-failed` | **Auto-refresh is failing** — {age} ago; the limits above may have moved since. The `/usage` screen couldn't be read (a Claude Code update may have changed it) — open a Claude Code CLI session to refresh the reading manually. |
| 4 | `no-reading-produced` | **Auto-refresh is failing** — {age} ago; the limits above may have moved since. Refresh attempts finish without producing a reading — open a Claude Code CLI session to refresh the reading manually. |
| 5 | *(unmapped fallback)* | **Auto-refresh is failing** — {age} ago; the limits above may have moved since. Refresh attempts keep failing — open a Claude Code CLI session to refresh the reading manually. |

Note: `{age} ago` composes as `${fmtAge(capturedAt)}; the limits above…` —
identical assembly to today's stale note, so "updated 47m ago" renders once.

**`auto-refresh-failing`, no reading ever:** two fragment swaps against the
rows above — the opening fragment becomes `— no reading has arrived yet.` (no
age; `fmtAge(null)` is null) and the remedy verb becomes **capture the first
reading manually** (consistent with the prior feature's approved no-reading
verb). Example (cause `timeout`):

> **Auto-refresh is failing** — no reading has arrived yet. Refresh attempts
> are timing out before a reading arrives — open a Claude Code CLI session to
> capture the first reading manually.

**`auto-refresh-disabled`, reading present (stale):**

> **Auto-refresh is off** (`LLMDASH_CLAUDE_AUTOREFRESH=0`) — {age} ago; the
> limits above may have moved since. Unset the variable and restart to
> re-enable, or open a Claude Code CLI session to refresh the reading manually.

**`auto-refresh-disabled`, no reading ever:**

> **Auto-refresh is off** (`LLMDASH_CLAUDE_AUTOREFRESH=0`) — no reading has
> arrived yet. Unset the variable and restart to re-enable, or open a Claude
> Code CLI session to capture the first reading manually.

**Unchanged copy (regression guard):** the stale-reading note, the
no-statusline-reading note, the aging/stale pill words, gauge subs, and pacing
copy all keep their shipped strings exactly.

## Content Notes

- Voice per convention: what's happening, why in plain words, the fix. No
  "diagnostic", no "mechanism", no "probe" in user-facing text; "auto-refresh"
  is the user-facing name (matching the README and startup log).
- Never blamey, never vague: each cause is named concretely ("the `/usage`
  screen couldn't be read"), never "something went wrong".
- Lead words bolded (`Auto-refresh is failing` / `Auto-refresh is off`),
  matching the stale note's grammar. Env vars, commands, and `/usage` in
  `<code>`.
- The raw cause code and failure count are never rendered; the mapped sentence
  carries the cause. (Counts live in the server log, once per cause — FR-20.)

## Open flags for review (iteration items)

1. **Disabled-note tint.** Drafted crit-tinted (reusing `.stale-note`
   unchanged — the stale data is the fact being flagged, same severity as
   today's stale note). Alternative: a warn-tinted variant (one small CSS
   rule, `--warn-bg`/`--warn`) to visually separate "off by choice" from
   "failing". User's call.
2. **First-run copy is now incomplete truth.** The existing no-reading note
   says gauges "fill in when a Claude Code session renders its status line" —
   once auto-refresh ships, they also fill in automatically within a few
   minutes of Claude activity. Drafted unchanged (per the FR-19 "unchanged"
   scope); worth weighing a one-clause addition during iteration.
3. **spawn-error note length.** It carries the full env-var fix inline
   (mirroring the shipped codex-cmd-failed note); it's the longest string.
   Could be shortened to "check `LLMDASH_CLAUDE_CMD`" with the full recipe
   left to the README.
