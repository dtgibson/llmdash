# Security Report — badge-display-options (Stage 7, The Auditor)
**Date:** 2026-07-03 · **Verdict:** pass (no exploitable issues within the tailnet/
serve-only threat model)

## Posture confirmation
| # | Invariant | Result |
|---|---|---|
| (a) | No-shell / no-osascript / atomic / no-traversal local write | **PASS** — `display-action.mjs` → `writeDisplayConfig` → atomic temp+rename `0o600`; enumerable ARGV values only; bad enum/unknown verb writes nothing; no `execSync`/shell string, no `osascript`; path fixed (`config.hostsFile` / `--file=` seam), never input-derived (`../../etc/passwd` preset id → `unknown-preset`, no file); newlines/`\|`/`=`/spaces stripped → cannot smuggle a directive, a second line, or a host entry (7-attack PoC all neutralized). |
| (b) | Case-fix did not weaken the sanitizer | **PASS** — the `[A-Za-z0-9._:\-\[\]]` strip runs on every key; case-preservation only added inert `A-Z` identity chars; enum axes still lowercase-match; `all` sentinel case-insensitive. |
| (c) | SwiftBar-grammar injection blocked | **PASS** — the first `\|` on every line is code-authored; a hostile label is `sanitize()`-quarantined in the visible-text half, never the params half (no rogue `bash=`/`shell=`); `param3` uses `sanitizeHostPort`; `href`/`shell=` are constants + `$ABS_NODE` + enumerable/sanitized values only. |
| (d) | Logo asset passive / local / opt-in / floor-always | **PASS** — `node:fs` read only (no network, no `import()`, no eval); fixed-relative via `import.meta.url`; read only when `toolMark=logo` (& SwiftBar & the single tool-aggregate cell); reaches the line only as a passive base64 `templateImage=`; the neutral `◆`/`▲` text floor is emitted **unconditionally**. |
| (e) | Serve-only / 405 / headers intact | **PASS** — `server.js` unmodified; non-GET/HEAD → 405 (`allow: GET, HEAD`); no new HTTP write surface; the `0.0.0.0` bind gains no mutation surface. |
| (f) | Externally-sourced data stays normalized to the render sink | **PASS** — no new `/api` field; the aggregate/compact/side-by-side formatters consume already-coerced `remainingPct` and `sanitize()`'d labels; a hostile peer field cannot reach a SwiftBar line. |
| (g) | Disclosure honest | **PASS** — README + `healthLines()` disclose the `◆`/`▲` cue change, the axes, the logo posture, and the network binding; the `install-macos.sh` change is disclosure-only (two echoes). |

## Findings (all Informational — none block deployment)
- **INFO-1 — Logo fair-use posture (operator deploy-gate decision).** As shipped there is
  **no** trademark exposure: original monochrome placeholder marks + an honest `LICENSE.md`
  + opt-in + a guaranteed neutral floor. The concern only materializes if the operator
  later drops **real** brand marks into the two filenames — a nominative-fair-use call for
  the user to own. Recommendation: **ship with placeholders**; treat "real logos" as a
  separate explicit choice. The code's honesty invariants hold either way.
- **INFO-2 — Inert stored-key garbage (harmless by construction).** A crafted
  `!display-hosts` toggle value is scrubbed to a single inert token on one line, never
  promoted to a host entry or a second directive; at the badge it simply fails to match and
  falls back to `all`. No impact; matches the ratified "unknown keys resolve at the badge"
  design.
- **INFO-3 — `truncateHostCue` did not itself sanitize (HARDENED in-stage).** Safe today
  (inputs are ingest-sanitized), but a latent coupling. **Applied:** `truncateHostCue` now
  defensively `sanitize()`s its input (symmetry with `growPrefixCues`), closing the class
  against a future un-ingested caller. Full suite green after: 464 / 462 / 0 / 2.

## Fair-use note (for the deploy gate)
As shipped: a clean, honest posture for a personal open-source project (opt-in, off by
default, neutral floor always, original placeholder art with an explicit `LICENSE.md`). No
action required to ship. Replacing the placeholders with real Claude/OpenAI marks later is a
separate operator choice — the code stays honest regardless.

## Hermetic confirmation
Real install untouched — all dynamic probing wrote only to `os.tmpdir()` scratch + the
session scratchpad; the pre-existing `~/.llmdash`, SwiftBar `Plugins` dir, and
`com.llmdash.dashboard.plist` predate the session and are unmodified; no `osascript` run;
nothing committed, pushed, or restarted during the audit.
