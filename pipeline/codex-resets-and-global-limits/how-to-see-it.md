# Seeing Codex resets and global limits

The feature reads the same local provider evidence as llmdash today. It does
not consume a reset, change an account, or write production configuration.

## Open the running review build

This implementation is currently running on port `8791` and is bound to all
local interfaces:

- This Mac: <http://127.0.0.1:8791>
- Tailscale: <http://100.70.220.2:8791>

Use HTTP, not HTTPS. The Tailscale address works only from a device signed into
the same tailnet. The review process is temporary and stops when its terminal
session ends; it does not replace or deploy the installed service on port
`8787`.

## Start it again later

From the project root:

```sh
LLMDASH_HOST=0.0.0.0 LLMDASH_PORT=8791 npm start
```

Find this machine's current tailnet address with:

```sh
tailscale ip -4
```

Then open `http://<tailscale-ip>:8791/` from another tailnet device. If port
`8791` is already in use, choose another free port in both the command and URL.

## What to inspect

Near the top of the dashboard, confirm this reading order:

1. The account heading and row labeled `Shown once`.
2. The existing Claude Code and Codex 5-hour/weekly gauges.
3. `Other global limits`, with `Claude model caps` and `Codex reset credits`.
4. Evidence notes, followed by pacing and machine-local activity.

With the live account used during implementation, the Codex group reports
`3 available` and lists three visible expiration dates soonest-first. Each date
includes local calendar date, time, timezone, and a secondary countdown. The
canonical instant is also present in the semantic `<time datetime="…">`
element. If the provider reading changes, the count and dates will naturally
reflect that newer evidence instead.

When Claude reports Fable, Sonnet, or another bounded model cap, it appears in
the Claude column with its provider label, weekly scope, remaining percentage,
reset evidence, and capture age. It should not appear again in the lower Claude
details.

At phone width, confirm the two supplementary columns stack, all absolute dates
remain visible, the primary gauge pairs remain above them, and the page has no
horizontal scrolling. The feature adds no buttons, hover-only dates, or
prototype switches.

## Contract checks

To inspect the bounded API object without provider-private fields:

```sh
curl -fsS http://127.0.0.1:8791/api/state
```

Each tool has `accountLimits.scope: "account-wide"`. Codex reset evidence is in
`accountLimits.resetCredits`; Claude uses the fixed unsupported reset shape.
There should be no reset IDs, titles, descriptions, grant times, or raw provider
objects.

Run the focused verification with:

```sh
node --test \
  tests/claude-freshness.test.js \
  tests/codex-account-facts.test.js \
  tests/codex-insights-client.test.js \
  tests/dashboard-refinement.test.js \
  tests/hosts-client.test.js \
  tests/hosts-degradation.test.js \
  tests/state-diagnostics.test.js \
  tests/state-unchanged.test.js
```

The tests cover full, zero, partial, malformed, unsupported, stale, and source
error presentations; exact expiry crossings; duplicate-expiry quantities;
Fable, Sonnet, and future model caps; same- and different-account hosts; hostile
input; lower-page deduplication; and the minimal-DOM fallback.
