# Strategic Brief — Weekly Limit Predictor and Codex Stats

## What We're Building
Add a weekly-limit predictor alongside the existing 5-hour pacing predictor, so
the dashboard shows whether each tool is on pace to stay under both windows.
Also audit Codex's currently available local data and surface any additional
stats only if they are real and reliable.

## Why Now
The dashboard already helps avoid surprise 5-hour lockouts, but weekly caps can
still become the binding constraint. Showing both predictors keeps the pacing
model honest across the two windows the product already tracks.

## The User Problem
You need to know not just how much usage remains, but whether your current burn
rate is likely to exhaust a limit before reset. Today that judgment exists for
the 5-hour window only, leaving weekly pacing as mental math.

## Success Criteria
- The UI shows a 5-hour predictor and a weekly predictor at the same time.
- Each predictor names the relevant window and reset timing clearly.
- A weekly limit that is on pace, tight, or likely to run out is called out
  distinctly from the 5-hour result.
- The predictor logic works for Claude Code and Codex limit windows where data
  exists.
- Codex stats are audited again; any newly available reliable stats are surfaced,
  and unavailable stats remain explicitly marked as unavailable.

## Scope
- Add weekly pacing calculation using the same source-aware limit data path as
  the existing 5-hour predictor.
- Render both pacing signals in the dashboard without hiding one behind the
  other.
- Preserve the existing headroom cue behavior across 5-hour and weekly windows.
- Re-check Codex local sources for additional usable stats.
- Add focused tests for weekly pacing and Codex data availability behavior.

## Out of Scope
- Alerts or notifications.
- Menu-bar or tray badge.
- General ChatGPT chat caps.
- Guessing Codex token activity from incomplete or private data.
- Any credential workaround or unsupported API use.

## Key Decisions
- Show both predictors simultaneously.
- Treat weekly pacing as a first-class signal, not a fallback behind the 5-hour
  predictor.
- Codex stats must stay honest: display real data if available, otherwise say not
  available.
