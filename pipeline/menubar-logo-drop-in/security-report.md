# Security Review — Menu-Bar Logo Drop-In

**Date:** 2026-07-09
**Feature:** menubar-logo-drop-in
**Stack:** node http (minimal, few dependencies)
**Checklist:** Generic local Node/menu-bar improve-lane review; no Weft stack checklist maps directly to `backend: "node http (minimal, few dependencies)"`
**Outcome:** PASSED WITH NOTES

---

## Summary

Reviewed the logo replacement change for new attack surface, trust-boundary changes, dependency changes, and SwiftBar parameter safety. The implementation uses only Node builtins and bundled local PNG assets, generates a base64 PNG from fixed asset names and a fixed hex title color, and keeps the text fallback when image generation fails. No security issues were found.

---

## Findings

No security issues found in this feature.

---

## Checks Performed

| Check | Result |
|---|---|
| Diff hygiene via `git diff --check` | Pass |
| Runtime dependency surface | Pass — `package.json` still has zero runtime dependencies; `node:zlib` is a Node builtin |
| Dependency vulnerability scan | Note — `npm audit --omit=dev` cannot run because the project has no lockfile; this feature did not add dependencies or a lockfile |
| Logo asset source | Pass — assets are bundled under `scripts/menubar/assets/` and read with `node:fs` |
| Runtime network fetches for logo art | Pass — no fetch/XMLHttpRequest or URL-based logo download was added |
| Process execution surface | Pass — no new `exec`, `execSync`, `spawn`, or `osascript` path was added |
| SwiftBar image parameter | Pass — `image=` receives base64 produced from local PNG bytes and parsed fixed hex colors, not user-controlled text |
| Image decode/re-encode failure mode | Pass — decode, color parse, or file read failure returns `null`, preserving the neutral `◆` / `▲` text fallback |
| API/polling/persistence/service controls | Pass — no touched code changes those contracts |
| Test coverage of fallback and color behavior | Pass — tests verify no visible `◆` / `▲` in successful SwiftBar logo mode, same-color PNG output, and text glyph fallback for non-SwiftBar output |

## Evidence

- [scripts/menubar/llmdash.5s.js](/Users/developer/devwork/llmdash/scripts/menubar/llmdash.5s.js:1142) limits logo generation to local assets, SwiftBar logo mode, and the tool view.
- [scripts/menubar/llmdash.5s.js](/Users/developer/devwork/llmdash/scripts/menubar/llmdash.5s.js:1192) parses only six-digit hex colors before recoloring.
- [scripts/menubar/llmdash.5s.js](/Users/developer/devwork/llmdash/scripts/menubar/llmdash.5s.js:1320) catches image read/recolor failures and caches `null`, leaving the fallback text path intact.
- [scripts/menubar/llmdash.5s.js](/Users/developer/devwork/llmdash/scripts/menubar/llmdash.5s.js:1363) only strips tool glyph text after image generation succeeds.
- [tests/menubar-display.test.js](/Users/developer/devwork/llmdash/tests/menubar-display.test.js:347) verifies successful SwiftBar logo mode replaces visible glyphs and matches the title color.
- [tests/menubar-display.test.js](/Users/developer/devwork/llmdash/tests/menubar-display.test.js:374) verifies non-SwiftBar output keeps text glyphs and emits no image parameter.
