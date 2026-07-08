# Security Review — Menu-Bar Logo Side-By-Side

**Date:** 2026-07-08
**Feature:** menubar-logo-side-by-side
**Stack:** node http (minimal, few dependencies)
**Checklist:** Generic local Node/menu-bar improve-lane review; no Weft stack checklist maps directly to `backend: "node http (minimal, few dependencies)"`
**Outcome:** PASSED WITH NOTES

---

## Summary

Reviewed the menu-bar logo sizing and side-by-side image changes for new attack surface, trust-boundary changes, dependency changes, and unsafe runtime behavior. The implementation only adds bundled local PNG assets and opt-in SwiftBar `templateImage` rendering; it does not add network fetches, dependencies, shell execution, API changes, persistence changes, or host polling changes. No security issues were found.

---

## Findings

No security issues found in this feature.

---

## Checks Performed

| Check | Result |
|---|---|
| Diff hygiene via `git diff --check` | Pass |
| Runtime dependency surface | Pass — `package.json` still has zero runtime dependencies |
| Dependency vulnerability scan | Note — `npm audit --omit=dev` cannot run because the project has no lockfile; this feature did not add dependencies or a lockfile |
| Logo asset source | Pass — assets are bundled under `scripts/menubar/assets/` and read with `node:fs` |
| Runtime network fetches for logo art | Pass — no fetch/XMLHttpRequest or URL-based logo download was added |
| Process execution surface | Pass — no new `exec`, `execSync`, `spawn`, or `osascript` path was added |
| SwiftBar parameter output | Pass — image data is emitted only as base64 `templateImage=` when `toolMark=logo`, host is SwiftBar, and the view group is `tool` |
| Missing/unreadable assets | Pass — missing assets return `null`, leaving the neutral text floor visible |
| Fallback readability | Pass — tests confirm `◆` / `▲` text remains present with logo images and xbar/no-SwiftBar remains text-only |
| API/polling/persistence/service controls | Pass — no touched code changes those contracts |
| Asset dimensions and file type | Pass — tests validate PNG signatures and 16x16 or 34x16 status-bar dimensions |

## Evidence

- [scripts/menubar/llmdash.5s.js](/Users/developer/devwork/llmdash/scripts/menubar/llmdash.5s.js:1141) constrains logo rendering to local assets, SwiftBar logo mode, and the tool view.
- [tests/menubar-display.test.js](/Users/developer/devwork/llmdash/tests/menubar-display.test.js:317) verifies single-logo `templateImage` rendering keeps the neutral floor and uses a 16x16 image.
- [tests/menubar-display.test.js](/Users/developer/devwork/llmdash/tests/menubar-display.test.js:329) verifies side-by-side logo mode emits the paired 34x16 image plus `◆` / `▲` text.
- [tests/hosts-zerodep.test.js](/Users/developer/devwork/llmdash/tests/hosts-zerodep.test.js:55) verifies the PNG files are source assets, not package dependencies, and are read through `node:fs`.
- [package.json](/Users/developer/devwork/llmdash/package.json:1) has no dependency entries.
