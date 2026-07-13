# Design System — llmdash

Reusable visual and interaction reference for every llmdash surface. Evolve it
deliberately; never let it drift silently.

## Feel
Simple, functional, fast. A focused data readout for personal use. Library-light
(no framework, no component kit), glanceable, and honest about where each number
comes from. Mobile-first; at home on a phone over Tailscale. Account-window gauges
lead, pacing follows as the actionable layer, and supporting activity, provenance,
and trends stay quieter. The native menu mirrors that order in text instead of
imitating web cards.

## Tokens

Colors (light / dark):
- bg `#f5f7fa` / `#0c1015`
- panel `#ffffff` / `#151b22`; panel-soft `#f8fafc` / `#11171e`
- border `#dfe5ec` / `#27303b`; border-strong `#cfd7e2` / `#34404e`
- text `#151a21` / `#edf1f5`
- muted `#667181` / `#a0aab6`; faint `#8994a3` / `#75808d`
- track (bar background) `#e8edf3` / `#252e39`
- status pill backgrounds: good-bg `#e8f6ed` / `#14291d`; crit-bg
  `#fdebec` / `#32191c` (warn pill reuses warn-bg)
- accent `#2563eb` / `#7ea4ff`; accent-bg `#eaf0ff` / `#18243e`
- warn-bg (warn-tinted callouts) `#fff2df` / `#2b2114`
- grid (chart gridlines) `#e9edf2` / `#232b34`
- tool identity: Claude `#b85d43` / `#e18468`; Codex reuses accent
- Status: good `#168a45` / `#55cb7b`, warn `#b96807` / `#e8a54e`, crit
  `#cc3434` / `#ff7777`
- Status thresholds (remaining %): ≥50 good, 20–49 warn, <20 crit
- Depth: `--gauge-shadow` is reserved for primary account gauges; focus uses
  `--focus-ring`; page atmosphere uses low-opacity accent/good glows.
- Theme: automatic via `prefers-color-scheme`

Type:
- Mono (all figures): `ui-monospace, SFMono-Regular, Menlo, Consolas`; tabular-nums.
- Sans (everything else): `system-ui` stack.
- Roles: display figure (~3.4rem mono, 600, tight tracking), tile/callout figure
  (~1.5rem mono, 600), body (~1rem sans), label/caption (~0.68–0.78rem; uppercase
  with 0.07–0.09em tracking for group labels).

Spacing & shape:
- Page max-width 860px, centered, with 16px desktop gutters and 11px phone
  gutters.
- Radius: 16px tool sections, 13px gauges, 10–12px supporting groups and
  callouts, 999px bars and pills.
- Generous internal padding (16–21px). Whitespace is intentional.

## Patterns
- **Cross-surface reading order:** dashboard = account-window gauges → pacing →
  supporting activity/provenance → trends; native menu = binding summary →
  host/tool readings → attached diagnostics → settings/actions. Preserve this
  order as either surface gains content.
- **Primary metric panel** (`.panel`): headline figure + label + status bar + meta
  line. Account-window gauges are the only strongly elevated metric layer.
- **Stat tile** (`.tile`): compact secondary stat (label + figure + small note),
  grouped into a flat divided band rather than a grid of elevated cards.
- **Status bar** (`.bar` / `.bar-fill`): thin rounded bar; fill width = the
  positive value (remaining), colored by status threshold.
- **Pacing band** (`.burn`): compact accent-tinted second layer immediately below
  the account gauges. It stacks a rate line and one aligned row per window.
- **Pacing pill** (`.burn-pill` + `.pill-good` / `.pill-warn` / `.pill-crit`): a
  small status-tinted chip (ON PACE / AT RISK / LIMIT REACHED) in each window's
  pacing row inside the burn callout. Color by remaining-% status, backed by
  the good-bg / warn-bg / crit-bg tokens.
- **Age pill** (`.age-pill` + `.pill-warn` / `.pill-crit`): inline status chip
  in a tool header's sub line flagging the freshness of a reading ("aging" /
  "stale"). Same chip grammar as the pacing pill (uppercase via CSS — DOM text
  stays lowercase — mono, 999px radius) in an inline variant: padding 2px 9px,
  margin-left 6px, vertical-align 1px, nowrap. A healthy state renders no pill
  at all, so escalation is structural, never color-alone; the flag word itself
  carries the meaning first.
- **Stale-data note** (`.stale-note`): a crit-tinted callout for a data-quality
  warning, rendered directly below the gauges it qualifies. Reuses the headroom
  strip's grammar (tinted background + 3px left accent border) with the crit
  tokens (`--crit-bg` background, `--crit` left border), radius 10px, padding
  11px 14px, tabular-nums so live ages don't jitter. States the problem plainly
  and names the remedy; lead words bolded. Qualified data keeps rendering —
  flagged, never blanked.
- **Section label** (`.section-label`): small uppercase header above a cluster.
- **Freshness indicator:** pulse dot + "updated Ns ago", tabular-nums.
- **Honesty line:** when a number's source or scope differs from the headline
  data, say so plainly (e.g. footer).
