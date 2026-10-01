# PRD — Available API Credits
**Feature:** available-api-credits
**Date:** 2026-10-01
**Stage:** 2 — The Planner
**Source:** strategic-brief.md (approved)

## Feature Overview
Promote Codex's already-observed usage-credit standing (status and the provider's
opaque balance, with its capture age) from the buried Codex-insights account row
into the account story beside Codex's reset credits, and give Claude an honest,
reason-coded "not reported" credit row — carried on the existing per-tool
`accountLimits` object in `/api/state`, normalized on the peer path, and shown
identically for local and peer hosts.

## User Stories

> **US-01** — As the single owner-user near a Codex window limit, I want to see
> whether I have a paid credit balance to continue on, right beside the reset
> information, so that I can decide whether to keep working without opening Codex.

> **US-02** — As the owner-user reading the Claude side, I want an explicit
> statement that Claude Code does not report a credit balance (with a pointer to
> the Claude Usage page), so that I know llmdash looked and the channel lacks it,
> rather than wondering whether a figure is missing.

> **US-03** — As the owner-user, I want reset credits, the Opus "Reset for free"
> offer, and the credit balance to read as three clearly separate facts, so that I
> never mistake one allowance for several budgets.

> **US-04** — As the owner-user checking from my phone, I want the credit rows to
> fit a 320px viewport without horizontal scrolling, so that the standing is
> readable where I actually check it.

> **US-05** — As the owner-user running the multi-host view, I want a peer host to
> show the same credit standing its own dashboard would show (or an honest
> unavailable state), so that a monitoring-station Mac does not understate or
> invent another machine's credit position.

> **US-06** — As the owner-user, I want an aged or absent credit observation to
> read as stale (with its age) or unavailable, never as zero or as fresh, so that
> I trust the number when it is shown.

## Functional Requirements

### A. Wire contract — `accountLimits.credits`

> **FR-01** — The app shall extend each tool object's `accountLimits`
> (scope `account-wide`) in `/api/state` with a `credits` object carrying exactly:
> `status` (enum: `unlimited` | `available` | `none` | `stale` | `unsupported`),
> `balance` (string or `null`), `capturedAt` (canonical ISO string or `null`),
> `lastStatus` (present only when `status` is `stale`; enum: `unlimited` |
> `available` | `none`), and `reason` (present only when `status` is
> `unsupported`; enum: `never-observed` | `not-reported` | `peer-omitted`).
> No other fields are carried.

> **FR-02** — The existing `accountLimits.scope` and `accountLimits.resetCredits`
> fields, their types, enum values, and bounds shall be unchanged by this feature.

> **FR-03** — The Codex `credits` block shall be derived solely from the account
> facts already observed from the live `codex app-server` rate-limit response
> (the existing `unlimited` / `hasCredits` / `balance` facts). The app shall add
> no new poll, no new subprocess, and shall do no credit-related work on the HTTP
> request path beyond reading the already-cached facts.

> **FR-04** — Codex standing precedence shall be: `unlimited` when the observed
> `unlimited` flag is `true`; otherwise `available` when `hasCredits` is `true`;
> otherwise `none` when `hasCredits` is `false`. `hasCredits: false` is an
> explicit `none`, never an absence.

> **FR-05** — When neither `unlimited` nor `hasCredits` has been observed, the
> Codex block shall be `status: 'unsupported'`, `reason: 'never-observed'`,
> `balance: null`, `capturedAt: null` — even if a balance string has been
> observed. A balance without a standing is not shown.

> **FR-06** — `capturedAt` shall be the observation time of the newest fact that
> contributes to the block (standing flag or balance). It shall never be
> defaulted to "now" and never restamped by a later poll that did not carry the
> fact.

> **FR-07** — A Codex block whose newest contributing observation is within the
> existing account-fact TTL (the same TTL that governs reset credits and the plan
> label) shall carry the fresh standing from FR-04. Past that TTL but younger
> than 24 hours it shall carry `status: 'stale'`, `lastStatus` set to the
> standing that was observed, the last-observed `balance`, and the original
> `capturedAt`. At or past 24 hours the observation is cleared and the block
> reverts to FR-05.

> **FR-08** — When the provider response omits the `credits` object (a sparse
> update), the app shall retain the last good credits observation and its
> original `capturedAt` (aging per FR-07). When a plan change or an unknown plan
> clears the Codex account facts, the credits block shall also clear to FR-05.

> **FR-09** — When Codex limits come only from the rollout-file fallback (live
> app-server unavailable), the app shall not read credits from the fallback; the
> last good credits block simply ages through FR-07.

### B. Balance handling

