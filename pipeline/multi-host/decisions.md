# Decisions — multi-host

## Stage 4 (Designer review) — 2026-07-02
- **User ratified both account-wide-limits calls to the recommended treatments:**
  - **Detect-and-collapse for account-wide limits.** When two or more reachable
    hosts are on the same account (detected client-side by matching per-window
    `resetsAt` epochs, ~60s tolerance), their identical limit meters collapse into
    a single "Account limits" banner shown once; each host below leads with its own
    distinct **activity** (the genuinely per-machine data). A genuinely different-
    account host renders its own meters in-group. This is the most honest option —
    the meter is *physically* shown once, so it can never read as N independent
    budgets. (The label-only floor — repeat each meter, caption every one
    "account-wide" — is the fallback if detection ever proves unreliable, not the
    ship default.)
  - **Offline-only for unreachable hosts.** An offline/errored host shows a named
    callout ("<host> is unreachable — no response within 3s… the others are
    unaffected"), never a last-known reading flagged stale — a stale gauge beside a
    live one invites the exact 2×-budget misread the feature exists to prevent, and
    that host's own dashboard still has its live data.
- **Layout approved as drawn:** hosts are full-width cards stacked vertically
  (not side-by-side columns — the existing tool block's two-column gauge grid
  already fills the column and would break on a phone if nested), local host first
  and marked "you", each with its own freshness/offline pill reusing the existing
  `.age-pill` grammar. Reuses the existing `toolHtml()` render per host; the
  unconfigured single-host view is byte-for-byte today's dashboard. No design-system
  extension beyond host-group framing + the account banner + the offline callout,
  all reusing existing callout/pill vocabulary.
- **Note:** a side-session task chip ("Ratify account-wide-limits framing," spawned
  during the Architect stage) was started by the user in parallel; this in-flow
  ratification supersedes it. Its output, if any, is informational only.
