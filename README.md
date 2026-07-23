# llmdash

A small, self-hosted dashboard for your AI coding usage limits, viewable on your
phone or laptop over Tailscale. Zero dependencies, plain Node and vanilla
HTML/CSS/JS.

It tracks **Claude Code** (Max) and **Codex** (using the plan reported by the
live Codex quota response) side by side: each
tool's 5-hour and weekly limit windows with reset countdowns and a burn-rate
projection, plus activity stats from your local logs (tokens, cache hit rate,
sessions, and token mix). When one tool maxes out, a headroom
cue points you to the one with room left. A **Trends** section below the gauges
charts usage over time — limit burn, tokens per day, and cache hit rate —
with a 24h / 7d / 30d switch. Codex also has an independently ranged insights
section for reasoning share, turn/session size, model/effort/tool mix, context
pressure, compactions, explicit latency, busiest day, and daily patterns; it is
derived locally from bounded structured aggregates and never exposes session
content or identifiers.

A separate **Cost analysis** surface compares three values over 7, 30, or 90
local calendar days: owner-confirmed subscription access cost, API-equivalent
value at the cache behavior recorded in local logs, and the same supported
records repriced without caching. These values stay separate; API-equivalent
figures are estimates, not provider charges or invoices. Combined, Claude, and
Codex totals reconcile to cumulative charts, while partial scans, unknown exact
model rates, and missing subscription periods remain visibly partial or
unavailable instead of turning into zero.

## Why
Claude Code's limit meters live inside the tool and are easy to lose track of.
This puts the real, authoritative numbers one glance away, from any device on
your tailnet, so you can pace your work and stop getting throttled mid-task.

## Requirements
- **Node 24+** (uses the built-in `node:sqlite`). No packages to install.

## Run it
```
npm start
```
Then open it:
- On this machine: <http://localhost:8787>
- From another device on the tailnet: `http://<your-tailscale-ip>:8787` — use **http, not https**. Find the IP with `tailscale ip -4`, or use the machine's MagicDNS name. (The startup log prints the exact URL.)

To keep it running across reboots, install it as a systemd user service (a sample
unit is described below), or use your preferred process manager.

## Connect the limit data (one-time)
The limit gauges read from Claude Code's statusline. Point Claude Code at the
included script by adding this to `~/.claude/settings.json`:
```json
{
  "statusLine": {
    "type": "command",
    "command": "node /absolute/path/to/llmdash/scripts/statusline.js"
  }
}
```
The gauges populate the first time a reading arrives — a Claude Code session
rendering its status line captures one, and auto-refresh (below) captures one
automatically within a few minutes of Claude activity. Until then they stay
empty and the dashboard says so. The activity stats work right away either
way — they come from your local logs. The script still prints a normal status
line (model, folder, and 5-hour remaining), so you keep a useful status line.

### Reading freshness & auto-refresh
Claude limit readings arrive two ways. Any real Claude Code CLI session that
renders its status line captures one (the desktop app doesn't render the
statusline). And **auto-refresh** covers the rest: when the reading is older
than 5 minutes while Claude has been active in the last 10 (newest transcript
under `~/.claude/projects`), the dashboard spawns a **short-lived Claude Code
session** in a dedicated folder, reads its `/usage` screen, and closes it —
typically a few seconds of lifetime, at most one attempt per 5 minutes. The
probe types only the `/usage` command: **no message is ever sent, no plan
usage is consumed, and no transcript is written**, so your activity stats stay
clean. While Claude is idle the dashboard does zero refresh work — the reading
can't have changed, and the age label carries the truth. Failed attempts back
off (5 minutes doubling to a 60-minute cap), and after 3 consecutive failures
the UI says auto-refresh is failing and why.

Two Claude-owned files are touched, both written by Claude Code itself and
disclosed here and in the startup log: `~/.claude.json` holds a **one-time
"trust this folder" entry** for the probe's dedicated directory
(`~/.llmdash/claude-refresh-cwd`), and `~/.claude/history.jsonl` gains one
line (the `/usage` command) per refresh.

The dashboard never hides a reading's age: the Claude header shows it
("updated 7m ago"), and as the reading ages it picks up a status pill —
**aging** past 5 minutes, then **stale** past 10 minutes, with a note under
the gauges stating the age and the remedy. The gauges keep showing the last
capture — flagged, never blanked. The manual remedy always works too: open a
Claude Code CLI session and the next statusline render refreshes the reading.

The knobs (all optional):
- `LLMDASH_CLAUDE_AUTOREFRESH` — auto-refresh is **on by default**; set `0`
  (or `false`) to turn it off. Off means zero spawns, and a stale reading says
  "Auto-refresh is off" instead of failing silently.
