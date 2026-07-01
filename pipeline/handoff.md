## What We Accomplished
Fresh installs no longer fail silently. The macOS installer now bakes an
absolute codex path into the service (or warns loudly with the exact remedy),
the server prints a data-source health readout at startup and logs codex spawn
failures once per cause, and every empty gauge in the UI names its cause and
remedy — the two factually false Codex notes are gone. Verified by 48 passing
tests, a real-browser render check, and a clean security review (three
informational notes, none blocking).

## What Has Been Saved
- Code + docs: scripts/install-macos.sh, macos/com.llmdash.dashboard.plist.example,
  src/health.js (new), src/codex-limits.js, src/server.js, public/app.js,
  README.md, six new test files under tests/ (commit 9b5c33c).
- Pipeline record: pipeline/fresh-install-no-usage-data/bug-brief.md,
  pr-description.md, qa-report.md, security-report.md (commit 9b5c33c).
- Project memory: DECISIONS.md entry, two CLAUDE.md conventions,
  PRODUCT_CONTEXT.md honesty bullet (commit 1a0c03f).
- All pushed to origin/main.

## Where We Are
Fix complete and shipped (source only, by choice). The installed copy at
~/llmdash was deliberately left untouched — re-running the installer there
will bake the working codex path and bring its gauges live. Pipeline idle.

## Resume Prompt

Run `/weft` to start the next thing.
