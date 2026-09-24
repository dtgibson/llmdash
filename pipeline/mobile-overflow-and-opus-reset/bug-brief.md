# Bug Brief — Mobile Overflow and Opus Reset

## What is broken
At a 320px phone width, the dashboard scrolls horizontally into a large empty area. The owner also found a claimable Opus 5.5 promotional reset in Claude desktop/web **Settings → Usage** that llmdash does not surface. It is an offer to take an action, not a model-cap meter or a scheduled usage-window reset.

## Steps to reproduce
1. Open the live dashboard at a 320px mobile viewport after device-health history has populated; the document is 725px wide while the body is 320px, and swiping right slides all content left.
2. In DevTools, hide only `table.sr-only` inside the health-history figure; document width falls to 320px with no remaining overflow. The hidden table itself has a 702px intrinsic width despite the 1px `.sr-only` rule.
3. Read the live `/api/state` and Claude reading file: both carry only a Fable model cap. Claude Code `/usage` likewise shows Fable but does not show the promotional offer.
4. In the owner-supplied Claude desktop Usage screenshot, a separate **Resets** card reads “Get extra wiggle room to explore Opus 5.5. Expires Oct 22.” and offers **Reset for free**. The screenshot omits an expiry year and time zone.

## Expected behavior
At phone widths, the full dashboard fits the viewport and the exact health-history table remains available to screen readers. The claimable Opus promotion is visible as a separate, source-linked offer with its observation age; it is never labeled a model cap or an automatic reset. A stale, claimed, dismissed, or expired offer must not look claimable.

## Blast radius
The overflow originates in the dashboard's health-history table and shared `.sr-only` CSS; check other visually hidden tables and mobile widths. The desktop/web promotion is separate from the Claude Code `/usage` path, its Fable cap, and Codex reset credits. No authenticated, sanctioned machine-readable promotion source has been found; preserve the existing account-window and model-cap paths.

## What done looks like
At 320px and common phone widths, document width matches the viewport with populated health history and the table retains its accessibility semantics. The screenshot's claimable Opus offer is clearly distinguished from meters and credits. Any owner-managed record states where and when it was observed, does not infer a year or exact expiry instant from “Oct 22,” and requires a new observation after staleness. Claiming or dismissing it removes the claimable presentation.
