# Decisions — Available API Credits

## Stage 4 — The Designer (2026-10-01)

Designed within the established `pipeline/design-system.md`; no evolution of the look. The entries below are the only places the design extends the system or departs from the Weft design doctrine, each on purpose.

1. **Sub-block hairlines inside a supplementary group** (`.credit-block-lead` / `.credit-block-tail`). The Codex group now carries two facts under two headings; a 1px `--border` rule between them keeps "three distinct facts" visible, not just labelled. This is a new in-group boundary pattern (the shipped groups separated sub-blocks by heading margin alone). Additive; the existing Codex "Model caps" nested title is untouched. Candidate to fold into design-system.md under the supplementary band pattern.

2. **Status is a word, not a figure.** "Credits available" / "No credits" / "Unlimited" render at .9rem mono 650 (the `.promotion-title` class of weight), not the 1.42rem accent numeral used for the reset count. A second large number beside the reset count would invite reading them as one total (US-03, FR-24). "No credits" is additionally muted (`.credit-status.is-none`); the word carries the meaning, color only reinforces.

3. **Opaque balance stays in a sentence.** The provider balance sits in a muted `.credit-balance` line with only the `<bdi>` value in `--text` mono. It is never a headline because it has no unit, is never converted, and may be a 64-character string. Explicit "0" renders as `0`.

4. **Unavailable mirrors the reset-credit unsupported pattern** (`.unavailable-metric` + `.empty-evidence`), so Claude's not-reported row and Codex's never-observed/peer-omitted rows read as the same kind of honest absence the user already knows.

5. **Pointer vs link.** When the offer block renders, the Claude credit row's pointer is plain text that names where the link is ("Check in Claude Usage, linked under the Claude offer below."). When the offer is absent the pointer is the one anchor. Keeps exactly one Usage link per section (FR-26) without a silent dead end.

6. **Link states added to `.promotion-link`** (hover underline 140ms ease-out, focus-visible `--focus-ring` 120ms). The shipped link had no hover or focus treatment; the section's single actionable element should have one. Within the system's motion rules (ease-out, under 300ms, reduced-motion fallback). Candidate to fold into design-system.md Motion.

7. **Doctrine departures, ratified by the project.** The display face stays the project's mono stack and the body stays the `system-ui` stack from design-system.md; no OFL web font is introduced (zero external dependencies, CSP `default-src 'self'`, no build step). No icon library (Lucide) is used; the `◆` / `▲` tool marks are the system's identity cue. No entrance or state-change motion on the new rows: the band is a live readout and the doctrine's own "animate what changed, never decorate" rule plus the system's "no entrance, stagger, or continuous decoration" line both point to none.

8. **Mockup-only chrome.** The theme toggle, view nav, state-gallery captions naming wire codes, and the "gauge lanes omitted" placeholder exist only in `design.html` for review. None of it is product DOM; raw status/reason codes never reach the page (FR-20).

## Stage 7 follow-up — README reachability disclosure (Case 1)

The Auditor's informational finding 3 noted the README did not say who can reach
the Codex balance now that it moved from the local-only insights payload onto
`/api/state` (fetched by peers, re-served by a monitor's `/api/hosts`). CLAUDE.md
requires disclosing the reachability of privacy-sensitive aggregates, so one
sentence was added to the README credit paragraph. Docs only; no code changed, so
no re-verification was needed.
