# Strategic Brief — Menu-Bar Badge

## What We're Building
A macOS menu-bar badge that shows the current remaining AI-coding-usage
percentage in the corner of the screen — glanceable without opening the
dashboard — with a dropdown that carries the full picture (both tools, both
windows, reset countdowns, freshness). It reuses the dashboard's existing
`/api/state` payload as its only data source and adds **zero runtime
dependencies and no build step** to llmdash: llmdash ships a tiny
zero-dependency plugin script that a user-installed menu-bar host (SwiftBar or
xbar) renders on an interval.

## Why Now
This is Up Next item 1 on the roadmap, and the just-shipped Claude auto-refresh
(DECISIONS.md 2026-07-02) is the specific thing that unblocks it. Before
auto-refresh, a desktop-app-only day of active Claude use left the headline
number permanently stale — a badge built on that would have been a confident
percentage that was secretly hours old, which is exactly the dishonesty the
product exists to prevent. Now the Claude reading keeps itself fresh during
active use, so a badge is finally built on a fresh-by-default number rather than
a rotting one. The badge is also the natural next step in the product's core
promise: the founding brief's success image is "you glance… and immediately
know how much you have left." A menu-bar badge is the *most* glanceable surface
yet — no device to pick up, no tab to open, no dashboard to load. It tightens
the founding promise rather than extending past it.

## The User Problem
The user paces AI-coding work across Claude Code and Codex to avoid getting
throttled mid-task. The dashboard answers "how much do I have left?" — but only
when they go look at it, on a phone or in a browser tab. The user lives in a
terminal and an editor on their Mac, not in a browser; the dashboard's answer is
one deliberate context-switch away, so in practice they *don't* glance often
enough, and the surprise lockout the product set out to prevent can still
happen. The problem is the friction of *having to look*: the authoritative
number should sit passively in the corner of the screen they're already staring
at, so pacing becomes ambient instead of a task.

## Mechanism — the strategic core (recommended, with trade-offs)
The hard question this feature exists to answer: **how do we put a live number
in the macOS menu bar without betraying llmdash's zero-dependency / no-build
constitution** (DECISIONS.md 2026-06-16 "Vanilla, zero-dependency stack")? A
native menu-bar surface traditionally means Swift/AppKit (a compile step, a
language outside the stack) or Electron (a heavy framework dependency) — both
violate the constitution head-on. Candidates, in recommended priority order:

**1. (Recommended primary) A menu-bar host plugin — SwiftBar or xbar.**
SwiftBar and xbar are established third-party macOS menu-bar hosts that render a
plugin script's stdout on an interval, with a dropdown built from the same
output. llmdash ships a small **zero-dependency Node (or POSIX-shell) plugin
script** that fetches `http://localhost:8787/api/state`, picks the number to
show, and prints the menu-bar line plus a dropdown. This keeps **llmdash itself
dependency-free and build-free** — the *user* runs a one-time
`brew install --cask swiftbar` and drops the plugin in SwiftBar's plugin folder.
That external app is an **honest, disclosed prerequisite**, not an llmdash
dependency, and it's the same spirit as the toolchain llmdash already assumes
(Node 24+, the Claude CLI, the Codex CLI, Tailscale). The cost to weigh: it asks
the user to install a third-party app. For a personal, single-user tool run by
someone already comfortable with a local toolchain, that is an acceptable trade
— **but it is the one decision the user must ratify** (see Key Decisions), and
the Architect should spike whether SwiftBar or xbar is the better host before
committing (SwiftBar is the more actively maintained successor and leans
Swift-native/notarized; xbar is the older, broader ecosystem — pick one as the
documented default, don't try to support both perfectly).

**2. (Rejected direction, named for the record) A native Swift menu-bar
helper** compiled from source in `macos/`. This is the "proper" native answer
and would give the tightest UX, but it introduces a **build step and a language
outside the stack** — a direct cut against the constitution. Do not build this
unless the plugin-host route proves genuinely unworkable; if that day comes,
it's a founding-brief-level reversal, not a quiet implementation choice.

**3. (Insufficient) Browser / PWA surfaces** — a favicon badge or an installed
PWA's dock/notification. These fail the actual need: they aren't the *menu bar*,
they're limited in what they can render, and the desktop-app-only user isn't
sitting in a browser tab for them to help. Named here so it's clear they were
considered and rejected, not overlooked.

**Bonus secondary consumer (not primary scope):** because the plugin is just "a
script that turns `/api/state` into a one-line glyph," the same emitter logic can
feed a **`tmux` / terminal statusline** — the surface the terminal-dwelling user
actually stares at all day. This is a cheap second consumer of one emitter, worth
noting for the Planner as an easy follow-on, but the menu-bar badge is the
primary deliverable and the terminal line must not expand this feature's scope.

## Success Criteria
- The remaining-percentage number sits in the macOS menu bar and updates on an
  interval without the user opening the dashboard.
- The badge reads **only** from the existing `/api/state` payload — no second
  data path, no recomputed limits. It reuses the source-aware payload
  (`tools[].limits[window].remainingPct`, `freshness`, `limitsDiagnostic`) the
  dashboard already serves.
- A **stale, aging, or unavailable** reading looks visibly different from a fresh
  one (a dimmed/marked glyph or an honest symbol), never a confident number that
  is secretly hours old. The dashboard's freshness bands and diagnostic reason
  codes survive the smaller surface intact.
- The dropdown carries the full picture the single glyph can't: both tools, both
  windows, remaining % and reset countdowns, and the freshness/diagnostic state.
- llmdash gains **zero new runtime dependencies and no build step**; the plugin
  is Node-builtins-or-shell only. The one external requirement (the menu-bar
  host) is disclosed loudly in the README and install path, in the same spirit as
  the existing "surface security-relevant / environmental prerequisites, never
  silently" convention.
- If llmdash isn't running (no server on the port), the badge degrades honestly
  — an "offline"/"—" state, never a fabricated or last-cached-as-if-fresh number.

## Scope
- A zero-dependency plugin script (Node builtins or POSIX shell) that fetches
  `http://localhost:PORT/api/state` and emits a SwiftBar/xbar-format menu-bar
  line + dropdown.
- **Badge default composition (principle, exact form deferred to
  Planner/Designer):** the single glyph answers "how much do I have left right
  now, at a glance." Recommended default = the **most-constrained window across
  the tools currently in play** — i.e. the lowest `remainingPct` among the
  windows that have a reading — since the binding constraint is what causes a
  lockout, and the product already treats a maxed window as the binding signal
  per-window (CLAUDE.md; `computeHeadroom`). Show the number with a compact tool
  cue (e.g. `◉ 78%`), and let the **dropdown** carry the full two-tool ×
  two-window breakdown. Do not try to cram both tools into the menu-bar line.
- Freshness/diagnostic reflection in both the glyph and the dropdown, driven by
  the payload's `freshness` thresholds and `limitsDiagnostic` reason codes (the
  server supplies the thresholds; the plugin derives the band — same contract the
  web client already honors).
