# Seeing trends-range-guard

This fix is already verified automatically: supported ranges work as before, and unexpected range names return seven-day data. No terminal work or local Mac access is required for review.

Once The Guide restarts and verifies the final bundle, open the tailnet-only preview:

<https://hephaestus-developer.giraffe-chuckwalla.ts.net:8982/>

In Trends, switch between **24h**, **7d**, and **30d**. Each tool should retain its usual charts and range behavior.

For the exact bug, open:

<https://hephaestus-developer.giraffe-chuckwalla.ts.net:8982/api/trends?range=constructor>

The response should display JSON with `"range":"7d"` instead of `error`. The automated checks also verify other inherited names and bodyless HEAD responses, before and after cache publication.

Preview verification is pending the bundle restart; these links are the agreed review destination, not evidence that the current preview already runs this change.
