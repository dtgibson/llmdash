# Design Spec — Multi-Host

**Feature:** multi-host
**Stage:** 4 — The Designer
**Status:** APPROVED by the user 2026-07-02. Both flagged calls ratified to the
recommended treatments: (1) account-wide limits use **detect-and-collapse** — same-
account hosts (matching per-window reset epochs) share one "Account limits" banner,
each host leads with its own activity; (2) an offline host is **offline-only** — a
named `peer-unreachable`/`peer-error` callout, never a last-known/stale meter.
**Mockup:** `pipeline/multi-host/design.html`

---

## Visual Direction

Entirely within the established design system (`pipeline/design-system.md`): the
multi-host view is the existing single-host dashboard wrapped in a host dimension,
reusing the tool block, gauge (`.panel`), burn callout (`.burn` + `.burn-pill`),
stat tiles (`.tile`), token mix, age-pill, stale-note, and headroom grammar
verbatim — no new color semantics, no new type roles, no new dependency. The only
new chrome is host-group framing, an account-limits banner, and a host-level
freshness/offline state, all built from existing callout/pill grammar.

---

## The host-group layout

### Structure (host × tool, host is the outer loop)
A host is an **outer wrapper** around the *existing* per-tool render. Multi-host
mode (`hosts.length > 1`) renders, top to bottom:

1. **Account-limits banner** (see next section) — the shared account meters, once.
2. **One host group per host**, each a `.host` card containing that host's tool
   blocks. The **local host is a host like any other**, ordered first and marked
   `you`.
3. **Footer honesty line** + a **two-axis legend strip**.

### Host-group header (`.host-head`)
A labeled section header wrapping the host's tool blocks:
- **Host label** (`.host-name`, mono, escaped) — the operator's label, default =
  the sanitized host string.
- **Local marker** — the local host gets a small accent `you` pill (`.host-you`)
  and its card gets an accent left border (`.host-self`). No other host does.
- **Address** (`.host-addr`, mono, faint) — `sanitizedHost:port` for
  disambiguation (also escaped/coerced; never raw).
- **Per-host state** (`.host-state`, right-aligned): a pulse dot + freshness age
  (`updated 34s ago`) for a reachable host; a crit pulse + an **offline pill**
  for an unreachable one. The per-host **age band** (fresh / aging / stale) reuses
  the existing `.age-pill` grammar derived **live** from that host's
  server-supplied `freshness` thresholds via `ageBand()` — never hardcoded, per
  host, independent of every other host (one host aging never flags another).

### How it wraps the existing tool blocks
Inside a reachable host group, `state.tools.map(toolHtml)` runs **unchanged** —
the same gauges, pacing lines, tiles, and mix render per host through the shared
renderer (no fork). The account-wide-limits treatment (below) is the only
deviation: for a same-account host, the limit **gauges** are replaced by a
one-line "shown above" annotation while the **activity** (tiles + mix) renders in
full — activity is the genuine per-host news and always renders per host. Codex on
a host with no sessions renders the existing honest not-available empty-note, per
host (never fabricated zeros).

### Responsive stacking (mobile-first)
Host groups **stack vertically** in a single column (they are full-width `.host`
cards), on both phone and laptop — the page keeps its 720px centered column. This
is deliberate over a side-by-side columns layout: the tool block's own two-column
gauge grid (`.gauges`, `.stat-grid`) already consumes the full column width and
degrades on a phone; nesting host columns *inside* that would force a third level
of horizontal compression and either horizontal scroll or unreadable gauges on a
375px screen. Verified: no horizontal overflow at 375px, light or dark. Ordering:
local host first (`you`), then configured peers in list order, with any offline
hosts rendered in place (not sorted to the bottom — a host's position is stable so
the eye learns it).

---

## The account-wide-limits treatment (the centerpiece — flagged for ratification)

**The product call:** limits are the **account's** numbers, identical across
same-account machines; activity is **per machine**. The view must never let N
identical meters read as N independent budgets, while letting genuinely different
accounts read as distinct.

### Recommended treatment: detect-and-collapse (keyed on matching reset epochs)

A **pure client-side derivation** over the `/api/hosts` payload — no new server
field (FR-16 keeps `/api/state` untouched). For each tool (`claude-code`,
`codex`), group reachable hosts by their limit **identity key**:

