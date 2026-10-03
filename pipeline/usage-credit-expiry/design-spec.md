# Design Spec — Usage Credit Expiry

**Feature:** usage-credit-expiry
**Stage:** 4 — The Designer
**Mockup:** `pipeline/usage-credit-expiry/design.html` (self-contained; views: Composed with a mock clock, Headline states, Balance expiry, 320px phone)
**System:** designed strictly within `pipeline/design-system.md`; no new tokens, no new libraries, no fonts loaded, CSS-only motion. Class names and the view model follow `schema.md` §5–6 so the Engineer's CSS and render functions land as drawn.

## Visual Direction

A small addition inside the existing "Other global limits" band, in the register that band already speaks: a third sub-block under its own small uppercase heading, separated by the same 1px hairline, with one focal line (the absolute date) at the status-word weight and everything else as muted readable sentences. Nothing is elevated, tinted, or animated; the headline inherits the reset reading's state and age rather than owning any of its own. Honesty is structural: a passed instant is never shown, no dates reads "not reported", zero resets renders no block at all, and the Codex balance states plainly that Codex does not report its expiry.

## Screens / Views

### Composed view (desktop, local host)

Everything above the supplementary band, the Claude group, and the Claude offer are unchanged context. Changes are confined to the Codex group, whose body order becomes **Next reset expiry → Credit balance → Reset credits** (→ Model caps when present):

**Next reset expiry sub-block** (`<div class="next-expiry-block">`, first child of the group body, closes with a 1px `--border` hairline, 12px padding):
- `<h4 class="nested-limit-title">Next reset expiry</h4>` — same level and style as "Credit balance" (NFR-03). Its top margin is zeroed because the group head already provides the 11px.
- `.next-expiry-summary` — flex, `space-between`, wraps, `gap: 7px 10px`. Left: `.next-expiry-when` (a column). Right: the state pill when one applies.
- `<time class="next-expiry-date" datetime="<canonical ISO>">Oct 5, 2026, 9:00 AM PDT</time>` — .9rem mono 650 `--text`, tabular, `letter-spacing -0.01em`, wrap-anywhere. The same `resetExpirationLabel` output the list uses for the same instant (QA-02).
- `.next-expiry-relative` — muted .67rem sentence: `expires in <span class="next-expiry-dur">2d 21h</span>` or `2 resets expire in <span class="next-expiry-dur">2d 21h</span>`; only the duration is `--text` mono 620 tabular (the balance-value treatment, so a figure inside a sentence reads as a figure without becoming a second headline).
- `<p class="next-expiry-age">updated 3m ago</p>` — `fmtAge(reset.capturedAt)`, .62rem `--faint`, tabular.
- `<p class="next-expiry-note">` — present only when every FR-08 guard passes: `<strong>Expires before your Codex weekly reset.</strong> The weekly window resets in 4d 2h.` Ordinary wrapping text, bold lead in `--text`, tail muted; deliberately **not** an `.evidence-note` callout (it is a fact about two provider instants, not a data-quality warning, and must not share the stale/source-error grammar).

**Credit balance sub-block** (`.credit-block.credit-block-lead`, unchanged except one line): status word → balance sentence → **`<p class="credit-expiry">Expiry · not reported by Codex</p>`** → age. The expiry line sits 5px under the balance sentence (`margin: -3px 0 6px`) so the two provider facts about the balance read as a pair, both in the muted .67rem register.

**Reset credits sub-block**: byte-for-byte as shipped (golden-pinned, FR-18).

**Mock clock (review-only chrome, below the account-honesty line):** three buttons step a fixed clock (Oct 2, 2026, 12:00 PM PDT) to +3d and +23d and re-render the Codex body through a faithful copy of the schema view model. At +3d the Oct 5 instant has passed: the headline becomes Oct 25 with no note (Oct 25 is after the Oct 6 weekly reset), the count drops to 1 and the list to one row. At +23d nothing remains: the headline block is absent, the count reads 0 with the zero copy, and no dash appears. The weekly gauge's `RESET` value follows the same clock. None of this is product DOM; the product's 1s render tick produces the same transitions.

