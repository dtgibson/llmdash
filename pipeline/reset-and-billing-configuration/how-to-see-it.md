# Seeing reset-and-billing-configuration locally

These steps use a fresh scratch data directory and port `8788`. They do not
touch the installed service, normal llmdash data, or production configuration.
Nothing in this guide deploys or seeds production.

## 1. Run the focused checks

From the project root:

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

The implementation pass completed this set with 215 passing and no failures.

## 2. Start an isolated review instance

In one terminal:

```sh
review_root="$(mktemp -d)"
mkdir -p "$review_root/claude" "$review_root/codex"
LLMDASH_DATA_DIR="$review_root/data" \
LLMDASH_CLAUDE_DIR="$review_root/claude" \
LLMDASH_CODEX_DIR="$review_root/codex" \
LLMDASH_CLAUDE_CMD="$review_root/no-claude" \
LLMDASH_CODEX_CMD="$review_root/no-codex" \
LLMDASH_CLAUDE_AUTOREFRESH=0 \
LLMDASH_PORT=8788 \
npm start
```

The startup readout should include a `Reset & billing:` line saying no account
configuration is saved, naming `/settings`, and stating the exact same-origin
PUT posture. It must not print a reset schedule, plan amount, or request token.

## 3. Open settings locally or over Tailscale

- Local: <http://localhost:8788/settings>
- Tailnet: `http://<your-tailscale-ip>:8788/settings`

Use `tailscale ip -4` to find the address, or substitute the machine's MagicDNS
name. Use HTTP, not HTTPS, and keep the same host/port while saving so the browser
request remains same-origin.

On the fresh scratch instance, confirm:

- The selected reset source is `Unavailable`.
- The configured fallback says `Not configured`.
- `account-config.json` is empty/not saved and Save is initially disabled.
- Usage freshness copy says that a fallback cannot refresh usage.

## 4. Save a configured weekly fallback

Enable the configured fallback and enter:

- Weekday: **Friday**
- Local time: **23:00**
- IANA time zone: **America/Los_Angeles**

Save changes. This is an explicit action in a disposable review instance, not a
generic or production seed. Confirm the source becomes `Configured`, the next
Friday occurrence is shown in the configured zone, and the file version advances
to v1. Return to the dashboard and confirm the Claude weekly reset display uses
the configured time and provenance while the missing/stale usage reading remains
missing/stale. If a menu-bar badge points at an instance with an existing local
Claude weekly usage row, its dropdown should show the same fallback countdown
with `Configured`; the percentage and stale/aging marker must remain unchanged.

If a current usable provider account reset is available in a non-isolated review,
it must remain selected as `Live`; the saved Friday schedule should still be
visible as the dormant fallback.

## 5. Add a recurring monthly amount

In the Claude or Codex row:

1. Choose **Start plan**.
2. Enter an owner-confirmed USD amount with at most two decimal places.
3. Use the first day of the current month as the effective date and anchor day
   `1` (or another date that exactly matches its chosen anchor).
4. Check the explicit confirmation and save.

Confirm the row now says `amount / month`, shows the effective start and anchor,
and the account-config version increments. Back on the dashboard, Cost analysis
should expand that amount across subsequent monthly periods automatically; there
is no next-month JSON edit. A later plan change must close the current version at
a valid billing boundary and append a new one rather than rewriting history.

For a month-end check, use anchor `31` on a valid day-31 boundary and inspect a
range crossing February. The recurrence tests prove the period clamps to
February 28/29 and returns to day 31 in March without drift.

## 6. Inspect the fixed backing resources

The Billing inputs section supplies View and Download actions for these exact
same-origin URLs:

```text
/api/config/reset-billing?resource=account-config&download=0
/api/config/reset-billing?resource=account-config&download=1
/api/config/reset-billing?resource=subscriptions&download=0
/api/config/reset-billing?resource=subscriptions&download=1
/api/config/reset-billing?resource=rate-card&download=0
/api/config/reset-billing?resource=rate-card&download=1
```

After the first save, account-config View should show the canonical v1 file and
Download should use `account-config.json`. The rate card is available read-only.
The legacy subscriptions links correctly return missing in this scratch instance
unless you deliberately add a schema-v1 fixture; the settings form never rewrites
that file. A nearby query, extra query key, traversal string, or arbitrary resource
ID must be rejected rather than treated as a path.

## 7. Exercise validation and conflict recovery

- Try a monthly amount with three decimal places or leave confirmation unchecked.
  The associated inline error should receive focus and nothing should be written.
- Open settings in two tabs. Save a change in the first, then try to save the
  stale draft in the second. The second tab should show the version-conflict
  banner and offer **Reload latest**; it must not overwrite the first save.
- At 320 CSS pixels, confirm the fields, resource rows, and save actions stack
  without horizontal page scrolling. Check keyboard navigation plus light and
  dark color schemes.

Stop the scratch server with Ctrl-C when review is complete. The temporary
directory is intentionally left for you to inspect or remove explicitly.

## Deployment seed remains gated

The approved Friday `23:00` `America/Los_Angeles` value may be saved on the real
deployment only after explicit deployment sign-off. The deployer should open the
deployed `/settings` page on that same origin and use the validated form; source
code, install scripts, startup, and clean installs must remain unseeded.
