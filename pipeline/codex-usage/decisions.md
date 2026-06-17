# Decisions — Codex Usage

## 2026-06-16 — Multi-tool layout extends the design system (Stage 4, The Designer)
**Decision:** Group the dashboard by tool (one labeled block per tool, each with
its gauges + activity) and add a top "headroom strip" that appears when a tool is
low/maxed and points to the tool with the most remaining headroom.
**Why:** The feature's whole purpose is "switch when one maxes out." Grouping
keeps attribution unambiguous across two sources; the strip surfaces the switch
cue at the moment it matters.
**Impact:** Two new reusable patterns (`.tool` block, `.headroom` strip) and a
`--warn-bg` token folded into `pipeline/design-system.md`. No other visual change.

## 2026-06-16 — Security review passed with notes; hardening applied (Stage 7, The Auditor)
**Decision:** Focused adversarial review of the increment returned PASSED WITH
NOTES (no Critical/High/Medium). Fixed both genuine items: clamp `used_pct` to
0–100 in codex-limits and claude-limits (parity), and a SIGKILL fallback on the
app-server timeout. Three findings dismissed as out-of-threat-model (require a
privileged local writer / misbehaving trusted binary, unreachable by the GET
peer). See security-report.md.
**Verified strengths:** spawn without shell + fixed args, subprocess poller-only
and time-bounded, guarded parsing, no credential reads or token/PII exposure,
escaped innerHTML, and the multi-source refactor left existing controls intact.

## 2026-06-16 — Deployed onto the existing service (Stage 8, The Deployer)
**Decision:** Restarted the existing `llmdash.service` onto the final reviewed
code (no new infra). Added `Environment=LLMDASH_CODEX_CMD=/home/parallels/.local/bin/codex`
to the unit so the service can run the codex app-server (the service PATH lacks
~/.local/bin). Verified `active` and the two-tool dashboard live over Tailscale:
Codex limits populating, Claude intact.
