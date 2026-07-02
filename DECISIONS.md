# Decisions — llmdash

## Menu-bar badge — a SwiftBar plugin, delivered via a wrapper, single host — 2026-07-02 (feature)
**Decision (mechanism):** The macOS menu-bar surface is a **SwiftBar/xbar
plugin** — a zero-dependency Node script rendered by a user-installed menu-bar
host — **not** a native compiled app or an Electron shell. SwiftBar
(`brew install --cask swiftbar`) is a **disclosed user prerequisite**, never
auto-installed. The plugin is a pure consumer of the existing `/api/state`: it
recomputes no limits and opens no second data path.
**Decision (delivery model):** `--setup-badge` writes a **generated POSIX-sh
wrapper** into SwiftBar's plugin dir that `exec`s an absolute node against the
**tracked** plugin — chosen over baking the absolute-node shebang into the
tracked source and symlinking it in. `--remove-badge` reverses it; removal is
**marker-gated** (deletes only a symlink or a wrapper carrying the
`llmdash-menu-bar-badge` marker), never a user's own unmarked file.
**Decision (scope):** Ship a **configurable single host** (`LLMDASH_BADGE_HOST`,
default loopback) so the badge can read a dashboard on any tailnet machine.
**Multi-host** (a host list with per-machine dropdown grouping and glyph
switching) is **deferred**; the plugin is built so a host list slots in without
a rewrite.
**Rationale:** SwiftBar keeps a real native menu-bar surface *inside* the
project's zero-dependency / no-build constitution — a compiled app or Electron
would violate it and add a toolchain. The wrapper was forced by a real deploy
defect: baking the shebang into the tracked plugin dirtied the git checkout, so
the installer's "safe to re-run" `git pull --ff-only` aborted; the wrapper keeps
the tracked source pristine (the badge auto-updates on pull), self-heals an old
baked shebang, and marker-gated removal makes uninstall non-destructive. The
single-host scope keeps the one-glance glyph unambiguous; multi-host is real
scope, not a config flag, so it was kept out deliberately.
**Implications:** The badge inherits the fresh-by-default reading and respects
the freshness bands (five honesty states miniaturize the dashboard's language;
a C/X cue names the binding tool). The wrapper pattern is the template for any
future machine-specific install artifact (never rewrite a tracked file in
place — it breaks re-runnable `git pull`). Multi-host and a tmux/terminal
statusline emitter are logged on the roadmap as the two follow-ons this feature
surfaced. Security PASSED WITH NOTES: one Low fixed in-stage (operator
`LLMDASH_BADGE_HOST`/`LLMDASH_PORT` flowed unsanitized into the clickable
`href=` line where a stray space could append a `bash=` param — fixed with
`sanitizeHostPort()` stripping whitespace + `|`, now a CLAUDE.md convention),
two Informational accepted (an uncapped response body bounded to one short-lived
tick; a hostile numeric field rendering as inert text — both requiring an
in-model-excluded impersonating peer).

