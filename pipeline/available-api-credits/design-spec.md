# Design Spec — Available API Credits

**Feature:** available-api-credits
**Stage:** 4 — The Designer
**Mockup:** `pipeline/available-api-credits/design.html` (self-contained; views: Composed, State gallery, Peer account, 320px phone)
**System:** designed strictly within `pipeline/design-system.md`; no new tokens, no new libraries, no fonts loaded.

## Visual Direction

The credit standing joins the flat, account-scoped "Other global limits" band exactly where reset credits and the Claude offer already live. It reads as a third account fact under its own small uppercase heading, in the same quiet mono-word register as the reset count and the offer title, never as a new gauge or a card. Honesty is structural: fresh standings are plain words, stale keeps the reset-credit pill grammar with its age, unavailable mirrors the reset-credit unsupported pattern, and no path can produce a zero that the provider did not literally report.

## Screens / Views

### Composed view (local host, offer present)

The shipped `.limits-overview` card is unchanged above the band: four gauge cards, then `.supplementary` → `.supplement-grid` with the Claude group, the Codex group, and the full-width Claude offer. Changes are confined to the two tool groups:

**Claude group** ("◆ Claude model caps", unchanged title). Existing model-cap rows, then a trailing credit block:
- `<div class="credit-block credit-block-tail">` opens with a 1px `--border` hairline above it (12px margin).
- `<h4 class="nested-limit-title">Credit balance</h4>` (real heading inside the `aria-labelledby` group).
- `.credit-summary` → `<span class="unavailable-metric">Unavailable</span>`.
- `.empty-evidence` reason sentence (bold lead) + one plain-sentence tail.
- `.credit-pointer` plain text when the offer block renders in the section: "Check in Claude Usage, linked under the Claude offer below." No anchor here; the offer's `.promotion-link` is the section's one Usage link.

**Codex group** (retitled "▲ Codex credits &amp; resets"). Order: Credit balance, Reset credits, Model caps (if any).
- `<div class="credit-block credit-block-lead">` closes with a hairline below it (12px padding), so the two sub-blocks read as two facts separated by a rule and a heading, not one list.
- `<h4 class="nested-limit-title">Credit balance</h4>` with its top margin zeroed (the group head already provides 11px).
- `.credit-summary` → `<span class="credit-status">Credits available</span>` (.9rem mono 650, the same weight class as `.promotion-title`).
- `.credit-balance` → "Provider balance `<bdi class="credit-balance-value">62500</bdi>` · provider's own figure; not converted". The value is mono, `--text`, 620, tabular, `unicode-bidi: isolate`, wrap-anywhere.
- `.credit-age` → `fmtAge(capturedAt)` output, e.g. "updated 3m ago" (.62rem `--faint`, tabular).
- Then `<h4 class="nested-limit-title">Reset credits</h4>` followed by the **unchanged** `resetCreditsHtml` output (count, pill, copy line, expiry list, notes).

Key decisions: the status is a word, not a figure, so it does not borrow the 1.42rem accent count treatment of reset credits (two large numerals side by side would invite summing). The balance lives in a muted sentence with only the value itself in `--text` mono, which keeps it legible without promoting an opaque string to a headline.

### State gallery (mockup documentation, not product DOM)

One cell per wire state in the same divided band. The small mono caption above each cell names the wire state for the Engineer; it is a mockup annotation and must not be built. States shown: unlimited (balance null), available (balance "62500"), available (balance "0"), none, stale/lastStatus available, available under `codex-cmd-failed`, unsupported never-observed, unsupported peer-omitted, not-reported with text pointer, not-reported with link pointer, status outside the enum (Unavailable, no reason sentence), stale/lastStatus none.

### Peer account (multi-host, no self member)

Account 2 reachable only through a peer: no offer block renders, so the Claude credit block's pointer becomes the section's single anchor (`<a class="promotion-link" href="https://claude.ai/settings/usage" rel="noopener noreferrer">Check in Claude Usage</a>`). The Codex group shows `peer-omitted` Unavailable above a stale reset-credit block, demonstrating that the two sub-blocks age and fail independently.

