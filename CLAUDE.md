# llmdash — Conventions

## Stack
- Vanilla Node with **zero runtime dependencies**. Use Node builtins only
  (`node:http`, `node:sqlite`, `node:test`). No frameworks, no bundler, no build
  step. Requires Node 24+ (for `node:sqlite`).
- Frontend is plain HTML/CSS/JS served as static files from `public/`.

## Patterns
- Configuration lives in `config.js`, overridable via `LLMDASH_*` env vars.
  **Never ship a dead knob** — an env var that drives nothing is dishonest
  surface.
- **A runtime-config file that supersedes an env var uses seed-once precedence:**
  the env **seeds** the file once (first run / no file), and the file is the
  source of truth thereafter — the env is not re-consulted while the file exists.
  The badge's `hosts.conf` is seeded from `LLMDASH_HOSTS` once, then owned by the
  file; without this, a host removed at runtime would be **resurrected** by the
  still-set env var on the next start (env-as-perpetual-truth silently defeats the
  Remove action). Any future editable-at-runtime config follows the same rule.
- **A local config *write* stays a local file write — never an HTTP mutation
  endpoint.** llmdash is serve-only (read-only over the `0.0.0.0` tailnet bind);
  the badge's Add/Remove edits `hosts.conf` in its **own process**, so the bind
  gains no write surface (`server.js` keeps no POST/PUT/DELETE/PATCH — still 405
  for non-GET/HEAD). When such a write ingests a user-typed value (the
  `osascript` Add dialog), harden it structurally: a **fixed-literal** AppleScript
  run via `execFileSync('/usr/bin/osascript', ['-e', <constant>])` (**no shell**),
  the typed value returning on stdout and reaching the writer as a **plain ARGV
  string** only (never concatenated into the script or a command); write
  **atomically** (temp+rename, `0o600`) to a **fixed** path (never one derived
  from input → no traversal); **validate before the write lands** (`parseHosts` +
  `sanitizeHostPort`, reject writes nothing); and **strip embedded newlines** per
  record so a value can't smuggle a second config line or a directive.