- `LLMDASH_CLAUDE_CMD` (default `claude`) — the claude binary the probe runs.
  Under launchd this **must be an absolute path** (same reason as
  `LLMDASH_CODEX_CMD`); the macOS installer bakes it in.
- `LLMDASH_CLAUDE_REFRESH_TIMEOUT_MS` (default `30000`, clamped 5 s–5 m) — how
  long one probe may run before it's torn down and counted a failure.
- `LLMDASH_CLAUDE_MAX_AGE_MS` (default `300000` = 5 minutes) — the one
  freshness knob: the refresh threshold and the aging band; stale (and the
  activity window) is always 2× that and is not configurable separately.

## Connect Codex
Codex limits come from the **Codex app-server**, so the dashboard just needs to be
able to run `codex`. If you start it from your normal shell, that's automatic. If
you run it as a service, `LLMDASH_CODEX_CMD` **must be the absolute path** of your
`codex` binary (find it with `which codex`) — services run with a minimal PATH
(launchd: `/usr/bin:/bin:/usr/sbin:/sbin`), where a bare `codex` can never
resolve. The macOS installer resolves the absolute path for you (probing
`~/.local/bin`, `/opt/homebrew/bin`, and `/usr/local/bin` if codex isn't on
PATH); if you installed Codex *after* llmdash, just re-run the installer — it's
safe to re-run and bakes in the path. When the command can't be run, the
dashboard says so (startup log + UI) instead of failing silently.
Codex activity stats read from `~/.codex/sessions` and fill in as you use Codex.

## Reset & billing settings

Open the focused settings page on the same llmdash host you already use:

