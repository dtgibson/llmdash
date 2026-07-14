# PR Description — Limits-First, Tool-Grouped Dashboard

## Summary

Reorganizes the dashboard around one account-limit comparison followed by a
complete Claude Code story and a complete Codex story. It also corrects the
Codex window-identity bug that labeled a sole 10,080-minute weekly window as a
5-hour window and could revive an obsolete stored slot after relaunch.

## What changed

- Maps duration-bearing Codex windows by evidence: 300 minutes is 5-hour and
  10,080 minutes is weekly. Unknown explicit durations remain unavailable;
  explicitly named legacy fields retain their declared identity.
- Keeps a complete live Codex response authoritative for the set of current
  windows. Current Codex gauges never fall back to independent historical DB
  rows, including during cold start; history remains available to Trends.
- Retains the last complete in-process Codex reading across transient probe
  failures. Untimestamped rollout records cannot supersede it, while a genuinely
  newer timestamped record can.
- Places Claude Code and Codex account limits in one leading comparison with
  four fixed slots. A missing Codex short window renders `Unavailable` without
  a percentage, reset forecast, or fabricated meter.
- Renders all four slots before any diagnostic, including at 320px. Tool-specific
  diagnostics follow the complete comparison.
- Groups pacing, local activity, model-specific caps, deeper Codex insights,
  and Trends beneath the tool they describe. The Trends range remains shared;
  the Codex-insights range remains independent.
- Preserves multi-host account collapse, host-local activity scope, offline
  honesty, payload contracts, and menu-bar output.

## Verification

- Full suite: 552 tests, 550 passed, 0 failed, 2 environment-dependent skips.
- Focused frontend suite: 47 passed, 0 failed.
- Design lint: 3 public files scanned, 0 findings.
- Diff whitespace check: clean.
- Live app-server proof on this machine: ChatGPT Pro, Codex 5-hour `null`, Codex
  weekly 44% used / 56% remaining, reset July 20, 2026.
- Exact 320px browser emulation: document/client/body widths all 320px; each
  tool grid has client and scroll width 265px; four 128.5px cards; all cards
  precede diagnostics; range controls are 32px high.

## Risk and compatibility

No endpoint, payload shape, database schema, polling cadence, menu-bar script,
or remote-data path changed. Existing historical Codex rows are not migrated or
deleted; they remain chart evidence but can no longer masquerade as a current
window.
