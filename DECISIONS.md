# Decisions — llmdash

## Menu-bar dropdown legibility and complete legend — explicit dark dropdown palette, every mark explained — 2026-07-08 (improve)
**Decision:** The macOS SwiftBar/xbar badge now uses an explicit dark dropdown
palette for normal informational rows (`#111111`, `#1f1f1f`, `#333333`) and
separate darker dropdown-specific state colors for warnings, aging, no-reading,
and offline legend samples. The Legend now explains every visible badge/menu mark:
the `▪` llmdash mark, separators, `▸ binding`, tool marks, freshness markers,
no-reading/offline markers, compact host cues, overflow, active choices, host
actions, Display, Legend, uninstall, and badge-only removal marks.
**Rationale:** The prior pass darkened some top rows but left common detail rows
and legend samples dependent on faint SwiftBar defaults or menu-bar colors that
were too light on the dropdown background. The square `▪` mark and several menu
symbols were visible in the product but not explained, making the badge grammar
feel arbitrary.
**Implications:** Future menu-bar work should treat dropdown readability as its
own palette rather than reusing dark-strip glyph colors, and any new visible mark
must be added to the Legend in the same change. This remains presentation-only:
no API, polling, persistence, display-pref, service-control, or action-row target
changed. QA PASSED: focused menu-bar suites and full `npm test` passed (467
passing, 0 failing, 2 skipped), with installed output showing the darker rows and
complete legend. Security PASSED: no new HTTP route, persistence, peer fetch,
subprocess, `href=`, `shell=`, `bash=`, osascript, or SwiftBar action-param
surface was added. Shipped as commit `8353709`; installed `~/llmdash` was
fast-forwarded, llmdash restarted, and SwiftBar relaunched.

## Dropdown legibility and aging symbols — darker top rows, `◷` aging, `⚠` stale — 2026-07-08 (improve)
**Decision:** The macOS SwiftBar/xbar badge now uses darker fixed colors for the
dropdown's top summary, host/tool headers, scope/count rows, and Display/Legend
section labels. Aging readings use the clock-like `◷` marker, while stale readings
keep the stronger `⚠` warning marker; `·` remains only a separator between host,
tool, scope, or reset copy.
**Rationale:** The previous top dropdown text was too light to scan comfortably,
and the trailing-dot aging marker was easy to miss and did not intuitively say
"this reading is getting old." Separating separator punctuation from freshness
state makes the glyph grammar clearer without changing any data path.
**Implications:** This is presentation-only: monitoring, polling, persistence,
display preferences, `/api/state`, `/api/hosts`, and action rows are unchanged.
Future badge work should keep aging/stale/no-reading/offline markers visually
distinct and should not reintroduce faint gray for high-priority dropdown text. QA
PASSED: focused menu-bar suites and full `npm test` passed (467 passing, 0 failing,
2 skipped), plus a forced installed aging render emitted `▪ ◆ 66% ◷`. Security
PASSED: no new HTTP route, persistence, peer fetch, subprocess action, href/shell
row, or SwiftBar action-param surface was added. Shipped as commit `053c961`;
installed `~/llmdash` was fast-forwarded and the launchd service is running.

## Compact mode display honesty — one status-bar line, glyph-only settings copy, dropdown stays full — 2026-07-08 (improve)
**Decision:** SwiftBar/xbar badge output now treats the first separator as the hard
boundary between the status-bar glyph and dropdown detail: exactly one title line
appears before the first `---`, and explanatory/scope copy such as "Watching 3
machines · 1 not reachable" appears only below it. Display settings are described
as glyph settings: layout controls which glyph units appear, density controls how
terse each glyph cell is, and the dropdown remains the complete per-host view.
**Rationale:** Compact mode was visually dishonest when non-glyph summary text
leaked into the title area and widened the menu bar. Keeping scope and diagnostic
copy below the separator preserves readable dropdown detail while making the
status-bar area obey the chosen display setting.
**Implications:** Monitoring, polling, persistence, `/api/state`, and `/api/hosts`
are unchanged; this is presentation-only. Future badge work should preserve the
one-title-line separator contract and state clearly when a display option affects
only the glyph. QA PASSED: full `npm test` passed (467 passing, 0 failing, 2
skipped), focused menu-bar separator tests passed, and the installed SwiftBar
wrapper plus a forced compact/offline render were previewed. Security PASSED:
existing action rows remain explicitly constructed and unchanged. Shipped as
commit `1ee31db`; installed `~/llmdash` was fast-forwarded and the launchd service
is running after a direct bootstrap retry.

