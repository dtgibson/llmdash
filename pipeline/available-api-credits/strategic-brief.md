# Strategic Brief — Available API Credits

## What We're Building
Show each tool's provider-reported usage-credit standing beside the reset
information it already shows: for Codex, the live credit status and balance
that `codex app-server` reports alongside the rate limits; for Claude, an honest
"not reported by Claude Code" state, because no sanctioned local channel carries
a Claude credit balance today.

## Why Now
The user asked for it ahead of Limit alerts, and most of the evidence is already
in hand: `src/codex-limits.js` captures `credits.hasCredits / unlimited /
balance` from the same `account/rateLimits/read` response that feeds the Codex
gauges and reset credits, with the same evidence-age TTL. That fact is rendered
today only in the "Deeper Codex insights" account row far down the page, where
nobody planning around a reset will see it. Promoting it to the account story is
a small, honest move that pays off immediately; it also sets the honest Claude
state before Limit alerts starts reasoning about headroom.

## The User Problem
When a window is near its limit, the question is "can I keep working, and on
what?" The reset time answers half of it. Credits answer the other half: whether
there is a paid balance to continue on once the window is spent. Today that
balance is three scrolls below the resets, and on the phone or a peer host it is
not shown at all, so the user ends up opening Codex or Claude to check.

## Success Criteria
- On the dashboard, Codex's reset information and its credit standing (status +
  provider balance) read together in one place, with the capture age visible.
- The Claude side never shows a fabricated or inferred credit figure; it states
  plainly that Claude Code does not report a credit balance, and points at the
  existing "Check in Claude Usage" affordance rather than duplicating the offer.
- `hasCredits: false` renders as an explicit "No credits" (an explicit zero stays
  zero); a missing or expired observation renders as unavailable or stale with
  its age, never as zero.
- Reset credits (a count of reset entitlements), the Opus "Reset for free"
  offer, and the credit balance remain three visibly distinct facts; the user
  never reads one allowance as several budgets.
- A peer host in the multi-host view shows the same credit standing the local
  dashboard shows (or an honest unavailable), with a peer-path test proving it.
- The former duplicate in the Codex insights account row is gone; the plan label
  stays there.

## Scope
- Extend the per-tool `accountLimits` object in `/api/state` with a bounded
  `credits` block carrying an enum status (`unlimited` / `available` / `none` /
  `stale` / `unsupported`), the provider balance as an opaque, control-stripped,
  length-bounded string (or null), and `capturedAt`. Source: the existing
  `codexAccountFacts` facts in `src/codex-limits.js`; no new polling, no new
  subprocess, no request-path work.
- Render the Codex credit standing inside the existing "Codex reset credits"
  supplementary group (rename the group title to cover both, e.g. "Codex credits
  & resets"), as ordinary readable DOM that may wrap, with the age shown. Reset
  credits keep their own count, expiration list, and states unchanged.
- Render a Claude credit row in the Claude supplementary group as an unavailable
  state with the reason copy "Claude Code does not report a usage-credit
  balance" (enum reason, client-side own-key copy table), linking to the
  existing claude.ai Usage page affordance rather than adding a second link.
- Peer path: add the `credits` block to `normalizeAccountLimits` in
  `src/hosts.js` with a status whitelist, and add the `stale` reset-credit
  status to `RESET_CREDIT_STATUSES` in the same whitelist touch (it is already
  flagged on the roadmap horizon and would otherwise sit beside the new credits
  line reading as fresh when it is not). Ship a `normalizePeerState`-path test
  covering both.
- Multi-host account collapse: the credits block follows `accountLimits` through
  the existing per-account selection (newest valid capture per account; never
  merge different accounts).
- Remove the credit status and balance bits from `insightAccountHtml`; keep the
  plan label there (one canonical home for account-wide allowances).
- Dashboard CSS for the new rows at phone widths (320px and common widths), no
  horizontal overflow.

## Out of Scope
- Prepaid API console balances (Anthropic Console, OpenAI Platform). Both need
  API keys and a credentialed outbound call; the founding brief excludes
  pay-as-you-go API-key spend as a different meter and the codebase allows only
  the credential-free peer GET. Not a candidate for later either, unless the
  founding decision on credentials is revisited first.
- Any Claude credit value. Neither the statusline `rate_limits` block (only
  `five_hour` / `seven_day`; an open upstream request #27636 asks for billing
  fields) nor the `/usage` pane captures expose a balance. If a future Claude
  Code pane shows an "extra usage" line, that is a new parser section for a
  later run, failing loudly as `parse-failed` per the existing rule.
- Interpreting the Codex balance. The provider sends an opaque string with no
  unit or currency; we display it labelled as the provider's own figure and do
  not convert, sum, price, or compare it with anything.
- Reading `credits` from the Codex rollout-file fallback path. It is per-turn
  cached and snake_cased (`has_credits`); the fallback stays plan-only, and the
  credits fact ages into `stale` under the existing TTL when app-server is down.
- Menu-bar badge title or dropdown changes; the badge contract and
  `computeMultiBadge` stay byte-for-byte unchanged. A dropdown credits row is a
  horizon item.
- New snapshots or any persistence; credits are current account facts and stay
  bounded in memory, like reset credits.
- Alerts or thresholds on credits (belongs to Limit alerts, still next).

## Key Decisions
- Credits are a presentation promotion of an already-observed fact, not a new
  data source: `codexAccountFacts()` is the single producer; `/api/state`
  `accountLimits.credits` is the single wire home; the insights duplicate goes.
- Three distinct account facts, three distinct labels: reset credits (count of
  reset entitlements with expirations), credit balance (status + opaque
  provider figure), and the Claude promotional reset offer. No shared total.
- Honesty states are structural, matching the reset-credit model: fresh within
  the account-fact TTL, `stale` with age past it, cleared at 24 h, `unsupported`
  when never observed; `hasCredits: false` is an explicit `none`, not an
  absence. A balance of `"0"` is shown as 0, not hidden.
- Balance is an opaque string: control/format/line-separator characters
  stripped, 64 code points max, HTML-escaped at render, bidi-isolated next to
  adjacent account facts. No numeric coercion, no currency symbol.
- Status crosses the wire as an enum; the client maps codes to copy via an
  own-key lookup and never renders a raw code. The peer normalizer whitelists the
  enum in the same change, with a peer-path test, per the `src/hosts.js` rule.
- Claude's row is a reason-coded unavailable state, not an empty gap: the user
  should see that llmdash looked and the channel does not carry it.
- Placement is the supplementary account group (where reset credits and the
  offer already live), not the primary gauges or their pacing rows: gauges keep
  bounded, duration-derived reset copy only, and a credit balance is not a
  window measurement.
- Alignment: this serves the same single user and the founding "sanctioned
  interface" decision; the explicit out-of-scope boundary is the API-key meter,
  which this feature deliberately does not touch.
