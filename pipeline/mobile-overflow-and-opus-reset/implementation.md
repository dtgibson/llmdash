# Engineer implementation — mobile overflow and Opus reset

## Mobile overflow

The exact health-history `<table>` sits inside the existing `.sr-only` clipping wrapper. The wrapper constrains the table's intrinsic width without changing its semantic element, caption, headers, or rows. No global visually hidden rule changed.

With populated history, Chrome measured document and body scroll widths equal to 320, 375, 390, and 414px viewports. At 320px the table remains 702px intrinsically, the wrapper is 1px, and Chrome's accessibility tree contains the table and caption.

## Claude Opus offer

The owner-supplied Claude desktop Settings → Usage screenshot shows a distinct **Resets** card: “Get extra wiggle room to explore Opus 5.5. Expires Oct 22.” Its action is **Reset for free**. This is a claimable promotion, separate from the Fable model cap, account-window resets, and Codex reset credits. The screenshot does not show the expiry year or time zone. Claude Code `/usage` and the machine-readable readings do not expose this offer, so no provider automation or inferred cap was added.

The existing protected reset/billing configuration now accepts a bounded `claudePromotion` record. In Settings, an owner can confirm a current observation, mark a fresh observed offer claimed, or dismiss it. The server stamps the action time and preserves the record through unrelated reset/billing edits. The existing same-origin, CSRF, strong ETag, version, and atomic-write checks protect these actions. A claim requires an observation no more than 24 hours old. The GET view marks older or implausibly future observations stale. The dashboard shows the record only in the local Claude account's supplementary limits, as a separate **Claude offer** block. Stale, claimed, and dismissed states do not use the “Reset for free” title. It links to Claude Usage and states that the year and exact expiry time were not shown. No automatic expiry instant is inferred.

No owner offer is seeded in production or the installer. The development preview has one observation based on the recent owner-supplied screenshot solely to show the feature. The owner must check the live Claude Usage page before recording or claiming the offer in the installed dashboard. The preview's data store and process are separate from the installed service.

## Verification

Focused backend, API, settings-client, and dashboard-client tests pass. The full suite reports 883 passed, 2 skipped, 0 failed. Design lint reports 0 findings; `git diff --check` is clean.

The tailnet-only HTTPS preview is verified at https://hephaestus-developer.giraffe-chuckwalla.ts.net:8931/. Its root, Settings page, and protected configuration GET return 200. A protected HTTPS-origin PUT with CSRF and ETag proof saved the development observation and returned the distinct source-labeled offer. At 320px, the dashboard document/body scroll widths equal the viewport and its offer renders. Settings loaded with equal document/body widths at 320, 390, and 414px. The development-only loopback proxy translates the HTTPS origin and Host for the existing protected route; it validates the public Host and same-origin PUT before forwarding. Production server Host and origin rules were not changed.