- **Tool block** (`.tool` + `.tool-head`): the principal grouping surface for one
  tool's gauges and activity. A slim `--tool-color` rail plus `◆` / `▲` mark
  establishes identity; avoid nested equal-weight card shells inside it.
- **Host group** (`.host-head` + `.host-pill`): the machine-scoped wrapper for
  multi-host views — one host's tool blocks sit under a header carrying its
  escaped label and a right-aligned status pill (`binding` / `you` accent or muted
  pills; a freshness `aging`/`stale` or offline `unreachable` pill reusing the
  age-pill grammar; fresh → an "updated Ns ago" with a good pulse dot and **no**
  pill, so escalation stays structural). It layers the host axis in front of the
  tool axis without forking the tool block. Honesty rules travel with it:
  same-account limits (matching reset epochs) collapse to a single shared banner
  shown **once** (never N budgets); an unreachable host is a named offline callout
  (`.stale-note` grammar), never a stale meter; a monitoring-station host with no
  local readings is de-emphasized (dimmed, pinned last, `no local activity` idle
  pill) but still shown — no fabricated zeros. The menu-bar badge miniaturizes the
  same vocabulary onto one glyph + dropdown (glyph host cue `▪ <host>·◆ <pct>`,
  the tightest machine named), so a change here should hold for both surfaces.
- **Tool marks** (`◆` Claude / `▲` Codex): the neutral glyph pair that identifies
  which tool a reading is — different silhouettes (diamond vs. triangle), solid,
  monochrome-legible at menu-bar size (a same-shape/different-fill pair like
  `◇`/`◆` blurs and is rejected). Used wherever a tool is named in a text surface
  (the badge's per-host cue and per-tool aggregate). They are the **default cue**,
  having replaced the older `C`/`X` letters. An opt-in product **logo** may replace
  a mark as a small template-image, but the neutral glyph is always the floor —
  identity never depends on an image rendering.
- **Compact glyph cell** (menu-bar badge): the five-state honesty vocabulary
  miniaturized to a marker + number for a menu-bar line. `fresh` = bare `<pct>` in
  its status hue; `aging` = `◷<pct>`; `stale` = `⚠<pct>`; `no-reading` = `—`
  and `offline` = `⊘` (the latter two carry
  **no number** — the never-a-fabricated-number floor is structural). The marker is
  the load-bearing carrier (reads in a monochrome bar even with color stripped);
  color reinforces, never carries alone. A leading `▪` marks identity once. Layout
  axes over the cells: single / side-by-side (one line, one `color=` = the binding
  cell, per-cell state on the marker, capped with `+M more`) / alternating (one
  cell per ~5s tick, stateless clock rotation). A **grow-prefix host cue**
  (`St`/`La`/`De`) restores per-host identity in multi-cell layouts. This is the
  text/`color=` floor that holds on xbar. In SwiftBar logo mode, a successfully
  generated local image may replace the visible tool mark; neutral marks remain
  the fallback whenever image rendering is unavailable.
- **Headroom strip** (`.headroom`): a top-of-page cross-tool cue (warn-tinted,
  left accent border). Shown only when a tool is low or maxed; it names the
  depleted tool and points to the one with the most remaining headroom. Hidden
  when everything is comfortable.
- **Chart group** (`.charts` + `.card`): responsive SVG plots (`width:100%`, fixed
  viewBox) sit in a lightly divided soft-surface group beneath one Trends header.
  They stay visually quieter than live gauges and form two columns only when the
  reading width supports it.
- **Range switch** (`.range` / `.pill`): a pill toggle for time ranges; the
  active pill uses the accent color and exposes matching hover, focus-visible,
  pressed, and `aria-pressed` states.
- **Chart empty state** (`.empty`): a dashed card reading "not enough data yet"
  when a series is too thin to plot.
- **SVG charts:** plain SVG, minimal gridlines (`--grid`) + small mono labels,
  series colored from existing tokens (accent/teal for lines, mix colors for
  stacked bars). No chart library.
- **Native dropdown hierarchy:** keep the status-bar title to one line, then use
  SwiftBar/xbar separators, font size, indentation, `◆` / `▲`, and semantic text
  color to structure the dropdown. Diagnostics sit directly beneath the tool
  readings they qualify. Display, Legend, service, host, uninstall, dashboard,
  and refresh controls form the final quieter action region; action rows remain
  distinct from inert text rows.
- **Motion:** meter/segment widths may transition for 220ms with
  `cubic-bezier(.2,.8,.2,1)`; range state may transition for 160ms ease-out and
  focus for 120ms. Disable effective motion under `prefers-reduced-motion`; use
  no entrance, stagger, bounce, hover-scale, or continuous decoration.

## References
None supplied by the user; the direction is anchored to "vanilla, basic, fast,
plain text" — a clean monospace data readout.

## Rationale
A personal, single-user tool that values speed and zero build friction over visual
flourish. No framework keeps it instant to load and trivial to run as a background
process. Monospace numerals plus status color make it scannable at a glance, which
is the entire point of the product. Automatic light/dark themes and a centered
reading column make it equally usable on phone and laptop; the same hierarchy
survives in the native menu through text and spacing rather than web chrome.