### 320px phone frame

Single-column stack (the shipped `max-width: 620px` rules). Worst case per NFR-06: a stale pill plus a 64-code-point space-free balance. Verified with a real browser: document and body scroll width equal the viewport at 320, 375, 390, and 430px; the frame's own scroll width equals its 320px box.

## Component Usage

All existing, reused as-is: `.supplementary`, `.supplement-grid`, `.global-limit-group` (+ `.tool-claude` / `.tool-codex` tone), `.global-limit-head` / `.global-limit-title` / `.global-limit-meta`, `.tool-mark`, `.nested-limit-title`, `.state-pill.pill-warn` (stale), `.unavailable-metric`, `.empty-evidence`, `.evidence-note` / `.evidence-note.critical`, `.promotion-link`, `.reset-summary` family (unchanged), `.promotion-group` (unchanged).

New (additive, scoped to the credit block): `.credit-block`, `.credit-block-lead`, `.credit-block-tail`, `.credit-summary`, `.credit-status` (+ `.is-none`), `.credit-last`, `.credit-balance`, `.credit-balance-value`, `.credit-age`, `.credit-pointer`. Class names match `schema.md` section 8; the CSS block below is the exact proposal.

```css
.credit-block { min-width: 0; }
.credit-block-lead { padding-bottom: 12px; border-bottom: 1px solid var(--border); }
.credit-block-lead > .nested-limit-title { margin-top: 0; }
.credit-block-tail { margin-top: 12px; border-top: 1px solid var(--border); }
.credit-block-tail > .nested-limit-title { margin-top: 12px; }
.credit-summary { display: flex; align-items: center; flex-wrap: wrap; gap: 7px 10px; min-width: 0; margin: -2px 0 8px; }
.credit-status { color: var(--text); font-family: var(--mono); font-size: .9rem; font-weight: 650; line-height: 1.2; overflow-wrap: anywhere; }
.credit-status.is-none { color: var(--muted); }
.credit-last { color: var(--muted); font-size: .67rem; overflow-wrap: anywhere; }
.credit-balance { margin: 4px 0 8px; color: var(--muted); font-size: .67rem; line-height: 1.5; overflow-wrap: anywhere; min-width: 0; }
.credit-balance-value { color: var(--text); font-family: var(--mono); font-weight: 620; font-variant-numeric: tabular-nums; unicode-bidi: isolate; overflow-wrap: anywhere; word-break: break-word; }
.credit-age { margin: 0 0 6px; color: var(--faint); font-size: .62rem; font-variant-numeric: tabular-nums; }
.credit-pointer { margin: 8px 0 0; color: var(--muted); font-size: .68rem; line-height: 1.45; }
.credit-block .promotion-link { margin-top: 4px; }
.credit-block .evidence-note + .evidence-note { margin-top: 6px; }
```

Proposed small extension to the shipped `.promotion-link` (both call sites, offer and credit row): a hover underline and a visible focus ring, so the section's one link has a state. See Motion Spec.

## Design Tokens Applied

- Color: `--text` (status word, balance value, note body), `--muted` (balance sentence, "last reading", "No credits", pointer), `--faint` (age), `--border` (sub-block hairlines), `--warn` / `--warn-bg` (stale pill and stale note), `--crit` / `--crit-bg` (source-error note), `--panel` (unsupported note background via `.empty-evidence`), `--accent` (the one link), `--focus-ring`.
- Type: `--mono` for the status word, balance value, and headings; `--sans` for sentences. Sizes: heading .62rem uppercase 650 tracked .07em; status .9rem 650; sentence .67–.68rem; age .62rem. `tabular-nums` on every live age and on the balance value.
- Shape/space: hairline 1px; sub-block spacing 12px; pill radius 999px (shipped). No inline styles carry untrusted values.
- Theme: automatic `prefers-color-scheme`; the mockup's toggle is review-only.