- On this machine: <http://localhost:8787/settings>
- From another tailnet device: `http://<your-tailscale-ip>:8787/settings` (or
  the machine's MagicDNS name; use **http, not https**)

The reset schedule is a fallback, not provider evidence. A current usable live
provider reset always wins. When that value is absent, llmdash can calculate the
next occurrence from an owner-saved weekday, local time, and IANA time zone,
including daylight-saving changes, and labels it **Configured**. Saving a
fallback never refreshes usage data or makes a stale percentage appear current.

There is **no generic reset default**. A clean data directory has no configured
fallback until its owner saves one. For this deployment only, and only after the
deployment approval gate, the explicitly confirmed value may be seeded by
opening the deployed `/settings` page and saving **Friday**, **23:00**,
**America/Los_Angeles** through the normal validated form. The app, installer,
and startup path do not silently seed that value for this or any other install.

The same page manages owner-confirmed Claude and Codex access costs as recurring
USD monthly plans. Each confirmed amount has an effective start and billing
anchor; llmdash expands it automatically month by month for Cost analysis.
Changing or cancelling a plan closes the prior record and appends immutable
effective-dated history. Anchor days 29–31 clamp to month end without drifting.
These are configured access costs, not provider charges or invoices.

The three backing resources are deliberately fixed:

- `$LLMDASH_DATA_DIR/account-config.json` (default
  `./data/account-config.json`) is the active reset and recurring-plan history.
  The settings form edits this file atomically with mode `0600`.
- `$LLMDASH_DATA_DIR/subscriptions.json` is the optional legacy schema-v1 source
  for explicit fixed periods. It remains read-only and is never migrated or
  rewritten by the settings form.
- `config/api-rates.json` in the checkout is the reviewed, tracked API rate card
  and remains read-only in the app.

The page provides fixed View and Download links, including over Tailscale. With
`<origin>` equal to the llmdash origin you opened (for example,
`http://100.x.y.z:8787`), the exact links are:

| Resource | View | Download |
|---|---|---|
| Active account configuration | `<origin>/api/config/reset-billing?resource=account-config&download=0` | `<origin>/api/config/reset-billing?resource=account-config&download=1` |
| Legacy fixed periods | `<origin>/api/config/reset-billing?resource=subscriptions&download=0` | `<origin>/api/config/reset-billing?resource=subscriptions&download=1` |
| API rate card | `<origin>/api/config/reset-billing?resource=rate-card&download=0` | `<origin>/api/config/reset-billing?resource=rate-card&download=1` |

Before the first save, the account-config resource correctly returns missing;
the settings page still shows the empty editable state. Paths displayed in the
page are informational only and are never accepted as request targets.

This is a deliberately narrow mutation surface. Configuration reads and saves
use only the exact `GET /api/config/reset-billing` and
`PUT /api/config/reset-billing` route. Both reads and saves require an authority
that belongs to the receiving local IP, localhost, this machine's host name, or
MagicDNS on an actual Tailscale destination, so a DNS-rebound website cannot read
the configuration or obtain a save token. A PUT must also come from the same HTTP
origin as the page and pass CSRF and version/ETag checks; cross-origin writes,
preflights, arbitrary paths, peer writes, and permissive CORS are not supported.
There is no app login or role model, so network reachability is the access
boundary—bind `LLMDASH_HOST` to your Tailscale IP if you want to exclude LAN
reachability too.

## Multi-host — optional
One llmdash can show **several of your tailnet machines** together — each host's
Claude Code + Codex limit windows and its per-machine activity, side by side, the
local machine included as one host. Set `LLMDASH_HOSTS` to a comma-separated list;
**unset, it behaves exactly as today** (one host — this machine).

```
LLMDASH_HOSTS="100.64.0.7=Desktop,100.64.0.9:8790=Work laptop"
```

Each entry is `host[:port][=label]`:
- `host` — a tailnet hostname or IP (the machine running llmdash).
- `:port` — optional; defaults to this instance's `LLMDASH_PORT` (8787).
- `=label` — optional display name; defaults to the host string. Labels may
  contain spaces (that's why the list is comma-separated).

The **local host is always included** and shown first, marked `you` — you never
list it (though listing `127.0.0.1`/`localhost`/your own tailnet IP is harmless;
it collapses into the one local entry and is read in-process, never re-fetched).

**What the multi-host view shows:**
- **Account limits, once.** Limits are your *account's* numbers, identical across
  machines signed in to the same account. When llmdash detects that two hosts
  share an account (their limit windows reset at the same times), it shows those
  meters **once**, in an "Account limits" banner — never N identical meters that
  would read as N independent budgets. A genuinely different-account machine shows
  its own meters in its own card.
- **Per-machine activity, per host.** Tokens, sessions, cache rate, and estimated
  value are genuinely per-machine, so each host card leads with its own activity.
- **An offline machine is named, not faked.** A host that's asleep or not running
  llmdash shows a plain callout ("… is unreachable — no response within 3s …")
  naming the host and the fix — never a stale meter, never fabricated zeros. The
  other hosts are unaffected.

**Outbound posture (read this).** With `LLMDASH_HOSTS` set, this instance issues
**outbound reads** — a new posture (it previously only served). It is deliberately
narrow and **tailnet-only**:
- Reads go **only** to the hosts you list — no discovery, no auto-enumeration, and
  never a host derived from a peer's response (no transitive fan-out).
- Only a **credential-free `GET /api/state`** is issued — no writes, no other
  method, no credentials, and a redirect is never followed.
- Each fetch is **timeout-bounded and body-capped**; every peer-supplied field is
  clamped/normalized/escaped before it reaches the page.
- Peer polling rides the **interval poller** (never the request path); the combined
  `/api/hosts` view is served from an in-memory cache. Peer readings are **not
  persisted** — each machine keeps its own history locally.

The three bound knobs (`LLMDASH_PEER_TIMEOUT_MS`, `LLMDASH_PEER_CONCURRENCY`,
`LLMDASH_PEER_BODY_CAP_BYTES`) are listed under [Configuration](#configuration).
The startup log states how many peers are configured and to which host:ports reads
will go (or, unset, that no outbound reads are issued).

## Menu-bar badge (SwiftBar) — optional
A one-glance remaining-% badge for your macOS menu bar: the **most-constrained
window** across Claude Code and Codex — and, when you watch several machines,
across **all of them** — updating on its own, with a dropdown that carries the
full picture (each machine's tools × windows, reset countdowns, freshness,
diagnostics). It's a tiny **zero-dependency Node plugin** (`scripts/menubar/llmdash.5s.js`)
that reads the dashboard's existing `/api/hosts` as the authoritative usage view.
It also makes one independent, optional read of the fixed
`/api/config/reset-billing` view so a local Claude weekly row can display a known
configured reset when current provider timing is unavailable. That second read
never supplies usage, changes freshness, or affects remote hosts. When you watch
just one machine, it behaves **exactly as a single-host badge**.

**SwiftBar is a prerequisite you install once — llmdash never installs it for you.**
It's a free third-party menu-bar host (the badge also works on xbar):
```
brew install --cask swiftbar
```
Open SwiftBar once and pick a plugin folder when it asks (e.g.
`~/Library/Application Support/SwiftBar/Plugins`).

**Install the plugin** — one command. It writes a small **wrapper** into
SwiftBar's plugin folder that runs the tracked plugin with an absolute `node`
path (the menu-bar host spawns it under a minimal PATH where a bare `node`,
especially under nvm, can't resolve — the same reason `codex`/`claude` need
absolute paths):
```
~/llmdash/scripts/install-macos.sh --setup-badge
```
The wrapper points at `scripts/menubar/llmdash.5s.js` in your checkout, so the
**tracked source is never modified** — re-running the installer (and its
`git pull --ff-only`) stays clean, and the badge auto-updates when you pull.

Prefer to do it by hand? Drop a small wrapper into your SwiftBar plugin folder
named `llmdash.5s.js` and mark it executable (use your absolute `node` path, from
`which node`):
```
printf '#!/bin/sh\nexec "%s" "%s" "$@"\n' "$(which node)" ~/llmdash/scripts/menubar/llmdash.5s.js \
  > "<your-SwiftBar-plugin-dir>/llmdash.5s.js"
chmod +x "<your-SwiftBar-plugin-dir>/llmdash.5s.js"
```
The `.5s.` in the filename is SwiftBar's refresh-interval convention (re-run every
5 seconds); change the number, not the pattern, to slow it down.

**Remove it** — one symmetric command. It deletes only llmdash's own wrapper (a
file it recognizes by a marker line) or a legacy symlink from an older install —
it never deletes the repo file, and never touches a real file you placed there
yourself:
```
~/llmdash/scripts/install-macos.sh --remove-badge
```
That removes the *badge*, not SwiftBar. If you want the host gone too, that stays
your explicit choice — llmdash never uninstalls it for you:
```
brew uninstall --cask swiftbar
```

**Point it at your dashboard.** By default the badge reads `http://127.0.0.1:8787`.
Two knobs, at the top of the plugin file or as environment variables (the only
config surface — each drives both the fetch and the *Open dashboard* link):
- **`LLMDASH_PORT`** (default `8787`) — match a non-default dashboard port.
- **`LLMDASH_BADGE_HOST`** (default `127.0.0.1`) — point the badge at a dashboard
  running on **another machine** (e.g. a Tailscale IP like `100.x.y.z`), since
  llmdash is often served over your tailnet. The badge still uses that host's
  `/api/hosts` for limits and its fixed reset-and-billing view only for optional
  local-Claude reset presentation; it never becomes an independent usage reader.

One more, for install only (not the runtime fetch): **`LLMDASH_SWIFTBAR_DIR`**
overrides where `--setup-badge` / `--remove-badge` look for SwiftBar's plugin
folder. Set it if your SwiftBar plugin directory isn't the default location and
isn't picked up automatically.

**Reading the glyph (single machine).** It reads `▪ <tool> <number><marker>`:
- `▪` — the stable llmdash mark (always there, so it's recognizable in the bar).
- **`◆` / `▲`** — which tool is tightest: **◆ = Claude Code, ▲ = Codex**. (These
  two neutral marks are the **default tool cue** — they replaced the old `C` / `X`
  letters. Two distinct silhouettes read better at menu-bar size; you can turn on
  real product **logos** instead — see [Display options](#display-options) — but the
  neutral marks are always the guaranteed floor.)
- The number is the lowest remaining % across both tools' windows, colored
  **green / amber / red** by how much is left.

**Reading the glyph (several machines).** When you watch more than one machine the
glyph names **which machine** binds, in front of the tool cue:
`▪ <machine>·<◆|▲> <number>` — e.g. `▪ Desktop·◆ 12%` means Desktop's Claude
5-hour window is the tightest across every machine you watch. The machine label is
shown up to 10 characters, then truncated with `…` (the dropdown header always
carries the full name). One glance says **which machine, which tool, how much**.

The badge mirrors the dashboard's honesty — it never shows a confident number
that's secretly old, and it never fabricates one:
- **fresh** — a plain, confident number (`▪ ◆ 46%`, or `▪ Desktop·◆ 12%`).
- **aging** — the number kept, with a trailing `◷` clock marker and a slight dim.
- **stale** — the number tinted amber with a trailing `⚠` (still names the machine).
- **no reading yet** — `▪ —` (a dash, never a number); the dropdown says why per host.
- **offline** — `▪ llmdash ⚠` when your **local** dashboard isn't reachable —
  unmistakably "no server," **never** a number. (A single *remote* machine being
  unreachable is named in the dropdown, never in the glyph.)

For the local Claude weekly row, a current provider reset always wins. If that
timing is missing, expired, or attached to stale usage, the dropdown may show the
owner-saved fallback countdown with a **Configured** label. The percentage and
freshness marker remain exactly as reported, and a failed configuration read
removes only that fallback countdown; it never turns a healthy badge offline.

The dropdown carries **one section per machine** (the binding machine first), each
with that host's per-tool rows and its own freshness/offline state — one machine
aging or offline never flags or suppresses another's. An unreachable machine is
**named** ("… is unreachable — no response within 3s …"), never a fabricated zero.

### Watching several machines from the badge

The badge reads the **combined** view your local llmdash already assembles (it
fans out to the peers — the badge itself opens no outbound connection). The
watched-host list lives in a small local file, **`hosts.conf`**, under the data
dir (`$LLMDASH_DATA_DIR/hosts.conf`, default `~/llmdash/data/hosts.conf`), and you
can edit it **live from the badge** — no plist edit, no restart:

- **`＋ Add host…`** pops a native macOS dialog; type a `host[:port][=label]`
  (e.g. `100.64.0.7:8788=Desktop`). It's sanitized, validated, deduped, and
  appended — a malformed or duplicate entry is rejected with an honest message and
  **nothing is written**.
- **`－ Remove host…`** is a submenu of the machines you watch (never *This
  machine* — the local host is always included). Picking one confirms, then drops
  it from the file.
- **`☰ Watching: N hosts`** lists the current remote set.

Every host-list edit writes the **local file** — never an HTTP request. The only
HTTP mutation surface is the separately bounded, same-origin Reset & billing
configuration route documented above. The host-list change applies on the **next
poller update** (within your poll interval); the badge says "on the next update,"
never claims it's live before the poller has re-read the file.

**File precedence (seed-once).** Once `hosts.conf` exists, **it is the runtime
source of truth**. `LLMDASH_HOSTS`, if set and the file is absent, **seeds** the
file once on first run — after that, editing `LLMDASH_HOSTS` does nothing (the
file wins; the startup log says so). With **neither** set, the badge is a plain
single-host badge, exactly as before. The file is line-oriented (`host[:port][=label]`
per line, `#` comments), so you can also hand-edit it.

**Monitoring station.** A Mac that runs the badge but does no Claude/Codex work of
its own (it only watches its peers) has its **empty local reading de-emphasized** —
dropped from the glyph and headline, but kept in the dropdown, honestly labeled
"no local activity" (never fabricated zeros). This is automatic when the local host
has no readings and at least one remote is configured. To override, add a directive
line to `hosts.conf`: `!local=exclude` (always de-emphasize), `!local=include`
(always show the local host in the glyph), or `!local=auto` (the default).

The **live in-menu-bar view requires SwiftBar** (the one prerequisite). Without it,
the plugin still runs from a terminal (`node scripts/menubar/llmdash.5s.js`) and
prints the same SwiftBar-format output, which is how you can preview the states.

### Display options

The badge's glyph is configurable from a **🖥 Display** submenu (in both single-host
and multi-host dropdowns). Five independent axes shape the **menu-bar glyph only**;
the dropdown still lists the full per-host detail. Pick a **preset** as a starting
point, then fine-tune any axis underneath:

- **Group** — **Host** (the default; each unit is a machine) or **Tool** (each unit
  is a **per-tool aggregate** across the machines you watch). Grouped by tool,
  *all-Claude* = the tightest Claude window anywhere in the (selected) fleet and
  *all-Codex* likewise. In compact side-by-side, it shows the llmdash mark, then
  Claude's 5-hour/weekly pair, then Codex's 5-hour/weekly pair — `▪ ◆ 12/38 ▲ 63/61`.
  A tool with no reading on any selected machine reads `—/—` there (never a fabricated
  zero); every contributing machine offline reads `⊘`.
- **Hosts** — a multi-select of which machines feed the **glyph**. This is a **view
  filter, not a monitoring change**: your llmdash still polls every host, the
  **dropdown still lists every host in full**, and a *selected* offline machine still
  appears in the glyph with its `⊘` marker (marked, never dropped). Grouped by tool,
  the Hosts selection **scopes** which machines feed each aggregate. "All hosts"
  (the default) is the sentinel that watches every machine in the glyph.
- **Layout** — **Single** (the tightest unit only), **Side-by-side** (up to 3 units
  on one line, tightest-first, then `+M more`), or **Alternating** (one unit per
  ~5s tick, rotating deterministically off the clock).
- **Density** — **Wide** (a text glyph) or **Compact** (a tight glyph cell: a colored
  number with its state marker — `46` fresh, `◷46` aging, `⚠12` stale, `—` no reading,
  `⊘` offline). Side-by-side compact cues each machine with a short grown-until-unique
  prefix (`St12 La◷88`). Density does not shorten the dropdown; it only controls the
  status-bar glyph.
- **Tool marks** — **Neutral** (the default `◆` / `▲` glyphs) or **Logos** (opt-in
  product marks, SwiftBar only). Logos replace the tool glyphs when they render;
  the Claude-vs-Codex side-by-side logo preset renders one compact title image so
  the order stays `▪`, Claude logo, Claude 5-hour/weekly, Codex logo, Codex
  5-hour/weekly. See the fair-use note below.

A **🛈 Legend — what the marks mean** submenu (also in both modes) spells out every
symbol the badge can show — the `▪` llmdash mark, separators, binding-host marker,
five freshness states, the three colors and their thresholds, what the number is,
both tool marks, side-by-side host cues and `+M`, plus menu/action marks like `✓`,
`＋`, `－`, `☰`, `🖥`, `🛈`, `⊘`, and `▬` — one scannable line each.

**With nothing configured, the badge is byte-for-byte today's glyph** — every host,
single, wide, grouped by host — save the one ratified change: the default tool cue is
now `◆` Claude / `▲` Codex instead of the old `C` / `X` letters. (That is the single
intentional difference from the previous default; every other character is unchanged.)

**Where the prefs live.** The five axes persist as `!display-*` directives in the same
`hosts.conf` — `!display-hosts=`, `!display-layout=`, `!display-density=`,
`!display-group=`, `!display-tool-mark=` — so you can also set them by hand. Default
values are omitted (an unconfigured file has no `!display-*` lines). Every Display
choice is a **local file write** (atomic temp+rename), **never an HTTP request** —
exactly like the host-list edits. It does not use or broaden the separately
allowlisted Reset & billing PUT route. The glyph and the submenu's `✓` marks
update on the **next render** — no restart.

**Tool logos (opt-in, off by default) — the fair-use posture.** Turning on
**Tool marks → Logos** swaps the visible `◆` / `▲` tool glyphs for same-color
logo art in the status-bar title, **SwiftBar only**. Single-tool glyphs use 16x16
local images. The Claude-vs-Codex side-by-side logo preset uses one generated
compact title image containing `▪`, the Claude logo, Claude's 5-hour/weekly
remaining pair, the Codex logo, and Codex's 5-hour/weekly remaining pair, because
SwiftBar exposes one image slot per title line rather than arbitrary inline
images. The neutral `◆` / `▲` glyph is the
guaranteed fallback: on xbar, or if the image can't render, the badge still names
the tool. The repo bundles small local template-image marks under
`scripts/menubar/assets/`: Claude uses the Claude symbol, and Codex uses the
OpenAI blossom mark because Codex is an OpenAI product. The LICENSE note in that
directory records the source pages and trademark posture. The intended posture is
**nominative fair use** — small, monochrome, opt-in, no endorsement implied, with
the neutral glyph as the guaranteed alternative. The badge never fetches logo art
at first use; images are local files read only when Logos is selected and then
colored to match the title state.

### Service controls & uninstall (from the badge)

The badge dropdown also carries install-lifecycle controls for **this Mac** — in
both single-host and multi-host mode. Every one of them is a local `launchctl` /
file operation run by the badge process behind an OS confirmation; none of them
is an HTTP request or uses the separately allowlisted Reset & billing PUT route.

- **The local-service toggle** shows the *live* launchd state and offers the honest
  action for it:
  - `＋ Install the local service` when it's **not installed** — regenerates the
    launchd agent with fresh absolute paths and loads it (runs at login, restarts
    on crash).
  - `－ Remove the local service · running` / `· stopped` when it's **installed** —
    unloads the agent **and deletes its plist** (a true remove, not a transient
    stop a `KeepAlive` agent would relaunch). If this badge also watches remote
    machines, it keeps working off those; only the local reading stops.
  The state is read live at render time (`launchctl print` + the plist's presence),
  in the badge process — never faked, never on the dashboard's request path.

- **`⊘ Uninstall llmdash…`** is a two-tier submenu:
  - **Remove the menu-bar badge only** — reverses `--setup-badge` (the marker-gated
    SwiftBar wrapper). The service, checkout, and your data all stay; the badge just
    disappears on the next refresh. A file in SwiftBar's folder **without** llmdash's
    marker is a file of yours — it's left alone.
  - **Uninstall llmdash completely…** — first shows a confirmation that **lists every
    artifact** it will remove (the launchd service + plist, the badge wrapper, the
    app checkout, the Claude statusline wiring — restoring `settings.json.bak` if
    present, and the auto-refresh trust folder and its `~/.claude.json` entry), then
    tears them down in a safe order (the checkout is deleted **last**, by a detached
    process that survives its own removal).

**Your usage history and billing configuration are preserved by default.** A
complete uninstall keeps `llmdash.db`, `account-config.json`, and
`subscriptions.json` unless you explicitly choose *Delete my data* in a
second dialog, which names all three files and warns that deletion is permanent.
If your data directory lives under the checkout, as the default
`~/llmdash/data` does, those files are moved to a fresh uniquely named directory
beneath `~/.llmdash/preserved-data` before the checkout is deleted, so an earlier
uninstall's preserved files are never overwritten. If that rescue cannot finish,
the checkout is retained to protect any unmoved data and the failure summary names
both the retained checkout and any partially populated rescue directory.

**SwiftBar is never removed by llmdash.** Both the enumeration and the
post-uninstall message point you to the manual step:
```
brew uninstall --cask swiftbar
```

Every removal is **marker-gated** and **honest on partial failure**: llmdash only
deletes a file it created (the wrapper only with its marker, the statusline only
when it points at *this* checkout, the plist only for the `com.llmdash.dashboard`
label, the checkout only the resolved install dir, the trust entry only its own
key), and if a step can't complete you're told exactly what did **not** happen and
what remains — never a claimed removal that didn't occur.

Prefer the terminal? The same powers are `install-macos.sh --service
install|remove|status` and `install-macos.sh --uninstall`.

## How it works
- **Claude limits** come from Claude Code's statusline output (the sanctioned
  path — no credentials reused). The script writes `rate_limits` to
  `data/claude-ratelimits.json`; the server reads it and logs snapshots to SQLite.
- **Claude auto-refresh** keeps that reading fresh on desktop-app-only days: a
  stale reading during Claude activity triggers a short-lived `/usage` probe
  session (on the interval poller, never per request) that writes the same
  file. Newest capture wins — a probe never overwrites a newer statusline
  reading.
- **Codex limits** come from `codex app-server` (`account/rateLimits/read`),
  polled on an interval (not per request) and snapshotted to the same table with
  `source = "codex"`; a rollout-file cache is used as a fallback.
- **Activity** is computed on demand from each tool's local logs
  (`~/.claude/projects/**/*.jsonl`, `~/.codex/sessions/**/rollout-*.jsonl`).
- Limits are **account-wide**; activity is **from this machine's logs only**. The
  UI says which is which.
- On startup the server logs a **data-source health readout**: whether a Claude
  statusline reading exists (and how old it is), whether the configured codex
  command is runnable, and whether Codex has recorded any sessions on this
  machine — each missing source comes with the fix. It also reports whether
  Reset & billing configuration is validated, empty, last-valid, or unavailable,
  and names the fixed settings route and write posture without printing a reset,
  amount, or request token. Empty gauges in the UI carry the same explanation.

## Run as a service (optional, Linux/systemd)
Create `~/.config/systemd/user/llmdash.service` pointing `ExecStart` at your Node
binary and this directory, then:
```
systemctl --user daemon-reload
systemctl --user enable --now llmdash.service
loginctl enable-linger "$USER"   # so it runs without an active login
```

## Running on macOS (launchd)

**One-line install** (checks Node, clones to `~/llmdash`, sets up the launchd
service, wires the statusline):
```
curl -fsSL https://raw.githubusercontent.com/dtgibson/llmdash/main/scripts/install-macos.sh | bash
```
It's safe to re-run (it updates and reloads). Prefer to read the script first?
It's at `scripts/install-macos.sh`. Manual steps below if you'd rather.

---

The app itself is cross-platform (Node + a vanilla web UI); only the
background-service setup differs from Linux. On a Mac:

1. **Node 24+** is required (for the built-in SQLite): `node -v`.
2. Clone the repo (e.g. `~/llmdash`) and run it once with `npm start`, then open
   <http://localhost:8787>, or from another tailnet device `http://<your-mac's-tailscale-ip>:8787` — **http, not https** (find the IP with `tailscale ip -4`).
3. Point Claude Code's statusline at *your* path in `~/.claude/settings.json`:
   `"command": "node /Users/you/llmdash/scripts/statusline.js"`.
4. To run it in the background (the launchd equivalent of the systemd service),
   use the template at `macos/com.llmdash.dashboard.plist.example` — fill in your
   `node`, project, `codex`, and `claude` paths (the last is what auto-refresh
   runs; absolute, same launchd reason as `codex`), copy it to
   `~/Library/LaunchAgents/`, and `launchctl load -w` it. Full steps are in that
   file's comments. The one-line installer above does all of this for you,
   including resolving the absolute `claude` path.

Codex limits work the same way as on Linux (via the `codex app-server`).

## Configuration
All optional, via environment variables:
- `LLMDASH_PORT` (default `8787`)
- `LLMDASH_HOST` (default `0.0.0.0` — binds all local interfaces, so it's
  reachable on your LAN and tailnet, but not the public internet behind NAT. To
  restrict strictly to the tailnet, set this to your Tailscale IP, e.g.
  `LLMDASH_HOST=100.x.y.z`.)
- `LLMDASH_POLL_MS` (default `60000`)
- `LLMDASH_CLAUDE_MAX_AGE_MS` (default `300000` = 5 minutes) — Claude reading
  age at which the dashboard flags it "aging" and auto-refresh may act;
  "stale" is always 2× this value. Clamped: non-numeric or ≤ 0 falls back to
  the default, and values above 7 days (`604800000`) clamp to 7 days
- `LLMDASH_CLAUDE_AUTOREFRESH` (default on) — set `0` or `false` to disable
  the auto-refresh probe entirely (no other value disables it)
- `LLMDASH_CLAUDE_CMD` (default `claude`) — path to the claude binary for the
  auto-refresh probe (absolute under launchd; the installer bakes it in)
- `LLMDASH_CLAUDE_REFRESH_TIMEOUT_MS` (default `30000`) — one probe attempt's
  time budget; clamped to 5000–300000 ms
- `LLMDASH_CODEX_CMD` (default `codex`) — path to the codex binary for the limits read
- `LLMDASH_CODEX_DIR` (default `~/.codex`) — where Codex's session logs live
- `LLMDASH_DATA_DIR` (default `./data` inside the checkout) — local SQLite,
  captured limits, host configuration, and the optional owner-confirmed
  `account-config.json` plus legacy `subscriptions.json` files
- `LLMDASH_HOSTS` (default unset = single-host) — a comma-separated list of other
  tailnet machines to aggregate into one view. See [Multi-host](#multi-host--optional).
- `LLMDASH_PEER_TIMEOUT_MS` (default `3000`, clamped 500–30000) — per-peer fetch
  timeout for the multi-host fan-out
- `LLMDASH_PEER_CONCURRENCY` (default `4`, clamped 1–32) — how many peers are
  polled in parallel each tick
- `LLMDASH_PEER_BODY_CAP_BYTES` (default `262144` = 256 KiB, clamped 16 KiB–8 MiB) —
  the maximum response body read from a peer before the fetch aborts

The **menu-bar badge** reads two of its own (in the plugin's environment, not the
server's — see [Menu-bar badge](#menu-bar-badge-swiftbar--optional)):
- `LLMDASH_PORT` (default `8787`) — the badge honors the same port knob as the server
- `LLMDASH_BADGE_HOST` (default `127.0.0.1`) — point the badge at a dashboard on
  another tailnet machine; drives both the badge's fetch and its *Open dashboard* link

### Cost analysis setup

Owner-confirmed recurring monthly access costs are managed at
[`/settings`](#reset--billing-settings) and stored as immutable effective-dated
history in `$LLMDASH_DATA_DIR/account-config.json`; no monthly JSON maintenance
is required. Cost analysis expands those plans on local calendar boundaries and
retains the original billing anchor across short months.

API-equivalent values use the tracked, effective-dated
[`config/api-rates.json`](config/api-rates.json). Its exact model IDs and token
channels were reviewed against the official
[Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
and [OpenAI pricing](https://developers.openai.com/api/docs/pricing) pages on
the card's `asOf` date. Effective starts are pinned to the official model
launches for [Haiku 4.5](https://www.anthropic.com/news/claude-haiku-4-5),
[Opus 4.8](https://www.anthropic.com/news/claude-opus-4-8),
[Fable 5](https://www.anthropic.com/news/claude-fable-5-mythos-5),
[Sonnet 5](https://www.anthropic.com/news/claude-sonnet-5), and
[GPT-5.3-Codex](https://openai.com/index/introducing-gpt-5-3-codex/),
[GPT-5.5](https://openai.com/index/introducing-gpt-5-5/), and
[GPT-5.6 Sol](https://openai.com/index/previewing-gpt-5-6-sol/), so a
current price is never projected before that exact model existed. There is no family/default fallback: an unlisted model
is disclosed as unpriced until a reviewed exact entry is added. The dashboard
does not scrape prices or make a pricing request at runtime.

Codex rate entries may also contain ordered `inputTokenTiers`. The reviewed
GPT-5.5 and GPT-5.6 Sol entries apply OpenAI's full-request pricing above
272,000 input tokens: 2x input pricing (including cached input) and 1.5x output
pricing. Exactly 272,000 input tokens remains in the base tier.

For legacy or exceptional historical fixed periods only, you may still create
`$LLMDASH_DATA_DIR/subscriptions.json` (by default
`./data/subscriptions.json`) with periods you have personally confirmed:

```json
{
  "schemaVersion": 1,
  "currency": "USD",
  "subscriptions": [
    {
      "tool": "claude",
      "amountUsd": "200.00",
      "startDate": "2026-07-01",
      "endDate": "2026-07-31",
      "confirmed": true
    },
    {
      "tool": "codex",
      "amountUsd": "200.00",
      "startDate": "2026-07-01",
      "endDate": "2026-07-31",
      "confirmed": true
    }
  ]
}
```

Replace the example amounts and dates with your actual historical access
periods. A confirmed zero is valid; a missing, unconfirmed, overlapping, or
gapped period is not silently inferred from the plan label. This legacy file
stays local, gitignored, and read-only in the app; recurring plan changes belong
in Reset & billing settings. No billing portal, provider API key, prompt,
response, or session identifier is read or returned by cost analysis.

Snapshots and the captured reading are stored under the data directory.

## Tests
```
npm test
```

## Status & roadmap
Personal project. Claude Code and Codex are both tracked, with usage-over-time
trends, auto-refreshing Claude readings, and an optional SwiftBar menu-bar badge
all shipped. Next up: low-limit alerts (and, on the horizon, a multi-host badge
that shows several tailnet dashboards at once). See `ROADMAP.md`.
