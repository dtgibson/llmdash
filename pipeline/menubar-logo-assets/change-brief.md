# Change Brief — Menu-Bar Logo Assets

## What is changing
The existing menu-bar **Tool marks -> Logos** option will ship with real bundled
tool marks instead of the current self-authored placeholder diamond and triangle.
Claude uses the Claude symbol; Codex uses the OpenAI blossom mark. The existing
neutral `◆` / `▲` text floor stays visible and remains the accessibility and
fallback carrier.

## Why now
The logo option exists, but the shipped assets are explicitly placeholders. The
user wants the menu-bar logo mode to show recognizable Claude and Codex branding
without requiring a manual asset drop-in.

## User-facing impact
When a SwiftBar user enables **Tool marks -> Logos**, the menu-bar item will layer
recognizable local template images over the existing text marks. xbar and failed
image renders still show the neutral text marks only. No polling, API, host
watching, display preference, service-control, or menu action behavior changes.

## Decisions touched
- `Badge display options — display as a pure presentation layer...` previously
  shipped only original placeholder art and left real brand marks to the operator.
  This run explicitly reverses that asset-sourcing part while keeping the same
  opt-in, local-read, no-network, neutral-floor safety posture.
- `A brand / third-party visual asset is opt-in...` in `CLAUDE.md` needs updating
  from placeholder-only to bundled vetted marks.

## What done looks like
The two bundled PNGs are 26x26 transparent template images sourced from documented
Claude/OpenAI logo files. Tests prove the logo path still reads local assets only
when opted in, keeps the neutral floor, and does not add network or executable
surface. The README and asset license notes explain source, trademark posture, and
Codex using the OpenAI mark.
