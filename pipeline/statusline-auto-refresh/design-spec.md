# Design Spec — Statusline Auto-Refresh (Branch B): Reading-Age Treatment
**Feature:** statusline-auto-refresh
**Date:** 2026-07-01
**Stage:** 4 — The Designer (direction approved by the user)
**Companion artifact:** `design.html` in this directory — the approved rendered
reference. Copy marked "verbatim" below is implemented exactly as written.

---

## Visual Direction

The reading-age treatment extends the locked design system without inventing
anything: the age stays in the tool header where it already renders, and picks
up the dashboard's established status-chip vocabulary (the same uppercase mono
pills used for ON PACE / AT RISK / LIMIT REACHED) as the reading crosses each
band. Text carries the meaning before color — the word "stale" appears in the
pill and in the diagnostic note, never color alone (NFR-08). A stale reading is
flagged, never blanked: the gauges keep rendering the last capture while the
note below them states the age and names the remedy.

## Bands (user's product decision — supersedes the 15m/60m defaults in prd.md/schema.md)

| Band | Age | Treatment |
|---|---|---|
| Fresh | ≤ 5m | Plain age in the header sub — today's rendering, unchanged |
| Aging | 5–10m | Warn pill reading "aging" joins the age; nothing else changes |
| Stale | > 10m | Crit pill reading "stale" + crit-tinted diagnostic note below the gauges |
| No reading ever | — | Existing honest empty state + CLI remedy sentence; no fabricated age |

- Single knob: `LLMDASH_CLAUDE_MAX_AGE_MS`, **default `300000` (5m)**.
- Stale band is **derived as 2× the knob** (default 10m), never independently
  configurable. The user tightened this at design review (rationale: they can
  burn the whole 5-hour window in under an hour, so 15m/60m read too generous);
  prd.md and schema.md have been updated to 2× / 300000, so all artifacts agree.
  The schema's derivation principle (one knob, derived stale band,
  server-supplied thresholds, client-derived band) is unchanged.

## Screens / Views

One view: the **Claude tool block** on the dashboard (`toolHtml` in
`public/app.js`). Codex is untouched. Four states, all shown in `design.html`:

### 1 · Fresh (age ≤ 5m)
- Header sub exactly as today: `Max · updated 2m ago` (plan · age).
- No pill, no note, no warning styling anywhere (QA-16).

### 2 · Aging (5–10m)
- Header sub gains a warn pill after the age:
  `Max · updated 7m ago [AGING]`.
- The pill is the only change — no diagnostic note (the server's
  `limitsDiagnostic` is null in this band), gauges and pacing untouched (QA-17).
- The rendered product copy must not contain the word "stale" in this band.

### 3 · Stale (> 10m)
- Header sub gains a crit pill: `Max · updated 1h 24m ago [STALE]`.
- A crit-tinted diagnostic note renders between the gauges and the pacing
  callout — exactly where `limitsNoteHtml` output renders today. It states the
  live age and names the remedy (copy in Content Notes; QA-18/19/20).
- **Gauges still render the last capture** — same markup, same status colors,
  never dimmed, never blanked (FR-17).
- Pacing rows keep their normal confident copy (accepted call — the block-level
  flag covers them).

### 4 · No reading ever
- Header sub is just the plan (`Max`) — no fabricated age (QA-25).
- Gauges render the existing "waiting for a reading" empty panels.
- The existing italic `.empty-note` renders with one added remedy sentence
  (Content Notes). Pacing rows show the existing "limit data not available yet".

## Component Usage

Two new CSS classes — the entire design delta. Everything else is the existing
stylesheet, untouched.

- **`.age-pill`** — the reading-age status chip in the tool header's sub line.
  Same chip grammar as `.burn-pill`: uppercase (via `text-transform`; DOM text
  stays lowercase), `var(--mono)`, font-size 0.64rem, letter-spacing 0.06em,
  weight 600, radius 999px, `white-space: nowrap`. Inline variant: padding
  `2px 9px`, `margin-left: 6px`, `vertical-align: 1px`, `display: inline-block`.
  Tinted by the **existing** `.pill-warn` (aging) / `.pill-crit` (stale)
  classes — no new color classes. Fresh renders no pill at all, so the
  escalation is structural (a chip appears), not color-alone.
- **`.stale-note`** — the FR-18 nudge. Reuses the headroom strip's callout
  grammar (`.headroom`: tinted background + 3px left accent border), crit-tinted
  to match the pill: `background: var(--crit-bg)`, `border: 1px solid
  var(--border)`, `border-left: 3px solid var(--crit)`, radius 10px, padding
  `11px 14px`, margin `12px 0`, font-size 0.8rem, `color: var(--text)`,
  `font-variant-numeric: tabular-nums` (the age updates live — no jitter).
  Lead words bolded via `<strong>`.
