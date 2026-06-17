# Decisions — Usage Trends

## 2026-06-16 — Charts extend the design system (Stage 4, The Designer)
**Decision:** Add a Trends section of plain-SVG chart cards (limit-burn line,
tokens-per-day stacked bars, cache-rate line, value line) per tool, with a
range-switch (24h / 7d / 30d, default 7d), inline below the gauges. Tools with
too few points show a dashed "not enough data yet" empty card.
**Why:** "Maximum insights" on one page, kept honest about thin/empty data, with
zero new dependencies (the user's standing preference).
**Impact:** New reusable patterns — chart card, range switch, chart empty state,
plain-SVG charts — and a `--grid` token, folded into `pipeline/design-system.md`.

## 2026-06-16 — Build fixes incl. a latent CSP bug (Stage 5, The Engineer)
**Decision:** Allow `style-src 'self' 'unsafe-inline'` in the CSP and serve static
assets `cache-control: no-store`. Anchor line charts' x-axis to the selected range
window; add axis/point/bar value labels.
**Why:** The strict CSP from feature 1 silently blocked the inline `style=""`
attributes the gauges/token-mix/legends used (a latent bug since the Codex
refactor moved them to template strings) — bars rendered blank. The x-axis was
scaled to the data span, so the limit chart looked identical across ranges.
**Impact:** Gauges, token-mix, legends, and charts now render; ranges differ
visibly. script-src stays locked.

## 2026-06-16 — Security review passed with notes (Stage 7, The Auditor)
**Decision:** Focused review returned PASSED WITH NOTES (no Critical/High/Medium).
The CSP style relaxation is validated as safe (no untrusted input reaches a style
sink; script-src locked). One Informational item — 30d cold-cache reads more log
files — **accepted, not fixed**, because a hard cap would risk dropping the user's
legitimate logs for a non-issue under the threat model. See security-report.md.

## 2026-06-16 — Deployed onto the existing service (Stage 8, The Deployer)
**Decision:** Restarted `llmdash.service` onto the final reviewed code (no new
infra; the trends server code was already live, and the browser pulls assets
fresh under `no-store`). Verified `active` and the Trends section live over
Tailscale.