```
identityKey(tool) = [ round(resetEpoch(five_hour) / TOL), round(resetEpoch(seven_day) / TOL) ]
                    where resetEpoch(win) = Date.parse(win.resetsAt), or null if win is null
```

- **Tolerance `TOL`:** compare reset epochs within a small window (recommend
  **60 000 ms** — one poll interval) so clock skew or slightly-staggered captures
  don't split one account into two. Two machines on the same account share the
  **same account-wide reset windows**, so their `resetsAt` epochs match; two
  different accounts have independent windows that (almost surely) don't.
- Hosts with a **matching key and a non-null reading** form an **account group**.

**Presentation:**
- **Same-account group of ≥2 hosts** → the shared limit gauges + pacing for that
  tool are rendered **once**, in an **account-limits banner** (`.acct`,
  accent-tinted callout, same grammar as `.burn`) above the host groups, titled
  **"Account limits"** and scoped **"account-wide · identical on `<host A>` &
  `<host B>`"** (escaped labels, joined naturally: 2 → "A & B", 3+ → "A, B & C").
  Each member host group then shows a one-line **same-account annotation**
  (`.same-acct`) in place of its (duplicate) meter, pointing up: *"Account limits
  above — same account as `<other host>`; the shared meters are shown once, up
  top."*
- **A host whose key does not match any other host** (a genuinely different
  account, e.g. Work laptop) → renders **its own** limit gauges + pacing **inside
  its host group**, exactly as the single-host tool block does today, under a
  per-host "account limits · this machine" sub-label so it's clear these are that
  host's account numbers, not a second budget on the shared account.
- **Single reachable host** (or all keys distinct) → no banner; every host shows
  its own meters in-group. Degenerate single-host mode shows no banner at all.

**Why this is honest:** (a) limits are labeled account-wide everywhere; (b)
identical meters are physically shown once, so the UI **cannot** read as 2×
budget; (c) a different-account host's meters sit in its own group, visibly
distinct. Activity leads per-host differentiation regardless.

**Edge cases the Engineer must handle:**
- A tool with `limits.five_hour === null` on some hosts: group only on the windows
  that have readings; a host with no reading for a tool contributes no key for
  that tool and shows the existing not-available/diagnostic state in-group (never
  folded into an account group).
- Claude and Codex are grouped **independently** (a user could share a Claude
  account across machines but run different Codex accounts). The banner has a
  per-tool section; a tool that isn't shared across ≥2 hosts simply doesn't appear
  in the banner and renders per host instead.
- Only **reachable** hosts participate in grouping; an offline host is never a
  group member.

### Fallback floor: label-only (ships even if detection is not built)

If the user prefers not to ship the detection (or the Engineer defers it), the
**settled floor** is: **no banner, no collapse** — every host renders its own
limit gauges in-group, but each tool block's limits carry an explicit
**account-wide label** (`.section-label`-style caption above the gauges:
*"Account limits — the same across your machines on this account"*), and the
footer states the distinction. This satisfies the observable requirement (limits
labeled as account numbers; activity leads differentiation) without the
collapse — the meters repeat, but they are never *unlabeled* repeats that imply
independent budgets. The recommended detect-and-collapse is a **refinement** of
this floor, not a replacement; the label stands either way.

**This is the decision flagged for the user to ratify:** ship the recommended
detect-and-collapse banner, or the simpler label-only floor.

---

## Per-host `hostDiagnostic` copy (the offline/error states)

When a peer's **fetch** fails, the host carries a `hostDiagnostic` with an enum
`reason` + escaped `detail`/`cause`, mapped client-side by **own-key
(`hasOwnProperty`) lookup** — never rendered raw (the shipped convention). The
`hostDiagnostic` is presented at the **host level** and **supersedes** per-tool
diagnostics for that host (there is no tool data to diagnose). Copy **names which
host and why** and never shows a gauge of zeros. Two enum reasons (the Engineer
may collapse to one code with a `cause` — the requirement is named/enum/escaped):

