# PRD — Usage Credit Expiry
**Feature:** usage-credit-expiry
**Date:** 2026-10-02
**Stage:** 2 — The Planner
**Source:** strategic-brief.md (approved)

## Feature Overview
Promote the soonest provider-reported reset-credit expiration to a headline at the
top of the Codex credits group (with its countdown, capture age, and an
"expires before your weekly reset" note when both instants are current), and add
a server-stated `expiry` sub-fact to the credit-standing block so the Codex
balance says plainly that Codex does not report when it expires. Everything
rendered is either an instant Codex actually reported or a reason-coded absence;
nothing is inferred.

The research verdict in the brief's Evidence Inventory is final for this build:
the only provider-reported credit expiry is Codex's per-reset `expiresAt`, already
on the wire as `accountLimits.resetCredits.expirations`. No new data source,
poller, subprocess, or request-path work is opened here.

## User Stories

> **US-01** — As the dashboard's single user checking my phone, I want the
> soonest reset-credit expiry shown first in the Codex credits group with a date
> and countdown, so that I learn a reset is about to lapse without scrolling into
> the per-reset list.

> **US-02** — As a user planning the week, I want to be told when a reset credit
> expires before my Codex weekly window turns over, so that I use it before the
> window resets rather than losing it.

> **US-03** — As a user reading the Credit balance block, I want an explicit
> "expiry not reported by Codex" line, so that a missing expiry reads as a
> provider fact rather than something the dashboard forgot to check.

> **US-04** — As a user who trusts this dashboard's evidence-first contract, I
> want a reset with no reported date to stay "unavailable" and zero resets to
> show no headline at all, so that no date is ever guessed from grant times, the
> 30-day pattern, or usage history.

> **US-05** — As a user whose reset reading is old or whose last Codex read
> failed, I want the headline to inherit that stale or source-error state with
> the original capture age, so that an old expiry never reads as fresh.

> **US-06** — As a user viewing another machine on the same account in the
> multi-host view, I want the same headline and the same "not reported"
> disclosure for that host, so that peers never show less honesty than the local
> machine and an unknown value degrades safely.

## Functional Requirements

### A. Headline next expiry (Codex credits group, `public/app.js`)

> **FR-01** — The Codex "credits & resets" group shall render a "Next expiry"
> sub-block as the first content of the group, before the "Credit balance"
> sub-block, whenever the reset-credit display state is `available`, `partial`,
> `stale`, or `source-error` and at least one future expiration instant is
> present.

> **FR-02** — The headline shall show the soonest future expiration as (a) an
> absolute date in the browser's timezone, formatted exactly as the per-reset
> list formats its dates, marked up as a `<time>` element whose `datetime`
> attribute is the canonical ISO instant, and (b) a countdown phrased "expires
> in [duration]" using the same duration formatter the per-reset list uses. When
> two or more resets share the identical soonest instant, the countdown shall
> read "[N] resets expire in [duration]" (the list's grouping rule).

> **FR-03** — The headline shall display the reset reading's capture age (the
> same "updated [age] ago" phrasing the group already uses) derived from the
> reset-credit block's `capturedAt`, and shall display the reset state pill when
> the state is `stale` (pill text includes the age) or `source-error`. The
> stale / source-error explanatory notes already shown in the Reset credits
> sub-block shall not be duplicated in the headline.

> **FR-04** — The headline sub-block shall be omitted entirely (no heading, no
> placeholder dash, no "—" dressed as a date) when the reset display state is
> `zero`, `unsupported`, or `malformed`. The Reset credits sub-block already
> explains each of those states.

> **FR-05** — When the available reset count is greater than zero but no
> expiration instant is present (every date unavailable), the headline shall
> render with its heading, the `partial` state pill, the capture age, and a
> value reading "not reported", with no date, no `<time>` element, and no
> countdown. The existing "[N] expiration dates are unavailable" note in the
> Reset credits sub-block remains the authoritative count disclosure.

> **FR-06** — The headline shall be recomputed on the existing render tick so
> the countdown is live; an instant that has passed since the last fetch shall
> no longer be shown (the next soonest future instant takes over, or the block
> follows FR-04 / FR-05 if none remains). A past instant shall never be shown as
> the next expiry.

