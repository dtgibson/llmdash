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
- **Runtime prefs are `!`-directives in `hosts.conf` (the `!local=` / `!display-*`
  family), and the writer round-trips ALL of them.** The badge's display prefs live
  as `!display-hosts` / `!display-layout` / `!display-density` / `!display-group` /
  `!display-tool-mark` lines alongside `!local=` — same directive parser, same
  seed-once/degrade discipline (an unknown value → the axis default + a `bad-*`
  error surfaced in health, never a crash; an unknown `!display-*` → the existing
  `unknown-directive` path). Two rules keep it honest: (1) **the writer round-trips
  every directive** — a display edit preserves host entries + `!local` + the other
  axes, and an Add/Remove preserves every `!display-*`; drop this and one edit
  silently wipes an unrelated pref. (2) **Default-valued axes are omitted from the
  file**, so an unconfigured file stays byte-for-byte (the file-level form of the
  byte-for-byte-when-unconfigured guard) and an opt-in axis like
  `!display-tool-mark=logo` is opt-in at the file level too. **Host-list keys stay
  CASE-PRESERVED** (they are case-sensitive identities that must match the badge's
  `addr` = `sanitizeHostPort(host):sanitizeHostPort(port)`); only the *enum* axes
  lowercase. A blanket `.toLowerCase()` on the stored host keys was the QA bug — a
  mixed-case `.local` Bonjour key wrote case-preserved, read lowercased, failed the
  intersection, and silently fell back to `all`; read/write/`addr` must all be
  case-consistent.
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
- **A LaunchAgent reload is an observed state transition, never a bare
  `bootout` → `bootstrap` pair.** Keep the main installer and `--service install`
  on the shared `install-macos.sh` loader. After an idempotent user-domain
  `bootout`, poll `launchctl print gui/<uid>/<label>`: status `0` is still
  registered, status `113` alone is absent, and any other status fails before
  bootstrap. Retry only bootstrap status `5`, once; persistent `5` and unrelated
  statuses fail, and keep every poll/retry path finite.
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
- **A visible change to a shipped default that every user sees is ratified +
  disclosed, never silent.** The badge's default tool cue swapped `C`/`X` → `◆`/`▲`
  (diamond = Claude, triangle = Codex) — this alters the always-on glyph of every
  current user, so it was user-ratified, disclosed in the README + `healthLines()`,
  the byte-for-byte guard was **updated** to "unchanged save the ratified cue" (not
  loosened away), the shipped tests' expected strings were **updated to the new cue
  (never reverted to `C`/`X`)**, and a **pin test** locks the new default so a
  future silent revert is caught. A default diff that lands unannounced reads as a
  regression; ratify it, disclose it, and pin it.
- **Surface security-relevant defaults** (e.g. network binding) in the README and
  the startup log — never silently. Treat `0.0.0.0` as **LAN plus tailnet**
  exposure, never tailnet-only; when adding privacy-sensitive aggregates, disclose
  that reachability and preserve the `127.0.0.1` local-only option.
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
- **Badge display is a pure presentation layer over `computeMultiBadge`, never a
  data-model or `/api` change.** The badge's display axes (group × hosts × layout ×
  density × tool-mark) are applied by a pure `applyDisplay(multi, display,
  {epochMs})` over the existing per-host `hostViews` — `computeMultiBadge`, the
  fetch, `/api/state`, and `/api/hosts` stay byte-for-byte unchanged; a display
  view reads only `hostViews`, and if an axis *appears* to need a new payload
  field that is a flag to raise, not a silent contract coupling. An unconfigured
  badge routes to the shipped `emit`/`emitMulti` path **byte-for-byte, save the one
  ratified cue change** (see the `◆`/`▲` swap below). A new display axis extends
  `applyDisplay`, never the store or the contract.
