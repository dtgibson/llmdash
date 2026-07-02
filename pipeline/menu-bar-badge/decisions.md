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

## Stage 8 (Deployer) — 2026-07-02
- **Shipped and verified live.** Commits 7c2105a (feature), 086896a (symlink
  run-guard fix + hermetic install tests), 9eb3e3f (wrapper redesign) on
  origin/main; installed copy at ~/llmdash fast-forwarded. The badge renders
  live in the real macOS menu bar via SwiftBar: `▪ C 44%` (Claude weekly, the
  tightest window), pulled from the live 8787 dashboard. The user installed
  SwiftBar (`brew install --cask swiftbar`); the badge was wired via
  `--setup-badge`.
- **Two real defects found at deploy by exercising the true delivery path
  (running the plugin the way SwiftBar does, via a symlink/wrapper — the unit
  tests had only ever spawned it by its real path):**
  1. **Blank badge under SwiftBar** — the plugin's ESM run-guard compared
     `process.argv[1]` to `import.meta.url`; Node de-symlinks the latter but not
     the former, so under the symlink `main()` never fired. Fixed with a realpath
     comparison; added a symlink-invocation regression test (the missing seam).
  2. **Installer dirtied its own checkout** — `--setup-badge` baked the absolute
     node path into the *tracked* plugin shebang and symlinked it in, dirtying
     ~/llmdash so the installer's main-flow `git pull --ff-only` would abort on
     re-run (breaking "safe to re-run"). Redesigned: `--setup-badge` now writes a
     generated POSIX-sh **wrapper** into SwiftBar's dir that execs an absolute node
     against the tracked plugin — the tracked source is never modified, the
     checkout stays clean, and the badge auto-updates on pull. A self-heal restores
     a shebang an older installer baked. `--remove-badge` deletes only a legacy
     symlink or a marker-carrying wrapper — never a user's unmarked file.
- **Test-hermeticity fix (found because the real SwiftBar install changed machine
  state):** the install tests read the real user's SwiftBar preference
  (`defaults read` ignores `$HOME`), so they leaked into the real plugin dir and
  went red once SwiftBar was actually installed. Added `LLMDASH_SWIFTBAR_DIR` as an
  authoritative detection override (also useful for a custom SwiftBar plugin
  folder); every install test now pins a scratch dir. Suite hermetic regardless of
  the dev's machine. 181 tests (179 pass, 2 graceful skips).
- Security re-checked twice in-stage (the `--remove-badge` addition, then the
  wrapper redesign): PASSED WITH NOTES, no blocking findings.
