## Codex resets and global limits

### What this does

Adds one account-scoped `Other global limits` band directly beneath the four
primary Claude Code and Codex account gauges. It keeps those gauges dominant
while making the other allowances that can stop work visible before pacing and
machine-local activity:

- Codex reset credits show the authoritative number currently available and
  every known provider expiration, ordered soonest-first.
- Claude model caps such as Fable and Sonnet—and future bounded model limits—
  use the same top account area.
- Same-account evidence from several hosts appears once. Different accounts
  remain separate and never share reset counts, expirations, or model caps.
- Full, zero, partial, malformed, unsupported, stale, and source-error states
  use distinct text-first presentations. Missing dates are reported rather than
  inferred.

The former lower model-cap rows and lower Codex reset-count copy are removed so
each account-wide allowance reads as one budget.

### How it works

- The existing Codex poller observes `rateLimitResetCredits` alongside the
  sanctioned `account/rateLimits/read` response. It retains only a bounded
  count, canonical expiration instants, and the original observation time;
  provider IDs, titles, descriptions, grant times, and raw records are dropped
  inside the parser.
- Reset evidence stays in a detached, TTL-bounded in-process snapshot. Sparse
  responses retain the last good observation for the existing account-fact
  lifetime, while account changes clear it. Expired known credits are removed
  from both the effective count and visible list at the exact boundary.
- Each `/api/state` tool receives an additive `accountLimits` object. Claude
  receives the fixed unsupported reset shape; Codex receives the cached
  snapshot. No dashboard request starts Codex or fans out to peers.
- Peer ingestion strictly normalizes the new object, caps collections at 128,
  canonicalizes timestamps, strips control and formatting characters from
  display strings, and degrades older peers to unsupported without affecting
  their standard gauges.
- The browser uses semantic `<time>` elements with localized date, time, and
  timezone text. Exact duplicate expirations may share a row only when the row
  states the exact reset quantity.
- Supplementary evidence has its own same-account selection clocks: the newest
  valid reset observation wins as one snapshot, while each model-cap identity
  selects its newest valid capture. Primary account identity and gauge behavior
  are unchanged.

### How to test

Run the focused contract and renderer suite:

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

The implementation pass completed this set with 100 passing and no failures or
skips. `npm test` completed with 753 passing, 0 failing, and 2
environment-dependent skips (755 total). `git diff --check`, JavaScript syntax
checks, and `weft-design-lint check public/` are also clean.

Follow `pipeline/codex-resets-and-global-limits/how-to-see-it.md` to review the
live account reading locally or over Tailscale.

### Notes for reviewer

- A live implementation check observed 3 available Codex resets with three
  provider-supplied expiration instants. The application discarded all other
  reset-record fields before publication.
- The dashboard recomputes known expiry boundaries each second, but provider
  reads remain poller-owned. Rendering does not trigger a command.
- Existing 5-hour/weekly identities, percentages, projections, headroom,
  history, menu-bar presentation, and configured reset/billing behavior retain
  their prior semantics.
- There is no SQLite migration, new endpoint, runtime dependency, provider
  write, reset-consumption action, peer fan-out, or production deployment in
  this change.

## Convention flags

- Provider entitlement evidence is authoritative; missing expirations are
  never estimated from usage history.
- Account-wide allowances are canonical in the top account story and are not
  repeated inside machine-local details.
- Same-account evidence may collapse only after the existing provider-specific
  reset-window identity check; different accounts never merge.
- Current reset entitlements remain bounded in memory rather than becoming
  durable usage history.
