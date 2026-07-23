# Design Spec — Reset and Billing Configuration

## Visual Direction

Extend llmdash’s existing plain, local-data readout into one focused settings surface beneath a familiar `llmdash · settings` header. The experience is intentionally not a dashboard redesign: a single bordered surface contains three linearly ordered sections separated by rules—reset provenance, recurring plans, and source files. Live/configured provenance is the strongest visual element; forms and file actions remain quieter. Tool identity uses the established `◆` Claude and `▲` Codex marks plus their existing color tokens, while all meaning remains explicit in text.

## Screens / Views

- **Ready:** Shows a `Live` next-reset selection even though the editable Friday `23:00` `America/Los_Angeles` fallback is present, proving live precedence. A stale-usage note explicitly remains stale.
- **Edit:** The reset fields are always available. Each Claude/Codex row expands in place for amount, effective date, anchor day, and explicit confirmation; it does not open a modal or add a nested card.
- **Validation:** An error summary and associated inline errors identify malformed USD and missing confirmation. Focus moves to the first invalid control; nothing is presented as persisted.
- **Saving / Saved:** The primary action enters a short disabled `Saving…` state, followed by a live-region confirmation, incremented version, configured provenance preview, and clean form state.
- **Conflict:** A version-4-versus-version-3 banner disables Save and offers `Reload latest` or continued read-only review. Reload briefly enters the loading state before presenting the latest values.
- **Loading:** The one settings surface becomes `aria-busy` and shows a compact local-configuration progress state.
- The prototype-only state selector exposes Ready, Loading, Validation, Saved, and Version conflict for review. At 320px, fields and resources stack into one column and actions retain usable touch targets without horizontal page scrolling.

## Component Usage

- Reuse the llmdash wordmark, page width, section kicker, mono metadata, focus ring, flat divided bands, status-tinted callouts, buttons, and fixed resource-link grammar.
- `Reset selection` is a semantic provenance callout. Green denotes a usable live provider result; accent blue denotes a configured fallback. The source label and explanatory copy carry the meaning before color.
- `Provenance list` is a two-row definition list showing both the selected live evidence and the dormant configured fallback.
- `Recurring plan list` is one divided list with slim tool rails. Each row includes current amount, effective start, billing anchor, and a single in-place Change control.
- `Billing inputs` exposes View and Download for `account-config.json`, legacy `subscriptions.json`, and `api-rates.json` through fixed URLs only.
- The sticky-looking bottom action band belongs to the same surface and contains unsaved-state copy, Discard, and Save changes. It is not position-fixed, avoiding viewport obstruction on phones.

## Design Tokens Applied

- Exact light/dark llmdash tokens are used for `bg`, `panel`, `panel-soft`, borders, text tiers, track, accent, status colors/backgrounds, and Claude/Codex identity.
- Type follows the existing split: system sans for explanatory content and the llmdash mono stack for figures, labels, paths, dates, versions, and controls.
- Geometry follows the system: 860px maximum page width, 16px/11px outer gutters, 15px main-surface radius, 9–10px control/callout radii, and 16–20px section padding.
- Strong gauge elevation is deliberately absent; settings use a single border and no gauge shadow so account-window metrics remain the dashboard’s primary layer.
- Focus states use `--focus-ring`; controls meet a minimum 40px height (42px for inputs) and stack at narrow widths.

## Interaction Notes

- A usable current provider reset always displays as `Live`; editing the configured fallback does not replace it. The Saved preview demonstrates `Configured` only when live evidence is unavailable.
- Weekday, local time, and canonical IANA zone are independently labeled. Time uses the native time control; the zone is a bounded prototype select. Production validation remains server-authoritative.
- Opening a plan change reveals fields inline and moves focus to amount. Saving an open plan change requires strict USD precision and its tool-specific confirmation checkbox. Dates are described as inclusive billing boundaries; anchor-day copy explains month-end clamping.
- Client validation associates errors with controls through `aria-describedby`, sets `aria-invalid`, provides a summary, and focuses the first error. Server field paths should map to the same messages.
- A `412` conflict must keep the operator’s visible edits, disable repeat Save, and offer reload. A failed load/save must never imply that current values changed.
- Resource actions use only the six schema-defined URLs. Paths are display-only and never become editable controls.
- Usage freshness is separate from reset provenance: the stale callout persists while the reset schedule is edited or saved.

## Motion Spec

- Button, border, focus, and color feedback: 120–160ms ease-out.
- Saving and conflict reload use a 650ms prototype delay only to make the state legible; production duration follows the request and has no artificial delay.
- Loading uses a small 280ms linear spinner. There are no entrance animations, hover scale, bounce, stagger, or decorative continuous motion.
- `prefers-reduced-motion: reduce` collapses animation and transition duration to effectively zero.

## Content Notes

- Seeded configuration is written exactly as `Friday · 23:00` and `America/Los_Angeles`; no copy calls it a universal default.
- Reset source labels are the contract values `Live`, `Configured`, and (when needed) `Unavailable`. Provider timestamps and calculated fallback copy stay distinguishable.
- Billing language says “configured access cost,” never charge, invoice, price inferred from usage, or payment. Amount examples are owner-confirmed `$100.00 / month` for Claude and `$20.00 / month` for Codex.
- Effective starts are inclusive; a change closes the earlier immutable version and appends a new one. Legacy fixed periods are read-only and remain separate.
- Security copy stays appropriately narrow: “served over Tailscale,” “fixed local resources,” version check, and atomic local update. The UI does not suggest accounts, roles, arbitrary browsing, or cross-machine writes.