> **FR-10** — The balance shall be stored and transmitted only when the provider
> value is a string. Before storing, the app shall strip Unicode control, format,
> line-separator, and paragraph-separator characters, trim surrounding
> whitespace, and truncate to at most 64 code points. A value that is empty
> after stripping shall be stored as `null`. A non-string value shall be ignored
> (the prior observation, if any, is retained).

> **FR-11** — The app shall never numerically coerce, sum, price, convert, add a
> currency symbol to, or compare the balance. The literal string `"0"` shall be
> carried and displayed as `0`, never hidden and never treated as "no credits".

### C. Claude block

> **FR-12** — The Claude tool's `accountLimits.credits` shall always be
> `{ status: 'unsupported', reason: 'not-reported', balance: null,
> capturedAt: null }` regardless of statusline or `/usage` evidence. No Claude
> credit figure shall be inferred from any source.

### D. Peer path (`/api/hosts`)

> **FR-13** — The peer normalizer shall whitelist the `credits` block: `status`
> must be one of the five enum values; `lastStatus` (when `status` is `stale`)
> must be one of the three fresh standings; `reason` (when `status` is
> `unsupported`) must be one of the three reason values; `balance` must be a
> string (re-stripped and re-bounded per FR-10) or `null`; `capturedAt` must
> parse to a finite time and be re-emitted as canonical ISO. Any `stale` block
> lacking a valid `lastStatus` or `capturedAt`, and any fresh block lacking a
> valid `capturedAt`, shall normalize to `unsupported` / `peer-omitted`.

> **FR-14** — A peer tool whose `accountLimits` lacks a `credits` block (an older
> llmdash), or whose `status` is not in the enum, shall normalize to
> `{ status: 'unsupported', reason: 'peer-omitted', balance: null,
> capturedAt: null }`. An unknown `reason` on an `unsupported` block shall
> normalize to `peer-omitted`.

> **FR-15** — In the same peer-normalizer change, `stale` shall be added to the
> accepted reset-credit statuses, and a `stale` reset-credit block that is
> otherwise valid shall be re-emitted with `status: 'stale'` preserved (its count
> and expirations still re-filtered by the local clock as today), rather than
> being recomputed to a fresh status or dropped to `unsupported`.

> **FR-16** — The local host's own tool objects in `/api/hosts` shall carry the
> same `credits` block the local `/api/state` carries.

### E. Multi-host account collapse

> **FR-17** — When several hosts collapse into one account, the displayed credits
> block shall be the member block with the newest valid `capturedAt` among members
> whose `status` is not `unsupported`; credits shall be selected by their own
> `capturedAt`, independently of which member supplies reset credits or model
> caps. If no member has a non-`unsupported` block, the representative member's
> `unsupported` block (with its `reason`) is shown.

> **FR-18** — Credit blocks from different accounts shall never be merged,
> compared, or summed; each account group renders its own block.

### F. Dashboard rendering — Codex

> **FR-19** — The Codex supplementary group title shall change from
> "Codex reset credits" to "Codex credits & resets", and the group shall contain
> two visibly labelled sub-blocks in this order: "Credit balance" then
> "Reset credits". Reset-credit count, state pill, expiration list, and all its
> existing states and copy shall be unchanged.

> **FR-20** — The "Credit balance" sub-block shall map `status` to copy through an
> own-key lookup only: `unlimited` → "Unlimited"; `available` → "Credits
> available"; `none` → "No credits"; `stale` → a stale state pill carrying the
> capture age plus the `lastStatus` copy prefixed "last reading:"; `unsupported`
> → "Unavailable" with the reason copy from FR-22. A `status` not in the table
> shall render as "Unavailable" with no reason copy, and the raw code shall never
> appear in the DOM.

> **FR-21** — When `balance` is a non-null string, the sub-block shall show a row
> labelled "Provider balance" with the HTML-escaped balance, bidi-isolated from
> adjacent text, followed by the fixed note "provider's own figure; not
> converted". When `balance` is `null` and the status is `unlimited`,
> `available`, `none`, or `stale`, the row shall read "Provider balance · not
> reported". When `status` is `unsupported`, no balance row is shown.

> **FR-22** — Reason copy (own-key lookup): `never-observed` → "No credit standing
> has been observed from Codex yet."; `peer-omitted` → "This host did not report a
> credit standing."; `not-reported` → "Claude Code does not report a usage-credit
> balance." (used by FR-25). An unknown reason renders no reason sentence.

