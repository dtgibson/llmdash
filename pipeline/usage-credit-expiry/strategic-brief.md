# Strategic Brief — Usage Credit Expiry

## What We're Building
Show, next to each tool's credit standing, when those credits expire — using
only the expiry instants the providers actually report. Today that evidence is
exactly one thing: Codex's per-reset-credit `expiresAt`. The Codex credit
balance and everything on the Claude side carry no expiry on any sanctioned
local channel, so for those the dashboard states "expiry not reported by the
provider" as a server-stated fact rather than leaving a gap or inventing a date.

## Why Now
Available API credits shipped on 2026-10-01 and put the credit standing beside
the resets; the natural next question is "and how long do I have them?" The
user asked for a research-first New Feature so the build could gather every
piece of time-bound credit evidence the providers expose. That research is done
(see *Evidence Inventory*): the only expiry the providers report is already on
the wire (`accountLimits.resetCredits.expirations`), so this is mostly a
presentation promotion plus an honest disclosure — small, low-risk, and it
settles what Limit alerts (still roadmap item 1; this feature is not it, which is
fine) may later reason about. This is not the first item on the roadmap.

## The User Problem
Reset credits are "use it or lose it": each one is valid for a bounded period
(every live Codex reset observed today expires exactly 30 days after its grant).
The dashboard lists those dates, but only inside the "Reset credits" sub-block
of the account story, soonest-first, with no headline — on a phone the user
scrolls past the credit standing without learning that a reset lapses before
the weekly window even turns over. And the "Credit balance" block is silent on
expiry, which reads as "we didn't check" when the truth is "Codex does not say".
The user wants one glance to answer: what credits do I hold, and when does the
soonest one stop being usable?

## Evidence Inventory (verified 2026-10-02 against local code and live data)
- **Codex balance** — `codex app-server` `account/rateLimits/read` →
  `rateLimits.credits` = `{ hasCredits, unlimited, balance }` (live response,
  codex-cli 0.159.3; the binary's `CreditsSnapshot` struct has exactly
  `has_credits / unlimited / balance`; rollout logs carry the same three keys).
  **No expiry field exists.** Also present and unread: `spendControlReached`,
  `individualLimit`, `rateLimitUpsell` (null) — none is an expiry.
- **Codex reset credits** — `rateLimitResetCredits.credits[]` each carries
  `grantedAt` and `expiresAt` (epoch seconds), plus `id`, `title`,
  `description`, `status`, `resetType`. `expiresAt` is retained (normalized to
  ISO, future-only, bounded to `availableCount`) and rendered per reset in
  `public/app.js` `resetExpiryRows`. `grantedAt` is **deliberately not
  retained** (DECISIONS.md 2026-07-30: no IDs, titles, descriptions, or grant
  times). Observed: all three live resets have `expiresAt − grantedAt` =
  2,592,000 s (30 days).
- **Codex per-thread** — rollout/app-server carry `estimated_usage_credits_micros`
  per turn (a usage estimate, not an entitlement or expiry). Not relevant here.
- **Claude statusline** — `scripts/statusline.js` writes the whole
  `rate_limits` object; on this machine it contains only `five_hour` and
  `seven_day` (`used_percentage`, `resets_at`). No credit or expiry key.