## Interaction Notes

- Status and reason copy come from own-key tables; a code outside the table renders "Unavailable" with no reason sentence and no balance row (gallery cell 11).
- Balance row: non-null string → value in `<bdi>` + fixed note; null with a fresh/stale status → "Provider balance · not reported"; unsupported → no balance row.
- Age line appears whenever `capturedAt` is non-null, using the same `fmtAge` grammar as reset credits ("updated 3m ago"). Stale pill text reuses `resetStatePill('stale', capturedAt)`: "stale · 6h 41m ago".
- Notes stack in this order when both apply: source-error (critical) then stale (warn), 6px apart.
- Exactly one claude.ai Usage anchor per supplementary section. When the offer block renders, the credit row's pointer is plain text; otherwise the pointer is the anchor with `rel="noopener noreferrer"`.
- Everything is ordinary readable DOM: no `title`-only disclosure, no hover-only content, no truncation; long values wrap.
- Reset credits, credit balance, and the Claude offer carry three distinct headings; the credit block contains no reset count and no "Reset for free" text.

## Motion Spec

- Promotion / pointer link hover (underline color): ease-out, 140ms, in place (no transform), reduced-motion → instant, CSS.
- Promotion / pointer link focus-visible ring (`--focus-ring` box-shadow): ease-out, 120ms, in place, reduced-motion → instant, CSS.
- Gauge bar width (shipped, unchanged): `cubic-bezier(.2,.8,.2,1)`, 220ms, left origin, reduced-motion → instant, CSS.
- Credit rows, pills, notes, age text: no motion. Ages update in place with tabular numerals; no entrance, stagger, pulse, or color flash on a state change.
- Global fallback: the shipped `@media (prefers-reduced-motion: reduce)` block (transition/animation duration 0.01ms) covers every rule above.

## Content Notes

Tone: short, plain, specific; sentence case; "·" as the only separator; no em dashes; no marketing voice. Exact strings:

Headings
- Codex group title: `Codex credits & resets`
- Sub-headings: `Credit balance`, `Reset credits` (and the existing `Model caps`)

Status copy (own-key, `CREDITS_STATUS_COPY`)
- `unlimited` → `Unlimited`
- `available` → `Credits available`
- `none` → `No credits`
- `stale` → pill `stale · <age> ago` + `last reading: <lastStatus copy>` (e.g. `last reading: Credits available`)
- `unsupported` → `Unavailable`
- any other code → `Unavailable` (no reason sentence, no balance row)

Balance row
- With value: `Provider balance <value> · provider's own figure; not converted`
- Null value (fresh or stale): `Provider balance · not reported`
- Explicit `"0"` renders `0`; no currency symbol, no formatting.

Age
- `updated <duration> ago` via `fmtAge` (e.g. `updated 3m ago`, `updated 6h 41m ago`)

Notes
- Stale: **The last good credit reading is old;** the balance may have changed.
- Source error (`codex-cmd-failed` / `no-reading` with a standing shown): **The latest Codex account read failed.** Showing the last good credit reading.

Reason copy (own-key, `CREDITS_REASON_COPY`), rendered as `.empty-evidence` with the sentence in bold and one plain tail
- `never-observed` → **No credit standing has been observed from Codex yet.** The standard Codex windows above are unaffected.
- `peer-omitted` → **This host did not report a credit standing.** An older llmdash on that machine, or a block the peer check could not verify.
- `not-reported` → **Claude Code does not report a usage-credit balance.** No figure is inferred from the statusline or the usage pane.

Claude pointer
- Offer block present (plain text): `Check in Claude Usage, linked under the Claude offer below.`
- Offer block absent (the one link): `Check in Claude Usage`

Unchanged copy the Engineer must not touch: every reset-credit string, the offer block, "provider-reported", "owner observed", "Other global limits", "same account · before pacing and local activity", and the account-honesty line.