> **FR-23** — Whenever `capturedAt` is non-null, the sub-block shall show the
> capture age as readable text (same age formatting as the reset-credit rows).
> When the tool's `limitsDiagnostic.reason` is `codex-cmd-failed` or `no-reading`
> and a credit standing is shown, the sub-block shall add the note "The latest
> Codex account read failed. Showing the last good credit reading." When the
> status is `stale`, it shall add "The last good credit reading is old; the
> balance may have changed."

> **FR-24** — The credit-balance sub-block shall contain no reset-credit count,
> no Opus offer copy, and no total that combines credits with any other
> allowance; the three facts (credit balance, reset credits, Claude offer) carry
> three distinct headings.

### G. Dashboard rendering — Claude

> **FR-25** — The Claude supplementary group shall add a "Credit balance"
> sub-block rendering the `unsupported` / `not-reported` state: "Unavailable"
> plus the FR-22 reason sentence, followed by the pointer text "Check in Claude
> Usage".

> **FR-26** — Each rendered supplementary section shall contain exactly one
> anchor to the claude.ai Usage page: when the Claude offer block is rendered in
> that section, the FR-25 pointer is plain text referring to that existing link;
> when the offer block is absent (for example, a peer-only account), the FR-25
> pointer is itself the single link (`rel="noopener noreferrer"`).

### H. Insights de-duplication

> **FR-27** — The Codex-insights account row shall render only "Account-wide" and
> the plan label (or "Plan unavailable"); the credit status and balance fragments
> shall be removed from that row.

> **FR-28** — The `/api/codex-insights` `account` object shall no longer carry a
> `credits` sub-object; `accountLimits.credits` on `/api/state` is the single
> wire home for the credit standing. The plan fields in that `account` object
> are unchanged.

### I. Health / disclosure

> **FR-29** — No new startup health line is required, because the feature adds no
> data source; the existing Codex command health line already names the source
> whose absence makes credits unavailable. The README's dashboard description
> shall mention the credit standing row and the Claude "not reported" state.

## Non-Functional Requirements

> **NFR-01 — Performance:** No credit-related subprocess, poll, file read, or
> computation beyond reading in-memory facts occurs on any HTTP request; the
> poller cadence and the app-server call count are unchanged.

> **NFR-02 — Security (output):** Every externally-sourced string in the new rows
> (balance, peer-supplied values) is HTML-escaped at render; status and reason
> codes are mapped through own-key (`hasOwnProperty` / null-prototype) tables and
> never interpolated raw; no untrusted value reaches an inline style.

> **NFR-03 — Security (ingest):** Control/format/line-separator stripping and
> the 64-code-point bound are applied at both the local ingest boundary and the
> peer ingest boundary, so a hostile peer cannot bypass them; the balance is
> bidi-isolated at render so it cannot visually reorder neighbouring account
> facts.

> **NFR-04 — Honesty:** No state path produces a fabricated zero, a "fresh" label
> on an aged observation, or a credit figure for Claude; stale, unavailable, and
> explicit-none remain visually distinct.

> **NFR-05 — Accessibility:** New rows are ordinary readable DOM (no hover-only or
> `title`-only disclosure), sub-block headings are real heading elements inside
> the labelled group, state pills carry their meaning as text, and all copy meets
> the existing contrast tokens.

> **NFR-06 — Mobile:** With the longest permitted balance (64 code points, no
> spaces) and a stale pill present, the supplementary section introduces no
> horizontal document or body overflow at 320px, 375px, 390px, and 430px; long
> values wrap rather than clip or truncate.

> **NFR-07 — Compatibility:** The menu-bar badge title, dropdown, `hosts.conf`
> handling, and `computeMultiBadge` output are byte-for-byte unchanged; the
> `/api/hosts` and `/api/state` payloads change only by the additive
> `accountLimits.credits` block and the removal in FR-28.

> **NFR-08 — Test discipline:** The peer-normalizer whitelist change ships in the
> same commit as a `normalizePeerState`-path test covering the credits block and
> the `stale` reset-credit status; all new logic is covered by `node:test` with
> zero added dependencies.

## Out of Scope
- Prepaid API console balances (Anthropic Console, OpenAI Platform) — require
  API keys and credentialed outbound calls, excluded by the founding brief and
  the credential-free peer-GET rule.
- Any Claude credit value, from any source (statusline `rate_limits`, `/usage`
  pane, or inference). A future "extra usage" pane line is a separate parser
  feature failing loudly as `parse-failed`.
- Interpreting the Codex balance: no unit, currency, conversion, pricing,
  summing, trend, or comparison with spend or API-equivalent value.
- Reading `credits` from the Codex rollout-file fallback path.
- Any change to the menu-bar badge title, dropdown, Legend, or `computeMultiBadge`;
  a dropdown credits row is a horizon item.