- Configuration via the existing `LLMDASH_*` env-var pattern where the plugin
  needs it (at minimum the port/base URL, so a non-default `LLMDASH_PORT` still
  works) — no dead knobs.
- README + install documentation of the menu-bar-host prerequisite and the
  one-time setup, honest about it being a user-installed external app.

## Out of Scope
- A native Swift/AppKit or Electron menu-bar app (rejected mechanism above).
- Any new data path, poller, or limit recomputation — the badge is a pure
  consumer of `/api/state`.
- Alerts / notifications when running low (that's Up Next item 2, "Limit
  alerts," a separate feature — the badge is passive/glanceable, not a push).
- Full parity of the dashboard's activity stats, trends, or charts in the badge.
  The badge is limits-remaining + freshness only; the dashboard stays the place
  for the deep view.
- Cross-platform menu-bar/tray support (Windows/Linux). macOS is the deployment
  reality (launchd service, `macos/` dir, install-macos.sh); a Linux tray is a
  possible later source-aware-style follow-on, not this feature.
- Building the `tmux`/terminal statusline consumer as part of this deliverable
  (noted as a cheap follow-on that reuses the emitter, but out of scope here).
- Bundling or auto-installing SwiftBar/xbar. llmdash documents the prerequisite;
  it does not vendor or silently install a third-party app.

## Key Decisions
- **Mechanism = a menu-bar host plugin (SwiftBar/xbar), not a native compiled
  app.** This is what keeps the feature inside the zero-dependency / no-build
  constitution. The one honest cost — the user installs a third-party menu-bar
  host — is **the single decision the user must ratify.** The natural moment to
  surface it is the Designer stage, where the user rejoins; the ratification is
  "yes, I'll `brew install --cask swiftbar` (or xbar) as a documented
  prerequisite." If the answer is no, the feature likely can't be built without a
  founding-brief-level reversal, so this sign-off gates the real work. The
  Architect should also spike SwiftBar-vs-xbar and document one as the default.
- **The badge is a pure consumer of the existing `/api/state` payload** — no
  second data path, no recomputed limits. This is a hard constraint from the
  multi-source discipline (CLAUDE.md): a new surface flows through the shared
  path, it does not fork the data.
- **Honesty carries to the smaller surface.** The badge must visibly distinguish
  fresh vs aging/stale/unavailable using the payload's server-supplied
  `freshness` thresholds and `limitsDiagnostic` reason codes — a stale or
  unavailable reading is never shown as a confident live number. This is the
  product's core value (honest measurement over feature count) surviving the
  format change, and it is non-negotiable.
- **Badge glyph default = the most-constrained window across tools in play**
  (lowest `remainingPct` among windows with a reading); the dropdown carries the
  full two-tool × two-window picture. The exact visual composition is deferred to
  the Planner/Designer, but the principle — glyph answers "how much do I have
  left right now," dropdown carries the detail — is settled.
- **Alignment confirmed with the founding brief.** Same user (someone pacing
  AI-coding usage to avoid throttling), same core purpose (authoritative
  remaining numbers, one glance away), squarely on-roadmap (Up Next 1). It
  *strengthens* the founding success image ("you glance… and immediately know how
  much you have left") by being the most glanceable surface yet. The only tension
  — zero-dependency constitution vs a native surface — is resolved by the plugin
  mechanism above, so no founding-brief revision is required.