| `reason` | Trigger | Rendered line (host label + `cause`/`detail` escaped) |
|---|---|---|
| `peer-unreachable` | timeout / connection refused / DNS-connect error | **`<label>` is unreachable** — no response within `<timeout>`s (`peer-unreachable`). Last polled `<age>` ago. Its limits and activity aren't shown while it's offline; the other hosts are unaffected. Check that the machine is awake and llmdash is running on `<host:port>`. |
| `peer-error` | non-200 / bad JSON / oversized body / redirect | **`<label>` returned an error** — `<cause>` (`peer-error`). Last polled `<age>` ago. Its reading isn't shown while it's erroring; the other hosts are unaffected. `<cause>`-specific fix. |

- `<timeout>` = `peerTimeoutMs / 1000` (default 3). `<age>` re-derives from
  `fetchedAt` on the render tick (tabular-nums, like the stale-note).
- `<cause>` for `peer-error` is one of the enum causes (`http-<status>` /
  `bad-json` / `oversized` / `redirect`), each mapped to a fixed fragment by
  own-key lookup; an unmapped cause falls back to a generic "couldn't be read"
  fragment. `detail` (if present) is escaped and appended in parentheses.
- The callout reuses the **`.stale-note` grammar** exactly (crit-tinted bg + 3px
  crit left border, radius 10, tabular-nums, lead words bolded), so an offline
  host reads with the same "flagged, plainly stated, names the remedy" voice as a
  stale tool reading. The host-group card itself goes `.host-offline` (dashed
  border, transparent bg) so an offline host is structurally de-emphasized, not
  color-alone.
- **Escaping:** `<label>`, `<host:port>`, and any `detail` are `esc()`'d; the
  enum `reason`/`cause` map to fixed copy and are never interpolated raw. Nothing
  peer-supplied touches a style value.

---

## Offline treatment choice (flagged; recommendation made)

**Chosen: offline-only** (show the named offline state; do **not** render the
last-known reading, even flagged). Justification:

- **Honesty is cleanest.** FR-09 forbids showing a last-cached peer reading **as
  fresh**; the architecture already replaces a failed host's cache entry with the
  failure (schema: "the prior cache entry is REPLACED by the failure"). Rendering
  a last-known-but-flagged reading would mean carrying a second, stale-flagged
  render path per host, and a stale gauge sitting next to a fresh one invites
  exactly the misread the product exists to prevent.
- **The data survives elsewhere.** Each peer persists its own snapshots locally
  (cached-only, no cross-host history store); a user who wants that machine's last
  reading opens that machine's own dashboard. The offline note names the host:port
  to do so.
- **The gain is marginal, the cost is real.** A last-known limit meter on an
  offline host is, for a same-account host, *identical to the account banner
  that's still showing live above it* — so it adds nothing; for a different-account
  host it's a stale number with no live companion, which is precisely what we don't
  want to show as if current.

So an unreachable host shows the **named offline callout in place of its tool
blocks** — never a gauge, never a zero, never a flagged-stale meter. (If the user
prefers "show last-known, flagged as stale" per FR-09's allowance, the stale-note
grammar + the existing `age-pill pill-crit` "stale" treatment is the ready
vocabulary to switch to — flagged as the alternative.)

---

## Copy table — every new user-facing string (verbatim)

| Surface | String |
|---|---|
| Header freshness (multi-host) | `<n> hosts · updated <age> ago` |
| Account banner title | `Account limits` |
| Account banner scope (2 hosts) | `account-wide · identical on <host A> & <host B>` |
| Account banner scope (3+ hosts) | `account-wide · identical on <A>, <B> & <C>` |
| Account banner sub-line | `These are the account's numbers — the same across every machine signed in to this account. Per-machine activity is shown under each host below.` |
| Same-account annotation (host group) | `Account limits above — same account as <other host>; the shared meters are shown once, up top.` |
| Local host marker | `you` |
| Per-host activity sub-label | `activity · <host label>` (self: `activity · this machine`) |
| Different-account host limits sub-label | `account limits · this machine` |
| Host offline pill | `unreachable` (peer-unreachable) / `error` (peer-error) |
| Host offline callout (`peer-unreachable`) | `<label> is unreachable — no response within <t>s (peer-unreachable). Last polled <age> ago. Its limits and activity aren't shown while it's offline; the other hosts are unaffected. Check that the machine is awake and llmdash is running on <host:port>.` |
| Host error callout (`peer-error`) | `<label> returned an error — <cause> (peer-error). Last polled <age> ago. Its reading isn't shown while it's erroring; the other hosts are unaffected.` |
| Codex not-available (per host, existing) | `No Codex sessions have been recorded on this machine yet — token stats fill in once you use Codex here (read from its local session logs).` |
| Footer honesty line (multi-host) | `Limits: account-wide · Activity: per machine · Codex day buckets: UTC` |
| Footer scope (multi-host) | `<n> hosts over Tailscale` |
| Legend — account limits | `Account limits — the account's numbers; identical on every machine signed in to the same account. Shown once for same-account hosts.` |
| Legend — per-machine activity | `Per-machine activity — tokens, sessions, cache, value from each machine's own session logs. Genuinely different per host.` |
| Label-only floor caption (fallback only) | `Account limits — the same across your machines on this account` |

