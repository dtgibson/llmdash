# Decisions — Claude Code Live Dashboard

## 2026-06-16 — Stack simplified to vanilla (Stage 4, The Designer)
**Decision:** Drop the React + Vite + Tailwind + shadcn/ui frontend stack set in
Stage 3 in favor of a plain HTML/CSS/vanilla-JS frontend with no build step, and
a minimal Node backend with few dependencies. SQLite stays for snapshot storage.

**Why:** The user wants something simple, functional, fast, and library-light for
a personal tool ("vanilla and basic and fast, plain text is good; doesn't need a
ton of libraries"). A framework plus build pipeline is unnecessary weight for a
two-window personal dashboard.

**Impact:** `pipeline.config.json` updated (language → javascript, frontend →
vanilla, no bundler/component library; charting deferred to vanilla SVG; testing →
node:test). The Stage 3 data layer (schema.md) is unchanged. Design proceeds with
plain HTML/CSS.

## 2026-06-16 — Activity stats added (Stage 4, The Designer)
**Decision:** Add an Activity section with four stats: token usage (5-hour / week
/ today), cache hit rate, estimated value at pay-as-you-go API rates (weekly), and
a burn rate with a plain-English projection to the 5-hour limit.

**Why:** The user asked for token counts and fun stats. They are high-signal for a
personal tool, and the projection ties directly to the core goal of not getting
surprised by a limit.

**Source / impact:** These come from Claude Code's local transcript logs
(`~/.claude/projects/**/*.jsonl`, `message.usage.*`), a different source from the
account-wide limit gauges — surfaced honestly in the UI. The logs retain full
history, so the stats are computed on demand with no schema change (see schema.md
→ Activity stats). PRD updated with FR-17..FR-21, QA-11..QA-14, and OQ-05
(pricing source for estimated value).

## 2026-06-16 — More activity stats added; /usage insights deliberately excluded (Stage 5, The Engineer)
**Decision:** Added three more activity stats, all computed exactly from the logs:
a weekly token mix (input / output / cache-read / cache-write), weekly cache
savings (cache reads valued at full input price minus actual), and today's
estimated value alongside the weekly figure. Also rounded the limit gauges
conservatively (floor remaining, ceil used) so they never overstate headroom and
match `/usage`.

**Excluded on purpose:** Claude Code's "what's contributing to your limits"
insights (subagent-heavy %, >150k-context %, 8h+-session %). Attempted to
reproduce them from the logs and the numbers diverge materially from `/usage`
(subagent attribution isn't present in the readable logs at all; context and
session-duration math differ). Showing approximations that quietly disagree with
`/usage` would undermine the dashboard's whole purpose, so they are left out.
Recorded as PRD FR-22..FR-25 and QA-15..QA-17.

## 2026-06-16 — Security review passed with notes; hardening applied (Stage 7, The Auditor)
**Decision:** Adversarial multi-agent security review returned PASSED WITH NOTES
(no Critical/High/Medium/Low; all genuine findings Informational). Applied the
cheap, worthwhile fixes immediately: NaN guard on rate-limit parsing, request
method handling (405 + HEAD), baseline security headers (nosniff, CSP, referrer),
and removed a stray vitest cache from node_modules. Accepted as documented design
or low-priority: the 0.0.0.0 default bind (Tailscale boundary + LLMDASH_HOST
mitigation), unbounded transcript reads (user's own logs), and no snapshot
retention (kept so feature 3 has full chart history). See security-report.md.

## 2026-06-16 — Deployed as a systemd user service (Stage 8, The Deployer)
**Decision:** Self-hosted deploy (no cloud target, by design). Installed a
systemd user service at `~/.config/systemd/user/llmdash.service` (absolute nvm
Node path, `LLMDASH_PORT=8787`, `Restart=on-failure`), enabled it, and enabled
user lingering so it runs across reboots without an active login. Verified
`active (running)` and reachable over Tailscale at `http://snowravendev-vm:8787`
with live data. Rollback if ever needed: `systemctl --user disable --now
llmdash.service`.
