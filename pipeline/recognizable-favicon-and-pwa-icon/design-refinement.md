# Design Refinement — Recognizable Favicon and PWA Icon

## Visual Direction

Create a product-owned **Double dash** mark: a cobalt rounded-square field with
two unequal horizontal allowance bars, the upper bar warm white and the shorter
lower bar headroom green. The mark extends llmdash's established `▪` product cue,
paired account-window structure, and rounded remaining-allowance meters; it does
not reuse, trace, or imply either the Claude or OpenAI identity.

The form is deliberately blunt at favicon scale. It has one dominant silhouette,
two thick interior strokes, no letters, no hairlines, and no meaning that depends
on a tiny detail. The same full-color artwork is used in light and dark browser
chrome.

## Screens / Views

### Browser Tab, Favorite, and Bookmark

- Supply the Double dash mark at 16 × 16 and 32 × 32 favicon sizes.
- At both sizes, preserve the full cobalt rounded-square silhouette and both
  interior bars. Do not introduce a separate micro-mark, wordmark, or initial.
- The production head for both dashboard pages references the local icon family.
- The icon carries its own foreground/background contrast; do not select a
  different artwork variant from `prefers-color-scheme`.
- The tab title remains `llmdash`; the icon does not change document naming.

### Apple Touch Icon

- Export a 180 × 180 opaque PNG from the same master artwork.
- Extend the cobalt field to every canvas edge. Do not bake an extra rounded
  corner, drop shadow, transparent margin, or gloss into the bitmap; iOS applies
  its own mask and presentation.
- Keep the paired bars in the same normalized coordinates as every other size.

### PWA Standard Icons

- Export opaque 192 × 192 and 512 × 512 PNGs from the same master artwork.
- Manifest metadata names the app `llmdash`, uses a concise standalone-friendly
  short name, and includes both sizes with `purpose: "any"`.
- Use the established dashboard background/accent family for manifest theme and
  background metadata; do not imply offline support or add a service worker.

### PWA Maskable Icon

- Export a dedicated opaque 512 × 512 PNG declared with `purpose: "maskable"`.
- Allow the cobalt field to bleed through the full canvas.
- Keep both semantic bars fully inside the central safe circle whose diameter is
  80% of the canvas. The production export insets and lowers the upper bar by
  0.75 master units, placing the bars approximately within x=17.75–82.25 and
  y=21.75–70 so every rendered semantic pixel remains inside the circle.
- Verify circle, squircle, and rounded-square crops. Edge loss may affect only the
  expendable blue field, never either allowance bar.

### Current-vs-Proposed Review

The mockup shows today's generic browser artwork beside the proposed favicon in
both light and dark chrome, then shows true-size 16/32 renders, 180/192/512 app
contexts, a home-screen context, and an interactive maskable crop stress test.
These controls exist only in the review artifact and do not ship.

## Component Usage

- No component library or runtime dependency is introduced.
- Use one repo-native vector master for deterministic export; SVG geometry or a
  small canvas exporter is acceptable at implementation time, but the served
  public icon family should use broadly supported favicon/PNG formats selected by
  the Engineer.
- Add local static icon and manifest routes through the existing minimal Node HTTP
  server. Reuse its explicit route allow-list, MIME handling, CSP, and `no-store`
  policy rather than creating a second static-serving mechanism.
- Add head references to both `public/index.html` and `public/settings.html`.
- Keep the existing dashboard wordmark, `▪` native menu product cue, and provider
  marks `◆` / `▲` unchanged.

## Design Tokens Applied

- Canvas: a subtle cobalt gradient from `#3478f6` to `#1747c3`, derived from the
  established accent `#2563eb` and its dark-theme family.
- Meter track: deep cobalt `#12379a`, providing quiet depth without a dead gray.
- Long allowance bar: tinted white `#f4f8ff`, not pure white.
- Headroom bar: `#65dc8c`, derived from the established dark good token
  `#55cb7b` and light good token `#168a45`.
- Master geometry: 100 × 100 viewBox; 24-unit outer radius; 15-unit meter height;
  paired production meter centers at y=29.25 and y=62.5.
- Meaningful artwork stays within the maskable 80% safe circle. The background is
  intentionally full bleed.
- Review typography, spacing, focus, surfaces, and theme tokens reuse
  `pipeline/design-system.md`; production adds no font.

## Interaction Notes

- There is no new product interaction. Icons and manifest metadata are passive.
- The review-only theme buttons prove surrounding light/dark contrast.
- The review-only launcher controls switch between circle, squircle, and rounded
  crops; the safe-area control shows or hides the 80% circle.
- Every review control is keyboard focusable, communicates state through
  `aria-pressed`, and retains a visible focus ring.
- App launch behavior remains the existing web dashboard. Do not add install
  prompts, a service worker, offline caching, or new navigation.

## Motion Spec

- Review theme state: ease-out, 160ms, control center, effectively instant under
  reduced motion, CSS.
- Review mask change: `cubic-bezier(.2,.8,.2,1)`, 220ms, icon center, effectively
  instant under reduced motion, CSS.
- Review safe-area visibility: ease-out, 160ms, icon center, effectively instant
  under reduced motion, CSS.
- Production favicon/PWA icon: static; no motion.

## Content Notes

- Product name and short name use the existing lowercase `llmdash` spelling.
- The icon must remain provider-neutral. Do not include Claude's starburst,
  OpenAI's blossom, the letters C/X, `◆`, or `▲`.
- Alternative text and documentation describe it as the llmdash Double dash or
  headroom mark; do not claim affiliation with monitored providers.
- Manifest copy stays factual and local-first. It must not promise installability,
  offline operation, push, or background synchronization that the app does not
  implement.

## Implementation Acceptance Notes

- Both HTML surfaces carry coherent favicon, touch-icon, and manifest references.
- Every referenced local asset returns 200 with the correct MIME type and the
  existing static security/cache posture.
- The manifest parses and its icon declarations resolve without redirects,
  console errors, or network errors.
- Pixel review proves recognition at 16 × 16 and 32 × 32 in light and dark chrome.
- Visual review proves clean 180 × 180, 192 × 192, and 512 × 512 rendering.
- A maskable-icon validator confirms both semantic bars remain within the 80%
  safe circle under common crops.
- No production code, runtime flow, dashboard layout, menu-bar cue, service
  worker, or external dependency changes beyond the scoped asset/metadata work.
