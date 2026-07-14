## What We Accomplished

Shipped the limits-first, tool-grouped dashboard and corrected Codex limit
window identity. Duration-bearing Codex slots now map 300 minutes to 5-hour and
10,080 minutes to weekly; unknown or absent explicit windows stay unavailable.
Current Codex gauges never use independent database history, so obsolete slots
cannot reappear after relaunch. Claude and Codex account limits lead on desktop
and mobile, while pacing, activity, model caps, Codex insights, and Trends stay
with the tool they describe.

## Production State

- Runtime release: `044a50a` (`Reorganize dashboard by tool and fix Codex windows`).
- Context update: `fbead33` (`chore: update context after dashboard tool grouping`).
- Installed checkout: clean `main` at `fbead33`, aligned with `origin/main`.
- Service: `com.llmdash.dashboard` running from `/Users/developer/llmdash`.
- Live Codex: `ChatGPT Pro`; 5-hour unavailable; weekly 46% used / 54%
  remaining, resetting July 20, 2026.
- Installed menu-bar script: 5-hour `not available`, weekly `54%`.

The first installer reload hit the recurring macOS launchd
`bootout`→`bootstrap` timing failure. Production was immediately restored to
`ba33302` and health-checked before work continued. The valid regenerated plist
was then retained and the release restarted safely with `launchctl kickstart
-k`; every production check passed. LaunchAgent reload hardening remains on the
roadmap.

## Verification

- Full suite: 552 tests, 550 pass, 0 fail, 2 environment-dependent skips.
- Focused frontend: 47 pass, 0 fail.
- Independent security boundary suite: 117 pass; no security/privacy findings.
- Design lint: clean, 3 public files scanned.
- Exact 320px emulation: no document or component overflow; all four primary
  account slots precede diagnostics; range controls retain 32px targets.
- Production: `/`, `/api/state`, `/api/hosts`, and all Codex-insights ranges
  healthy; required security/cache headers present; HEAD 200 and POST 405
  contracts intact.
- Menu-bar source unchanged and installed output verified against the missing
  Codex short window.

## Lasting Records

- `PRODUCT_CONTEXT.md` reflects the limits-first, tool-grouped current product.
- `DECISIONS.md` records duration-backed window identity and current-window
  authority over historical snapshots.
- `CLAUDE.md` carries the provider-window identity convention.
- `pipeline/design-system.md` now defines the account comparison, unavailable
  window, tool-detail grouping, and minimum-width acceptance patterns.
- `ROADMAP.md` records this as the latest shipped improvement; the existing
  LaunchAgent reload-hardening follow-up remains visible.
- Complete design, QA, security, deployment, and decision evidence lives under
  `pipeline/dashboard-tool-grouping/`.

## Open Notes

- Historical rows captured under the old positional Codex mapping remain in
  Trends until they age out, but cannot populate current gauges.
- Codex keeps its pre-existing last-known-reading policy after later poll
  failures; the visible capture age remains the evidence of recency.

The improvement is complete and live. Run `$weft` in this project to begin the
next piece of work.