## Status bar popup legibility — bounded readable SwiftBar rows, action rows unchanged — 2026-07-08 (improve)
**Decision:** Non-action menu-bar dropdown copy now flows through a shared
`wrapMenuText` / `wrappedMenuLines` path before SwiftBar/xbar output. The wrapper
sanitizes display text for the menu grammar, collapses whitespace, wraps by words,
and splits a single overlong token so an unavailable server name cannot make the
dropdown enormous. Primary dropdown labels use readable menu text sizes instead of
tiny low-contrast gray. Action rows (`href=`, refresh, submenus, scripts) stay
explicitly constructed and unwrapped.
**Rationale:** The menu host has no native paragraph wrapping, so the practical
control is to emit several bounded non-action rows. Keeping the wrapping helper
limited to explanatory/diagnostic text preserves the existing command surface while
making unavailable-server and stale/diagnostic states readable.
**Implications:** Badge glyphs, display preferences, `/api/state`, `/api/hosts`,
service controls, and dashboard behavior are unchanged. Security PASSED: no new
HTTP route, persistence, peer fetch, subprocess action, or SwiftBar action-param
surface was added; wrapped rows use only controlled visual params. QA PASSED:
focused menu-bar suites and full `npm test` passed (463 passing, 0 failing, 2
skipped), plus the installed SwiftBar wrapper was previewed with a long unavailable
host and rendered bounded rows. Shipped as commit `f4e5f3f`; installed
`~/llmdash` was fast-forwarded and the launchd service is running after a direct
bootstrap retry.

## Badge display options — display as a pure presentation layer, `!display-*` directives, the ratified `◆`/`▲` default cue, per-tool aggregates, opt-in logos with a neutral floor — 2026-07-03 (feature)
**Decision (display is a presentation layer over `computeMultiBadge`, not a data
change):** The badge's five display axes (group × hosts × layout × density ×
tool-mark) are applied by a pure `applyDisplay(multi, display, {epochMs})` over the
existing per-host `hostViews`. `computeMultiBadge`, the fetch, `/api/state`, and
`/api/hosts` are **byte-for-byte unchanged** — no table, no column, no migration, no
new payload field. A display view reads only `hostViews`; a new axis extends
`applyDisplay`, never the store or the contract.
**Decision (prefs as `!display-*` directives; round-trip all; case-preserve hosts):**
The prefs persist as `!display-hosts` / `-layout` / `-density` / `-group` /
`-tool-mark` lines in `hosts.conf` (the same seed-once/directive family as `!local=`),
written locally by a tracked `display-action.mjs` helper under `$ABS_NODE` — **no
`osascript` dialog** (the values are enumerable menu choices, not typed input) and
**no HTTP mutation** (serve-only preserved, still 405 for non-GET/HEAD). The writer
**round-trips every directive** (a display edit preserves entries + `!local` + other
axes; an Add/Remove preserves every `!display-*`) and **omits default-valued axes** so
an unconfigured file stays byte-for-byte. **Host-list keys are case-preserved** (only
the enum axes lowercase) — a blanket lowercase broke mixed-case `.local` host filtering
(the QA MAJOR, fixed in-stage).
**Decision (the ratified `C`/`X` → `◆`/`▲` default cue swap — the one break in
byte-for-byte):** The neutral tool marks (diamond = Claude, triangle = Codex) are the
default and apply wherever the tool is named, **including the shipped wide badge every
current user sees**. This is user-ratified, not a regression: the byte-for-byte guard
was **updated** to "unchanged save the ratified cue," the shipped tests' expected
strings were **updated (never reverted) with a pin test** against a silent revert, and
it was disclosed in the README + `healthLines()`.
**Decision (group-by-tool = per-tool aggregate, honest):** Grouping by tool makes each
unit a per-tool aggregate over the *selected* hosts — the tightest window's remaining
% for that tool across those machines (the same binding-min, scoped to one tool),
carrying that window's freshness state. No reading anywhere → `—`; all contributing
hosts offline → `⊘`; **never a fabricated zero**. Two units, so no cap.
**Decision (logos opt-in, neutral floor, fair-use posture):** Tool logos are OFF by
default; the neutral `◆`/`▲` text floor is emitted unconditionally so honesty never
depends on an image rendering. The asset is a passive local `node:fs` read (no network,
no `import()`, no eval), resolved via `import.meta.url`, read only when opted in,
reaching the line only as a base64 `templateImage=`. Shipped as **original placeholder
art + a `LICENSE.md`**; dropping in the real brand marks is a separate explicit
operator fair-use choice.
**Rationale:** Keeping display a presentation regroup over `hostViews` makes the two
hardest invariants structural — the contract is untouched and monitoring is never
affected (the view filter is glyph-only; the dropdown and poller stay full). Directives
reuse the shipped `!local=` parser/seed-once/atomic-writer rather than adding a second
prefs file and write path. The case bug proves host keys are identities, not enums. The
cue swap is the "visible default change is ratified + disclosed, never silent" rule made
concrete. The neutral floor is the "logo is never the sole carrier" honesty invariant,
and shipping placeholders keeps the code honest whichever art an operator later drops in.
**Implications:** The menu-bar badge is now a **user-configurable view** — group by host
or tool, single/side-by-side/alternating, wide/compact, neutral marks or opt-in logos,
with an on-demand legend — that is still a **view filter, never a coverage change**
(polling and the dropdown stay full). Security PASSED: no exploitable issues; INFO-3
hardening applied in-stage (`truncateHostCue` now re-`sanitize()`s its input for
symmetry with `growPrefixCues` — defense in depth, a new CLAUDE.md rule). Shipped as
commit `07682e2` on origin/main; installed `~/llmdash` fast-forwarded and the service
restarted (user domain, no sudo); live-verified (`/api/state`/`/api/hosts` 200, POST →
405) and real-invocation-verified through the SwiftBar wrapper (the `◆` cue live in the
menu bar). Five CLAUDE.md conventions promoted (display-as-presentation-layer; per-tool
aggregate honesty; the `!display-*`/round-trip/case-preserve directive rule; the
ratified-visible-default rule; sanitize-at-the-compose-helper), plus the brand-asset
opt-in-with-neutral-floor rule.

