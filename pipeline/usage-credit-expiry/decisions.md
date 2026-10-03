# Decisions — Usage Credit Expiry

## Stage 4 — The Designer (2026-10-02)

Designed within the established `pipeline/design-system.md`; no evolution of the look, no new tokens, no new libraries, no fonts loaded. The entries below are the only places the design extends the system, refines a default from the PRD/schema, or departs from the Weft design doctrine, each on purpose.

1. **Heading copy refined: "Next reset expiry", not "Next expiry".** The Codex group now carries two expiry statements (the reset headline and the balance's Expiry line); a heading that names its subject keeps them from being read as one fact. PRD Open Question 5 leaves wording to this stage; FR-01/QA-05 are unaffected (the omission check is "no headline heading", true for either string). The Engineer's test strings should use the refined heading.

2. **Note copy refined into two sentences.** The schema's `Expires before your Codex weekly reset (in 4d 2h).` became **Expires before your Codex weekly reset.** The weekly window resets in 4d 2h. (grouped: **N resets expire before your Codex weekly reset.** …). Same two provider instants, same guards; a sentence reads better than a parenthetical when it wraps on a phone. The note states the fact and does not advise ("use it before then" was considered and dropped: the dashboard is a readout).

3. **The note is plain text, not a tinted callout.** `.next-expiry-note` is a muted sentence with a `--text` bold lead, deliberately not `.evidence-note`. The warn/crit callout grammar means "this data is degraded"; this note is a true statement about two fresh instants and must not look like a warning about the reading.

4. **Date is the focal line at the status-word weight; the countdown is a figure inside a sentence.** The headline date renders at .9rem mono 650 (the `.credit-status` / `.promotion-title` class of weight), never the 1.42rem accent numeral the reset count owns, so the group keeps one large figure and nothing invites summing. The duration inside `expires in …` is `--text` mono 620 (the `.credit-balance-value` treatment) so it reads as a figure without becoming a second headline. Extends the system's "a standing is a word, not a figure" rule to a dated instant.

5. **Fourth in-group hairline.** The headline block closes with the same 1px `--border` rule the credit blocks use, so the Codex group reads as three facts under three headings separated by rules. Additive; `.credit-block-lead` is unchanged.

6. **No accent on any new element.** Accent stays on the reset count, list indices, and the one Usage link; the new rows are `--text` / `--muted` / `--faint` only, so the one sharp accent in the band is not diluted.

7. **Omission is the no-headline state, and the mockup shows the group without it.** Zero / unsupported / malformed render no block, no dash, no placeholder; the gallery shows the group opening with Credit balance so the absence is seen as the product will show it, not described.

8. **Mock clock is review-only chrome.** The composed Codex body is re-rendered by a faithful in-page copy of the schema's view model so the live drop-off (FR-06), the note guards (FR-08/09), and FR-04 can be watched. It pins `en-US` / `America/Los_Angeles` so the mockup reads identically in any reviewer's browser; the product uses the browser's own locale and timezone. The mock re-polls at each step (capture age stays 3m) so no stale state is faked by moving the clock alone. None of it is product DOM; the Engineer builds from `app.js`, using the mock only as a behavioural reference.

9. **Doctrine departures, ratified by the project (carried from available-api-credits).** Display face stays the project's mono stack and body the `system-ui` stack from design-system.md; no OFL web font (zero external dependencies, CSP `default-src 'self'`, no build step). No icon library; `◆` / `▲` are the identity cue. No entrance or state-change motion on the new rows: the band is a live readout and the system's "live readouts update in place; no entrance, stagger, or continuous decoration" rule governs. `weft-design-lint` is clean.

10. **Verification performed at this stage.** Headless Chromium: document and body widths equal the viewport at 320px and 390px; the 320px frame has zero overflow; every new class is `min-width: 0` with `overflow-wrap: anywhere` and no `nowrap` / `text-overflow`; the Claude group renders no expiry line; the mock clock produces Oct 25 / no note / count 1 at +3d and no headline / zero copy / no dash at +23d.
