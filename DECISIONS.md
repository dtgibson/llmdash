# Decisions — llmdash

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
