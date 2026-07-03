## What We Accomplished
Mid-run on menubar-service-controls (feature lane, Studio Style — hands-off except
the design step and the deploy sign-off). Stages 1–3 done. The feature adds two
menu-bar controls so the user never touches the terminal: a state-aware toggle to
install/remove the local llmdash service, and a two-tier "Uninstall llmdash"
(remove the badge only, or uninstall completely). Strategy made the key call that
the snapshot-history DB is the product's only irreplaceable asset, so a full
uninstall preserves your data by default with an explicit opt-in. The Architect
ran the self-uninstall spike (PASS, scratch-only, real service/data verified
intact): a detached temp-copied helper survives tearing down the service and
deleting its own folder as long as it reads everything up front; teardown order is
service → statusline → trust → wrapper → checkout last → data (opt-in). The
installer is extended with --service/--uninstall hooks; a new tracked helper drives
the osascript dialogs.

## What Has Been Saved
- pipeline/menubar-service-controls/strategic-brief.md (Stage 1)
- pipeline/menubar-service-controls/prd.md (Stage 2)
- pipeline/menubar-service-controls/spike-report.md (Stage 3 — self-uninstall PASS)
- pipeline/menubar-service-controls/schema.md (Stage 3 — the system design)

## Where We Are
Stage 4, The Designer — the user's participate stage. A first mockup is being
prepared (the dropdown toggle + Uninstall submenu in both modes, and the
osascript dialogs: the enumerated uninstall confirm, the data opt-in, the
service-remove confirm). The user rejoins here to ratify THE call — exactly what a
full uninstall removes and whether usage history is preserved by default — plus
the confirmation copy, then iterates and gates to The Engineer.

## Resume Prompt

To resume: run `/weft` in this project. It reads saved state and picks up at
Stage 4 (Designer), where the user ratifies the uninstall scope + the data-safety
default and reviews the dropdown/dialog design.
