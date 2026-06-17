# Bug Brief — Codex Stats & Quota Display

## What is broken
1. **Codex activity shows zeros.** The Codex activity tiles read 0 tokens (5h /
   today), 0% cache hit, $0 value — even though Codex is in use. Looks broken.
2. **A maxed quota isn't surfaced.** Codex's weekly window is 100% used (0% left),
   but the burn callout still says "on pace to stay under the 5-hour limit."
3. **The headroom strip never appears**, even now with a window fully maxed.

## Steps to reproduce
1. Open the dashboard while Codex's weekly window is at 100% used.
2. Codex activity tiles show `0` / `$0` / `0%`.
3. Codex's burn callout reads "on pace to stay under the 5-hour limit" despite the
   weekly being gone.
4. The yellow headroom strip at the top is absent.

## Expected behavior
1. Codex activity shows an honest **"not available"** state (not zeros) — there is
   no local token source for this Codex build.
2. A fully-used window (≈0% remaining) shows **"limit reached,"** and the
   burn/projection reflects the binding limit, not just the 5-hour.
3. The headroom strip appears whenever **any** window (5-hour *or* weekly) on
   either tool is low or maxed, pointing to the tool with the most headroom.

## Root cause
1. Codex activity reads `~/.codex/sessions/rollout-*.jsonl` (and would use
   `threads.tokens_used`); this Codex variant writes **neither** — no rollout
   files, thread tables empty (confirmed via a WAL-merged snapshot), logs hold no
   structured token data. So `computeCodexActivity` returns all zeros; the UI
   still renders zero tiles even though `hasData:false`.
2. `projectFiveHour` and the burn callout consider only `five_hour`; a maxed
   `seven_day` is ignored, and a 0%-remaining window gets no "limit reached"
   treatment.
3. `computeHeadroom` (src/server.js) compares only `five_hour` remaining — it
   never inspects `seven_day`, so a maxed weekly never triggers it.

## Blast radius
- Bug 1: Codex activity rendering (`public/app.js` toolHtml/tilesHtml/mixHtml) +
  an honest empty signal; Claude activity unaffected (it has data).
- Bug 2: gauge + burn rendering (`public/app.js`); applies to both tools.
- Bug 3: `computeHeadroom` (`src/server.js`) + headroom strip rendering.
- All UI/logic; **no schema change.** Add test coverage for the both-window
  `computeHeadroom`.

## What done looks like
- Codex activity reads "not available" — no fake zero tiles/mix.
- A window at ≈0% remaining shows "limit reached"; the burn callout reflects the
  binding (maxed) window, not a comfortable 5-hour projection.
- The headroom strip fires when any window on either tool is low/maxed (e.g.
  Codex weekly maxed → "switch to Claude Code"), with a test for the weekly case.