## Menu-bar service controls — a service toggle + two-tier uninstall, preserve/rescue the DB, detached self-uninstall, installer hooks as truth — 2026-07-03 (feature)
**Decision (service toggle = register/unregister the plist, not transient
start/stop):** "Install the local service" writes the plist from the template (fresh
absolute node/codex/claude paths, per the fresh-install decision) + `launchctl
bootstrap`; "Remove the local service" `launchctl bootout`s **and deletes the plist**
— a true unregister, not a transient stop. A `KeepAlive:true` agent relaunches after
a plain `launchctl stop`, so a "stopped" state would be a lie the moment launchd
relaunches it. The menu reads the **real launchd state** (`launchctl print
gui/<uid>/<label>` + plist-on-disk → running/stopped/not-installed) and reflects it
honestly, never a faked checkmark; a machine can drop its local service and keep the
badge watching remotes (the monitoring-station story stays intact).
**Decision (two-tier uninstall; DB preserved by default AND rescued):** Uninstall is
two tiers — **"Remove the menu-bar badge only"** (marker-gated wrapper removal, leaves
service/checkout/data) vs **"Uninstall llmdash completely…"**, whose dialog
**enumerates every artifact before acting** (service+plist, wrapper, checkout,
statusline wiring restoring the `.bak`, auto-refresh trust folder). The usage-history
DB (`llmdash.db`) is the founding "self-logged history, no backfill" **irreplaceable
asset**, so it is **preserved by default** — deleting it is a separate, non-default,
warned-irreversible opt-in. Crucially, when the data dir lives **under** the checkout
being `rm -rf`'d, ordering isn't enough: the teardown **rescues** the named data files
to `~/.llmdash/preserved-data` (a `path.relative` `isUnder` check) **before** deleting
the checkout. **SwiftBar is never removed** — the dialog only points to `brew uninstall
--cask swiftbar`.
**Decision (detached self-uninstall survival model):** The complete uninstall must
`launchctl bootout` the service feeding the badge and `rm -rf` its own checkout, so it
runs as a **detached, self-contained, temp-copied helper** (`spawn(process.execPath,
[tmpSelf, …, '--run'], {cwd: tmpDir, detached: true})` + `unref()`): it reads every
path up front from ARGV, imports **only** `node:` builtins (never `../../src` or the
installer), and deletes its origin checkout **LAST** as a leaf. SPIKE-01 proved this
survives both destructions on APFS; the binding rule (Hazard E) is that a lazy import
from the deleted checkout throws `ERR_MODULE_NOT_FOUND`, so nothing may reach back into
the checkout after the delete. Fixed ordering: service → statusline → trust → wrapper →
checkout LAST → data (opt-in, after checkout).
**Decision (installer hooks as the single source of truth):** The launchctl/plist/
teardown logic is extended onto `install-macos.sh`'s `--service`/`--uninstall` hooks —
one place that knows what the installer touches, so uninstall reverses it honestly and
stays in sync as the installer evolves. The badge invokes the hooks; the
checkout-deleting step runs from the node helper's temp copy (the installer script is
itself in the checkout being deleted).
**Decision (destructive-from-a-click security posture):** Every mutation is
**user-domain only** (`launchctl … gui/<uid>`, user-owned paths — no `sudo`, no system
domain), confirmed by a **fixed-literal `osascript` dialog with the safe choice as the
default button** (the destructive/data-delete option never the default, warned
irreversible), **marker-gated per removal** (wrapper by the `llmdash-menu-bar-badge`
marker, trust by own-key `hasOwnProperty`, plist by the resolved label's filename,
checkout by the resolved dir), **honest on partial failure** (each step reports its own
outcome; never claim a removal that didn't happen), and **serve-only preserved** — no
new endpoint, `server.js` byte-for-byte unchanged (still 405 for non-GET/HEAD), so the
`0.0.0.0` bind gains no mutation surface and no remote peer can trigger any of it. The
statusline-revert ownership check is a **whole-path-token** match (not a substring
`includes()`), so a `…statusline.js.bak` superstring can't trigger a false-positive
revert. The osascript fixed-literal + `execFileSync`-no-shell + ARGV-only anti-injection
is the standing convention from multi-host-badge, carried forward.
**Rationale:** The service toggle maps cleanly onto the real user intent ("this is a
monitoring station now, drop the local service") and a launchd state the menu can read
truthfully — a transient stop can't, because KeepAlive defeats it. Preserving the DB by
default honors the founding no-backfill promise (it's the one asset a reinstall can't
rebuild), and the rescue closes the gap that preserve-by-default alone leaves when the
asset sits inside the thing being deleted. The detached temp-copy is forced by the
self-deletion problem: a helper that deletes its own code mid-run is only safe if it's
self-contained and reads everything up front. Installer hooks as truth keep uninstall in
lockstep with install. The security posture is the multi-host-badge hardening made
stricter by the higher stakes — this is the most destructive capability llmdash has
shipped, and its safety is **structural** (fixed literal + ARGV + `fs` + marker-gate +
whole-token ownership), not a promise to be careful.
**Implications:** The menu-bar badge is now a **local install-lifecycle surface**, not
only a read-only glance — completing the "everything from the menu bar" arc (install
badge → add/remove hosts → manage/remove the service → uninstall) and removing the last
terminal dependencies for the install lifecycle. Security **PASSED WITH NOTES**: the one
finding (statusline-revert substring→boundary match, on a destructive path) was
**resolved in-stage before ship** via a new `targetIsWholeToken` helper (folded into the
feature commit; 378 tests). Shipped as commit 96ee98d on origin/main; installed copy at
~/llmdash fast-forwarded and the service restarted; live-verified (`/api/state` 200,
POST → 405, the installed badge dropdown shows the state-aware toggle and the uninstall
submenu). The three osascript dialogs were the only deploy-deferred item (one of them
uninstalls llmdash) — the mechanism is proven; the in-menu-bar dialog capture fires on a
real click. Three CLAUDE.md conventions promoted (whole-token path-ownership match;
rescue-before-delete for a co-located irreplaceable asset; the self-contained detached
teardown), plus the destructive-menu-bar-action posture extended in place.

## Multi-host badge — badge consumes `/api/hosts`, a runtime host-config file, serve-only preserved — 2026-07-03 (feature)
**Decision (consumer, not a second data path):** The badge became a **thin
consumer of the shipped `/api/hosts`** — it reads its local instance's already-
combined multi-host view and issues **no outbound peer fetch of its own** (the
local instance does the credential-free fan-out on its poller). The glyph names
the tightest machine (`▪ <host>·<C|X> <pct>`); an unreachable machine is named,
never shown as a stale meter; a monitoring-station Mac's empty local reading is
auto-de-emphasized ("no local activity") client-side in the badge, never
fabricated as zeros. Unset = today's single-host badge, glyph byte-for-byte.
**Decision (runtime host-config file, seed-once precedence):** The watched-host
list is a human-readable **`hosts.conf` under the data dir** that the badge edits
**locally** (Add/Remove/List dropdown actions), and the poller re-reads each tick.
`LLMDASH_HOSTS` **seeds the file once**; the file is the source of truth
thereafter — so a host removed from the badge **can't be resurrected** by the
still-set env var on the next start (env-as-truth would ghost it back).
**Decision (serve-only preserved — the config write is a local file write, never
an HTTP mutation):** Adding a write path did **not** add a write *endpoint*.
`server.js` stays serve-only (no POST/PUT/DELETE/PATCH, still 405 for non-GET/HEAD,
baseline headers, `no-store`); the write lives entirely in the **badge process**,
a user-owned local file, so the `0.0.0.0` tailnet bind gains **no** write surface.
**Decision (osascript anti-injection posture):** The Add/Remove dialog is a
**fixed-literal AppleScript** run via `execFileSync('/usr/bin/osascript', ['-e',
<constant>])` — **no shell**; the user's typed value returns on stdout via `text
returned of result` and reaches the config writer as a **plain ARGV string** only,
never concatenated into the script or a command. A hostile hostname/label
(`"; rm -rf ~`, `$(…)`, backticks, `\n`, an AS-breaking `"`) is inert data end to
end. The write is atomic temp+rename, `0o600`, to the **fixed** `hosts.conf` path
(never derived from input → no traversal), validated by `parseHosts` +
`sanitizeHostPort` before landing, embedded newlines stripped per entry (so a
label can't smuggle a second line or a `!local=` directive), and the local host is
never removable.
**Rationale:** Consuming `/api/hosts` reuses the shipped peer plumbing instead of
giving the badge its own fan-out — one hardened outbound surface, not two.
Seed-once precedence is the honest resolution of "env seeds vs. file edits": a
runtime removal must stick, and env-as-perpetual-truth silently defeats the very
Remove action the feature ships. Keeping the config edit a **local file write**
holds the founding serve-only / read-only posture — the dashboard's tailnet bind
must never become a mutation surface — while still letting the operator manage
hosts from the menu bar. The osascript surface is the sharpest new risk, so its
safety is **structural** (fixed literal + ARGV, no shell), not a promise to
sanitize one string.
**Implications:** The badge's headline (a monitoring-station Mac watching remotes)
now works with **zero local Claude/Codex** — auto-de-emphasis keeps the empty
local reading out of the glyph while still showing it honestly, last and dimmed.
The `!local=include|exclude|auto` in-file directive overrides the auto-detect (a
real knob, edited alongside the host list). Single-host mode now also offers
**`＋ Add host…`** so the first machine is addable from the menu bar — the glyph +
tool rows stay byte-for-byte the shipped single-host badge (the "byte-for-byte"
guard is now "glyph+rows unchanged AND the Add affordance present"). Security
PASSED WITH NOTES: two Informational only (a downstream non-finite `remainingPct`
rendering as inert `NaN%` text with no injection sink reachable; the accepted
operator-config-in-terminal-log disclosure) — no Critical/High. **Deploy-caught
fix-forward (commit 8bf0535):** the post-deploy check ran the *installed* badge
and found single-host mode had **no** host-config actions, so a fresh single-host /
monitoring-station machine couldn't add its **first** host from the menu bar —
FR-13's "byte-for-byte" had over-applied by hiding the one new affordance that
must be reachable there. Fixed with a shared `hostConfigActionLines()` helper on
both paths. Caught by running the real artifact, not by tests (every unit test
passed) — reinforces "verify a feature the way its host actually runs it."

## Multi-host — a new `/api/hosts` endpoint, cached-only peers, account-wide-limits collapse — 2026-07-02 (feature)
**Decision (endpoint):** The combined multi-host view is a **new `GET /api/hosts`**
endpoint; `/api/state` and `buildState()` are left **byte-for-byte unchanged** (a
golden-contract test, `state-unchanged.test.js`, guards it — tamper-verified). The
local dashboard and the menu-bar badge keep consuming `/api/state` exactly as
before. Because the fan-out target is always a peer's **`/api/state`** — a
*different* path than the combined `/api/hosts` — the **no-transitive-fan-out** rule
is structural, not a promise to test: a peer's own peer list is never traversed.
**Decision (persistence):** **Cached-only.** Peer readings live in an in-memory
per-host cache maintained by the interval poller; **nothing about a peer is
persisted** (`usage_snapshots` stays local-host-only). Each peer already persists
its own snapshots on its own machine, and a persisted-across-restart peer value
would have to render as stale anyway (the next tick refills the cache in ≤ one
interval) — the survivability gain is marginal, the cost (a peer-provenance column,
a write path clamping every peer field, muddied snapshot semantics) is real.
**Decision (account-wide-limits honesty — the load-bearing product call, ratified by
the user):** Limits are the **account's** numbers, identical across same-account
machines; **activity is per machine** and is the genuine new information. So
same-account hosts (detected **client-side** by matching per-window `resetsAt`
epochs within ~60 s) **collapse into a single "Account limits" banner** — the shared
meter is *physically shown once* and cannot read as N independent budgets — while
each host leads with its own distinct activity; a genuinely different-account host
renders its own meters in-group; an **unreachable host shows a named offline
callout, never a stale meter** (a stale gauge beside a live one invites the exact
2×-budget misread the feature exists to prevent). The detect-and-collapse treatment
is a pure client-side derivation over the combined payload — no new server field.
**Decision (mechanism / security posture):** llmdash flips from serve-only to
issuing outbound reads. Peers are polled **on the interval poller, never the request
path** (bounded concurrency + single-flight so ticks never pile up); `/api/hosts` is
a pure cache read. The outbound fetch is hardened: **configured tailnet hosts only**
(no discovery, no host from a payload), **credential-free `GET /api/state`** built
from an options object, **`sanitizeHostPort`**-scrubbed, **no redirect-follow** (3xx
→ error state), **bounded timeout + response-body cap**. Every peer field is
clamped/normalized/escaped at ingest and `esc()`'d at render.
**Rationale:** A separate endpoint makes the two hardest invariants *structural*
rather than test-enforced — `/api/state` untouched (badge + local view safe) and
no transitive fan-out (separate path). Cached-only keeps the snapshot store's
"this machine's own history" meaning intact and honors the settled "no cross-host
history store" scope. The account-wide-limits collapse is squarely the product's
"be honest in the UI" convention: the founding "one glance, all your usage" promise
narrows silently the moment a second machine exists, and a naive N-meters view would
imply N budgets that don't exist. Polling on the poller is the same hard convention
that keeps Codex's subprocess and the Claude probe off the request path.
**Implications:** "Source-aware" now has **two axes: host × tool** — a host is an
outer loop wrapping the *unchanged* per-tool renderer and store (neither forked;
peers never touch `db.js`). The **multi-host badge** and a **tmux/terminal
statusline** are now thin consumers of this shipped peer plumbing (roadmap On the
Horizon); **limit alerts** (Up Next) can now alert across hosts, building on this.
Config: `LLMDASH_HOSTS` (`host[:port][=label]`; local host always included; unset =
today's single-host behavior — no dead knob). New per-host `hostDiagnostic` enum
codes (`peer-unreachable` / `peer-error` with a `cause`), own-key-mapped and escaped
client-side; the reserved `auto-refresh-*` codes are **not** reused for peer
failures. Security **PASSED WITH NOTES**: one Medium **fixed in-stage** (a peer's
nested `activity` numbers were passed through un-coerced and reached two unescaped
render sinks — markup injection, script blocked by the existing CSP; fixed by
coercing every activity number at ingest, now a sharpened CLAUDE.md clamp
convention: normalize nested sub-objects, not just the top-level meter), two
Informational accepted (an operator label printed verbatim in the plain-text
startup log — config, not peer data; best-effort self-identification without DNS
can issue one loopback-ish fetch under a hostname alias — a correctness-preserving
miss the account-wide collapse covers). The new hardened-outbound-fetch template is
recorded as a CLAUDE.md convention (llmdash's one outbound surface). **Weft-process
lesson** (recorded in the feature's `decisions.md`, not a code convention): don't
spawn a side-task chip for a decision already handled by a pipeline participate-gate
— a duplicate Designer-stage side-session was spawned during the Architect stage,
redid ratified work in its own worktree, and was discarded at deploy.

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