- Persisting credit observations (no snapshots, no SQLite rows, no trend chart).
- Alerts, thresholds, or notifications on credit standing (Limit alerts).
- Showing a Codex credit balance when only a balance string, with no standing
  flag, has ever been observed (treated as unsupported per FR-05).
- Changing reset-credit semantics, copy, or states beyond passing `stale` through
  the peer normalizer.
- A second claude.ai Usage link in the same supplementary section.

## Open Questions

1. **Should a `stale` credits block disclose the last-observed standing
   (`lastStatus`) or only "stale"?**
   Default: disclose it (FR-07, FR-20), mirroring how stale reset credits keep
   their count; the stale pill plus the "last reading:" prefix keeps it from
   reading as current. The brief's five-value enum is kept for `status`;
   `lastStatus` is an additive, whitelisted field.

2. **Should the `/api/codex-insights` payload drop `account.credits` (FR-28) or
   only the client stop rendering it?**
   Default: drop it from the payload, honouring the brief's "single wire home"
   decision; existing account-facts tests are updated to the new shape.

3. **Should a numeric (non-string) provider balance be stringified?**
   Default: no — ignored at ingest per FR-10 (existing behaviour, no numeric
   coercion). Revisit only if Codex is observed sending a number.

## Success Metrics

| ID | What's Being Verified | Pass Condition |
|---|---|---|
| QA-01 | `credits` block shape (FR-01) | `/api/state` Codex and Claude tools each carry `accountLimits.credits` with only `status`, `balance`, `capturedAt`, and (conditionally) `lastStatus` / `reason`; `status` is one of the five enum values. |
| QA-02 | Reset-credits contract unchanged (FR-02) | A snapshot of `accountLimits.resetCredits` before and after the change is deep-equal for identical fixtures. |
| QA-03 | No new work (FR-03, NFR-01) | Spawn/poll counts over a fixed poller run are identical pre/post; a request to `/api/state` triggers no subprocess spawn and no file read for credits. |
| QA-04 | Standing precedence (FR-04) | Fixtures `{unlimited:true,hasCredits:false}` → `unlimited`; `{unlimited:false,hasCredits:true}` → `available`; `{unlimited:false,hasCredits:false}` → `none`. |
| QA-05 | Never observed (FR-05) | Fresh process, no app-server response yet → Codex block is `unsupported` / `never-observed`, `balance:null`, `capturedAt:null`. |
| QA-06 | Balance without standing (FR-05) | Response carrying only `credits.balance:"5"` → block stays `unsupported` / `never-observed` with `balance:null`. |
| QA-07 | `capturedAt` provenance (FR-06) | A sparse follow-up poll without `credits` leaves `capturedAt` equal to the earlier observation time (not now). |
| QA-08 | Fresh → stale → cleared (FR-07) | With a mocked clock: at TTL−1s status is the fresh standing; at TTL+1s status is `stale`, `lastStatus` equals the prior standing, `balance` and `capturedAt` unchanged; at 24h status is `unsupported` / `never-observed`. |
| QA-09 | Plan change clears (FR-08) | After a recognised plan change or an unknown plan value, the credits block is `unsupported` / `never-observed`. |
| QA-10 | Rollout fallback (FR-09) | With app-server failing and rollout fallback active, the block never gains a new `capturedAt`; it ages per QA-08. |
| QA-11 | Balance sanitising (FR-10) | Balance `"‮12​.50\n"` is stored as `"12.50"`; a 100-code-point balance is stored as its first 64 code points; `"  "` stores `null`; the number `12.5` leaves the prior balance in place. |
| QA-12 | Explicit zero (FR-11) | Balance `"0"` renders the text `0` in the Provider balance row; no currency symbol, no numeric formatting. |
| QA-13 | Claude block (FR-12) | With a fresh Claude statusline reading and model caps present, Claude's `credits` is exactly `{status:'unsupported', reason:'not-reported', balance:null, capturedAt:null}`. |
| QA-14 | Peer whitelist (FR-13) | `normalizePeerState` fixtures: valid fresh block passes through with canonical ISO; `stale` without `lastStatus` → `unsupported`/`peer-omitted`; fresh block without `capturedAt` → `unsupported`/`peer-omitted`; peer balance with control chars is re-stripped and bounded to 64 code points. |
| QA-15 | Peer omitted / unknown status (FR-14) | A peer tool lacking `credits`, or with `status:'bogus'`, or `unsupported` with `reason:'bogus'` → `{status:'unsupported', reason:'peer-omitted', balance:null, capturedAt:null}`. |
| QA-16 | Stale reset credits pass through (FR-15) | A peer `resetCredits` with `status:'stale'`, valid count and `capturedAt` is re-emitted with `status:'stale'` and the locally re-filtered count; the dashboard shows the stale pill for that host. |
| QA-17 | Local host in `/api/hosts` (FR-16) | The self host's Codex tool in `/api/hosts` carries a `credits` block deep-equal to `/api/state`'s. |
| QA-18 | Account collapse selection (FR-17) | Two same-account members with credits captured at T and T+60s show the T+60s block; a member with newer reset credits but older credits does not override the credits choice; all-unsupported members show the representative's `reason`. |
| QA-19 | No cross-account merge (FR-18) | Two different-account members render two groups, each with its own credits block; no group shows the other's balance. |
| QA-20 | Group title and order (FR-19) | Codex group heading text is "Codex credits & resets"; sub-headings appear in DOM order "Credit balance" then "Reset credits"; reset-credit HTML for each existing state is unchanged versus the pre-feature fixture output. |
| QA-21 | Status copy and own-key lookup (FR-20) | `unlimited` → "Unlimited"; `available` → "Credits available"; `none` → "No credits"; `stale` → pill containing "stale" and an age, plus "last reading: Credits available" (for `lastStatus:'available'`); `status:'constructor'` → "Unavailable" and the string "constructor" absent from the DOM. |
| QA-22 | Balance row (FR-21) | Non-null balance renders a "Provider balance" row whose value is wrapped in a bidi-isolating element and followed by "provider's own figure; not converted"; `balance:null` with `status:'available'` renders "Provider balance · not reported"; `unsupported` renders no balance row. |
| QA-23 | Reason copy (FR-22) | `never-observed`, `peer-omitted`, and `not-reported` each render their exact sentence; an unknown reason renders "Unavailable" with no reason sentence. |
| QA-24 | Age and diagnostic notes (FR-23) | Non-null `capturedAt` renders an age string; `limitsDiagnostic.reason:'codex-cmd-failed'` with an `available` block adds the "latest Codex account read failed" note; `stale` adds the "reading is old" note. |
| QA-25 | Three distinct facts (FR-24) | The credit-balance sub-block contains no digit sequence equal to the reset-credit count label and no "Reset for free" text; the section contains three distinct headings for balance, reset credits, and offer (when present). |
| QA-26 | Claude row (FR-25) | The Claude group contains a "Credit balance" sub-heading, "Unavailable", the sentence "Claude Code does not report a usage-credit balance.", and the text "Check in Claude Usage". |
| QA-27 | Single Usage link (FR-26) | With the offer block rendered, the supplementary section contains exactly one `href="https://claude.ai/settings/usage"` (in the offer); without it (peer-only account), exactly one such href, located in the Claude credit row. |
| QA-28 | Insights row de-duplicated (FR-27) | Rendered `insightAccountHtml` contains "Account-wide" and the plan label only; "Credits available", "No credits", "Unlimited", and "Balance" are absent for every fixture. |
| QA-29 | Insights payload (FR-28) | `/api/codex-insights` `account` has `scope` and `plan` and no `credits` key. |
| QA-30 | README disclosure (FR-29) | README mentions the Codex credit standing row and that Claude Code does not report a credit balance; no new health line is added. |
| QA-31 | Output escaping (NFR-02) | Peer balance `<img src=x onerror=alert(1)>` renders as escaped text; no `<img>` element appears in the supplementary DOM. |
| QA-32 | Double-boundary stripping (NFR-03) | A peer block whose balance contains U+202E and U+2029 renders without those code points and inside a bidi-isolating element. |
| QA-33 | No fabricated zero (NFR-04) | For every `unsupported` and `stale` fixture, the string "0" does not appear as the balance value unless the fixture balance is literally `"0"`. |
| QA-34 | Accessibility (NFR-05) | Sub-block headings are heading elements within the `aria-labelledby` group; no new information is conveyed solely by `title` attributes or colour; state pills contain visible text. |
| QA-35 | Mobile containment (NFR-06) | With a 64-code-point space-free balance and a stale pill, `document.documentElement.scrollWidth` and `document.body.scrollWidth` equal the viewport width at 320, 375, 390, and 430px. |
| QA-36 | Badge untouched (NFR-07) | Menu-bar badge tests (contract, multihost, parity) pass unchanged; `computeMultiBadge` output for the existing fixtures is byte-for-byte identical. |
| QA-37 | Same-commit peer test (NFR-08) | The commit touching the peer normalizer whitelist also adds/extends a `normalizePeerState`-path test asserting QA-14, QA-15, and QA-16. |