Key decisions for this screen:
- Date first, countdown second — the list rows already read that way, and the date answers "when does it stop being usable"; the countdown is derived.
- No second large numeral. The reset count keeps its 1.42rem accent figure; the headline date is the status-word weight. Two large figures in one group would invite summing (the system's standing rule).
- The pill, when present, right-aligns beside the date like `.reset-summary`; it carries the state as text, never color alone.
- The stale / source-error explanatory sentences are not repeated in the headline; Reset credits owns them (FR-03).

### Headline states (gallery)

One cell per display state, same divided band. The mono caption above each cell names the wire state for the Engineer and is not product DOM:
1. `available`, note present (soonest Oct 5 before weekly reset Oct 6).
2. `available`, grouped: `2 resets expire in 2d 21h` and `2 resets expire before your Codex weekly reset.`
3. `available`, expiry after the weekly reset (Oct 8 vs Oct 6): headline without note.
4. `stale` (6h 41m): headline + `stale · 6h 41m ago` pill, age inherited, no note.
5. `source-error` (`codex-cmd-failed`): headline + `source error` crit pill, no note.
6. `partial` with no dates: heading, `not reported` (`.unavailable-metric`), `partial` pill, age; no `<time>`, no countdown, no note.
7. `zero`: no headline block; the group opens with Credit balance (`No credits`, `Expiry · not reported by Codex`) then `0 available` + zero copy.
8. `unsupported` / `malformed`: no headline block; the shipped Unavailable copy.

### Balance expiry (gallery)

1. `not-reported` (today, every Codex host): `Expiry · not reported by Codex`.
2. `reported` (forward-compatible): `Expiry <time class="credit-expiry-date" datetime="2026-11-01T16:00:00.000Z">Nov 1, 2026, 9:00 AM PDT</time> · expires in 29d 21h`. Same date formatter and duration formatter as the headline; the date is `--text` mono 620.
3. `stale` standing with `not-reported`: the balance ages on its own clock (stale pill + `last reading`), independent of the headline above it.
4. `unlimited` with `balance: null`: `Provider balance · not reported` then `Expiry · not reported by Codex`.
5. Absent key / own-key miss (`constructor`, `__proto__`) / a `reported` instant that has passed: no expiry line, no raw code.
6. Claude: pinned exactly as shipped — no expiry line (FR-15).

### 320px phone frame

Real inline-size container replaying the shipped `max-width: 620px` rules. Worst case per QA-24: grouped headline, note, and balance expiry line all populated, Claude group stacked above. Verified in headless Chromium: document and body scroll widths equal the viewport at 320px and 390px; the frame's scroll width equals its box; the formatted date (204.6px) fits on one line at 320px; the note and countdown wrap as text.

## Component Usage

All existing, reused as-is: `.supplementary`, `.supplement-grid`, `.global-limit-group` (+ `.tool-codex` tone), `.global-limit-head` / `.global-limit-title` / `.global-limit-meta`, `.tool-mark`, `.nested-limit-title`, `.state-pill.pill-warn` / `.pill-crit` via `resetStatePill`, `.unavailable-metric`, `.credit-block` / `.credit-block-lead` / `.credit-summary` / `.credit-status` / `.credit-balance` / `.credit-age`, the whole Reset credits block, `.evidence-note` (unchanged, in Reset credits only).

New classes (additive, `public/styles.css`, beside `.credit-block`):

```css
.next-expiry-block { min-width: 0; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
.next-expiry-block > .nested-limit-title { margin-top: 0; }
.next-expiry-summary { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 7px 10px; min-width: 0; margin: -2px 0 6px; }
.next-expiry-when { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.next-expiry-date { display: block; min-width: 0; color: var(--text); font-family: var(--mono); font-size: .9rem; font-weight: 650; line-height: 1.25; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.next-expiry-relative { display: block; min-width: 0; color: var(--muted); font-size: .67rem; line-height: 1.45; overflow-wrap: anywhere; }
.next-expiry-dur { color: var(--text); font-family: var(--mono); font-weight: 620; font-variant-numeric: tabular-nums; }
.next-expiry-summary .state-pill { margin-top: 1px; }
.next-expiry-age { margin: 0; color: var(--faint); font-size: .62rem; font-variant-numeric: tabular-nums; }
.next-expiry-note { min-width: 0; margin: 8px 0 0; color: var(--muted); font-size: .67rem; line-height: 1.5; overflow-wrap: anywhere; }
.next-expiry-note strong { color: var(--text); font-weight: 650; }
.credit-expiry { min-width: 0; margin: -3px 0 6px; color: var(--muted); font-size: .67rem; line-height: 1.5; overflow-wrap: anywhere; }
.credit-expiry-date { color: var(--text); font-family: var(--mono); font-weight: 620; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
```

Mobile contract (QA-11, NFR-04): every new container is `min-width: 0` with `overflow-wrap: anywhere`; none uses `white-space: nowrap`, `text-overflow`, or `title`-only content. No new media or container rule is needed. No inline styles; no untrusted value reaches a style attribute.

Markup the Engineer builds (headline, per `schema.md` 5c with the `.next-expiry-when` wrapper added here):

```html
<div class="next-expiry-block">
  <h4 class="nested-limit-title">Next reset expiry</h4>
  <div class="next-expiry-summary">
    <div class="next-expiry-when">
      <time class="next-expiry-date" datetime="…">Oct 5, 2026, 9:00 AM PDT</time>
      <span class="next-expiry-relative">expires in <span class="next-expiry-dur">2d 21h</span></span>
    </div>
    <!-- or, no date: <span class="unavailable-metric">not reported</span> -->
    <!-- pill when stale / source-error / partial-without-date -->
  </div>
  <p class="next-expiry-age">updated 3m ago</p>
  <p class="next-expiry-note"><strong>Expires before your Codex weekly reset.</strong> The weekly window resets in 4d 2h.</p>
</div>
```

The headline must never contain the literal `<h4 class="nested-limit-title">Reset credits</h4>` (the golden test slices on it), and its `<time>` stays on `.next-expiry-date`, never `.expiry-date` (the golden's placeholder regex targets the list).

## Design Tokens Applied

- Color: `--text` (date, duration, note lead, reported expiry date), `--muted` (countdown sentence, note tail, Expiry line, headings), `--faint` (age), `--border` (the block's closing hairline), `--warn` / `--warn-bg` and `--crit` / `--crit-bg` only through the shipped pill classes. No accent on any new element; the accent stays on the reset count, list indices, and the one link.
- Type: `--mono` for the date, duration, reported expiry date, and the heading; `--sans` for sentences. Sizes: heading .62rem uppercase 650 tracked .07em; date .9rem 650; sentences .67rem; age .62rem. `tabular-nums` on every live figure and age.
- Shape/space: hairline 1px; sub-block padding 12px; summary gap 7px 10px; note top margin 8px; expiry line 5px under the balance sentence. Pill radius 999px (shipped).
- Theme: automatic `prefers-color-scheme`; the mockup's toggle is review-only.

## Interaction Notes

- The headline is recomputed on the existing 1s render tick with `nowMs` read once per render (FR-06). `resetCreditsForDisplay` already filters to future instants and sorts ascending, so `expirations[0]` is the soonest and a passed instant can never be selected; when none remains the block follows FR-04/FR-05.
- State, `capturedAt`, and pill come verbatim from the reset display state; the headline adds no freshness logic. The credit block keeps its own `credits.capturedAt` clock.
- Note guards, in order (any failure → no note): soonest present; reset state `available` or `partial`; `tool.limits.seven_day.resetsAt` is a string; parses finite and `> nowMs`; `providerResetIsCurrent` true (freshness band not stale, no `stale-reading` diagnostic); `soonestMs < weeklyMs` strictly. Reads the raw provider `resetsAt`, never `dashboardWindowReset` or any configured schedule.
- Credit expiry line: `not-reported` via own-key table → fixed copy; `reported` with a parseable, strictly-future `expiresAt` → date + countdown; anything else (absent key, unknown status, passed instant) → the line is omitted, never relabelled. The Claude `unsupported` branch is not touched.
- Everything is ordinary readable DOM: no `title`-only disclosure, no hover-only content, no truncation; long text wraps.
- Accessibility: the `<time>` carries a canonical ISO `datetime`; the heading sits at the same level as "Credit balance"; state is conveyed by pill text, not color alone.

## Motion Spec

CSS only; no motion library (the configured stack has none). Every rule below sits under the shipped global `@media (prefers-reduced-motion: reduce)` block (transition/animation duration 0.01ms).

- Next reset expiry date, countdown, age, pill, note; credit Expiry line: **no motion**. Live readouts update in place with tabular numerals; no entrance, stagger, pulse, or color flash on a state change, and no transition when the headline drops to the next instant or disappears (the system's "live readouts update in place" rule; the doctrine's "animate what changed" is satisfied by the text itself changing).
- Promotion / pointer link hover (underline color): ease-out, 140ms, in place, reduced-motion → instant, CSS (shipped, unchanged).
- Promotion / pointer link focus-visible ring (`--focus-ring`): ease-out, 120ms, in place, reduced-motion → instant, CSS (shipped, unchanged).
- Gauge bar width: `cubic-bezier(.2,.8,.2,1)`, 220ms, left origin, reduced-motion → instant, CSS (shipped, unchanged).
- Mockup-only pills (view nav, theme, mock clock): color/border/background 160ms ease-out, focus 120ms; not product DOM.

## Content Notes

Tone: short, plain, specific; sentence case; "·" as the only inline separator; no em dashes; no marketing voice; a readout states facts and never advises. Exact strings:

Heading
- `Next reset expiry` — refined from the PRD/schema default "Next expiry" so the heading names which fact it is about (the group also carries a Credit balance with its own Expiry line). Requirement IDs and behaviour are unaffected (PRD Open Question 5); QA-05's "no headline heading" check holds for either string.

Headline summary
- Single: `expires in <duration>` (e.g. `expires in 2d 21h`)
- Grouped: `<N> resets expire in <duration>` (e.g. `2 resets expire in 2d 21h`)
- No date (`partial`): `not reported`
- Date label: `resetExpirationLabel(iso)` output, identical to the list's for the same instant (e.g. `Oct 5, 2026, 9:00 AM PDT`)

Age
- `updated <duration> ago` via `fmtAge` (e.g. `updated 3m ago`, `updated 6h 41m ago`)

Pills (via `resetStatePill`, unchanged): `stale · <age> ago`, `source error`, `partial`

Before-weekly-reset note (bold lead, plain tail; two sentences)
- Single: **Expires before your Codex weekly reset.** The weekly window resets in <duration>.
- Grouped: **<N> resets expire before your Codex weekly reset.** The weekly window resets in <duration>.
- Refined from the schema's one-line parenthetical form `Expires before your Codex weekly reset (in 4d 2h).`; same facts, reads as a sentence on a phone.

Credit balance Expiry line (own-key table `CREDIT_EXPIRY_COPY`)
- `not-reported` → `Expiry · not reported by Codex` (unchanged from the PRD default)
- `reported` → `Expiry <date> · expires in <duration>` (e.g. `Expiry Nov 1, 2026, 9:00 AM PDT · expires in 29d 21h`)
- absent / unknown / passed → no line

Unchanged copy the Engineer must not touch: every Reset credits string (including its stale / source-error / unavailable-dates notes), every Credit balance string shipped by available-api-credits, the Claude not-reported block and its pointer, "provider-reported", "Other global limits", "same account · before pacing and local activity", and the account-honesty line.