## Claude reading now auto-refreshes via a /usage screen-scrape probe — 2026-07-02 (feature)
**Decision:** Ship [R2-scrape]: when the Claude reading is older than the
freshness threshold **and** Claude has been active recently, the interval
poller spawns a short-lived Claude Code session in a dedicated cwd, sends
`/usage`, scrapes the rendered pane into the same reading file the statusline
writes, and tears the session down. Zero usage-quota cost (a client-side slash
command submits no message — the probe's own pane reads 0 tokens),
activity-gated (no idle spawning), on by default, switchable off. Failure
degrades honestly through the reserved diagnostic codes: `auto-refresh-failing`
(with a cause: `spawn-error` / `timeout` / `parse-failed`) and
`auto-refresh-disabled`, both landing on the existing freshness-cue surface
with gauges still rendering the last capture.
**Rationale:** This **supersedes** the 2026-07-01 "auto-refresh refuted"
conclusion — but only the half that was actually refuted. The
statusline-payload avenue **is** dead (re-confirmed on CLI 2.1.198: neither
`/status` nor `/usage` populates `rate_limits` in the statusline payload; the
roadmap's named `/status` revival question is answered NO with evidence). What
the prior spike never tested was whether the same data renders *on screen*: it
does. `/usage` renders both contract windows in a spawned, transcript-free,
zero-usage session, and the scraped pane parses into a `rate_limits`-equivalent
reading whose reset instants matched the authoritative statusline epochs
**exactly** (the decisive cross-check). The assumed transport was the
statusline; the requirement was per-window used% + a capture timestamp
cross-checked for agreement — the scrape delivers all three. This closes the
desktop-app staleness problem: on a desktop-only day of active use the reading
stays inside the aging band with no manual CLI ritual.
**Implications:** Two Claude-owned-file boundary exceptions were surfaced by the
spike and **ratified by the user** at design review: one permanent trust entry
in `~/.claude.json` for the dedicated cwd (`~/.llmdash/claude-refresh-cwd`,
created once), and ~1 line per refresh appended to `~/.claude/history.jsonl`.
Both are performed by Claude Code itself in response to input llmdash sends
(llmdash writes no Claude-owned path), both are disclosed loudly in the startup
log and README, and the off-switch stops all of it. `/usage` also renders a
**third meter** — *Current week (Fable)*, a per-model promotional weekly cap
absent from the two-window statusline contract — deliberately **not** scraped;
recorded as a possible future source-aware addition (see ROADMAP). The scrape
is a **version-brittle TUI parse** (screen layouts change between CLI versions,
dropped characters observed) and fails **loudly** as `parse-failed` rather than
emitting a partial or fabricated reading — the parser is the accepted fragile
surface. `capturedAt` is the pane-capture moment (never parse time);
newest-`capturedAt`-wins so a probe write can never regress an organic
statusline write. Security PASSED WITH NOTES (four Informational findings, none
blocking): one resolved in-stage (the client cause→sentence lookup honored
inherited `Object.prototype` keys — fixed to an own-key guard, now a CLAUDE.md
convention), two accepted (a theoretical pid-reuse window in teardown; the
attempt-spacing floor inheriting the freshness knob's absent lower clamp — both
local-single-user posture). **Accepted OPEN follow-up:** an ungraceful llmdash
exit mid-probe can orphan one probe session and leave a stale typescript;
remediation is a SIGTERM/exit teardown hook plus a startup stale-typescript
sweep — a deliberate engineering change, tracked on the roadmap, not this
feature's scope. Anything downstream (menu-bar badge, limit alerts) now
inherits a fresh-by-default reading while still respecting the freshness bands.

## Statusline auto-refresh refuted by spike; honest freshness layer shipped — 2026-07-01 (feature)
**Decision:** Drop the auto-spawn mechanism (periodically spawning a headless
Claude Code CLI session so the statusline refreshes the limit reading) and ship
the named fallback: a reading-age cue in the Claude tool header, an "aging"
flag past 5 minutes and a "stale" flag past 10 with a note naming the
CLI-session remedy, stale gauges kept rendering (never blanked), and honest
startup/README statements of the manual-refresh reality.
**Rationale:** The Stage 3 spike empirically refuted the mechanism: a
prompt-free Claude Code session (CLI 2.1.198) never receives `rate_limits` in
its statusline payload — the reading arrives with API traffic, not session
startup (statusline confirmed executing; 48 s and 150 s watches both empty;
evidence in `pipeline/statusline-auto-refresh/spike-report.md`). The
launchd-style background context itself was workable; the payload is the
blocker. The 5m/10m bands are the user's product decision at design review
(tightened from the planned 15m/60m — a heavy session can burn the whole
5-hour window in under an hour); stale is always 2× the single
`LLMDASH_CLAUDE_MAX_AGE_MS` knob (default 300000, clamped both directions
with a 7-day ceiling).
**Implications:** Auto-refresh is refuted for now, not forever — the one
untested revival avenue is whether `/status` (a client-side slash command,
not a message) populates `rate_limits`; `auto-refresh-failing` /
`auto-refresh-disabled` are reserved diagnostic-code names so a revival slots
in without a contract break. Anything built on Claude limit readings (limit
alerts, tray badge) inherits the manual-refresh reality and should respect
the freshness bands. Security review PASSED after an in-stage resolution
round: the raw `capturedAt` string was served and persisted verbatim (a
latent stored-XSS vector — now normalized to canonical ISO at ingest) and the
knob lacked an upper clamp (2× could overflow to `Infinity` → `null` on the
wire); both fixed by the Engineer and independently re-verified with hostile
probes (73/73 tests).

## Fresh install showed no usage data — installer, logging, and copy made honest — 2026-07-01 (fix)
**Bug:** A fresh macOS install showed four empty gauges and misleading text,
all silently — no data, no log lines, and a Codex note that was factually false
("doesn't record usage locally"; "the limits above are live" over em-dashes).
**Cause:** Three stacked causes: (1) `scripts/install-macos.sh` fell back to a
bare `codex` command in the launchd plist when codex wasn't on PATH at install
time — unresolvable under launchd's minimal PATH
(`/usr/bin:/bin:/usr/sbin:/sbin`) — and the spawn failure was swallowed
unlogged; (2) Claude limit gauges wait forever if no Claude Code session ever
renders the statusline (the trigger on this machine is inferred — not proven —
to be desktop-app usage, so all shipped copy says "no reading has arrived yet",
which is true either way); (3) the Codex empty-activity copy was wrong on both
counts.
**Resolution:** The installer resolves codex to an absolute path (probing
`~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`), warns loudly with the
exact remedy when unresolvable, gained a read-only `--resolve-codex` hook, and
sets first-run expectations for the Claude gauges; the plist example documents
the absolute-path requirement. New `src/health.js` powers a startup data-source
health readout; `src/codex-limits.js` logs spawn failures once per distinct
cause; `/api/state` carries per-tool `limitsDiagnostic` reason codes
(`no-statusline-reading` / `codex-cmd-failed` / `no-reading`) that the UI maps
to honest, actionable empty states (free-form fields escaped). Verified by QA
(48/48 plus a real-browser render check); security PASSED WITH NOTES, nothing
blocking.
**Implications:** Only the source shipped (push to main) — the installed copy
(`~/llmdash`) was deliberately left untouched, so its Codex gauges stay dead
until the installer is re-run there; known and chosen. Accepted informational
security notes: the allowlisted codex path + errno cross the tailnet in
`/api/state` (fine for the single-user threat model), and the installer's
pre-existing sed/plist metachar fragility stands. **Open:** whether codex-cli
0.142.5 still writes rollout session files is unverified (zero sessions on this
machine) — if it stopped, `src/codex-stats.js` has a latent compatibility
break; the 2026-06-17 "Codex records activity" decision stands as written until
checked.

## Dashboard unreachable over Tailscale — tunnel was down; banner/docs made honest — 2026-06-22 (fix)
**Bug:** The dashboard was unreachable in a browser from another tailnet device;
the host's Tailscale IP (`100.82.9.81:8787`) timed out (~4s) while loopback and
the LAN IP both served HTTP 200.
**Cause:** Operational, not code — the host's `tailscale0` TUN interface was
DOWN (no IPv4 assigned, no tailnet routes), so the tailnet IP was unroutable and
packets leaked to the LAN gateway. The server's `0.0.0.0:8787` bind and ufw were
both fine; the initial "open the firewall for 8787" framing was wrong (a
default-deny would also have blocked the LAN IP, which worked).
**Resolution:** The tunnel recovered (`tailscale0` back UP), restoring
reachability — confirmed end-to-end from the peer. No code change was needed to
fix reachability. Separately, so a future tunnel-down day reads clearly instead
of looking like a wrong URL, the startup banner and docs were made honest: a new
zero-dependency detector (`src/net.js` `tailnetIPv4`, reads
`os.networkInterfaces()` for the `100.64.0.0/10` range) prints the real
reachable tailnet URL with a "use http, not https" note, gated so a
loopback-only bind no longer advertises a dead URL; the README and macOS
installer lost their `<…tailscale-name>` placeholders.
**Implications:** Reachability surfaces should print a real, detected URL (reuse
`tailnetIPv4`), state http-not-https, and never advertise a URL the current bind
doesn't serve — reinforcing the existing "surface network binding in the startup
log, never silently" convention. **Open (operational, not code):** unknown
whether `tailscale0` comes up DOWN again after a reboot; if it recurs, inspect
the `tailscaled` unit/flags and any NetworkManager/`enp0s5` race on this
Parallels VM.

## Weekly pacing + Codex stats expanded; "Codex has no usage data" corrected — 2026-06-17 (feature)
**Decision:** Show both the 5-hour and weekly pacing predictors at once for each
tool (status pills; "limit reached" is per-window), and EXPAND Codex token stats —
superseding the 2026-06-16 conclusion that "Codex records no per-token usage
anywhere readable."
**Rationale:** A re-audit found Codex CLI v0.140.0 *does* write per-session rollout
JSONL under `~/.codex/sessions` with `token_count` events; the "not available"
state was a parser bug (it read tokens at the wrong nesting level —
`payload.info.last_token_usage` holds the per-turn delta), not missing data.
Verified by independently re-deriving the weekly totals from the raw logs.
**Implications:** Codex now shows real token activity and trends. Codex token
accounting is subset-based, not disjoint like Anthropic's (see CLAUDE.md):
`cached_input_tokens` ⊆ `input_tokens`, so total = input + output, cache hit rate =
cached/input, and cached is billed at the cache-read rate — the naive additive sum
inflates tokens ~2x and cost ~6.6x. Per-day Codex buckets use UTC (its session dirs
are local-named, timestamps UTC). Pacing is derived on demand (no schema change).
The prior "limits-only" decision now holds only if a future Codex build stops
writing rollout logs. Status pills (`.burn-pill`, `--good-bg`/`--crit-bg`) are a new
design-system component (see `pipeline/design-system.md`).

## Codex provides limits only; quota display hardened — 2026-06-16 (fix)
**Bug:** Codex activity showed fake `0`/`$0`; a maxed weekly quota wasn't
surfaced (burn said "on pace to stay under the 5-hour"); the headroom strip never
appeared.
**Cause:** Codex (this build) records no per-token usage anywhere readable — no
session rollout logs, and its internal `threads`/`thread_goals` tables are empty
(verified via a WAL-merged snapshot). Separately, the maxed-window display and the
headroom logic only ever considered the 5-hour window.
**Resolution:** Show Codex token activity as "not available" (no fabricated
zeros), and Codex trends as limits-only. A maxed window (≈0 remaining) now reads
"limit reached" and is the binding signal in the burn callout. `computeHeadroom`
and the limit display consider **both** windows. If a future Codex version
populates `threads.tokens_used`, activity could be revisited.

## Scope: Claude Code + Codex only; Kagi dropped — 2026-06-16
**Decision:** Track Claude Code now and Codex next; do not include Kagi.
**Rationale:** Feasibility research showed Kagi Ultimate is unlimited (no meter),
and only developer-API credit is readable — a different concept. Claude Code and
Codex both expose the real 5-hour and weekly subscription windows.
**Implications:** The product is built around time-window meters; Kagi would need
a separate, confusing widget.

## Use sanctioned data paths, not OAuth-token reuse — 2026-06-16
**Decision:** Read Claude Code limits via its statusline output, not by calling
the usage endpoint with the OAuth token.
**Rationale:** Anthropic's Feb-2026 policy bans subscription-OAuth reuse in
third-party tools. The statusline path is sanctioned and risk-free.
**Implications:** Limits reflect the latest Claude Code render, not a free-running
poll. Accepted.

## Vanilla, zero-dependency stack — 2026-06-16
**Decision:** Plain Node + `node:sqlite` + vanilla HTML/CSS/JS, no framework or
build step. Reversed the initial React/Tailwind/shadcn pick.
**Rationale:** A personal single-user tool; simple, fast, and library-light was
the explicit goal.
**Implications:** Charts (feature 3) will use vanilla SVG.

## Self-logged history, no backfill — 2026-06-16
**Decision:** Limit history accrues from first run via snapshots; no backfill.
**Rationale:** Neither data source provides limit history.
**Implications:** Trend charts start empty and fill forward.

## Multi-source architecture — 2026-06-16
**Decision:** The dashboard is source-aware — each tool is a `source` in one
schema and one set of UI components, with a cross-tool headroom cue. Codex limits
come from its app-server (polled); Claude from its statusline.
**Rationale:** Adding tools should be additive, not a fork; the product's value
is cross-tool comparison ("switch when one maxes out").
**Implications:** A third tool slots in as a new source + reader, with no schema
or UI redesign.

## Inline-style CSP + no-store static assets — 2026-06-16
**Decision:** Allow `style-src 'unsafe-inline'` (script-src stays `'self'`) and
serve static assets `cache-control: no-store`.
**Rationale:** The UI sets dynamic widths/colors via inline styles, which the
strict CSP from feature 1 was silently blocking (blank bars). No untrusted input
reaches a style value, so the relaxation is safe; no-store prevents stale-asset
confusion on refresh.
**Implications:** Keep style values to literals/coerced numbers; never interpolate
untrusted input into style or HTML without escaping.

## Don't reproduce /usage's "what's contributing" insights — 2026-06-16
**Decision:** Exclude the subagent-heavy / high-context / long-session
percentages.
**Rationale:** They are Claude Code's internal analysis; recomputing them from
logs diverges materially and would conflict with `/usage`. Honesty over feature
count.
