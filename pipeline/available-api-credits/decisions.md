# Decisions — Available API Credits

## Stage 4 — The Designer (2026-10-01)

Designed within the established `pipeline/design-system.md`; no evolution of the look. The entries below are the only places the design extends the system or departs from the Weft design doctrine, each on purpose.

1. **Sub-block hairlines inside a supplementary group** (`.credit-block-lead` / `.credit-block-tail`). The Codex group now carries two facts under two headings; a 1px `--border` rule between them keeps "three distinct facts" visible, not just labelled. This is a new in-group boundary pattern (the shipped groups separated sub-blocks by heading margin alone). Additive; the existing Codex "Model caps" nested title is untouched. Candidate to fold into design-system.md under the supplementary band pattern.

2. **Status is a word, not a figure.** "Credits available" / "No credits" / "Unlimited" render at .9rem mono 650 (the `.promotion-title` class of weight), not the 1.42rem accent numeral used for the reset count. A second large number beside the reset count would invite reading them as one total (US-03, FR-24). "No credits" is additionally muted (`.credit-status.is-none`); the word carries the meaning, color only reinforces.

3. **Opaque balance stays in a sentence.** The provider balance sits in a muted `.credit-balance` line with only the `<bdi>` value in `--text` mono. It is never a headline because it has no unit, is never converted, and may be a 64-character string. Explicit "0" renders as `0`.

4. **Unavailable mirrors the reset-credit unsupported pattern** (`.unavailable-metric` + `.empty-evidence`), so Claude's not-reported row and Codex's never-observed/peer-omitted rows read as the same kind of honest absence the user already knows.

5. **Pointer vs link.** When the offer block renders, the Claude credit row's pointer is plain text that names where the link is ("Check in Claude Usage, linked under the Claude offer below."). When the offer is absent the pointer is the one anchor. Keeps exactly one Usage link per section (FR-26) without a silent dead end.

6. **Link states added to `.promotion-link`** (hover underline 140ms ease-out, focus-visible `--focus-ring` 120ms). The shipped link had no hover or focus treatment; the section's single actionable element should have one. Within the system's motion rules (ease-out, under 300ms, reduced-motion fallback). Candidate to fold into design-system.md Motion.

7. **Doctrine departures, ratified by the project.** The display face stays the project's mono stack and the body stays the `system-ui` stack from design-system.md; no OFL web font is introduced (zero external dependencies, CSP `default-src 'self'`, no build step). No icon library (Lucide) is used; the `◆` / `▲` tool marks are the system's identity cue. No entrance or state-change motion on the new rows: the band is a live readout and the doctrine's own "animate what changed, never decorate" rule plus the system's "no entrance, stagger, or continuous decoration" line both point to none.

8. **Mockup-only chrome.** The theme toggle, view nav, state-gallery captions naming wire codes, and the "gauge lanes omitted" placeholder exist only in `design.html` for review. None of it is product DOM; raw status/reason codes never reach the page (FR-20).

## Stage 7 follow-up — README reachability disclosure (Case 1)

