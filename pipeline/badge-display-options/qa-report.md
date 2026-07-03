# QA Report — badge-display-options (Stage 6, The Tester)
**Date:** 2026-07-03 · **Verdict:** pass-with-findings (the one finding fixed in-stage)

## Test results
- Shipped suite: **464 tests, 462 pass, 0 fail, 2 skip** (the 2 skips are the
  pre-existing environmental skips — both gated on "a system-wide node exists on this
  machine": `--resolve-node` loud-failure and `--setup-badge` node-unresolved; neither
  is related to this feature).
- The noted `menubar-install` / `launchctl bootstrap` flake **did not reproduce** across
  3 back-to-back isolated runs; no new skip or flake introduced by the feature.
- Tester's hermetic reproduction/probe suite `tests/qa-badge-display.test.js` (17 tests,
  incl. the mixed-case regression guard) — kept as **permanent regression coverage**.

## Coverage (all 12 acceptance areas verified by asserting emitted stdout / file state)
1. Suite honestly green (isolated the 2 pre-existing skips; 3× flake check).
2. Five honesty states compact + wide; **no digit for no-reading/offline** in every
   layout — structural (no code path emits a digit), verified across layouts×groups×epochs.
3. The ratified `C`/`X`→`◆`/`▲` default cue — shipped tests updated (not reverted), a pin
   test guards a silent revert, byte-for-byte single (`▪ ◆ 46%`) + multi (`▪ Studio·◆ 12%`)
   via a live symlink smoke.
4. Per-tool aggregate = tightest-window min across the **selected** hosts; honest `—`
   (no reading anywhere) vs `⊘` (all contributing hosts offline); **2 units / no cap /
   no `+M`** even with 6 hosts; Hosts scopes the aggregate; independence; binding-first.
5. View-filter-not-coverage — dropdown renders the **full** hostViews while the glyph is
   filtered; a selected offline host **stays** with `⊘`; all-unknown → `all`.
6. Layouts — side-by-side cap 3 + `+2` binding-first; alternating stateless wrap;
   degenerate one-host → single.
7. Display submenu both modes — 6 presets, 5 axes, `✓` live, preset active only on a
   4-axis match, tool-mark orthogonal, Hosts multi-select toggle.
8. Legend both modes — static, complete (5 states + both marks + 3 colors + `✓` + cue + `+M`).
9. Write helper — round-trips all 5 axes + entries + `!local`; preset writes 4 axes and
   leaves `toolMark`; atomic `0o600`, no temp leak; no osascript/HTTP — via the symlinked
   helper with the `--file` seam.
10. Tool marks / logos — neutral `◆`/`▲` floor always; `templateImage=` only under the
    SwiftBar guard + opt-in; xbar emits `◆` alone; asset resolves via `import.meta.url`
    and encodes a real PNG under the symlink; placeholder assets are honest original art.
11. Serve-only / zero-deps / disclosure — no HTTP write path; 405/404 route test; runtime
    deps still 0; README + `healthLines()` disclose the axes/aggregate/logos+fair-use/
    legend/view-filter/cue change.
12. Real-invocation smoke — ran the plugin **through a real symlink** against a fixture
    server for every mode; asserted stdout, not just exit.

## Findings
**[MAJOR — fixed in-stage] Host view-filter was case-broken.** The read path lowercased
stored `!display-hosts` keys (`host-config.js` `parseDisplayHosts` + the blanket
directive-value `.toLowerCase()`) while the write path and the badge's `addr`
(case-preserving `sanitizeHostPort`) kept case. A mixed-case key (e.g. `Studio.local:8788`)
selected in the submenu wrote case-preserved, read lowercased, failed the intersection, and
**silently fell back to `all`** (glyph showed the wrong host). Exposure: any host key with
an uppercase letter (`.local` Bonjour names, uppercase IPv6 hex). **Fix:** `!display-hosts`
now parses the case-preserved value (enum axes still lowercase-match; the `all` sentinel is
case-insensitive) — read/write/addr are now consistent. Regression test added. No blocker,
no other major/minor findings.

## Honesty / safety
- No fabricated zeros (structural — verified across every layout×group×epoch; honest
  `—`/`⊘`; a selected offline host shows `⊘`, never dropped/zeroed).
- Byte-for-byte-save-the-cue (unconfigured = today's badge with only `C`/`X`→`◆`/`▲`).
- Serve-only (no POST/PUT/DELETE/PATCH; local atomic write; no osascript, no HTTP).
- Hermetic / real install untouched (scratch only; real data dir, SwiftBar plugin dir,
  and launchd service neither created nor modified; scratch cleaned).
