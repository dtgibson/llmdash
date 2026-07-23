# Schema — Reset and Billing Configuration
**Feature:** reset-and-billing-configuration
**Stage:** 3 — The Architect
**Source:** prd.md (approved)
**Store:** one versioned owner file under `LLMDASH_DATA_DIR`; existing SQLite is unchanged.

## Path
Incremental. Add `${LLMDASH_DATA_DIR}/account-config.json` and additive runtime/API
contracts. Do not add or migrate a SQLite table, column, row, schema version, or
index. `${LLMDASH_DATA_DIR}/subscriptions.json` remains a read-only schema-v1
legacy input and is never rewritten or converted.

## Current Schema State
- SQLite contains the shipped usage snapshot state only; it has no reset schedule
  or recurring-plan schema.
- `config.js` resolves `dataDir`, `subscriptionsFile`, and the tracked
  `config/api-rates.json`. `subscriptions.json` schema v1 is bounded to 256 KiB,
  depth 8, and 512 fixed entries. It accepts only `USD`, `claude|codex`, confirmed
  amounts from `0` through `1000000.00`, and inclusive dates from `2000-01-01`
  through `2100-12-31`; overlapping fixed periods for one tool are rejected by
  the existing reader.
- Fixed subscription entries mean exactly what they mean today: one amount over
  an inclusive `[startDate,endDate]` period. They are owner configuration, not a
  subscription document.
- Live provider state can supply reset instants, but there is no durable fallback
  cadence, recurring monthly plan history, HTTP mutation route, login, actor, or
  role schema. Tailnet reachability remains the access boundary.

## Changes in This Feature

### Added
- `config.accountConfigFile`, fixed as `path.join(config.dataDir,
  "account-config.json")`; no environment variable or request may supply a file
  name or path.
- One strict `account-config.json` v1 envelope containing the reset schedule and
  all recurring-plan versions:

```json
{
  "schemaVersion": 1,
  "version": 3,
  "updatedAt": "2026-07-23T18:15:30.000Z",
  "resetSchedule": {
    "isoWeekday": 5,
    "localTime": "23:00",
    "timeZone": "America/Los_Angeles"
  },
  "recurringPlans": [
    {
      "tool": "claude",
      "amountCents": 2000,
      "effectiveStartDate": "2026-07-01",
      "effectiveEndDate": null,
      "billingAnchorDay": 1,
      "createdInVersion": 2,
      "closedInVersion": null
    }
  ]
}
```

- Exact file rules: the envelope has only the five shown keys. `schemaVersion`
  is exactly `1`; `version` and plan-version fields are safe integers in
  `1..9007199254740991`; `updatedAt` is canonical UTC RFC 3339 with milliseconds.
  `resetSchedule` is either `null` or the exact three-key object shown.
  `isoWeekday` is ISO `1` (Monday) through `7` (Sunday); `localTime` matches
  `^(?:[01][0-9]|2[0-3]):[0-5][0-9]$`; and `timeZone` is a 1–128 byte canonical
  IANA identifier accepted by the runtime's pinned time-zone adapter. Offset
  strings, POSIX zones, aliases that do not round-trip to the stored canonical
  identifier, NUL/control characters, and unknown zones are rejected.
- `recurringPlans` has at most 120 exact-key records, sorted by `tool`, then
  `effectiveStartDate`, then `createdInVersion`. `tool` is `claude|codex`;
  `amountCents` is a safe integer in `1..100000000` ($0.01–$1,000,000.00);
  dates are real `YYYY-MM-DD` dates in `2000-01-01..2100-12-31`; start is
  inclusive and end is null or exclusive and greater than start; anchor is
  `1..31`. Intervals for a tool may touch but never overlap. A record's business
  fields are immutable after creation; only its null end may be closed once,
  with `closedInVersion` set to that same save version. Closed records are never
  deleted, shortened again, or rewritten. For adjacent records, the earlier
  record's close version cannot be later than the successor's creation version;
  impossible version chronologies are invalid even when their dates do not overlap.
- A strong ETag derived from schema version, monotonic file version, and SHA-256
  of canonical serialized bytes. An absent file is the valid empty state
  `version: 0`, null schedule, and no plans, with its own stable ETag. Invalid or
  unreadable content is not treated as empty.
