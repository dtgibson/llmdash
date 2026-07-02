# Design System — llmdash

Established at the first feature (Claude Code live dashboard). Every later feature
inherits this. Evolve it deliberately; never let it drift silently.

## Feel
Simple, functional, fast. A focused data readout for personal use. Library-light
(no framework, no component kit), glanceable, and honest about where each number
comes from. Mobile-first; at home on a phone over Tailscale.

## Tokens

Colors (light / dark):
- bg `#fafafa` / `#0e1013`
- panel `#ffffff` / `#161a1f`
- border `#e6e6e6` / `#262b32`
- text `#15171a` / `#e7eaee`
- muted `#6b7280` / `#9aa3ad`
- faint `#9ca3af` / `#6b7480`
- track (bar background) `#eceef0` / `#232830`
- status pill backgrounds: good-bg `#e7f6ec` / `#122a1b`; crit-bg `#fdeaea` / `#2c1517` (warn pill reuses warn-bg)
- accent `#2563eb` / `#6b9bff`; accent-bg `#eef2ff` / `#18203a`
- warn-bg (warn-tinted callouts) `#fef3e7` / `#2a1f12`
- grid (chart gridlines) `#eef0f2` / `#21262d`
- Status (both themes): good `#16a34a`, warn `#d97706`, crit `#dc2626`
- Status thresholds (remaining %): ≥50 good, 20–49 warn, <20 crit
- Theme: automatic via `prefers-color-scheme`

Type:
- Mono (all figures): `ui-monospace, SFMono-Regular, Menlo, Consolas`; tabular-nums.
- Sans (everything else): `system-ui` stack.
- Roles: display figure (~3.4rem mono, 600, tight tracking), tile/callout figure
  (~1.5rem mono, 600), body (~1rem sans), label/caption (~0.68–0.78rem; uppercase
  with 0.07–0.09em tracking for group labels).

Spacing & shape:
- Page max-width 720px, centered, 16–20px gutters.
- Radius: 12px panels, 10px tiles, 999px bars.
- Generous internal padding (16–20px). Whitespace is intentional.

## Patterns
- **Primary metric panel** (`.panel`): headline figure + label + status bar + meta
  line. For the most important live numbers (e.g. limit windows).
- **Stat tile** (`.tile`): compact secondary stat (label + figure + small note),
  used in grids.
- **Status bar** (`.bar` / `.bar-fill`): thin rounded bar; fill width = the
  positive value (remaining), colored by status threshold.
- **Featured callout** (`.burn`): accent-tinted panel for the single most
  actionable insight. Stacks vertically: a rate line, then one row per window.
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
- **Tool block** (`.tool` + `.tool-head`): groups one tool's gauges and activity
  under a labeled header. The grouping is how multi-source views stay
  unambiguous — every number sits under its tool's name.
- **Headroom strip** (`.headroom`): a top-of-page cross-tool cue (warn-tinted,
  left accent border). Shown only when a tool is low or maxed; it names the
  depleted tool and points to the one with the most remaining headroom. Hidden
  when everything is comfortable.
- **Chart card** (`.card`): a panel holding a title, a source/scope note, and a
  responsive SVG chart (`width:100%`, fixed viewBox). For time-series.
- **Range switch** (`.range` / `.pill`): a pill toggle for time ranges; the
  active pill uses the accent color.
- **Chart empty state** (`.empty`): a dashed card reading "not enough data yet"
  when a series is too thin to plot.
- **SVG charts:** plain SVG, minimal gridlines (`--grid`) + small mono labels,
  series colored from existing tokens (accent/teal for lines, mix colors for
  stacked bars). No chart library.

## References
None supplied by the user; the direction is anchored to "vanilla, basic, fast,
plain text" — a clean monospace data readout.

## Rationale
A personal, single-user tool that values speed and zero build friction over visual
flourish. No framework keeps it instant to load and trivial to run as a background
process. Monospace numerals plus status color make it scannable at a glance, which
is the entire point of the product. Auto light/dark and a narrow centered column
make it equally usable on phone and laptop.