- **Unchanged:** `.panel` gauges, `.bar`/`.bar-fill`, `.burn` callout and its
  pills, `.empty-note` (still used by the no-reading state), activity tiles,
  token mix, trends, the Codex block, and the page-level `.freshness` indicator.

## Design Tokens Applied

All existing — no new tokens:
- `--warn` / `--warn-bg` — aging pill (via `.pill-warn`).
- `--crit` / `--crit-bg` — stale pill (via `.pill-crit`) and `.stale-note`
  background + left border.
- `--border`, `--text` — stale note frame and body text.
- `--mono` + tabular-nums — pill text and all ages (figures are mono, per the
  system).
- Auto light/dark via `prefers-color-scheme` — both new classes use tokens only,
  so they inherit both themes with no extra rules.

## Interaction Notes

- **Band is client-derived, live:** the client computes
  `Date.now() − Date.parse(freshness.capturedAt)` on the **existing 1-second
  render tick** and picks the band from the **server-supplied thresholds**
  (`freshness.freshForMs`, `freshness.staleAfterMs`) — never hardcoded
  client-side. A reading visibly crosses fresh → aging → stale between 60 s
  fetches. Negative age clamps to "just now" (existing `fmtAge` behavior).
- **Ages in copy are live too:** the header age and the stale note's "updated
  … ago" re-derive each tick, so the note's stated age never freezes.
- **`fmtAge` granularity extension:** at hour scale show hours + minutes
  ("updated 1h 24m ago", not "updated 1h ago") — `fmtDur` already formats this.
- **Note rendering contract shift (QA-20):** `limitsNoteHtml` (or its
  successor) renders whenever `limitsDiagnostic` is non-null — including when
  `haveLimits` is true (`stale-reading`). The stale note and rendered gauges
  coexist; only the no-reading state has empty gauges.
- **One voice:** the pill flags; the note explains and names the remedy. No
  third staleness element — pacing rows, tiles, and the page-level freshness
  indicator are not touched by this feature.
- **Phone widths:** add `flex-wrap: wrap` to `.tool-head` in
  `public/styles.css` (one line) so the pill wraps gracefully below ~360px.
  Verified fitting without wrap at 375px.
- **Verify in a real browser render** (QA-18): the word "stale" must appear in
  rendered text — per the chart-regression lesson, a "page loads" check is not
  enough.

## Content Notes

Copy below is **verbatim** — implement exactly, with `{age}` interpolated live
(format: `2m` / `7m` / `1h 24m`, via the extended `fmtAge`/`fmtDur` rules).

- **Header sub, fresh:** `Max · updated {age} ago` (existing format, unchanged).
- **Aging pill text:** `aging` (DOM text lowercase; uppercased by CSS).
- **Stale pill text:** `stale` (same).
- **Stale note (the `stale-reading` diagnostic copy):**
  > **Stale reading** — updated {age} ago; the limits above may have moved
  > since. Open a Claude Code CLI session to refresh the reading (the desktop
  > app doesn't render the statusline that reports these limits).

  ("Stale reading" is bold; the rest plain. This diagnostic copy IS the FR-18
  nudge — no separate nudge element.)
- **No-reading note (the `no-statusline-reading` diagnostic copy — existing
  sentence plus one new remedy sentence):**
  > No statusline reading has arrived yet — these gauges fill in when a Claude
  > Code session renders its status line (that's what reports the account-wide
  > limits to llmdash). Open a Claude Code CLI session to capture the first
  > reading.
- Tone throughout: plain, honest, states source and remedy; no exclamation, no
  hedging. Numbers in copy are tabular-nums mono per the system.

## Decisions Record (approved at design review, 2026-07-01)

User-approved as designed (flagged by the Designer, accepted explicitly):
1. **Stale is crit-red** — the word "stale" disambiguates it from a limit
   emergency; crit matches the warn→crit escalation vocabulary.
2. **Pacing rows stay confident under a stale reading** — the block-level flag
   covers them; no per-row softening.
3. **"aging" as the pill word** — the PRD's own band name; text-first honesty.
4. **"capture the first reading"** as the no-reading remedy verb (nothing
   exists to "refresh" yet); the stale state uses the QA-19 literal "refresh
   the reading".

User's product decision at review:
5. **Bands tightened to 5m / 10m** (from the PRD's 15m / 60m defaults): aging
   > 5 minutes, stale > 10 minutes; stale derived as **2× the single knob**;
   `LLMDASH_CLAUDE_MAX_AGE_MS` default becomes **300000**. Rationale: the whole
   5-hour window can burn in under an hour, so 15m/60m read too generous.
   prd.md and schema.md are updated to match (2× / 300000); startup-log and
   README copy must state the new default and the 2× rule.