- A pure recurrence expander. For anchor `a`, the boundary in year/month `m` is
  `min(a, daysInMonth(m))`; the original `a` is reused every month, so a day-31
  plan yields February 28/29 and then March 31 rather than drifting. A plan must
  begin on its clamped boundary; its close/change date must also be a boundary
  for the plan being closed. It expands only boundaries intersecting the
  requested analysis window, into inclusive fixed periods ending the day before
  the next boundary or exclusive plan end. No expansion is persisted.
- Deterministic overlay with the legacy file. Parse `subscriptions.json` through
  its unchanged schema-v1 reader, independently parse the full account config,
  then expand recurring plans. Legacy fixed periods have precedence for every
  covered `(tool, calendar-day)` because they are explicit historical facts;
  recurring fragments are clipped around that coverage. Remaining recurring
  fragments keep the plan's monthly amount apportioned by the existing fixed-
  period cost rules. Output sorts by tool/date/source, with source provenance
  `legacy-fixed` or `configured-recurring`. One invalid source never changes the
  other; diagnostics report its loss of coverage rather than guessing.
- A DST-aware pure reset resolver. Starting with the calendar date in the saved
  zone, inspect today and at most the next seven local dates for the matching ISO
  weekday. Resolve one local wall time as follows: one possible instant selects
  it; an overlap selects the earlier instant; a gap advances local time minute by
  minute (bounded to 26 hours) and selects the first valid instant. If the result
  is not strictly after `now`, advance seven local calendar days and resolve
  again. Calendar arithmetic occurs in the configured zone, never by adding a
  fixed UTC duration. The injectable time-zone adapter and clock make the rule
  fixture-testable, including its tzdb version.
- Reset selection with explicit provenance. A parseable, future account-window
  reset from the current successful provider response is `live` and always wins.
  An expired snapshot, invalid/missing timestamp, or model-cap-only reset is not
  live account evidence. Only then may a valid saved schedule yield
  `configured`; otherwise the source is `unavailable`. Model-cap agreement may
  be emitted as corroboration but never changes source. Selection returns the
  fixed shape below, while existing usage `observedAt`, freshness, and stale
  fields pass through untouched:

```json
{
  "source": "live",
  "label": "Live",
  "nextResetAt": "2026-07-25T06:00:00.000Z",
  "liveStatus": "usable",
  "configuredStatus": "usable",
  "corroboratedByModelCap": false
}
```

  `source` is `live|configured|unavailable`, the label is respectively
  `Live|Configured|Unavailable`, nullable `nextResetAt` is canonical UTC, and
  each status is a bounded enum. The selected source and reason are logged, but
  reset configuration never mutates provider timestamps or freshness.

### Modified
- The local poller owns immutable account-config, legacy-subscription, and
  combined billing caches. Each normal tick checks file identity and bounded
  content hash; a successful PUT swaps the already-validated candidate into the
  same cache immediately. Refreshes are single-flight and replace a whole cache
  value, never individual fields. Cost-analysis refresh consumes the combined
  overlay; reset consumers use the shared provenance resolver.
- Add only `GET /api/config/reset-billing` and `PUT
  /api/config/reset-billing`. Match the raw ASCII pathname exactly: trailing
  slashes, encoded path variants, nearby paths, and all other methods (including
  `HEAD` and `OPTIONS`) are rejected. PUT permits no query. GET permits exactly
  one of these modes, with no repeated or unknown query keys:
  - no query: bounded JSON configuration view;
  - `?resource=account-config&download=0|1`;
  - `?resource=subscriptions&download=0|1`;
  - `?resource=rate-card&download=0|1`.
- The no-query GET response is capped at 128 KiB and has this exact top-level
  shape: `{schemaVersion,version,etag,csrfToken,resetSchedule,recurringPlans,
  resetSelection,sources,paths,links}`. `sources` reports bounded status/reason
  enums for account config and legacy subscriptions, including whether current,
  last-valid, or empty data is serving. `paths` contains display-only resolved
  paths; `links` contains only the six fixed resource URLs. Values are never
  accepted back as paths. Responses use `Cache-Control: no-store`,
  `X-Content-Type-Options: nosniff`, and no `Access-Control-Allow-*` header.
