# Strategic Brief — Badge Display Options

## What We're Building

User-configurable display of the macOS menu-bar badge, set from the badge's own
dropdown. Today the badge renders exactly one thing — the single most-constrained
host, in one wide text entry (`▪ Studio·C 12%`) — and the user has no say in it.
This feature lets the user shape what the glance shows along three independent axes:

1. **Which host(s)** the glyph shows — all monitored hosts (today's behavior,
   collapsed to the tightest one), or a chosen subset / a specific host.
2. **Layout** — the selected hosts shown **side-by-side at once** in one menu-bar
   item, or **alternating in place** (SwiftBar cycles through them), or **single**
   (the most-constrained across the selection, today's default).
3. **Density** — the **wide** text entry it renders today, or a **compact**
   icon+number glyph that drops the host name / tool letter to shrink the width.

These are display preferences only. They change what the *glance* shows; they never
change which hosts are monitored, which hosts appear in the dropdown, or any of the
data the badge reads. No display config set = today's badge, byte-for-byte.

## Why Now

The badge earned this the moment it became multi-host. Once one Mac can watch
several tailnet machines (multi-host-badge, shipped 2026-07-03), the single
most-constrained glyph became a real compromise: it answers "am I about to get
throttled *anywhere*?" but it cannot answer "how are my two build machines doing,
side by side, at a glance?" — which is exactly the monitoring-station story the
multi-host work built toward. The user has a concrete setup in mind (e.g. "show my
two build machines side-by-side, compact"), and today's badge structurally can't
serve it.

It's also cheap now in a way it wouldn't have been before. Every ingredient this
feature needs already shipped and is proven:

- **The glyph model** — `computeMultiBadge` already ranks all hosts and picks the
  binding one; showing *several* selected hosts is a presentation change over the
  same per-host `hostViews` it already computes, not a new data path.
- **The config + edit pattern** — `hosts.conf` under the data dir, read by the
  poller/badge each tick, edited locally from the dropdown via a tracked
  action-helper (`host-config-action.mjs`) under `$ABS_NODE`, with the dashboard
  staying serve-only/405. Display preferences reuse this model exactly.
- **The honesty grammar** — five states (fresh/aging/stale/no-reading/offline),
  the C/X tool cue, the host cue, all xbar-safe (text/emoji + `color=`). The
  compact/multi layouts must carry this same honesty onto a denser surface, but the
  vocabulary already exists.

Doing it now, on top of proven plumbing, is materially cheaper than it would have
been as speculative flexibility baked into the badge earlier.

## The User Problem

The user runs llmdash across several tailnet machines and lives with the badge as
their most-glanceable surface. Their real monitoring setup doesn't match the one
thing the badge insists on showing:

- They want to keep a specific machine (or a couple) in view — their active build
  boxes — not have the glyph silently switch to whichever host happens to be
  tightest that minute. The most-constrained view is honest, but it's not always
  the view *they* want to watch.
- The wide entry (`▪ Studio·C 12%`) eats menu-bar width. On a crowded bar, or when
  they just want a quick color-coded pulse rather than a full readout, they want a
  compact icon.
- When they do want several hosts at once, they have no way to ask for it — the
  badge shows one host and buries the rest in the dropdown.

The problem is **personalization of the glance**: the badge should fit the user's
real monitoring layout, not impose one. Critically, this is about *presentation*,
not *coverage* — the user still wants to monitor everything (the dropdown stays the
full picture); they've just chosen what the ambient glyph shows.

## Success Criteria

- From the badge dropdown, the user can choose which monitored host(s) the glyph
  shows: all (default), a specific host, or a subset. The choice persists and
  survives a badge/service restart (it lives in the config file).
- The user can choose a layout for the selected hosts: single (most-constrained),
  side-by-side (all selected in one item), or alternating (cycling in place). The
  layout choice is honest about which mechanism it uses and reduces gracefully when
  only one host is effectively selected.
- The user can choose density: wide (today's text) or compact (icon+number). A
  **single compact icon** and **compact icons side-by-side** — the two forms the
  user named — both render legibly.
- The active choice on each axis is marked in the dropdown (a checkmark/dot), read
  live from the config so the menu never lies about the current setting.
- **Honesty survives every combination.** The five honesty states and each host's
  identity remain legible in compact density and in side-by-side / alternating
  layout — color plus a marker even without full text. An offline *selected* host
  is still shown/marked in the glyph it was selected for, never silently dropped.
- **Host selection is a view filter, never a monitoring change.** Polling still
  covers the full `hosts.conf` set; the dropdown still shows every monitored host;
  only the glyph is filtered. Deselecting a host from the display never stops it
  being watched.
- No display config set = today's badge, byte-for-byte (most-constrained, single,
  wide). One monitored host → side-by-side/alternating reduce to the single glyph;
  compact still applies. Every degenerate/unconfigured combination reduces sensibly
  and never breaks the glyph.
- The HTTP surface stays read-only (405 for non-GET/HEAD); display preferences are
  a local config write in the badge process, never a new endpoint.
- Zero runtime dependencies, no build step; the config layer and badge stay on
  `node:fs`/`node:http`/`node:child_process` + macOS `osascript`.

## Scope

- **Three display axes, set from a badge "Display" submenu.** Each axis is an
  enumerable set of choices, each choice a SwiftBar action that writes the chosen
  value to the local config. Because the inputs are enumerable (not typed text),
  the actions set a value **directly** — no `osascript` text-entry dialog is needed
  (simpler than the Add-host dialog). The active choice is marked, read live.
  - **Hosts:** all (default) | a specific host | a chosen subset.
  - **Layout:** single (most-constrained, default) | side-by-side | alternating.
  - **Density:** wide (default) | compact.
- **A small set of named presets over the raw axes** (recommended — see Key
  Decisions), presented in the Display submenu, that map to axis combinations:
  e.g. "Most-constrained · wide" (today), "All hosts · compact · side-by-side",
  "Rotate hosts · compact". The presets are the friendly surface; the axes are the
  underlying config the presets write. Selecting a preset sets the axes; the axes
  remain individually adjustable underneath.
- **Display preferences persisted in the local config the badge already reads.**
  Either as new directives in `hosts.conf` (`!display-hosts=`, `!display-layout=`,
  `!display-density=`) or a small sibling prefs file under the data dir — final
  location the Architect confirms (see Key Decisions for the recommendation). Read
  by the badge on the render tick, edited locally via the action-helper model,
  written atomically (temp+rename, `0o600`).
- **The glyph rendering for each layout × density combination**, extending the
  shipped xbar-safe five-state grammar: compact glyph form; side-by-side
  composition of multiple hosts' glyphs in one item; alternating via SwiftBar's
  multi-title-line mechanism. Bounded so side-by-side/alternating can't sprawl the
  menu bar or cycle an unwieldy set (sane caps + honest handling of a large
  selection).
- **Graceful reduction** for single-host, unconfigured, and degenerate combos
  (side-by-side of one host = single; etc.).
- **Honesty preserved** across compact + multi: five states, per-host identity,
  offline-selected-host still shown/marked.
- Disclosure: the display-preference config surface documented in README + startup
  health line, alongside the existing `hosts.conf` disclosure.

## Out of Scope

- **Any change to which hosts are monitored, or to the dropdown's full-picture
  view.** Host *selection* here filters the glyph only. The dropdown continues to
  show every monitored host with its full per-tool picture. Adding/removing
  monitored hosts stays the existing Add/Remove flow.
- **Any change to the `/api/state` or `/api/hosts` contract, or a new HTTP
  endpoint.** The badge stays a pure consumer; preferences are a local config write.
  If the feature appears to need a contract change, that's a flag to raise, not a
  silent coupling.
- **A settings screen on the dashboard web UI.** The configuration surface is the
  badge dropdown (and hand-editing the config file), consistent with how hosts,
  the service toggle, and uninstall are already managed from the menu bar. A web
  settings page is a different, larger surface and not part of this feature.
- **New honesty states, new color semantics, or new data.** This feature re-lays-out
  existing readings; it invents no new meter, cue, or state.
- **Per-tool display filtering** (e.g. "show only Claude, hide Codex" in the glyph).
  The axes here are host / layout / density; a tool-selection axis is a possible
  future addition, not this feature, unless it falls out trivially.
- **The tmux/terminal statusline emitter** (a separate roadmap item) — though it
  would likely reuse whatever display-preference model this feature establishes.

## Key Decisions

- **Independent-but-bounded axes, with named presets as the friendly front.** The
  three axes (hosts × layout × density) compose independently rather than as a rigid
  fixed list — this is honest to how the user actually thinks ("these two machines,
  compact, at once") and avoids a combinatorial menu of preset names. But raw axes
  alone are a fiddly surface, so the **recommendation is to offer a few named
  presets in the Display submenu that map onto the axes** (the two the user named —
  "single compact icon" and "compact icons side-by-side" — plus "most-constrained ·
  wide" = today, and "rotate hosts · compact"), with the individual axes adjustable
  underneath. Presets are the glance-friendly surface; the axes are the truth in the
  config file. The Designer/Architect finalize the exact preset set and submenu
  shape. **The user must ratify the preset list and the axis-vs-preset framing at
  the Designer stage** (it is squarely a visual/UX call).

- **Display preferences live in the config the badge already reads, set from a
  "Display" submenu of enumerable choices.** Recommendation: **extend `hosts.conf`
  with display directives** (`!display-hosts=`, `!display-layout=`,
  `!display-density=`) rather than a sibling file — `host-config.js` already parses
  `!`-directives (the `!local=` precedent), the poller/badge already read this one
  file each tick, and one file is one thing for the user to find and hand-edit. A
  sibling prefs file is the fallback if the Architect finds directive-in-hosts.conf
  awkward (e.g. host-subset selection needing richer structure than a directive line
  comfortably holds). Each choice is a SwiftBar action shelling to the action-helper
  under `$ABS_NODE` that writes the value directly — **no `osascript` text dialog**,
  since the inputs are enumerable menu choices (a checkmark/dot marks the active one,
  read live). Reuse the atomic-write + marker-gated-delivery + serve-only posture;
  **HTTP stays read-only. The Architect confirms the location + directive shape.**

- **Host selection is a VIEW FILTER, not a monitoring change — stated explicitly as
  a hard split.** "Display a specific host or hosts" selects which monitored hosts
  appear *in the glyph*. It must NOT change which hosts are polled (polling stays the
  full `hosts.conf` set) and the DROPDOWN still shows every monitored host. The glyph
  is the filtered view; the dropdown is the full picture. This keeps the founding
  honesty promise intact: you still monitor everything — you've just chosen what the
  glance shows. A selected host that goes offline is still shown/marked in the glyph
  (never silently dropped from the view it was selected for).

- **Honesty on a denser surface is a hard constraint, not a nice-to-have.** The five
  honesty states and per-host identity must remain legible in a compact icon and in
  side-by-side / alternating layouts — carried by color + a marker even when full
  text is dropped for width. This is the product's core "be honest in the UI"
  convention applied to a denser glyph. An offline selected host is shown/marked,
  never a fabricated zero. The Designer owns the exact compact glyph look and how
  each honesty state reads compact — flagged for user ratification at that stage.

- **The SwiftBar cycling + compact-rendering mechanism needs an Architect spike.**
  Two mechanics are load-bearing and must be confirmed before the layout options are
  finalized: (1) **does SwiftBar cycle/rotate through multiple pre-`---` title
  lines automatically?** — this is the likely native mechanism for "alternating in
  place" (a single pre-`---` line is one menu-bar item; "side-by-side" is one line
  concatenating several hosts' compact glyphs). (2) **what compact rendering holds
  the honesty states and stays xbar-safe** — an `sfimage=` SF Symbol (SwiftBar-only
  polish) vs. a text-glyph floor (colored dot + number), given the xbar-safe floor
  requirement. The Architect should spike both and confirm the alternating mechanism
  before the Designer commits the layout treatment.

- **Bound the width and the cycle.** Side-by-side must cap how many hosts / how wide
  before it's unwieldy (a menu-bar item can't be arbitrarily long); alternating's
  cycle set is the selected hosts. Recommend sane caps with honest handling when the
  selection exceeds them (e.g. show N and a "+M more" affordance, or fall back to
  most-constrained) — the exact treatment is the Designer's within these bounds.

- **Founding alignment: confirmed, no brief rewrite.** This is badge presentation
  polish + personalization, squarely within the founding "one glance, all your
  usage, honest" ethos — it makes the most-glanceable surface fit the user's real
  monitoring setup. Still single-user, local, honest, zero-dependency, serve-only.
  It's Improve-flavored (reshaping a shipped surface) but adds genuinely new display
  capability, which is fine for a feature. No change to `product-brief.md`.
