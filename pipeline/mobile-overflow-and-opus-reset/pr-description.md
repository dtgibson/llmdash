## Mobile Overflow and Opus Reset

### What this does

Clips the exact health-history table inside its screen-reader-only wrapper so the populated dashboard fits phone widths while retaining accessible table semantics. Adds an owner-managed Claude Opus 5.5 promotional offer, shown separately from provider model caps and Codex credits, with explicit observation, stale, claimed, and dismissed states.

### How to test

1. Open the tailnet-only development preview at https://hephaestus-developer.giraffe-chuckwalla.ts.net:8931/ on a phone. Swipe across the dashboard, especially after device-health history populates; no horizontal empty area should appear.
2. Inspect the health-history chart with a screen reader or accessibility tree. The exact table, caption, headers, and rows should remain present.
3. Under **Other global limits**, find the distinct **Claude offer** block. It should say **Reset for free · Opus 5.5**, show observation age, state that “Oct 22” lacks a shown year and exact time, and link to Claude Usage. Fable model caps and Codex reset credits remain separate.
4. Open **Settings → Reset & billing → Claude promotional offer**. The saved observation and its provenance should appear. An offer action requires the explicit confirmation checkbox. After 24 hours without a new observation, the offer becomes stale and cannot be marked claimed until re-observed.
5. Run `npm test` and `/Users/developer/.weft/bin/weft-design-lint check public/`.

### Notes for reviewer

- The offer wording comes from the owner-supplied Claude desktop Usage screenshot. The authenticated Claude desktop/web Usage view is signed out on this Mac; no machine-readable promotion source was found. The screenshot omits expiry year and time zone, so the implementation does not derive an expiry instant or expire it automatically.
- The development preview contains one screenshot-grounded observation for review. No production or installer seed was added. An owner must confirm the offer is still visible before recording it in the installed dashboard, and claim it in Claude itself.
- No new mutation route or `/api/state` or `/api/hosts` contract was added. The existing reset/billing PUT provides CSRF, ETag, version, and atomic-write protection. The HTTPS preview uses a development-only loopback proxy; production Host acceptance is unchanged.
- Chrome measured no horizontal overflow with populated dashboard history at 320, 375, 390, or 414px. Settings also fits 320, 390, and 414px. Full suite: 883 passed, 2 skipped; design lint clean.
