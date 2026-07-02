## What We Accomplished
Mid-run on multi-host (feature lane, Studio Style — hands-off except the design
step and the deploy sign-off). Stages 1–3 done. The feature aggregates several
of your own tailnet machines into one llmdash view — each host's limits and
per-machine activity side by side. Strategy made the account-wide-limits reality
the load-bearing honesty decision (limits are the account's numbers, identical
across same-account machines; the genuine new info is per-machine activity). The
PRD pinned that as a testable requirement plus the peer-polling-on-the-interval
model. The Architect resolved the design: a new `/api/hosts` endpoint (keeps
`/api/state` byte-for-byte pristine, so the badge and local view are untouched),
cached-only peer readings polled on the interval with bounded timeout/
concurrency/body-cap, a host×tool model that reuses the existing renderer, new
`peer-unreachable`/`peer-error` codes, and account-sameness detectable purely
client-side by comparing reset windows.

## What Has Been Saved
- pipeline/multi-host/strategic-brief.md (Stage 1)
- pipeline/multi-host/prd.md (Stage 2 — 22 FRs, 27 QA rows)
- pipeline/multi-host/schema.md (Stage 3 — the system design)

## Where We Are
Stage 4, The Designer — the user's participate stage. A first multi-host layout
mockup is being prepared; the user rejoins here to ratify the one genuine product
judgment — how to present account-wide limits so identical-account machines don't
read as N separate budgets — then iterates on the design and gates to The Engineer.

## Resume Prompt

To resume: run `/weft` in this project. It reads saved state and picks up at
Stage 4 (Designer), where the user ratifies the account-wide-limits presentation
and reviews the multi-host layout.
