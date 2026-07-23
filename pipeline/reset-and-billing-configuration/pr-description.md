## Reset and Billing Configuration

### What this does

Adds a focused `/settings` surface for two owner-managed inputs that previously
went stale or required repetitive file maintenance:

- A daylight-saving-aware weekly reset fallback. A current, successful provider
  account reset always wins; the configured schedule is selected and labeled
  `Configured` only when live account evidence is unavailable. Reset
  configuration never changes usage timestamps or freshness. The dashboard and
  local Claude menu-bar weekly row share that precedence while leaving raw usage
  and peer contracts untouched.
- Owner-confirmed Claude and Codex recurring USD monthly access costs. Each
  effective-dated change closes the prior record and appends immutable history;
  Cost analysis expands the current records month by month, preserving anchor
  days and clamping days 29–31 at month end.

The settings page also exposes fixed View and Download actions for the active
`account-config.json`, legacy read-only `subscriptions.json`, and tracked
read-only `config/api-rates.json`. It works from the same local or Tailscale
origin as the dashboard without introducing arbitrary file access.

### How it works

- `account-config.json` is one strict, versioned, owner-only file under
  `LLMDASH_DATA_DIR`. Missing means an explicit empty state—there is no hidden
  reset or billing default. Writes use a descriptor-checked, same-directory
  atomic replacement with mode `0600`; invalid or unsafe content is not replaced.
- The pure reset resolver uses the configured IANA zone's calendar rules. It
  selects the earlier instant during an overlap and advances to the first valid
  instant during a clock gap. Model-specific caps may corroborate the account
  reset but never become account-reset evidence themselves.
- Recurring plans are expanded in memory for the requested analysis window.
  Existing schema-v1 fixed periods retain their original inclusive semantics and
  take precedence on days they explicitly cover; the legacy file is never
  migrated or rewritten.
- HTTP mutation is limited to the exact
  `PUT /api/config/reset-billing`. Both GET and PUT reject an authority that is
  not bound to the receiving local socket, machine name, or tailnet MagicDNS
  namespace, preventing a DNS-rebound origin from reading configuration or a
  save token. PUT additionally requires matching HTTP Origin/Host, same-origin
  fetch context when supplied, the per-process CSRF proof, JSON content type, a
  strong `If-Match` ETag, and a bounded strict body. The matching exact GET
  returns the form view; six fixed query strings serve only the three allowlisted
  resources. No permissive CORS headers or generic path input exist.
- The raw-target contract distinguishes an absent query from even a bare `?`,
  and client-side server-error routing accepts only own keys from its fixed field
  map. Regressions cover both normalization and inherited-property probes.
- The poller owns configuration and cost-analysis refresh. `/api/state`, SQLite,
  peer contracts, raw provider reset timestamps, and multi-host account identity
  remain unchanged; the dashboard and menu-bar badge consume reset selection
  separately for display and weekly pacing. Failure of the optional menu-bar
  configuration read cannot make the authoritative hosts view appear offline.
- Startup health reports only whether account configuration is validated, empty,
  last-valid, or unavailable, plus the fixed settings route and security posture.
  It never logs a schedule, amount, CSRF token, or raw request body. Structured
  save/rejection/selection events likewise contain only bounded metadata.

### How to test

1. Run the focused feature and contract suites:

   ```sh
   node --test \
     tests/account-config.test.js \
     tests/billing-overlay.test.js \
     tests/reset-schedule.test.js \
     tests/strict-json.test.js \
     tests/secure-config-file.test.js \
     tests/reset-billing-api.test.js \
     tests/reset-billing-client.test.js \
     tests/health.test.js \
     tests/cost-analysis.test.js \
     tests/cost-analysis-client.test.js \
     tests/server.test.js \
     tests/state-unchanged.test.js \
     tests/hosts-client.test.js \
     tests/menubar.test.js \
     tests/menubar-config.test.js \
     tests/menubar-parity.test.js \
     tests/menubar-service-control.test.js
   ```

   Verified after the security-fix pass: 217 focused tests passed with no skips
   or failures.

2. Run the complete suite with `npm test`. The implementation pass completed
   with 729 passing, 0 failing, and 2 environment-dependent skips (731 total).
3. Follow `pipeline/reset-and-billing-configuration/how-to-see-it.md` to review
   the empty, configured fallback, recurring plan, file-link, and conflict states
   against an isolated scratch data directory at desktop and 320 px widths.

### Notes for reviewer

- **Not deployed or seeded:** this change does not write production
  `account-config.json`. Friday `23:00` in `America/Los_Angeles` is approved only
  as an explicit seed for this deployment after the deployment approval gate,
  through the same validated settings workflow. It is not an install default.
- Tailnet reachability remains the product access boundary; there is no llmdash
  login, actor, or role model. Sensitive configuration routes additionally trust
  only the receiving local IP, localhost, this machine's host name, or MagicDNS
  on an actual Tailscale destination. The default bind also reaches the LAN, as
  before; operators who want tailnet-only reachability should bind `LLMDASH_HOST`
  to the machine's Tailscale IP.
- Amounts are configured access costs, never inferred charges, invoices, taxes,
  discounts, or provider billing synchronization.
- Displayed filesystem paths are diagnostic only. The server resolves resources
  from fixed application constants and never accepts those paths back from a
  request.
- No SQLite migration, peer write, runtime dependency, or build step is added.
- Three pre-existing complete-uninstall hardening issues discovered during the
  review are recorded separately for the next project run. This feature keeps
  only the narrow preservation addition for the new billing files; its scoped
  remediation did not modify or execute uninstall behavior.

## Convention Flags

- Live provider evidence outranks owner fallback configuration; configuration
  must never make stale usage look fresh.
- Effective-dated financial history is append-only. New recurrence is expanded
  in memory and explicit legacy periods retain precedence.
- A tailnet-served mutation must be exact-route, trusted-authority, same-origin,
  CSRF- and version-checked, strictly bounded, and incapable of choosing a
  filesystem path.
- Deployment-specific owner values belong in a validated deployment action, not
  in source defaults, installers, or startup side effects.
