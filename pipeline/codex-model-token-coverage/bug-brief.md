# Bug Brief — Codex Model Token Coverage

## What is broken
Terra records collapse to `gpt-5.6`, missing-model records stay unpriced even when their session has one explicit model, and an actively growing rollout can be reported as unreadable.

## Steps to reproduce
1. Scan the current 90-day Codex corpus and inspect normalized models and cost omissions.
2. Compare raw `gpt-5.6-terra` context rows with normalized usage, then group missing-model usage by session.
3. Re-read a rollout while it grows and inspect the published scan diagnostic.

## Expected behavior
Terra and Luna retain exact labels and effective-dated rates. A missing model is inferred only from one unambiguous session model and is disclosed as estimated; an active-file retry is not described as an access failure.

## Blast radius
Codex rollout normalization, the local cost ledger and coverage copy, the reviewed rate card, and scan diagnostics. Limits, peers, persistence, menu-bar output, and raw log contents remain unchanged.

## What done looks like
Historical Codex coverage uses the best defensible session-level estimate with exact inferred counts. New Terra/Luna records price exactly, active rollouts converge without a false unreadable note, and bounded cold-corpus verification passes.