The Auditor's informational finding 3 noted the README did not say who can reach
the Codex balance now that it moved from the local-only insights payload onto
`/api/state` (fetched by peers, re-served by a monitor's `/api/hosts`). CLAUDE.md
requires disclosing the reachability of privacy-sensitive aggregates, so one
sentence was added to the README credit paragraph. Docs only; no code changed, so
no re-verification was needed.

## Deployer — production rollback (2026-10-01)

**What happened.** After the user confirmed the production release, `0c3f29c`
(`feat: add available API credits`) was pushed to `origin/main` and the
installed checkout `/Users/developer/llmdash` fast-forwarded cleanly from
`8b021a3` to `0c3f29c` at 15:43 PDT. `install-macos.sh --service install` then
failed its readiness gate: "did not accept HTTP at http://127.0.0.1:8787/api/state
after 70 readiness checks". The LaunchAgent reported `running`, but at 60 seconds
the new process (pid 31904, about 570 MB RSS) still had no listening socket on
8787. Per the Deployer rule (a failed production health check rolls back
immediately, with no fix-forward), production was rolled back at 15:44 PDT with
`git -C "$HOME/llmdash" switch --detach 8b021a3d25feab62259c42941f6c65a726ccbeed`
plus `--service install`.

**What the rollback showed.** The previous good version failed the same installer
readiness gate ("after 67 readiness checks"). Its process opened the 8787 listener
about 110–120 seconds after start. It then passed the full configured health
check at 15:47 PDT: `--service status` was `running`, and `/api/state`,
`/api/hosts`, and `/api/codex-insights?range=30d` all returned 200, as did the
tailnet `/api/state` route at 100.70.220.2:8787. The installed badge wrapper
also rendered a normal title line. During the cold scan, responses took 6–7
seconds and the badge briefly showed "Dashboard offline". Both settled within a
few minutes.

**Cause (not this feature).** `src/server.js` primes `refreshCodexAnalytics()`
and `refreshCostAnalysis()` before `server.listen()`. Over the current local
corpus (about 8.0 GB of `~/.codex/sessions`, 2.3 GB of `~/.claude/projects`),
that priming now keeps the server from listening for about 95–120 seconds.
`install-macos.sh` allows a fixed `SERVICE_READY_TOTAL_SECONDS=45`. This build
does not touch the priming or `listen` lines (`git diff 8b021a3 0c3f29c --
src/server.js` changes neither), and the old version fails the same gate. The
September 24 deploy fit inside 45 seconds on a smaller corpus.

**Evidence the feature itself works.** An isolated dev instance of `0c3f29c` was
started on 127.0.0.1:8790 with auto-refresh off. It became ready after 94
seconds. `/api/state` then carried `accountLimits.credits` for both tools:
Claude `{"status":"unsupported","reason":"not-reported","balance":null,"capturedAt":null}`,
and Codex `{"status":"available","balance":"62500",...}`. The `/api/hosts` local
entry matched. `/api/codex-insights?range=30d` `account` had no `credits` key.
The `0c3f29c` menu-bar plugin, run through a symlink path, produced a normal title
line. That instance was stopped afterwards.

**State left behind.** `origin/main` is `0c3f29c`, and the installed checkout's
local `main` branch is also `0c3f29c`. Production runs `8b021a3` on a detached
HEAD. The two need to be reconciled at the next deploy decision: either
redeploy `0c3f29c` and accept a cold start longer than the installer's 45-second
readiness budget (then verify health by hand after the start completes), or first
fix the startup so the server listens before the analytics priming finishes.

## Engineer — startup readiness folded into this build (2026-10-01)

**Why it is in this build.** The rollback showed the blocker is not specific to
the credits feature. On the current local corpus, every deploy now fails
`install-macos.sh --service install`'s 45-second readiness check, including the
previous production version `8b021a3`, because analytics priming ran before
`server.listen()`. The user chose to fix it inside this build so `0c3f29c` plus
the fix can ship together, rather than redeploying a version that is known to
fail the gate.

**What was decided.** The installer's 45-second deadline and its
readiness-before-success contract stay as they are; the server now meets them.
Startup binds the listener before any structured-log scan, and the poller's
first tick does the priming. The poller's Codex-insights and cost scans now
return to the event loop at bounded 20 ms slices, using generators with a
synchronous drain kept for all existing callers. Bounds, budgets, cache
ceilings, atomic replacement, and converged results are unchanged. During the
prime, the existing cold states are served honestly. The only client change is
that a never-scanned local Codex activity or insights payload now reads as
loading instead of as "no activity recorded".

**Left as is (flagged, not changed).**
- `/api/trends` still scanned Claude transcripts and Codex rollouts on the
  request path, behind a 60-second TTL. That was already true before this fix.
  The Codex side was fixed in the re-verification entry below; the Claude side
  remains.
- The poller's Claude 7-day activity read (about 235 ms) is now the largest
  remaining synchronous block.
- On a cold start, the first Codex limits reading still arrives after the first
  tick's analytics, 17–33 s after start in testing.

**Re-verification (cold trends), 2026-10-01.** `/api/trends` was the remaining
request-path Codex scan. It now reads the poller's published 30-day scan and
reports an explicit `activityState: 'warming'` until the first publish, instead
of scanning a cold parse cache, which had stalled `/api/state` for up to 19 s.
The Claude side of trends still reads transcripts per request, as it always
has. It is not cold-sensitive (about 0.25 s for 7d and 0.8 s for 30d), so it was
left unchanged for this fix. Moving it to a bounded, poller-owned cache is a
follow-up.