- **Claude `/usage` pane** — captured panes (`tests/fixtures/usage-pane-*.txt`)
  show the two windows, the per-model weekly cap, and promotional copy
  ("Until July 7 …"); no credit balance or credit expiry line. The pane's
  `/usage-credits` command exists ("Configure usage credits to keep working when
  you hit a limit") but shows no figure.
- **Claude Code internals (2.1.288 binary)** — an "extra usage" / usage-credit
  model exists (`extraUsageStatus`, `overageResetsAt`, `extra_usage_state`,
  `overageDisabledReason` incl. `out_of_credits`, an
  `extra_usage_expiry_notice` feature), sourced from API response headers.
  **None of it reaches a sanctioned local channel**, and `overageResetsAt` is a
  monthly extra-usage limit reset, not a credit expiry. Reading it would require
  the OAuth/API path the founding decisions forbid. Upstream request #27636
  (billing fields in the statusline payload) remains the honest route.
- **Prepaid console balances** (Anthropic Console, OpenAI Platform) — excluded
  on 2026-10-01; they need API keys and a credentialed outbound call.

Conclusion: the only provider-reported credit expiry is Codex's per-reset
`expiresAt`, already ingested. Balance expiry is **not reported** by Codex;
Claude reports **no credits and no expiry** at all.

## Success Criteria
- In the account story, the Codex credits group leads with a headline "next
  expiry" for reset credits — the soonest future `expiresAt` with its absolute
  date and countdown — visible on a 320px phone without opening the per-reset
  list, and derived from the same collapsed same-account evidence the list uses.
- A reset credit whose `expiresAt` falls before the Codex weekly window's
  `resetsAt` is marked as expiring before the weekly reset, computed only when
  both instants are present and fresh; otherwise no such note appears.
- The "Credit balance" block for Codex shows an explicit expiry line reading
  "not reported by Codex"; the Claude credit block stays its reason-coded
  "Claude Code does not report a usage-credit balance" and adds no expiry claim.
- Every expiry shown is a provider instant: no date is inferred from grant
  times, usage history, or the 30-day pattern; a reset with no `expiresAt`
  continues to count toward "N expiration dates are unavailable" and never gets a
  guessed date; zero available resets shows no headline expiry (not "—" dressed as
  a date, not a fabricated instant).
- The headline carries the reading's capture age; when the reset evidence is
  `stale` or `source-error`, the headline inherits that state visibly instead of
  reading as fresh.
- A peer host in the multi-host view shows the same headline and the same
  "not reported" expiry disclosure, with a `normalizePeerState`-path test proving
  the new field survives (or degrades honestly) across the wire.
- No change to the primary gauges, their pacing rows, `/api/hosts`,
  `computeMultiBadge`, or the badge output; the reset-credits list itself still
  renders as before (a pre-change golden proves it).

## Scope
- **Headline next-expiry** in `public/app.js`: a new line at the top of the
  "Codex credits & resets" group (above or within the Credit balance block)
  summarizing the soonest future reset expiration — absolute date (browser
  timezone, as the list already does), countdown via the existing `fmtDur`, and
  the capture age. Grouped duplicates ("2 resets expire …") reuse the list's
  grouping rule.
- **Expires-before-weekly-reset note**: compare the soonest reset `expiresAt`
  with the Codex `seven_day` window's `resetsAt` from the same tool payload;
  render one bounded, wrapping note when the expiry precedes it. Both instants
  must be present; nothing is computed when either is missing or the reading is
  not fresh.
- **Server-stated expiry disclosure on the credit balance**: extend
  `accountLimits.credits` with an `expiry` sub-fact produced by
  `codexCredits()` in `src/codex-limits.js` — today `{ status:
  'not-reported' }` because the provider shape carries no expiry; if a future
  Codex response adds an expiry instant, the producer normalizes it to ISO
  (`new Date(Date.parse(v)).toISOString()`; never defaulting to "now") and the
  status becomes `reported` with `expiresAt`. Claude's block keeps
  `unsupported / not-reported` and gains no expiry key. Shape, enums, and
  factory live once in `src/account-credits.js`.
- **Peer path**: whitelist the `expiry` sub-fact in `normalizeCredits` in
  `src/hosts.js` (enum status own-key check; `expiresAt` re-normalized to ISO,
  future-only); an unknown status degrades to `not-reported`. Ship the
  `normalizePeerState`-path test in `tests/hosts-client.test.js` (or
  `tests/hosts-account.test.js`) in the same change.
- **Multi-host collapse**: the headline derives from the already-selected
  `accountLimits.resetCredits` of the collapsed account (newest valid capture);
  no change to the selection or merge rules.
- **Client copy**: new codes map to copy through own-key lookup tables only
  (`Object.prototype.hasOwnProperty.call`); no raw code reaches the DOM.
- **Honesty guards**: pre-change golden of the reset-credits sub-block under a
  fixed clock (`tests/fixtures/`), a pin test for the "not reported" disclosure,
  and mobile-width checks (320px and common phone widths) for the new rows.
- **Disclosure**: README and `PRODUCT_CONTEXT.md` state what expiry evidence
  each provider reports (Codex per-reset only; Claude none), and that balance
  expiry is not reported.

## Out of Scope
- **Codex credit-balance expiry** — not reported by the provider (`credits` has
  no expiry field). Nothing is inferred from the balance, the plan, or the
  billing period.
- **Any Claude credit expiry or balance** — not reported on the statusline
  `rate_limits` payload or the `/usage` pane. Claude Code's internal extra-usage
  fields (`overageResetsAt` etc.) come from API response headers and are not
  reachable through a sanctioned local channel; reading them would reopen the
  OAuth/credential path the founding decisions forbid.
- **Retaining `grantedAt`** or deriving validity periods from the observed 30-day
  grant-to-expiry pattern. The 2026-07-30 decision excludes grant times; a
  provider pattern is not provider evidence. Revisiting that retention is an
  owner call for a separate run, not a side effect of this one.
- **Any expiry for prepaid console balances** (excluded with the balances
  themselves on 2026-10-01).
- **Alerts or notifications on an approaching expiry** — belongs to Limit
  alerts (roadmap item 1), which may reason about `resetCredits.expirations`
  and the new `expiry` status but must respect their states.
- **Menu-bar badge changes** — title, dropdown, `computeMultiBadge`, and the
  badge contract stay byte-for-byte unchanged; a badge credits row remains a
  horizon item.
- **Persistence** — no new snapshots; expirations remain bounded in-memory
  account facts with the existing TTL / 24 h hard cap (DECISIONS.md 2026-07-30).
- **Changing `/api/hosts`, the gauges, or their pacing rows** — expiry is an
  account-fact detail, not a window measurement.
- **Reading `rateLimitsByLimitId`, `spendControlReached`, `individualLimit`, or
  `rateLimitUpsell`** — none carries an expiry; the per-limit map stays its own
  horizon item.

## Key Decisions
- **The research verdict is part of the feature.** The provider inventory
  above is the authoritative answer to "what expiry data exists": Codex per-reset
  `expiresAt` only. Everything else is disclosed as not reported, never
  estimated. The Planner should not open additional data-source work.
- **Headline before list.** The soonest reset expiration becomes the first
  thing in the Codex credits group; the per-reset list stays exactly as shipped
  (golden-pinned). This is a presentation regroup over existing `hostViews` /
  `accountLimits` data — no new polling, subprocess, or request-path work.
- **Server states absence; the client never guesses it.** "Expiry not reported
  by Codex" is a reason-coded enum produced where the provider shape is known
  (`codexCredits()`), carried on `/api/state`, whitelisted by the peer
  normalizer, and mapped to copy by own-key lookup — the same pattern as the
  Claude `not-reported` credit state. The field is a disclosed absence, not a
  dead knob, and becomes a real instant the day the provider reports one.
- **Two reported instants may be compared; one may never be invented.** The
  "expires before your weekly reset" note is computed only from `expiresAt` and
  the weekly `resetsAt`, both present and fresh. No countdown is shown for a
  reset lacking a date; zero resets means no headline.
- **Expiry freshness is the reset reading's freshness.** The headline inherits
  the reset-credit state (`fresh` / `stale` with age / `source-error`) and shows
  the capture age; the credit-balance block's own age clock is separate and stays
  so (account facts keep distinct observation clocks, DECISIONS.md 2026-07-30).
- **Same-account collapse is unchanged.** Multi-host picks the newest valid
  reset capture per account as today; the headline reads from that chosen block.
  Different accounts never merge.
- **Alignment:** serves the single user of the founding brief, extends the
  "when each resets" promise to the credits the dashboard already shows, uses
  only sanctioned data paths, and keeps alerts, console balances, and badge
  changes out — consistent with the founding Out of Scope and the 2026-10-01
  credits decision.