Notes: the existing footer's `Activity: local session logs` becomes `Activity:
per machine` in multi-host mode (the local-session-logs framing is still true per
host; "per machine" names the multi-host reality). The single-host footer is
**unchanged** (`Limits: account-wide · Activity: local session logs · Codex day
buckets: UTC`).

---

## Component reuse vs new chrome

**Reused verbatim (no change):** `.panel` gauges, `.bar`/`.bar-fill`, `.burn` +
`.burn-line` + `.burn-pill` (pacing), `.tile`/`.stat-grid` (activity), `.mix`
(token mix), `.age-pill` grammar (per-host freshness band), `.stale-note` grammar
(offline callout), `.empty-note` (per-host not-available), `.headroom` (per-host
cross-tool cue, unchanged), the status tokens/thresholds, both type roles, all
countdown/age formatting (`fmtDur`/`fmtAge`/`ageBand`).

**New chrome (minimal — the only additions):**
- `.host` / `.host-head` / `.host-name` / `.host-addr` / `.host-state` — the
  host-group card + header (the outer loop's framing).
- `.host-you` — the local-host accent pill; `.host-self` — accent left border on
  the local card.
- `.host-pill` — host-level freshness/offline pill (age-pill grammar, host scope).
- `.acct` / `.acct-head` / `.acct-title` / `.acct-scope` / `.acct-sub` — the
  account-limits banner (accent-callout grammar, same family as `.burn`).
- `.same-acct` — the one-line "shown above" annotation in a same-account host
  group (accent-tinted, left-border callout grammar).
- `.host-offline` / `.host-offline-note` — the offline host card + callout
  (stale-note grammar, host scope).
- `.legend-strip` — the two-axis (limits vs activity) legend.

All new classes are structural containers or reuse an existing callout/pill
grammar with a new scope label; none introduce a new color semantic, type role,
or dependency. The single-host (unconfigured) view uses **none** of the new
chrome — it is byte-for-byte today's dashboard (verified in the mockup's second
reference view).

---

## Interaction / render notes (for the Engineer)

- **Single-host mode** (`hosts.length === 1 && hosts[0].self`): render exactly
  today — `#tools` via `toolHtml()`, no host chrome, no banner, no legend. The
  new chrome engages only when `hosts.length > 1`.
- **Account grouping is a client-side derivation** on each render, over the
  combined payload — no new server field, no `/api/state` change (FR-16). Recompute
  identity keys on each refresh (reset epochs shift as windows roll over).
- **Per-host freshness bands** derive live on the 1s render tick from each host's
  own `freshness` thresholds (`ageBand()`), per tool, per host; Codex stays
  no-band. One host's band never affects another's render.
- **Verify it renders, not just loads** (project convention): the multi-host
  section must actually paint each host's gauges/pacing/tiles/mix and the offline
  callout — a blank-bar regression once passed a "page loads" check.
- **Escaping:** every peer-supplied field (host label, address, diagnostic
  `detail`) is `esc()`'d at render; enum reasons/causes map to fixed copy by
  own-key lookup; no peer field is interpolated into a style (widths/colors stay
  literals/coerced numbers).

---

## Content notes

Realistic data throughout: This machine (Claude 5-hour 38% / Weekly 64%, 44.1M
tokens today, 9 sessions, 88% cache; Codex 6.8M today), Desktop (12.7M today, 4
sessions, 91% cache, no Codex activity), Work laptop offline. Tailnet-style
addresses (`100.64.0.x:8787`). Copy is terse and honest, in the dashboard's
existing voice: states the account-wide-vs-per-machine reality plainly, names an
offline host and its fix, never hedges and never fabricates.