- **A per-tool aggregate is a presentation regroup over `hostViews`, scoped to the
  selected hosts** — the same binding-min the badge already computes per host×tool,
  now the tightest-window minimum-remaining across the *selected* machines for one
  tool, carrying that window's freshness state. Honesty is structural: no reading
  on any selected host → `—`, every contributing host offline → `⊘`, **never a
  fabricated zero**; exactly two units (Claude / Codex), so no cap in tool mode.
  In compact side-by-side tool mode, the title keeps a fixed Claude-then-Codex
  order and shows each tool's `five_hour/seven_day` remaining pair (`◆ 12/38 ▲
  63/61`); binding/color still come from the tightest aggregate. The Hosts
  view-filter still scopes which machines feed the aggregate (grouping by tool
  never discards the host selection).
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
  Destructive process control captures PID, kernel birth time, PGID, and session
  while ancestry is intact, then freshly revalidates that identity before **every**
  positive-PID TERM/KILL; PPID may change after reparenting, but missing or changed
  stable identity fails closed, and negative-PGID signaling is forbidden when group
  membership cannot be proven atomically. This is the codebase form of the
  zero-shell-injection and identity-bound teardown rules.
- Limit and headroom logic consider **all windows** (5-hour and weekly), not just
  one. Each tool shows a pacing predictor for **both** windows at once; a maxed
  window (≈0 remaining) reads "limit reached" and is binding **per window** (one
  maxed window never suppresses the other's pacing line).
- **Provider window identity follows explicit evidence, and a complete live
  response is authoritative for the current window set.** For Codex, a
  duration-bearing positional window maps 300 minutes to `five_hour` and 10,080
  minutes to `seven_day`; an unknown explicit duration stays unavailable, while
  explicitly named legacy fields keep their declared identity and positional
  fallback is allowed only when duration metadata is absent. Per-window snapshot
  rows are history for Trends, not proof that a window still exists now, so they
  must never fill a slot omitted by a complete current response.
- If a tool genuinely lacks token activity, render an honest "not available" state
  (never fabricated zeros) and omit its activity charts. (Codex *does* record
  activity — `~/.codex/sessions` rollout logs — so it shows full stats.)
- **Codex token accounting is subset-based, not disjoint like Anthropic's.** Codex
  `cached_input_tokens` ⊆ `input_tokens`: total = input + output (never + cached),
  cache hit rate = cached/input, and cached is billed at the cache-read rate
  (non-cached input at the input rate). The Anthropic-style additive sum inflates
  tokens ~2x and cost ~6.6x. Bucket Codex per-day data by **UTC** timestamps (its
  session directories are named in local time).
- **Financial comparisons keep source semantics separate and arithmetic exact.**
  Owner financial configuration is explicit, local, and owner-confirmed; a plan
  label or quota response never infers spend, and missing evidence stays
  partial/unavailable rather than becoming zero. API-equivalent counterfactuals
  use exact model IDs and reviewed effective-date intervals (never family/latest
  fallback or pre-launch back-projection), price one shared comparison record set,
  and use fixed-point aggregation before one canonical display rounding. Keep
  configured spend, estimated API value, and signed cache effect distinct; never
  relabel them as invoices, charges, or generic savings.
- **Structured-log analytics are aggregate-only, capability-gated, bounded, and
  cache-served.** Raw content, paths, payloads, and identifiers may exist only as
  ephemeral parser keys; API records carry normalized aggregates and bounded
  labels. A structurally valid timestamped observation proves support, an explicit
  zero remains zero, and absent/malformed evidence remains unavailable. Scanners
  need finite traversal/byte/event/result/cache budgets and atomic last-good cache
  replacement; a missing root is authoritative empty while transient read failures
  retain the prior complete view. New local JSON/JSONL readers enforce bounds at
  the actual I/O boundary: open the final file descriptor with no-follow semantics,
  validate regular-file identity and size from the descriptor, cap bytes before
  allocation, revalidate before publication, and enforce directory/record/time
  ceilings before cache insertion. A pathname `lstat` followed by a separate
  pathname `open` skips static symlinks but is **not** a race-free no-follow
  guarantee: if same-user ancestor replacement is in scope, use descriptor-relative
  traversal; otherwise document the narrower boundary.
  Parse caches shared by several ranges retain the widest active horizon, and HTTP
  handlers never trigger a scan.
- **Sparse account facts carry evidence age.** Plan/credit fields observed on a
  live account response expire after a bounded TTL, and an explicit plan change or
  unknown plan clears facts that could belong to the prior account. Display-bound
  external strings must strip Unicode control/format/line-separator characters in
  addition to HTML escaping; adjacent account facts use bidi isolation.
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
  output." **Sanitize at the compose helper too, not only at ingest:** a
  presentation helper that composes a menu-bar cell (`truncateHostCue`,
  `growPrefixCues`) re-`sanitize()`s its input, so a future un-ingested caller
  can't silently reopen the SwiftBar-grammar injection class — defense in depth,
  symmetry across every cue path, not a substitute for ingest sanitization.
  Long non-action explanatory/diagnostic copy is the same surface: sanitize it,
  then bound it through a shared wrapping helper before it reaches SwiftBar/xbar,
  including splitting one very long token so a bad host name cannot force a huge
  menu. Keep action rows (`href=`, `shell=`, `bash=`, refresh, submenu controls)
  explicitly constructed and separate from wrapped text; tests should prove row
  width stays bounded and wrapped text cannot smuggle action params. SwiftBar/xbar
  status-bar output has exactly one title line before the first `---`; all
  explanatory, diagnostic, and scope copy belongs below that separator so compact
  glyph settings cannot widen the menu bar. The current five-state badge grammar
  is: fresh = bare number, aging = `◷` clock marker, stale = `⚠`, no reading = `—`,
  offline = `⊘`; use `·` only as a separator (host/tool/scope), not as an aging
  signal. Dropdown text that carries normal information (top summaries, scope rows,
  host/tool headers, per-window detail rows, Display/Legend labels, and Legend
  samples) uses explicit dark dropdown colors plus the fixed
  `bash=/usr/bin/true terminal=false refresh=false` no-op so SwiftBar renders the
  rows as enabled readable text instead of disabled gray. The no-op is allowed
  only through the shared text-row helper; real action rows stay explicitly
  constructed. The Legend must explain every visible mark the badge can emit
  (`▪`, `·`, `▸`, `◆`, `▲`, `◷`, `⚠`, `—`, `⊘`, compact host cues, overflow,
  and menu/action marks) while action rows stay explicitly constructed.
- **A brand / third-party visual asset is opt-in, with a guaranteed neutral
  fallback the honesty never depends on.** The optional tool logos are OFF by
  default; the neutral `◆`/`▲` text marks are the guaranteed fallback identity
  floor for xbar, non-SwiftBar output, and any logo read/decode/encode failure.
  In successful SwiftBar logo mode, the logo is a true drop-in replacement for
  those visible marks: generate the same-color local image first, then strip the
  text mark from the title only after image generation succeeds. The asset is a
  passive **local `node:fs`** read (no network, no `import()`, no eval), resolved
  via `import.meta.url` so it works under the wrapper/symlink, read **only** when
  opted in, and emitted as passive base64 image data. Bundled brand marks must be
  small monochrome local source images with source/license/trademark notes in the
  asset `LICENSE.md`; Codex uses the OpenAI mark because Codex is an OpenAI
  product. Size single-tool marks for the status bar (currently 16x16). When
  SwiftBar side-by-side needs multiple tool logos plus values on one title line,
  compose the full compact title as one local PNG image because SwiftBar's single
  title image slot is not inline; keep the same order as neutral side-by-side:
  `▪`, Claude logo, Claude 5-hour/weekly, Codex logo, Codex 5-hour/weekly. Do not add a first-use
  fetch or runtime logo download — the code's honesty invariants hold only when
  the fallback text identity and local-only read stay structural.

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