- Resource mode streams only the fixed resolved files after the safe-read checks
  below. `account-config` is capped at 32 KiB and is named
  `account-config.json`; `subscriptions` is capped at its existing 256 KiB and
  is named `subscriptions.json`; `rate-card` is capped at 1 MiB and is named
  `api-rates.json`. `download=0` emits `Content-Disposition: inline`; `1` emits
  `attachment`. Both emit `application/json; charset=utf-8`, fixed safe
  filenames, `nosniff`, and `Content-Length`; they never accept ranges, paths,
  names, or URLs. Missing/unsafe/oversize files return bounded JSON errors rather
  than partial bytes.
- PUT accepts at most 32 KiB before parsing and only
  `application/json` (optional exact `charset=utf-8`). A fatal UTF-8 decoder and
  duplicate-aware JSON parser require one complete top-level object, reject
  duplicate keys at every depth, trailing tokens/bytes, unknown keys, depth over
  8, and non-JSON numeric values. Its exact request shape is:

```json
{
  "schemaVersion": 1,
  "baseVersion": 3,
  "resetSchedule": null,
  "billingChanges": [
    {
      "action": "set",
      "tool": "codex",
      "amountUsd": "20.00",
      "effectiveDate": "2026-08-01",
      "billingAnchorDay": 1,
      "confirmed": true
    }
  ]
}
```

  `billingChanges` has at most two entries and no repeated tool. `set` has exactly
  the shown keys, normalizes the strict decimal `amountUsd` (at most two digits,
  same $0.01–$1,000,000 bound) to integer cents, and requires `confirmed:true`.
  It starts a plan when none is open; otherwise its later effective boundary
  closes the open record and appends the new record atomically. `cancel` has
  exactly `{action,tool,effectiveDate,confirmed}`, closes an open plan on its
  boundary, and appends no zero-dollar fiction. Starting after cancellation is
  allowed; retroactive overlap, multiple open plans, non-monotonic history, and
  modifying a closed record are rejected with field paths. The submitted reset
  value replaces only the reset field; billing history is server-derived.
- PUT requires both a single strong `If-Match` equal to the current ETag and a
  matching `baseVersion`; missing proof returns `428`, stale proof `412` with the
  current version/ETag, and invalid fields `422` with bounded
  `{error,fieldErrors}`. It returns the same view shape as GET after success.
  A per-process 256-bit random base64url CSRF token is returned only by GET and
  must match `X-LLMDash-CSRF` in constant time. It is never persisted or logged;
  restart invalidates open forms.
- Every request must contain one syntactically valid Host authority whose effective
  port equals the receiving socket and whose name is trusted for that local socket:
  the exact destination IP, loopback `localhost`, this machine's full/short host
  name, a configured non-wildcard bind name, or a valid MagicDNS short/`*.ts.net`
  name only when the destination is a local Tailscale address. This check runs for
  GET and PUT before configuration, resource bytes, ETag, or CSRF material is
  returned, closing same-origin DNS rebinding without a DNS lookup. PUT also
  requires one non-`null` Origin whose normalized scheme/host/port exactly equals
  the request's server origin and rejects `Sec-Fetch-Site` when present unless it
  is `same-origin`. Missing/mismatched Origin, Host, CSRF, or content type fails
  before body parsing. Preflight is not enabled and no success or error response
  emits permissive CORS headers. Tailnet reachability remains the only access
  boundary; there is deliberately no identity, login, session, role, or actor.

### Unchanged
- SQLite initialization, schema version, tables, indexes, and all existing rows.
- The bytes and schema-v1 semantics of `subscriptions.json`; the dashboard cannot
  write, migrate, delete, or "repair" it. The tracked rate card remains read-only.
- Provider refresh and usage-freshness ownership, peer configuration/fan-out,
  remote-host writes, and public-internet posture. This feature is local-machine
  scoped and exposes no generic file or URL operation.

## Migration Plan
1. Ship the reader, pure validators/resolvers, cache, and `accountConfigFile`
   path with the feature disabled at the UI boundary. Missing file means the
   explicit empty v1 state; do not create it or copy legacy fixed periods.
