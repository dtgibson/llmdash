# Decisions — menu-bar-badge

## Stage 4 (Designer review) — 2026-07-02
- **User ratified the SwiftBar prerequisite.** The badge ships as a zero-dependency
  plugin rendered by the user-installed SwiftBar menu-bar host
  (`brew install --cask swiftbar`), documented as a prerequisite, never
  auto-installed. xbar stays a documented alternative.
- **Design steer applied — "nice to see more information if it can be presented
  cleanly."** Two revisions came out of it:
  - **Aging keeps its information.** An aging glyph keeps the real number in its
    good/warn/crit status color (you still see *how much*), marked as aging by a
    trailing `·` plus a slight (~0.82) de-emphasis — not a grey wash. The `·` is the
    load-bearing honesty marker (distinct from fresh even in a monochrome bar).
    Stale unchanged (amber + `⚠`).
  - **Binding-tool cue adopted.** The glyph names which tool is tight: `C` = Claude
    Code, `X` = Codex (borrows its **X**). One muted monospace letter after the mark
    (`▪C 46%` / `▪X 12%`), derived (no payload change), rides the honesty state,
    omitted in no-reading/offline. README documents the C/X mapping (X-for-Codex is
    learnable, not self-evident).
  - Everything else approved as-is (five-state model, dropdown layout, symbol set,
    honesty rules, most-constrained-window default). No design-system extension.
- **Scope decision — configurable single host now, multi-host deferred.** The user
  asked (at the gate) whether the badge can specify the hostname (llmdash is served
  over Tailscale) and whether multiple hosts can show at once/by switching. Ratified:
  **ship a configurable `HOST`** this build (default `127.0.0.1`, overridable via a
  documented one-line constant or `LLMDASH_BADGE_HOST`, to point at any tailnet
  machine's dashboard) — still the same `/api/state` contract, not a second data
  path. **Multi-host** (a host *list* with per-machine dropdown grouping and glyph
  selection/switching) is a **deferred follow-on feature** — kept out to protect the
  clean single-glyph scope; the plugin is built so a host list can slot in later
  without a rewrite. Roadmap "On the Horizon" gets the multi-host follow-on at
  close-out.