- **A menu-bar-driven destructive or system action stays user-domain, confirmed,
  marker-gated, and never an HTTP endpoint** — this extends the local-write rule to
  `launchctl`/`fs` mutations (the service toggle, the two-tier uninstall). Every
  such action: runs **user-domain only** (`launchctl … gui/<uid>/…`, user-owned
  paths — **never** `sudo`, a system domain, or a system path); is gated by an
  **`osascript` confirmation with the safe choice as the default button** (the
  destructive/data-deleting option is never the default and is warned as
  irreversible), the uninstall dialog **enumerating every artifact before acting**;
  is **marker-gated per removal** (delete the wrapper only with the
  `llmdash-menu-bar-badge` marker, the trust entry only via an own-key
  `hasOwnProperty`, the plist only for the resolved label's file, the checkout only
  the resolved dir — never a user's own file); is **honest on partial failure**
  (each step reports its own concrete outcome; never claim a removal that didn't
  happen); and lives entirely in the **badge/helper process** — no new endpoint,
  `server.js` stays serve-only (405 for non-GET/HEAD), so the `0.0.0.0` bind gains
  no mutation surface and no remote peer can trigger it.
- **A path-ownership check before a destructive fs op is a whole-token path
  match, never a substring `includes()`.** Deciding "does this file/command belong
  to THIS checkout, so I may delete or revert it" on a bare `String(cmd).includes(
  target)` is a false-positive waiting to fire: a suffix (`…/statusline.js.bak`) or
  a sibling prefix (`…/checkout2/…`) satisfies it. Match the target only bounded by
  end-of-string, whitespace, or a quote (`targetIsWholeToken`) so the real
  `node <target>` (optionally with args) still matches but a super/substring does
  not. This was the feature's one security finding — a substring gate on a
  destructive teardown path. The same discipline is why every removal is
  marker-gated (above): ownership is proven, never guessed.
- **Preserve-by-default that a co-located dependency could defeat must RESCUE the
  irreplaceable asset out of harm's way before deleting its parent — and name the
  new location — not merely order the deletes.** The usage-history DB (`llmdash.db`,
  the founding "no backfill" irreplaceable asset) is preserved by default on
  uninstall; but when the data dir lives **under** the checkout being `rm -rf`'d,
  ordering the checkout-delete last is not enough — the DB would go with it. So the
  teardown first **moves** the named data files to `~/.llmdash/preserved-data` (a
  `path.relative` `isUnder` check decides whether a rescue is needed — never a
  substring), then deletes the checkout. Deleting the DB is a separate,
  non-default, explicitly-warned opt-in. When a preserve promise and a destructive
  op share a path, rescue the asset, don't just sequence the deletes.
- **A detached teardown helper that must outlive what it removes is self-contained,
  reads all inputs up front, and deletes its own origin LAST.** The complete
  uninstall `launchctl bootout`s the service feeding the badge and `rm -rf`s its own
  checkout, so it runs as a **detached** child (`spawn(process.execPath, [tmpSelf,
  …, '--run'], { cwd: tmpDir, detached: true, stdio: 'ignore' })` + `unref()`)
  copied to `os.tmpdir()` and `cd`'d out of the checkout. The binding rule (proven
  by SPIKE-01, Hazard E): on APFS an already-loaded process survives its origin dir
  being unlinked, but **any lazy `import` from the deleted checkout after the `rm`
  throws `ERR_MODULE_NOT_FOUND`** — so the helper imports **only** `node:` builtins,
  never `../../src` or the installer, receives every path via ARGV `--payload` up
  front, and makes the checkout-delete a **leaf** (nothing loads after it). Ordering
  is fixed: service → statusline → trust → wrapper → checkout LAST → data (opt-in,
  after checkout). Single source of truth for the launchctl/plist/teardown logic is
  `install-macos.sh`'s `--service`/`--uninstall` hooks; the badge invokes them, but
  the checkout-deleting step runs from the node helper's temp copy (the installer
  script is itself in the checkout being deleted).
- Persist only what has no other history: limit **snapshots** go to SQLite
  (deduped). Activity/token stats are derived on demand from Claude Code logs —
  no extra storage.
- **Be honest in the UI.** When a number's source or scope differs from the
  headline data (e.g. account-wide limits vs local-log activity), say so.
- **Surface security-relevant defaults** (e.g. network binding) in the README and
  the startup log — never silently.
- HTTP responses carry baseline security headers (`nosniff`, CSP `default-src
  'self'`, `Referrer-Policy`) and reject non-GET/HEAD with 405.

## Multi-source
- The dashboard is **source-aware**: each tool is a `source` value in
  `usage_snapshots` and a tool block in the UI. Add a new tool as a new source
  flowing through the shared path — don't fork the store or the renderer.
- **Clamp externally-sourced percentages** (limit used %) to 0–100 before storing
  or deriving from them. More broadly: **coerce every externally-sourced number to
  a finite number (or null) at ingest, and reach nested/aggregate sub-objects, not
  just the top-level meter.** A "looks like data, keep the object as-is" pass on a
  nested block (e.g. a fetched peer's `activity`) is a gap the moment a downstream
  formatter has an unescaped string path (`String(n)` fallback, raw `n + ' …'`
  concatenation) — a hostile string then reaches an `innerHTML` sink. Normalize
  the whole payload tree, never just its head.
- **Normalize externally-sourced timestamps to canonical ISO at ingest**
  (`new Date(Date.parse(v)).toISOString()`) — `Date.parse` validation alone
  doesn't guarantee a clean string. Never default a missing/unparseable
  timestamp to "now"; fall back to file mtime (a now-fallback makes malformed
  data eternally fresh).
- When refactoring a single-source view to multi-source, **diff the rendered stat
  set** so nothing silently drops. When a shared formatting helper changes, the
  diff must enumerate the helper's call sites, not just the feature's own block.
  A call site **outside the app bundle** (a non-browser client — the menu-bar
  badge, a future terminal statusline — that can't `import` `public/app.js` and
  must **copy** a presentation helper) ships a **parity guard test** (byte +
  behavioral equality) in the same commit as the copy, never a bare copy: a diff
  can't catch drift the copier never sees. See `tests/menubar-parity.test.js`.
- Read live limits off the interval poller, never per HTTP request (Codex spawns a
  subprocess; keep that off the request path). The Claude reading is also refreshed
  there: when it goes stale **and** Claude has been active, the poller spawns a
  short-lived pty session that sends `/usage` and scrapes the rendered pane into the
  same reading file — activity-gated, on by default, off via
  `LLMDASH_CLAUDE_AUTOREFRESH=0`. The TUI scrape is version-brittle; a layout it
  can't parse fails loudly as `parse-failed`, never a partial or fabricated reading.
- **Any outbound HTTP llmdash makes follows the hardened-fetch template** in
  `src/hosts.js` (`fetchPeerState`). llmdash is otherwise serve-only; a peer/host
  read is the one outbound surface, and it is SSRF-shaped. The rules: target
  **only** an explicitly-configured host (from `LLMDASH_HOSTS` via `parseHosts` —
  **never** a host derived from a fetched payload, so there is no transitive
  fan-out); a **credential-free `GET`** of a fixed path only (no auth header, no
  cookie, no write method); the request built from an **options object**
  (`{host, port, path}`), never a URL string, with `sanitizeHostPort` stripping
  everything outside `[A-Za-z0-9._:\-\[\]]`; **no redirect-follow** (treat any 3xx
  as an error state, never bounce to a new target); and **both** a bounded timeout
  **and** a response-body cap (checked before appending each chunk, `req.destroy()`
  on overflow) so a peer can neither hang the poller nor OOM the process. Every
  fetched field is then untrusted data — clamp/normalize at ingest, `esc()` at
  render (above). Runs on the poller, never the request path.
- **Any subprocess/pty probe follows the fixed-runner pattern** in
  `src/claude-refresh.js`: a fixed-constant runner (`/bin/sh` + `/usr/bin/script`
  by absolute path), config entering **only** as quoted positional argv (never
  interpolated into a shell string), an explicit env **allowlist** (never inherit
  the parent's `CLAUDECODE*`/`ANTHROPIC_*`/`LLMDASH_*`), a dedicated fixed cwd, and
  ancestry-gated teardown that structurally cannot signal the user's live sessions.
  This is the codebase form of the zero-shell-injection rule.
- Limit and headroom logic consider **all windows** (5-hour and weekly), not just
  one. Each tool shows a pacing predictor for **both** windows at once; a maxed
  window (≈0 remaining) reads "limit reached" and is binding **per window** (one
  maxed window never suppresses the other's pacing line).
- If a tool genuinely lacks token activity, render an honest "not available" state
  (never fabricated zeros) and omit its activity charts. (Codex *does* record
  activity — `~/.codex/sessions` rollout logs — so it shows full stats.)
- **Codex token accounting is subset-based, not disjoint like Anthropic's.** Codex
  `cached_input_tokens` ⊆ `input_tokens`: total = input + output (never + cached),
  cache hit rate = cached/input, and cached is billed at the cache-read rate
  (non-cached input at the input rate). The Anthropic-style additive sum inflates
  tokens ~2x and cost ~6.6x. Bucket Codex per-day data by **UTC** timestamps (its
  session directories are named in local time).
- Empty/error limit states cross the wire as **enum reason codes**
  (`limitsDiagnostic` in `/api/state`); the client maps codes to copy and escapes
  the few free-form fields. The server knows the cause — the client never guesses.
  A non-null diagnostic can coexist with rendered gauges (`stale-reading`).
  **Client enum→copy tables must use own-key lookups** — gate every code→copy
  table with `Object.prototype.hasOwnProperty.call(TABLE, code)` (or a
  null-prototype object), never a bare `TABLE[code] || fallback`. A bare bracket
  lookup also hits `Object.prototype` keys (`constructor`, `toString`,
  `__proto__`), so an unexpected code can bypass the fallback, throw mid-render,
  or leak `[object …]` into copy.
- `auto-refresh-failing` (with a `cause`: `spawn-error` / `timeout` /
  `parse-failed`) and `auto-refresh-disabled` are the **live** diagnostic codes
  for the Claude `/usage` auto-refresh probe — no longer reserved. The cause
  crosses the wire as an enum; the client never renders it raw.
- **Freshness thresholds are server-supplied** in the API payload (`freshness`
  on the tool object); the client derives display bands live from them on the
  render tick and never hardcodes threshold values.
- The startup data-source health readout lives in `src/health.js`
  (`healthLines()`): a new tool/source adds a line there naming what's missing,
  why it matters, and the fix. Health probes are cheap fs checks — no subprocess,
  never on the request path.

## Serving & UI
- Responses carry baseline security headers. The CSP allows `style-src
  'unsafe-inline'` (the UI sets dynamic widths/colors via inline styles) while
  `script-src` stays `'self'`. Keep style values to literals or coerced numbers —
  never interpolate untrusted input into a style or raw HTML (escape text).
- Static assets are served `cache-control: no-store` so code changes show on a
  plain refresh.
- Charts are plain SVG built into `innerHTML`. Verify the UI actually **renders**
  (not just that the page loads) — a blank-bar regression once passed a
  "page loads" check.
- **Verify an artifact the way its host actually runs it, not just the way a test
  is convenient.** This generalizes the "renders, not just loads" rule to
  out-of-process / host-run artifacts. The menu-bar badge passed every unit test
  while blank in the real menu bar because tests spawned `node <realpath>` but
  SwiftBar runs it through a wrapper/symlink (ESM de-symlinks `import.meta.url`
  but not `argv[1]`, so the entry-point run-guard never fired). For anything a
  foreign host invokes, exercise the **real invocation path** (wrapper/symlink) in
  a test and once at deploy — the convenient path can hide a host-only defect.
  This also catches **behavioral** host-only gaps, not just blank output: a
  "byte-for-byte unchanged" invariant over-applied to hide the one *new* affordance
  that must be reachable in that state (single-host mode shipped with no
  `＋ Add host…`, so a fresh machine couldn't add its first host) passed every unit
  test and was only visible in the installed badge — a "same output AND the new
  affordance present" guard replaced the whole-output equality check.
- **A value that flows into a menu-bar (SwiftBar/xbar) line must be sanitized for
  *that* grammar before output**, config-derived values included — not only wire
  payload text. A SwiftBar param list is space-separated after `|`, so a stray
  space in a `href=` value (built from `LLMDASH_BADGE_HOST`/`LLMDASH_PORT`) can
  append a second param — including the arbitrary-command `bash=`/`shell=`. Strip
  whitespace and `|` (`sanitizeHostPort`); a real host/IP/port never contains
  them. This is the menu-bar form of "never interpolate untrusted input into raw
  output."

## Running & Testing
- `npm start` (or the `llmdash.service` systemd user service). Tests: `npm test`
  (node:test).
- **An installer/setup step must never dirty the tracked checkout.** Generate
  machine-specific artifacts (a wrapper that `exec`s an absolute node against the
  tracked plugin) *beside* the tracked source — never rewrite a tracked file in
  place. A rewritten tracked file makes `git pull --ff-only` abort on re-run, so
  the installer stops being safe to re-run (this is why the badge install baking
  an absolute-node shebang into the tracked plugin was replaced by a generated
  wrapper). Make a setup step idempotent; make its inverse marker-gated (delete
  only a symlink or a marker-carrying generated file, never a user's own file).
- **Install/setup tests must be hermetic** — pin machine state through an override
  (`LLMDASH_SWIFTBAR_DIR`) rather than reading the real user's config, or the
  suite leaks into and depends on the dev's real machine (`defaults read` ignores
  `$HOME`; the install tests went red once SwiftBar was actually installed).
- Claude limit data comes from either the statusline (`scripts/statusline.js`
  writing the reading file) or the auto-refresh `/usage` probe; the latter needs a
  resolvable `claude` binary (`LLMDASH_CLAUDE_CMD`, surfaced by `healthLines()`).
