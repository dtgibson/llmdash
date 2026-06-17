# Decisions — Weekly Limit Predictor & Codex Stats

## DS-01 — Status pills added (deliberate design-system evolution)
**Date:** 2026-06-17 · **Stage:** 4 (The Designer) · **Status:** approved by the user at the design review.

**Decision.** Introduce a status-pill component to the design system: `.burn-pill`
with `.pill-good` / `.pill-warn` / `.pill-crit`, backed by two new background
tokens `--good-bg` / `--crit-bg` (defined for light and dark). Restructure the
`.burn` callout from a horizontal flex row to `flex-direction: column` so the
token-rate figure stacks above the per-window pacing rows.

**Why.** The dual-window pacing readout needs both windows' status to be readable
in one glance on a phone. The locked design system signaled status with colored
text only (`.is-good` / `.is-warn` / `.is-crit`). With two windows stacked, text
color alone was lower-contrast and harder to scan, and longer captions wrapped
raggedly. Tinted pills give an aligned, scannable status column and make the
per-window "limit reached vs on pace" distinction land instantly.

**Scope / follow-through.** This evolves `pipeline/design-system.md`. Per the
pipeline, The Chronicler folds the pill component and the two tokens back into
`design-system.md` at closeout (Stage 9). This entry records the change now so it
is explicit and deliberate, never silent drift (per CLAUDE.md and the design
system's own "evolve deliberately" rule).

**Alternative considered.** Text-only status (no pill, no new tokens) to stay
strictly within the locked tokens. Rejected as less glanceable for the
two-window case; the user chose to keep the pills.