> **FR-07** — In the multi-host view, the headline shall be derived from the
> already-selected reset-credit block of the collapsed same-account record (the
> newest valid capture, chosen by the existing rule) and shall therefore be
> identical for every host sharing that account. The selection and merge rules
> shall not change; different accounts shall never merge.

### B. Expires-before-weekly-reset note

> **FR-08** — The headline shall include one note stating that the soonest
> reset credit expires before the Codex weekly window resets, including the
> weekly reset's countdown, when and only when all of the following hold: the
> soonest expiration instant is present; the Codex `seven_day` window's
> provider `resetsAt` is present, parseable, in the future, and resolves as
> current under the existing provider-reset currency rule (reading not `stale`
> by freshness band and no `stale-reading` diagnostic); the reset display state
> is `available` or `partial`; and the expiration instant is strictly earlier
> than the weekly reset instant.

> **FR-09** — No note shall be rendered when any FR-08 condition fails: the
> weekly window is omitted from the response, its `resetsAt` is missing or
> invalid or in the past, the reading is not current, the reset state is
> `stale` or `source-error`, or the expiry is at or after the weekly reset.
> Nothing about the weekly reset shall be inferred, defaulted, or carried over
> from another window, host, or configured schedule (configuration is never
> eligible for Codex).

> **FR-10** — The note shall use the grouped quantity from FR-02 ("[N] resets
> expire before…" when applicable), shall be plain readable text that may wrap
> onto multiple lines, and shall never be truncated, clamped, or hover-only.
> The note applies to the soonest expiry only; the per-reset list is not
> annotated.

### C. Server-stated expiry disclosure on the credit standing

> **FR-11** — Every non-unsupported credit-standing block produced for Codex
> (`status` of `unlimited`, `available`, `none`, or `stale`) shall carry an
> `expiry` sub-object with an enum `status`. Today the producer emits
> `{ status: 'not-reported' }`, because the provider's credit shape carries no
> expiry field. The enum, the sub-object shape, and its factory shall live once
> in the shared account-credits module that both the local producer and the
> peer normalizer import.

> **FR-12** — If a future Codex response carries a credit-expiry instant, the
> producer shall emit `{ status: 'reported', expiresAt: <ISO> }` with the value
> normalized to canonical ISO at ingest. An unparseable value, or an instant not
> strictly in the future at read time, shall produce `{ status: 'not-reported' }`.
> The producer shall never default a missing or unparseable instant to the
> current time.

> **FR-13** — Unsupported credit blocks (Claude's `not-reported`, Codex
> `never-observed`, the peer `peer-omitted` block, and a Codex block aged past
> the 24-hour hard cap) shall carry no `expiry` key; the existing fixed four-key
> unsupported shape is unchanged.

> **FR-14** — The Codex "Credit balance" sub-block shall render one expiry line.
> For `not-reported` it reads "Expiry · not reported by Codex". For `reported`
> it shows the absolute date (same formatter as FR-02) and "expires in
> [duration]". When the `expiry` key is absent or its `status` is not an own key
> of the client copy table, the line shall be omitted; the client shall never
> render a raw status code and shall never substitute a guessed cause.

> **FR-15** — The Claude "Credit balance" sub-block shall remain exactly as
> shipped: its reason-coded "Claude Code does not report a usage-credit balance"
> copy and Claude Usage pointer, with no expiry line and no expiry key.

### D. Peer path (`src/hosts.js`)

> **FR-16** — The peer credit normalizer shall whitelist the `expiry` sub-fact
> on fresh and stale peer blocks: a `status` checked by own-key / set membership
> against the shared enum; `reported` accepted only with a parseable `expiresAt`
> that re-normalizes to ISO and is strictly in the future, otherwise degraded to
> `not-reported`; an unknown `status` or an absent `expiry` (an older llmdash
> peer) degraded to `{ status: 'not-reported' }`. Peer unsupported blocks shall
> carry no `expiry` key (FR-13).

> **FR-17** — A `normalizePeerState`-path test shall ship in the same change,
> proving: a peer `not-reported` expiry survives; a valid future `reported`
> expiry survives with canonical ISO; a past or unparseable `reported` instant
> degrades to `not-reported`; an unknown status degrades to `not-reported`; an
> absent key degrades to `not-reported`; a peer unsupported block gains no
> `expiry` key; and the normalized output drives the same headline and
> disclosure rendering as a local block.

### E. Invariants, guards, and disclosure

> **FR-18** — The Reset credits sub-block shall render byte-for-byte as before
> in every state (`available`, `zero`, `partial`, `stale`, `source-error`,
> `unsupported`, `malformed`): the existing pre-change golden
> (`tests/fixtures/reset-credits-html.json`, rendered under a fixed clock with
> only the locale date placeholdered) shall pass unmodified. The fixture file
> shall not be regenerated.

> **FR-19** — The primary gauges and their pacing rows, the `/api/hosts` route
> and its top-level contract, `computeMultiBadge`, and every menu-bar badge
> output shall be unchanged. The only wire change is the nested
> `accountLimits.credits.expiry` key inside the already-whitelisted credits
> block of `/api/state` (and therefore of the peer state that `/api/hosts`
> re-serves). No menu-bar source file is edited.

> **FR-20** — README and `PRODUCT_CONTEXT.md` shall state what credit-expiry
> evidence each provider reports: Codex reports per-reset expirations only; the
> Codex balance carries no expiry and is disclosed as not reported; Claude
> reports neither credits nor expiry on any sanctioned local channel.

> **FR-21** — Every new status or reason shall map to copy through own-key
> lookup tables only; every rendered date label, duration, age, and note shall
> pass through the existing HTML escaper; no provider string reaches the DOM
> unescaped, and no code reaches it raw.

## Non-Functional Requirements

> **NFR-01 — Performance:** The feature is a pure presentation regroup over
> existing `hostViews` / `accountLimits` data plus one constant sub-fact from the
> existing poller-owned producer. It shall add no polling, no subprocess, no
> SQLite read or write, and no work on any HTTP request path; readiness timing
> is unaffected.

> **NFR-02 — Security:** All new rendered text is escaped; expiry instants are
> validated and normalized at both ingest boundaries (local producer and peer
> normalizer) with the shared enum as the single definition; peer input bounds
> (128 expirations, 1,000,000 count, 64-code-point balance) are unchanged. No
> new outbound request, credential, or mutation path is introduced.

> **NFR-03 — Accessibility:** The headline date is a `<time>` element with a
> machine-readable `datetime`; the sub-block has a heading in the group's
> existing heading hierarchy; state is conveyed by pill text, never color alone;
> the note is ordinary readable DOM text.

> **NFR-04 — Compatibility (mobile):** The headline, its note, and the new
> balance expiry line shall fit a 320px viewport and common phone widths (390px)
> without widening the document or body or introducing horizontal scroll; long
> text wraps.

> **NFR-05 — Honesty:** No rendered expiry is derived from `grantedAt`, the
> observed 30-day grant-to-expiry pattern, usage history, plan, or billing
> period; freshness of the headline is the reset reading's freshness; the
> credit-balance block keeps its own separate age clock.

## Out of Scope
- Codex credit-balance expiry as a value: the provider's `credits` shape has no
  expiry field; the `expiry` sub-fact states this absence and nothing is inferred
  from the balance, plan, or billing period.
- Any Claude credit expiry or balance: not present on the statusline
  `rate_limits` payload or the `/usage` pane; Claude Code's internal extra-usage
  fields (`overageResetsAt` and relatives) come from API response headers and are
  not reachable through a sanctioned local channel.
- Retaining `grantedAt` or deriving validity periods from the 30-day pattern
  (DECISIONS.md 2026-07-30 excludes grant times; revisiting is a separate owner
  call).
- Prepaid console balances and their expiries (excluded 2026-10-01).
- Alerts or notifications on an approaching expiry (Limit alerts, roadmap item 1,
  may later read `resetCredits.expirations` and `credits.expiry` but must respect
  their states).
- Menu-bar badge changes of any kind, including a badge credits or expiry row.
- Persistence: no new snapshots; expirations remain bounded in-memory account
  facts with the existing TTL / 24-hour hard cap.
- Changes to `/api/hosts` routing or top-level contract, the primary gauges,
  their pacing rows, or `computeMultiBadge`.
- Reading `rateLimitsByLimitId`, `spendControlReached`, `individualLimit`, or
  `rateLimitUpsell`.
- Annotating individual rows of the per-reset list (the list stays golden-pinned;
  the before-weekly-reset note applies to the headline only).
- Regenerating or loosening the existing reset-credits golden fixture.

## Open Questions

1. **Where does the headline live: its own sub-block above "Credit balance", or
   a line inside the Credit balance block?**
   Default: its own sub-block, first in the group (FR-01). Reset expiry and
   credit balance are two separately labeled facts (2026-07-30); folding one
   into the other would blur them.

2. **An older peer that sends a fresh/stale credit block with no `expiry` key:
   degrade to `not-reported`, or introduce a distinct `peer-omitted` expiry
   status?**
   Default: `not-reported` (FR-16), as the brief specifies. The statement is
   true today for every Codex host regardless of version, and a third status
   would add copy for a transitional case. Revisit only if a `reported` instant
   ever exists in production.

3. **A future `reported` instant that is already in the past: show it as
   expired, or degrade to `not-reported`?**
   Default: degrade to `not-reported` (FR-12, FR-16). An expiry that has passed
   is not a current expiry, and the credit standing itself (`none`, `stale`)
   carries the current state. A distinct `expired` status is deferred until a
   provider reports the field.

4. **Should the before-weekly-reset note consider every listed reset, or only
   the soonest?**
   Default: soonest only, on the headline (FR-10). The list is golden-pinned
   and the soonest is the one the user must act on first.

5. **Heading and line copy ("Next expiry", "Expiry · not reported by Codex").**
   Default: as written in FR-01 and FR-14. The Designer may refine wording;
   requirement IDs and behavior are unaffected by copy changes.

## Success Metrics

| ID | What's Being Verified | Pass Condition |
|---|---|---|
| QA-01 | Headline position and presence (FR-01) | With state `available` and two future expirations, the Codex group's first sub-block is the headline; it appears before the "Credit balance" heading and before the "Reset credits" heading. |
| QA-02 | Headline date and countdown (FR-02) | Under a fixed clock with the soonest instant 1h ahead, the headline contains a `<time datetime="<canonical ISO>">` whose text equals the list's formatted date for that instant, and the text "expires in 1h 0m". |
| QA-03 | Grouped identical instants (FR-02) | Two expirations with the identical instant render "2 resets expire in [duration]" in the headline. |
| QA-04 | Capture age and state pill (FR-03) | Fresh state: headline shows "updated 3m ago" and no pill. `stale` state (capture 6h 41m old): headline shows the stale pill including the age. `source-error` (via `codex-cmd-failed` diagnostic): headline shows the "source error" pill. In both cases the "last good reset reading is old" / "account read failed" sentences appear once in the group, inside the Reset credits sub-block only. |
| QA-05 | Omitted for zero / unsupported / malformed (FR-04) | For each of those three states the group contains no headline heading, no headline `<time>`, and no "—" placeholder; the Reset credits sub-block renders its existing copy. |
| QA-06 | Count without dates (FR-05) | `partial` with `availableCount: 2` and `expirations: []` renders the headline heading, the `partial` pill, the capture age, and "not reported", with no `<time>` and no "expires in". |
| QA-07 | Live countdown drop-off (FR-06) | With expirations at +1h and +26h, advancing the controlled clock past the first instant and re-rendering shows the +26h instant as the headline with no reference to the passed instant. |
| QA-08 | Same-account collapse (FR-07) | Two hosts on one account with reset captures 10 minutes apart render one headline derived from the newer capture; two hosts on different accounts render two independent headlines. |
| QA-09 | Before-weekly-reset note present (FR-08) | Soonest expiry at +1d, `seven_day.resetsAt` at +5d, freshness band fresh, no diagnostic, state `available`: the headline contains the note naming the weekly reset countdown ("in 5d 0h"). |
| QA-10 | Note absent on each failed condition (FR-09) | Each of the following renders no note: `seven_day` null; `resetsAt` missing; `resetsAt` in the past; expiry at +6d with weekly reset at +5d; freshness band stale; `stale-reading` diagnostic; reset state `stale`; reset state `source-error`. |
| QA-11 | Note wraps and uses grouping (FR-10) | The note is a block-level text element with no `text-overflow`, `white-space: nowrap`, or `title`-only content, and reads "2 resets expire before…" when the soonest instant is shared by two resets; no list item in the Reset credits sub-block contains the note. |
| QA-12 | Producer emits the sub-fact (FR-11) | `codexCredits()` for `unlimited`, `available`, `none`, and `stale` blocks returns `expiry` deep-equal to `{ status: 'not-reported' }`; the enum and factory are exported from `src/account-credits.js` and imported by both `src/codex-limits.js` and `src/hosts.js`. |
| QA-13 | Forward-compatible normalization (FR-12) | Driving the producer's expiry path with a future epoch/ISO yields `{ status: 'reported', expiresAt: <canonical ISO> }`; with an unparseable string or a past instant it yields `{ status: 'not-reported' }`; in no case does `expiresAt` equal the current time. |
| QA-14 | Unsupported blocks carry no key (FR-13) | Claude `not-reported`, Codex `never-observed`, peer `peer-omitted`, and a Codex block aged past 24h each have exactly the keys `status`, `reason`, `balance`, `capturedAt`; the existing four-key shape test still passes. |
| QA-15 | Balance block expiry line (FR-14) | Codex `available` block with `not-reported` renders "Expiry · not reported by Codex"; with `reported` at +30d renders the formatted date and "expires in 30d 0h"; with `expiry` absent or `status: 'constructor'` renders no expiry line and no raw code text. |
| QA-16 | Claude block pinned (FR-15) | The Claude credit sub-block HTML equals its pre-change rendering exactly for the `not-reported` reason, and contains no "Expiry" text. |
| QA-17 | Peer whitelist (FR-16) | `normalizeCredits` passes through `not-reported`; accepts a valid future `reported` with canonical ISO; degrades past / unparseable `reported`, unknown status, and absent key to `{ status: 'not-reported' }`; returns no `expiry` key on unsupported blocks. |
| QA-18 | normalizePeerState path and render (FR-17) | A test in `tests/hosts-client.test.js` or `tests/hosts-account.test.js` runs a full peer state through `normalizePeerState`, asserts each FR-16 outcome on `accountLimits.credits.expiry`, and renders the normalized state to show the headline and the "not reported by Codex" line identical to a local block. |
| QA-19 | Reset credits list golden (FR-18) | The existing golden test passes against `tests/fixtures/reset-credits-html.json` with the fixture's content unchanged (`git diff` on the fixture is empty). |
| QA-20 | Untouched surfaces (FR-19) | Every existing badge, `computeMultiBadge`, gauge, pacing, `/api/hosts` contract, and parity test passes; `git diff --stat` shows no change under the menu-bar badge sources or their fixtures; `/api/state` differs from the pre-change payload only by `accountLimits.credits.expiry`. |
| QA-21 | Disclosure (FR-20) | README and `PRODUCT_CONTEXT.md` each contain a statement that Codex reports per-reset expirations only, that the Codex balance expiry is not reported, and that Claude reports no credits and no expiry. |
| QA-22 | Own-key lookups and escaping (FR-21) | A credits block with `expiry.status` set to `__proto__`, `toString`, and `constructor` renders no expiry line and throws nothing; an expiration string containing `<` or `"` cannot produce an unescaped character in the headline or `datetime` attribute (invalid instants are dropped before render). |
| QA-23 | No request-path or poll work (NFR-01) | No new import or call in `src/server.js`, the poller, or the Codex spawn path; the headline is computed inside the existing render function from `hostViews` / `accountLimits` only. |
| QA-24 | Mobile widths (NFR-04) | With the headline, note, and balance expiry line all populated (and the grouped "2 resets" variant), document and body width equal the viewport at 320px and 390px with no horizontal scroll; the note wraps. |
| QA-25 | Accessibility (NFR-03) | The headline sub-block has a heading at the same level as "Credit balance"; the date is a `<time>` with `datetime`; stale / source-error state is readable as text, not color alone. |
| QA-26 | No inference anywhere (NFR-05) | Code search shows no read of `grantedAt` / `granted_at`, no 30-day constant applied to an expiry, and no expiry derived from `capturedAt`, usage, plan, or billing data; a reset with no `expiresAt` is counted only in "[N] expiration dates are unavailable". |