2. Seed Friday 23:00 `America/Los_Angeles` only for this explicitly confirmed
   deployment, through the same validated atomic writer. Generic installs have
   no active fallback until their operator saves one.
3. Enable additive reset consumers, recurring overlay, the exact API route, and
   the form. Existing schema-v1 fixtures continue to read byte-for-byte.
4. Rollback disables the route/UI and ignores `account-config.json`; SQLite and
   legacy subscriptions require no rollback. The owner file is retained for a
   later forward deploy. Manual recovery restores a known-good canonical file
   while the service is stopped and advances `version` before restart; temporary
   files are never recovery candidates.

## Design Decisions

### One atomic ownership boundary
Reset schedule and recurring history live together so one save needs one rename,
not a cross-file transaction. `subscriptions.json` is an independent read-only
legacy input. Under a per-process writer mutex, the server rechecks file/cache
identity and ETag, derives the complete candidate, validates and canonically
serializes it, then creates an unpredictable same-directory temporary file with
exclusive create, no-follow flags, and mode `0600`. It writes all bytes, calls
`fdatasync/fsync`, verifies/fchmods `0600`, closes, revalidates the destination
directory and target, renames over only `account-config.json`, and fsyncs the
directory before publishing the cache. Serialization, write, flush, or rename
failure before replacement publishes nothing; any surviving temp file is ignored
at startup. Once rename has happened it cannot truthfully be reported as an
ordinary failed save: the server descriptor-verifies the target, publishes a
matching candidate with a bounded durability warning if directory fsync failed,
adopts a different later valid version as a conflict, and otherwise reports the
commit as indeterminate. A successful change emits only timestamp, changed field
names, and resulting version—never actor, token, body, amount, or schedule values.

### Fixed-path and last-valid safety
Before every filesystem-backed read or write, derive the target from the fixed
application constant, require absolute containment under its trusted root,
`lstat` every existing path component, reject every symlink and non-directory
parent, and require the data directory/target to be owned by the service UID and
not group/world writable. Existing targets must be single-link regular files.
Open with `O_NOFOLLOW` where available, then `fstat` and compare device/inode to
the checked entry before reading bounded bytes; if the platform cannot prove the
same guarantees, fail closed. Never resolve a request value as a path.

The first valid load or successful PUT atomically replaces the immutable cache.
A malformed manual edit, unsafe identity, version regression, or I/O failure
keeps the process's last-valid value and marks it `last-valid` with a bounded
reason. A cold start with invalid content is unavailable, not empty; a cold
missing file alone is empty v0. Polling a later valid file with a strictly newer
version recovers automatically. PUT and poll refresh share the single-process
writer boundary; version plus content ETag prevents stale-tab and ABA overwrites
for supported in-app writes. Manual recovery is intentionally service-stopped as
specified above; a simultaneous external editor is not a supported writer and
portable Node rename has no compare-and-swap replacement primitive.

### Verification seams
- Pure schema fixtures cover unknown/duplicate keys, UTF-8/trailing data, every
  numeric/date/amount bound, overlap components, append/close/cancel history,
  canonical bytes, versions, ETags, and legacy/recurring clipping precedence.
- Clock and time-zone adapters cover ordinary weeks, exact-boundary behavior,
  spring gaps (first valid instant), fall overlaps (earlier instant), leap years,
  zones with non-hour transitions, and day-29/30/31 month clamping without drift.
- Provider fixtures prove live-over-configured precedence, missing/expired/model-
  only rejection, provenance labels, and byte-for-byte unchanged freshness data.
- HTTP tables cover the exact raw path/query/method matrix, Host/Origin/fetch-site
  checks, token rotation and constant-time comparison, content type, early 32 KiB
  cutoff, bounded errors, no CORS, stale ETags, and all three fixed resource
  disposition filenames.
- Filesystem fault injection covers symlink/parent swaps, hard links, devices,
  oversize/change-during-read, partial writes, flush/rename/directory-fsync
  failures, mode `0600`, poll/PUT races, restart temp-file ignoring, cache
  retention, and recovery by a later valid higher-version file.
